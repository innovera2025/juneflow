// PmChecklistScreen — the mobile PM checklist, ported from pototype/mobile-pm.jsx
// MPMChecklist (L98-146). Route `pm-checklist` (mobile_routes.dart;
// MobileSection.field) — reached from `pm-checkin` once the check-in is confirmed,
// carrying the real work-order id via the Navigator.push seam (the pm-jobs →
// pm-checkin precedent). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// "checked n/total" eyebrow · title), one card per check line with a zero-padded
// ordinal + label, the before/after photo pair, the 2-column result toggle grid,
// and the sticky bottom CTA. Every colour/space is a generated design token
// (JuneflowTokens); every string is a key from the sidecar (no Thai byte in this
// file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3) — what the prototype fakes and this screen does NOT:
//   - the 5 check labels are a hardcoded local array there; here they are the work
//     order's OWN items[] snapshot from GET /pm/workorders (pm.ts workOrderWire).
//     A work order whose snapshot is empty renders honest-empty (pm.emptyChecklist)
//     rather than borrowing a checklist-template's labels it was never given;
//   - the BEFORE slot is an unconditional filled thumbnail + check icon there — it
//     claims a photo on every row with nothing behind it. Here BOTH slots are
//     driven by the REAL stored PmChecklistRow.before/.after reference, so an
//     empty slot stays empty;
//   - the AFTER slot's filled state is derived from the result toggle there
//     (picking a "normal" result fakes an attached photo). That coupling is
//     dropped, together with its result-dependent icon/tint;
//   - photo CAPTURE is not wired: pubspec.yaml carries no camera/image package and
//     adding one is a Wei-level stack decision (the geolocator/B-260 precedent;
//     the same gap is recorded for st-receive in BLOCKERS.md B-266). The slots are
//     inert in the prototype too (plain divs, no onClick), so they ship inert —
//     they REPORT the stored reference, they never invent or promise one.
//
// The write is the REAL PUT /pm/workorders/{id}/checklist, captured through the
// level-(a) offline queue (pm_checklist_repository.dart). Its honest states follow
// the pm-checkin precedent and BLOCKERS.md B-268 option (a): a `deferred` outcome
// is shown as QUEUED (saved, not confirmed) and a 4xx as FAILED — never a fake
// success. The
// prototype's CTA simply navigates; the onward affordance now NAVIGATES too —
// pm-notes is built (feature/mobile-pm-notes), so it no longer has to sit
// honest-disabled (exactly the treatment pm-checkin gave this screen once it
// landed).
import 'dart:async';
import 'dart:math';
import 'dart:ui' show PathMetric;

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
import '../pm_notes/pm_notes_screen.dart';
import 'pm_checklist_agg.dart';
import 'pm_checklist_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `pm-checklist`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [PmChecklistScreen].
///
/// Constructed at the pm-checkin push site with a REAL [workOrderId]; when the
/// shell routes it as a bare tab there is no selection, so [workOrderId] is null →
/// an honest "no work order selected" state (the approve/reject/pm-checkin
/// nullable-id precedent).
class PmChecklistScreenHost extends StatefulWidget {
  const PmChecklistScreenHost({super.key, this.workOrderId});

  /// The work order whose checklist is filled in (path id for the PUT). Null when
  /// the screen is reached without a selection → honest-empty.
  final String? workOrderId;

  @override
  State<PmChecklistScreenHost> createState() => _PmChecklistScreenHostState();
}

class _PmChecklistScreenHostState extends State<PmChecklistScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pm_checklist');
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
          return PmChecklistScreen(
            repo: DioPmChecklistRepository(
              services.dio,
              services.syncProcessor,
            ),
            strings: strings,
            i18n: services.i18n,
            workOrderId: widget.workOrderId,
          );
        },
      ),
    );
  }
}

