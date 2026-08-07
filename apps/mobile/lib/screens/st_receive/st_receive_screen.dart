// StReceiveScreen — the mobile store count-and-receive (GR) screen, ported from
// pototype/mobile-field.jsx MStReceive (L36-92). Route `st-receive`
// (mobile_routes.dart; MobileSection.field). Reached from `st-grlist` with a REAL
// po id via the Navigator.push seam, exactly like pm-jobs -> pm-checkin.
//
// money = NONE on screen (the prototype shows no currency here either) and
// money = SERVER on the write — the payload carries no price and no total. The
// reasoning, and why omission alone is what keeps a fabricated zero off the
// merged web GR list, is in st_receive_agg.dart "THE WRITE".
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (34px round
// back chevron + eyebrow + title), one card per line (name / ordered line /
// [-] count [+] stepper / delta note / attachment tile), and the sticky bottom
// confirm bar whose tone is ok-green when every line is complete and warn-amber
// when any line is short (L86). Every colour/space is a generated design token;
// every string is a key from the sidecar (no Thai byte in this file —
// .claude/hooks/i18n-guard.sh, §0 rule 2).
//
// Data (§0 rule 3): the prototype's three hardcoded lines are a mock and are
// DROPPED. Lines are the REAL GET /po/{id} -> `pr_id` -> GET /pr/{id} `items[]`
// chain, each carrying the ordered quantity the server itself closes the PO on.
//
// ---------------------------------------------------------------------------
// WITHHELD — no wire, so an em-dash (never a guess)
// ---------------------------------------------------------------------------
//   * per-line material NAME and UNIT — `prItemWire` carries neither, and the
//     BOQ fan-out that would resolve them is `1 + 1 + N` unbounded (GET /boq has
//     no project filter). BLOCKERS.md B-265; the merged web gr.list em-dashes
//     exactly this class of value.
//   * the short/over DELTA WORDS — rendered as a signed number in the
//     prototype's own colour instead. the short word has two byte-exact dict matches that
//     mean "absent" and "out of stock"; reusing either would read correctly in
//     Thai today and WRONGLY in en/zh/ar. The over word has no match anywhere. Both go
//     to the mint list rather than into a stretched key.
//
// ---------------------------------------------------------------------------
// DROPPED — the wire does not perform it, so the claim is not made at all
// ---------------------------------------------------------------------------
// BLOCKERS.md B-266. `grep -cE "stockLedger|stock_ledger|inventory|postJv|
// journal|glPost|docNumber|doc_numbering|nextNo|apBilling|ap_billing|warehouse"
// apps/api/src/routes/gr.ts` = 0.
//   1. the RECEIPT NUMBER (L52 `· GR-2569-0455`) — `gr.no` is nullable and gr.ts
//      reads it from the client body; there is no numbering call. A number could
//      only be invented here.
//   2. the stock-into-warehouse-Block-B claim (L53) — no stock movement is written AND the `gr`
//      table has no warehouse column, so the screen neither selects nor could
//      store one.
//   3. the auto-raise-the-AP-bill claim (L53) — no ap_billing insert exists.
//   4. the procurement-has-been-notified claim (L53) and its per-line echo (L76) — no
//      notification write, and structurally unreachable: the only defect path is
//      `qty_rejected > 0`, which a one-count-per-line screen cannot express.
//   5. the PHOTO TILE (L78, a camera glyph + a photo label + a tick) — the tick asserts a photo IS attached,
//      false on every line; pubspec.yaml has no camera/image package (adding one
//      is a Wei-level stack decision, the geolocator/B-260 precedent); and
//      its label has no key. Three independent reasons, so the tile is dropped
//      rather than softened.
//   The whole SUCCESS TAKEOVER (L49-56) goes with them — B-266 option 3,
//   "zero fabrication risk". Its four claims are the four above, and what would
//   survive needs the success title and the back CTA, which have no key. Since
//   B-266 is still unruled and it is the ruling that SIZES the sacred round,
//   minting them now is precisely the waste the blocker warns against. A
//   confirmed receipt instead pops back to st-grlist (both prototype back paths
//   land there anyway, L54/L61), so the state change itself is the confirmation
//   and nothing unbacked is asserted. Restoring a takeover later is additive.
//
//   The DELIVERY-NOTE tile (L79) is KEPT, inert: it is an empty dashed
//   placeholder in the prototype (no onClick), it carries a real phrase key, and
//   as an empty slot it states only "nothing is attached" — which is true.
//
// ---------------------------------------------------------------------------
// OUTCOME — three honest states (B-268 option 1, the pm-checkin precedent)
// ---------------------------------------------------------------------------
// The prototype's CTA is `onClick={() => setDone(true)}` (L86): success is
// UNCONDITIONAL. Through the at-least-once queue a 5xx/transport failure is
// `deferred` = SAVED, not CONFIRMED; showing success there would state that
// goods entered the system when nothing was posted. So: synced -> pop back;
// deferred -> stay on the counting view + a warn card; permanentlyFailed ->
// stay + a danger card. A re-tap re-drains the SAME op — never a second enqueue.
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
import 'st_receive_agg.dart';
import 'st_receive_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `st-receive`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [StReceiveScreen].
///
/// Constructed at the st-grlist push site with a REAL [poId] (and the [poNo] +
/// [vendorName] that row already resolved, for the header eyebrow). When the
/// shell routes it as a bare tab there is no selection, so [poId] is null → an
/// honest "no PO selected" state — the same nullable-id precedent as pm-checkin
/// and the approve/reject hosts.
class StReceiveScreenHost extends StatefulWidget {
  const StReceiveScreenHost({super.key, this.poId, this.poNo, this.vendorName});

  /// The PO to receive against (the write's anchor). Null → honest-empty.
  final String? poId;

  /// Real PO number the calling row already knew — header eyebrow. Null → em-dash.
  final String? poNo;

  /// Real vendor name the calling row already resolved. Null → em-dash.
  final String? vendorName;

  @override
  State<StReceiveScreenHost> createState() => _StReceiveScreenHostState();
}

class _StReceiveScreenHostState extends State<StReceiveScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('st_receive');
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
          return StReceiveScreen(
            repo: DioStReceiveRepository(services.dio, services.syncProcessor),
            strings: strings,
            i18n: services.i18n,
            poId: widget.poId,
            poNo: widget.poNo,
            vendorName: widget.vendorName,
          );
        },
      ),
    );
  }
}

