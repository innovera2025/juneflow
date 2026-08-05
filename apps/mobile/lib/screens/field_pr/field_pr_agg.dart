// Pure parse + honest derivations for the mobile quick-PR screen (route `field-pr`,
// pototype/mobile-screens.jsx MFieldQuickPR L429-478). money = SERVER — this screen
// never computes, derives, or sends a monetary amount; the only amount it ever shows
// is the one `POST /pr` returns.
//
// The prototype is a MOCK (§0 rule 3 — none of this is reproduced):
//   - the chosen BOQ (L438), the requested line (L444-447) and the reason text
//     (L461) are hardcoded strings;
//   - the "approx. price 82,000 THB" line (L447) and the amount on the CTA (L473) are
//     hardcoded money;
//   - the urgency chips (L452-453) and the photo tiles (L457-459) are static divs;
//   - the info card (L464-469) states an approval chain with a "≥ 100K" threshold;
//   - the CTA is wired to nothing at all.
//
// The real wires:
//   GET /boq                (apps/api/src/routes/boq.ts L315-359) → docWire
//     { id, no, name, scope, project_id, version, status, currency_code, total,
//       approved_by, approved_by_name, approved_at }
//   GET /boq/{id}/items     (boq.ts L466-489) → itemWire
//     { id, group_id, code, name, detail, cat, qty, unit, price, currency_code,
//       cc_id, remain_qty, element_id }
//   POST /pr                (apps/api/src/routes/pr.ts L355-467) → prWire + items
//   POST /pr/{id}/submit    (pr.ts L506-540) → draft → pending
//   No JV is posted at create — the GL entry happens at approve (pr.ts header).
//
// TWO GAPS THE SERVER LEAVES TO THE CLIENT, both surfaced rather than papered over:
//   1. `no` is REQUIRED and client-supplied (pr.ts L364, L372-374), and there is no
//      number-issuing endpoint: GET /doc-numbering returns the tenant's counters and
//      its own header says issuing-time semantics "land with the Phase-2 numbering
//      service" (doc-numbering.ts L18-19). Generating one here would invent a
//      business identifier that the tenant's numbering series owns, so the screen
//      asks the requester to enter it — a value the USER supplied, never one the app
//      made up. A collision answers 409 DUPLICATE_CODE (pr.ts L400-405) and is
//      surfaced as a failure. BLOCKERS.md B-297.
//   2. `pr.no` has NO unique index (packages/db/src/schema/boq.ts prs.no —
//      `text().notNull()`), so the duplicate check is a read-then-insert race and an
//      offline REPLAY would create a second PR. That is why this screen is
//      ONLINE-ONLY and is not enrolled in the offline queue. BLOCKERS.md B-295.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.

