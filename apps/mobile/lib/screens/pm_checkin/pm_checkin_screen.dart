// PmCheckinScreen — the mobile PM check-in, ported from pototype/mobile-pm.jsx
// MPMCheckin (L51-89). Route `pm-checkin` — reached from `pm-jobs` (a WO row →
// check-in) with the real work-order id via the Navigator.push seam, exactly like
// the inbox → PR-detail wave. money = NONE (a GPS arrival event).
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// eyebrow + title), the static map placeholder card, the service-info card
// (service-zone / SLA / contract labels), and the sticky bottom check-in button.
// Every colour / space is a generated design token (JuneflowTokens); every string
// is a DICT key
// from the sidecar or resolved via i18n.t/tf (no Thai byte in this file —
// i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype is a MOCK — a `checkedIn` boolean, a hardcoded
// lat/long + distance, and hardcoded zone/SLA/contract values. None of that is
// reproduced. This screen performs the REAL offline write:
//   - tapping check-in obtains a REAL device coordinate via GpsSource (F-1 resolved,
//     geolocator wired), then enqueues a SyncOperation (POST
//     /pm/workorders/{id}/checkin { gps: "<lat, long>" }) and drains it through the
//     level-(a) processor — the coordinate is genuine, never fabricated;
//   - it renders the honest states from the drain outcome (online-confirmed /
//     offline-queued / permanently-failed) — NEVER a fake success — plus an honest
//     "can't check in" state when no GPS fix is available (permission denied /
//     location off): NOTHING is enqueued in that case;
//   - the map shows the real coordinate once obtained (else an em-dash), over a
//     static placeholder — never the prototype's hardcoded mock coordinate;
//   - zone/SLA/contract have no server wire → honest em-dashes (never fabricated).
import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../app/gps_source.dart';
import '../../i18n/i18n.dart';
import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import '../pm_checklist/pm_checklist_screen.dart';
import 'pm_checkin_agg.dart';
import 'pm_checkin_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for a PM check-in: resolves the shared services from [AppScope],
/// loads the screen's i18n sidecar, then renders [PmCheckinScreen]. Constructed at
/// the pm-jobs push site with a REAL [workOrderId] (and the joined [assetName] for
/// the header); when the shell routes it as a bare tab there is no selection, so
/// [workOrderId] is null → an honest "no work order selected" state (the same
/// nullable-id precedent as the approve/reject hosts).
class PmCheckinScreenHost extends StatefulWidget {
  const PmCheckinScreenHost({super.key, this.workOrderId, this.assetName});

  /// The work order to check in on (path id for the checkin POST). Null when the
  /// screen is reached without a selection → honest-empty.
  final String? workOrderId;

  /// The joined asset display name the pm-jobs row already knew — shown in the
  /// header eyebrow (real wire data, never fabricated). Null → em-dash.
  final String? assetName;

  @override
  State<PmCheckinScreenHost> createState() => _PmCheckinScreenHostState();
}

class _PmCheckinScreenHostState extends State<PmCheckinScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pm_checkin');
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
          // The check-in replays through the app's ONE offline queue + drain
          // processor (AppServices.syncProcessor, B-262) over the shared Dio (auth +
          // tenant scope). Taking the shared instance rather than building a
          // processor here is what lets a queued check-in drain on app resume, not
          // only while this screen happens to be mounted.
          return PmCheckinScreen(
            repo: QueueBackedPmCheckinRepository(services.syncProcessor),
            gpsSource: services.gpsSource,
            strings: strings,
            i18n: services.i18n,
            workOrderId: widget.workOrderId,
            assetName: widget.assetName,
          );
        },
      ),
    );
  }
}

/// The check-in view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class PmCheckinScreen extends StatefulWidget {
  const PmCheckinScreen({
    super.key,
    required this.repo,
    required this.gpsSource,
    required this.strings,
    required this.i18n,
    required this.workOrderId,
    this.assetName,
  });

  final PmCheckinRepository repo;
  final GpsSource gpsSource;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? workOrderId;
  final String? assetName;

  @override
  State<PmCheckinScreen> createState() => _PmCheckinScreenState();
}

class _PmCheckinScreenState extends State<PmCheckinScreen> {
  PmCheckinState _state = PmCheckinState.idle;

