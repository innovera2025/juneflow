// PmNotesScreen — the mobile PM maintenance log, ported from pototype/mobile-pm.jsx
// MPMNotes (L148-179). Route `pm-notes` (mobile_routes.dart; MobileSection.field) —
// reached from `pm-checklist` once the checklist save is confirmed, carrying the real
// work-order id via the Navigator.push seam (the pm-jobs → pm-checkin → pm-checklist
// precedent). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// eyebrow · title, L151-152), ONE card holding the four labelled fields in order
// (cause L155 / fix L158 / advice L161 / parts L164) with the prototype's own box
// metrics (surface-2 fill, radius 8, 10px padding, 12.5px text, 1.5 line-height,
// 54/54/40 min heights), and the sticky bottom bar (L174-176). Every colour/space is
// a generated design token (JuneflowTokens); every string is a key from the sidecar
// (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3) — what the prototype fakes and this screen does NOT:
//   - the three text boxes hold hardcoded sentences there (L156/159/162); here they
//     are REAL editable fields seeded from the work order's own `cause` / `fix` /
//     `advice` columns (GET /pm/workorders, pm.ts workOrderWire) and written back by
//     the save. The prototype renders them as static divs because it is a mock of an
//     ALREADY-FILLED log; the screen's whole purpose is entering them, so they are
//     inputs — same box, same metrics, nothing redesigned;
//   - the parts row shows a hardcoded part name + a hardcoded quantity and price
//     there (L164-167). The work order has NO parts column: spare parts live on
//     pmQuotes.parts, raised via
//     POST /pm/quotes (pm.ts L830), and they carry money. The label stays (chrome);
//     the value is an honest em-dash — never an invented part, never a fabricated
//     amount (the pm-checkin zone/SLA/contract precedent);
//   - the amber banner (L170-172) is DROPPED. It PROMISES that the system will raise
//     a quote and push it to the customer over LINE OA automatically. Nothing does:
//     no code auto-raises a pmQuote, and LINE is an explicit no-op stub (pm.ts
//     lineNotifyStub, B-108b). A promise cannot be em-dashed the way a missing value
//     can, so rendering it at all would be a fabrication. Its trigger ("parts were
//     replaced") has no wire either — see the parts slot above;
//   - the CTA's LABEL (L175) is DROPPED for exactly the same reason. It is NOT the
//     only place this port differs from the reference image
//     (tests/visual/reference/mobile/pm-notes.png) — that image also renders the
//     amber banner above as a full orange-bordered section, the parts row as a named
//     part with a priced quantity where this port prints an em-dash, and the three
//     note boxes as static mock sentences where this port renders editable inputs
//     over the real columns. BLOCKERS.md B-285 enumerates that whole deviation set
//     and files the CTA label for a ruling. There that button is a pure NAVIGATION
//     (`setScreen("pm-close")`) reading "go to the summary + close the job": it
//     performs no save, and the screen it names is not built here. This port's
//     primary action is the SAVE the prototype never had, and it stays on the screen.
//     A label naming both a destination the app does not have and an action the
//     button does not perform is a PROMISE, not a value, so it cannot be em-dashed —
//     it is dropped, like the banner. What ships instead names what each control
//     actually does: before a durable save the button is `common.save` and it saves;
//     after one it becomes the onward affordance `pm.btnNext`, which NOW NAVIGATES —
//     pm-close is built (feature/mobile-pm-close), so it no longer has to sit
//     honest-disabled (the same unblocking pm-checklist got when this screen landed).
//     It carries the REAL work-order id through the Navigator.push seam. NOTHING here
//     closes a job or claims one is closed: pm-close is itself a read-only summary
//     whose own close affordance is disabled (BLOCKERS.md B-288), and `pm.btnNext`
//     ("next") names a step, not an outcome.
//
// The write is the REAL POST /pm/workorders/{id}/close { cause, fix, advice },
// captured through the level-(a) offline queue (pm_notes_repository.dart — read its
// header for why that endpoint, and BLOCKERS.md B-281 for the future risk its NAME
// carries). The handler has no status/certificate column and never invents one
// (pm.ts L754-758), so this screen never learns of, or reports, a closed job — the
// honest states are exactly saved / queued / failed, following the pm-checkin +
// pm-checklist precedent and BLOCKERS.md B-268 option (a): a `deferred` outcome is
// shown as QUEUED (captured, not confirmed), a 4xx as FAILED, never a fake success.
//
// WHY A FAILED READ ALSO WITHHOLDS THE WRITE (a real limitation, stated up front —
// the offline write is the point of the screen, so gating it needs a reason):
// the body is the WHOLE form, all three keys, ALWAYS (pm_notes_agg.notesPayload),
// because the handler keys off key PRESENCE — an omitted key could never clear a
// field the technician just emptied. That makes the save a last-write-wins overwrite
// of exactly the three columns the read supplies. Without the stored values in hand a
// blank field is indistinguishable from a cleared one, so saving from an unseeded
// form would silently NULL out text a previous visit stored. The queue still covers
// the realistic field case — the read succeeds on arrival, signal drops in the
// machine room, the save is captured and replayed — it is the read failing AT MOUNT
// that makes the overwrite unsafe. So the form and the button are withheld and the
// log renders UNKNOWN (an em-dash), never a blank log. The notes-only write path
// B-281 offers as its first option is also the seam that would make a read-free
// write safe.
import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import '../pm_close/pm_close_screen.dart';
import 'pm_notes_agg.dart';
import 'pm_notes_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `pm-notes`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [PmNotesScreen].
///
/// Constructed at the pm-checklist push site with a REAL [workOrderId]; when the
/// shell routes it as a bare tab there is no selection, so [workOrderId] is null → an
/// honest "no work order selected" state (the approve/reject/pm-checkin/pm-checklist
/// nullable-id precedent).
class PmNotesScreenHost extends StatefulWidget {
  const PmNotesScreenHost({super.key, this.workOrderId});

