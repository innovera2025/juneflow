// Offline-first sync — the queue contract (P0-MOB-05).
//
// [SyncQueue] is the LEVEL-AGNOSTIC persistence contract for pending writes: it
// only stores, orders, and transitions queued [SyncOperation]s. It deliberately
// says NOTHING about when the queue is drained, how conflicts are resolved, or
// whether reads are cached — those are level-dependent policy and are gated on
// Open Question #5 (PLAN.md §11), so they live behind the (still-unimplemented)
// SyncProcessor seam, not here.
//
// Backed at runtime by the drift/SQLite implementation (local_db.dart /
// DriftSyncQueue); InMemorySyncQueue is the reference implementation used to test
// the contract without a native SQLite dependency.

import 'sync_operation.dart';

/// Durable, FIFO-ordered store of pending offline writes.
///
/// Implementations must be safe to call from the app's single UI isolate. All
/// methods are async because the production backing store (drift/SQLite) is.
abstract interface class SyncQueue {
  /// Append [op] to the tail of the queue. If an operation with the same
  /// [SyncOperation.id] already exists it is replaced (idempotent enqueue), so a
  /// retry of the same client action never duplicates a write.
  Future<void> enqueue(SyncOperation op);

  /// Writes that still need to be replayed — [SyncOpStatus.pending] and
  /// [SyncOpStatus.failed] — oldest first by [SyncOperation.createdAt].
  /// [SyncOpStatus.inFlight] items are excluded (a processor is already on them).
  /// [limit], when given, caps the batch size.
  Future<List<SyncOperation>> pending({int? limit});

  /// Mark a write as being replayed right now, so concurrent drains skip it.
  Future<void> markInFlight(String id);

  /// Remove a write that the server has durably accepted.
  Future<void> markSynced(String id);

  /// Record a failed replay: increments [SyncOperation.attemptCount], stores
  /// [error], and returns the item to a due state for a later retry.
  Future<void> markFailed(String id, {required String error});

  /// Total number of items currently in the queue, in any status.
  Future<int> length();

  /// Drop every queued write. Intended for sign-out / local-reset flows.
  Future<void> clear();
}