  /// The stable client idempotency key for this screen's check-in.
  ///
  /// Minted on the first submit and REUSED on every later attempt, so a re-tap only
  /// ever re-drains that one op. Without B-330 a restart while the write was queued
  /// minted a fresh key and enqueued a second op, so the server saw two check-ins.
  ///
  /// A null does NOT mean "nothing of mine is queued" — only "this State is not
  /// tracking one". State is not durable and the QUEUE is, so the two disagree after
  /// an app kill — and, until [_settling] clears, before this mount's own queue read
  /// has answered. [_resumeQueued] makes the outstanding write VISIBLE; what keeps a
  /// tap from minting a second key is that [_onPrimary] asks the queue itself before
  /// minting, and that no tap is possible before the read lands (B-341).
  String? _opId;

  /// True until this mount's QUEUE READ has answered "is a check-in of mine still
  /// outstanding for this work order?" — the window the CTA is quiet for (B-341).
  ///
  /// Raised in [initState], so the very FIRST frame already renders the quiet CTA, and
  /// lowered in a `finally` so a queue read that throws opens the button rather than
  /// parking it forever. The contract, and why the window is bounded, is in
  /// offline/pending_op_adoption.dart.
  bool _settling = false;

  /// True while this mount's ADOPTION is still un-acted-upon — the single fact
  /// [_reconcile] is allowed to run on.
  ///
  /// It exists because no combination of state VALUES can carry it. The obvious
  /// substitute, `_opId == adopted && _state == queued`, is exactly where the
  /// documented manual retry lands when the check-in is still due ([_onPrimary]'s
  /// `tracked != null` branch → [_retryDrain] → [_resolve] → `resolveCheckinState`,
  /// still-due ⇒ `queued`), so that tuple is reachable BOTH from an untouched mount
  /// adoption AND from a technician who re-tapped. `_state` is cyclic; this is
  /// monotonic — raised once at adoption, lowered at the first tap and never raised
  /// again — which is the only shape that can distinguish "nobody has touched this"
  /// from "touched, and it came back to the same value".
  /// See offline/pending_op_adoption.dart.
  bool _reconcileArmed = false;

  /// The honest client submit time, shown in the confirmed state (the server's
  /// ActionOk carries no timestamp — pm.ts workOrderWire).
  ///
  /// Also seeded from an ADOPTED op's `createdAt` ([_settleQueue]), which is the same
  /// instant this field would otherwise hold: [_acquireAndSubmit] passes the very
  /// `now` it stores here as the op's `createdAt`. That matters because a restart
  /// leaves this null while the queue still holds the check-in, and the confirmed card
  /// falls back to `DateTime.now()` — which would caption a check-in made at 08:03 with
  /// the time the network happened to come back.
  DateTime? _submitTime;

  /// The REAL device coordinate obtained for this check-in ("<lat>, <long>"), shown
  /// in the map caption. Null until a fix is obtained (or when it is unavailable).
  String? _gpsFix;

  @override
  void initState() {
    super.initState();
    if (widget.workOrderId != null) {
      _settling = true;
      unawaited(_resumeQueued());
    }
  }

  /// The (a) on-mount trigger, plus the rehydration that makes [_opId] survive an
  /// app kill (B-330), in the order B-341 requires.
  ///
  /// THE QUEUE READ RUNS FIRST and the CTA is quiet for exactly it. A drain can only
  /// shrink what is adoptable, so reading first cannot miss anything a post-drain read
  /// would have found — and it keeps every network call OUT of the window the user is
  /// waiting on (pending_op_adoption.dart). A check-in pending for this work order is
  /// one this device captured and the server has not accepted, so the screen takes its
  /// id back and says so instead of showing a clean slate.
  ///
  /// The drain then runs, and [_reconcile] reports what it did to the very check-in the
  /// card is about — using the drain's OWN report, so a success and a dead-letter are
  /// told apart rather than both reading as "no longer adoptable".
  Future<void> _resumeQueued() async {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    final String? adopted = await _settleQueue(woId);
    final DrainReport report = await widget.repo.drain();
    if (adopted != null) await _reconcile(adopted, report);
  }

