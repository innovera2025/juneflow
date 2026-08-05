// Pure parse + honest derivations for the mobile executive dashboard (route
// `exec`, pototype/mobile-screens.jsx MExecDashboard L647-716). money = NONE in
// the sense that this screen ORIGINATES nothing: it displays money, and every
// figure it displays is a SERVER value read verbatim. Nothing here sums, averages,
// accumulates or otherwise derives a monetary total.
//
// No Flutter, no Dio, no i18n imports — every derivation stays unit-testable. The
// one import is the merged approvals-inbox agg, because this screen's approvals
// section reads the SAME `GET /dashboard/approvals-inbox` payload as the merged
// `inbox` screen: it reuses that module's row shape (InboxRow / parseInbox /
// formatMoney) rather than inventing a second reading of one payload.
//
// ---------------------------------------------------------------------------
// WHAT THE PROTOTYPE SHOWS vs WHAT THE WIRE CARRIES (PLAN.md §0 rule 3 + rule 4)
// ---------------------------------------------------------------------------
// The prototype is a MOCK end to end — every number on it is a literal in the
// source. Three feeds are real, and they cover exactly two of the four blocks:
//
//   GET /dashboard/summary            (apps/api/src/routes/dashboard.ts L860)
//   GET /dashboard/approvals-inbox    (dashboard.ts L862)
//   GET /boq/reports/evm              (apps/api/src/routes/boq-reports.ts L519)
//
// REAL (drawn from the wire):
//   * the S-curve            → /boq/reports/evm `series[]` (pv + ev per period).
//   * the approvals section  → /dashboard/approvals-inbox rows + their count.
//
// HONEST em-dash (no feed exists — NEVER fabricated, see BLOCKERS.md B-299):
//   * the hero's cumulative-sales figure, its units-sold ratio and its YoY delta
//     (L657-661). No endpoint serves a sales total, a unit count, or a
//     year-over-year delta. The `/sales/*` routes are per-row LIST endpoints
//     (land-sales.ts L925-930: leads / loans / bookings / contracts / downs), so
//     the only way to produce "284.5 M" from them would be to SUM booking rows in
//     the client — precisely the money-origination the iron rules forbid.
//   * all four KPI tiles (L666-669) — see kpi notes on ExecKpis below.
//   * the S-curve legend percentages "plan 65% / actual 62%" (L690-691). Percent
//     complete in EVM is EV/BAC, and BAC is a REAL stored column
//     (packages/db/src/schema/finance.ts L922, "the project total") that
//     loadEvmSeries already loads (evm-series.ts L49) — but the /boq/reports/evm
//     handler does NOT put it in its response body (boq-reports.ts evm returns
//     series/spi/cpi/currency_code only). Dividing by anything else — the
//     summary's budget_total, the series max — would be inventing a denominator,
//     so both percentages are em-dashed and B-299 files the one-field gap.
//
// The prototype's `MExec` header eyebrow is a person's name (L650) and its bell
// carries an unread DOT (L653); neither has a wire (AppServices exposes a
// bearer token, not a user profile; no unread-count feed is read here), so the
// eyebrow is omitted (the merged sales-crm precedent) and the dot is dropped — a
// dot IS the claim "you have unread notifications", and a claim cannot be
// em-dashed the way a missing value can.
import '../approvals_inbox/approvals_inbox_agg.dart';

/// An opaque contract Entity / response object — every dashboard + report payload
/// is modelled as the opaque `Entity` in openapi.yaml (no declared fields), so it
/// is read as a raw map exactly as the merged screens read theirs.
typedef ExecEnt = Map<String, Object?>;

/// Non-empty string at the first present key, else null (never "" — the view
/// em-dashes a null, and a blank is the same absence).
String? execStr(ExecEnt e, List<String> keys) {
  for (final String key in keys) {
    final Object? v = e[key];
    if (v is String && v.isNotEmpty) return v;
  }
  return null;
}

