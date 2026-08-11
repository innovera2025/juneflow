// ExecScreen — the mobile executive dashboard, ported from
// pototype/mobile-screens.jsx MExecDashboard (L647-716). Route `exec`
// (mobile_routes.dart; MobileSection.exec). READ-ONLY: this screen originates no
// write and no money. Every figure it shows is a SERVER value rendered verbatim;
// nothing here sums, averages or accumulates one.
//
// §0 fidelity (rule 1): the CHROME is the prototype's, block for block and in
// source order — the header (L650-654), the gradient hero card (L656-663), the
// 2x2 KPI grid (L664-679), the S-curve card (L680-693) and the "awaiting my
// approval" card (L694-711), inside a scroll padded 10/0/80 (L655). Metrics are
// the prototype's own (hero 11 / 28 / 11 text, tiles 10.5 / 20 / 10, chart 100
// high, axis 10, legend 10.5, rows 8-vertical with a dashed hairline between).
// Every colour is a generated design token (JuneflowTokens); every string is a key
// from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2, which is
// also why the baht glyph U+0E3F is resolved through `unitBaht` rather than typed).
//
// TWO COLOUR NOTES, both forced by the tokens-only rule:
//   * the hero gradient is `linear-gradient(135deg, var(--brand), #133E6B)`
//     (L656). #133E6B is a raw literal with no token, so the darker stop is
//     brandHover — the token set's own darker brand shade. Same direction, same
//     intent, entirely token-sourced; the stop is lighter than the prototype's, so
//     it is filed as a visual deviation in BLOCKERS.md B-299.
//   * the prototype's `--accent` and `--brand` resolve to the SAME value in the
//     Fiori theme this app is generated from (pototype/Juneflow Fiori.html L14),
//     so the S-curve's two strokes and the two legend swatches are all brand
//     coloured and the curves are told apart by dashing — exactly as in
//     tests/visual/reference/mobile/exec.png.
//
// WHAT IS REAL AND WHAT IS AN HONEST EM-DASH (§0 rule 3 + rule 4):
//   REAL — the S-curve (GET /boq/reports/evm, scoped to the summary's project and
//   NAMED after it) and the whole approvals card: its count (the envelope's own
//   `total`, not the rendered row count), each row's kind, document number, SERVER
//   amount and the SERVER's currency (GET /dashboard/approvals-inbox, rows parsed
//   by the merged inbox agg).
//
//   ON THE CURRENT SEED THE S-CURVE RENDERS ITS EMPTY STATE, verified live rather
//   than assumed: /dashboard/summary resolves the primary project to BBT
//   (`13ed4a49-…`, the seed's BBT project) and only project:rjp has evm_snapshot
//   so GET /boq/reports/evm?project_id=13ed4a49-… answers `{"series":[],…}`. The
//   card therefore shows its title + the named project + an em-dash. That is a
//   true statement about BBT — the curve draws as soon as the dashboard's project
//   has snapshots — and it is NOT fixed by dropping the scope (an unscoped read
//   merges every project's snapshots into one curve belonging to no project).
//   exec_agg.dart's header carries the full derivation; BLOCKERS.md B-299 files
//   the product question of which project an executive dashboard should chart.
//   EM-DASH — the hero's three figures and all four KPI values. Each has a
//   verified reason recorded on exec_agg.ExecKpis and filed in BLOCKERS.md B-299;
//   none of them is derivable from the three wired feeds without inventing a
//   number, so each kept label renders over a dash.
//   DROPPED — the header eyebrow (a person's name; no user-profile wire), the
//   bell's unread dot (a dot IS the claim "you have unread items"), the hero's
//   "+12% YoY" delta, and the per-row green APPROVE button. The button is the one
//   worth stating plainly: approving is a real capability, but it lives on the
//   merged approve/reject sheets with the tier logic, and this read screen holds
//   none of it. A button labelled "approve" that cannot approve is a promise, and
//   a promise cannot be em-dashed the way a missing value can (the pm-notes B-285
//   precedent). B-299 files it, and the bell, for a ruling.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import '../approvals_inbox/approvals_inbox_agg.dart';
import 'exec_agg.dart';
import 'exec_repository.dart';
import 'exec_scurve_painter.dart';