  /// The work order whose maintenance log is filled in (path id for the POST). Null
  /// when the screen is reached without a selection → honest-empty.
  final String? workOrderId;

  @override
  State<PmNotesScreenHost> createState() => _PmNotesScreenHostState();
}

class _PmNotesScreenHostState extends State<PmNotesScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pm_notes');
  }

  @override
  Widget build(BuildContext context) {
    final AppServices services = AppScope.of(context);
    return Scaffold(
      backgroundColor: JuneflowTokens.surfaceBg,
      body: FutureBuilder<ScreenStrings>(
        future: _stringsFuture,
        builder: (BuildContext context, AsyncSnapshot<ScreenStrings> snap) {
          final ScreenStrings? strings = snap.data;
          if (strings == null) {
            return const ColoredBox(color: JuneflowTokens.surfaceBg);
          }
          // The save replays through the app's ONE offline queue + drain processor
          // (AppServices.syncProcessor, B-262) over the shared Dio (auth + tenant
          // scope); the read goes straight to that same Dio. Taking the shared
          // instance rather than building a processor here is what lets a queued
          // save drain on app resume, not only while this screen is mounted.
          return PmNotesScreen(
            repo: DioPmNotesRepository(services.dio, services.syncProcessor),
            strings: strings,
            i18n: services.i18n,
            workOrderId: widget.workOrderId,
          );
        },
      ),
    );
  }
}

/// The maintenance-log view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class PmNotesScreen extends StatefulWidget {
  const PmNotesScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.workOrderId,
  });

  final PmNotesRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? workOrderId;

  @override
  State<PmNotesScreen> createState() => _PmNotesScreenState();
}

class _PmNotesScreenState extends State<PmNotesScreen> {
  final TextEditingController _cause = TextEditingController();
  final TextEditingController _fix = TextEditingController();
  final TextEditingController _advice = TextEditingController();

  /// True once the read finished (so the seeded fields can be told apart from a
  /// pending load).
  bool _loaded = false;

  /// Set when the work order could not be read (request threw, or the id was not in
  /// the page). The log is then UNKNOWN, not empty, so neither the form nor the save
  /// is offered: the write overwrites all three columns at once, so an unseeded form
  /// would blank whatever a previous visit stored (see the file header — this is a
  /// deliberate, disclosed limitation of the offline write, not an oversight).
  bool _loadFailed = false;

