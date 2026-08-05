// Pure parse + honest derivations for the mobile foreman acceptance queue (route
// `fm-accept`, pototype/mobile-field.jsx MFmAccept L145-187). money = NONE.
//
// The prototype is a MOCK (§0 rule 3 — none of this is reproduced):
//   - the list is `window.ACCEPT_ITEMS` (L148), a cross-file global the web
//     acceptance-center prototype defines; it is filtered to the two feeds this
//     screen shows (`type === "subcon" || type === "gr"`);
//   - `r.wait` (L166, a "waiting {n} days" line), `r.title` (L168) and `r.docs`
//     (L170, the paperclip count)
//     are mock fields with no server column — see [FmAcceptRow] for each;
//   - `r.value` (L170) prints a money amount next to the project name;
//   - tapping the accept button (L176) only flips LOCAL state (`setDone`) and toasts
//     that the result synced into the acceptance centre; nothing is sent anywhere.
//
// The real wire is `GET /acceptance-center` (apps/api/src/routes/subcon.ts
// L1125-1250), whose two relevant feeds are:
//   ?type=period (default) — work periods in the acceptance queue
//     (ACCEPT_QUEUE_STATUSES = delivered | inspecting | rejected, subcon.ts L104),
//     enriched by enrichPeriodRow (L505-524):
//       { …periodWire, project_name, title, owner, defect }
//     where periodWire (L313-325) = { id, contract_id, seq, basis, target, pct,
//     amount, currency_code, status } and `title` is the CONTRACT DOC NUMBER only
//     (the server deliberately does not compose the period ordinal — it is UI
//     copy, so the client composes it around `seq`; subcon.ts L513-518).
//   ?type=gr — goods receipts carrying a rejected quantity (subcon.ts L1203-1226),
//     enriched by enrichGrRow (L563-577) over grAcceptWire (L379-390) =
//     { id, type:'gr', no, po_id, wo_id, received, rejected, status }.
//
// The write is `POST /periods/{id}/inspect` (subcon.ts L798-925):
//   { result: "pass" }              → delivered|inspecting → passed
//   { result: "reject", defects[] } → delivered|inspecting → rejected + Defect List
// ONLY the pass half is ported. `rejected` is a TERMINAL state with no way back and
// this screen has no defect form to fill the record with — see [kInspectPassPayload]
// for the whole argument and BLOCKERS.md B-297 item (1) for the ruling asked.
// money = NONE on this door: the PAYMENT of an inspected period is a different
// office action (`POST /periods/{id}/approve-payment`, subcon.ts L927+, which
// server-computes the gross and writes the AP billing). This screen never calls it,
// never names it, and shows no amount that could be read as one — see
// [FmAcceptRow.value] for why the wire's own `amount` is withheld.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.

/// An opaque contract Entity — `GET /acceptance-center` rows are `{ [k]: unknown }`.
typedef FmAcceptEnt = Map<String, Object?>;