/// The count-and-receive view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class StReceiveScreen extends StatefulWidget {
  const StReceiveScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.poId,
    this.poNo,
    this.vendorName,
  });

  final StReceiveRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? poId;
  final String? poNo;
  final String? vendorName;

  @override
  State<StReceiveScreen> createState() => _StReceiveScreenState();
}

class _StReceiveScreenState extends State<StReceiveScreen> {
  late Future<List<StRecvLine>> _future;

  /// Per-line counted quantities, index-aligned with the loaded lines. Seeded
  /// from the real ordered quantities (the prototype's pre-filled default) once
  /// the lines arrive.
  List<double> _counts = const <double>[];
  List<StRecvLine> _lines = const <StRecvLine>[];

  StRecvState _state = StRecvState.idle;

  /// The stable client idempotency key for this receipt.
  ///
  /// Minted on the first submit and REUSED on every later attempt, so a re-tap only
  /// ever re-drains that one op and can never post a second GR.
  ///
  /// Before B-330 this field was session-only: a restart while the receipt was still
  /// queued left it null, the next tap minted a FRESH key, and two queued ops
  /// carrying two DIFFERENT keys each wrote their own GR (and their own JV).
  /// `gr_idempotency_uq` cannot catch that — two distinct keys are legitimately two
  /// distinct receipts — so the duplicate has to be prevented here, by not minting
  /// the second key.
  ///
  /// A null does NOT mean "nothing of mine is queued". It means only "this State is
  /// not tracking one", and State is not durable while the QUEUE is, so the two
  /// disagree in two places: after an app kill, and — on a perfectly healthy network
  /// — for the whole duration of the on-mount drain, before [_resumeQueued] has come
  /// back to adopt. [_resumeQueued] narrows the gap and makes it VISIBLE; what makes
  /// it SAFE is that [_onConfirm] asks the queue itself before it mints.
  String? _opId;