  PmNotesSaveState _state = PmNotesSaveState.idle;

  /// The stable client idempotency key of the op currently awaiting resolution.
  ///
  /// Reused on every later attempt, so a re-save only ever re-drains that one op.
  /// Without B-330 a restart while the write was queued minted a fresh key and
  /// enqueued a second op.
  ///
  /// Cleared once the op resolves, or when the technician edits a field again (a new
  /// body is a new write — see [_edited]).
  ///
  /// A null does NOT mean "nothing of mine is queued", only "this State is not
  /// tracking one". State is not durable and the QUEUE is, so the two disagree after
  /// an app kill — and, until [_settling] clears, before this mount's own queue read
  /// has answered. [_resumeQueued] makes the outstanding write VISIBLE; the pre-mint
  /// queue check in [_onSave] is what stops a second key, and B-341 is what stops a
  /// tap before the read lands.
  String? _opId;

  /// True until this mount's QUEUE READ has answered "is a log write of mine still
  /// outstanding for this work order?" — the window the save CTA is quiet for (B-341).
  ///
  /// Raised in [initState], so the very FIRST frame already renders the quiet CTA, and
  /// lowered in a `finally` so a queue read that throws opens the button rather than
  /// parking it forever. The contract, and why the window is bounded, is in
  /// offline/pending_op_adoption.dart.
  bool _settling = false;

  /// True once the technician has actually EDITED the form in this State — i.e. the
  /// body on screen is no longer the body any queued op carries.
  ///
  /// It records what dropping [_opId] in [_onEdited] MEANT, because the null alone
  /// cannot say it: [_opId] is null both after a real edit and when nothing has ever
  /// been submitted, and the pre-mint queue check in [_onSave] must adopt in the
  /// second case and MUST NOT in the first — adopting an op whose body the user has
  /// since rewritten would re-drain the OLD text and silently discard the edit.
  bool _edited = false;

  /// True only while [_seed] is writing the stored body into the controllers.
  ///
  /// The listener cannot tell seeding from typing by itself, and inside the on-mount
  /// window it cannot infer it from the state either — `_state` is idle and [_opId]
  /// null there for BOTH. So the one place that knows says so. This flag gates ONLY
  /// the [_edited] bookkeeping: whether a notification drops [_opId] is decided by the
  /// state exactly as before, which is what keeps the read-before-adopt ordering in
  /// [_resumeQueued] load-bearing rather than decorative.
  bool _seeding = false;

  @override
  void initState() {
    super.initState();
    for (final TextEditingController c in <TextEditingController>[
      _cause,
      _fix,
      _advice,
    ]) {
      c.addListener(_onEdited);
    }
    if (widget.workOrderId != null) {
      _settling = true;
      unawaited(_resumeQueued());
    } else {
      _loaded = true;
    }
  }

  /// The (a) on-mount trigger, plus the rehydration that makes [_opId] survive an
  /// app kill (B-330), in the order B-341 requires.
  ///
  /// THE QUEUE READ IS WHAT THE CTA WAITS ON, and the drain is deliberately not in
  /// that window: a drain can only shrink what is adoptable, so reading first cannot
  /// miss anything a post-drain read would have found, and it keeps the one unbounded
  /// call (Dio has no `connectTimeout`) out of the wait
  /// (offline/pending_op_adoption.dart).
  ///
  /// THE READ CHAIN IS IN THAT WINDOW, though, and only here among the six. `_load`
  /// seeds the three controllers, which fires [_onEdited], which DROPS `_opId` —
  /// because a typed character genuinely does mean "new body, new write". Seeding is
  /// not typing, so the load is started in parallel but AWAITED BEFORE the queue read:
  /// by then the controllers have settled and the only thing that can clear the
  /// adopted id afterwards is a real edit. It costs the user nothing to wait on it,
  /// because the form — and with it the save CTA — is not rendered at all until
  /// `_loaded` (see [build]); before B-341 that stretch was a CTA-less no-op, and the
  /// only thing that changes is that the button is now visibly quiet rather than
  /// silently inert.
  ///
  /// The drain then runs, and [_reconcile] takes the card back down if it resolved the
  /// very write the card was about.
  Future<void> _resumeQueued() async {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    final Future<void> loading = _load();
    // Started NOW — a queue left over from a prior session must not wait on this
    // screen's read chain — but awaited only after the settle. Its handlers are
    // attached at construction so a drain that throws can never surface as an
    // unhandled async error while it sits unawaited.
    final Future<void> drained = widget.repo.drain().then<void>(
      (DrainReport _) {},
      onError: (Object _) {},
    );
    await loading;
    final String? adopted = await _settleQueue(woId);
    await drained;
    if (adopted != null) await _reconcile(woId, adopted);
  }

