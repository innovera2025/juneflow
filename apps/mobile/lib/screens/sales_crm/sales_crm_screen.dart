// SalesCrmScreen — the mobile Sales CRM pipeline read, ported from
// pototype/mobile-screens.jsx MSalesCRM (L722-771). Route `sales-crm`
// (mobile_routes.dart; MobileSection.exec). money = NONE (read-only).
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow-less
// large title + a round add action), the horizontal stage-chip strip (each chip a
// label + a count badge, the active one brand-filled), and the tone-accented lead
// card list (an initials avatar · name · interest · a warmth badge · a note box ·
// a warmth-tinted left accent). Every colour / space is a generated design token
// (JuneflowTokens); every UI string is an i18n key from the sidecar (no Thai byte
// in this file — i18n-guard, §0 rule 2). The bottom tab bar is drawn by the shell
// (mobile_shell.dart), not here.
//
// Data (§0 rule 3): the prototype's hardcoded stage counts (12/5/3/2/1) and its
// fixed 3-lead list are mock mechanics and are DROPPED. The board is the REAL GET
// /sales/leads read (sales_crm_repository.dart); the chip counts + the card content
// are honestly derived from the real wire columns only (sales_crm_agg.dart), never a
// fabricated lead or number. The chips filter the already-fetched rows client-side by
// their real `stage` column (a pure view operation over real data, not a server call).
//
// HONEST DIVERGENCES (rule 4 — never fabricated; mirroring the merged web port
// apps/web/src/screens/sales/sales-crm.tsx):
//   - stages: the real server funnel (lead|visit|quote|booking|contract) replaces the
//     mock's own 5-step funnel chips (which carry a transfer stage the server enum
//     lacks and drop the quote stage). Server truth wins, as the web port ruled.
//   - the "my pipeline" framing cannot be honestly scoped to the current sales rep:
//     the mobile shell has no current-user wire and the server has no "my-leads"
//     filter, so ALL tenant leads are shown (the read is already tenant-scoped). The
//     mock header identity (a fabricated sales-rep name + role) is OMITTED (no eyebrow).
//   - the header "+" (add lead), and the per-lead call/LINE/visit buttons, are WRITE /
//     device actions out of this read screen's scope → the add button is honest-DISABLED
//     and the per-lead action row is OMITTED (an input that acts nowhere would be a fake
//     mechanic, as the approve screen omitted its note field).
//   - warmth is the real 3-state SA-1 column; the badge + left accent show hot/warm/cold
//     from the real value and NOTHING for an unknown one (no invented warmth).
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'sales_crm_agg.dart';
import 'sales_crm_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `sales-crm`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [SalesCrmScreen]. The sidecar
/// load is the only async step; a plain surface shows for the frame it takes.
class SalesCrmScreenHost extends StatefulWidget {
  const SalesCrmScreenHost({super.key});

  @override
  State<SalesCrmScreenHost> createState() => _SalesCrmScreenHostState();
}

