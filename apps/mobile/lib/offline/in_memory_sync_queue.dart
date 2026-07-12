// Offline-first sync — in-memory reference implementation (P0-MOB-05).
//
// A non-durable [SyncQueue] that keeps operations in a plain map. It exists to
// (1) pin down the exact, level-agnostic semantics every SyncQueue must honour
// and (2) let those semantics be unit-tested without a native SQLite library.
// The production path uses the drift-backed queue (local_db.dart); this one is
// for tests, previews, and widget-book usage. It is NOT the offline strategy —
// that (level (a)/(b), Open Q #5) is deferred.

import 'sync_operation.dart';
import 'sync_queue.dart';

class InMemorySyncQueue implements SyncQueue {
  // Insertion-ordered so ties on createdAt fall back to enqueue order.
  final Map<String, SyncOperation> _items = <String, SyncOperation>{};

  @override
  Future<void> enqueue(SyncOperation op) async {
    // Replace on matching id → idempotent enqueue.
    _items[op.id] = op;
  }

  @override
  Future<List<SyncOperation>> pending({int? limit}) async {
    final due =
        _items.values.where((op) => op.status != SyncOpStatus.inFlight).toList()
          ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    if (limit != null && limit < due.length) {
      return due.sublist(0, limit);
    }
    return due;
  }

  @override
  Future<void> markInFlight(String id) async {
    _update(id, (op) => op.copyWith(status: SyncOpStatus.inFlight));
  }

  @override
  Future<void> markSynced(String id) async {
    _items.remove(id);
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    _update(
      id,
      (op) => op.copyWith(
        status: SyncOpStatus.failed,
        attemptCount: op.attemptCount + 1,
        lastError: error,
      ),
    );
  }

  @override
  Future<int> length() async => _items.length;

  @override
  Future<void> clear() async => _items.clear();

  void _update(String id, SyncOperation Function(SyncOperation) transform) {
    final current = _items[id];
    if (current != null) {
      _items[id] = transform(current);
    }
  }
}