/// The currency code the `unitBaht` glyph (U+0E3F) actually denotes. Any OTHER
/// code the wire carries is rendered as the code itself — see [_amountText].
const String _thb = 'THB';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// The prototype's separator between a section title and its count (L694 — a
/// U+00B7 middot with ASCII spaces either side, verified codepoint-by-codepoint).
const String _mid = ' · ';

/// The prototype's up-arrow before the "today" axis marker (L687).
const String _upArrow = '↑';

/// Router entry for `exec`: resolves the shared services from [AppScope], loads the
/// screen's i18n key sidecar, then renders [ExecScreen].
class ExecScreenHost extends StatefulWidget {
  const ExecScreenHost({super.key});

  @override
  State<ExecScreenHost> createState() => _ExecScreenHostState();
}

class _ExecScreenHostState extends State<ExecScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('exec');
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
          return ExecScreen(
            repo: DioExecRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
          );
        },
      ),
    );
  }
}

/// The executive dashboard view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class ExecScreen extends StatefulWidget {
  const ExecScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.now,
  });

  final ExecRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  /// Clock for the S-curve's "today" marker. Injected in tests; the real screen
  /// reads the device clock once, at load.
  final DateTime? now;

  @override
  State<ExecScreen> createState() => _ExecScreenState();
}

class _ExecScreenState extends State<ExecScreen> {
  late final Future<ExecDashboard> _future = _load();

