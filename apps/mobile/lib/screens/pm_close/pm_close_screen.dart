// PmCloseScreen — the mobile PM close summary, ported from pototype/mobile-pm.jsx
// MPMClose (L181-217). Route `pm-close` (mobile_routes.dart; MobileSection.field) —
// the last step of the PM flow, reached from `pm-notes` once the maintenance log is
// durably saved, carrying the real work-order id via the Navigator.push seam (the
// pm-jobs → pm-checkin → pm-checklist → pm-notes precedent). money = NONE.
//
// ══ WHAT THIS SCREEN CLAIMS, EXACTLY ═════════════════════════════════════════════
// It summarises the job, CAPTURES the customer's signature, and closes the work
// order. It never states that a certificate exists or that anything was sent to
// anyone. Written out plainly because the prototype's version claims both:
//
//   * the SUCCESS VIEW (L185-194) is STILL DROPPED in full. It announces "PM job
//     closed successfully" (L189) over a subtitle whose second line (L190) says the
//     PM certificate was sent to the customer over LINE. The second is false and
//     cannot be made true: there is no certificate column on pm_workorder, the close
//     handler's own comment says close never invents one (apps/api/src/routes/pm.ts
//     L753-760), and LINE is a verified no-op stub (lineNotifyStub, B-108b). The
//     confirmation here is the STATE CHANGE, and nothing else: the pad renders the
//     accepted signature and the bar reads pm.closedNote ("closed - the customer
//     signed for the work"), which is now literally what happened. That follows the
//     merged st-receive (B-266) precedent — "confirmation is the state change, not a
//     screen announcing effects nobody performs" — without its pop; see _resolve for
//     why the pop does not carry over.
//   * the CTA (L213) reads "close PM job + send report" — close **and send a
//     report**. The report half is that same LINE promise, so the prototype's label
//     stays dropped the way pm-notes dropped its own (B-285). What ships in its place
//     is the existing dict key pm.closeWithSignBtn (th: "close + signature"), naming
//     exactly the capability the control now really has.
//
// ══ WHAT CHANGED SINCE B-288, AND WHY IT IS ALLOWED ══════════════════════════════
// B-288 shipped this screen READ-ONLY with the CTA permanently disabled. The reason
// was never "closing is wrong" — it was that the body would have been EMPTY: the
// endpoint writes only the fields the body carries, cause/fix/advice belong to
// pm-notes and were already saved there, and the one field left (the signature) could
// not be captured because `customer_sign`'s ENCODING was undefined. Wei ruled that
// encoding on 2026-08-07 (BLOCKERS.md B-331: STROKE JSON — chosen precisely so no
// package is needed), which closes B-288. The signature is now captured by a
// pure-Flutter CustomPaint pad (signature_pad.dart), the body carries it, and the
// close is a real write.
//
// The signature was the CTA's only blocker, and re-verified as such this round: the
// four remaining B-288 deviations (success view, CTA label, the em-dashed time/parts
// rows, the em-dashed recipient) are all about what the screen DISPLAYS, and none of
// them is a precondition for closing. So the CTA is live.
//
// ══ WHAT IS REAL ═════════════════════════════════════════════════════════════════
// The summary card is genuinely wired, from the same two reads pm-jobs makes:
//   row 1 asset     -> GET /pm/assets joined on asset_id: name + code (both nullable
//                     INDEPENDENTLY — pm_close_agg.assetLine decides per column).
//   row 2 checks    -> the work order's own `items` jsonb: checked/total + repair
//                     count, each line judged on its OWN stored result. Withheld
//                     entirely when the work order has no checklist lines, because
//                     "0/0" reads as a finished checklist.
//   row 3 start-end -> em-dash. No clock column exists on pm_workorder and no
//   row 4 totaltime -> em-dash. timestamp rides workOrderWire. The merged web port of
//                     this same panel em-dashes both (wo-detail.tsx "DEFAULT 5").
//   row 5 parts     -> em-dash. MONEY with no work-order column (parts live on
//                     pmQuotes.parts); money = SERVER, so nothing is summed here.
// and the signature state is `customer_sign`, the same column the merged
// `deriveStatus` (apps/web/src/screens/pm/wo-rows.ts L206) turns into "done" — now
// also the column this screen WRITES.
//
// ══ THE SIGNATURE, END TO END ════════════════════════════════════════════════════
//   capture  -> SignaturePad (pure CustomPaint, no package — B-331's whole point)
//   encode   -> encodeSignatureInk: {"v":1,"w":…,"h":…,"s":[[[x,y],…],…]}
//   refuse   -> an EMPTY pad cannot submit. The CTA stays disabled until there is
//               ink, and pmClosePayload returns null for a blank value, so no body
//               can reach the wire with an ink-less signature in it. That is not
//               tidiness: every reader in the product treats a non-empty
//               `customer_sign` as "the customer signed" without looking inside, so
//               an empty-but-present value would fabricate a record of consent — and
//               a blank one would ERASE a signature already stored (the handler
//               writes `str(…).trim() || null`).
//   send     -> POST /pm/workorders/{id}/close { signature }, through the offline
//               queue (pm-checkin / pm-checklist / pm-notes precedent). NOT
//               cause/fix/advice: the handler keys off key presence, so including
//               them would blank pm-notes' maintenance log.
//   read back-> a stored value that PARSES as this shape is re-rendered as the real
//               strokes; one that does not (a legacy or future-version blob) still
//               counts as SIGNED and falls back to the check icon. "Cannot draw it"
//               is not "not signed".
//
// §0 fidelity (rule 1): the chrome is the prototype's — the header (back chevron ·
// eyebrow · title, L197-198), the job-summary card with its 5 space-between rows
// (7px vertical padding, 1px bottom hairline, 12px text, label in text-3, value at
// weight 600 — L202), the signature card (L205) with its 110px dashed box (1.5px,
// radius 10, L206) and centred caption (L209), and the sticky bottom bar (L212-214).
// Every colour/space is a generated design token (JuneflowTokens); every string is a
// key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
import 'dart:async';
import 'dart:math' show Random;

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'pm_close_agg.dart';
import 'pm_close_repository.dart';
import 'signature_ink.dart';
import 'signature_pad.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `pm-close`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [PmCloseScreen].
///
/// Constructed at the pm-notes push site with a REAL [workOrderId]; when the shell
/// routes it as a bare tab there is no selection, so [workOrderId] is null → an
/// honest "no work order selected" state (the approve / reject / pm-checkin /
/// pm-checklist / pm-notes nullable-id precedent).
class PmCloseScreenHost extends StatefulWidget {
  const PmCloseScreenHost({super.key, this.workOrderId});