/// The checklist view. Dependencies are injected so the screen is driven directly
/// in tests (a fake repo + inline strings/i18n), never via the network.
class PmChecklistScreen extends StatefulWidget {
  const PmChecklistScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.workOrderId,
  });

  final PmChecklistRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? workOrderId;

  @override
  State<PmChecklistScreen> createState() => _PmChecklistScreenState();
}

class _PmChecklistScreenState extends State<PmChecklistScreen> {
  /// The checklist lines, loaded from the work order's own snapshot. Null while the
  /// read is in flight; empty when the work order genuinely has no checklist.
  List<PmChecklistItem>? _items;

  /// True once the read finished (so an empty [_items] can be told apart from a
  /// pending load) — and false again only if the screen is rebuilt.
  bool _loaded = false;

  /// Set when the read itself failed: the list is unknown, so the screen must not
  /// render an empty checklist (which would read as "this job has no checks").
  bool _loadFailed = false;

  PmChecklistSaveState _state = PmChecklistSaveState.idle;

  /// The stable client idempotency key of the op currently awaiting resolution.
  ///
  /// Reused on every later attempt, so a re-tap only ever re-drains that one op.
  /// Without B-330 a restart while the write was queued minted a fresh key and
  /// enqueued a second op.
  ///
  /// Cleared once the op resolves, or when the technician edits a result again (a
  /// new payload is a new write — see [_edited]).
  ///
  /// A null does NOT mean "nothing of mine is queued", only "this State is not
  /// tracking one". State is not durable and the QUEUE is, so the two disagree after
  /// an app kill — and, until [_settling] clears, before this mount's own queue read
  /// has answered. [_resumeQueued] makes the outstanding write VISIBLE; the pre-mint
  /// queue check in [_onSave] is what stops a second key, and B-341 is what stops a
  /// tap before the read lands.
  String? _opId;

  /// True until this mount's QUEUE READ has answered "is a checklist write of mine
  /// still outstanding for this work order?" — the window the CTA is quiet for
  /// (B-341).
  ///
  /// Raised in [initState], so the very FIRST frame already renders the quiet CTA, and
  /// lowered in a `finally` so a queue read that throws opens the button rather than
  /// parking it forever. The contract, and why the window is bounded, is in
  /// offline/pending_op_adoption.dart.
  bool _settling = false;

  /// True once the technician has actually CHANGED a result in this State — i.e. the
  /// checklist on screen is no longer the checklist any queued op carries.
  ///
  /// It records what dropping [_opId] in [_setResult] MEANT, because the null alone
  /// cannot say it: [_opId] is null both after a real edit and when nothing has ever
  /// been submitted, and the pre-mint queue check in [_onSave] must adopt in the
  /// second case and MUST NOT in the first — adopting an op whose payload the user
  /// has since replaced would re-drain the OLD results and silently discard the edit.
  bool _edited = false;

  @override
  void initState() {
    super.initState();
    if (widget.workOrderId != null) {
      _settling = true;
      unawaited(_resumeQueued());
      unawaited(_load());
    } else {
      _loaded = true;
    }
  }

  /// The (a) on-mount trigger, plus the rehydration that makes [_opId] survive an
  /// app kill (B-330), in the order B-341 requires.
  ///
  /// THE QUEUE READ RUNS FIRST and the CTA is quiet for exactly it. A drain can only
  /// shrink what is adoptable, so reading first cannot miss anything a post-drain read
  /// would have found — and it keeps every network call OUT of the window the user is
  /// waiting on (pending_op_adoption.dart). It needs nothing from [_load], which runs
  /// in parallel: this screen's anchor is a widget parameter, and unlike pm-notes
  /// seeding its results fires no listener that could clear a just-adopted id.
  ///
  /// The drain then runs, and [_reconcile] takes the card back down if it resolved the
  /// very write the card was about.
  Future<void> _resumeQueued() async {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    final String? adopted = await _settleQueue(woId);
    await widget.repo.drain();
    if (adopted != null) await _reconcile(woId, adopted);
  }