  /// Load the three feeds.
  ///
  /// The summary is fetched FIRST, for exactly two fields: the project id, which
  /// SCOPES the EVM read (an unscoped read interleaves every project's snapshots
  /// into one curve), and the project NAME, which labels the resulting chart so
  /// the reader knows whose curve it is. None of its money is displayed — see
  /// exec_agg.parseSummaryProjectId. A summary that fails is NOT fatal: the EVM
  /// read degrades to the tenant-wide series, the chart then carries NO project
  /// label (it cannot honestly claim one), and the approvals card is unaffected.
  Future<ExecDashboard> _load() async {
    String? projectId;
    String? projectName;
    try {
      final ExecEnt? summary = await widget.repo.summary();
      projectId = parseSummaryProjectId(summary);
      projectName = parseSummaryProjectName(summary);
    } on Object {
      projectId = null;
      projectName = null;
    }
    // Independent reads, so they go in parallel.
    final List<Object> both = await Future.wait(<Future<Object>>[
      widget.repo.evmSeries(projectId),
      widget.repo.approvals(),
    ]);
    return buildExecDashboard(
      evmSeries: both[0] as List<ExecEnt>,
      approvals: both[1] as ExecApprovals,
      now: widget.now ?? DateTime.now(),
      scopeLabel: projectName,
    );
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
            // The eyebrow is OMITTED, not em-dashed: the prototype's is a person's
            // name (L650) and no user-profile wire exists (the merged sales-crm
            // header drops its salesperson eyebrow for the same reason).
            title: _tp('title'),
            trailing: _bell(),
          ),
          Expanded(
            child: FutureBuilder<ExecDashboard>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<ExecDashboard> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    // A failed load leaves the dashboard UNKNOWN, not empty — an
                    // em-dash, never a zeroed dashboard (a zero would read as a
                    // real "nothing pending / no progress").
                    final ExecDashboard? data = snap.data;
                    if (data == null) return _unknown();
                    return _body(data);
                  },
            ),
          ),
        ],
      ),
    );
  }

  /// The header bell (L651-654): a 34px surface-3 circle. It is STATIC — a
  /// Container and an Icon, with no tap target, no Semantics and no disabled
  /// state. That matches the prototype's own behaviour: L651 is a `<button>`
  /// ELEMENT, but it carries no onClick, so it does nothing there either. The
  /// prototype paints a red UNREAD DOT on it (L653); no unread-count feed is read
  /// here and a dot IS the assertion "you have unread notifications", so the dot
  /// is dropped rather than drawn over an unknown.
  Widget _bell() {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceMuted,
        shape: BoxShape.circle,
      ),
      child: const Icon(
        Icons.notifications_none,
        size: 16,
        color: JuneflowTokens.textTertiary,
      ),
    );
  }

  Widget _body(ExecDashboard d) {
    return ListView(
      // mobile-screens.jsx L655: padding "10px 0 80px".
      padding: const EdgeInsets.only(top: 10, bottom: 80),
      children: <Widget>[
        _hero(),
        _kpiGrid(),
        _scurveCard(d),
        _approvalsCard(d),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Hero (L656-663)
  // -------------------------------------------------------------------------

  /// The gradient hero. Chrome is the prototype's; all three figures are honest
  /// em-dashes — no endpoint serves a sales total, a unit count or a YoY delta,
  /// and summing `/sales/*` rows client-side to make one would be originating
  /// money (BLOCKERS.md B-299).
  Widget _hero() {
    return Container(
      // MSection's own metrics (the prototype passes MSection a style override).
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: const LinearGradient(
          // L656: 135deg, var(--brand) -> #133E6B (no token → brandHover).
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            JuneflowTokens.brandPrimary,
            JuneflowTokens.brandHover,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            _t('heroLabel'),
            style: TextStyle(
              fontSize: 11,
              color: JuneflowTokens.shellTextStrong.withValues(alpha: 0.75),
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            _dash,
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              color: JuneflowTokens.shellTextStrong,
            ),
          ),
          const SizedBox(height: 8),
          // L660 is a "148/240" ratio followed by the `heroUnits` label; with no
          // unit feed the whole ratio is ONE em-dash rather than "—/—". L661's
          // "+12% YoY" delta is dropped (a growth claim, not a value), so what the
          // prototype lays out as a space-between pair is a single child here.
          Text(
            '$_dash ${_tp('heroUnits')}',
            style: TextStyle(
              fontSize: 11,
              color: JuneflowTokens.shellTextStrong.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // KPI grid (L664-679)
  // -------------------------------------------------------------------------

  /// The 2x2 tile grid: `gridTemplateColumns: 1fr 1fr`, gap 8, padding "0 12 8"
  /// (L664). Every VALUE is an em-dash — see exec_agg.ExecKpis for the per-tile
  /// reason. The prototype colours each value (danger / warn / accent / ok); a
  /// coloured em-dash would read as a live alarm, so an unknown value takes the
  /// tertiary text tone and the tile's tone returns with its number.
  Widget _kpiGrid() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Column(
        children: <Widget>[
          _kpiRow(
            _kpiTile(_tp('kpiCash'), _tp('unitMBaht')),
            _kpiTile(_tp('kpiPending'), _tp('unitDocs')),
          ),
          const SizedBox(height: 8),
          _kpiRow(
            _kpiTile(_tp('kpiDue'), _t('unitJobs')),
            _kpiTile(_tp('kpiSalesMonth'), _tp('unitMBaht')),
          ),
        ],
      ),
    );
  }

  /// One grid row of two equal-width tiles. [IntrinsicHeight] is what lets the
  /// pair match heights the way a CSS grid row does — a bare
  /// CrossAxisAlignment.stretch cannot, because the surrounding ListView gives
  /// the row an unbounded height to stretch into.
  Widget _kpiRow(Widget left, Widget right) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Expanded(child: left),
          const SizedBox(width: 8),
          Expanded(child: right),
        ],
      ),
    );
  }

  Widget _kpiTile(String label, String unit) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              fontSize: 10.5,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: <Widget>[
              const Text(
                _dash,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  unit,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10,
                    color: JuneflowTokens.textTertiary,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // S-curve (L680-693)
  // -------------------------------------------------------------------------

  /// The S-curve card (L680-693).
  ///
  /// The title NAMES ITS PROJECT when the summary supplied one — the prototype's
  /// bare scurveTitle plus the same U+00B7 middot separator the
  /// prototype itself uses for the "title · detail" pattern on L694, then the
  /// SERVER's own `project_name`. No key is minted for this and nothing is
  /// translated: it is one server string appended to an existing label. Without
  /// it the card is one project's curve sitting directly above a TENANT-WIDE
  /// approvals card, on an EXECUTIVE dashboard where an unattributed progress
  /// curve reads as the whole portfolio. With no readable project name the bare
  /// title ships, claiming no scope at all.
  Widget _scurveCard(ExecDashboard d) {
    final EvmChartGeometry g = d.chart;
    final String? scope = d.scopeLabel;
    return MSection(
      title: scope == null
          ? _tp('scurveTitle')
          : '${_tp('scurveTitle')}$_mid$scope',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // L681: the svg is 100 high and full width.
          SizedBox(
            height: 100,
            width: double.infinity,
            child: g.isEmpty
                // No snapshots for the project named in the title above (or
                // nothing plottable in them) — the state EVERY seeded caller
                // reaches today, because the primary project BBT has zero
                // evm_snapshot rows. An honest empty state, NEVER an axis with a
                // flat zero line drawn across it (that would assert real zero
                // progress), and never a curve borrowed from another project.
                ? const Center(
                    child: Text(
                      _dash,
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                        color: JuneflowTokens.textTertiary,
                      ),
                    ),
                  )
                : CustomPaint(painter: ExecScurvePainter(g)),
          ),
          const SizedBox(height: 4),
          if (!g.isEmpty) _axis(g),
          const SizedBox(height: 8),
          _legend(),
        ],
      ),
    );
  }

  /// The axis strip (L686-688). The prototype prints three hardcoded Thai month
  /// abbreviations with "today" fixed in the middle; here the two ends are the
  /// SERVER's own first and last `period_label` ('YYYY-MM', rendered verbatim —
  /// translating them to Thai month names would be new copy over an invented
  /// mapping), and the today marker is placed at its REAL fractional position so
  /// it lines up with the rule the painter draws. When today falls outside the
  /// plotted range the marker is absent from both the chart and this strip.
  Widget _axis(EvmChartGeometry g) {
    const TextStyle style = TextStyle(
      fontSize: 10,
      color: JuneflowTokens.textTertiary,
    );
    final double? todayX = g.todayX;
    return SizedBox(
      height: 14,
      child: Stack(
        children: <Widget>[
          Align(
            alignment: Alignment.centerLeft,
            child: Text(g.firstLabel ?? _dash, style: style),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: Text(g.lastLabel ?? _dash, style: style),
          ),
          if (todayX != null)
            Align(
              // x in 0..1 → Alignment's -1..1.
              alignment: Alignment((todayX * 2 - 1).clamp(-1.0, 1.0), 0),
              child: Text('$_upArrow${_t('today')}', style: style),
            ),
        ],
      ),
    );
  }

  /// The legend (L689-692). Both swatches are brand coloured because the
  /// prototype's --accent and --brand are the same value (see the file header);
  /// the curves are distinguished by dashing, as in the reference image. Both
  /// percentages are em-dashed: percent-complete is EV/BAC and BAC is not in the
  /// /boq/reports/evm response body, so there is no honest denominator (B-299).
  Widget _legend() {
    return Row(
      children: <Widget>[
        _legendItem(_tp('legendPlan')),
        const SizedBox(width: 12),
        _legendItem(_tp('legendActual')),
      ],
    );
  }

  Widget _legendItem(String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // L690/L691: a 12x2 swatch.
        Container(width: 12, height: 2, color: JuneflowTokens.brandPrimary),
        const SizedBox(width: 4),
        Text(
          '$label $_dash',
          style: const TextStyle(
            fontSize: 10.5,
            color: JuneflowTokens.textPrimary,
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Approvals (L694-711)
  // -------------------------------------------------------------------------

  /// "Awaiting my approval · N docs" (L694). The title's count and every row are
  /// REAL, and the count is the SERVER's: the envelope's own `total`, never the
  /// length of the list rendered below it. Those are different quantities —
  /// parseInbox drops rows with no `id`, so the rendered list is a client-filtered
  /// subset and publishing ITS length under this title would understate the
  /// backlog while presenting a client-derived number as a server fact. The
  /// endpoint's semantics ("pending AND actionable by the caller") are exactly
  /// what the title claims. A payload with no readable total leaves the count
  /// UNKNOWN — an em-dash, never a substituted length and never a zero.
  Widget _approvalsCard(ExecDashboard d) {
    final List<InboxRow> rows = d.approvals;
    final int? count = d.approvalsCount;
    return MSection(
      title:
          '${_tp('approvalsTitle')}$_mid${count ?? _dash} ${_tp('unitDocs')}',
      child: rows.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                _dash,
                style: TextStyle(
                  fontSize: 13,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                for (int i = 0; i < rows.length; i++) _approvalRow(rows[i], i),
              ],
            ),
    );
  }

  /// One approvals row (L699-709). The prototype's trailing green APPROVE button
  /// is DROPPED — see the file header. Nothing else is: the kind pill, the
  /// document number and the SERVER amount are all real wire columns, and a null
  /// doc_no or amount renders an em-dash (both are legitimately nullable).
  Widget _approvalRow(InboxRow row, int index) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // L700: a dashed hairline above every row but the first.
        if (index > 0)
          const SizedBox(
            height: 1,
            width: double.infinity,
            child: CustomPaint(painter: _DashedRulePainter()),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: <Widget>[
              MPill(label: row.kindCode, color: _kindTone(row.kind)),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      row.docNo ?? _dash,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: JuneflowTokens.brandPrimary,
                      ),
                    ),
                    Text(
                      _amountText(row),
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: JuneflowTokens.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// One row's amount, in THE CURRENCY THE SERVER SENT.
  ///
  /// money = SERVER applies to the unit as much as to the number: the wire row
  /// carries `currency_code` beside `amount` (dashboard.ts emits po.currencyCode /
  /// wo.currencyCode / the PR's derived ccy, and every money column carries a
  /// currency by iron rule), so the glyph cannot be a constant. Rendering a fixed
  /// baht glyph would print a USD purchase order as baht — the same class of error as
  /// fabricating the number.
  ///
  ///   * no amount              → em-dash (legitimately nullable: a PR with no
  ///                              priced lines has neither amount nor currency).
  ///   * amount + 'THB'         → the prototype's baht glyph (unitBaht, U+0E3F — the
  ///                              glyph that IS THB), exactly as L705 renders it.
  ///   * amount + another code  → the SERVER's code verbatim ('645,000 USD'). Not
  ///                              a translation and not a glyph table: one wire
  ///                              value, printed.
  ///   * amount, currency null  → the number ALONE. The amount is a server fact
  ///                              and stays; the currency is unknown, and naming
  ///                              one would be the invention.
  String _amountText(InboxRow row) {
    final double? amount = row.amount;
    if (amount == null) return _dash;
    final String money = formatMoney(amount);
    final String? ccy = row.currencyCode;
    if (ccy == null) return money;
    if (ccy.toUpperCase() == _thb) return '$money ${_t('unitBaht')}';
    return '$money $ccy';
  }

  /// Per-kind pill tone. The prototype maps PR->brand, BOQ->accent, WO->warn
  /// (L702); the wire only ever returns PR / PO / WO (dashboard.ts approvalsInbox
  /// builds exactly those three), so BOQ never arrives and PO — which the
  /// prototype's map has no entry for — takes the tone the merged approvals-inbox
  /// screen already gives it. One mapping for one payload, both screens.
  Color _kindTone(InboxKind kind) => switch (kind) {
    InboxKind.pr => JuneflowTokens.brandPrimary,
    InboxKind.po => JuneflowTokens.brandHover,
    InboxKind.wo => JuneflowTokens.statusWarnFg,
    InboxKind.other => JuneflowTokens.textTertiary,
  };

  // -------------------------------------------------------------------------
  // Load / failure states
  // -------------------------------------------------------------------------

  /// Skeleton blocks in the real layout's shape (the merged sales-crm precedent).
  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 80),
      children: <Widget>[
        for (final double h in <double>[96, 78, 78, 150, 150])
          Container(
            height: h,
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

  /// The dashboard could not be read — UNKNOWN, not empty.
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

/// A 1px dashed horizontal rule — the prototype's `1px dashed var(--border)` row
/// separator (L700), which Flutter's Border cannot express.
class _DashedRulePainter extends CustomPainter {
  const _DashedRulePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = JuneflowTokens.surfaceBorder
      ..strokeWidth = 1;
    const double dash = 3;
    const double gap = 3;
    for (double x = 0; x < size.width; x += dash + gap) {
      final double end = x + dash > size.width ? size.width : x + dash;
      canvas.drawLine(Offset(x, 0.5), Offset(end, 0.5), paint);
    }
  }

  @override
  bool shouldRepaint(_DashedRulePainter oldDelegate) => false;
}
