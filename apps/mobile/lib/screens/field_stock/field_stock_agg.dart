// Pure parse + honest derivations for the mobile on-site material-issue screen
// (route `field-stock`, pototype/mobile-screens.jsx MFieldStock L484-528).
//
// money = NONE on the display surface and money = SERVER on the wire: this module
// never parses, derives, echoes or SENDS a monetary value. Not "does not today" —
// it has no code path that can, and the tests prove it by feeding a row whose only
// populated fields are monetary. See "THE 18,000 BAHT" below, which is the whole
// design of this screen.
//
// No Flutter, no i18n and no Dio usage here — every derivation stays
// unit-testable. The two offline imports are the queue's own value types
// (SyncOperation / DrainReport), exactly as st_receive_agg.dart takes them: the
// lifecycle resolver must speak the same types as the processor it reads, and the
// tests construct those types directly rather than through a network.
//
// ---------------------------------------------------------------------------
// THE 18,000 BAHT - WHERE IT COULD COME FROM, AND WHY THE ANSWER IS "NOWHERE"
// ---------------------------------------------------------------------------
// The prototype's CTA reads "confirm-issue - 18,000 baht" (L523) — a money total inside
// the button that posts the issue. Four facts, each verified against source this
// round, settle what happens to it:
//
//   1. THE NUMBER IS A LITERAL, NOT ARITHMETIC. The three mock rows (L499-501) are
//      `{ code, n, unit, stock, qty }` — there is NO price field anywhere in the
//      component. 18,000 is not a sum of anything on screen. Against the real seed
//      prices it is not even close (80 × 168.50 + 40 × 425 = 30,480 before sand).
//      It is a §0 rule 3 mock mechanic, like a hardcoded nav badge.
//
//   2. THE SERVER OWNS THE UNIT COST AND IGNORES ANY CLIENT FIGURE. createIssue
//      (apps/api/src/routes/inventory.ts L1180-1182) computes
//      `value = round2(Σ qty × item.price)`, resolving price from `inventory_item`
//      (L1149) — a STANDARD cost. The file's own header states it: "No handler ever
//      trusts a client-supplied value/qty-total for a computed figure."
//
//   3. NO ENDPOINT WILL PRICE A BASKET BEFORE IT IS POSTED. openapi.yaml declares
//      exactly NINE /inventory paths (items, items/{id}, warehouses, stock,
//      transfers, transfers/{id}, transfers/{id}/approve, issues, issues/{id}).
//      None is a preview / quote / dry-run. So a total shown BEFORE submit could
//      only be computed on the client.
//
//   4. THE CLIENT *COULD* COMPUTE IT — AND THAT IS EXACTLY THE DEFECT. `stockWire`
//      carries `price` (inventory.ts L389,397), so `Σ(qty × price)` is reachable
//      here in three lines. That is the B-316 A3 shape verbatim (per-line
//      `qty × price` rebuilt in the client), and STRICTLY WORSE than A3: this is
//      the number the storekeeper CONSENTS TO on a button that posts a JV
//      (Dr 1140 WIP / Cr 5020 materials-cost) and decrements the stock ledger.
//      The B-315 severity class, on a money-write.
//
// => THE NUMBER IS DROPPED. The CTA states the act with no figure. This is a
//    ruling, not a styling choice, and it is why `price`, `value` and
//    `currency_code` are NOT parsed by [parseStockLines] even though all three sit
//    on the wire it reads: an unparsed field cannot be rendered by a later edit,
//    whereas a parsed-but-unused one is one autocomplete away from the ledger.
//
// AND THE TOTAL IS NOT SHOWN AFTER THE WRITE EITHER, though it exists there. The
// 201 `issueCreateEnvelope` (inventory.ts L985-997) carries the server's own
// `value` + `jv_no`, and SyncAttempt.body surfaces it, so a post-hoc "issued for X"
// disclosure is technically reachable on the ONLINE path. It is still not rendered,
// for two reasons that compound:
//   * NO KEY. Nothing in the sacred dict labels an issued total, and this slice
//     mints nothing (PLAN.md §0 rule 2). An unlabelled currency figure on a field
//     screen is worse than none.
//   * IT WOULD BE CONDITIONAL. Through the offline queue a `deferred` outcome has
//     no response body at all, so the same successful tap would show a total when
//     online and nothing when not. A money figure that appears only sometimes
//     teaches the storekeeper to distrust the one time it matters.
// Disclosing it is a clean additive follow-up once a label key is ruled (B-328).
//
// ---------------------------------------------------------------------------
// THE MOCK (§0 rule 3 — stripped, never reproduced)
// ---------------------------------------------------------------------------
// MFieldStock takes no props, holds no state and has no `onClick` anywhere. Every
// value is a literal: the warehouse name in the eyebrow, the three material rows
// with their codes/units/on-hand/quantities, the "(3 items)" count, the
// WO · period · scope line, and the 18,000. None of it is ported. What ships is the
// same SHAPE driven by the real GET /inventory/stock + /warehouses + /projects
// wires, with every unbacked element DROPPED rather than faked.

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// An opaque contract Entity — GET /inventory/stock, /inventory/warehouses and
/// /projects rows are all `{ [k]: unknown }`.
typedef FieldStockEnt = Map<String, Object?>;

