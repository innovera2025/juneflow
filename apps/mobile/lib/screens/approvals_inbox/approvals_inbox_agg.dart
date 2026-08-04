// Pure parse + honest derivations for the mobile approvals inbox (route `inbox`,
// pototype/mobile.jsx MobileApprovalInbox L24-177). money = NONE (read-only list);
// the amounts shown are SERVER values, read verbatim, never recomputed here.
//
// The prototype is a MOCK: its local `items` array (L25-30) denormalises every row
// into rich display fields — a free-text `title`, a `requester` name + avatar, a
// relative `age`, an `urgent` flag, a `project` name, and an `overBudget` banner.
// Per PLAN.md §0 rule 3 (strip mock mechanics) NONE of that denormalised display is
// reproduced. This module parses the OPAQUE Entity rows the real GET
// /dashboard/approvals-inbox handler returns (apps/api/src/routes/dashboard.ts
// approvalsInbox) into typed rows and derives ONLY what the real wire columns
// support. No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// The real wire row (dashboard.ts InboxRow) is
//   { id, kind, doc_no, title, requester, amount, currency_code, created_at, urgent }
// where `title`, `requester` and `urgent` are ALWAYS null (documented GAPs — pr/po/
// wo carry no title, no requester/created_by, and no priority column), `doc_no`,
// `amount` and `currency_code` are real-but-nullable, and `kind` is PR|PO|WO. So:
//   - title / requester / urgent  → HONEST-OMIT (never a fabricated name/flag).
//   - doc_no / amount / currency  → real; null renders an em-dash in the view.
//   - created_at (B-259)          → the row's REAL age (relativeAge below).
//   - the project NAME is NOT on the inbox row (only the doc detail carries it) →
//     the inbox card honest-omits the project line.
// Row order is preserved (the server already returns newest-first).

/// An opaque contract Entity — GET /dashboard/approvals-inbox rows are
/// `{ [k]: unknown }` (the wire models opaque Entity; no typed client fields).
typedef InboxEnt = Map<String, Object?>;

/// Non-empty string at [key] (snake_case first, camelCase fallback), else null.
String? inboxStr(InboxEnt e, List<String> keys) {
  for (final String key in keys) {
    final Object? v = e[key];
    if (v is String && v.isNotEmpty) return v;
    if (v != null && v is! String) {
      final String s = '$v';
      if (s.isNotEmpty) return s;
    }
  }
  return null;
}

