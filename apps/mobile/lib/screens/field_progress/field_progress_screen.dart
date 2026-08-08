// FieldProgressScreen — the mobile work-period delivery screen, ported from
// pototype/mobile-screens.jsx MFieldProgress (L316-358). Route `field-progress`
// (mobile_routes.dart; MobileSection.field). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (34px round
// surface-3 back chevron · eyebrow · title, L319-320), the stacked MSection cards
// over the surface background, and the sticky bottom bar (L351-355). Every
// colour/space is a generated design token (JuneflowTokens); every string is a key
// from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3) — what the prototype fakes and this screen does NOT:
//   - the contractor + work lines (L323-324) are hardcoded. Here the contractor is
//     the contract's REAL vendor_id joined to GET /vendors (the merged st_grlist
//     join); unresolved → em-dash. The WORK line has no wire at all — subcon_contract
//     has no scope/description column (contractWire: id, no, vendor_id, project_id,
//     value, currency_code, retention_pct, start, end) — so its label is kept and its
//     value is an em-dash;
//   - ⚠ THE PERCENTAGE (L328-331 the bar + the big "78%", L334 the two delta
//     lines beneath it) IS WITHHELD. A work period carries a STATUS, not a completion percentage, and its
//     `pct` column is the period's TARGET share of the contract under the percent
//     basis — not how much of it is done. Nor is a percentage derived from the count
//     of delivered periods: periods are deliberately unequal in size (that is what
//     the four bases MEAN), so a fraction of periods is not a fraction of work and
//     the two halves would not come from the same population. The bar and both delta
//     lines are dropped, the number is an em-dash, and what renders in their place is
//     the period's REAL `status`. field_progress_agg.dart states the rule in full;
//     BLOCKERS.md B-297 files it;
//   - the photo grid (L337-346) is DROPPED. It is five CSS gradients in the
//     prototype, and here there is nothing behind it in either direction: the mobile
//     app has no image picker or upload seam, and GET /subcon-contracts/{id}/periods
//     does not return the period's acceptance, so no existing photo can be read
//     either. A section that can neither show a real photo nor accept one is an
//     affordance with nothing behind it — dropped, not em-dashed, and recorded in
//     B-297;
//   - the note section (L347-349) is DROPPED for the same kind of reason: neither
//     work_period nor acceptance has a note/remark column anywhere in the schema, so
//     an em-dashed "note" would imply a note exists and is merely unknown. It does
//     not exist;
//   - the CTA (L352-354) prints a hardcoded money amount and is wired to nothing.
//     The amount is dropped — money = SERVER, and the payable of a period is computed
//     server-side inside a different action (POST /periods/{id}/approve-payment).
//     The label names what the button actually does: `wo.form.deliverWork`, the REAL
//     POST /periods/{id}/deliver.
//
// SUBJECT RESOLUTION (a disclosed deviation, B-297). The prototype's header pins one
// contract and one period from mock data (L319 — a hardcoded doc number and period
// ordinal in the eyebrow), and the shell
// has no route-param mechanism. Rather than ship a screen that can never address a
// real period, a bare tab route lists the tenant's REAL contracts (GET
// /subcon-contracts) and tapping one loads ITS periods; the push seam still accepts a
// [contractId] directly. Nothing is pre-selected on the client's behalf — picking
// "the first contract" would be inventing the foreman's intent.
//
// The write is the REAL POST /periods/{id}/deliver, captured through the level-(a)
// offline queue (field_progress_repository.dart — read its header for the replay
// argument). Honest states follow the pm-checkin / pm-checklist / pm-notes precedent
// and BLOCKERS.md B-268 option (a): a `deferred` outcome is shown as QUEUED
// (captured, not confirmed), a 4xx as FAILED, never a fake success.
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
import 'field_progress_agg.dart';
import 'field_progress_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `field-progress`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [FieldProgressScreen].
class FieldProgressScreenHost extends StatefulWidget {
  const FieldProgressScreenHost({super.key, this.contractId});

  /// The contract whose periods are delivered. Null when the screen is reached
  /// without a selection → the contract list (see the file header).
  final String? contractId;

  @override
  State<FieldProgressScreenHost> createState() =>
      _FieldProgressScreenHostState();
}