/// Non-empty string at the first matching key, else null.
String? fieldStockStr(FieldStockEnt e, List<String> keys) {
  for (final String k in keys) {
    final Object? v = e[k];
    if (v is String && v.isNotEmpty) return v;
  }
  return null;
}

/// Finite number at the first matching key (number or numeric string — numeric
/// columns cross the wire as either), else null.
///
/// NEVER falls back to 0. An on-hand the wire did not carry is UNKNOWN, and the
/// view em-dashes it; a zero would assert "this warehouse holds none of it",
/// which is a different and load-bearing claim on a screen whose whole purpose is
/// deciding how much may be taken.
double? fieldStockNum(FieldStockEnt e, List<String> keys) {
  for (final String k in keys) {
    final Object? v = e[k];
    if (v is num && v.isFinite) return v.toDouble();
    if (v is String) {
      final num? n = num.tryParse(v.trim());
      if (n != null && n.isFinite) return n.toDouble();
    }
  }
  return null;
}

/// One issuable per-(item, warehouse) balance — a typed projection of one real
/// `GET /inventory/stock` row.
///
/// DELIBERATELY CARRIES NO MONEY. The wire row it is built from has `price`,
/// `value` and `currency_code` on it (inventory.ts stockWire L382-402); this class
/// has no field for any of the three, so no view can bind one and no payload
/// builder can reach one. That absence IS the money = SERVER guarantee on this
/// screen — see the header, and `field_stock_agg_test.dart` "money".
class FieldStockLine {
  const FieldStockLine({
    required this.itemId,
    this.code,
    this.name,
    this.unit,
    this.onHand,
  });

  /// Real `inventory_item.id` — the row's stable key AND the only line identifier
  /// the write sends.
  final String itemId;

  /// Real `inventory_item.code` (the prototype's `MAT-CEM-001`).
  final String? code;

  /// Real `inventory_item.name`. Unlike st-receive, where the PR chain carries no
  /// material name at all (B-265), this IS on the wire and is normally real.
  final String? name;

  /// Real `inventory_item.unit` — the seed's bag / cubic-metre / bar units.
  final String? unit;

  /// Server-computed on-hand for this (item, warehouse): Σ(stock_ledger.qty).
  ///
  /// Null when the wire did not carry it — rendered as an em-dash, never 0.
  final double? onHand;
}

/// One staged withdrawal: an item and how much of it to take. The ONLY thing this
/// screen sends per line, and the only thing it can send — there is no field here
/// for a price, a line value or a currency.
class FieldStockPick {
  const FieldStockPick({required this.itemId, required this.qty});

  /// Real `inventory_item.id`.
  final String itemId;

  /// The quantity to issue. Always > 0 — a zero-quantity line is not staged at all
  /// ([picksFrom]), because POST /inventory/issues rejects `qty <= 0` outright
  /// (parseLines, inventory.ts L647-670) and a zero line means "not selected".
  final double qty;
}