/// Number at the first present [keys] as a double, or null when absent/non-numeric
/// (a PR with no priced BOQ lines returns a real null amount → the view em-dashes).
double? inboxNumOrNull(InboxEnt e, List<String> keys) {
  for (final String key in keys) {
    final Object? v = e[key];
    if (v is num) return v.toDouble();
    if (v is String && v.isNotEmpty) {
      final double? parsed = double.tryParse(v);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

/// The document kind the row carries. `other` is the honest fallback for an
/// unknown/empty kind — never guessed into a real kind.
enum InboxKind { pr, po, wo, other }

/// kind code (the wire's real "PR"/"PO"/"WO") → [InboxKind].
InboxKind inboxKindOf(String code) {
  switch (code) {
    case 'PR':
      return InboxKind.pr;
    case 'PO':
      return InboxKind.po;
    case 'WO':
      return InboxKind.wo;
    default:
      return InboxKind.other;
  }
}

/// The unit of a relative age (drives which i18n unit phrase the view appends).
enum AgeUnit { minute, hour, day }

/// A relative age split into a whole [value] and its [unit] — the view composes
/// the display string ("{value} {unit-phrase} ago") so no Thai literal lives in
/// Dart. Pure data; the number is locale-neutral, the unit word is an i18n key.
class AgeParts {
  const AgeParts(this.value, this.unit);

  /// Whole count of the unit (>= 0; a future/skewed timestamp clamps to 0).
  final int value;

  /// minute (< 1h), hour (< 1d), or day.
  final AgeUnit unit;
}

/// Derive the whole relative age of [createdAt] as of [now]. Floors to the largest
/// whole unit that fits (minutes < 60, hours < 24, else days); a timestamp in the
/// future (clock skew) clamps to 0 minutes. Honest — never rounds up into a bigger
/// unit than the elapsed time supports.
AgeParts relativeAge(DateTime createdAt, DateTime now) {
  final int totalMinutes = now.difference(createdAt).inMinutes;
  final int minutes = totalMinutes < 0 ? 0 : totalMinutes;
  if (minutes < 60) return AgeParts(minutes, AgeUnit.minute);
  final int hours = minutes ~/ 60;
  if (hours < 24) return AgeParts(hours, AgeUnit.hour);
  return AgeParts(hours ~/ 24, AgeUnit.day);
}

/// One resolved inbox row (typed projection of the opaque wire row). The mock's
/// title / requester / urgent / project / overBudget have no honest wire and are
/// simply absent here (never fabricated).
class InboxRow {
  const InboxRow({
    required this.id,
    required this.kind,
    required this.kindCode,
    required this.docNo,
    required this.amount,
    required this.currencyCode,
    required this.createdAt,
  });

  /// The doc id (pr.id / po.id / wo.id) — the seam key the PR detail push carries.
  final String id;

  /// Derived kind (drives the badge tone + the client kind-filter).
  final InboxKind kind;

  /// The wire's real kind code ("PR"/"PO"/"WO") shown in the badge (literal, no i18n).
  final String kindCode;

  /// Document number (e.g. "PR-2026-0418"), or null → the view renders an em-dash.
  final String? docNo;

  /// SERVER amount (null when a PR has no priced lines) → the view em-dashes it.
  final double? amount;

  /// Currency of [amount] (money always carries a currency), or null.
  final String? currencyCode;

  /// Parsed `created_at`, or null when absent/unparsable → the age meta is omitted.
  final DateTime? createdAt;

  /// Only a PR row opens the (PR-only) detail this wave (the prototype defines a
  /// single detail screen and it is a PR). PO/WO rows render honestly but are inert.
  bool get isTappable => kind == InboxKind.pr;
}

/// Parse one opaque Entity row into a typed [InboxRow]. A row with no id is dropped
/// by [parseInbox] (nothing honest to navigate to).
InboxRow parseInboxRow(InboxEnt e) {
  final String? code = inboxStr(e, <String>['kind']);
  final String kindCode = code ?? '';
  final String? createdRaw = inboxStr(e, <String>['created_at', 'createdAt']);
  return InboxRow(
    id: inboxStr(e, <String>['id']) ?? '',
    kind: inboxKindOf(kindCode),
    kindCode: kindCode,
    docNo: inboxStr(e, <String>['doc_no', 'docNo', 'no']),
    amount: inboxNumOrNull(e, <String>['amount']),
    currencyCode: inboxStr(e, <String>['currency_code', 'currencyCode']),
    createdAt: createdRaw == null ? null : DateTime.tryParse(createdRaw),
  );
}

/// Parse a page of opaque inbox rows into typed [InboxRow]s, preserving the server
/// order (already newest-first). Rows with no real id are dropped (nothing to act on).
List<InboxRow> parseInbox(List<InboxEnt> rows) {
  return <InboxRow>[
    for (final InboxEnt e in rows)
      if (parseInboxRow(e) case final InboxRow r when r.id.isNotEmpty) r,
  ];
}

/// The three summary chips (mobile.jsx L47-50). count + total are REAL; urgent has
/// no honest wire (the row's `urgent` is always null) so it is an HONEST 0 — never
/// the mock's fabricated "2".
class InboxSummary {
  const InboxSummary({
    required this.count,
    required this.totalAmount,
    required this.urgentCount,
  });

  /// Number of pending-and-actionable docs (list length).
  final int count;

  /// Σ of the REAL row amounts (rows with a null amount contribute 0).
  final double totalAmount;

  /// Always 0 — no urgency column exists to derive it honestly (HONEST-OMIT).
  final int urgentCount;
}

/// Summarise the rows for the header chips.
InboxSummary summarize(List<InboxRow> rows) {
  double total = 0;
  for (final InboxRow r in rows) {
    final double? a = r.amount;
    if (a != null && a.isFinite) total += a;
  }
  return InboxSummary(count: rows.length, totalAmount: total, urgentCount: 0);
}

/// Per-kind counts for the filter pills (mobile.jsx L64-69). Only the real PR/PO/WO
/// kinds are counted; `all` is the list length and `urgent` is the HONEST 0.
class InboxKindCounts {
  const InboxKindCounts({
    required this.all,
    required this.pr,
    required this.po,
    required this.wo,
  });

  final int all;
  final int pr;
  final int po;
  final int wo;

  /// The urgent pill's count — always 0 (no urgency wire; HONEST-OMIT).
  int get urgent => 0;
}

/// Count the rows per kind for the filter pills.
InboxKindCounts kindCounts(List<InboxRow> rows) {
  int pr = 0;
  int po = 0;
  int wo = 0;
  for (final InboxRow r in rows) {
    switch (r.kind) {
      case InboxKind.pr:
        pr++;
      case InboxKind.po:
        po++;
      case InboxKind.wo:
        wo++;
      case InboxKind.other:
        break;
    }
  }
  return InboxKindCounts(all: rows.length, pr: pr, po: po, wo: wo);
}

/// The active client-side filter (over the already-fetched list — an honest,
/// non-network filter, PLAN.md §0 rule 3). `urgent` is honest-empty (no urgency
/// wire → filtering to it yields the empty state, never a fabricated "urgent" set).
enum InboxFilter { all, urgent, pr, po, wo }

/// Apply [filter] to [rows]. `all` keeps everything; a kind filter keeps that kind;
/// `urgent` keeps nothing (no honest urgency signal → honest-empty).
List<InboxRow> applyFilter(List<InboxRow> rows, InboxFilter filter) {
  switch (filter) {
    case InboxFilter.all:
      return rows;
    case InboxFilter.urgent:
      return const <InboxRow>[];
    case InboxFilter.pr:
      return rows.where((InboxRow r) => r.kind == InboxKind.pr).toList();
    case InboxFilter.po:
      return rows.where((InboxRow r) => r.kind == InboxKind.po).toList();
    case InboxFilter.wo:
      return rows.where((InboxRow r) => r.kind == InboxKind.wo).toList();
  }
}

/// Group [n]'s integer magnitude with thousands separators ("902475" -> "902,475").
/// ASCII digits + comma only. Shared by [formatMoney]. Sign is the caller's.
String _groupInt(int magnitude) {
  final String digits = magnitude.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return out.toString();
}

/// Group a FULL-unit amount with thousands separators ("902475" -> "902,475"),
/// matching the prototype's fmt and the merged pr-rows.ts / pr_action formatMoney.
/// NaN / non-finite -> "0". This FORMATS a server value — it never computes a total
/// (authority = SERVER).
String formatMoney(double n) {
  if (!n.isFinite) return '0';
  final int rounded = n.round();
  final String sign = rounded < 0 ? '-' : '';
  return '$sign${_groupInt(rounded.abs())}';
}

/// A COMPACT amount for the narrow summary chip (mobile.jsx L50 shows "6.84M").
/// A value in the millions renders as "{x.xx}M" (trailing zeros trimmed) to match
/// the prototype's chip; anything smaller stays a grouped integer. Real value in,
/// lossy display out — never an invented number.
String compactMoney(double n) {
  if (!n.isFinite) return '0';
  final double abs = n.abs();
  if (abs < 1000000) return formatMoney(n);
  final String sign = n < 0 ? '-' : '';
  String m = (abs / 1000000).toStringAsFixed(2);
  if (m.contains('.')) {
    m = m.replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  }
  return '$sign${m}M';
}
