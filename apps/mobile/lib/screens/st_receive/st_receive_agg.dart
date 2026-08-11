// Pure parse + honest derivations for the mobile store count-and-receive screen
// (route `st-receive`, pototype/mobile-field.jsx MStReceive L36-92).
// money = NONE on the display surface, and money = SERVER on the write — this
// screen never originates, echoes or computes a monetary value. See "THE WRITE".
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// ---------------------------------------------------------------------------
// THE MOCK (§0 rule 3 — stripped, never reproduced)
// ---------------------------------------------------------------------------
// The prototype hardcodes three lines `{ n, ordered, unit }` (L38-42) with mock
// material names and units, and its CTA is `onClick={() => setDone(true)}` (L86):
// success is UNCONDITIONAL, with no loading / error / retry / queued concept
// anywhere in the component. None of that is ported.
//
// ---------------------------------------------------------------------------
// THE READ — per-line, from the one chain that is real (BLOCKERS.md B-265)
// ---------------------------------------------------------------------------
// The PO has NO line items: there is no `po_item` table in packages/db and both
// GET /po and GET /po/:id are header-only (po.ts poWire). The honest per-line
// chain that DOES exist is:
//
//   GET /po/:id  -> `pr_id`                       (po.ts poWire)
//   GET /pr/:id  -> `items[]` (pr.ts prItemWire)  = { id, pr_id, boq_item_id,
//                                                     qty, price, amount }
//
// `items[].qty` is not a proxy for the ordered quantity — it IS the figure the
// server itself closes the PO on (`prOrderedQty` = SUM(pr_item.qty),
// procurement.ts; gr.ts compares cumulative received against it for partial-vs-
// full). So the per-line ORDERED quantity this screen shows is authoritative.
//
// What the chain does NOT carry, and what this module therefore refuses to
// invent: `prItemWire` has no `name` and no `unit`. Both live on `boq_item`,
// reachable only through `boq_item_id` -> GET /boq -> GET /boq/:id/items. That
// fan-out is NOT `1 + 1 + 1`: GET /boq (boq.ts) takes no project filter at all,
// so it returns every BOQ document in the tenant and each one needs its own
// items call — a `1 + 1 + N` read whose cost is unbounded by the screen. Pending
// the B-265 ruling this module takes the honest-omit branch (B-265 option 3):
// per-line rows with the REAL ordered quantity, and `name`/`unit` left NULL so
// the view renders an em-dash. A bare row is honest; a guessed material name on
// a goods-receipt document is not.
//
// `price` and `amount` ARE on the PR item wire. They are deliberately dropped
// here and never surface: the prototype shows no money on this screen (L36-92
// contains no currency glyph and applies its `fmt()` only to quantities), and
// echoing a price back on the write would put the client in the money path
// (see below).
//
// ---------------------------------------------------------------------------
// THE WRITE — money = SERVER, by omission (BLOCKERS.md B-267)
// ---------------------------------------------------------------------------
// POST /gr accepts a per-line `price` and stores it VERBATIM; the receipt's
// money is then derived from it at read time as SUM(received_qty * price)
// (gr.ts grWire). There is no server-side price source in that path, so a client
// that sends `price` originates the receipt's monetary value. This screen does
// not send one.
//
// Omitting `price` alone would not have been enough. gr.ts gates `gr_item`
// creation on a line carrying a `name`:
//
//     const name = str(pick(line, "name")).trim();
//     if (name) { const price = toNum(pick(line, "price")) ?? 0; ... }
//
// so a NAMED line with no price persists `gr_item.price = '0.00'`, and the
// merged web GR list flips `hasLineDetail` true and renders `formatMoney(0)` =
// a literal "0" in the value column (gr-rows.ts) — a fabricated zero-baht
// receipt, which is exactly what that file's own header says it exists to
// prevent.
//
// Both halves are closed by the same fact: this screen has NO name to send
// (see THE READ). A line with no `name` writes no `gr_item` at all — gr.ts's own
// comment for that branch reads "the per-line detail is honestly absent rather
// than fabricated" — so:
//
//   * no client-originated price ever reaches the database;
//   * `items.length == 0` keeps the web list's money on its em-dash instead of
//     a fabricated 0;
//   * `gr.received` = SUM(qty_ok) is still REAL and still drives partial-vs-full
//     and the PO auto-close.
//
// `ordered_qty` is likewise not sent: gr.ts reads it only INSIDE the `if (name)`
// branch, so on a nameless line it is inert — sending it would be cargo, not
// data. `no` is not sent either: `gr.no` is nullable and gr.ts takes it straight
// from the client body with no document-numbering call anywhere, so inventing a
// receipt number here is the one way this screen could manufacture one
// (BLOCKERS.md B-266).
//
// `qty_rejected` is always 0. The prototype has ONE count per line (`recv`,
// L44); the wire's shape is the pair `qty_ok` / `qty_rejected` (gr.ts), so the
// screen cannot express "received 800, of which 30 damaged". Mapping
// `recv -> qty_ok` with `qty_rejected: 0` is the only structurally faithful
// reading — and it means this screen can never trigger gr.ts's defect path
// (gated on `rejected > 0`), which is consistent with dropping the prototype's
// "procurement has been notified" copy (B-266).
//
// ---------------------------------------------------------------------------
// THE OUTCOME — three honest states (BLOCKERS.md B-268 option 1)
// ---------------------------------------------------------------------------
// The write goes through the at-least-once offline queue, where a 5xx or a
// transport failure yields `SyncOutcome.deferred` = SAVED, not CONFIRMED.
// Rendering the prototype's full-screen success takeover on a deferred outcome
// would state that goods entered the system when nothing has been posted. So
// the outcome is resolved from the drain report, exactly as pm-checkin does it.
//
// The replay is safe here, and that is a fact about the CURRENT server, not an
// assumption: gr.ts runs its idempotency pre-check BEFORE the anchor status
// gate (B-264 — whose comment names this screen, because `recv = ordered` is the
// prototype's default and a full receipt closes the PO in the same handler), and
// the `gr_idempotency_uq` 23505 catch gated on the constraint NAME (B-263) is
// the concurrency backstop. Both paths return the ORIGINAL 201 through one
// envelope, so a replayed receipt cannot become a second GR.

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// An opaque contract Entity — GET /po/:id and GET /pr/:id rows are `{ [k]: unknown }`.
typedef StRecvEnt = Map<String, Object?>;