/// An opaque contract Entity — every row above is `{ [k]: unknown }`.
typedef FieldPrEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? fieldPrStr(FieldPrEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// Finite number at [key] (number or numeric string), else null. Never a
/// fabricated 0 — a missing quantity is unknown, not zero.
num? fieldPrNum(FieldPrEnt e, String key) {
  final Object? v = e[key];
  if (v is num) return v.isFinite ? v : null;
  if (v is String && v.trim().isNotEmpty) {
    final num? n = num.tryParse(v.trim());
    return n != null && n.isFinite ? n : null;
  }
  return null;
}

/// The PR type this screen creates.
///
/// `POST /pr` requires one of material | subcon | expense | advance | clear
/// (PR_TYPE_MAP, pr.ts L87-93) and the prototype offers NO type control — the screen
/// IS "quick purchase of a BOQ line from site", and a BOQ line is material. Fixed
/// here, in one named place, so the choice is visible rather than buried in a request
/// body; it is a reading of what the screen does, not a value invented about the data.
const String kFieldPrType = 'material';

/// One BOQ document (typed projection of the opaque docWire row).
class FieldPrBoq {
  const FieldPrBoq({
    required this.id,
    required this.no,
    required this.name,
    required this.projectId,
    required this.status,
  });

  /// Real doc id — the path id of the items read.
  final String id;

  /// Real BOQ document number, or null → em-dash. Never the uuid.
  final String? no;

  /// Real BOQ name, or null → omitted.
  final String? name;

  /// Real `project_id`. This is where the PR's own project comes from: the requester
  /// picks a BOQ, and the BOQ already knows its project — nothing is guessed and no
  /// separate project picker is invented. Empty when the wire omitted it, in which
  /// case the doc cannot anchor a PR (see [selectableBoqs]).
  final String projectId;

  /// Real `status` (draft | pending | approved | revise). Carried but NOT used as a
  /// filter: `POST /pr` imposes no BOQ-approval precondition on its lines (only
  /// `POST /boq/{id}/generate-pr` does, boq.ts L623), so narrowing the picker would
  /// be a rule this port invented.
  final String? status;
}

/// Parse one BOQ doc row.
FieldPrBoq parseBoqDoc(FieldPrEnt e) => FieldPrBoq(
  id: fieldPrStr(e, 'id') ?? '',
  no: fieldPrStr(e, 'no'),
  name: fieldPrStr(e, 'name'),
  projectId: fieldPrStr(e, 'project_id') ?? fieldPrStr(e, 'projectId') ?? '',
  status: fieldPrStr(e, 'status'),
);

/// The BOQ docs a PR can actually be raised against: those with an id AND a
/// project_id, because `POST /pr` requires a project_id and would answer
/// 400 VALIDATION without one (pr.ts L384-388). Ordered by document number (a
/// null/blank `no` sorts last) — a stable, honest presentation order.
List<FieldPrBoq> selectableBoqs(List<FieldPrEnt> rows) {
  final List<FieldPrBoq> out = rows
      .map(parseBoqDoc)
      .where((FieldPrBoq b) => b.id.isNotEmpty && b.projectId.isNotEmpty)
      .toList();
  out.sort((FieldPrBoq a, FieldPrBoq b) {
    final String an = a.no ?? '';
    final String bn = b.no ?? '';
    if (an.isEmpty != bn.isEmpty) return an.isEmpty ? 1 : -1;
    return an.compareTo(bn);
  });
  return out;
}

/// One BOQ line (typed projection of the opaque itemWire row).
class FieldPrItem {
  const FieldPrItem({
    required this.id,
    required this.code,
    required this.name,
    required this.unit,
    required this.remainQty,
  });

  /// Real item id — sent as `boq_item_id` on the PR line.
  final String id;

  /// Real item code, or null → omitted.
  final String? code;

  /// Real item name, or null → em-dash.
  final String? name;

  /// Real unit of measure, or null → omitted (never a guessed unit).
  final String? unit;

  /// Real `remain_qty` — the quantity still un-requisitioned on this BOQ line.
  /// Null when the wire omitted it → em-dash, never 0.
  final num? remainQty;

  /// NOT A FIELD — documentation of a deliberate withholding, kept next to the data
  /// it is about.
  ///
  /// itemWire carries `price` + `currency_code`, and the prototype prints an
  /// estimate beside the requested line (the "approx. price 82,000 THB" text, L447).
  /// That estimate
  /// is qty × price — a monetary total computed on the client, which money = SERVER
  /// forbids outright. The unit price is not shown either: on a screen whose next
  /// action creates a purchase requisition, a price beside a quantity reads as the
  /// requisition's value, and the requisition's value is the server's to state. It
  /// does state it: `POST /pr` returns `amount` + `currency_code` (pr.ts prWire /
  /// sumLines), and that server-computed number is the only money this screen ever
  /// displays.
  static const String estimate = 'withheld — see the doc comment';
}

/// Parse one BOQ item row.
FieldPrItem parseBoqItem(FieldPrEnt e) => FieldPrItem(
  id: fieldPrStr(e, 'id') ?? '',
  code: fieldPrStr(e, 'code'),
  name: fieldPrStr(e, 'name'),
  unit: fieldPrStr(e, 'unit'),
  remainQty: fieldPrNum(e, 'remain_qty') ?? fieldPrNum(e, 'remainQty'),
);

/// The BOQ's addressable lines, in the server's order, un-addressable rows dropped.
List<FieldPrItem> parseBoqItems(List<FieldPrEnt> rows) =>
    rows.map(parseBoqItem).where((FieldPrItem it) => it.id.isNotEmpty).toList();

/// A requested quantity parsed from the requester's input, or null when it is not a
/// number the server would accept.
///
/// `POST /pr` rejects a line whose qty is absent or negative (pr.ts L420-424), so the
/// same rule is applied here rather than sending a body that is known to fail. Zero
/// is permitted because the server permits it (`qty < 0` is the rejection); it is not
/// this screen's place to invent a stricter business rule.
num? parseRequestedQty(String raw) {
  final num? n = num.tryParse(raw.trim());
  if (n == null || !n.isFinite || n < 0) return null;
  return n;
}

/// Body for `POST /pr`.
///
/// [no] is the requester's OWN input (see the file header — there is no issuer
/// endpoint and a client-generated number would invent a business identifier).
/// [projectId] comes from the chosen BOQ doc. The single line references the chosen
/// BOQ item, which the server re-validates against this tenant's BOQ items
/// (pr.ts L428-433). `need_date` is deliberately absent: the prototype's urgency
/// chips (an "urgent, 2 days" tile and a "normal, 7 days" tile, L452-453) have no
/// column, and turning a
/// chip into `today + 2 days` would invent the mapping as well as the date.
Map<String, Object?> prPayload({
  required String no,
  required String projectId,
  required String boqItemId,
  required num qty,
}) => <String, Object?>{
  'no': no.trim(),
  'type': kFieldPrType,
  'project_id': projectId,
  'items': <Object?>[
    <String, Object?>{'boq_item_id': boqItemId, 'qty': qty},
  ],
};

/// The server-stated amount of a created PR: `{ amount, currency_code }` off the 201
/// body, or null when either half is missing (→ em-dash, never a partial or
/// reconstructed figure). This is the ONLY money this screen renders.
({num amount, String currency})? createdPrAmount(FieldPrEnt created) {
  final num? amount = fieldPrNum(created, 'amount');
  final String? currency =
      fieldPrStr(created, 'currency_code') ??
      fieldPrStr(created, 'currencyCode');
  if (amount == null || currency == null) return null;
  return (amount: amount, currency: currency);
}

/// The honest lifecycle of the two-step submission.
///
///   * [idle]      — nothing submitted yet (or the form changed since the last try).
///   * [sending]   — UI-transient, a request is in flight.
///   * [draftOnly] — `POST /pr` SUCCEEDED and `POST /pr/{id}/submit` did not. The PR
///                   EXISTS, as a draft, and must be said so: reporting a plain
///                   failure would invite the requester to raise the same PR again
///                   and — with no unique index on `pr.no` (B-295) — actually create
///                   a second one. A retry from this state re-submits the EXISTING
///                   id and never re-creates.
///   * [submitted] — both steps landed; the PR is `pending` in the approval chain.
///   * [failed]    — `POST /pr` itself did not succeed, so nothing exists.
enum FieldPrState { idle, sending, draftOnly, submitted, failed }