  /// The queue read the CTA waits on. Returns the adopted op id, or null.
  Future<String?> _settleQueue(String woId) async {
    try {
      final SyncOperation? mine = findAdoptableOp(
        await widget.repo.due(),
        pmChecklistOpIdentity(woId),
      );
      // [_edited] is checked AFTER the read, and that is the whole point of
      // checking it here at all (B-330 F1 case A). B-341 quietens the CTA for this
      // window, but it does not quieten the CHECKLIST: the technician can set a
      // result throughout it, and this adoption lands after he does. Overwriting
      // that sends the next save down the `tracked != null` branch, which re-drains
      // the OLD results — the result he just set never leaves the device while the
      // screen reports the write as handled. The rule is not new: [_onSave] already
      // refuses to adopt after an edit, for exactly this reason. This is the same
      // rule at the OTHER place that adopts.
      if (mine == null || !mounted || _edited) return null;
      setState(() {
        _opId = mine.id;
        // Only a still-replayable op is adoptable (findAdoptableOp), and that is
        // precisely what `queued` means: captured, not confirmed.
        _state = PmChecklistSaveState.queued;
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
  /// technician has acted (a save, or an edit that drops the id): their flow owns
  /// `_state` and `_opId` from that point.
  Future<void> _reconcile(String woId, String adopted) async {
    if (!_stillShowing(adopted)) return;
    final SyncOperation? still = findAdoptableOp(
      await widget.repo.due(),
      pmChecklistOpIdentity(woId),
    );
    // At most one op per identity is adoptable at a time (the B-330 invariant), so a
    // non-null answer is the same checklist write, still outstanding.
    if (still != null || !_stillShowing(adopted)) return;
    setState(() {
      _opId = null;
      _state = PmChecklistSaveState.idle;
    });
  }

  /// True while the screen is still showing exactly what [_settleQueue] adopted.
  bool _stillShowing(String adopted) =>
      mounted && _opId == adopted && _state == PmChecklistSaveState.queued;

  Future<void> _load() async {
    final String id = widget.workOrderId!;
    try {
      final List<PmChecklistEnt> rows = await widget.repo.listWorkOrders();
      final PmChecklistEnt? wo = findWorkOrder(rows, id);
      if (!mounted) return;
      setState(() {
        // A work order the read did not return is not an empty checklist — it is
        // an unknown one. Say so rather than showing a bare "no checks" screen.
        _loadFailed = wo == null;
        _items = wo == null ? null : parseChecklistItems(wo['items']);
        _loaded = true;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loadFailed = true;
        _loaded = true;
      });
    }
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// Generate a fresh client idempotency key (uuid-free — no package), the same
  /// scheme pm-checkin uses.
  String _newOpId() =>
      'pm-checklist-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  /// Set line [index]'s result (mobile-pm.jsx L137: each toggle assigns its own
  /// value — the prototype's `cycle` helper is never called).
  ///
  /// Editing after a resolved/unresolved save returns the screen to [idle] and
  /// drops the old op id: the payload changed, so the next save is a NEW write, not
  /// a retry of the old one.
  void _setResult(int index, PmCheckResult result) {
    final List<PmChecklistItem>? items = _items;
    if (items == null || _state == PmChecklistSaveState.saving) return;
    setState(() {
      _items = <PmChecklistItem>[
        for (int i = 0; i < items.length; i++)
          i == index ? items[i].withResult(result) : items[i],
      ];
      _state = PmChecklistSaveState.idle;
      _opId = null;
      // Remember WHY the id was dropped, so the pre-mint check in [_onSave] does not
      // hand it straight back and re-drain the results this edit just replaced.
      _edited = true;
    });
  }

  /// The sticky CTA. With no unresolved op it enqueues the whole items array and
  /// drains; with one already queued/failed it re-drains the SAME op (a manual
  /// retry) — never a second enqueue.
  Future<void> _onSave() async {
    final String? woId = widget.workOrderId;
    final List<PmChecklistItem>? items = _items;
    if (woId == null || items == null || items.isEmpty) return;
    if (_state == PmChecklistSaveState.saving) return;
    // The CTA is already rendered quiet for this window ([_actionBar]); this is the
    // same refusal at the handler, so a tap delivered against a stale frame cannot
    // slip past it either (B-341).
    if (_settling) return;

    // Flipped SYNCHRONOUSLY before the first await, so the CTA is already disabled
    // when a second tap could otherwise arrive during the queue read.
    setState(() => _state = PmChecklistSaveState.saving);

    final String? tracked = _opId;
    if (tracked != null) {
      final DrainReport report = await widget.repo.drain();
      await _resolve(tracked, report);
      return;
    }

    // About to MINT a key — so ask the QUEUE rather than trust this State's null
    // (B-330). That null also covers the whole on-mount drain, during which this CTA
    // is live and a checklist write of this work order's may already be queued;
    // minting there enqueues a SECOND op under a SECOND key.
    //
    // Skipped after a real edit: [_edited] says the results on screen are no longer
    // the ones the queued op carries, so that op is not this write and adopting it
    // would send the OLD results and drop what the technician just changed.
    if (!_edited) {
      final SyncOperation? already = findAdoptableOp(
        await widget.repo.due(),
        pmChecklistOpIdentity(woId),
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
    final DrainReport report = await widget.repo.saveChecklist(
      workOrderId: woId,
      opId: opId,
      items: checklistPayload(items),
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<dynamic> due = await widget.repo.due();
    final PmChecklistSaveState next = resolveChecklistSaveState(
      opId,
      report,
      due.cast(),
    );
    if (!mounted) return;
    setState(() {
      _state = next;
      // A durable success closes the op out; a queued/failed op stays addressable
      // so the CTA can retry exactly it.
      if (next == PmChecklistSaveState.saved) _opId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final List<PmChecklistItem> items = _items ?? const <PmChecklistItem>[];
    final bool hasItems = items.isNotEmpty;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _progressLabel(items),
            title: _tp('title'),
            leading: _backButton(),
          ),
          Expanded(child: _body(items)),
          if (hasItems) _actionBar(),
        ],
      ),
    );
  }

  /// The header eyebrow (mobile-pm.jsx L105, the "checked ${done}/${items.length}"
  /// template):
  /// the checked count over the real number of stored lines. With no work order /
  /// no readable checklist there is nothing to count → an honest em-dash instead of
  /// a fabricated "0/5".
  String _progressLabel(List<PmChecklistItem> items) {
    if (items.isEmpty) return _dash;
    return JuneflowI18n.format(_tp('progress'), <String, Object?>{
      'n': checkedCount(items),
      'count': items.length,
    });
  }

  /// A 34px round back button (mobile-pm.jsx L106 — surface-3 circle + chevL;
  /// the prototype returns to pm-checkin, which is exactly what popping does).
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

  Widget _body(List<PmChecklistItem> items) {
    if (!_loaded) return const SizedBox.shrink();
    if (widget.workOrderId == null || _loadFailed) return _empty();
    if (items.isEmpty) return _emptyChecklist();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        for (int i = 0; i < items.length; i++) _itemCard(i, items[i]),
        if (_statusTone() case final _StatusTone tone) _statusCard(tone),
      ],
    );
  }

  /// One check line (mobile-pm.jsx L112-140): ordinal + label, the photo pair, then
  /// the result toggles.
  Widget _itemCard(int index, PmChecklistItem item) {
    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _itemHeader(index, item),
          const SizedBox(height: 9),
          _photoRow(item),
          const SizedBox(height: 9),
          _resultToggles(index, item),
        ],
      ),
    );
  }

  /// The zero-padded ordinal + the label (mobile-pm.jsx L113-116). The label is the
  /// work order's stored snapshot; a row that somehow stored none em-dashes.
  Widget _itemHeader(int index, PmChecklistItem item) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          (index + 1).toString().padLeft(2, '0'),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: JuneflowTokens.textTertiary,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            item.label.isEmpty ? _dash : item.label,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: JuneflowTokens.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  /// The before/after photo pair (mobile-pm.jsx L118-129). Both slots report the
  /// REAL stored reference — never the prototype's always-filled before slot, and
  /// never a fill derived from the result toggle.
  Widget _photoRow(PmChecklistItem item) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(child: _photoSlot(_t('photoBefore'), item.before)),
        const SizedBox(width: 8),
        Expanded(child: _photoSlot(_tp('photoAfter'), item.after)),
      ],
    );
  }

  /// One photo slot: a caption plus a 56px box that is FILLED when [reference] is a
  /// real stored photo reference and an empty dashed box otherwise. Inert — capture
  /// is not wired (see the file header); the prototype's slots are inert too.
  Widget _photoSlot(String caption, String? reference) {
    final bool filled = reference != null && reference.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          caption,
          style: const TextStyle(
            fontSize: 10,
            color: JuneflowTokens.textTertiary,
          ),
        ),
        const SizedBox(height: 3),
        SizedBox(
          height: 56,
          child: filled
              ? Container(
                  decoration: BoxDecoration(
                    color: JuneflowTokens.brandSoft,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.photo,
                    size: 16,
                    color: JuneflowTokens.brandPrimary,
                  ),
                )
              : const CustomPaint(
                  painter: _DashedBoxPainter(),
                  child: Center(
                    child: Icon(
                      Icons.add,
                      size: 16,
                      color: JuneflowTokens.textTertiary,
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  /// The result toggles (mobile-pm.jsx L134-139): `MPM_RESULTS.slice(1)` in a
  /// 2-column grid, so normal/adjust sit on the first row and repair below-left.
  Widget _resultToggles(int index, PmChecklistItem item) {
    Widget cell(PmCheckResult r) =>
        Expanded(child: _resultButton(index, item, r));
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            cell(kPmSelectableResults[0]),
            const SizedBox(width: 5),
            cell(kPmSelectableResults[1]),
          ],
        ),
        const SizedBox(height: 5),
        Row(
          children: <Widget>[
            cell(kPmSelectableResults[2]),
            const SizedBox(width: 5),
            const Spacer(),
          ],
        ),
      ],
    );
  }

  Widget _resultButton(int index, PmChecklistItem item, PmCheckResult result) {
    final bool selected = item.result == result;
    final (Color fg, Color soft) = _resultTone(result);
    return GestureDetector(
      onTap: () => _setResult(index, result),
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? soft : JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(7),
          border: Border.all(
            color: selected ? fg : JuneflowTokens.surfaceBorder,
            width: 1.5,
          ),
        ),
        child: Text(
          _resultLabel(result),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: selected ? fg : JuneflowTokens.textSecondary,
          ),
        ),
      ),
    );
  }

  /// Token pair per result (mobile-pm.jsx L94-96: ok / info / danger + their soft
  /// tints). `none` never reaches a button (it is not in kPmSelectableResults).
  (Color, Color) _resultTone(PmCheckResult r) => switch (r) {
    PmCheckResult.normal => (
      JuneflowTokens.statusOkFg,
      JuneflowTokens.statusOkSoft,
    ),
    PmCheckResult.adjust => (
      JuneflowTokens.statusInfoFg,
      JuneflowTokens.statusInfoSoft,
    ),
    PmCheckResult.repair => (
      JuneflowTokens.statusDangerFg,
      JuneflowTokens.statusDangerSoft,
    ),
    PmCheckResult.none => (
      JuneflowTokens.textTertiary,
      JuneflowTokens.surfaceMuted,
    ),
  };

  String _resultLabel(PmCheckResult r) => switch (r) {
    PmCheckResult.normal => _tp('resultNormal'),
    PmCheckResult.adjust => _tp('resultAdjust'),
    PmCheckResult.repair => _tp('resultRepair'),
    PmCheckResult.none => _dash,
  };

  /// The tone of the current honest save status, or null when there is nothing to
  /// show yet (idle / saving).
  _StatusTone? _statusTone() {
    switch (_state) {
      case PmChecklistSaveState.saved:
        return _StatusTone(
          fg: JuneflowTokens.statusOkFg,
          bg: JuneflowTokens.statusOkSoft,
          icon: Icons.check_circle,
          text: _t('saved'),
        );
      case PmChecklistSaveState.queued:
        return _StatusTone(
          fg: JuneflowTokens.statusWarnFg,
          bg: JuneflowTokens.statusWarnSoft,
          icon: Icons.sync,
          text: _t('queued'),
        );
      case PmChecklistSaveState.failed:
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.error_outline,
          text: _t('failed'),
        );
      case PmChecklistSaveState.idle:
      case PmChecklistSaveState.saving:
        return null;
    }
  }

  /// The honest status card. The prototype has no notion of any of these states —
  /// its CTA just navigates — so they follow the pm-checkin precedent (B-268 a):
  /// a queued write is shown as SAVED-NOT-CONFIRMED, never as a success.
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

  /// Push the maintenance-log screen for this work order (mobile-pm.jsx L141:
  /// `setScreen("pm-notes")`), carrying the REAL work-order id — the same
  /// Navigator.push seam pm-checkin uses to reach this screen.
  void _openNotes() {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => PmNotesScreenHost(workOrderId: woId),
      ),
    );
  }

  /// The sticky bottom bar (mobile-pm.jsx L140-142). Idle/queued/failed → the save
  /// action (enqueue + drain, or re-drain the same op on a retry). While saving it
  /// is disabled (a spinner). Saved → the onward affordance, which now NAVIGATES:
  /// pm-notes is built (feature/mobile-pm-notes), so this no longer has to sit
  /// honest-disabled.
  Widget _actionBar() {
    final bool saved = _state == PmChecklistSaveState.saved;
    // Quiet during the on-mount queue read as well as during a save (B-341). It wears
    // the SAME muted-fill + spinner the save already uses, which needs no new copy and
    // states the truth: the screen is working, briefly, on a local read.
    final bool busy = _state == PmChecklistSaveState.saving || _settling;
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
              onTap: _openNotes,
            )
          : _stickyButton(
              label: _tp('saveNext'),
              icon: Icons.chevron_right,
              onTap: busy ? null : _onSave,
              busy: busy,
            ),
    );
  }

  Widget _stickyButton({
    required String label,
    required IconData icon,
    required VoidCallback? onTap,
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
                  const SizedBox(width: 6),
                  Icon(
                    icon,
                    size: 18,
                    color: enabled
                        ? JuneflowTokens.shellTextStrong
                        : JuneflowTokens.textTertiary,
                  ),
                ],
              ),
      ),
    );
  }

  /// Honest-empty — a centered em-dash: no work order selected, or the work order
  /// could not be read (so its checklist is unknown, not absent).
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

  /// The work order was read and genuinely carries no checklist rows yet (it was
  /// opened without a template — pm.ts POST /pm/workorders). Says exactly that,
  /// with the existing dict copy; it never borrows a template's labels.
  Widget _emptyChecklist() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Text(
          _t('emptyChecklist'),
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.textTertiary,
          ),
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

/// The empty photo slot's 1.5px dashed rounded border (mobile-pm.jsx L124-126
/// `1.5px dashed var(--border-strong)`), token-coloured. Purely decorative.
class _DashedBoxPainter extends CustomPainter {
  const _DashedBoxPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final Paint fill = Paint()..color = JuneflowTokens.surfaceAlt;
    final RRect box = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(8),
    );
    canvas.drawRRect(box, fill);

    final Paint stroke = Paint()
      ..color = JuneflowTokens.surfaceBorderStrong
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    const double dash = 4;
    const double gap = 3;
    for (final PathMetric m in (Path()..addRRect(box)).computeMetrics()) {
      double at = 0;
      while (at < m.length) {
        final double end = (at + dash).clamp(0, m.length);
        canvas.drawPath(m.extractPath(at, end), stroke);
        at = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedBoxPainter oldDelegate) => false;
}