  /// The work order whose summary is shown. Null when the screen is reached without
  /// a selection → honest-empty.
  final String? workOrderId;

  @override
  State<PmCloseScreenHost> createState() => _PmCloseScreenHostState();
}

class _PmCloseScreenHostState extends State<PmCloseScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pm_close');
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
          // The shared Dio (auth + tenant scope) for the two reads, and the SHARED
          // drain processor for the close — never a screen-local one, or the write
          // would sit in a queue nothing else replays (AppServices asserts the
          // processor drains THE app queue).
          return PmCloseScreen(
            repo: DioPmCloseRepository(services.dio, services.syncProcessor),
            strings: strings,
            i18n: services.i18n,
            workOrderId: widget.workOrderId,
          );
        },
      ),
    );
  }
}

/// The close-summary view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class PmCloseScreen extends StatefulWidget {
  const PmCloseScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.workOrderId,
  });

  final PmCloseRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? workOrderId;

  @override
  State<PmCloseScreen> createState() => _PmCloseScreenState();
}

class _PmCloseScreenState extends State<PmCloseScreen> {
  /// True once the read finished (so a resolved summary can be told apart from a
  /// pending load).
  bool _loaded = false;

  /// The honest summary, or null when there is no work order to summarise (no
  /// selection, read failure, or an id absent from the page). Null renders
  /// honest-empty — never a blank summary card, which would read as "this job has
  /// no asset, no checks and no signature".
  PmCloseSummary? _summary;

  /// Where the close attempt stands. Cyclic — a failed attempt can be retried.
  PmCloseState _state = PmCloseState.idle;

  /// The stable client id of the op in flight, reused across manual retries so a
  /// re-tap re-drains the SAME queued write instead of enqueuing a second one.
  String? _opId;

  /// The encoded stroke JSON of what is on the pad right now, or null when the pad
  /// is empty. This is the ONLY gate on the CTA — see [_canSubmit].
  String? _pending;

  /// A signature already stored on the work order, decoded for re-render. Null when
  /// the column is empty OR when it holds a value this build cannot draw (a legacy
  /// blob, or a future `v`); the two are told apart by [PmCloseSummary.signed],
  /// which stays authoritative for "is it signed".
  SignatureInk? _stored;

  @override
  void initState() {
    super.initState();
    if (widget.workOrderId != null) {
      unawaited(_load());
    } else {
      _loaded = true;
    }
  }

