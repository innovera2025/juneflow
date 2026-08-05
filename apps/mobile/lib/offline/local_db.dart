// Offline-first sync — drift/SQLite backing store (P0-MOB-05).
//
// The durable implementation of [SyncQueue] required by PLAN.md Appendix A
// ("Flutter · offline-first (drift/SQLite + sync queue)"). This is the LEVEL-
// AGNOSTIC persistence layer only: a single table that stores queued writes and
// a DAO that stores/orders/transitions them. It contains NO sync policy — the
// drain schedule, conflict resolution, and read-cache behaviour depend on the
// offline level (a)/(b) of Open Question #5 (PLAN.md §11) and are deferred.
//
// The generated part `local_db.g.dart` is produced by drift_dev via build_runner
// and is never hand-edited (it is a *.g.dart file, excluded from analysis).
//
// NOTE: opening a [LocalDb] needs a QueryExecutor (e.g. drift's NativeDatabase on
// a real device, wired in Phase 4). The queue *contract* is unit-tested through
// InMemorySyncQueue so it needs no native SQLite library in CI.

import 'package:drift/drift.dart';

import 'sync_operation.dart';
import 'sync_queue.dart';

part 'local_db.g.dart';

/// One row per queued offline write. Column set mirrors [SyncOperation.toRow];
/// `createdAt` is stored as an ISO-8601 **UTC** string (root CLAUDE.md: time is
/// stored UTC everywhere) rather than a drift DateTime, to keep the stored value
/// timezone-unambiguous.
class SyncQueueItems extends Table {
  TextColumn get id => text()();
  TextColumn get entityType => text()();
  TextColumn get kind => text()();
  TextColumn get endpoint => text()();
  TextColumn get method => text()();
  TextColumn get payload => text()();
  TextColumn get createdAt => text()();
  TextColumn get status => text()();
  IntColumn get attemptCount => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [SyncQueueItems])
class LocalDb extends _$LocalDb {
  LocalDb(super.e);

  @override
  int get schemaVersion => 1;

  /// Read-side helper: rebuilds a [SyncOperation] from a drift row.
  SyncOperation _toOperation(SyncQueueItem row) {
    return SyncOperation.fromRow({
      'id': row.id,
      'entity_type': row.entityType,
      'kind': row.kind,
      'endpoint': row.endpoint,
      'method': row.method,
      'payload': row.payload,
      'created_at': row.createdAt,
      'status': row.status,
      'attempt_count': row.attemptCount,
      'last_error': row.lastError,
    });
  }

  SyncQueueItemsCompanion _toCompanion(SyncOperation op) {
    final row = op.toRow();
    return SyncQueueItemsCompanion(
      id: Value(row['id'] as String),
      entityType: Value(row['entity_type'] as String),
      kind: Value(row['kind'] as String),
      endpoint: Value(row['endpoint'] as String),
      method: Value(row['method'] as String),
      payload: Value(row['payload'] as String),
      createdAt: Value(row['created_at'] as String),
      status: Value(row['status'] as String),
      attemptCount: Value(row['attempt_count'] as int),
      lastError: Value(row['last_error'] as String?),
    );
  }
}

/// [SyncQueue] backed by a drift [LocalDb]. Thin adapter: it maps the queue
/// contract onto SQL and holds no policy of its own.
///
/// Constructed by `sync_queue_store_io.dart` (the platform-conditional opener that
/// `AppServices.bootstrap` calls); see sync_queue_store.dart for why the executor
/// choice lives there and not here.
class DriftSyncQueue implements SyncQueue {
  DriftSyncQueue(this._db);

  final LocalDb _db;

  /// Closes the underlying database handle.
  ///
  /// Every queue mutation is committed by the time its Future completes, so closing
  /// never drops a queued write — this only releases the connection (sign-out, app
  /// teardown, and the "app was killed" step in the durability tests).
  Future<void> close() => _db.close();

  @override
  Future<void> enqueue(SyncOperation op) async {
    // insertOnConflictUpdate → idempotent enqueue keyed on the primary key.
    await _db
        .into(_db.syncQueueItems)
        .insertOnConflictUpdate(_db._toCompanion(op));
  }

  @override
  Future<List<SyncOperation>> pending({int? limit}) async {
    final query = _db.select(_db.syncQueueItems)
      ..where((t) => t.status.equals(SyncOpStatus.inFlight.name).not())
      ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]);
    if (limit != null) {
      query.limit(limit);
    }
    final rows = await query.get();
    return rows.map(_db._toOperation).toList();
  }

  @override
  Future<void> markInFlight(String id) async {
    await (_db.update(_db.syncQueueItems)..where((t) => t.id.equals(id))).write(
      SyncQueueItemsCompanion(status: Value(SyncOpStatus.inFlight.name)),
    );
  }

  @override
  Future<void> markSynced(String id) async {
    await (_db.delete(_db.syncQueueItems)..where((t) => t.id.equals(id))).go();
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    await _db.transaction(() async {
      final current = await (_db.select(
        _db.syncQueueItems,
      )..where((t) => t.id.equals(id))).getSingleOrNull();
      if (current == null) return;
      await (_db.update(
        _db.syncQueueItems,
      )..where((t) => t.id.equals(id))).write(
        SyncQueueItemsCompanion(
          status: Value(SyncOpStatus.failed.name),
          attemptCount: Value(current.attemptCount + 1),
          lastError: Value(error),
        ),
      );
    });
  }

  @override
  Future<int> length() async {
    final count = _db.syncQueueItems.id.count();
    final query = _db.selectOnly(_db.syncQueueItems)..addColumns([count]);
    final row = await query.getSingle();
    return row.read(count) ?? 0;
  }

  @override
  Future<void> clear() async {
    await _db.delete(_db.syncQueueItems).go();
  }
}
