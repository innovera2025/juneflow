// Pure parse + honest derivations for the mobile PM close summary (route
// `pm-close`, pototype/mobile-pm.jsx MPMClose L181-217). money = NONE — and the
// screen never originates one: the prototype's only monetary figure (the parts row)
// has no work-order column at all (see [PmCloseSummary.parts]).
//
// WHAT THIS SCREEN IS, HONESTLY. The prototype is the last step of the PM flow: a
// 5-row job summary, a tap-to-sign pad, and a "close + send report" button that
// flips to a full-screen success view. Of those three, only the SUMMARY has a wire.
// The pad and the close are blocked on a stack decision (BLOCKERS.md B-288), so this
// port ships a READ-ONLY summary plus the signature affordance in its real stored
// state. It performs no write. Every claim below is traceable:
//
//   - there is NO status column and NO certificate column on pm_workorder
//     (packages/db/src/schema/pm.ts L168-192), and the close handler's own comment
//     says close never invents one (apps/api/src/routes/pm.ts L753-760);
//   - `POST /pm/workorders/:id/close` writes only the close fields the body carries
//     — cause/fix/advice (pm-notes' three columns) and signature → customer_sign
//     (pm.ts L785-793) — then fires `lineNotifyStub`, a verified NO-OP (B-108b);
//   - so a close sent from THIS screen would carry nothing (pm-notes already saved
//     the log, and no signature can be captured), leaving the row byte-identical and
//     the 200 meaningless. A button that changes nothing must not claim a close, so
//     the affordance ships disabled rather than firing a no-op write.
//
// THE ONE DERIVED FACT THAT IS REAL. "done" is not stored, but it IS derived, the
// same way in two already-merged places: apps/web/src/screens/pm/wo-rows.ts
// `deriveStatus` L201-210 (`customerSign !== "" -> "done"`) and this app's own
// pm_jobs_agg. So [isSigned] reads `customer_sign` and nothing else — never a local
// tap. The prototype's `signed` flag (L183) is a UI gesture, and a gesture is not a
// stored fact.
//
// The real wire is the opaque Entity `GET /pm/workorders` returns (pm.ts
// workOrderWire L303-316):
//   { id, asset_id, template_id, tech, checkin_gps, items, cause, fix, advice,
//     customer_sign }
// joined to `GET /pm/assets` (assetWire L249-260: { id, contract_id, name, code,
// kind, site, cycle, next_due }) for the asset row — the same two reads pm-jobs
// makes. NOTE what is absent from workOrderWire and from the table itself: no
// timestamps ride the wire, and no check-in/completion CLOCK column exists at all
// (`checkin_gps` is text coordinates, not a time). That is why two of the five
// summary rows can never be filled from this wire — see [PmCloseSummary].
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable. This agg
// is self-contained and deliberately does NOT import pm_checklist_agg (the
// pm_checkin / pm_checklist / pm_notes precedent); it re-derives the checklist tally
// from the same raw `items` jsonb.

/// An opaque contract Entity — GET /pm/workorders and GET /pm/assets rows are
/// `{ [k]: unknown }`.
typedef PmCloseEnt = Map<String, Object?>;