class _FieldProgressScreenHostState extends State<FieldProgressScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('field_progress');
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
          // The delivery replays through the shared offline queue
          // (services.syncQueue) via the level-(a) processor over the shared Dio
          // (auth + tenant scope); the reads go straight to that same Dio.
          final QueueDrainProcessor processor = QueueDrainProcessor(
            services.syncQueue,
            DioSyncApiClient(services.dio),
          );
          return FieldProgressScreen(
            repo: DioFieldProgressRepository(services.dio, processor),
            strings: strings,
            i18n: services.i18n,
            contractId: widget.contractId,
          );
        },
      ),
    );
  }
}

/// The delivery view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class FieldProgressScreen extends StatefulWidget {
  const FieldProgressScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.contractId,
  });

  final FieldProgressRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? contractId;

  @override
  State<FieldProgressScreen> createState() => _FieldProgressScreenState();
}

class _FieldProgressScreenState extends State<FieldProgressScreen> {
  /// The contract currently in view — the pushed one, or the one the foreman tapped.
  String? _contractId;

  /// Null until the contract list read finishes.
  List<FieldProgressContract>? _contracts;

  /// Null until the selected contract's period read finishes.
  List<FieldProgressPeriod>? _periods;

  /// Set when a read threw → the affected list is UNKNOWN (em-dash), which is NOT
  /// the same as "this contract has no periods".
  bool _loadFailed = false;

  FieldDeliverState _state = FieldDeliverState.idle;

  /// The period the outstanding op belongs to (so the state card sits on the right
  /// row and a retry addresses exactly that period).
  String? _pendingPeriodId;

  /// The stable client key of the op awaiting resolution.
  ///
  /// Reused on every later attempt — including after an app kill, because
  /// [_resumeQueued] re-adopts the id of a delivery still pending in the DURABLE
  /// queue for a period this screen is showing (B-330).
  ///
  /// It is ONE slot, and unlike the pm-* screens this screen has MANY anchors on view
  /// at once, so the slot is not by itself a trustworthy answer to "is this period's
  /// write already queued?" — see [_deliver], which asks the queue before minting.
  /// Null means "no op of mine is currently being tracked here".
  String? _opId;

  /// True until the QUEUE READ for the periods now on view has answered "is a delivery
  /// of mine still outstanding?" — the window every deliver button is quiet for
  /// (B-341).
  ///
  /// Raised in [initState] AND AGAIN IN [_selectContract], which is this screen's own
  /// difference: the other five ask the question once per mount, because their anchor
  /// is fixed for the mount. Here the foreman can swap the whole set of anchors
  /// without leaving the screen, and the answer that was true for contract A says
  /// nothing about contract B — so the window re-opens with the new period list.
  /// Lowered in a `finally` so a queue read that throws opens the buttons rather than
  /// parking them forever. The contract, and why the window is bounded, is in
  /// offline/pending_op_adoption.dart.
  bool _settling = true;

  @override
  void initState() {
    super.initState();
    _contractId = widget.contractId;
    unawaited(_resumeQueued());
  }

  /// The (a) on-mount trigger, plus the rehydration that makes [_opId] survive an app
  /// kill (B-330), in the order B-341 requires.
  ///
  /// THE DRAIN NO LONGER BLOCKS THE READ. It used to be awaited first, which put an
  /// unbounded HTTP round trip (Dio sets no `connectTimeout`) in front of the period
  /// list itself: the screen was blank for the whole of it and the ONE thing B-341
  /// bounds — the quiet CTA — would have been unbounded with it. Now the drain is
  /// started immediately but awaited last, and what the buttons wait on is the load
  /// plus a LOCAL queue read. A drain can only shrink what is adoptable, so nothing is
  /// missed by reading before it (offline/pending_op_adoption.dart).
  Future<void> _resumeQueued() async {
    // Handled at construction, so a drain that throws cannot surface as an unhandled
    // async error while it sits unawaited below.
    final Future<void> drained = widget.repo.drain().then<void>(
      (DrainReport _) {},
      onError: (Object _) {},
    );
    final String? adopted = await _loadThenAdopt();
    await drained;
    if (adopted != null) await _reconcile(adopted);
  }

