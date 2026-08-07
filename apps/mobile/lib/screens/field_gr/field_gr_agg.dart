// Pure parse + honest derivations for the mobile site goods-receipt screen
// (route `field-gr`, pototype/mobile-screens.jsx MFieldGR L364-423).
// money = NONE, on both the display surface and the wire: this module never
// parses, derives, echoes or sends a monetary value. See "MONEY" below.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A READ, NOT A CREATE (the fork, and the ground truth that settles it)
// ---------------------------------------------------------------------------
// B2 and F2 (`st-receive`, mobile-field.jsx MStReceive) are two different acts on
// the same document, not one screen twice. F2 ENTERS counts: one card per line
// with a +/-10 stepper (L69-75), a live-derived short/over line (L76), one CTA
// whose tone switches (L86) and a full-screen success takeover (L49-56). B2 has
// NONE of those: its rows are read-only `got / ord unit` (L386-389) inside a
// single received-items section, and it adds a vendor block, a QC checklist, a
// photo gallery and a two-button footer that F2 does not have.
//
// The structural fact that decides it: **B2 has no input control of any kind, yet
// it displays a partial receipt** — row 3 is `{ ord: 320, got: 280, short: true }`
// (L384). A create surface that cannot enter a count can only ever post a FULL
// receipt, so under a create reading the screen could never render its own
// headline state. The 280/320 has to be data that already exists.
//
// And it does. `grItemWire` (apps/api/src/routes/gr.ts L149-160) is
//   { id, name, boq_item_id, ordered_qty, received_qty, unit, price, currency_code }
// — a 1:1 shape match with the prototype row's `{ n, ord, got, unit }`, and the
// ONLY place in the system carrying all four together. Three more confirmations:
//   * the section title is byte-exactly the dict key
//     `gr.list.receivedItems` — a gr.list.* (READ) key. The create surface uses
//     `gr.create.colOrdered` / `colReceived` instead.
//   * the seed comment (packages/db/src/seed/index.ts L541) calls GR_ITEM_LINES
//     "gr.jsx's static received-items array" — the same section.
//   * the footer's return/reject button maps onto POST /gr/:id/return (gr.ts L727,
//     whose own comment cites the gr.jsx return action) — defined on an EXISTING
//     receipt, not on a draft.
// while the sign-receipt CTA has no endpoint at all: openapi.yaml declares /gr,
// /gr/{id}/return and /gr/{id}/cancel, and boq.ts L466-468 states outright that
// "there is NO GR approval endpoint in the contract". A GR is `received` the
// moment it exists (gr schema default, boq.ts L475-500) — the signing is already
// done by the time this screen can show the document.
//
// So this screen REVIEWS a recorded receipt. That reading is also the only one
// that makes the port worth having: it is the sole mobile surface that can show
// REAL material names and units, which F2 provably cannot (BLOCKERS.md B-265 —
// the PR chain carries neither, and the BOQ fan-out that would resolve them is
// an unbounded 1+1+N). The fork itself is raised as B-324 for a Wei ruling.
//
// ---------------------------------------------------------------------------
// THE MOCK (§0 rule 3 — stripped, never reproduced)
// ---------------------------------------------------------------------------
// MFieldGR takes no props and reads no state. Every value on it is a literal:
// the PO number and vendor name, the delivery date and delivery-note number, the
// three material lines with their quantities, the `short: true` flag and its
// shortfall caption, four permanently-ticked QC rows, and three
// grey gradient rectangles standing in for photographs. None of that is ported.
// What ships is the same SHAPE driven by the real GET /gr wire, with every
// unbacked element dropped rather than faked (see WHAT IS DROPPED, in the screen).
//
// ---------------------------------------------------------------------------
// MONEY = NONE
// ---------------------------------------------------------------------------
// Grepping L364-423 for a currency glyph, a value label, `amount` or `price` returns
// nothing: every number on this screen is a quantity. `grItemWire` DOES carry
// `price` and `currency_code`, and `grWire` derives the receipt's money from them
// as Σ(received_qty × price) — this module parses none of the three. There is no
// write path here either (see field_gr_repository.dart), so the F2 money trap
// (B-267: a client-sent `price` originates the receipt's value; a named line with
// no price persists `price '0.00'` and prints a fabricated literal `0` in the
// merged web list) cannot arise: nothing is sent at all.
//
// ---------------------------------------------------------------------------
// WHAT THE WIRE DOES NOT CARRY (honest-omit, never defaulted)
// ---------------------------------------------------------------------------
//   * delivery DATE — the prototype's shipped-on line (L373). `po` has no
//     delivery/expected/due column (boq.ts L354-372) and `grWire.date` is
//     `gr.created_at`, the RECEIPT date. Printing the receipt date under a
//     "delivered on" label is a semantic fabrication, so the line is dropped.
//   * delivery-note NUMBER — the DO-CPC-184 half of L373. No column anywhere;
//     `gr.no` is the GR's own number and is client-supplied + nullable.
//   * QC results — no field on POST /gr, no column on `gr`, no table. See B-324.
//   * per-line quantities are parsed as nullable and NEVER defaulted to 0: a
//     missing ordered quantity is unknown, not "nothing was ordered".