/// Non-empty string at [key] of an opaque row, else null (never "" — the view
/// treats a blank exactly like an absent value).
String? pmCloseStr(PmCloseEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// The work order with [id] among the opaque `GET /pm/workorders` rows, or null.
///
/// The PM routes expose no `GET /pm/workorders/:id`, so the list endpoint is the
/// honest read (the same one pm-jobs / pm-checklist / pm-notes use). A missing id
/// yields null → the screen renders honest-empty rather than an invented work order.
PmCloseEnt? findWorkOrder(List<PmCloseEnt> rows, String id) {
  if (id.isEmpty) return null;
  for (final PmCloseEnt r in rows) {
    if (pmCloseStr(r, 'id') == id) return r;
  }
  return null;
}

/// The two display columns of one asset (assetWire.name / assetWire.code).
///
/// BOTH are nullable columns (packages/db/src/schema/pm.ts L122-123 — added
/// additively by migration 0034/B-110), and they are nullable INDEPENDENTLY. They
/// are kept apart rather than pre-joined so the composition in [assetLine] has to
/// decide about each one on its own.
class PmCloseAsset {
  const PmCloseAsset({this.name, this.code});

  /// `pm_asset.name` — the display name (an elevator model in the prototype), or null.
  final String? name;

  /// `pm_asset.code` — the asset code ("LIFT-A01" in the prototype), or null.
  final String? code;
}

/// Index the opaque `GET /pm/assets` rows by id, keeping each display column
/// separately nullable. A row with no id is skipped (nothing could join to it).
Map<String, PmCloseAsset> buildAssetMap(List<PmCloseEnt> rows) {
  final Map<String, PmCloseAsset> out = <String, PmCloseAsset>{};
  for (final PmCloseEnt r in rows) {
    final String? id = pmCloseStr(r, 'id');
    if (id == null) continue;
    out[id] = PmCloseAsset(
      name: pmCloseStr(r, 'name'),
      code: pmCloseStr(r, 'code'),
    );
  }
  return out;
}

/// Compose the prototype's asset line "name (code)" (mobile-pm.jsx L201
/// asset name + " (" + asset code + ")") from two INDEPENDENTLY nullable columns.
///
/// Finding the asset row does NOT establish that either column is filled — both are
/// nullable — so each part is decided on its own (the pr_detail_agg.projectLine and
/// pm_jobs_agg `asset?.name ?? ''` precedent):
///   both  -> "name (code)"
///   name  -> "name"          (no orphan "()" tail)
///   code  -> "code"          (bare — parentheses are a parenthetical to a name that
///                             is not there, so they are dropped, not printed empty)
///   none  -> null            -> the view em-dashes the row
String? assetLine(String? name, String? code) {
  final String? n = (name != null && name.isNotEmpty) ? name : null;
  final String? c = (code != null && code.isNotEmpty) ? code : null;
  if (n != null && c != null) return '$n ($c)';
  return n ?? c;
}

/// The checklist tally behind the prototype's check-results row (mobile-pm.jsx L201,
/// rendered there as "5/5 <items> - <repair> 1").
///
/// Every count is decided PER LINE from that line's own stored `result`; nothing is
/// inferred from another line or from the totals.
class PmCloseChecks {
  const PmCloseChecks({
    required this.total,
    required this.checked,
    required this.repair,
  });

  /// Checklist lines the work order actually stores (`items[]` entries that are
  /// objects — a non-object entry is not a line, exactly as
  /// pm_checklist_agg.parseChecklistItems treats it).
  final int total;

  /// Lines carrying a result from the server's OWN vocabulary
  /// (pm.ts CHECKLIST_RESULTS = normal | adjust | repair). Anything else — absent,
  /// blank, or a value outside that set — is UNCHECKED, never counted as checked.
  final int checked;

  /// Lines whose stored result is exactly `repair` (the prototype's repair tail).
  final int repair;

  /// Whether the work order has a checklist at all.
  ///
  /// LOAD-BEARING: with no lines the tally is 0/0, and "0/0" renders as a COMPLETE
  /// checklist ("nothing left to check") when the truth is that nothing was ever
  /// checked. A count of zero out of zero is not a fact about the job, so the row
  /// withholds its value entirely (the view em-dashes) rather than stating one.
  bool get hasLines => total > 0;
}

/// The server's checklist-result vocabulary (pm.ts CHECKLIST_RESULTS; schema
/// PmChecklistRow.result). A stored value outside this set is not a result.
const Set<String> _kCheckResults = <String>{'normal', 'adjust', 'repair'};

/// Tally a work order's opaque `items` jsonb.
///
/// A non-list `items` yields an empty tally (total 0) rather than a fabricated one.
PmCloseChecks tallyChecks(Object? items) {
  if (items is! List) {
    return const PmCloseChecks(total: 0, checked: 0, repair: 0);
  }
  int total = 0;
  int checked = 0;
  int repair = 0;
  for (final Object? it in items) {
    if (it is! Map) continue; // not a line — see PmCloseChecks.total
    total++;
    final Object? result = it['result'];
    if (result is! String || !_kCheckResults.contains(result)) continue;
    checked++;
    if (result == 'repair') repair++;
  }
  return PmCloseChecks(total: total, checked: checked, repair: repair);
}

/// Whether the customer's acceptance signature is STORED on this work order.
///
/// Reads `customer_sign` and nothing else. This is the single column the merged
/// `deriveStatus` (apps/web/src/screens/pm/wo-rows.ts L206) turns into the "done"
/// status, and the same column pm_jobs_agg reads — so a true here means the same
/// thing on every surface. It is never set by a tap on this screen: no signature can
/// be captured (B-288), so the value can only have arrived from elsewhere.
bool isSigned(PmCloseEnt e) => pmCloseStr(e, 'customer_sign') != null;

/// The whole honest summary of one work order, as the screen renders it.
///
/// Each slot is null when nothing backs it, and the view turns a null into an
/// em-dash. The two time rows are ALWAYS null and say so in their own doc comments —
/// they are modelled as fields (rather than omitted) so the prototype's row order and
/// labels survive while the values stay honest.
class PmCloseSummary {
  const PmCloseSummary({
    required this.asset,
    required this.checks,
    required this.signed,
  });

  /// Row 1, the ASSET row (L201) — the joined asset line, or null when the row is
  /// missing AND when it carries neither display column (see [assetLine]).
  final String? asset;

  /// Row 2, the CHECK-RESULTS row (L201) — the tally; renders only when
  /// [PmCloseChecks.hasLines].
  final PmCloseChecks checks;

  /// The stored signature state (see [isSigned]).
  final bool signed;

  /// Row 3, the START-END row (L201, mocked there as "09:14 - 10:48") — ALWAYS null.
  ///
  /// A start–end range needs BOTH endpoints, and the wire carries NEITHER: no clock
  /// column exists on pm_workorder (only `checkin_gps`, which is text coordinates),
  /// and workOrderWire ships no timestamp at all. Having one endpoint would still not
  /// license a range, so this is a getter rather than a computed field — there is no
  /// arithmetic here to get wrong. The merged web port of this same panel em-dashes
  /// the identical row (wo-detail.tsx "DEFAULT 5": start/end/total have NO wire).
  String? get startEnd => null;

  /// Row 4, the TOTAL-TIME row (L201, mocked there as "1 hr 34 min") — ALWAYS null.
  ///
  /// A duration is [startEnd]'s two endpoints subtracted. With neither on the wire
  /// there is nothing to subtract, and deriving a duration from a single endpoint (or
  /// from "now") would be inventing the job's length. Same em-dash as the web port.
  String? get totalTime => null;

  /// Row 5, the PARTS row (L201, mocked there as "1 set - 3,200 baht") — ALWAYS
  /// null, and MONEY.
  ///
  /// pm_workorder has no parts column: spare parts live on `pmQuotes.parts` with
  /// their own `currency_code`, raised through `POST /pm/quotes` (pm.ts L830) — the
  /// same absence pm-notes' parts slot documents. Even with that read in hand the
  /// total would have to be summed somewhere, and money = SERVER: this client never
  /// originates a monetary figure. So the label stays (chrome) and the value is an
  /// em-dash — never a quantity, never an amount.
  String? get parts => null;

  /// The caption under the signature pad (L209 — "<recipient>: <person name>
  /// (<juristic person>, building A)") — ALWAYS null.
  ///
  /// Two separate gaps, and finding the work order settles neither: the customer is
  /// three hops away (workorder → asset.contract_id → pm_contract.customer_id, and
  /// contractWire exposes only that uuid, pm.ts L276-288 — the NAME lives in another
  /// domain's table), and the parenthetical juristic-person/building descriptor has no
  /// column anywhere.
  /// The label is kept and the value em-dashed, never a raw uuid dressed as a name.
  String? get recipient => null;
}

/// Build the honest summary of [wo], joining [assetMap] for the asset row.
PmCloseSummary buildSummary(PmCloseEnt wo, Map<String, PmCloseAsset> assetMap) {
  final String? assetId = pmCloseStr(wo, 'asset_id');
  final PmCloseAsset? asset = assetId == null ? null : assetMap[assetId];
  return PmCloseSummary(
    // A missing asset row and an asset row with both columns null are the same
    // honest outcome: nothing to print (never the raw asset_id uuid).
    asset: asset == null ? null : assetLine(asset.name, asset.code),
    checks: tallyChecks(wo['items']),
    signed: isSigned(wo),
  );
}
