// FieldGrScreen — the mobile site goods-receipt review, ported from
// pototype/mobile-screens.jsx MFieldGR (L364-423). Route `field-gr`
// (mobile_routes.dart; group B, MobileSection.field). money = NONE.
//
// It REVIEWS a recorded receipt; it is not a second count-and-receive form. The
// evidence for that reading, and the B-324 fork it is raised under, are in
// field_gr_agg.dart's header. The short version: B2 has no input control of any
// kind yet displays a PARTIAL line (280/320), so its numbers must be data that
// already exists — and `grItemWire` { name, ordered_qty, received_qty, unit } is
// a 1:1 match for its row and the only place in the system carrying all four.
//
// ══ WHAT THIS SCREEN CLAIMS, EXACTLY ═════════════════════════════════════════
// Three sections' worth of the prototype are DROPPED rather than rendered, each
// because it would state something untrue. Written out plainly, because a
// dropped section is invisible in a diff:
//
//   * the QC CHECKLIST (L393-407) — four rows, every one hardcoded `on: true`,
//     drawn as an inert 22px ticked box with no onClick anywhere in the block.
//     There is nowhere for a QC result to come from and nowhere for one to go:
//     POST /gr accepts no qc field (gr.ts L441-560 reads only po_id / wo_id / no /
//     idempotency_key / lines[]), the `gr` table has no qc column (boq.ts
//     L475-500), and `defect_report` (boq.ts L564-579) is `{ id, gr_id, note }` —
//     one free-text note, no per-item and no reason code. Grepping gr.ts for
//     qc|checklist|inspect returns 0 hits. Four permanently-ticked boxes assert
//     that an inspection was performed and passed; nothing anywhere recorded one.
//     That is §0 rule 3 exactly. Its title and its four labels also have no i18n
//     key, so it could not be rendered even if the storage existed.
//
//   * the PHOTO GALLERY (L408-413) — three filled tiles are `linear-gradient`
//     divs, not images. The column behind them is real (`gr.photos`, a jsonb
//     string[]) but nothing ever populates it: the seed writes `photos: []`
//     (seed/index.ts L1298) and its only writer is `lines[].photos[]` at create
//     time, which no client sends. Rendering three placeholders would invent
//     evidence of a delivery. The `+` tile is an inert div in the prototype too,
//     and there is no camera package in pubspec.yaml (a Wei-level stack decision,
//     the geolocator/B-260 precedent). The section title has no key either.
//
//   * the FOOTER'S TWO BUTTONS (L417-421) — neither ships. The ok-tone primary
//     has no endpoint in the contract at all; the ghost secondary has a real one
//     (POST /gr/:id/return) but no honest label and no undo. Both are argued in
//     full in field_gr_repository.dart's header and raised as B-324.
//
// and one LINE of the vendor block is dropped: L373's delivery date + delivery-
// note number. `po` carries no delivery/expected/due column and `grWire.date` is
// `gr.created_at` — the RECEIPT date, not the delivery date — so printing it
// under a "delivered on" label would be a semantic fabrication; and the delivery
// note number has no column anywhere (`gr.no` is the GR's own number).
//
// ══ WHAT IS REAL ═════════════════════════════════════════════════════════════
// Everything that remains is wired, from GET /gr plus the anchor-number join:
//   header eyebrow -> the anchor document's `no` (po_id/wo_id -> GET /po,/wo)
//   vendor         -> `grWire.vendor`, resolved SERVER-side through gr -> po/wo
//                     -> vendor (gr.ts L206-219)
//   line name/unit -> `gr_item.name` / `.unit`. This is the gap st-receive could
//                     not close (B-265): the PR chain carries neither, so its
//                     rows em-dash both. Here they are on the wire.
//   line got/ord   -> `gr_item.received_qty` / `.ordered_qty`
//   the short tone -> derived from those two numbers, not from a `short` flag
// Every one of them em-dashes independently when the wire does not carry it.
//
// §0 fidelity (rule 1): the chrome is the prototype's — the header (L367-368) with
// its 34px round back chevron, the vendor MSection (L370-374) with its 12px
// tertiary label / 13px semibold value, the received-items MSection (L375-391)
// with one space-between row per line, a hairline between rows but not above the
// first, the received quantity at weight 700 in the ok or danger tone and the
// "/ ordered unit" tail in tertiary. Every colour/space is a generated design
// token (JuneflowTokens); every string is a key from the sidecar (no Thai byte in
// this file — i18n-guard, §0 rule 2).
import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'field_gr_agg.dart';
import 'field_gr_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `field-gr`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [FieldGrScreen].
///
/// [grId] is nullable, the approve / reject / pm-checkin / pm-close precedent. No
/// mobile surface lists goods receipts today, so the bare tab route is the only
/// live entry: with no id the screen follows the register's NEWEST received
/// receipt (the srv-track precedent). The pushed-id path is wired anyway so a
/// future GR list can hand it a real subject without touching this file.
class FieldGrScreenHost extends StatefulWidget {
  const FieldGrScreenHost({super.key, this.grId});

