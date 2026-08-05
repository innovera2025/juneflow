// PmCloseScreen — the mobile PM close summary, ported from pototype/mobile-pm.jsx
// MPMClose (L181-217). Route `pm-close` (mobile_routes.dart; MobileSection.field) —
// the last step of the PM flow, reached from `pm-notes` once the maintenance log is
// durably saved, carrying the real work-order id via the Navigator.push seam (the
// pm-jobs → pm-checkin → pm-checklist → pm-notes precedent). money = NONE.
//
// ══ WHAT THIS SCREEN CLAIMS, EXACTLY ═════════════════════════════════════════════
// It is a READ-ONLY summary. It performs no write, and it never states that a job is
// closed, that a certificate exists, or that anything was sent to anyone. Written out
// plainly because the prototype's version of this screen claims all three:
//
//   * the SUCCESS VIEW (L185-194) is DROPPED in full. It announces "PM job closed
//     successfully" (L189) over a subtitle whose second line (L190) says the PM
//     certificate was sent to the customer over LINE. Neither is true and neither can
//     be made true here: there is
//     no status column and no certificate column on pm_workorder, the close handler's
//     own comment says close never invents one (apps/api/src/routes/pm.ts L753-760),
//     and LINE is a verified no-op stub (lineNotifyStub, B-108b). It is also
//     unreachable: it is entered by the close this screen cannot perform.
//   * the CTA (L213) reads "close PM job + send report" — close **and send a report**.
//     The report half is the same LINE promise, so the prototype's label is dropped
//     the way pm-notes dropped its own (B-285). What ships in its place is the
//     existing dict key pm.closeWithSignBtn (th: "close + signature"),
//     naming exactly the capability the control stands for, and the control is
//     PERMANENTLY DISABLED in this slice. It is an affordance, not an action: no tap
//     handler, no request, no state change. See B-288 and the action-bar comment.
//   * the SIGNATURE PAD (L206-208) is INERT. Tapping it in the prototype flips a
//     local flag and paints a hardcoded cursive name; here the box renders the REAL
//     stored state of `customer_sign` and nothing else.
//
// Why the close cannot be performed (the short version — full reasoning in
// pm_close_repository.dart): the endpoint writes only the fields the body carries;
// cause/fix/advice belong to pm-notes and were saved there; the signature cannot be
// captured (no package, and the TEXT column's encoding is undefined — nothing reads
// its content, only its emptiness); so the body would be empty, and pm.ts L796 then
// writes nothing at all. A 200 that leaves the row byte-identical is not a close.
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
// `deriveStatus` (apps/web/src/screens/pm/wo-rows.ts L206) turns into "done".
//
// §0 fidelity (rule 1): the chrome is the prototype's — the header (back chevron ·
// eyebrow · title, L197-198), the job-summary card with its 5 space-between rows
// (7px vertical padding, 1px bottom hairline, 12px text, label in text-3, value at
// weight 600 — L202), the signature card (L205) with its 110px dashed box (1.5px,
// radius 10, L206) and centred caption (L209), and the sticky bottom bar (L212-214).
// Every colour/space is a generated design token (JuneflowTokens); every string is a
// key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
import 'dart:async';
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'pm_close_agg.dart';
import 'pm_close_repository.dart';

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
          // Read-only: the shared Dio (auth + tenant scope) and nothing else. No
          // sync queue is resolved here because this screen enqueues nothing.
          return PmCloseScreen(
            repo: DioPmCloseRepository(services.dio),
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
        _loaded = true;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loaded = true);
    }
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

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
  /// INERT, and [signed] comes from the stored `customer_sign` alone. There is no tap
  /// handler: the prototype's tap sets a local flag and paints a hardcoded cursive
  /// name, which would be fabricating both the signature and the customer. Capture is
  /// unbuilt (B-288) — the pm-checklist photo-slot precedent, which likewise renders
  /// the stored reference's presence and wires no capture.
  ///
  /// The signed state shows a check on the ok tone rather than any text: the stored
  /// value is an opaque blob of undefined encoding (nothing in the repo reads its
  /// CONTENT), so printing it would be showing the user a value that is not a name,
  /// and captioning it "signed by …" would be inventing one.
  Widget _signatureBox(bool signed) {
    return SizedBox(
      height: 110,
      child: CustomPaint(
        painter: _DashedSignaturePainter(signed: signed),
        child: Center(
          child: Icon(
            signed ? Icons.check : Icons.draw_outlined,
            size: signed ? 28 : 20,
            color: signed
                ? JuneflowTokens.statusOkFg
                : JuneflowTokens.textTertiary,
          ),
        ),
      ),
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
  /// The button is PERMANENTLY DISABLED and has no tap handler. The prototype gates
  /// it on a local `signed` flag; here the gate is not "has the user tapped the pad"
  /// but "can this app capture a signature at all", and the answer is no (B-288). It
  /// is rendered because the prototype's sticky bar is part of this screen's shape
  /// and because the affordance names where closing will live — the same
  /// honest-disabled treatment pm-checkin gave pm-checklist and pm-notes gave this
  /// screen, and the same treatment pm-checklist gives its inert photo slots.
  ///
  /// Its label is the existing dict key pm.closeWithSignBtn, NOT the prototype's
  /// "close PM + send report": the report half promises a LINE push that is a no-op
  /// stub (B-108b). Nothing here reports a job closed — the button is an unavailable
  /// control, and a disabled control makes no claim about the work order's state.
  Widget _actionBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Container(
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceMuted,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Icon(
              Icons.check,
              size: 18,
              color: JuneflowTokens.textTertiary,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _t('close'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            ),
          ],
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

/// The signature pad's 1.5px dashed rounded border (mobile-pm.jsx L206
/// `1.5px dashed`, radius 10), token-coloured in the prototype's two tones. Purely
/// decorative — it paints a border, it captures nothing.
class _DashedSignaturePainter extends CustomPainter {
  const _DashedSignaturePainter({required this.signed});

  /// Drives only the two colours the prototype switches between.
  final bool signed;

  @override
  void paint(Canvas canvas, Size size) {
    final RRect box = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(10),
    );
    canvas.drawRRect(
      box,
      Paint()
        ..color = signed
            ? JuneflowTokens.statusOkSoft
            : JuneflowTokens.surfaceAlt,
    );

    final Paint stroke = Paint()
      ..color = signed
          ? JuneflowTokens.statusOkFg
          : JuneflowTokens.surfaceBorderStrong
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
  bool shouldRepaint(covariant _DashedSignaturePainter oldDelegate) =>
      oldDelegate.signed != signed;
}