/// Parse `GET /inventory/stock` wire rows into typed lines, preserving server
/// order (there is no ordering key on the wire, and inventing one would reshuffle
/// a list the storekeeper is reading against physical shelves).
///
/// A row with no `item_id` is skipped: it has no stable key, cannot be referred
/// back to the item it came from, and — decisively — could not be sent, since
/// `item_id` is the one field the write requires per line.
///
/// Everything else is kept even when sparse. A balance row with no name still
/// EXISTS in the warehouse; dropping it would under-report what is on the shelf.
/// It renders with em-dashes.
///
/// `price` / `value` / `currency_code` are present on this wire and are
/// deliberately NOT read — see the header, item 4.
List<FieldStockLine> parseStockLines(List<FieldStockEnt> rows) {
  final List<FieldStockLine> out = <FieldStockLine>[];
  for (final FieldStockEnt e in rows) {
    final String? itemId = fieldStockStr(e, const <String>[
      'item_id',
      'itemId',
    ]);
    if (itemId == null) continue;
    out.add(
      FieldStockLine(
        itemId: itemId,
        code: fieldStockStr(e, const <String>['item_code', 'itemCode']),
        name: fieldStockStr(e, const <String>['item_name', 'itemName']),
        unit: fieldStockStr(e, const <String>['unit']),
        onHand: fieldStockNum(e, const <String>['on_hand', 'onHand']),
      ),
    );
  }
  return out;
}

/// The `created_at` of a wire row as a comparable instant, or null.
DateTime? fieldStockCreatedAt(FieldStockEnt e) {
  final String? raw = fieldStockStr(e, const <String>[
    'created_at',
    'createdAt',
  ]);
  if (raw == null) return null;
  return DateTime.tryParse(raw);
}

/// True when (`at`, `id`) sorts ahead of (`bestAt`, `bestId`): later date first,
/// a null date always last, ties broken by the greater id. Mirrors
/// field_gr_agg's `_isNewer` — the two must not drift.
bool _isNewer(DateTime? at, String id, DateTime? bestAt, String bestId) {
  if (at == null) return false;
  if (bestAt == null) return true;
  final int c = at.compareTo(bestAt);
  if (c != 0) return c > 0;
  return id.compareTo(bestId) > 0;
}

/// Choose the warehouse this screen draws down — the prototype's eyebrow subject
/// (L487, a warehouse name) and the write's `from_warehouse_id`.
///
/// With a [warehouseId] the screen has a real subject pushed into it and uses
/// exactly that one, or NOTHING when the id is not in the tenant's page: a foreign
/// or stale id must render honest-empty, never silently draw down a DIFFERENT
/// warehouse. On a screen that decrements stock, resolving to "some other
/// warehouse" is the worst available failure.
///
/// Without one — the bare tab route — it follows the register's NEWEST warehouse
/// (the srv-track / field-gr precedent), re-derived here from `created_at` rather
/// than trusting the server's list order, so the choice is deterministic and does
/// not silently change if `listWarehouses` ever stops sorting newest-first.
FieldStockEnt? selectWarehouse(
  List<FieldStockEnt> warehouses, {
  String? warehouseId,
}) {
  if (warehouseId != null) {
    for (final FieldStockEnt w in warehouses) {
      if (fieldStockStr(w, const <String>['id']) == warehouseId) return w;
    }
    return null;
  }
  FieldStockEnt? best;
  DateTime? bestAt;
  String? bestId;
  for (final FieldStockEnt w in warehouses) {
    final String? id = fieldStockStr(w, const <String>['id']);
    if (id == null) continue;
    final DateTime? at = fieldStockCreatedAt(w);
    if (best == null || _isNewer(at, id, bestAt, bestId!)) {
      best = w;
      bestAt = at;
      bestId = id;
    }
  }
  return best;
}