  @override
  void initState() {
    super.initState();
    _future = _load();
    if (widget.poId != null) unawaited(_resumeQueued());
  }

  /// The (a) on-mount trigger, plus the rehydration that makes [_opId] survive an
  /// app kill (B-330).
  ///
  /// The drain runs FIRST and is awaited, so the online case resolves normally and
  /// leaves nothing to adopt. Whatever is STILL pending for this PO afterwards is a
  /// receipt this device captured and the server has not accepted yet, so the screen
  /// takes its id back and shows the honest queued state rather than presenting a
  /// clean slate.
  ///
  /// WHAT THIS DOES NOT CLOSE: `await drain()` is one real HTTP round trip, bounded
  /// only by the OS default (app_services.dart builds Dio with no `connectTimeout`),
  /// and the screen is fully rendered with a LIVE confirm CTA for all of it. Inside
  /// that window [_opId] is still null and no queued card is up, so this alone would
  /// still let a tap mint a second key — on a healthy network, with no app kill
  /// anywhere in the story. This is the VISIBLE half of the rehydration; the money
  /// half is the pre-mint queue check in [_onConfirm].
  Future<void> _resumeQueued() async {
    final String? poId = widget.poId;
    if (poId == null) return;
    await widget.repo.drain();
    if (!mounted) return;
    final SyncOperation? mine = findAdoptableOp(
      await widget.repo.due(),
      stReceiveOpIdentity(poId),
    );
    if (mine == null || !mounted) return;
    setState(() {
      _opId = mine.id;
      // Only a still-replayable op is adoptable (findAdoptableOp), and that is
      // precisely what `queued` means: captured, not confirmed.
      _state = StRecvState.queued;
    });
  }

  /// The real read chain: PO -> its `pr_id` -> that PR's priced lines.
  /// A PO that does not resolve, or carries no `pr_id`, yields NO lines — the
  /// screen shows its honest-empty state rather than a fabricated row.
  Future<List<StRecvLine>> _load() async {
    final String? poId = widget.poId;
    if (poId == null) return const <StRecvLine>[];
    final StRecvEnt? po = await widget.repo.loadPo(poId);
    if (po == null) return const <StRecvLine>[];
    final String? prId = prIdOfPo(po);
    if (prId == null) return const <StRecvLine>[];
    final StRecvEnt? pr = await widget.repo.loadPr(prId);
    if (pr == null) return const <StRecvLine>[];
    final List<StRecvLine> lines = parseReceiptLines(prItemsOf(pr));
    if (mounted) {
      setState(() {
        _lines = lines;
        _counts = initialCounts(lines);
      });
    }
    return lines;
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// A fresh client idempotency key (uuid-free — no package). Time + a random
  /// component makes a collision between two of the device's own receipts
  /// vanishingly unlikely.
  String _newOpId() =>
      'st-receive-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  void _adjust(int index, double delta) {
    if (index < 0 || index >= _counts.length) return;
    setState(() {
      final List<double> next = List<double>.of(_counts);
      next[index] = adjustCount(next[index], delta);
      _counts = next;
    });
  }