class _SalesCrmScreenHostState extends State<SalesCrmScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('sales_crm');
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
        return SalesCrmScreen(
          repo: DioSalesLeadsRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The Sales CRM view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class SalesCrmScreen extends StatefulWidget {
  const SalesCrmScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final SalesLeadsRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<SalesCrmScreen> createState() => _SalesCrmScreenState();
}

class _SalesCrmScreenState extends State<SalesCrmScreen> {
  late Future<List<LeadRow>> _future;

  /// The funnel stage the chip strip currently selects (default = the first stage,
  /// matching the prototype's active "Lead" chip). Pure client-side view state.
  LeadStage _active = kLeadStages.first;

  @override
  void initState() {
    super.initState();
    _future = widget.repo.list().then(parseLeads);
  }

  /// Resolve a DICT stable key from the sidecar (t layer).
  String _t(String field) => widget.i18n.t(widget.strings[field]);

  /// Resolve a PHRASES key from the sidecar (tp layer — the Thai phrase IS the key).
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// The sidecar field holding the dict label for [stage].
  String _stageLabel(LeadStage stage) {
    switch (stage) {
      case LeadStage.lead:
        return _t('stageLead');
      case LeadStage.visit:
        return _t('stageVisit');
      case LeadStage.quote:
        return _t('stageQuote');
      case LeadStage.booking:
        return _t('stageBooking');
      case LeadStage.contract:
        return _t('stageContract');
    }
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            title: _tp('title'),
            // Add-lead is a write, out of this read screen's scope → disabled.
            trailing: _addButtonDisabled(),
          ),
          Expanded(
            child: FutureBuilder<List<LeadRow>>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<List<LeadRow>> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    final List<LeadRow> rows = snap.data ?? const <LeadRow>[];
                    final List<LeadRow> shown = leadsInStage(rows, _active);
                    return Column(
                      children: <Widget>[
                        _stageBar(rows),
                        Expanded(
                          child: shown.isEmpty ? _empty() : _list(shown),
                        ),
                      ],
                    );
                  },
            ),
          ),
        ],
      ),
    );
  }

  /// The header "+" add action, rendered for chrome fidelity but honest-DISABLED
  /// (no onTap, dimmed) — the add-lead write is out of this read screen's scope.
  Widget _addButtonDisabled() {
    return Opacity(
      opacity: 0.4,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: JuneflowTokens.brandPrimary,
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.add,
          size: 18,
          color: JuneflowTokens.shellTextStrong,
        ),
      ),
    );
  }

  /// The horizontal stage-chip strip (mobile-screens.jsx L731-742). Each chip carries
  /// the real dict label + the real per-stage count; the active chip is brand-filled.
  /// Tapping a chip filters the list to that stage (client-side, over real rows).
  Widget _stageBar(List<LeadRow> rows) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: <Widget>[
            for (int i = 0; i < kLeadStages.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 6),
              _stageChip(
                kLeadStages[i],
                stageCount(rows, kLeadStages[i]),
                active: kLeadStages[i] == _active,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _stageChip(LeadStage stage, int count, {required bool active}) {
    final Color fg = active
        ? JuneflowTokens.shellTextStrong
        : JuneflowTokens.textSecondary;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {
        if (stage != _active) setState(() => _active = stage);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active
              ? JuneflowTokens.brandPrimary
              : JuneflowTokens.surfaceMuted,
          borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              _stageLabel(stage),
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: fg,
              ),
            ),
            const SizedBox(width: 5),
            _countBadge(count, active: active),
          ],
        ),
      ),
    );
  }

  Widget _countBadge(int count, {required bool active}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: active
            ? JuneflowTokens.shellTextStrong.withValues(alpha: 0.25)
            : JuneflowTokens.surfaceBorder,
        borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
      ),
      child: Text(
        '$count',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: active
              ? JuneflowTokens.shellTextStrong
              : JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  Widget _list(List<LeadRow> rows) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 90),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One lead card (mobile-screens.jsx L748-767), honest-derived: an initials avatar,
  /// the real name + interest, a warmth badge, an optional note box, and a warmth-tinted
  /// left accent. The prototype's call/LINE/visit action row is omitted (out of read
  /// scope — see file header).
  Widget _card(LeadRow l) {
    final Color? accent = _warmthTone(l.warmth);
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // Warmth left accent (mobile-screens.jsx L752 borderLeft) — only when the
            // real warmth is known; unknown warmth gets no accent (never invented).
            if (accent != null)
              SizedBox(width: 3, child: ColoredBox(color: accent)),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        _avatar(l.name),
                        const SizedBox(width: 10),
                        Expanded(child: _nameBlock(l)),
                        if (_warmthBadge(l.warmth) case final Widget badge) ...[
                          const SizedBox(width: 8),
                          badge,
                        ],
                      ],
                    ),
                    if (l.note != null) ...<Widget>[
                      const SizedBox(height: 8),
                      _noteBox(l.note!),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _nameBlock(LeadRow l) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          l.name ?? _dash,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.textPrimary,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          l.interest ?? _dash,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 10.5,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ],
    );
  }

  Widget _noteBox(String note) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        note,
        style: const TextStyle(
          fontSize: 10.5,
          height: 1.4,
          color: JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  /// A 36px initials avatar (mobile-screens.jsx `Avatar`). Initials are the first
  /// grapheme of each of the first two name words — real data, computed at runtime
  /// (no source literal); a blank name yields an empty disc, never an invented one.
  Widget _avatar(String? name) {
    return Container(
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: JuneflowTokens.brandPrimary,
        shape: BoxShape.circle,
      ),
      child: Text(
        _initials(name),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: JuneflowTokens.shellTextStrong,
        ),
      ),
    );
  }

  /// The warmth badge (mobile-screens.jsx L757 MPill) — hot/warm/cold from the real
  /// column; null (no badge) for an unknown warmth (never invented).
  Widget? _warmthBadge(LeadWarmth warmth) {
    final String? field = switch (warmth) {
      LeadWarmth.hot => 'warmthHot',
      LeadWarmth.warm => 'warmthWarm',
      LeadWarmth.cold => 'warmthCold',
      LeadWarmth.unknown => null,
    };
    final Color? tone = _warmthTone(warmth);
    if (field == null || tone == null) return null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        // color-mix(in srgb, tone 14%, surface) — a 14% tint of the tone.
        color: Color.alphaBlend(
          tone.withValues(alpha: 0.14),
          JuneflowTokens.surfaceCard,
        ),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        _t(field),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: tone,
        ),
      ),
    );
  }

  /// The warmth tone (badge fg + left accent). null for unknown warmth → no accent.
  Color? _warmthTone(LeadWarmth warmth) {
    switch (warmth) {
      case LeadWarmth.hot:
        return JuneflowTokens.statusDangerFg;
      case LeadWarmth.warm:
        return JuneflowTokens.statusWarnFg;
      case LeadWarmth.cold:
        return JuneflowTokens.statusInfoFg;
      case LeadWarmth.unknown:
        return null;
    }
  }

  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
      children: <Widget>[
        for (int i = 0; i < 5; i++)
          Container(
            height: 68,
            margin: const EdgeInsets.only(bottom: 6),
            decoration: BoxDecoration(
              color: JuneflowTokens.surfaceMuted,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JuneflowTokens.surfaceBorder),
            ),
          ),
      ],
    );
  }

  /// Honest-empty — the real "no lead" line for a stage with no leads (existing dict
  /// key sales.crm.emptyNoLead), no invented copy.
  Widget _empty() {
    return Center(
      child: Text(
        _t('empty'),
        style: const TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
          color: JuneflowTokens.textTertiary,
        ),
      ),
    );
  }
}

/// First grapheme of each of the first two whitespace-separated words of [name].
/// Runtime-derived from the real name column (never a source literal).
String _initials(String? name) {
  if (name == null) return '';
  final List<String> parts = name.trim().split(RegExp(r'\s+'))
    ..removeWhere((String p) => p.isEmpty);
  final StringBuffer buf = StringBuffer();
  for (final String p in parts.take(2)) {
    if (p.runes.isNotEmpty) buf.writeCharCode(p.runes.first);
  }
  return buf.toString();
}
