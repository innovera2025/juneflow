// Pure parse + honest derivations for the mobile PR detail (route `detail`,
// pototype/mobile.jsx MobileApprovalDetail L179-385). money = NONE to read; the
// amount shown is the SERVER Σ, read verbatim, never recomputed here. authority
// for the approve/reject actions the sticky bar launches = SERVER (path-id only).
//
// The prototype is a MOCK: it hardcodes a full approver timeline, a "your approval
// limit" card, a BOQ budget bar, and an attachments list. Per PLAN.md §0 rule 3
// (strip mock mechanics) NONE of that is reproduced. This module parses the OPAQUE
// Entity the real GET /pr/:id handler returns (apps/api/src/routes/pr.ts prWire +
// prItemWire) into a typed projection, then derives ONLY what the real wire columns
// support. No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// The real detail wire (pr.ts) is prWire =
//   { id, no, type, project_id, need_date, status, approval_step, currency_code,
//     amount, title, phase, vendor_id, requester_id, submitted_at, approved_at,
//     vendor, requester }
// plus items[] = prItemWire { id, pr_id, boq_item_id, qty, price, amount }.
// SERVER: `amount` is the Σ of the priced lines (READ only here); the tiered
// approval decision (B-070) is the server's. Honest mapping (orch-B ruling):
//   - no / title / status / need_date / phase / amount / currency / vendor /
//     requester / items[qty, amount]  → REAL (title/need_date ARE real prWire
//     columns — the earlier "omit them" was a spec error).
//   - the status banner is pending-status ONLY (no tier number): PR approval is
//     single-shot in the backend (pending → approved sets approval_step in ONE step),
//     so a pending PR always has approval_step = 0 — the prototype's "tier 2 of 3"
//     progression is a mock the backend does not model, so no tier is shown (orch-B).
//   - project NAME: the wire carries only project_id (a uuid) — resolved to a name
//     by a client-side GET /projects join (resolveProjectName), exactly like the
//     merged web pr.form; unresolved → em-dash (never a raw uuid). `phase` IS on the
//     wire and is shown beside the name ("name · phase"), mirroring the prototype.
//   - item material NAME: NOT on the wire (only boq_item_id, a uuid) → em-dash, no
//     uuid, no join (the web does the same "WIRE GAP → em-dash").

/// An opaque contract Entity — GET /pr/:id (and GET /projects rows) are
/// `{ [k]: unknown }`.
typedef PrDetailEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? prStr(PrDetailEnt e, String key) {
  final Object? v = e[key];
  if (v is String) return v.isEmpty ? null : v;
  return null;
}

/// First non-empty string of [keys] (snake_case first, camelCase fallback), else null.
String? prStrAny(PrDetailEnt e, List<String> keys) {
  for (final String k in keys) {
    final String? v = prStr(e, k);
    if (v != null) return v;
  }
  return null;
}

/// Number at [key] as a double (JSON may serialise it as int or double), else 0.
double prNum(PrDetailEnt e, String key) {
  final Object? v = e[key];
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0;
  return 0;
}

/// A PR lifecycle status, derived from the real `status` column. `unknown` is the
/// honest fallback (the view then omits the status banner rather than guessing).
enum PrStatus { draft, pending, approved, rejected, unknown }

/// status code → [PrStatus].
PrStatus prStatusOf(String code) {
  switch (code) {
    case 'draft':
      return PrStatus.draft;
    case 'pending':
      return PrStatus.pending;
    case 'approved':
      return PrStatus.approved;
    case 'rejected':
      return PrStatus.rejected;
    default:
      return PrStatus.unknown;
  }
}

/// One PR line as the detail list reads it (real prItemWire columns only). The
/// material NAME is not on the wire (only boq_item_id, a uuid) → [name] is null and
/// the view em-dashes it; qty + amount are REAL.
class PrLineView {
  const PrLineView({
    required this.name,
    required this.qty,
    required this.amount,
  });

  /// Material name — NOT on the wire (only boq_item_id) → null → em-dash. No uuid.
  final String? name;