  /// Read this contract's periods, then adopt whichever of them already has a write
  /// waiting in the queue. Returns the adopted op id, or null.
  Future<String?> _loadThenAdopt() async {
    await _load();
    return _adoptQueued();
  }

  /// Take back the id of a delivery still pending for one of the periods ON VIEW.
  ///
  /// This screen's shape differs from the other five offline-write screens: their
  /// anchor is fixed for the whole mount (one work order, one PO, one warehouse), so
  /// their queue read needs nothing but a widget parameter. Here the anchor is one of N
  /// periods that a READ has to resolve first — and the foreman can switch contracts
  /// without leaving the screen — so adoption is deliberately tied to a completed load,
  /// and an op belonging to a period of some OTHER contract is left alone rather than
  /// raising a status bar about a row that is not on screen.
  ///
  /// Waiting on that load costs the buttons nothing they had: a deliver button is
  /// rendered PER PERIOD, so until the periods land there is no button to quieten.
  Future<String?> _adoptQueued() async {
    try {
      if (!mounted || _opId != null) return null;
      final List<FieldProgressPeriod> periods =
          _periods ?? const <FieldProgressPeriod>[];
      if (periods.isEmpty) return null;
      final ({SyncOperation op, int identityIndex})? mine =
          findAdoptableOpAmong(await widget.repo.due(), <SyncOpIdentity>[
            for (final FieldProgressPeriod p in periods)
              fieldDeliverOpIdentity(p.id),
          ]);
      if (mine == null || !mounted) return null;
      setState(() {
        _opId = mine.op.id;
        _pendingPeriodId = periods[mine.identityIndex].id;
        // Only a still-replayable op is adoptable (findAdoptableOpAmong), and that is
        // precisely what `queued` means: captured, not confirmed.
        _state = FieldDeliverState.queued;
      });
      return mine.op.id;
    } catch (_) {
      // A queue read that FAILED has answered nothing, and buttons left quiet on an
      // unanswerable question are the dead end B-341 forbids. They open; the mint site
      // asks the same queue again before it mints.
      return null;
    } finally {
      if (mounted) setState(() => _settling = false);
    }
  }

  /// Take the status bar down once the drain has resolved the delivery it described —
  /// the display cost of adopting before the drain, paid back one round trip later on
  /// exactly the state the old drain-first ordering reached. Skipped once the foreman
  /// has acted, or has switched contracts: their flow owns `_state` from that point.
  Future<void> _reconcile(String adopted) async {
    if (!_stillShowing(adopted)) return;
    final String? periodId = _pendingPeriodId;
    if (periodId == null) return;
    final SyncOperation? still = findAdoptableOp(
      await widget.repo.due(),
      fieldDeliverOpIdentity(periodId),
    );
    // At most one op per identity is adoptable at a time (the B-330 invariant), so a
    // non-null answer is the same delivery, still outstanding.
    if (still != null || !_stillShowing(adopted)) return;
    setState(() {
      _opId = null;
      _pendingPeriodId = null;
      _state = FieldDeliverState.idle;
    });
  }

  /// True while the screen is still showing exactly what [_adoptQueued] adopted.
  bool _stillShowing(String adopted) =>
      mounted && _opId == adopted && _state == FieldDeliverState.queued;

  Future<void> _load() async {
    try {
      final String? id = _contractId;
      if (id == null) {
        final List<FieldProgressEnt> rows = await widget.repo.listContracts();
        final List<FieldProgressEnt> vendors = await widget.repo.listVendors();
        if (!mounted) return;
        setState(() {
          _contracts = parseContracts(rows, vendors);
          _periods = null;
          _loadFailed = false;
        });
        return;
      }
      final List<FieldProgressEnt> rows = await widget.repo.listContracts();
      final List<FieldProgressEnt> vendors = await widget.repo.listVendors();
      final List<FieldProgressEnt> periodRows = await widget.repo.listPeriods(
        id,
      );
      if (!mounted) return;
      setState(() {
        _contracts = parseContracts(rows, vendors);
        _periods = parsePeriods(periodRows);
        _loadFailed = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loadFailed = true;
        _contracts ??= const <FieldProgressContract>[];
      });
    }
  }

