// Pure parse + honest derivations for the mobile PM maintenance log (route
// `pm-notes`, pototype/mobile-pm.jsx MPMNotes L148-179). money = NONE — three free
// text columns; no amount is read, derived, or sent by this screen.
//
// The prototype is a MOCK (§0 rule 3 — none of this is reproduced):
//   - the three note boxes are STATIC divs holding hardcoded sentences (L156 / L159
//     / L162) — there is no state, no input, and nothing is ever read back;
//   - the parts row (L164-167) shows a hardcoded part name + a hardcoded quantity
//     and price, i.e. MONEY with no source;
//   - the amber banner (L170-172) PROMISES an automation — that the system will
//     raise a spare-parts quote and push it to the customer over LINE OA by itself
//     — which does not exist: nothing auto-raises a quote, and LINE is an explicit
//     no-op stub (apps/api/src/routes/pm.ts lineNotifyStub, B-108b). It is a claim,
//     not a value, so it cannot be em-dashed — it is dropped.
//
// The real wire is the opaque Entity `GET /pm/workorders` returns
// (apps/api/src/routes/pm.ts workOrderWire):
//   { id, asset_id, template_id, tech, checkin_gps, items, cause, fix, advice,
//     customer_sign }
// `cause` / `fix` / `advice` are REAL nullable text columns
// (packages/db/src/schema/pm.ts pmWorkOrders L179-181) — exactly the three fields
// this screen edits. There is NO parts column on the work order: spare parts live on
// pmQuotes.parts, whose own home is `POST /pm/quotes` (pm.ts L830). So the parts
// slot carries no value here (see the screen).
//
// The only writer of those three columns is `POST /pm/workorders/:id/close`
// (pm.ts L761-811): it sets exactly the close fields the body carries and returns the
// updated work order. See pm_notes_repository.dart + BLOCKERS.md B-281 for why that
// endpoint's NAME is wider than the write this screen performs.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable. (The
// write-state resolution imports the queue model only, exactly like
// pm_checklist_agg.dart.)

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// An opaque contract Entity — GET /pm/workorders rows are `{ [k]: unknown }`.
typedef PmNotesEnt = Map<String, Object?>;

/// Non-empty string at [key] of an opaque row, else null (never "" — the view
/// treats a blank exactly like an absent value).
String? pmNotesStr(PmNotesEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// The work order with [id] among the opaque `GET /pm/workorders` rows, or null.
///
/// The PM routes expose no `GET /pm/workorders/:id`, so the list endpoint is the
/// honest read (the same one pm-jobs and pm-checklist use). A missing id yields null
/// → the screen renders honest-empty rather than an invented work order.
///
/// Deliberately NOT imported from pm_checklist_agg: each screen's agg is
/// self-contained (no Flutter, no cross-screen coupling) — the pm_checkin /
/// pm_checklist precedent.
PmNotesEnt? findWorkOrder(List<PmNotesEnt> rows, String id) {
  if (id.isEmpty) return null;
  for (final PmNotesEnt r in rows) {
    if (pmNotesStr(r, 'id') == id) return r;
  }
  return null;
}

/// The three stored maintenance-log columns of one work order.
///
/// Every field is null when the column is null OR blank — the screen starts such a
/// field EMPTY (its placeholder shows) rather than pretending a value exists.
class PmNotes {
  const PmNotes({this.cause, this.fix, this.advice});

  /// `pm_workorder.cause` — the fault / abnormality found (prototype L155).
  final String? cause;

  /// `pm_workorder.fix` — the repair / work performed (prototype L158).
  final String? fix;

  /// `pm_workorder.advice` — recommended follow-up work (prototype L161).
  final String? advice;

  /// True when the work order stores none of the three (a fresh log).
  bool get isEmpty => cause == null && fix == null && advice == null;
}

/// Parse a work order's opaque row into its stored [PmNotes].
PmNotes parsePmNotes(PmNotesEnt e) => PmNotes(
  cause: pmNotesStr(e, 'cause'),
  fix: pmNotesStr(e, 'fix'),
  advice: pmNotesStr(e, 'advice'),
);

/// Build the body for `POST /pm/workorders/:id/close`.
///
/// Sends the WHOLE form — all three keys, always — because the handler keys off
/// PRESENCE (`has(body, "cause")`): a key the body omits leaves its column
/// untouched, so a partial body could never CLEAR a field the technician just
/// emptied. Each value is trimmed and an empty one is sent as "" (the server's own
/// `str(...).trim() || null` then stores NULL) — the honest "the tech cleared this"
/// write, never a fabricated value.
///
/// The cost of that choice, and why the screen gates on the READ: sending all three
/// keys makes the save a whole-form, last-write-wins overwrite of exactly the columns
/// the read supplies. With the stored values unknown a blank field is
/// indistinguishable from a cleared one, so a save from an unseeded form would blank
/// text a previous visit stored. That is why an unreadable work order withholds the
/// form AND the button instead of offering the offline write (screen header + B-281).
///
/// `signature` / `customer_sign` is deliberately NOT sent: the customer signature
/// belongs to pm-close (prototype MPMClose, L205), and omitting the key leaves the
/// stored column untouched.
///
/// Replay safety: the write is a plain last-write-wins SET of three text columns —
/// no counter, no sequence, no JV, money = NONE — so re-sending the SAME body
/// converges on the same row. The B-261 client-idempotency-key contract guards money
/// writes and is not required here (the pm_checklist precedent).
Map<String, Object?> notesPayload(PmNotes n) => <String, Object?>{
  'cause': (n.cause ?? '').trim(),
  'fix': (n.fix ?? '').trim(),
  'advice': (n.advice ?? '').trim(),
};

/// The honest lifecycle of the maintenance-log save, as the screen renders it.
///
///   * [idle]    — nothing submitted yet (or edits made since the last save).
///   * [saving]  — UI-transient, a submit is in flight.
///   * [saved]   — the server durably accepted the write (2xx).
///   * [queued]  — offline / transient failure: kept in the queue, will retry.
///                 NEVER shown as a success (BLOCKERS.md B-268 option (a)).
///   * [failed]  — a permanent (4xx) rejection: kept + surfaced, no retry.
enum PmNotesSaveState { idle, saving, saved, queued, failed }

/// Resolve the honest post-drain state of the op [opId] from the drain [report] and
/// the ops still [due] in the queue (pending + failed).
///
/// Same resolution as pm_checklist_agg.resolveChecklistSaveState: the report is
/// authoritative when it touched the op this pass; otherwise the queue is the source
/// of truth (gone = synced, `failed` = dead-letter, `pending` = queued).
PmNotesSaveState resolveNotesSaveState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return PmNotesSaveState.saved;
      case SyncOutcome.permanentlyFailed:
        return PmNotesSaveState.failed;
      case SyncOutcome.deferred:
        return PmNotesSaveState.queued;
    }
  }
  for (final SyncOperation op in due) {
    if (op.id == opId) {
      return op.status == SyncOpStatus.failed
          ? PmNotesSaveState.failed
          : PmNotesSaveState.queued;
    }
  }
  return PmNotesSaveState.saved; // removed from the queue = synced
}