  /// The queue read the CTA waits on. Returns the adopted op id, or null.
  Future<String?> _settleQueue(String woId) async {
    try {
      final SyncOperation? mine = findAdoptableOp(
        await widget.repo.due(),
        pmNotesOpIdentity(woId),
      );
      // [_edited] is checked AFTER the read, and that is the whole point of
      // checking it here at all (B-330 F1 case A). B-341 quietens the CTA for this
      // window, but it does not quieten the FORM: the technician can type
      // throughout it, and this adoption lands after he does. Overwriting his edit
      // sends the next save down the `tracked != null` branch, which re-drains the
      // OLD body — his text never leaves the device while the screen reports the
      // write as handled. The rule is not new: [_onSave] already refuses to adopt
      // after an edit, for exactly this reason. This is the same rule at the OTHER
      // place that adopts.
      if (mine == null || !mounted || _edited) return null;
      setState(() {
        _opId = mine.id;
        // Only a still-replayable op is adoptable (findAdoptableOp), and that is
        // precisely what `queued` means: captured, not confirmed.
        _state = PmNotesSaveState.queued;
      });
      return mine.id;
    } catch (_) {
      // A queue read that FAILED has answered nothing, and a CTA left quiet on an
      // unanswerable question is the dead end B-341 forbids. The button opens; the
      // mint site asks the same queue again before it mints.
      return null;
    } finally {
      if (mounted) setState(() => _settling = false);
    }
  }

  /// Take the queued state down once the drain has resolved the write it described —
  /// the display cost of adopting before the drain, paid back one round trip later on
  /// exactly the state the old drain-first ordering reached. Skipped once the
  /// technician has acted (a save, or a typed character that drops the id): their flow
  /// owns `_state` and `_opId` from that point.
  Future<void> _reconcile(String woId, String adopted) async {
    if (!_stillShowing(adopted)) return;
    final SyncOperation? still = findAdoptableOp(
      await widget.repo.due(),
      pmNotesOpIdentity(woId),
    );
    // At most one op per identity is adoptable at a time (the B-330 invariant), so a
    // non-null answer is the same log write, still outstanding.
    if (still != null || !_stillShowing(adopted)) return;
    setState(() {
      _opId = null;
      _state = PmNotesSaveState.idle;
    });
  }

  /// True while the screen is still showing exactly what [_settleQueue] adopted.
  bool _stillShowing(String adopted) =>
      mounted && _opId == adopted && _state == PmNotesSaveState.queued;