/// Choose the project the material is issued against — the prototype's used-with slot
/// subject (L516) and the write's REQUIRED `project_id`.
///
/// With a [projectId], exactly that project or null (same reasoning as
/// [selectWarehouse]: charging another project's WIP is a money consequence).
///
/// Without one, the FIRST row in server order. That is not an arbitrary pick:
/// GET /projects is explicitly ordered by ENTRY order (created_at ASC) and the API
/// documents why — "the app treats the OLDEST project as the primary one
/// (dashboard.ts resolvePrimaryProject sorts created_at ASC and takes [0])"
/// (projects.ts L155-161, B-323). Taking [0] here IS resolvePrimaryProject. The
/// project wire exposes no `created_at`, so this cannot be re-derived client-side
/// the way [selectWarehouse] is; it follows the server's stated contract instead.
FieldStockEnt? selectProject(
  List<FieldStockEnt> projects, {
  String? projectId,
}) {
  if (projectId != null) {
    for (final FieldStockEnt p in projects) {
      if (fieldStockStr(p, const <String>['id']) == projectId) return p;
    }
    return null;
  }
  for (final FieldStockEnt p in projects) {
    if (fieldStockStr(p, const <String>['id']) != null) return p;
  }
  return null;
}

/// Step a staged quantity by [delta], clamped at 0.
///
/// NOT clamped at the line's on-hand, deliberately. The read balance is already
/// stale by the time it renders (the server's own guard re-reads the ledger inside
/// the transaction), so a client-side cap would assert "you may take exactly this
/// much" on the strength of a number that may have changed. Worse, it would
/// duplicate a server rule in a second place where the two can disagree. Over-ask
/// is left to the authority that can actually answer it: the negative-stock guard
/// 409s and the screen surfaces that honestly (see [FieldStockState.failed]).
double adjustPick(double current, double delta) {
  final double next = current + delta;
  return next < 0 ? 0 : next;
}

/// The staged basket, in display order: every line with a quantity > 0.
///
/// Lines the storekeeper never touched carry 0 and are NOT sent — POST
/// /inventory/issues rejects a `qty <= 0` line outright, so including them would
/// 400 the whole issue including the lines that were real.
List<FieldStockPick> picksFrom(
  List<FieldStockLine> lines,
  Map<String, double> quantities,
) {
  final List<FieldStockPick> out = <FieldStockPick>[];
  for (final FieldStockLine line in lines) {
    final double qty = quantities[line.itemId] ?? 0;
    if (qty > 0) out.add(FieldStockPick(itemId: line.itemId, qty: qty));
  }
  return out;
}

/// Whether the issue may be submitted at all.
///
/// All three are REQUIRED by the handler — `project_id` (inventory.ts L1126),
/// `from_warehouse_id` (L1128) and a non-empty `lines[]` (parseLines) each 400 when
/// absent. Gating here means the CTA is inert rather than enqueuing a write that
/// can only ever be dead-lettered: sync_processor treats every 4xx as PERMANENTLY
/// failed, so a 400 is not retried and the storekeeper would see FAILED with no
/// in-app recovery (the B-264 lesson, applied one layer earlier).
bool canSubmitIssue({
  required String? projectId,
  required String? warehouseId,
  required List<FieldStockPick> picks,
}) => projectId != null && warehouseId != null && picks.isNotEmpty;

/// The payload key naming the warehouse the issue draws down.
///
/// Named rather than inlined because it is read back OUT of a queued payload by
/// `fieldStockOpIdentity` (field_stock_repository.dart) to recognise this screen's
/// own outstanding write after a remount — `POST /inventory/issues` is the same path
/// for every warehouse, so the body is the only thing that says which shelf an op
/// belongs to. One constant, so the matcher and the builder below cannot drift.
const String kIssueFromWarehouseField = 'from_warehouse_id';