  /// The contract in view, or null when none is selected / it is not in the page.
  FieldProgressContract? get _contract {
    final String? id = _contractId;
    if (id == null) return null;
    for (final FieldProgressContract c
        in _contracts ?? const <FieldProgressContract>[]) {
      if (c.id == id) return c;
    }
    return null;
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// The localized label for a work-period [status], or null → the caller renders an
  /// em-dash. NEVER the raw wire value: `pending | delivered | inspecting | passed |
  /// rejected | paid` are English machine codes and this is a Thai-only field app
  /// (§0 rule 2). The 6→4 collapse and its four EXISTING dict keys are the merged
  /// web port's own (field_progress_agg.dart statusLabelField) — nothing is minted,
  /// and an unknown status resolves to null rather than to a guessed label.
  String? _statusText(String? status) {
    final String? field = statusLabelField(status);
    return field == null ? null : _t(field);
  }

  /// Generate a fresh client key (uuid-free — no package), the same scheme
  /// pm-checkin / pm-checklist / pm-notes use.
  String _newOpId() =>
      'field-progress-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  void _selectContract(String id) {
    setState(() {
      _contractId = id;
      _periods = null;
      _loadFailed = false;
      _state = FieldDeliverState.idle;
      _opId = null;
      _pendingPeriodId = null;
      // A whole new set of anchors is on its way in, and nothing is yet known about
      // any of them — so the window re-opens exactly as it did on mount (B-341).
      // Without this, the first frame of the new contract's period list would carry
      // live deliver buttons over an unasked queue.
      _settling = true;
    });
    // Adopt again after the read: the chosen contract may be the one whose period
    // still has a write waiting in the queue (B-330).
    unawaited(_loadThenAdopt());
  }