/// Non-empty string at the first matching key, else null.
String? stRecvStr(StRecvEnt e, List<String> keys) {
  for (final String k in keys) {
    final Object? v = e[k];
    if (v is String && v.isNotEmpty) return v;
  }
  return null;
}

/// Finite number at the first matching key (number or numeric string — numeric
/// columns cross the wire as either), else null. Never defaults to 0: a missing
/// quantity is absent, not zero.
double? stRecvNum(StRecvEnt e, List<String> keys) {
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

/// The source PR id of an opaque GET /po/:id row (`pr_id`), or null.
///
/// This is the hop that makes a per-line receipt possible at all; a PO whose
/// `pr_id` is absent has no honest line source and the screen stays empty rather
/// than inventing one.
String? prIdOfPo(StRecvEnt po) =>
    stRecvStr(po, const <String>['pr_id', 'prId']);

/// One countable receipt line — a typed projection of one real `pr_item`.
class StRecvLine {
  const StRecvLine({
    required this.id,
    required this.orderedQty,
    this.name,
    this.unit,
  });

  /// Real `pr_item.id` — the stable key the per-line counter is held against.
  final String id;

  /// Real ordered quantity (`pr_item.qty`) — the same figure `prOrderedQty` sums
  /// when the server decides partial-vs-full. Authoritative, never derived here.
  final double orderedQty;

  /// Material name. ALWAYS null today: `prItemWire` carries none and the BOQ
  /// fan-out that would resolve it is unbounded (see the header) → em-dash.
  /// Parsed defensively so it lights up honestly IF the wire ever grows it.
  final String? name;

  /// Unit of measure. ALWAYS null today, same reason as [name] → em-dash.
  final String? unit;
}

/// Parse the `items[]` of a GET /pr/:id body into countable lines, preserving the
/// server's own order (there is no other ordering key on the wire, and inventing
/// one would reorder a document the storekeeper counts against).
///
/// A row with no `id` is skipped: the counter is held against that id, so a row
/// without one cannot be counted safely. A row with no `qty` is skipped too —
/// an ordered quantity of "unknown" cannot be defaulted to 0 without asserting
/// that nothing was ordered.
///
/// `price` / `amount` are present on this wire and are deliberately NOT read:
/// money never enters this screen (see the header).
List<StRecvLine> parseReceiptLines(List<StRecvEnt> items) {
  final List<StRecvLine> out = <StRecvLine>[];
  for (final StRecvEnt e in items) {
    final String? id = stRecvStr(e, const <String>['id']);
    final double? qty = stRecvNum(e, const <String>['qty']);
    if (id == null || qty == null) continue;
    out.add(
      StRecvLine(
        id: id,
        orderedQty: qty,
        name: stRecvStr(e, const <String>['name']),
        unit: stRecvStr(e, const <String>['unit']),
      ),
    );
  }
  return out;
}

/// Read the `items[]` array off an opaque GET /pr/:id body as raw wire rows.
List<StRecvEnt> prItemsOf(StRecvEnt pr) {
  final Object? raw = pr['items'];
  if (raw is! List) return const <StRecvEnt>[];
  return <StRecvEnt>[
    for (final Object? item in raw)
      if (item is Map)
        item.map<String, Object?>(
          (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
        ),
  ];
}

/// How a counted quantity compares with the ordered quantity — the prototype's
/// per-line colour signal (L74 warns when short, L76 tints short vs over).
enum StRecvDelta { short, exact, over }

/// Classify [counted] against [ordered]. Pure comparison of two real numbers.
StRecvDelta classifyDelta(double counted, double ordered) {
  if (counted < ordered) return StRecvDelta.short;
  if (counted > ordered) return StRecvDelta.over;
  return StRecvDelta.exact;
}

/// The prototype's stepper step (L44/L46: `adj(i, -10)` / `adj(i, 10)`).
const double kStRecvStep = 10;

/// Apply a stepper delta, clamped at zero (prototype L45: `Math.max(0, v + d)`).
double adjustCount(double current, double delta) {
  final double next = current + delta;
  return next < 0 ? 0 : next;
}

/// The initial per-line counts: the prototype pre-fills each line with its
/// ordered quantity (L43 `useState(items.map((it) => it.ordered))`) and the
/// storekeeper adjusts down/up. These are real ordered quantities used as a form
/// DEFAULT the user confirms — not a displayed server measurement.
List<double> initialCounts(List<StRecvLine> lines) => <double>[
  for (final StRecvLine l in lines) l.orderedQty,
];

/// True when any line is counted short — drives the CTA's warn tone
/// (prototype L47 `short`, L86 button background).
bool anyShort(List<StRecvLine> lines, List<double> counts) {
  for (int i = 0; i < lines.length && i < counts.length; i++) {
    if (counts[i] < lines[i].orderedQty) return true;
  }
  return false;
}

/// The body key that carries the receipt's subject PO. Named rather than inlined
/// because it is the ONLY thing that pins a queued `/gr` op to one PO — the endpoint
/// is `/gr` for every receipt — so the screen's post-restart adoption matcher
/// (`stReceiveOpIdentity`, B-330) has to read the same key this builder writes.
const String grPoIdField = 'po_id';

/// Build the POST /gr body for this receipt.
///
/// Deliberately minimal, and every omission is load-bearing — see the header:
///   * NO `name`  -> no `gr_item` row is written, so no client price can be
///                   stored and the web list's money stays an em-dash instead of
///                   a fabricated 0;
///   * NO `price` -> money never leaves the server's authority;
///   * NO `unit` / `ordered_qty` -> gr.ts reads both only inside the `if (name)`
///                   branch, so on a nameless line they are inert;
///   * NO `no`    -> `gr.no` stays null; there is no document-numbering call in
///                   gr.ts, so a number here could only be invented;
///   * `qty_rejected` is 0 on every line — the screen has one count and cannot
///     honestly express a damaged quantity.
///
/// [idempotencyKey] MUST be the owning SyncOperation's id: the queue replays
/// `op.payload` verbatim and does NOT inject the key, so this is the only place
/// the B-261 contract can be honoured. A whole count is emitted as an int so the
/// queued payload reads as the storekeeper counted it.
Map<String, Object?> buildReceiptPayload({
  required String poId,
  required List<double> counts,
  required String idempotencyKey,
}) {
  return <String, Object?>{
    grPoIdField: poId,
    'idempotency_key': idempotencyKey,
    'lines': <Map<String, Object?>>[
      for (final double c in counts)
        <String, Object?>{'qty_ok': _wireNum(c), 'qty_rejected': 0},
    ],
  };
}

/// A whole double crosses the wire as an int (800, not 800.0); a fractional one
/// stays a double. Cosmetic only — gr.ts `toNum` accepts either.
Object _wireNum(double n) =>
    n == n.roundToDouble() && n.abs() < 1e15 ? n.toInt() : n;

/// The honest lifecycle of the receipt write, as the screen renders it.
///
/// The prototype has only an unconditional success (L86). These are the states
/// the real at-least-once write can actually be in:
///   * [idle]       — counting, nothing enqueued.
///   * [submitting] — a drain is in flight.
///   * [confirmed]  — the server durably accepted the receipt (2xx).
///   * [queued]     — offline / transient failure: SAVED, will retry. NEVER
///                    shown as a success.
///   * [failed]     — a permanent (4xx) rejection: surfaced, not retried.
enum StRecvState { idle, submitting, confirmed, queued, failed }

/// Resolve the honest post-drain state of op [opId] from the drain [report] and
/// the ops still [due] in the queue (pending + failed).
///
/// The report is authoritative when it touched the op this pass. When it did not
/// (a re-entrant drain was guarded out, or an earlier pass already handled it),
/// the queue is the source of truth: an op that is gone was synced; a `failed`
/// op is a permanent dead-letter; a `pending` op is still queued. Mirrors
/// pm_checkin_agg.resolveCheckinState — the two must not drift.
StRecvState resolveReceiveState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return StRecvState.confirmed;
      case SyncOutcome.permanentlyFailed:
        return StRecvState.failed;
      case SyncOutcome.deferred:
        return StRecvState.queued;
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
  if (mine == null) return StRecvState.confirmed;
  return mine.status == SyncOpStatus.failed
      ? StRecvState.failed
      : StRecvState.queued;
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
/// pr_detail_agg.formatQty. NaN/non-finite -> "0".
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