  /// Real line qty (unit not on the wire → the view shows the bare number).
  final double qty;

  /// Real line amount (qty × price, server-priced).
  final double amount;
}

/// Parse one opaque line row into a [PrLineView] (name is always null — no wire).
PrLineView parsePrLine(PrDetailEnt e) => PrLineView(
  name: prStr(e, 'name'), // absent on the real wire → null → em-dash.
  qty: prNum(e, 'qty'),
  amount: prNum(e, 'amount'),
);

/// A typed projection of one PR detail (only the columns the screen honestly shows).
class PrDetailView {
  const PrDetailView({
    required this.id,
    required this.no,
    required this.title,
    required this.status,
    required this.currencyCode,
    required this.amount,
    required this.requester,
    required this.vendor,
    required this.project,
    required this.phase,
    required this.needDate,
    required this.items,
  });

  /// The PR id (path id the approve/reject actions act on).
  final String id;

  /// Document number (e.g. "PR-2026-0418"), or null → em-dash.
  final String? no;

  /// Short title / material-description line (REAL prWire column), or null → the
  /// title card falls back to [no] (never a fabricated title).
  final String? title;

  /// Derived lifecycle status (drives the thin status banner).
  final PrStatus status;

  /// Currency of the server amount (money always carries a currency), or null.
  final String? currencyCode;

  /// SERVER Σ of the priced lines. READ only — never recomputed here.
  final double amount;

  /// Resolved requester display name, or null → em-dash.
  final String? requester;

  /// Resolved vendor display name, or null → em-dash.
  final String? vendor;

  /// Project display name — resolved from project_id via the GET /projects join
  /// (resolveProjectName); null when unresolved → em-dash (never the raw uuid).
  final String? project;

  /// Real `phase` string (prWire), shown beside the project name, or null.
  final String? phase;

  /// Formatted need-by date (prWire need_date), or null → em-dash.
  final String? needDate;

  /// Real priced lines (name em-dashed, qty + amount real).
  final List<PrLineView> items;

  /// Count of real lines (the honest lines-summary; the "incl VAT" clause of the
  /// i18n template is dropped by the view — no VAT breakdown is on the wire).
  int get itemCount => items.length;
}

/// Resolve a project display NAME from its uuid via the GET /projects catalogue
/// (client-join, mirrors web pr-form resolveProjectName). An empty id or an
/// unresolved id yields null → the view em-dashes it (never a raw uuid).
String? resolveProjectName(String projectId, Map<String, String> names) {
  if (projectId.isEmpty) return null;
  final String? name = names[projectId];
  return (name == null || name.isEmpty) ? null : name;
}

/// Build a project_id → name map from the opaque GET /projects rows (id + name).
Map<String, String> buildProjectNames(List<PrDetailEnt> projects) {
  final Map<String, String> map = <String, String>{};
  for (final PrDetailEnt p in projects) {
    final String? id = prStr(p, 'id');
    final String? name = prStr(p, 'name');
    if (id != null && name != null) map[id] = name;
  }
  return map;
}

/// Compose the prototype's "project · phase" line from the resolved name + phase.
/// Either part may be absent; both absent → null (the view em-dashes). The middot
/// is ASCII (U+00B7), not a Thai literal.
String? projectLine(String? name, String? phase) {
  final String? n = (name != null && name.isNotEmpty) ? name : null;
  final String? ph = (phase != null && phase.isNotEmpty) ? phase : null;
  if (n != null && ph != null) return '$n · $ph';
  return n ?? ph;
}

/// Format a wire date ("YYYY-MM-DD" or an ISO datetime) as a locale-neutral numeric
/// "d/m/yyyy" (no fabricated Thai month/era text — same numeric philosophy the notif
/// port uses). The date part is taken verbatim (before any 'T'), so no timezone
/// conversion can shift a date-only value. null/unparseable → null → em-dash.
String? formatWireDate(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final List<String> parts = raw.split('T').first.split('-');
  if (parts.length != 3) return null;
  final int? y = int.tryParse(parts[0]);
  final int? m = int.tryParse(parts[1]);
  final int? d = int.tryParse(parts[2]);
  if (y == null || m == null || d == null) return null;
  return '$d/$m/$y';
}