  /// The primary tap. With no receipt outstanding it enqueues + drains; once one
  /// exists (queued / failed) it re-drains the SAME op — a manual retry, never a
  /// second enqueue.
  Future<void> _onConfirm() async {
    final String? poId = widget.poId;
    if (poId == null || _lines.isEmpty) return;
    if (_state == StRecvState.submitting) return;
    // Flipped SYNCHRONOUSLY, before the first await below, so the CTA is already
    // disabled when a second tap could otherwise arrive during the queue read.
    setState(() => _state = StRecvState.submitting);

    final String? tracked = _opId;
    if (tracked != null) {
      await _resolve(tracked, await widget.repo.drain());
      return;
    }

    // About to MINT a key — so ask the QUEUE, which is the only thing that actually
    // knows, instead of trusting this State's null (B-330, the field-progress
    // pattern). Two ways that null lies: the State is fresh after an app kill, or
    // the on-mount drain has simply not come back yet — one whole HTTP round trip
    // during which this CTA is live. Minting in either case produces a SECOND key,
    // and `gr_idempotency_uq` correctly lets two distinct keys through as two
    // distinct receipts: two goods receipts and two journal vouchers. So the
    // duplicate has to die here, at the mint site.
    //
    // The re-drain below is a no-op while an outer drain is still running (the
    // processor's re-entrancy guard returns an empty report), which is exactly
    // right: that outer drain is already replaying this very op.
    final SyncOperation? already = findAdoptableOp(
      await widget.repo.due(),
      stReceiveOpIdentity(poId),
    );
    if (!mounted) return;
    if (already != null) {
      setState(() => _opId = already.id);
      await _resolve(already.id, await widget.repo.drain());
      return;
    }

    final String opId = _opId = _newOpId();
    final DrainReport report = await widget.repo.submitReceipt(
      poId: poId,
      counts: _counts,
      opId: opId,
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<dynamic> due = await widget.repo.due();
    final StRecvState next = resolveReceiveState(opId, report, due.cast());
    if (!mounted) return;
    setState(() => _state = next);
    // CONFIRMED: the server durably accepted the receipt. No success takeover is
    // rendered (B-266 — every claim it makes is unbacked and the surviving copy
    // has no key); the pop back to st-grlist IS the confirmation, and it is the
    // prototype's own destination from that view (L54).
    if (next == StRecvState.confirmed) Navigator.maybePop(context);
  }

  @override
  Widget build(BuildContext context) {
    final bool hasPo = widget.poId != null;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // Eyebrow (L59, the mock's PO number + vendor): the REAL PO number and
            // the REAL resolved vendor name the calling row already held. Either
            // missing → an em-dash in its place, never a placeholder document.
            sub: hasPo
                ? '${widget.poNo ?? _dash} · ${widget.vendorName ?? _dash}'
                : _dash,
            title: _tp('title'),
            leading: _backButton(),
          ),
          Expanded(
            child: hasPo
                ? FutureBuilder<List<StRecvLine>>(
                    future: _future,
                    builder:
                        (
                          BuildContext context,
                          AsyncSnapshot<List<StRecvLine>> snap,
                        ) {
                          if (snap.connectionState == ConnectionState.waiting) {
                            return const Center(
                              child: SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                            );
                          }
                          if (_lines.isEmpty) return _empty();
                          return _list();
                        },
                  )
                : _empty(),
          ),
          if (hasPo && _lines.isNotEmpty) _actionBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-field.jsx L61 — surface-3 circle + chevL).
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