/// Non-empty string at [key] of an opaque row, else null (never "" — the view
/// treats a blank exactly like an absent value).
String? fmAcceptStr(FmAcceptEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// Finite number at [key] (number or numeric string — every numeric column
/// arrives as a string over the wire), else null. Never a fabricated 0.
num? fmAcceptNum(FmAcceptEnt e, String key) {
  final Object? v = e[key];
  if (v is num) return v.isFinite ? v : null;
  if (v is String && v.trim().isNotEmpty) {
    final num? n = num.tryParse(v.trim());
    return n != null && n.isFinite ? n : null;
  }
  return null;
}

/// Which acceptance-center feed a row came from. The prototype tags the same two
/// with `r.type` (L148/L164); the server tags the gr feed with `type: 'gr'` and
/// leaves the period feed untagged, so the FEED (not a row field) is authoritative.
enum FmAcceptFeed {
  /// `?type=period` — a subcon work period. The only feed this screen can act on.
  period,

  /// `?type=gr` — a goods receipt with a rejected quantity. READ-ONLY here (see
  /// [FmAcceptRow.actionable]).
  gr,
}

/// The three tabs of the prototype's filter strip (L155), with the prototype's own
/// predicate: all / not-rejected / rejected.
enum FmAcceptTab { all, wait, rejected }

/// Work-period statuses that `POST /periods/{id}/inspect` accepts (subcon.ts
/// L819-826). Anything else 409s, so the screen withholds the buttons rather than
/// offering a tap that cannot succeed.
const Set<String> kInspectableStatuses = <String>{'delivered', 'inspecting'};

/// One acceptance-queue row (typed projection of an opaque wire row).
class FmAcceptRow {
  const FmAcceptRow({
    required this.id,
    required this.feed,
    required this.doc,
    required this.seq,
    required this.status,
    required this.projectName,
    required this.rejected,
    required this.defects,
  });

  /// Real row id — the period id the inspect POST addresses (period feed), or the
  /// gr id (gr feed, no action).
  final String id;

  /// Which feed produced this row.
  final FmAcceptFeed feed;

  /// The prototype's `r.doc` (L163). Period feed → enrichPeriodRow `title`, i.e.
  /// the owning contract's document number. GR feed → the receipt's own `no`.
  /// Null when the server left it null → the view renders an em-dash, never a uuid
  /// dressed up as a document number.
  final String? doc;

  /// `work_period.seq` — the period ordinal the view composes its unit word around
  /// (the server refuses to compose it, subcon.ts L513-518). Null on the gr feed
  /// and whenever the column is absent.
  final int? seq;

  /// Real `status` column (period: pending|delivered|inspecting|passed|rejected|
  /// paid; gr: the gr status). Drives [actionable].
  final String? status;

  /// Real `project_name` resolved server-side through the tenant-scoped hop chain,
  /// or null when a hop did not resolve (subcon.ts L163-167) → em-dash.
  final String? projectName;

  /// The prototype's `r.rejected` flag (L165/L169). Honest per feed:
  ///   period → `status == 'rejected'` (the real column);
  ///   gr     → `rejected > 0`, which is EXACTLY the server's own criterion for
  ///            putting a receipt in this feed (subcon.ts L1203-1210 "rejected > 0
  ///            = a return/defect situation"). So every gr row is flagged — that is
  ///            the wire's meaning, not a guess.
  final bool rejected;

  /// The rejected period's real Defect List items (enrichPeriodRow `defect`,
  /// subcon.ts L522). Empty when the server sent none — never invented.
  final List<String> defects;

  /// True when `POST /periods/{id}/inspect` would be accepted for this row.
  ///
  /// GR rows are NEVER actionable: the inspect endpoint takes a work-period id, and
  /// a goods receipt's own decisions are different doors (`POST /gr/{id}/return`,
  /// `POST /gr/{id}/cancel`, gr.ts L646/L692) with different meanings. The
  /// prototype renders pass/reject on gr rows too (its buttons only toast), so this
  /// port withholds them there — an affordance that cannot succeed is a promise.
  /// A period already `rejected` is likewise not re-inspectable (L819-826).
  bool get actionable =>
      feed == FmAcceptFeed.period &&
      status != null &&
      kInspectableStatuses.contains(status);

  /// NOT A FIELD — documentation of a deliberate withholding, kept next to the
  /// data it is about.
  ///
  /// The prototype prints money on this card (`fmt(r.value)` + a baht sign, L170)
  /// and the wire
  /// does carry `amount` + `currency_code`. It is still withheld, because on this
  /// screen that number would read as "what this period pays", and for three of the
  /// four bases it is not:
  ///   percent   → the payable is pct/100 × contract.value
  ///   distance  → per_period_qty × rate_per_unit
  ///   unit      → per_period_qty × rate_per_unit
  ///   milestone → the stored `amount`
  /// (subcon.ts computeGross L235-247.) Only `milestone` reads its payable off the
  /// column this wire carries; `contract.value` is not on this wire at all, and
  /// computing the other three client-side is forbidden (money = SERVER). The
  /// server computes the gross exactly once, inside `approve-payment` — the action
  /// this screen must not imply it performs. So the slot renders an em-dash.
  static const String value = 'withheld — see the doc comment';
}

/// Parse one `?type=period` row.
FmAcceptRow parsePeriodRow(FmAcceptEnt e) {
  final num? seq = fmAcceptNum(e, 'seq');
  final Object? defect = e['defect'];
  return FmAcceptRow(
    id: fmAcceptStr(e, 'id') ?? '',
    feed: FmAcceptFeed.period,
    doc: fmAcceptStr(e, 'title'),
    seq: seq?.toInt(),
    status: fmAcceptStr(e, 'status'),
    projectName: fmAcceptStr(e, 'project_name'),
    rejected: fmAcceptStr(e, 'status') == 'rejected',
    defects: defect is List
        ? <String>[
            for (final Object? d in defect)
              if (d is String && d.isNotEmpty) d,
          ]
        : const <String>[],
  );
}

/// Parse one `?type=gr` row. A receipt has no `seq` and no Defect List of its own
/// (its rejected QUANTITY is what put it in the feed), so both stay honestly empty.
FmAcceptRow parseGrRow(FmAcceptEnt e) {
  final num? rejected = fmAcceptNum(e, 'rejected');
  return FmAcceptRow(
    id: fmAcceptStr(e, 'id') ?? '',
    feed: FmAcceptFeed.gr,
    doc: fmAcceptStr(e, 'no') ?? fmAcceptStr(e, 'title'),
    seq: null,
    status: fmAcceptStr(e, 'status'),
    projectName: fmAcceptStr(e, 'project_name'),
    rejected: rejected != null && rejected > 0,
    defects: const <String>[],
  );
}

/// The whole queue: both feeds parsed, rows with no id dropped (an un-addressable
/// row could never be inspected and has nothing honest to show), and ordered
/// deterministically.
///
/// Order: the prototype's own order is `ACCEPT_ITEMS` array order — mock data. The
/// wire carries no due date, no wait time and no priority (see [FmAcceptRow.doc]),
/// so there is nothing to sort BY that means anything; document number then period
/// ordinal is a stable, honest presentation order (the st_grlist precedent). Rows
/// with no document number sort last.
List<FmAcceptRow> parseAcceptQueue(
  List<FmAcceptEnt> periods,
  List<FmAcceptEnt> grs,
) {
  final List<FmAcceptRow> out = <FmAcceptRow>[
    for (final FmAcceptEnt e in periods) parsePeriodRow(e),
    for (final FmAcceptEnt e in grs) parseGrRow(e),
  ].where((FmAcceptRow r) => r.id.isNotEmpty).toList();
  out.sort((FmAcceptRow a, FmAcceptRow b) {
    final String ad = a.doc ?? '';
    final String bd = b.doc ?? '';
    if (ad.isEmpty != bd.isEmpty) return ad.isEmpty ? 1 : -1;
    final int byDoc = ad.compareTo(bd);
    if (byDoc != 0) return byDoc;
    return (a.seq ?? 0).compareTo(b.seq ?? 0);
  });
  return out;
}

/// The prototype's tab predicate, verbatim (L149): all → everything; rejected →
/// `r.rejected`; anything else ("wait") → `!r.rejected`.
List<FmAcceptRow> filterAcceptRows(List<FmAcceptRow> rows, FmAcceptTab tab) {
  switch (tab) {
    case FmAcceptTab.all:
      return rows;
    case FmAcceptTab.rejected:
      return rows.where((FmAcceptRow r) => r.rejected).toList();
    case FmAcceptTab.wait:
      return rows.where((FmAcceptRow r) => !r.rejected).toList();
  }
}

/// The ONLY body this screen can produce for `POST /periods/{id}/inspect`.
///
/// The server accepts two results (subcon.ts L810-814): `pass` and
/// `reject` + a Defect List. **This port can only send `pass`**, and that is a
/// structural guarantee, not a convention: there is no code path anywhere in this
/// slice that builds `{'result': 'reject'}`.
///
/// Why the reject is WITHHELD (BLOCKERS.md B-297 item 1):
///
///   1. `rejected` is a TERMINAL state. Every write of `work_period.status` in
///      subcon.ts is at L666 (`pending`, on create), L784 (`delivered`), L845
///      (`passed`), L891 (`rejected`) and L1020/L1037 (`paid`) — there is no
///      transition OUT of `rejected`, and each door refuses it: deliver needs
///      `pending` (L754-759), inspect needs `delivered|inspecting` (L819-826),
///      approve-payment needs `passed` (L951-957). `POST /defects/{id}/recheck`
///      (L1091-1120) closes a DEFECT row and never touches the period. So a reject
///      permanently ends that work period — it can never be re-delivered,
///      re-inspected or paid, and nothing in the app can undo it.
///   2. A reject with an EMPTY `defects[]` writes NO defect rows — the handler's
///      own loop drops every entry with no `item` (subcon.ts L864-871). The record
///      of WHY the period failed would not exist.
///   3. The prototype provides no way to enter one. Its reject button
///      (mobile-field.jsx L177) only fires a toast whose own wording claims a Defect
///      List was recorded ("reject + record Defect (from mobile)") while capturing
///      nothing at all. That is the mock mechanic §0 rule 3 forbids reproducing, and
///      inventing a defect form the prototype does not have is forbidden by rule 1.
///
/// A one-tap, confirmation-free, record-free action that permanently fails a
/// subcontractor's work period is therefore not shippable in either direction: with
/// an invented defect it fabricates a record, without one it destroys recoverability
/// silently. The button keeps its place in the prototype's two-button row as an
/// honest-DISABLED affordance (the merged pm-close B-288 / pm-checklist precedent),
/// and B-297 asks for the ruling. The merged WEB port
/// (apps/web/src/screens/subcon/accept-form.tsx) does send a real Defect List — it
/// has an inspection checklist to derive one from; this screen does not.
const Map<String, Object?> kInspectPassPayload = <String, Object?>{
  'result': 'pass',
};

/// The honest lifecycle of ONE row's inspect action.
///
///   * [idle]    — nothing submitted for this row.
///   * [sending] — UI-transient, the POST is in flight.
///   * [failed]  — the POST did not durably succeed. Shown as a failure, never as a
///                 success. A 409 (another inspector moved the period first) also
///                 lands here; the list is re-read straight after, so the row's TRUE
///                 server status replaces the stale one either way.
///
/// There is deliberately no `done` state: a successful inspect is proven by
/// RE-READING the queue, not by a client-side flag. The prototype's `setDone`
/// (L150/L176) is a local boolean that claims "inspected · result sent to the
/// system" while
/// having sent nothing — precisely the mock mechanic §0 rule 3 forbids copying.
enum FmRowActionState { idle, sending, failed }