  /// The queue read the CTA waits on. Returns the adopted op id, or null.
  Future<String?> _settleQueue(String woId) async {
    try {
      final SyncOperation? mine = findAdoptableOp(
        await widget.repo.due(),
        pmCheckinOpIdentity(woId),
      );
      if (mine == null || !mounted) return null;
      setState(() {
        _opId = mine.id;
        // Only a still-replayable op is adoptable (findAdoptableOp), and that is
        // precisely what `queued` means: captured, not confirmed.
        _state = PmCheckinState.queued;
        // WHEN the technician checked in, taken from the op itself. It is the same
        // instant the live path stores (`_acquireAndSubmit` passes its `now` as the
        // op's `createdAt`), so the confirmed caption reads the same whether this
        // check-in was accepted on the first attempt or on a replay days later —
        // rather than falling back to `DateTime.now()` and captioning it with the
        // moment the signal returned.
        _submitTime = mine.createdAt;
        // Raised in the SAME setState as the adoption, and there is no await between
        // it and the `finally` below that opens the CTA — so the latch is up before
        // any tap can be accepted, and every accepted tap is therefore able to lower
        // it.
        _reconcileArmed = true;
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

  /// Say what the drain actually did to the check-in the card is about.
  ///
  /// Adopting before the drain is what bounds the quiet window; the cost is that the
  /// card can outlive its subject by one round trip. This pays it back by running the
  /// SCREEN'S OWN [_resolve] over the drain's own [report] — the identical path a
  /// manual retry takes — so the reconciliation cannot drift from it and cannot invent
  /// an outcome of its own:
  ///
  ///   * synced        → `confirmed`: the green card, captioned with the time the
  ///                     check-in was CAPTURED (seeded in [_settleQueue]), and the CTA
  ///                     becomes the onward checklist affordance.
  ///   * dead-lettered → `failed`, the danger card. A permanent 4xx is the OPPOSITE of
  ///                     a success and must never be reported as one.
  ///   * still due     → `queued`, unchanged: the card stands.
  ///
  /// It never returns the screen to `idle`. `idle` is the state with NOTHING enqueued,
  /// so on a check-in the server ACCEPTED it states that the write never happened —
  /// and it leaves a live CTA with `_opId` null over an empty queue, which mints a
  /// SECOND key and records a SECOND check-in.
  ///
  /// Runs at most once, and only while [_reconcileArmed]: after a tap the technician's
  /// flow owns the outcome.
  Future<void> _reconcile(String adopted, DrainReport report) async {
    if (!mounted || !_reconcileArmed || _opId != adopted) return;
    _reconcileArmed = false;
    // Flipped SYNCHRONOUSLY, before [_resolve]'s first await, exactly as every tap
    // path here does: it is what stops a tap arriving DURING the resolve from opening
    // a second one over the same op (`_onPrimary` refuses while `submitting`). The
    // window is one local queue read, and the CTA already renders `submitting` as the
    // same spinner — no new state, no new copy.
    setState(() => _state = PmCheckinState.submitting);
    await _resolve(adopted, report);
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);

  /// Generate a fresh client idempotency key (uuid-free — no package). Time + a
  /// random component makes a collision between two of the device's own check-ins
  /// vanishingly unlikely.
  String _newOpId() =>
      'pm-checkin-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  /// The primary tap. Before any write exists ([_opId] null: idle / gpsUnavailable)
  /// it acquires a REAL coordinate then enqueues + drains — or, when no fix is
  /// available, lands on the honest [PmCheckinState.gpsUnavailable] with NOTHING
  /// enqueued. Once a write exists (queued / failed) the tap re-drains the SAME op
  /// (a manual retry) with the coordinate it already carries — never a second
  /// enqueue, never a re-acquired coordinate.
  Future<void> _onPrimary() async {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    if (_state == PmCheckinState.acquiringGps ||
        _state == PmCheckinState.submitting) {
      return;
    }
    // The CTA is already rendered quiet for this window ([_actionBar]); this is the
    // same refusal at the handler, so a tap delivered against a stale frame cannot
    // slip past it either (B-341).
    if (_settling) return;
    // The technician has acted, so the mount's reconciliation retires here — before
    // any await, and whatever this tap goes on to do. From now on THIS flow owns
    // `_state` and `_opId`. Lowered at the accepted tap rather than at the refused
    // one: the latch is raised inside the settle that the `_settling` guard above is
    // still refusing for, so anything earlier would lower a latch that is not up yet.
    _reconcileArmed = false;

    final String? tracked = _opId;
    if (tracked != null) {
      await _retryDrain(tracked);
      return;
    }

    // Flipped SYNCHRONOUSLY before the queue read below, so the CTA is already
    // disabled when a second tap could otherwise arrive during it. `submitting` and
    // `acquiringGps` are the same `busy` to every reader of this state.
    setState(() => _state = PmCheckinState.submitting);

    // About to MINT a key — so ask the QUEUE rather than trust this State's null
    // (B-330). That null also covers the whole on-mount drain, during which this CTA
    // is live and a check-in of this work order's may already be queued; minting
    // there enqueues a SECOND op under a SECOND key and the server records two
    // check-ins. Re-draining the adopted op is a no-op while the outer drain is still
    // running (re-entrancy guard) — which is right: it is already replaying it.
    final SyncOperation? already = findAdoptableOp(
      await widget.repo.due(),
      pmCheckinOpIdentity(woId),
    );
    if (!mounted) return;
    if (already != null) {
      // No coordinate is acquired or shown for an adopted op: the op carries the fix
      // it was captured with, and a freshly-acquired one would not be what was sent.
      setState(() => _opId = already.id);
      await _retryDrain(already.id);
      return;
    }

    await _acquireAndSubmit(woId);
  }

  /// Acquire a real fix, then enqueue + drain. No fix → honest gpsUnavailable (no
  /// enqueue). A fabricated coordinate is NEVER sent.
  Future<void> _acquireAndSubmit(String woId) async {
    setState(() => _state = PmCheckinState.acquiringGps);
    final String? fix = await widget.gpsSource.currentFix();
    if (!mounted) return;
    if (fix == null) {
      setState(() {
        _gpsFix = null;
        _state = PmCheckinState.gpsUnavailable;
      });
      return;
    }

    final String opId = _opId = _newOpId();
    final DateTime now = DateTime.now();
    _submitTime = now;
    setState(() {
      _gpsFix = fix;
      _state = PmCheckinState.submitting;
    });
    final DrainReport report = await widget.repo.submitCheckin(
      workOrderId: woId,
      opId: opId,
      gps: fix,
      now: now,
    );
    await _resolve(opId, report);
  }

  /// Re-drain an already-enqueued op (manual retry) — same coordinate, no re-acquire.
  Future<void> _retryDrain(String opId) async {
    setState(() => _state = PmCheckinState.submitting);
    final DrainReport report = await widget.repo.drain();
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<dynamic> due = await widget.repo.due();
    final PmCheckinState next = resolveCheckinState(opId, report, due.cast());
    if (mounted) setState(() => _state = next);
  }

  @override
  Widget build(BuildContext context) {
    final bool hasWo = widget.workOrderId != null;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: hasWo ? (widget.assetName ?? _dash) : _dash,
            title: _t('title'),
            leading: _backButton(),
          ),
          Expanded(child: hasWo ? _body() : _empty()),
          if (hasWo) _actionBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-pm.jsx L57 — surface-3 circle + chevL).
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

  Widget _body() {
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        _mapCard(),
        _serviceCard(),
        if (_statusTone() case final _StatusTone tone) _statusCard(tone),
      ],
    );
  }

  /// The map card (mobile-pm.jsx L60-68): a static placeholder (muted surface + a
  /// faint grid + a location pin, all design tokens) with a caption showing the REAL
  /// device coordinate once obtained, or an em-dash otherwise. The prototype's
  /// hardcoded GPS coordinate + distance are mock and are NOT reproduced (§0 rule 3);
  /// the caption never shows a fabricated position.
  Widget _mapCard() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      height: 200,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Stack(
        children: <Widget>[
          const Positioned.fill(
            child: CustomPaint(
              painter: _MapGridPainter(),
              child: Center(
                child: Icon(
                  Icons.place,
                  size: 36,
                  color: JuneflowTokens.brandPrimary,
                ),
              ),
            ),
          ),
          Positioned(left: 10, right: 10, bottom: 10, child: _gpsCaption()),
        ],
      ),
    );
  }

  /// The map caption: the GPS label + the REAL coordinate ("<lat>, <long>") once
  /// obtained, or an em-dash (idle / acquiring / unavailable) — the honest signal
  /// that no fix is in hand, never a fabricated coordinate.
  Widget _gpsCaption() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: <Widget>[
          Text(
            _t('gpsLabel'),
            style: const TextStyle(
              fontSize: 11,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _gpsFix ?? _dash,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: JuneflowTokens.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The service-info card (mobile-pm.jsx L69-73): zone / SLA / contract labels with
  /// honest em-dash values — the real WO wire carries none of these (pm_checkin_agg
  /// .deriveServiceInfo), so nothing is fabricated.
  Widget _serviceCard() {
    final PmServiceInfo info = deriveServiceInfo(null);
    return MSection(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _infoRow(_t('serviceZone'), info.zone),
          const SizedBox(height: 8),
          _infoRow(_t('sla'), info.sla),
          const SizedBox(height: 8),
          _infoRow(_t('contractRef'), info.contract),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String? value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            color: JuneflowTokens.textTertiary,
          ),
        ),
        const Spacer(),
        Text(
          (value == null || value.isEmpty) ? _dash : value,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.textPrimary,
          ),
        ),
      ],
    );
  }

  /// The tone (colours + icon + text) of the current honest status, or null when
  /// there is nothing to show yet (idle / submitting).
  _StatusTone? _statusTone() {
    switch (_state) {
      case PmCheckinState.confirmed:
        final String time = formatCheckinTime(_submitTime ?? DateTime.now());
        return _StatusTone(
          fg: JuneflowTokens.statusOkFg,
          bg: JuneflowTokens.statusOkSoft,
          icon: Icons.check_circle,
          text: widget.i18n.tf(widget.strings['successAt'], <String, Object?>{
            'time': time,
          }),
        );
      case PmCheckinState.queued:
        return _StatusTone(
          fg: JuneflowTokens.statusWarnFg,
          bg: JuneflowTokens.statusWarnSoft,
          icon: Icons.sync,
          text: _t('queued'),
        );
      case PmCheckinState.failed:
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.error_outline,
          text: _t('failed'),
        );
      case PmCheckinState.gpsUnavailable:
        // No location fix. Reuse the generic action-failed + retry copy (zero-mint —
        // no location-specific key exists); the em-dash GPS caption above surfaces
        // the real reason (no coordinate). Distinct icon (location-off).
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.location_off,
          text: _t('failed'),
        );
      case PmCheckinState.idle:
      case PmCheckinState.acquiringGps:
      case PmCheckinState.submitting:
        return null;
    }
  }

  /// The honest status card (mobile-pm.jsx L74-78 shows only the success variant;
  /// the queued + failed variants are the honest offline-write states the mock has
  /// no notion of — see the sidecar `_source`).
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

  /// Push the checklist screen for this work order (mobile-pm.jsx L86:
  /// `setScreen("pm-checklist")`), carrying the REAL work-order id — the same
  /// Navigator.push seam pm-jobs uses to reach this screen.
  void _openChecklist() {
    final String? woId = widget.workOrderId;
    if (woId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => PmChecklistScreenHost(workOrderId: woId),
      ),
    );
  }

  /// The sticky bottom bar (mobile-pm.jsx L80-86). Idle/queued/failed/gpsUnavailable
  /// → the check-in action (acquire a fix then enqueue, or re-drain a manual retry).
  /// While acquiring / submitting it is disabled (a spinner). Confirmed → the onward
  /// checklist affordance, which now NAVIGATES: pm-checklist is built
  /// (feature/mobile-pm-checklist), so this no longer has to sit honest-disabled.
  Widget _actionBar() {
    final bool confirmed = _state == PmCheckinState.confirmed;
    // Quiet during the on-mount queue read as well as while acquiring/submitting
    // (B-341). It wears the SAME muted-fill + spinner those already use, which needs
    // no new copy and states the truth: the screen is working, briefly, on a local
    // read.
    final bool busy =
        _state == PmCheckinState.acquiringGps ||
        _state == PmCheckinState.submitting ||
        _settling;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: confirmed
          ? _stickyButton(
              label: _t('checklistNext'),
              icon: Icons.chevron_right,
              onTap: _openChecklist,
            )
          : _stickyButton(
              label: _t('checkinBtn'),
              icon: Icons.place,
              onTap: busy ? null : _onPrimary,
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
                  Icon(
                    icon,
                    size: 18,
                    color: enabled
                        ? JuneflowTokens.shellTextStrong
                        : JuneflowTokens.textTertiary,
                  ),
                  const SizedBox(width: 6),
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
                ],
              ),
      ),
    );
  }

  /// Honest-empty — a centered em-dash (no work order selected), no invented copy.
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

/// A faint grid behind the map placeholder pin (mobile-pm.jsx L61 grid overlay).
/// Purely decorative, token-coloured; draws no coordinate/label of any kind.
class _MapGridPainter extends CustomPainter {
  const _MapGridPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = JuneflowTokens.surfaceBorder
      ..strokeWidth = 1;
    const double step = 26;
    for (double x = 0; x <= size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y <= size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _MapGridPainter oldDelegate) => false;
}