  /// The receipt to review, or null to follow the register's newest.
  final String? grId;

  @override
  State<FieldGrScreenHost> createState() => _FieldGrScreenHostState();
}

class _FieldGrScreenHostState extends State<FieldGrScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('field_gr');
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
          // Read-only: the shared Dio (auth + tenant scope) and nothing else. The
          // sync queue is not resolved because this screen enqueues nothing.
          return FieldGrScreen(
            repo: DioFieldGrRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
            grId: widget.grId,
          );
        },
      ),
    );
  }
}

/// The receipt-review view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class FieldGrScreen extends StatefulWidget {
  const FieldGrScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.grId,
  });

  final FieldGrRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? grId;

  @override
  State<FieldGrScreen> createState() => _FieldGrScreenState();
}

class _FieldGrScreenState extends State<FieldGrScreen> {
  /// True once the read finished, so a resolved receipt can be told apart from a
  /// pending load (which must not flash the empty state).
  bool _loaded = false;

  /// The receipt under review, or null when there is none to show: no receipt in
  /// the tenant's page, a pushed id that does not resolve, or a failed read. Null
  /// renders honest-empty — never a blank receipt card, which would read as "this
  /// delivery had no vendor and no lines".
  FieldGrReceipt? _receipt;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final List<FieldGrEnt> grs = await widget.repo.listGrs();
      final FieldGrEnt? gr = selectReceipt(grs, grId: widget.grId);
      if (gr == null) {
        if (!mounted) return;
        setState(() => _loaded = true);
        return;
      }
      // The anchor reads only enrich the header eyebrow. A failure there must not
      // lose the vendor and the received lines, so each degrades to an empty map
      // and the eyebrow alone em-dashes (never the whole screen).
      Map<String, String> anchorNos = const <String, String>{};
      try {
        final List<List<FieldGrEnt>> docs = await Future.wait<List<FieldGrEnt>>(
          <Future<List<FieldGrEnt>>>[
            widget.repo.listPos(),
            widget.repo.listWos(),
          ],
        );
        anchorNos = <String, String>{
          ...buildAnchorNoMap(docs[0]),
          ...buildAnchorNoMap(docs[1]),
        };
      } on Object {
        anchorNos = const <String, String>{};
      }
      if (!mounted) return;
      setState(() {
        _receipt = buildReceipt(gr, anchorNos);
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
            // The prototype's eyebrow is the anchor PO's number (L367). Resolved
            // from the receipt's own FK; em-dash when the anchor is not in the
            // fetched page. The raw uuid is never shown as a document number.
            sub: _receipt?.anchorNo ?? _dash,
            title: _t('title'),
            leading: _backButton(),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  /// A 34px round back button (L368 — surface-3 circle + chevL).
  ///
  /// The prototype's chevron has NO onClick: it is a static mock. Popping is the
  /// structural equivalent for a pushed route and a no-op for a bare tab route
  /// (`Navigator.maybePop`), so the affordance behaves as its shape promises
  /// without inventing a destination the prototype never named. The pm-close
  /// precedent.
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
    final FieldGrReceipt? r = _receipt;
    if (r == null) return _empty();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[_vendorCard(r.vendor), _linesCard(r.lines)],
    );
  }

