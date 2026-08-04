// Pure parse + honest derivations for the mobile store "awaiting PO receipt"
// list (route `st-grlist`, pototype/mobile-field.jsx MStGRList L6-35). money = NONE.
//
// The prototype is a MOCK: its `pos` array (L7-11) denormalises every awaiting-
// receipt PO into rich display fields — a vendor NAME, a free-text items line, a
// due-time string, a truck registration, an `urgent` flag and a warehouse label.
// Per §0 rule 3 (strip mock mechanics) NONE of that denormalised
// display is reproduced. This module parses the OPAQUE Entity rows the real
// GET /po handler returns (apps/api/src/routes/po.ts poWire) into typed rows,
// keeps only the receivable ones, and derives ONLY what the real wire supports.
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// The endpoint choice mirrors the merged web procurement port: the web GRList
// (apps/web/src/screens/gr/gr-list.tsx) reads GET /gr for RECORDED receipts, and
// surfaces the still-receivable POs through its create-form picker over GET /po
// filtered by `openAnchors` (status === "approved", gr-rows.ts). The mobile
// st-grlist IS that awaiting-receipt list (its cards are POs; tapping one starts
// the receive flow → st-receive), so the honest source is GET /po narrowed to the
// receivable (approved) POs — the SAME set the web picker offers.
//
// The real PO wire row (po.ts poWire) is
//   { id, no, pr_id, vendor_id, status, approval_step, currency_code,
//     credit_term, total, vat, amount, doc_date, paid?, deposit? }
// It carries NO line-item table (GAP 1 — po.ts header), NO due date, NO truck,
// NO urgency and NO warehouse. So:
//   - the awaiting-receipt set is DERIVED as status == "approved" (receivable;
//     the web openAnchors rule). A PO carries no received-state, so a
//     fully-received PO stays listed — a documented wire gap, never worked
//     around by inventing a "received" flag.
//   - the vendor NAME is resolved from the real `vendor_id` FK against GET
//     /vendors (vendors.ts toWire `name`) — the documented FK-as-string → real
//     id join (web gr-rows refNoMap / resolveRefNo). Unresolved → null (em-dash).
//   - the items line, due, truck, urgent pill and warehouse have NO wire → the
//     view omits them / renders an honest em-dash. No value is ever invented.
//   - money (amount/total/paid/deposit) is on the wire but is NEVER displayed
//     (money = NONE — the prototype card shows no money either).

/// An opaque contract Entity — GET /po and GET /vendors rows are `{ [k]: unknown }`.
typedef StGrEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? stGrStr(StGrEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// The lifecycle status that marks a PO as receivable ("awaiting receipt").
/// Mirrors the web GR create-picker's `openAnchors` (status === "approved").
const String kReceivableStatus = 'approved';

/// One awaiting-receipt PO (typed projection of the opaque /po wire row).
class StGrRow {
  const StGrRow({
    required this.id,
    required this.no,
    required this.vendorId,
    required this.status,
    required this.vendorName,
  });

  /// Real po id (drives the receive-flow seam).
  final String id;

  /// Real PO number (`no`), e.g. "PO-2569-0388", or "" when the server left it null.
  final String no;

  /// Real `vendor_id` FK, or "" — used to resolve the vendor name.
  final String vendorId;

  /// Real `status` — the receivable filter reads this; it is not displayed.
  final String status;

  /// Vendor name resolved from GET /vendors, or null when the vendor is not in
  /// the fetched page (→ the view renders an honest em-dash). Never invented.
  final String? vendorName;
}

/// Parse one opaque /po Entity row into a typed [StGrRow], joining the vendor
/// name from [vendorNames] (id → name). Accepts snake_case (server convention)
/// or camelCase for the multi-word key (mirrors web toGrRow robustness).
StGrRow parsePo(StGrEnt e, Map<String, String> vendorNames) {
  final String vendorId =
      stGrStr(e, 'vendor_id') ?? stGrStr(e, 'vendorId') ?? '';
  return StGrRow(
    id: stGrStr(e, 'id') ?? '',
    no: stGrStr(e, 'no') ?? '',
    vendorId: vendorId,
    status: stGrStr(e, 'status') ?? '',
    vendorName: vendorId.isEmpty ? null : vendorNames[vendorId],
  );
}

/// Build an id → vendor-name map from the opaque GET /vendors rows (vendors.ts
/// toWire carries `id` + `name`). Rows with no id/name are skipped.
Map<String, String> vendorNameMap(List<StGrEnt> vendors) {
  final Map<String, String> out = <String, String>{};
  for (final StGrEnt v in vendors) {
    final String? id = stGrStr(v, 'id');
    final String? name = stGrStr(v, 'name');
    if (id != null && name != null) out[id] = name;
  }
  return out;
}

/// Parse the GET /po page into the awaiting-receipt rows: keep only the
/// receivable (approved) POs, join their vendor names, and order by PO `no`
/// ascending (deterministic — the prototype's due/urgency order is mock data the
/// wire does not carry; a null/empty `no` sorts last). No row is fabricated.
List<StGrRow> parseAwaitingPos(List<StGrEnt> pos, List<StGrEnt> vendors) {
  final Map<String, String> names = vendorNameMap(vendors);
  final List<StGrRow> out = pos
      .map((StGrEnt e) => parsePo(e, names))
      .where((StGrRow r) => r.status == kReceivableStatus)
      .toList();
  out.sort((StGrRow a, StGrRow b) {
    if (a.no.isEmpty && b.no.isEmpty) return 0;
    if (a.no.isEmpty) return 1;
    if (b.no.isEmpty) return -1;
    return a.no.compareTo(b.no);
  });
  return out;
}