  /// Deliver [period]. With no unresolved op it enqueues and drains; with one already
  /// queued/failed for the SAME period it re-drains that op (a manual retry) — never
  /// a second enqueue.
  Future<void> _deliver(FieldProgressPeriod period) async {
    if (_state == FieldDeliverState.sending) return;
    if (!period.deliverable) return;
    // The buttons are already rendered quiet for this window ([_deliverButton]); this
    // is the same refusal at the handler, so a tap delivered against a stale frame
    // cannot slip past it either (B-341).
    if (_settling) return;

    // Read the slot BEFORE the flip below overwrites `_pendingPeriodId`: this is the
    // question "is the op I am already tracking THIS period's?", and the answer has to
    // be taken while `_pendingPeriodId` still names the period the op belongs to.
    final String? pending = _opId;
    final bool retryThisPeriod =
        pending != null && _pendingPeriodId == period.id;

    // Flip busy SYNCHRONOUSLY, before ANY await — both fields, so the spinner lands on
    // the tapped row exactly as the branches below leave it.
    //
    // The `sending` guard at the top of this method is the ONLY thing standing between
    // two taps, and until this line nothing set `_state` before an await. That was safe
    // on dev because the mint path held no await at all: guard → mint → setState. The
    // pre-mint queue read (B-330) put a real await in FRONT of the guard's own
    // precondition — a drift/SQLite `pending()` is disk I/O — so a second tap during
    // that read would sail straight past into a SECOND enqueue of a delivery that is
    // already waiting. Offline that is two ops under two keys; online the server takes
    // the first and 409s the replay (the C3 guard at `subcon.ts:758` admits only a
    // `pending` period), which parks a permanent 4xx dead-letter every future drain
    // skips (B-330 F2) and paints the failed bar over a delivery that SUCCEEDED.
    //
    // The other four offline-write screens already flip synchronously; this one is
    // where the pre-mint pattern was copied FROM and was the last without the companion
    // guard.
    _pendingPeriodId = period.id;
    setState(() => _state = FieldDeliverState.sending);

    if (retryThisPeriod) {
      final DrainReport report = await widget.repo.drain();
      await _resolve(pending, report);
      return;
    }

    // About to mint a key. The slot above says nothing is outstanding for THIS
    // period — but the slot holds ONE op and is thrown away with the State, while
    // the queue is durable and holds ALL of them. So ask the queue, which is the
    // only thing that actually knows (B-330). Two ways the slot lies here: it was
    // never populated (fresh State after an app kill), or it is busy tracking a
    // DIFFERENT period of the same contract — delivering B after A leaves A's op
    // in the queue but not in the slot, so a second tap on A would otherwise mint
    // a second key for a write that is already waiting to be sent.
    final SyncOperation? already = findAdoptableOp(
      await widget.repo.due(),
      fieldDeliverOpIdentity(period.id),
    );
    if (already != null) {
      if (!mounted) return;
      // `_state` and `_pendingPeriodId` were already set by the synchronous flip
      // above — that is the point of it — so only the adopted id is new here.
      setState(() => _opId = already.id);
      final DrainReport report = await widget.repo.drain();
      await _resolve(already.id, report);
      return;
    }

    final String opId = _opId = _newOpId();
    final DrainReport report = await widget.repo.deliver(
      periodId: period.id,
      opId: opId,
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<dynamic> due = await widget.repo.due();
    final FieldDeliverState next = resolveDeliverState(
      opId,
      report,
      due.cast(),
    );
    if (!mounted) return;
    setState(() {
      _state = next;
      // A durable success closes the op out; a queued/failed op stays addressable so
      // the button can retry exactly it.
      if (next == FieldDeliverState.sent) _opId = null;
    });
    // A durable success changes the period's server status (pending → delivered), so
    // re-read rather than mutating the row locally.
    if (next == FieldDeliverState.sent) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final FieldProgressContract? contract = _contract;
    // L319 — the eyebrow is the contract document number + the delivering period's
    // ordinal in the prototype. Only the parts that are REAL render.
    final String sub = contract?.no ?? _dash;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(sub: sub, title: _tp('title'), leading: _backButton()),
          Expanded(child: _body()),
          if (_state != FieldDeliverState.idle) _statusBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-screens.jsx L320 — surface-3 circle + chevL).
  /// With a contract selected from the list it steps BACK to that list (the honest
  /// destination); otherwise it pops.
  Widget _backButton() {
    final bool canStepBack = _contractId != null && widget.contractId == null;
    return GestureDetector(
      onTap: () {
        if (canStepBack) {
          setState(() {
            _contractId = null;
            _periods = null;
            _state = FieldDeliverState.idle;
            _opId = null;
            _pendingPeriodId = null;
          });
          unawaited(_load());
        } else {
          Navigator.maybePop(context);
        }
      },
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

  Widget _body() {
    if (_contracts == null) return const SizedBox.shrink();
    if (_loadFailed) return _unknown();
    if (_contractId == null) return _contractList();
    return _periodView();
  }

  /// The contract picker (see the file header — a disclosed deviation, B-297).
  Widget _contractList() {
    final List<FieldProgressContract> rows =
        _contracts ?? const <FieldProgressContract>[];
    if (rows.isEmpty) return _empty();
    return ListView.builder(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) {
        final FieldProgressContract c = rows[i];
        return GestureDetector(
          onTap: () => _selectContract(c.id),
          behavior: HitTestBehavior.opaque,
          child: MSection(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  c.no ?? _dash,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: JuneflowTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                _labelledLine(_t('labelSubcon'), c.vendorName),
              ],
            ),
          ),
        );
      },
    );
  }