/// Finite number at the first present key, else null (absent / non-numeric /
/// NaN / infinite are all "unreadable" → the caller em-dashes or drops).
double? execNum(ExecEnt e, List<String> keys) {
  for (final String key in keys) {
    final Object? v = e[key];
    if (v is num && v.isFinite) return v.toDouble();
    if (v is String && v.isNotEmpty) {
      final double? parsed = double.tryParse(v);
      if (parsed != null && parsed.isFinite) return parsed;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /dashboard/summary
// ---------------------------------------------------------------------------

/// The ONE field this screen reads from `GET /dashboard/summary`: the id of the
/// project the dashboard is about (the caller's PRIMARY project when no
/// ?project_id is passed — dashboard.ts summary → resolvePrimaryProject).
///
/// WHY ONLY THIS FIELD. The summary payload is a BUDGET KPI set —
/// budget_total / actual_total / committed_total / remaining_total / health_score
/// plus project meta (name, type, active phase, status, as_of). The exec
/// prototype displays no budget figure and no project meta: its hero is a SALES
/// total and its tiles are cash-flow / pending-docs / deadlines / monthly sales.
/// Rendering budget_total under the hero's "cumulative sales" label would be
/// relabelling one quantity as another — a fabrication, not a port — so no
/// summary money reaches the screen.
///
/// It is still a load-bearing read, and not an ornamental one: `GET
/// /boq/reports/evm` WITHOUT a project_id returns every owned project's snapshots
/// merged into one list (evm-series.ts loadEvmSeries: `projectId ? eq(...) :
/// undefined`), which would interleave two projects' PV/EV under the same period
/// key and draw a curve that belongs to no project. Scoping the EVM read to this
/// id is what makes the S-curve a real single-project curve.
///
/// Null when the payload is unreadable or the tenant has no project (summary
/// returns `project_id: null` in that case) → the caller falls back to the
/// tenant-wide read and the S-curve renders whatever honestly exists.
String? parseSummaryProjectId(ExecEnt? body) {
  if (body == null) return null;
  return execStr(body, <String>['project_id', 'projectId']);
}

// ---------------------------------------------------------------------------
// GET /boq/reports/evm — the S-curve
// ---------------------------------------------------------------------------

/// One EVM period as the server reports it. Both values are SERVER money in the
/// series' own currency, read verbatim — the schema documents pv and ev as
/// CUMULATIVE to the period end (finance.ts L913-916), which is exactly what an
/// S-curve plots, so nothing is accumulated, interpolated or scaled here.
class EvmPoint {
  const EvmPoint({
    required this.period,
    required this.monthOrdinal,
    required this.pv,
    required this.ev,
  });

  /// The server's own `period_label` ('YYYY-MM'), rendered verbatim on the axis.
  final String period;

  /// The period's real position in time as a month count (year*12 + month-1).
  /// This is what places a point on the x axis, so a MISSING month leaves a real
  /// gap in the curve instead of being silently closed up.
  final int monthOrdinal;

  /// Planned Value, cumulative (the prototype's dashed "plan" curve).
  final double pv;

  /// Earned Value, cumulative (the prototype's solid "actual" curve). EV — not
  /// AC — is the progress counterpart of PV; AC is a COST series and the
  /// prototype draws only two curves, so drawing a third would be a redesign.
  final double ev;
}

/// Parse a 'YYYY-MM' period key into a month ordinal, or null when the label is
/// not that shape. Nothing is guessed: an unparseable label cannot be placed on a
/// time axis at all.
int? monthOrdinal(String period) {
  if (period.length != 7 || period[4] != '-') return null;
  final int? year = int.tryParse(period.substring(0, 4));
  final int? month = int.tryParse(period.substring(5, 7));
  if (year == null || month == null) return null;
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/// Parse the `series` array of `GET /boq/reports/evm` into plottable points.
///
/// A row is KEPT only when all three of its plotting facts are readable: a
/// 'YYYY-MM' period_label, a finite pv and a finite ev. A row missing any of them
/// is DROPPED rather than defaulted, because every fallback would be an invention
/// — a 0 would draw a real point on the curve that the series does not contain,
/// and an index-based x would place the point at a time it does not have. (The
/// server makes this a defensive branch only: pv/ev are NOT NULL numerics with a
/// 0 default and period is written as a 'YYYY-MM' key.)
///
/// Server order is preserved (loadEvmSeries sorts by period ASC, and for
/// 'YYYY-MM' keys a lexical sort IS chronological).
List<EvmPoint> parseEvmSeries(Object? series) {
  if (series is! List) return const <EvmPoint>[];
  final List<EvmPoint> out = <EvmPoint>[];
  for (final Object? row in series) {
    if (row is! Map) continue;
    final ExecEnt e = row.map<String, Object?>(
      (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
    );
    final String? period = execStr(e, <String>['period_label', 'periodLabel']);
    if (period == null) continue;
    final int? ord = monthOrdinal(period);
    if (ord == null) continue;
    final double? pv = execNum(e, <String>['pv']);
    final double? ev = execNum(e, <String>['ev']);
    if (pv == null || ev == null) continue;
    out.add(EvmPoint(period: period, monthOrdinal: ord, pv: pv, ev: ev));
  }
  return out;
}

/// A normalised chart coordinate. Plain data (no dart:ui here — this module stays
/// Flutter-free); [x] and [y] are both 0..1 fractions the painter maps to pixels.
class ChartXY {
  const ChartXY(this.x, this.y);

  /// 0 = the earliest plotted period, 1 = the latest, positioned by REAL elapsed
  /// months so a gap in the series is a gap on the axis.
  final double x;

  /// 0 = the value baseline, 1 = the largest value in the series. The painter
  /// flips it (screen y grows downward).
  final double y;
}

/// The S-curve's geometry, derived from the real series only.
///
/// Both curves carry exactly one vertex per SERVED point — no smoothing control
/// points, no resampling, no zero-filled periods. The painter joins the vertices
/// with straight segments precisely because a bezier (which the prototype uses,
/// L682-683) would bow the line through values the series never reported.
class EvmChartGeometry {
  const EvmChartGeometry({
    required this.plan,
    required this.actual,
    required this.todayX,
    required this.firstLabel,
    required this.lastLabel,
  });

  /// The PV vertices (prototype's dashed curve), in period order.
  final List<ChartXY> plan;

  /// The EV vertices (prototype's solid curve), in period order. Always the same
  /// length as [plan] — both come from the same kept rows.
  final List<ChartXY> actual;

  /// x of the "today" marker, or NULL when the current month falls outside the
  /// plotted range. The prototype pins this line at a fixed x (L684); here it is
  /// only ever drawn at the real position of the real current month, and when
  /// today is off the chart it is not drawn at all.
  final double? todayX;

  /// The first / last plotted period labels — the axis ends. Null when empty.
  final String? firstLabel;
  final String? lastLabel;

  /// Nothing plottable — the view renders the honest empty state, never an axis
  /// with no curve on it.
  bool get isEmpty => plan.isEmpty;

  /// A single period: there is no line to draw between two moments, so the
  /// painter marks the one real point and draws no segment (a segment would
  /// imply a second value).
  bool get isSinglePoint => plan.length == 1;
}

/// An empty geometry (no series, or nothing plottable in it).
const EvmChartGeometry kEmptyEvmGeometry = EvmChartGeometry(
  plan: <ChartXY>[],
  actual: <ChartXY>[],
  todayX: null,
  firstLabel: null,
  lastLabel: null,
);

/// Project [points] onto the unit square, and locate "today" as of [now].
///
/// x — from the real month ordinals, so the spacing between two points is the
/// real number of months between them (a skipped period leaves a wider segment,
/// never a fabricated intermediate point). A single point sits at the centre.
///
/// y — anchored at the value baseline `min(0, lowest)` and topped at
/// `max(0, highest)` across BOTH series, so a non-negative series is drawn
/// against a true zero and its shape is not exaggerated by a floating floor. A
/// completely flat series (range 0) is drawn flat on the baseline rather than
/// dividing by zero.
EvmChartGeometry evmChartGeometry(List<EvmPoint> points, DateTime now) {
  if (points.isEmpty) return kEmptyEvmGeometry;

  int minOrd = points.first.monthOrdinal;
  int maxOrd = points.first.monthOrdinal;
  double lowest = 0;
  double highest = 0;
  for (final EvmPoint p in points) {
    if (p.monthOrdinal < minOrd) minOrd = p.monthOrdinal;
    if (p.monthOrdinal > maxOrd) maxOrd = p.monthOrdinal;
    if (p.pv < lowest) lowest = p.pv;
    if (p.ev < lowest) lowest = p.ev;
    if (p.pv > highest) highest = p.pv;
    if (p.ev > highest) highest = p.ev;
  }

  final int span = maxOrd - minOrd;
  final double valueRange = highest - lowest;

  double xOf(int ord) => span == 0 ? 0.5 : (ord - minOrd) / span;
  double yOf(double v) => valueRange == 0 ? 0 : (v - lowest) / valueRange;

  final List<ChartXY> plan = <ChartXY>[];
  final List<ChartXY> actual = <ChartXY>[];
  for (final EvmPoint p in points) {
    final double x = xOf(p.monthOrdinal);
    plan.add(ChartXY(x, yOf(p.pv)));
    actual.add(ChartXY(x, yOf(p.ev)));
  }

  // The current month as an ordinal on the same axis. Drawn ONLY when it lies
  // inside the plotted range — a marker beyond the last point would assert the
  // axis extends into a period the series does not cover.
  final int todayOrd = now.year * 12 + (now.month - 1);
  final double? todayX = (todayOrd < minOrd || todayOrd > maxOrd)
      ? null
      : xOf(todayOrd);

  return EvmChartGeometry(
    plan: plan,
    actual: actual,
    todayX: todayX,
    firstLabel: points.first.period,
    lastLabel: points.last.period,
  );
}

// ---------------------------------------------------------------------------
// The KPI tiles + hero
// ---------------------------------------------------------------------------

/// The four KPI tiles (L666-669) and the hero figures (L657-661).
///
/// EVERY slot is honestly unknown, and each for its own verified reason. This
/// type exists so the gap is DECLARED in one place and the view cannot quietly
/// grow a fabricated value later:
///
///   * `cashFlow7d` (L666, "cash flow 7 days") — a 7-day cash forecast IS served,
///     by `GET /dashboard/cashflow-forecast` (dashboard.ts L865). That endpoint
///     is outside this slice's three feeds, so nothing is read for it and the
///     tile is em-dashed rather than guessed. This is the one tile that is a
///     wiring gap rather than a backend gap (B-299).
///   * `pendingDocs` (L667, "documents awaiting approval") — the only pending
///     count available is `GET /dashboard/approvals-inbox`, and that list is
///     TIER-FILTERED to what the CALLER may act on (dashboard.ts approvalsInbox →
///     callerApprovalLevel / canApprove). Its count is therefore "awaiting MY
///     approval", not "awaiting approval"; the prototype itself treats them as
///     different quantities (tile 17 vs section 3). Putting the caller's subset
///     under the unscoped label would understate the true backlog, so the tile is
///     em-dashed and the REAL count is shown where it belongs — on the section
///     that actually says "awaiting my approval" ([approvalsCount]).
///   * `projectsDue` (L668, "projects near deadline") — no endpoint returns a
///     due-soon project count.
///   * `salesMonth` (L669, "sales this month") — no sales-total endpoint exists;
///     see the module header on why summing `/sales/*` rows is forbidden.
///   * `salesCumulative` / `unitsSold` / `unitsTotal` / `yoyPercent` — the hero
///     (L657-661); same missing sales + unit feeds.
///
/// Every field is `null` today and the view renders an em-dash for each. They are
/// modelled rather than hard-coded as dashes so that the day a feed lands, the
/// wiring point is obvious and typed.
class ExecKpis {
  const ExecKpis({
    this.salesCumulative,
    this.unitsSold,
    this.unitsTotal,
    this.yoyPercent,
    this.cashFlow7d,
    this.pendingDocs,
    this.projectsDue,
    this.salesMonth,
  });

  /// Hero: cumulative sales for the year (SERVER value when one ever exists).
  final double? salesCumulative;

  /// Hero: units sold / total units.
  final int? unitsSold;
  final int? unitsTotal;

  /// Hero: year-over-year delta, in percent.
  final double? yoyPercent;

  /// Tile 1: net 7-day cash flow (SERVER value).
  final double? cashFlow7d;

  /// Tile 2: count of documents awaiting approval, tenant-wide.
  final int? pendingDocs;

  /// Tile 3: count of projects near their deadline.
  final int? projectsDue;

  /// Tile 4: sales booked this month (SERVER value).
  final double? salesMonth;
}

/// The whole screen's honest state.
class ExecDashboard {
  const ExecDashboard({
    required this.kpis,
    required this.chart,
    required this.approvals,
  });

  /// Hero + tile figures (all honestly unknown today — see [ExecKpis]).
  final ExecKpis kpis;

  /// The S-curve geometry, from the REAL EVM series.
  final EvmChartGeometry chart;

  /// The caller's pending-and-actionable docs, server order (newest first),
  /// parsed by the merged inbox agg — same payload, one reading.
  final List<InboxRow> approvals;

  /// The approvals section's count. This is the list length, which is exactly the
  /// envelope's `total`: listEnvelope sets `total = rows.length` for these
  /// single-page handlers (apps/api/src/routes/list-envelope.ts L32-38), so
  /// reading the length is not an approximation of the server's count — it IS it.
  int get approvalsCount => approvals.length;
}

/// Assemble the screen state from the payloads the three feeds return. Pure: no
/// clock of its own ([now] is injected so the "today" marker is testable and
/// never ambient).
///
/// There is no `summary` parameter on purpose. The summary payload's ONE job on
/// this screen is to yield the project id that SCOPES the EVM read
/// ([parseSummaryProjectId]), which happens in the repository before the series
/// is fetched; none of its own fields reach the view (see
/// [parseSummaryProjectId] for why its budget figures must not).
ExecDashboard buildExecDashboard({
  required Object? evmSeries,
  required List<InboxEnt> approvalRows,
  required DateTime now,
}) {
  final List<InboxRow> approvals = parseInbox(approvalRows);
  return ExecDashboard(
    kpis: const ExecKpis(),
    chart: evmChartGeometry(parseEvmSeries(evmSeries), now),
    approvals: approvals,
  );
}
