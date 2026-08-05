// Pure parse + honest derivations for the mobile PM checklist (route
// `pm-checklist`, pototype/mobile-pm.jsx MPMChecklist L98-146). money = NONE — a
// checklist result + photo references; the PUT is a positional MERGE of the whole
// items array, so an at-least-once replay is naturally idempotent (no JV, no
// double-post, no counter).
//
// The prototype is a MOCK (§0 rule 3 — none of this is reproduced):
//   - its 5 check labels are a hardcoded local array (L99), not the work order's;
//   - the BEFORE photo slot is an unconditional gradient + check icon — it asserts
//     a photo exists on every row, always, with no data behind it;
//   - the AFTER photo slot is filled from `results[i] !== "none"` — a photo state
//     DERIVED FROM THE RESULT TOGGLE, i.e. picking a "normal" result fakes an
//     attached photo;
//   - `cycle` (L101) and `r` (L109) are dead code in the source — `cycle` is never
//     called (the 3 buttons set the result directly) and `r` is never rendered, so
//     the "none" LABEL never reaches the screen.
//
// The real wire is the opaque Entity `GET /pm/workorders` returns
// (apps/api/src/routes/pm.ts workOrderWire):
//   { id, asset_id, template_id, tech, checkin_gps, items, cause, fix, advice,
//     customer_sign }
// where `items` is the jsonb PmChecklistRow[] `{ label, result?, before?, after? }`
// (packages/db/src/schema/pm.ts L47-52). So the checklist LABELS are the work
// order's own snapshot (captured from a ChecklistTemplate at create time — the tech
// fills, does not rename), and before/after ARE genuinely backed columns holding a
// photo REFERENCE. Every derivation below reads only those real columns; nothing is
// invented and no photo state is derived from a result.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable. (The
// offline-write state resolution imports the queue model only, exactly like
// pm_checkin_agg.dart.)

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// An opaque contract Entity — GET /pm/workorders rows are `{ [k]: unknown }`.
typedef PmChecklistEnt = Map<String, Object?>;

/// The checklist result vocabulary (mobile-pm.jsx MPM_RESULTS L92-97), which is
/// exactly the server's stored enum (pm.ts CHECKLIST_RESULTS + schema
/// PmChecklistRow.result = "normal" | "adjust" | "repair", absent = unchecked).
///
/// [none] is the UNCHECKED state: it has no wire value (the server omits `result`
/// rather than storing a "none" string), so it is never sent.
enum PmCheckResult { none, normal, adjust, repair }

/// The three results the prototype offers as toggle buttons — `MPM_RESULTS.slice(1)`
/// (mobile-pm.jsx L136), i.e. everything except the unchecked state. Order is the
/// source order, so the 2-column grid lays out as the prototype does.
const List<PmCheckResult> kPmSelectableResults = <PmCheckResult>[
  PmCheckResult.normal,
  PmCheckResult.adjust,
  PmCheckResult.repair,
];

/// The stored wire value for [r], or null for [PmCheckResult.none] — an unchecked
/// row sends NO `result`, matching the server (mergeChecklistRow keeps a result
/// only when it is one of CHECKLIST_RESULTS).
String? pmCheckResultWire(PmCheckResult r) => switch (r) {
  PmCheckResult.none => null,
  PmCheckResult.normal => 'normal',
  PmCheckResult.adjust => 'adjust',
  PmCheckResult.repair => 'repair',
};

/// Parse a wire `result` into [PmCheckResult]. Anything absent, blank, or outside
/// the server vocabulary is [PmCheckResult.none] (unchecked) — never guessed.
PmCheckResult parsePmCheckResult(Object? raw) => switch (raw) {
  'normal' => PmCheckResult.normal,
  'adjust' => PmCheckResult.adjust,
  'repair' => PmCheckResult.repair,
  _ => PmCheckResult.none,
};