/// The pending banner text: the leading status clause of the resolved awaitingYou
/// template (the part before the "· tier {level} of {total}" tail). Split on the
/// ASCII middot and keep the head — the backend does not model an intermediate tier
/// (a pending PR is always approval_step 0), so no tier number is shown. Substring of
/// an existing key → zero-mint; no Thai literal here (split on the middot). Robust
/// across languages (the middot separates the status from the tier clause).
String awaitingYouLead(String awaitingYouTemplate) =>
    awaitingYouTemplate.split('·').first.trimRight();

/// Parse the opaque GET /pr/:id body into a typed [PrDetailView]. [projectNames] is
/// the GET /projects id→name catalogue for the project-name join. `null` in → `null`
/// out; a body with no real id → null (nothing honest to show/act on).
PrDetailView? parsePrDetailView(
  PrDetailEnt? e, {
  Map<String, String> projectNames = const <String, String>{},
}) {
  if (e == null) return null;
  final String id = prStr(e, 'id') ?? '';
  if (id.isEmpty) return null;
  final Object? rawItems = e['items'];
  final List<PrLineView> items = <PrLineView>[
    if (rawItems is List)
      for (final Object? it in rawItems)
        if (it is Map)
          parsePrLine(
            it.map<String, Object?>(
              (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
            ),
          ),
  ];
  final String projectId =
      prStrAny(e, <String>['project_id', 'projectId']) ?? '';
  return PrDetailView(
    id: id,
    no: prStr(e, 'no'),
    title: prStr(e, 'title'),
    status: prStatusOf(prStr(e, 'status') ?? ''),
    currencyCode: prStr(e, 'currency_code'),
    amount: prNum(e, 'amount'),
    requester: prStr(e, 'requester'),
    vendor: prStr(e, 'vendor'),
    project: resolveProjectName(projectId, projectNames),
    phase: prStr(e, 'phase'),
    needDate: formatWireDate(prStrAny(e, <String>['need_date', 'needDate'])),
    items: items,
  );
}

/// Group [magnitude] with thousands separators ("902475" -> "902,475"). ASCII only.
String _groupInt(int magnitude) {
  final String digits = magnitude.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return out.toString();
}

/// Group a FULL-unit amount ("902475" -> "902,475"); NaN/non-finite -> "0". Formats
/// a server value — never computes a total (authority = SERVER). Parity with
/// pr_action / web pr-rows formatMoney.
String formatMoney(double n) {
  if (!n.isFinite) return '0';
  final int rounded = n.round();
  final String sign = rounded < 0 ? '-' : '';
  return '$sign${_groupInt(rounded.abs())}';
}

/// Format a line qty: a whole qty groups without decimals ("1200" -> "1,200"); a
/// fractional qty keeps up to 3 trimmed decimals ("1.50" -> "1.5"). No unit (the
/// wire carries none). NaN/non-finite -> "0".
String formatQty(double n) {
  if (!n.isFinite) return '0';
  final String sign = n < 0 ? '-' : '';
  final double abs = n.abs();
  if (abs == abs.roundToDouble()) return '$sign${_groupInt(abs.round())}';
  final int whole = abs.floor();
  String frac = (abs - whole).toStringAsFixed(3).substring(1); // ".xyz"
  frac = frac.replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  return '$sign${_groupInt(whole)}$frac';
}

/// Drop the "incl VAT {vatPct}%" clause from the resolved lineCountVat template and
/// substitute the REAL [count]. The template is "{count} items · incl VAT {vatPct}%";
/// the wire carries no VAT breakdown, so only the "{count} items" head is kept
/// (split on the middot) — honest, never a hardcoded "7%". [template] is the resolved
/// i18n string; pure + testable (no Thai literal here — the caller passes the value).
String lineCountText(String template, int count) {
  final String head = template.split('·').first.trimRight();
  return head.replaceAll('{count}', '$count');
}