  @override
  void dispose() {
    for (final TextEditingController c in <TextEditingController>[
      _cause,
      _fix,
      _advice,
    ]) {
      c
        ..removeListener(_onEdited)
        ..dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final String id = widget.workOrderId!;
    try {
      final List<PmNotesEnt> rows = await widget.repo.listWorkOrders();
      final PmNotesEnt? wo = findWorkOrder(rows, id);
      if (!mounted) return;
      final PmNotes stored = wo == null ? const PmNotes() : parsePmNotes(wo);
      setState(() {
        _loadFailed = wo == null;
        _loaded = true;
      });
      // Seed the form from the REAL stored columns (a null column leaves the field
      // empty so its placeholder shows — never a fabricated sentence).
      _seed(stored);
    } on Object {
      if (!mounted) return;
      setState(() {
        _loadFailed = true;
        _loaded = true;
      });
    }
  }

  /// Fill the controllers from the stored columns.
  ///
  /// Seeding is not an edit, and [_seeding] is what says so. The state cannot: at
  /// seed time the screen is `idle` with no op outstanding, which is indistinguishable
  /// from a technician typing INSIDE the on-mount window (BLOCKERS.md B-330 F1) —
  /// and those two must not be treated alike, because the second one means the queued
  /// op no longer describes the form and must not be adopted at the next save.
  ///
  /// Note that a seed can also be SILENT: `TextEditingController.text = ''` on an
  /// already-empty controller assigns an equal `TextEditingValue` and notifies nobody.
  /// The flag is what makes the noisy case (a work order with a stored log) behave
  /// like the silent one instead of the other way round.
  void _seed(PmNotes n) {
    _seeding = true;
    try {
      _cause.text = n.cause ?? '';
      _fix.text = n.fix ?? '';
      _advice.text = n.advice ?? '';
    } finally {
      _seeding = false;
    }
  }

  /// A typed character invalidates any resolved/unresolved save: the body changed, so
  /// the next save is a NEW write, not a retry of the old one.
  void _onEdited() {
    // Recorded FIRST, before the returns below: a character typed inside the on-mount
    // window arrives while the screen is still idle with no op, so the early return
    // is exactly where a real edit hides. Missing it there would let the pre-mint
    // check in [_onSave] adopt the queued op and re-drain the OLD body over what was
    // just typed — one write, and the technician's text gone.
    if (!_seeding) _edited = true;
    if (_state == PmNotesSaveState.idle && _opId == null) return;
    if (_state == PmNotesSaveState.saving) return;
    setState(() {
      _state = PmNotesSaveState.idle;
      _opId = null;
      // Remember WHY the id was dropped, so the pre-mint check in [_onSave] does not
      // hand it straight back and re-drain the body this edit just replaced.
      _edited = true;
    });
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// Generate a fresh client idempotency key (uuid-free — no package), the same
  /// scheme pm-checkin / pm-checklist use.
  String _newOpId() =>
      'pm-notes-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  /// The current form as the three real columns (blank → null, so an untouched field
  /// never claims a value).
  PmNotes get _form => PmNotes(
    cause: _cause.text.trim().isEmpty ? null : _cause.text.trim(),
    fix: _fix.text.trim().isEmpty ? null : _fix.text.trim(),
    advice: _advice.text.trim().isEmpty ? null : _advice.text.trim(),
  );

  /// The sticky CTA. With no unresolved op it enqueues the whole form and drains;
  /// with one already queued/failed it re-drains the SAME op (a manual retry) — never
  /// a second enqueue.
  Future<void> _onSave() async {
    final String? woId = widget.workOrderId;
    if (woId == null || !_loaded || _loadFailed) return;
    if (_state == PmNotesSaveState.saving) return;
    // The CTA is already rendered quiet for this window ([_actionBar]); this is the
    // same refusal at the handler, so a tap delivered against a stale frame cannot
    // slip past it either (B-341).
    if (_settling) return;

    // Flipped SYNCHRONOUSLY before the first await, so the CTA is already disabled
    // when a second tap could otherwise arrive during the queue read.
    setState(() => _state = PmNotesSaveState.saving);

    final String? tracked = _opId;
    if (tracked != null) {
      final DrainReport report = await widget.repo.drain();
      await _resolve(tracked, report);
      return;
    }

    // About to MINT a key — so ask the QUEUE rather than trust this State's null
    // (B-330). That null also covers the whole on-mount drain, during which this CTA
    // is live and a log write of this work order's may already be queued; minting
    // there enqueues a SECOND op under a SECOND key.
    //
    // Skipped after a real edit: [_edited] says the body on screen is no longer the
    // one the queued op carries, so that op is not this write and adopting it would
    // send the OLD text and drop what the technician just typed.
    if (!_edited) {
      final SyncOperation? already = findAdoptableOp(
        await widget.repo.due(),
        pmNotesOpIdentity(woId),
      );
      if (!mounted) return;
      if (already != null) {
        setState(() => _opId = already.id);
        final DrainReport report = await widget.repo.drain();
        await _resolve(already.id, report);
        return;
      }
    }

    final String opId = _opId = _newOpId();
    final DrainReport report = await widget.repo.saveNotes(
      workOrderId: woId,
      opId: opId,
      body: notesPayload(_form),
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<dynamic> due = await widget.repo.due();
    final PmNotesSaveState next = resolveNotesSaveState(
      opId,
      report,
      due.cast(),
    );
    if (!mounted) return;
    setState(() {
      _state = next;
      // A durable success closes the op out; a queued/failed op stays addressable so
      // the CTA can retry exactly it.
      if (next == PmNotesSaveState.saved) _opId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final bool hasForm = _loaded && widget.workOrderId != null && !_loadFailed;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // The prototype's eyebrow is a human work-order number
            // ("PMWO-2569-0312", L151). pm_workorder stores no document number and
            // workOrderWire exposes none, so there is nothing honest to print — the
            // pm-jobs agg omits the same field for the same reason. An em-dash, never
            // the raw uuid dressed up as a document number.
            sub: _dash,
            title: _t('title'),
            leading: _backButton(),
          ),
          Expanded(child: _body(hasForm)),
          if (hasForm) _actionBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-pm.jsx L152 — surface-3 circle + chevL; the
  /// prototype returns to pm-checklist, which is exactly what popping does).
  Widget _backButton() {
    return GestureDetector(
      onTap: () => Navigator.maybePop(context),
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: JuneflowTokens.surfaceMuted,
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.chevron_left,
          size: 18,
          color: JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  Widget _body(bool hasForm) {
    if (!_loaded) return const SizedBox.shrink();
    if (!hasForm) return _empty();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        MSection(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // mobile-pm.jsx L155-162 — the three REAL columns, in source order.
              MField(
                label: _t('fieldCause'),
                child: _noteBox(_cause, _t('phCause'), 54),
              ),
              MField(
                label: _t('fieldFix'),
                child: _noteBox(_fix, _t('phFix'), 54),
              ),
              MField(
                label: _t('fieldAdvice'),
                child: _noteBox(_advice, _t('phAdvice'), 40),
              ),
              // mobile-pm.jsx L164-167 — label kept (chrome), value em-dashed: the
              // work order has no parts column (see the file header).
              MField(label: _tp('fieldParts'), child: _partsSlot()),
            ],
          ),
        ),
        if (_statusTone() case final _StatusTone tone) _statusCard(tone),
      ],
    );
  }

  /// One editable note box, matching the prototype's static div exactly
  /// (mobile-pm.jsx L156: surface-2 fill, radius 8, 10px padding, 12.5px / 1.5, and
  /// the per-field min height). Multi-line and unbounded — the technician types the
  /// whole account of the job here.
  Widget _noteBox(
    TextEditingController controller,
    String placeholder,
    double minHeight,
  ) {
    return Container(
      constraints: BoxConstraints(minHeight: minHeight),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: TextField(
        controller: controller,
        enabled: _state != PmNotesSaveState.saving,
        maxLines: null,
        keyboardType: TextInputType.multiline,
        textInputAction: TextInputAction.newline,
        style: const TextStyle(
          fontSize: 12.5,
          height: 1.5,
          color: JuneflowTokens.textPrimary,
        ),
        decoration: InputDecoration(
          isDense: true,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          contentPadding: EdgeInsets.zero,
          hintText: placeholder,
          hintStyle: const TextStyle(
            fontSize: 12.5,
            height: 1.5,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ),
    );
  }

  /// The parts row (mobile-pm.jsx L164-167). The box is the prototype's; the value is
  /// an em-dash because no work-order column backs it — parts live on pmQuotes.parts
  /// (POST /pm/quotes) and carry money, so nothing is read, computed, or invented
  /// here.
  Widget _partsSlot() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        _dash,
        style: TextStyle(fontSize: 12, color: JuneflowTokens.textTertiary),
      ),
    );
  }

  /// The tone of the current honest save status, or null when there is nothing to
  /// show yet (idle / saving).
  _StatusTone? _statusTone() {
    switch (_state) {
      case PmNotesSaveState.saved:
        return _StatusTone(
          fg: JuneflowTokens.statusOkFg,
          bg: JuneflowTokens.statusOkSoft,
          icon: Icons.check_circle,
          text: _t('saved'),
        );
      case PmNotesSaveState.queued:
        return _StatusTone(
          fg: JuneflowTokens.statusWarnFg,
          bg: JuneflowTokens.statusWarnSoft,
          icon: Icons.sync,
          text: _t('queued'),
        );
      case PmNotesSaveState.failed:
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.error_outline,
          text: _t('failed'),
        );
      case PmNotesSaveState.idle:
      case PmNotesSaveState.saving:
        return null;
    }
  }

  /// The honest status card. The prototype has no notion of any of these states — its
  /// CTA just navigates — so they follow the pm-checkin / pm-checklist precedent
  /// (B-268 a): a queued write is shown as CAPTURED-NOT-CONFIRMED, never a success,
  /// and NOTHING here claims a certificate or a closed job (pm.ts L754-758).
  Widget _statusCard(_StatusTone tone) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tone.fg),
      ),
      child: Row(
        children: <Widget>[
          Icon(tone.icon, size: 18, color: tone.fg),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              tone.text,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: tone.fg,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Push the close-summary screen for this work order (mobile-pm.jsx L175:
  /// `setScreen("pm-close")`), carrying the REAL work-order id — the same
  /// Navigator.push seam pm-checkin → pm-checklist → this screen already use. The id
  /// is load-bearing: pm-close reads that work order's checklist tally, its asset
  /// join and its stored signature, so pushing without it would render an honest-empty
  /// summary instead of this job's.
  void _openClose() {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => PmCloseScreenHost(workOrderId: woId),
      ),
    );
  }

  /// The sticky bottom bar (mobile-pm.jsx L174-176). Idle/queued/failed → the SAVE
  /// action (enqueue + drain, or re-drain the same op on a retry), labelled `save`
  /// and carrying NO forward chevron, because saving is all it does: it writes the
  /// three columns and stays here. The prototype's own label and chevron name a
  /// navigation to pm-close, which this button does not perform and which the app
  /// does not have — dropped like the amber banner (see the file header, B-285).
  /// While saving it is disabled (a spinner). Saved → the onward affordance, which
  /// now NAVIGATES: pm-close is built (feature/mobile-pm-close), so this no longer
  /// has to sit honest-disabled. It is still not a claim that the job is closed —
  /// pm-close is a read-only summary whose own close affordance is disabled (B-288).
  Widget _actionBar() {
    final bool saved = _state == PmNotesSaveState.saved;
    // Quiet during the on-mount queue read as well as during a save (B-341). It wears
    // the SAME muted-fill + spinner the save already uses, which needs no new copy and
    // states the truth: the screen is working, briefly, on a local read.
    final bool busy = _state == PmNotesSaveState.saving || _settling;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: saved
          ? _stickyButton(
              label: _t('next'),
              icon: Icons.chevron_right,
              onTap: _openClose,
            )
          : _stickyButton(
              label: _t('save'),
              onTap: busy ? null : _onSave,
              busy: busy,
            ),
    );
  }

  Widget _stickyButton({
    required String label,
    required VoidCallback? onTap,
    IconData? icon,
    bool busy = false,
  }) {
    final bool enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: enabled
              ? JuneflowTokens.brandPrimary
              : JuneflowTokens.surfaceMuted,
          borderRadius: BorderRadius.circular(10),
        ),
        child: busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: JuneflowTokens.textSecondary,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: enabled
                            ? JuneflowTokens.shellTextStrong
                            : JuneflowTokens.textTertiary,
                      ),
                    ),
                  ),
                  if (icon != null) ...<Widget>[
                    const SizedBox(width: 6),
                    Icon(
                      icon,
                      size: 18,
                      color: enabled
                          ? JuneflowTokens.shellTextStrong
                          : JuneflowTokens.textTertiary,
                    ),
                  ],
                ],
              ),
      ),
    );
  }

  /// Honest-empty — a centered em-dash: no work order selected, or the work order
  /// could not be read (so its log is unknown, not blank).
  Widget _empty() {
    return const Center(
      child: Text(
        _dash,
        style: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: JuneflowTokens.textTertiary,
        ),
      ),
    );
  }
}

/// Colours + icon + text of one honest status variant.
class _StatusTone {
  const _StatusTone({
    required this.fg,
    required this.bg,
    required this.icon,
    required this.text,
  });

  final Color fg;
  final Color bg;
  final IconData icon;
  final String text;
}