/// An opaque contract Entity — GET /gr, /po and /wo rows are `{ [k]: unknown }`.
typedef FieldGrEnt = Map<String, Object?>;

/// The receipt status in which this screen's chrome is unconditionally true.
///
/// The prototype gives this screen NO status pill and no lifecycle affordance of
/// any kind, so it has no way to say "this receipt was returned" or "…cancelled".
/// Its own section title asserts *items received*. Rendering a
/// `returned` or `cancelled` receipt under that heading, with nothing on screen
/// to qualify it, would silently misstate the document. So selection is confined
/// to the state the server itself assigns on arrival (gr schema default). This is
/// read off the prototype's copy, not a rule invented here.
const String kFieldGrReceivedStatus = 'received';

/// Non-empty string at the first matching key, else null.
String? fieldGrStr(FieldGrEnt e, List<String> keys) {
  for (final String k in keys) {
    final Object? v = e[k];
    if (v is String && v.isNotEmpty) return v;
  }
  return null;
}

/// Finite number at the first matching key (number or numeric string — numeric
/// columns cross the wire as either), else null.
///
/// Never falls back to 0. A quantity the wire did not carry is ABSENT, and the
/// view em-dashes it; a zero would assert a measurement that was never taken.
double? fieldGrNum(FieldGrEnt e, List<String> keys) {
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

/// How a received quantity compares with the ordered quantity — the prototype's
/// per-line colour signal (L386: danger when `short`, ok otherwise).
enum FieldGrDelta {
  /// received < ordered (the prototype's `short: true`).
  short,

  /// received == ordered.
  exact,

  /// received > ordered. The prototype has no example; the real wire permits it
  /// (both columns are free numerics), so it is classified rather than folded
  /// into [exact], which would paint an over-receipt as if it matched the order.
  over,

  /// Either quantity is absent — nothing can be compared, and the row must NOT
  /// be tinted as if it had been. Distinct from [exact] on purpose.
  unknown,
}

/// One received line — a typed projection of one real `gr_item` row.
///
/// Every field is nullable because every one of them is nullable at the source:
/// `gr_item.name` / `.unit` are TEXT columns with no NOT NULL, and a wire row
/// that omits a quantity has none. The view renders an em-dash per absent field,
/// independently — a line with a name but no unit still shows its name.
class FieldGrLine {
  const FieldGrLine({
    required this.id,
    this.name,
    this.orderedQty,
    this.receivedQty,
    this.unit,
  });

  /// Real `gr_item.id` — the row's stable key.
  final String id;

  /// Real material name (`gr_item.name`). Unlike st-receive, where the PR chain
  /// carries no name at all (B-265), this IS on the wire and is normally real.
  final String? name;

  /// Real ordered quantity (`gr_item.ordered_qty`).
  final double? orderedQty;

  /// Real received quantity (`gr_item.received_qty`).
  final double? receivedQty;

  /// Real unit of measure (`gr_item.unit`) — the seed's bag / bar units.
  final String? unit;

  /// The prototype's per-line comparison (L386 `it.short`), extended with the
  /// honest [FieldGrDelta.unknown] case the mock cannot have.
  FieldGrDelta get delta {
    final double? ord = orderedQty;
    final double? got = receivedQty;
    if (ord == null || got == null) return FieldGrDelta.unknown;
    if (got < ord) return FieldGrDelta.short;
    if (got > ord) return FieldGrDelta.over;
    return FieldGrDelta.exact;
  }

  /// The absolute shortfall (`ordered - received`) when this line is genuinely
  /// short, else null.
  ///
  /// This is the NUMBER behind the prototype's shortfall caption
  /// (L384). The caption's WORDS are not rendered: its shortfall word has two dict
  /// matches — `labor.att.optAbsent` ("absent from work") and `inv.status.out`
  /// ("out of stock") — that read correctly in Thai today and would translate
  /// WRONGLY once en/zh/ar land, and `partial` has no key at all. `st-receive`
  /// refused the same word for the same reason. So the delta ships as a signed
  /// quantity in the prototype's own danger tone, which carries the meaning with
  /// no copy, and both words go on the mint list (B-324).
  double? get shortfall {
    if (delta != FieldGrDelta.short) return null;
    return orderedQty! - receivedQty!;
  }
}

/// A recorded receipt as this screen shows it.
class FieldGrReceipt {
  const FieldGrReceipt({
    required this.id,
    required this.lines,
    this.anchorNo,
    this.vendor,
  });

  /// Real `gr.id`.
  final String id;

  /// The received lines, in the server's own order (there is no ordering key on
  /// the wire, and inventing one would reorder a document the site reads against
  /// a physical delivery).
  final List<FieldGrLine> lines;

  /// The anchor document's human number — `po.no` or `wo.no`, resolved from the
  /// receipt's `po_id` / `wo_id` FK. Null when the anchor is not in the fetched
  /// page → the header eyebrow em-dashes. The raw uuid is NEVER shown dressed up
  /// as a document number (the pm-close precedent).
  final String? anchorNo;

  /// Vendor name, resolved SERVER-side (`grWire.vendor`, gr.ts L206-219 walks
  /// gr → po/wo → vendor). Null when the chain does not resolve → em-dash.
  final String? vendor;
}

/// Read the `items[]` array off an opaque GET /gr row as raw wire rows.
List<FieldGrEnt> grItemsOf(FieldGrEnt gr) {
  final Object? raw = gr['items'];
  if (raw is! List) return const <FieldGrEnt>[];
  return <FieldGrEnt>[
    for (final Object? item in raw)
      if (item is Map)
        item.map<String, Object?>(
          (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
        ),
  ];
}

/// Parse `items[]` wire rows into typed lines, preserving server order.
///
/// A row with no `id` is skipped — it has no stable key, and a keyless row in a
/// goods-receipt list cannot be referred back to the record it came from.
/// Everything else is kept even when sparse: a line whose name or quantities are
/// absent still EXISTS on the receipt, and dropping it would under-report the
/// document. It renders with em-dashes instead.
///
/// `price` and `currency_code` are present on this wire and are deliberately not
/// read — money = NONE (see the header).
List<FieldGrLine> parseGrLines(List<FieldGrEnt> items) {
  final List<FieldGrLine> out = <FieldGrLine>[];
  for (final FieldGrEnt e in items) {
    final String? id = fieldGrStr(e, const <String>['id']);
    if (id == null) continue;
    out.add(
      FieldGrLine(
        id: id,
        name: fieldGrStr(e, const <String>['name']),
        orderedQty: fieldGrNum(e, const <String>['ordered_qty', 'orderedQty']),
        receivedQty: fieldGrNum(e, const <String>[
          'received_qty',
          'receivedQty',
        ]),
        unit: fieldGrStr(e, const <String>['unit']),
      ),
    );
  }
  return out;
}

/// Build the anchor-number lookup (`id` -> `no`) from the tenant's PO and WO wire
/// rows, so a receipt's `po_id` / `wo_id` FK can be shown as a human document
/// number. The FK-as-string → real-id join the st-grlist vendor map already uses.
///
/// A document with no `no` contributes no entry: the map's absence is what makes
/// the header em-dash, and mapping an id to an empty string would print a blank
/// where an honest dash belongs.
Map<String, String> buildAnchorNoMap(List<FieldGrEnt> docs) {
  final Map<String, String> out = <String, String>{};
  for (final FieldGrEnt e in docs) {
    final String? id = fieldGrStr(e, const <String>['id']);
    final String? no = fieldGrStr(e, const <String>['no']);
    if (id != null && no != null) out[id] = no;
  }
  return out;
}

/// The anchor FK of a receipt: its `po_id`, or its `wo_id` when it hangs off a
/// work order instead. Null when neither resolves.
String? anchorIdOf(FieldGrEnt gr) =>
    fieldGrStr(gr, const <String>['po_id', 'poId']) ??
    fieldGrStr(gr, const <String>['wo_id', 'woId']);

/// The `date` of a receipt (`gr.created_at`) as a comparable instant, or null.
///
/// Used ONLY to order the register for [selectReceipt]. It is never displayed:
/// the prototype's only date is a DELIVERY date (L373) and this is the RECEIPT
/// date — see the header.
DateTime? receiptDateOf(FieldGrEnt gr) {
  final String? raw = fieldGrStr(gr, const <String>[
    'date',
    'created_at',
    'createdAt',
  ]);
  if (raw == null) return null;
  return DateTime.tryParse(raw);
}

/// Choose the receipt to show.
///
/// With a [grId] the screen has a real subject pushed into it and shows exactly
/// that one — or nothing, when the id is not in the tenant's page (a foreign or
/// stale id must render honest-empty, never a different receipt).
///
/// Without one — the bare tab route — it follows the register's NEWEST receipt,
/// the srv-track precedent. "Newest" is by [receiptDateOf] descending, with the
/// id as a total-order tiebreak so the choice is deterministic when two receipts
/// share a timestamp (a seeded batch does) and a row with no parseable date sorts
/// last rather than winning by accident.
///
/// Only [kFieldGrReceivedStatus] rows are eligible — see that constant.
FieldGrEnt? selectReceipt(List<FieldGrEnt> grs, {String? grId}) {
  if (grId != null) {
    for (final FieldGrEnt gr in grs) {
      if (fieldGrStr(gr, const <String>['id']) == grId) return gr;
    }
    return null;
  }
  FieldGrEnt? best;
  DateTime? bestAt;
  String? bestId;
  for (final FieldGrEnt gr in grs) {
    final String? status = fieldGrStr(gr, const <String>['status']);
    if (status != kFieldGrReceivedStatus) continue;
    final String? id = fieldGrStr(gr, const <String>['id']);
    if (id == null) continue;
    final DateTime? at = receiptDateOf(gr);
    if (best == null) {
      best = gr;
      bestAt = at;
      bestId = id;
      continue;
    }
    if (_isNewer(at, id, bestAt, bestId!)) {
      best = gr;
      bestAt = at;
      bestId = id;
    }
  }
  return best;
}

/// True when (`at`, `id`) sorts ahead of (`bestAt`, `bestId`): later date first,
/// a null date always last, ties broken by the greater id.
bool _isNewer(DateTime? at, String id, DateTime? bestAt, String bestId) {
  if (at == null) return false;
  if (bestAt == null) return true;
  final int c = at.compareTo(bestAt);
  if (c != 0) return c > 0;
  return id.compareTo(bestId) > 0;
}

/// Assemble the displayed receipt from one opaque GET /gr row and the anchor
/// number lookup.
FieldGrReceipt buildReceipt(FieldGrEnt gr, Map<String, String> anchorNos) {
  final String? anchorId = anchorIdOf(gr);
  return FieldGrReceipt(
    id: fieldGrStr(gr, const <String>['id']) ?? '',
    lines: parseGrLines(grItemsOf(gr)),
    anchorNo: anchorId == null ? null : anchorNos[anchorId],
    vendor: fieldGrStr(gr, const <String>['vendor']),
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

/// Format a quantity: a whole qty groups without decimals ("1200" -> "1,200"); a
/// fractional one keeps up to 3 trimmed decimals ("1.50" -> "1.5"). Parity with
/// st_receive_agg.formatQty / pr_detail_agg.formatQty — the three must not drift.
/// NaN/non-finite -> "0".
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