  /// The vendor block (L370-374): a 12px tertiary label over a 13px semibold
  /// value. L373's delivery date + delivery-note number are dropped — see the
  /// file header. The label is chrome and always shows; the value em-dashes.
  Widget _vendorCard(String? vendor) {
    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            _tp('vendorLabel'),
            style: const TextStyle(
              fontSize: 12,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            vendor ?? _dash,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: vendor == null
                  ? JuneflowTokens.textTertiary
                  : JuneflowTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  /// The received-items section (L375-391).
  ///
  /// A receipt whose `items[]` is empty renders the section with a single
  /// em-dash rather than an empty card: `grWire` honestly reports `items: []` for
  /// a receipt recorded without per-line detail (exactly what st-receive's
  /// nameless lines produce, by design — B-267), and that is a real state of a
  /// real document, not an error.
  Widget _linesCard(List<FieldGrLine> lines) {
    return MSection(
      title: _t('receivedItems'),
      child: lines.isEmpty
          ? const Text(
              _dash,
              style: TextStyle(
                fontSize: 12,
                color: JuneflowTokens.textTertiary,
              ),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                for (int i = 0; i < lines.length; i++)
                  _lineRow(lines[i], i > 0),
              ],
            ),
    );
  }

  /// One received line (L381-389): name left, `got / ord unit` right. 8px vertical
  /// padding, a 1px hairline above every row but the first (the prototype's
  /// `borderTop: i ? ... : "none"`).
  Widget _lineRow(FieldGrLine line, bool hairline) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: hairline
            ? const Border(top: BorderSide(color: JuneflowTokens.surfaceBorder))
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  line.name ?? _dash,
                  style: TextStyle(
                    fontSize: 12,
                    color: line.name == null
                        ? JuneflowTokens.textTertiary
                        : JuneflowTokens.textPrimary,
                  ),
                ),
                if (line.shortfall != null) _shortfallCaption(line),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _quantities(line),
        ],
      ),
    );
  }

  /// The 10px danger sub-line under a short line (L384).
  ///
  /// The prototype's words there are a shortfall noun and the literal "partial".
  /// NEITHER is rendered. The shortfall noun has two byte-exact dict matches —
  /// `labor.att.optAbsent` ("absent from work") and `inv.status.out` ("out of
  /// stock") — which read correctly in Thai today and would translate WRONGLY the
  /// moment en/zh/ar are filled; `gr.list.shortReceived` carries the right
  /// sentence but HARDCODES one unit inside it, so it would print a bar-unit
  /// shortfall on a bag line; `gr.create.partialCheckbox` contains "Partial"
  /// inside a different string. "partial" itself has no key at all. st-receive
  /// refused the same word for the same reason (B-266).
  ///
  /// So the caption is the signed shortfall QUANTITY in the prototype's own danger
  /// tone, plus the line's real unit (data off the wire, not copy). A negative
  /// number in red under a short row carries the meaning with no invented word,
  /// and both words go on the B-324 mint list.
  Widget _shortfallCaption(FieldGrLine line) {
    final String unit = line.unit == null ? '' : ' ${line.unit}';
    return Padding(
      padding: const EdgeInsets.only(top: 1),
      child: Text(
        '-${formatQty(line.shortfall!)}$unit',
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: JuneflowTokens.statusDangerFg,
        ),
      ),
    );
  }

  /// The right-hand quantity pair (L386-389): the received figure at weight 700 in
  /// the ok tone (danger when short), then "/ ordered unit" in tertiary.
  ///
  /// Each half em-dashes independently, and an absent quantity is NEVER shown as
  /// 0: a receipt line whose received quantity the wire did not carry is unknown,
  /// and printing 0 there would state that nothing arrived. An unknown comparison
  /// takes the neutral tone rather than the ok tone, so a row can never be tinted
  /// "complete" on the strength of a missing number.
  Widget _quantities(FieldGrLine line) {
    final FieldGrDelta delta = line.delta;
    final Color receivedColor = switch (delta) {
      FieldGrDelta.short => JuneflowTokens.statusDangerFg,
      FieldGrDelta.exact || FieldGrDelta.over => JuneflowTokens.statusOkFg,
      FieldGrDelta.unknown => JuneflowTokens.textTertiary,
    };
    final String received = line.receivedQty == null
        ? _dash
        : formatQty(line.receivedQty!);
    final String ordered = line.orderedQty == null
        ? _dash
        : formatQty(line.orderedQty!);
    final String unit = line.unit == null ? '' : ' ${line.unit}';
    return Text.rich(
      TextSpan(
        children: <InlineSpan>[
          TextSpan(
            text: received,
            style: TextStyle(fontWeight: FontWeight.w700, color: receivedColor),
          ),
          TextSpan(
            text: ' / $ordered$unit',
            style: const TextStyle(color: JuneflowTokens.textTertiary),
          ),
        ],
      ),
      textAlign: TextAlign.right,
      style: const TextStyle(fontSize: 12),
    );
  }

  /// No receipt to review — an em-dash, no copy (the pm-close precedent). There is
  /// no honest existing key for "no goods receipt yet", and inventing one to fill
  /// a blank screen is the waste B-266 warns about.
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