  Widget _list() {
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        for (int i = 0; i < _lines.length; i++) _lineCard(i),
        if (_statusTone() case final _StatusTone tone) _statusCard(tone),
      ],
    );
  }

  /// One countable line (mobile-field.jsx L65-81).
  Widget _lineCard(int index) {
    final StRecvLine line = _lines[index];
    final double counted = index < _counts.length
        ? _counts[index]
        : line.orderedQty;
    final StRecvDelta delta = classifyDelta(counted, line.orderedQty);
    final bool short = delta == StRecvDelta.short;

    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Material name (L67 — 12.5/700). No wire on prItemWire → em-dash.
          Text(
            line.name ?? _dash,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 3),
          // Ordered line (L68, the ordered label + qty + unit) — the quantity is
          // REAL (pr_item.qty, the figure the PO closes on); the unit has no wire
          // → em-dash.
          Row(
            children: <Widget>[
              Text(
                _t('colOrdered'),
                style: const TextStyle(
                  fontSize: 11,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                formatQty(line.orderedQty),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                line.unit ?? _dash,
                style: const TextStyle(
                  fontSize: 11,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          // The stepper row (L69-75).
          Row(
            children: <Widget>[
              Text(
                _t('colReceived'),
                style: const TextStyle(
                  fontSize: 11.5,
                  color: JuneflowTokens.textSecondary,
                ),
              ),
              const SizedBox(width: 10),
              _stepButton(
                icon: Icons.remove,
                onTap: () => _adjust(index, -kStRecvStep),
              ),
              Expanded(
                child: Text(
                  formatQty(counted),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    // L73: warn while short, default otherwise.
                    color: short
                        ? JuneflowTokens.statusWarnFg
                        : JuneflowTokens.textPrimary,
                  ),
                ),
              ),
              _stepButton(
                icon: Icons.add,
                onTap: () => _adjust(index, kStRecvStep),
              ),
              const SizedBox(width: 10),
              // Unit again (L75) — no wire → em-dash.
              Text(
                line.unit ?? _dash,
                style: const TextStyle(
                  fontSize: 11,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            ],
          ),
          // The delta note (L76). The prototype's short / over words have no
          // honest key (see the file header), so only the signed quantity is
          // shown — in the prototype's own tone (warn when short, info when
          // over). A number is data; a stretched key would be a mistranslation.
          if (delta != StRecvDelta.exact) ...<Widget>[
            const SizedBox(height: 7),
            Text(
              _signedQty(counted - line.orderedQty),
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: short
                    ? JuneflowTokens.statusWarnFg
                    : JuneflowTokens.statusInfoFg,
              ),
            ),
          ],
          const SizedBox(height: 9),
          // The attachment row (L77-80). The PHOTO tile is DROPPED (its ✓ asserts
          // an attachment that never exists, there is no camera package, and
          // its label has no key — see the header). The delivery-note tile is kept
          // exactly as the prototype has it: an inert dashed placeholder, which
          // as an EMPTY slot states only that nothing is attached — true today.
          _deliveryNoteTile(),
        ],
      ),
    );
  }

  /// A signed quantity ("-40" / "+40") — ASCII sign, never a fabricated word.
  String _signedQty(double diff) =>
      diff > 0 ? '+${formatQty(diff)}' : formatQty(diff);

  Widget _stepButton({required IconData icon, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Icon(icon, size: 18, color: JuneflowTokens.textPrimary),
      ),
    );
  }

  /// The delivery-note slot (L79) — inert in the prototype (no onClick) and
  /// inert here: the app has no attachment capability, so a tappable control
  /// would invite the storekeeper to attach a note that cannot be attached.
  Widget _deliveryNoteTile() {
    return Container(
      height: 50,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: JuneflowTokens.surfaceBorderStrong),
      ),
      child: Text(
        _tp('deliveryNote'),
        style: const TextStyle(
          fontSize: 10.5,
          color: JuneflowTokens.textTertiary,
        ),
      ),
    );
  }

  /// The tone of the current honest status, or null when there is nothing to
  /// show (idle / submitting / confirmed — confirmed pops instead).
  _StatusTone? _statusTone() {
    switch (_state) {
      case StRecvState.queued:
        return _StatusTone(
          fg: JuneflowTokens.statusWarnFg,
          bg: JuneflowTokens.statusWarnSoft,
          icon: Icons.sync,
          text: _t('queued'),
        );
      case StRecvState.failed:
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.error_outline,
          text: _t('failed'),
        );
      case StRecvState.idle:
      case StRecvState.submitting:
      case StRecvState.confirmed:
        return null;
    }
  }

  /// The honest offline-write status card — copy the MOCK prototype never had
  /// (it flips straight to an unconditional success).
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

  /// The sticky bottom confirm bar (mobile-field.jsx L83-88). Tone follows the
  /// prototype: ok-green when every line is complete, warn-amber when any line is
  /// short — derived from REAL ordered-vs-counted quantities. That tone is the
  /// prototype's own second encoding of the complete-vs-short distinction its two CTA
  /// labels carry, and it is what survives here since neither label has a key.
  Widget _actionBar() {
    final bool short = anyShort(_lines, _counts);
    final bool busy = _state == StRecvState.submitting;
    final Color tone = short
        ? JuneflowTokens.statusWarnFg
        : JuneflowTokens.statusOkFg;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: GestureDetector(
        onTap: busy ? null : _onConfirm,
        behavior: HitTestBehavior.opaque,
        child: Container(
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: busy ? JuneflowTokens.surfaceMuted : tone,
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
                    const Icon(
                      Icons.check,
                      size: 18,
                      color: JuneflowTokens.shellTextStrong,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        _t('confirm'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: JuneflowTokens.shellTextStrong,
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  /// Honest-empty — a centered em-dash (no PO selected, or the PO/PR chain
  /// yielded no countable line). No invented copy, no fabricated row.
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