/// Non-empty string at [key] of an opaque row, else null (never "" — the view
/// em-dashes a null, and a blank is the same absence).
String? pmChecklistStr(PmChecklistEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// One checklist line: the work order's own snapshot label plus the real stored
/// result and photo references.
class PmChecklistItem {
  const PmChecklistItem({
    required this.label,
    required this.result,
    this.before,
    this.after,
  });

  /// The check label, verbatim from the work order's `items[i].label` snapshot.
  /// "" when the stored row carries none → the view em-dashes it (never invented).
  final String label;

  /// The stored result, or [PmCheckResult.none] when unchecked.
  final PmCheckResult result;

  /// The BEFORE photo REFERENCE the server stored (PmChecklistRow.before), or null
  /// when no photo is attached. This is an opaque reference, not an image: the view
  /// renders an attached / not-attached state from it and NEVER a fabricated
  /// thumbnail or check mark (the prototype's always-filled before slot is mock).
  final String? before;

  /// The AFTER photo reference (PmChecklistRow.after), or null. Read from the wire
  /// ONLY — never derived from [result] (that coupling is the prototype's mock).
  final String? after;

  /// True when the line has been checked (a real stored result).
  bool get isChecked => result != PmCheckResult.none;

  PmChecklistItem withResult(PmCheckResult next) =>
      PmChecklistItem(label: label, result: next, before: before, after: after);
}

/// Parse one opaque `items[i]` map into a [PmChecklistItem].
PmChecklistItem parseChecklistItem(PmChecklistEnt e) => PmChecklistItem(
  label: pmChecklistStr(e, 'label') ?? '',
  result: parsePmCheckResult(e['result']),
  before: pmChecklistStr(e, 'before'),
  after: pmChecklistStr(e, 'after'),
);

/// Parse a work order's opaque `items` jsonb into typed lines.
///
/// Order is PRESERVED and is load-bearing: `PUT /pm/workorders/:id/checklist`
/// merges the body's items[] POSITIONALLY onto the stored rows (pm.ts
/// mergeChecklistRow), so re-ordering or dropping a line here would write results
/// onto the wrong labels. A non-list `items` (or a non-map entry) yields nothing
/// rather than a fabricated row.
List<PmChecklistItem> parseChecklistItems(Object? items) {
  if (items is! List) return const <PmChecklistItem>[];
  final List<PmChecklistItem> out = <PmChecklistItem>[];
  for (final Object? it in items) {
    if (it is Map) {
      out.add(
        parseChecklistItem(
          it.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
        ),
      );
    }
  }
  return out;
}

/// The work order with [id] among the opaque `GET /pm/workorders` rows, or null.
///
/// The PM routes expose no `GET /pm/workorders/:id`, so the list endpoint is the
/// honest read (the same one pm-jobs uses). A missing id yields null → the screen
/// renders honest-empty rather than an invented work order.
PmChecklistEnt? findWorkOrder(List<PmChecklistEnt> rows, String id) {
  if (id.isEmpty) return null;
  for (final PmChecklistEnt r in rows) {
    if (pmChecklistStr(r, 'id') == id) return r;
  }
  return null;
}

/// How many lines carry a real stored result (the header's "checked n of total").
int checkedCount(List<PmChecklistItem> items) =>
    items.where((PmChecklistItem i) => i.isChecked).length;

/// Build the `items[]` body for `PUT /pm/workorders/:id/checklist`.
///
/// Echoes the WHOLE array in order, because the server merges positionally AND
/// drops any field the body omits: `mergeChecklistRow` re-adds `before`/`after`
/// only when the body carries them, so sending just the results would silently
/// ERASE previously attached photo references. `label` is echoed for the same
/// reason (it falls back to the stored snapshot, but echoing keeps the merge
/// explicit). An unchecked line sends no `result` — never a "none" string the
/// server's vocabulary does not have.
List<Map<String, Object?>> checklistPayload(List<PmChecklistItem> items) {
  return <Map<String, Object?>>[
    for (final PmChecklistItem i in items)
      <String, Object?>{
        'label': i.label,
        if (pmCheckResultWire(i.result) case final String r) 'result': r,
        if (i.before case final String b) 'before': b,
        if (i.after case final String a) 'after': a,
      },
  ];
}

/// The honest lifecycle of the checklist save, as the screen renders it.
///
///   * [idle]    — nothing submitted yet (or edits made since the last save).
///   * [saving]  — UI-transient, a submit is in flight.
///   * [saved]   — the server durably accepted the write (2xx).
///   * [queued]  — offline / transient failure: kept in the queue, will retry.
///                 NEVER shown as a success (BLOCKERS.md B-268 option (a)).
///   * [failed]  — a permanent (4xx) rejection: kept + surfaced, no retry.
enum PmChecklistSaveState { idle, saving, saved, queued, failed }

/// Resolve the honest post-drain state of the op [opId] from the drain [report]
/// and the ops still [due] in the queue (pending + failed).
///
/// Same resolution as pm_checkin_agg.resolveCheckinState: the report is
/// authoritative when it touched the op this pass; otherwise the queue is the
/// source of truth (gone = synced, `failed` = dead-letter, `pending` = queued).
PmChecklistSaveState resolveChecklistSaveState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return PmChecklistSaveState.saved;
      case SyncOutcome.permanentlyFailed:
        return PmChecklistSaveState.failed;
      case SyncOutcome.deferred:
        return PmChecklistSaveState.queued;
    }
  }
  for (final SyncOperation op in due) {
    if (op.id == opId) {
      return op.status == SyncOpStatus.failed
          ? PmChecklistSaveState.failed
          : PmChecklistSaveState.queued;
    }
  }
  return PmChecklistSaveState.saved; // removed from the queue = synced
}