/// Build the POST /inventory/issues body.
///
/// THIS IS THE MONEY SURFACE OF THE SCREEN, and it is four keys wide:
///   { project_id, from_warehouse_id, idempotency_key, lines:[{item_id, qty}] }
///
/// What is NOT here, and why each absence is deliberate:
///   * NO `price`, `value`, `amount` or `currency_code` — the B-315 defect, which
///     reached the ledger once already. The server computes the issue's value from
///     `inventory_item.price`; anything sent from here would be a client-originated
///     money write even if the server ignored it today.
///   * NO `cc_id` — the handler accepts an optional per-line cost centre, but
///     NOTHING on mobile lists cost centres, so any value would be invented. An
///     absent cc is honest and the server handles it (a mixed/absent cc leaves the
///     summary JV's cc null, inventory.ts L1199-1203).
///   * NO `issue_date` — optional, and the device's local date is not a fact about
///     the document. Omitted, so the server's own `created_at` is the record. The
///     st_receive payload makes the same choice.
///
/// The `idempotency_key` is REQUIRED here rather than optional, because this
/// payload is replayed by the offline queue: without it, B-312's partial unique
/// index is not armed (SQL NULL is not equal to itself) and a replay posts a SECOND
/// JV and a SECOND stock decrement — the exact defect B-312 closed (on_hand 800
/// where it should have been 900). The key is the SyncOperation id, threaded from
/// one parameter, so the two cannot drift.
Map<String, Object?> buildIssuePayload({
  required String projectId,
  required String fromWarehouseId,
  required List<FieldStockPick> picks,
  required String idempotencyKey,
}) {
  return <String, Object?>{
    'project_id': projectId,
    kIssueFromWarehouseField: fromWarehouseId,
    'idempotency_key': idempotencyKey,
    'lines': <Map<String, Object?>>[
      for (final FieldStockPick p in picks)
        <String, Object?>{'item_id': p.itemId, 'qty': _wireNum(p.qty)},
    ],
  };
}

/// A whole double crosses the wire as an int (80, not 80.0); a fractional one
/// stays a double. Cosmetic only — the handler's `toNum` accepts either.
Object _wireNum(double n) =>
    n == n.roundToDouble() && n.abs() < 1e15 ? n.toInt() : n;

/// The honest lifecycle of the issue write, as the screen renders it.
///
/// The prototype's CTA has no `onClick` at all — there is no success state to
/// port, so these are derived from what the real at-least-once write can be in:
///   * [idle]       — staging quantities, nothing enqueued.
///   * [submitting] — a drain is in flight.
///   * [confirmed]  — the server durably posted the issue (2xx): stock IS cut and
///                    the JV IS posted.
///   * [queued]     — offline / transient failure: SAVED, will retry. NEVER shown
///                    as a success. This distinction is the whole reason the CTA
///                    does not borrow `inv.issueAdd.btnSubmit` ("save issue + cut
///                    stock"): on this branch nothing has been cut.
///   * [failed]     — a permanent (4xx) rejection — including the negative-stock
///                    409 — surfaced, not retried.
enum FieldStockState { idle, submitting, confirmed, queued, failed }

/// Resolve the honest post-drain state of op [opId] from the drain [report] and
/// the ops still [due] in the queue (pending + failed).
///
/// The report is authoritative when it touched the op this pass. When it did not
/// (a re-entrant drain was guarded out, or an earlier pass already handled it), the
/// queue is the source of truth: an op that is gone was synced; a `failed` op is a
/// permanent dead-letter; a `pending` op is still queued. Mirrors
/// st_receive_agg.resolveReceiveState / pm_checkin_agg.resolveCheckinState — the
/// three must not drift, so this is the SAME shape over the same types rather than
/// a structural re-encoding of them.
FieldStockState resolveIssueState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return FieldStockState.confirmed;
      case SyncOutcome.permanentlyFailed:
        return FieldStockState.failed;
      case SyncOutcome.deferred:
        return FieldStockState.queued;
    }
  }
  SyncOperation? mine;
  for (final SyncOperation op in due) {
    if (op.id == opId) {
      mine = op;
      break;
    }
  }
  // Removed from the queue = synced.
  if (mine == null) return FieldStockState.confirmed;
  return mine.status == SyncOpStatus.failed
      ? FieldStockState.failed
      : FieldStockState.queued;
}

/// Group [magnitude] with thousands separators ("1240" -> "1,240"). ASCII only.
String _groupInt(int magnitude) {
  final String digits = magnitude.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return out.toString();
}

/// Format a quantity: a whole qty groups without decimals ("1240" -> "1,240"); a
/// fractional one keeps up to 3 trimmed decimals ("1.50" -> "1.5"). Parity with
/// st_receive_agg / field_gr_agg / pr_detail_agg formatQty — the four must not
/// drift. NaN/non-finite -> "0".
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