  Future<void> _load() async {
    final String id = widget.workOrderId!;
    try {
      final List<PmCloseEnt> rows = await widget.repo.listWorkOrders();
      final PmCloseEnt? wo = findWorkOrder(rows, id);
      if (wo == null) {
        if (!mounted) return;
        setState(() => _loaded = true);
        return;
      }
      // The asset read only enriches ONE row. A failure here must not lose the
      // checklist tally and the signature state, so it degrades to an empty map and
      // the asset row alone em-dashes (never the whole screen).
      Map<String, PmCloseAsset> assets = const <String, PmCloseAsset>{};
      try {
        assets = buildAssetMap(await widget.repo.listAssets());
      } on Object {
        assets = const <String, PmCloseAsset>{};
      }
      if (!mounted) return;
      setState(() {
        _summary = buildSummary(wo, assets);
        // Only ink this build can DRAW. A null here never means "unsigned" — that
        // question is answered by the column's emptiness, via summary.signed.
        _stored = decodeSignatureInk(pmCloseStr(wo, 'customer_sign'));
        _loaded = true;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loaded = true);
    }
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// A fresh client idempotency key (uuid-free — no package; the pm-checkin
  /// precedent). Time plus a random component makes a collision between two of this
  /// device's own closes vanishingly unlikely.
  String _newOpId() =>
      'pm-close-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  /// Whether the CTA may fire.
  ///
  /// Ink is REQUIRED. This screen's entire body is the signature, so a close with an
  /// empty pad would send nothing, and the handler would then write nothing at all
  /// (`Object.keys(set).length > 0` is false, pm.ts L796) while still returning 200 —
  /// the fabricated outcome B-288 refused to ship. An in-flight submit also blocks,
  /// so one signature cannot be sent twice by a double tap.
  bool get _canSubmit =>
      _pending != null &&
      _state != PmCloseState.submitting &&
      _state != PmCloseState.closed;

  /// The pad reported new ink. Encoding here (rather than at submit time) means the
  /// CTA is gated on a value that ENCODED — a pad whose ink cannot be represented
  /// never looks submittable.
  void _onInkChanged(SignatureInk ink) {
    // encodeSignatureInk is the single gate: it returns null for an empty pad AND
    // for a pad carrying nothing but taps (SignatureInk.hasSignature), so a stray
    // dot never makes the CTA look submittable.
    final String? encoded = encodeSignatureInk(ink);
    setState(() {
      _pending = encoded;
      // Clearing the pad after a failure returns the control to a clean idle rather
      // than leaving a stale error next to a blank box.
      if (encoded == null && _state == PmCloseState.failed) {
        _state = PmCloseState.idle;
        _opId = null;
      }
    });
  }

  /// Submit the captured signature, or re-drain the op already queued.
  ///
  /// A retry REUSES [_opId]: the queue keys on it, so re-tapping replays the existing
  /// write instead of stacking a second one behind it.
  Future<void> _onClose() async {
    if (!_canSubmit) return;
    final String? woId = widget.workOrderId;
    final Map<String, Object?>? body = pmClosePayload(_pending);
    // Both are already guaranteed by _canSubmit and the load path; refusing here as
    // well means no future edit can open a path to an empty body.
    if (woId == null || body == null) return;

    final String opId = _opId ??= _newOpId();
    setState(() => _state = PmCloseState.submitting);
    final DrainReport report = await widget.repo.submitClose(
      workOrderId: woId,
      opId: opId,
      body: body,
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  /// Settle where the write stands and show it.
  ///
  /// NOTHING is navigated. The st-receive (B-266) precedent pops on success —
  /// "confirmation is the state change plus Navigator.maybePop, not a screen
  /// announcing effects nobody performs" — but the reason it pops does not hold here,
  /// on two counts. First, that screen had nothing TRUE to show, whereas this one now
  /// does: the pad renders the accepted signature and the bar reads pm.closedNote.
  /// Second, popping would not deliver the prototype's "back to the job list"
  /// (mobile-pm.jsx L191) at all — this screen is pushed from pm-notes, so a pop lands
  /// on the maintenance-log form for the job just closed, which is less useful than
  /// staying. Staying also keeps all three outcomes consistent: closed, queued and
  /// failed each leave the technician looking at the result.
  Future<void> _resolve(String opId, DrainReport report) async {
    final List<SyncOperation> due = await widget.repo.due();
    final PmCloseState next = resolveCloseState(opId, report, due);
    if (!mounted) return;
    setState(() {
      _state = next;
      if (next == PmCloseState.closed) {
        // The server accepted it, so the pad's ink IS what `customer_sign` now
        // holds — the one moment this screen may state the work order is signed.
        _stored = decodeSignatureInk(_pending);
        final PmCloseSummary? s = _summary;
        if (s != null) {
          _summary = PmCloseSummary(
            asset: s.asset,
            checks: s.checks,
            signed: true,
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // The prototype's eyebrow is a human work-order number ("PMWO-2569-0312",
            // L197). pm_workorder stores no document number and workOrderWire exposes
            // none, so there is nothing honest to print — the pm-jobs agg and the
            // pm-notes header omit the same field for the same reason. An em-dash,
            // never the raw uuid dressed up as a document number.
            sub: _dash,
            title: _tp('title'),
            leading: _backButton(),
          ),
          Expanded(child: _body()),
          if (_summary != null) _actionBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-pm.jsx L198 — surface-3 circle + chevL; the
  /// prototype returns to pm-notes, which is exactly what popping does).
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
    if (!_loaded) return const SizedBox.shrink();
    final PmCloseSummary? s = _summary;
    if (s == null) return _empty();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        // mobile-pm.jsx L200-204 — the 5 summary rows, in source order. The last row
        // keeps the prototype's hairline, as the prototype's own map does.
        MSection(
          title: _tp('summaryTitle'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _summaryRow(_t('rowAsset'), s.asset),
              _summaryRow(_tp('rowChecks'), _checksValue(s.checks)),
              _summaryRow(_tp('rowTime'), s.startEnd),
              _summaryRow(_t('rowTotalTime'), s.totalTime),
              _summaryRow(_tp('rowParts'), s.parts),
            ],
          ),
        ),
        // mobile-pm.jsx L205-210 — the signature card.
        MSection(
          title: _t('signatureTitle'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _signatureBox(s.signed),
              const SizedBox(height: 6),
              _recipientCaption(s.recipient),
            ],
          ),
        ),
      ],
    );
  }

  /// The check-results VALUE (mobile-pm.jsx L201, rendered there as
  /// "5/5 <items> - <repair> 1").
  ///
  /// Composed from two independently-translated units joined by the prototype's own
  /// ASCII middot (U+00B7 — punctuation, not a Thai literal; the pr_detail_agg
  /// projectLine precedent):
  ///   * the count, through the REAL dict key pm.checkProgress ("{n}/{count} <items>"),
  ///     substituted with tf();
  ///   * the repair tail, a phrase key carrying its own {n}.
  ///
  /// Returns null — so the row em-dashes — when the work order stores no checklist
  /// lines at all. A rendered "0/0" would read as a completed checklist; a tally over an
  /// empty list is not a statement about the job. The repair tail is dropped (not
  /// printed with a zero) when nothing was repaired, matching the prototype, which
  /// only ever shows it with a count.
  String? _checksValue(PmCloseChecks c) {
    if (!c.hasLines) return null;
    final String count = widget.i18n.tf(
      widget.strings['checkProgress'],
      <String, Object?>{'n': c.checked, 'count': c.total},
    );
    if (c.repair == 0) return count;
    final String repaired = JuneflowI18n.format(
      _tp('repairCount'),
      <String, Object?>{'n': c.repair},
    );
    return '$count · $repaired';
  }

  /// One summary row (mobile-pm.jsx L202): label left in text-3, value right at
  /// weight 600, 7px vertical padding, 1px bottom hairline, 12px text. A null value
  /// renders the em-dash — the label is chrome and always shows.
  Widget _summaryRow(String label, String? value) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value ?? _dash,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: value == null
                    ? JuneflowTokens.textTertiary
                    : JuneflowTokens.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The signature box (mobile-pm.jsx L206-208): 110px tall, radius 10, a 1.5px
  /// dashed border — border-strong over surface-2 when unsigned, ok over ok-soft when
  /// signed, exactly the prototype's two tones.
  ///
  /// THREE states, and which one shows is decided by stored data, never by a gesture:
  ///
  ///   * ALREADY SIGNED + drawable — the real stored strokes, re-rendered from the
  ///     `customer_sign` stroke JSON at this box's size ([SignatureInkPainter] scales
  ///     uniformly via [SignatureInk.fit]). Read-only: a stored signature is the
  ///     customer's, and this screen offers no way to overwrite one.
  ///   * ALREADY SIGNED + not drawable — the check icon on the ok tone. The column is
  ///     `text` and predates this encoding, so it may hold a legacy blob, and a future
  ///     `v` may hold a shape this build does not know. Both are still SIGNED; only
  ///     the picture is unavailable. Printing the raw value instead would show the
  ///     user something that is not a signature, and captioning it "signed by …"
  ///     would invent a name the wire does not carry.
  ///   * NOT SIGNED — the live capture pad (signature_pad.dart).
  ///
  /// The prototype's tap-to-sign (L206: `onClick={() => setSigned(true)}` painting a
  /// hardcoded cursive customer name) is not reproduced in any of the three: it
  /// fabricates both the mark and the customer.
  Widget _signatureBox(bool signed) {
    if (signed) {
      final SignatureInk? ink = _stored;
      return SizedBox(
        height: 110,
        child: ink == null
            ? const CustomPaint(
                painter: SignatureInkPainter(
                  strokes: <List<SignaturePoint>>[],
                  signed: true,
                  sourceWidth: 1,
                  sourceHeight: 1,
                ),
                child: Center(
                  child: Icon(
                    Icons.check,
                    size: 28,
                    color: JuneflowTokens.statusOkFg,
                  ),
                ),
              )
            : CustomPaint(
                painter: SignatureInkPainter(
                  strokes: ink.strokes,
                  signed: true,
                  sourceWidth: ink.width,
                  sourceHeight: ink.height,
                ),
              ),
      );
    }
    return SignaturePad(
      onChanged: _onInkChanged,
      // Frozen while the write is in flight, so the ink cannot change under a
      // request that is already carrying it.
      enabled: _state != PmCloseState.submitting,
    );
  }

  /// The centred caption under the pad (mobile-pm.jsx L209): the label is kept as
  /// chrome, the value em-dashes. The customer's name is three hops away and its
  /// wire stops at a uuid, and the juristic-person/building descriptor has no column at
  /// all (see PmCloseSummary.recipient).
  Widget _recipientCaption(String? recipient) {
    return Text(
      '${_tp('recipient')}: ${recipient ?? _dash}',
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 11, color: JuneflowTokens.textTertiary),
    );
  }

  /// The sticky bottom bar (mobile-pm.jsx L212-214).
  ///
  /// LIVE as of B-331 — it was permanently dead under B-288 only because no signature
  /// could be captured, and the file header records why that is no longer true.
  ///
  /// The gate is the prototype's own gate, honestly implemented: the prototype
  /// enables its button on a local `signed` flag set by a tap; here it enables on
  /// REAL INK being on the pad. An empty pad keeps it disabled — with nothing to
  /// send, a close would write nothing and still return 200, which is exactly the
  /// fabricated outcome B-288 refused.
  ///
  /// Its label stays the dict key pm.closeWithSignBtn, NOT the prototype's "close PM
  /// + send report": the report half promises a LINE push that is a no-op stub
  /// (B-108b). The label names what the control does and stops there.
  ///
  /// After a submit the bar reports where the write STANDS, never more:
  ///   closed  -> pm.closedNote ("closed - the customer signed for the work") — true
  ///              a real signature is stored; it was the reason this key could not be
  ///              used before.
  ///   queued  -> tax.etax.statusPending. Captured durably, NOT yet accepted. Never
  ///              "closed": nothing is stored server-side yet.
  ///   failed  -> admin.common.actionFailedToast, and the control stays tappable so
  ///              the same op can be re-drained.
  /// (All three are EXISTING dict keys, reused from pm-checkin / pm-checklist /
  /// pm-notes — this screen mints nothing.)
  Widget _actionBar() {
    final bool enabled = _canSubmit;
    final bool closed = _state == PmCloseState.closed;
    final String label = switch (_state) {
      PmCloseState.closed => _t('closed'),
      PmCloseState.queued => _t('queued'),
      PmCloseState.failed => _t('failed'),
      PmCloseState.idle || PmCloseState.submitting => _t('close'),
    };
    final Color fg = enabled || closed
        ? JuneflowTokens.shellTextStrong
        : JuneflowTokens.textTertiary;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: GestureDetector(
        // Only wired when the control may actually fire, so a disabled bar has
        // nothing behind it to tap — the property pm_close_screen_test pinned under
        // B-288 and still pins, now for the EMPTY-pad case.
        onTap: enabled ? _onClose : null,
        behavior: HitTestBehavior.opaque,
        child: Container(
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: enabled || closed
                ? JuneflowTokens.statusOkFg
                : JuneflowTokens.surfaceMuted,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(Icons.check, size: 18, color: fg),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Honest-empty — a centered em-dash: no work order selected, or the work order
  /// could not be read (so its summary is unknown, not empty).
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