  /// The selected contract + its periods.
  Widget _periodView() {
    final FieldProgressContract? contract = _contract;
    final List<FieldProgressPeriod> periods =
        _periods ?? const <FieldProgressPeriod>[];
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        // mobile-screens.jsx L322-325 — contractor (REAL join) + work (no column).
        MSection(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _labelledLine(_t('labelSubcon'), contract?.vendorName),
              const SizedBox(height: 4),
              _labelledLine(_tp('labelWork'), null),
            ],
          ),
        ),
        if (_periods == null)
          const SizedBox.shrink()
        else if (periods.isEmpty)
          _empty()
        else
          for (final FieldProgressPeriod p in periods) _periodCard(p),
      ],
    );
  }

  /// One period card. Where the prototype draws a progress bar and a big percentage
  /// (L326-335) this shows the period's REAL status and an em-dash — see the header.
  Widget _periodCard(FieldProgressPeriod p) {
    final String title = p.seq == null
        ? _t('progressTitle')
        : '${_t('progressTitle')} ${_t('unitPeriod')} ${p.seq}';
    final bool busy =
        _state == FieldDeliverState.sending && _pendingPeriodId == p.id;
    return MSection(
      title: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              // The status is a WIRE enum (English machine codes). It resolves
              // through an EXISTING dict key — never printed raw — and em-dashes
              // when this build has no label for it (statusLabelField).
              Expanded(
                child: _labelledLine(_t('statusLabel'), _statusText(p.status)),
              ),
              // L331 — the percentage slot. No column backs it and no count-based
              // ratio may stand in for it (field_progress_agg.dart).
              const Text(
                _dash,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            ],
          ),
          if (p.projectName != null) ...<Widget>[
            const SizedBox(height: 4),
            // The REAL project_name the server resolved through its scoped hop
            // chain. Omitted entirely when the hop did not resolve — there is no
            // prototype slot for it to leave an em-dash in.
            Text(
              p.projectName!,
              style: const TextStyle(
                fontSize: 10.5,
                color: JuneflowTokens.textTertiary,
              ),
            ),
          ],
          if (p.deliverable) ...<Widget>[
            const SizedBox(height: 10),
            _deliverButton(p, busy),
          ],
        ],
      ),
    );
  }

  /// The prototype's sticky CTA (L351-355), rendered per deliverable period because
  /// the screen shows the contract's whole period list rather than the mock's single
  /// pre-selected one. The money on the prototype's label is dropped (money = SERVER).
  Widget _deliverButton(FieldProgressPeriod p, bool busy) {
    // Quiet until this contract's queue read has answered (B-341) — greyed exactly as
    // it already greys while another row is sending, which needs no new copy.
    final bool enabled =
        !busy && _state != FieldDeliverState.sending && !_settling;
    return GestureDetector(
      onTap: enabled ? () => _deliver(p) : null,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 44,
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
            : Text(
                _t('deliver'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: enabled
                      ? JuneflowTokens.shellTextStrong
                      : JuneflowTokens.textTertiary,
                ),
              ),
      ),
    );
  }

  /// The honest delivery status. A queued write is CAPTURED-NOT-CONFIRMED, never a
  /// success (B-268 a).
  Widget _statusBar() {
    final (Color fg, Color bg, IconData icon, String text) tone =
        switch (_state) {
          FieldDeliverState.sent => (
            JuneflowTokens.statusOkFg,
            JuneflowTokens.statusOkSoft,
            Icons.check_circle,
            _t('sent'),
          ),
          FieldDeliverState.queued => (
            JuneflowTokens.statusWarnFg,
            JuneflowTokens.statusWarnSoft,
            Icons.sync,
            _t('queued'),
          ),
          FieldDeliverState.failed => (
            JuneflowTokens.statusDangerFg,
            JuneflowTokens.statusDangerSoft,
            Icons.error_outline,
            _t('failed'),
          ),
          FieldDeliverState.idle || FieldDeliverState.sending => (
            JuneflowTokens.textTertiary,
            JuneflowTokens.surfaceCard,
            Icons.sync,
            '',
          ),
        };
    if (tone.$4.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: BoxDecoration(
        color: tone.$2,
        border: const Border(
          top: BorderSide(color: JuneflowTokens.surfaceBorder),
        ),
      ),
      child: Row(
        children: <Widget>[
          Icon(tone.$3, size: 18, color: tone.$1),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              tone.$4,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: tone.$1,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// "label: value" (L323-324), with an em-dash whenever the value has no wire.
  Widget _labelledLine(String label, String? value) {
    return Text.rich(
      TextSpan(
        text: '$label: ',
        children: <InlineSpan>[
          TextSpan(
            text: value ?? _dash,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: value == null
                  ? JuneflowTokens.textTertiary
                  : JuneflowTokens.textPrimary,
            ),
          ),
        ],
      ),
      style: const TextStyle(fontSize: 12, color: JuneflowTokens.textTertiary),
    );
  }

  /// Genuinely empty — the server returned no contracts / no periods.
  Widget _empty() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Text(
          _t('empty'),
          style: const TextStyle(
            fontSize: 13,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ),
    );
  }

  /// Unknown — a read failed, so the list is not known to be empty.
  Widget _unknown() {
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
