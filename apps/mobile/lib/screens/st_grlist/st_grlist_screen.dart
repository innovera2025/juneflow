// StGrListScreen — the mobile store "awaiting PO receipt" list, ported from
// pototype/mobile-field.jsx MStGRList (L6-35). Route `st-grlist`
// (mobile_routes.dart; MobileSection.field). money = NONE (read-only list).
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow +
// title, no back/action buttons) and the tone-tinted card list (a PO number in
// brand, a body line, a sub line, and a hairline footer whose right edge is the
// "count-and-receive" affordance + a chevron). The bottom tab bar belongs to the
// shell (MobileShell), not this screen (same as notif). Every colour/space is a
// generated design token (JuneflowTokens); every string is an i18n key from the
// sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype's hardcoded `pos` array is a mock mechanic and
// is DROPPED. The list is the REAL GET /po read narrowed to the receivable
// (approved) POs, with each PO's vendor name resolved from GET /vendors
// (st_grlist_agg.dart). Per-row display is derived from the real wire columns
// only — never a fabricated PO. The prototype's items line, due time, truck,
// urgent pill and warehouse have no honest wire (po.ts GAP 1 / no due/truck/
// urgent/warehouse column), so they are omitted or shown as an em-dash.
//
// Tapping a card opens the receive flow (st-receive) in the prototype. The shell
// has no forward-navigation seam yet and st-receive is not built, so [onOpenReceive]
// is injected (null in the router today → the affordance shows but the tap is a
// no-op) rather than fabricating a destination — mirrors the approve/reject port's
// honest null-param handling.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'st_grlist_agg.dart';
import 'st_grlist_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `st-grlist`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [StGrListScreen]. The sidecar
/// load is the only async step; a plain surface shows for the frame it takes.
class StGrListScreenHost extends StatefulWidget {
  const StGrListScreenHost({super.key});

  @override
  State<StGrListScreenHost> createState() => _StGrListScreenHostState();
}

class _StGrListScreenHostState extends State<StGrListScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('st_grlist');
  }

  @override
  Widget build(BuildContext context) {
    final AppServices services = AppScope.of(context);
    return FutureBuilder<ScreenStrings>(
      future: _stringsFuture,
      builder: (BuildContext context, AsyncSnapshot<ScreenStrings> snap) {
        final ScreenStrings? strings = snap.data;
        if (strings == null) {
          return const ColoredBox(color: JuneflowTokens.surfaceBg);
        }
        return StGrListScreen(
          repo: DioStGrListRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
          // No forward-navigation seam yet → the receive flow is not wired
          // (honest no-op affordance; never a fabricated destination).
        );
      },
    );
  }
}

/// The store awaiting-receipt view. Dependencies are injected so the screen is
/// driven directly in tests (a fake repo + inline strings/i18n), never via the
/// network.
class StGrListScreen extends StatefulWidget {
  const StGrListScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.onOpenReceive,
  });

  final StGrListRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  /// Opens the count-and-receive flow for [row] (st-receive). Null when no
  /// destination is wired yet (the router today) → the tap is an honest no-op.
  final void Function(StGrRow row)? onOpenReceive;

  @override
  State<StGrListScreen> createState() => _StGrListScreenState();
}

class _StGrListScreenState extends State<StGrListScreen> {
  late Future<List<StGrRow>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<StGrRow>> _load() async {
    final List<StGrEnt> pos = await widget.repo.listPos();
    final List<StGrEnt> vendors = await widget.repo.listVendors();
    return parseAwaitingPos(pos, vendors);
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(sub: _tp('eyebrow'), title: _tp('title')),
          Expanded(
            child: FutureBuilder<List<StGrRow>>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<List<StGrRow>> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    final List<StGrRow> rows = snap.data ?? const <StGrRow>[];
                    if (rows.isEmpty) return _empty();
                    return _list(rows);
                  },
            ),
          ),
        ],
      ),
    );
  }

  Widget _list(List<StGrRow> rows) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 90),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One awaiting-receipt card (mobile-field.jsx L16-29), honest-derived: the real
  /// PO number, the items line as an em-dash (no line-item wire — po.ts GAP 1), the
  /// real vendor name, and the count-and-receive affordance. Tapping opens the
  /// receive flow when a destination is wired (else an honest no-op).
  Widget _card(StGrRow row) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onOpenReceive == null
          ? null
          : () => widget.onOpenReceive!(row),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            // PO number (mobile-field.jsx L19 — brand, 11px/700). due/urgent pill
            // have no wire → omitted (never a fabricated urgency).
            Text(
              row.no.isEmpty ? _dash : row.no,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.brandPrimary,
              ),
            ),
            const SizedBox(height: 6),
            // Items line (L23 — 13px/700). No line-item wire (GAP 1) → em-dash.
            const Text(
              _dash,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.textPrimary,
              ),
            ),
            const SizedBox(height: 3),
            // Vendor line (L24 — 11.5, text-3). Real vendor name; truck omitted
            // (no wire); unresolved vendor → em-dash.
            Text(
              row.vendorName ?? _dash,
              style: const TextStyle(
                fontSize: 11.5,
                color: JuneflowTokens.textTertiary,
              ),
            ),
            const SizedBox(height: 8),
            // Hairline footer (L25-28): the warehouse (left) has no wire → omitted;
            // the count-and-receive affordance (right) is the prototype's CTA.
            Container(
              padding: const EdgeInsets.only(top: 8),
              decoration: const BoxDecoration(
                border: Border(
                  top: BorderSide(color: JuneflowTokens.surfaceBorder),
                ),
              ),
              child: Row(
                children: <Widget>[
                  const Spacer(),
                  Text(
                    _tp('ctaReceive'),
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: JuneflowTokens.brandPrimary,
                    ),
                  ),
                  const SizedBox(width: 3),
                  const Icon(
                    Icons.chevron_right,
                    size: 13,
                    color: JuneflowTokens.brandPrimary,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 90),
      children: <Widget>[
        for (int i = 0; i < 5; i++)
          Container(
            height: 92,
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: JuneflowTokens.surfaceMuted,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JuneflowTokens.surfaceBorder),
            ),
          ),
      ],
    );
  }

  /// Honest-empty — a centered em-dash, no invented copy (web precedent B-045).
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
