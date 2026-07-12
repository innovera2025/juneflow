// Offline-first sync — the LEVEL-DEPENDENT seam (P0-MOB-05, intentionally a stub).
//
// Everything in this package so far (SyncOperation, SyncQueue, its in-memory and
// drift implementations) is level-agnostic: it stores and orders pending writes.
// What a SyncProcessor does — WHEN to drain the queue, HOW to resolve a
// server/client conflict, WHETHER reads are served from a local cache, and how
// aggressively to retry — is exactly the behaviour that differs between offline
// levels (a) and (b). That choice is Open Question #5 (PLAN.md §11) and belongs
// to Wei.
//
// Per PLAN.md §0 rule 4 and the P0-MOB-05 task note ("only the part that does not
// depend on level (a)/(b) ... if it collides with a choice -> BLOCKERS, do not
// decide yourself"), NO concrete processor / drain policy is implemented here.
// This file only fixes the seam so Phase 4 can drop the chosen strategy in
// without reshaping the queue. Adding a concrete implementation is BLOCKED until
// Open Q #5 is answered.

import 'sync_operation.dart';
import 'sync_queue.dart';

/// Drains a [SyncQueue] by replaying its [SyncOperation]s against the API.
///
/// Deliberately minimal and unimplemented: the scheduling, conflict-resolution,
/// and retry/back-off policy are level-dependent (Open Q #5) and must not be
/// chosen inside the loop. A Phase-4 implementation will take the queue plus the
/// generated API client and provide those policies.
abstract interface class SyncProcessor {
  /// The queue this processor drains.
  SyncQueue get queue;

  /// Attempt to replay due writes once. The trigger cadence (manual, on
  /// reconnect, periodic) and conflict handling are level-dependent policy that
  /// a concrete implementation supplies — deferred to Open Q #5.
  Future<void> drainOnce();
}
