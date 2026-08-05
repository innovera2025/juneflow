// Durability tests for the offline queue store (B-262).
//
// These run against the REAL production path — `openSyncQueueAt` →
// `DriftSyncQueue` → drift → real on-disk SQLite. Nothing is faked except the HTTP
// client, which is the collaborator, not the subject. The only difference from the
// app is the directory: the app resolves it through path_provider
// (`openDurableSyncQueue`), a test passes a temp file.
//
// "The app was killed" is simulated the only way that actually proves anything:
// close the queue's database handle and open a BRAND-NEW queue instance over the
// same file. A queue that only remembers within one process fails every test here —
// which is exactly what the shipped `InMemorySyncQueue` wiring did (the last group
// pins that contrast).
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/local_db.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
// Imported directly (not through sync_queue_store.dart): this file IS the dart:io
// branch under test, and `openSyncQueueAt` is deliberately io-only.
import 'package:juneflow_mobile/offline/sync_queue_store_io.dart';

SyncOperation _op(String id, {required DateTime createdAt}) {
  return SyncOperation(
    id: id,
    entityType: 'pm_checkin',
    kind: SyncOpKind.create,
    endpoint: '/pm/workorders/$id/checkin',
    method: 'POST',
    payload: <String, Object?>{'gps': '13.7563, 100.5018'},
    createdAt: createdAt,
  );
}

/// A scriptable SyncApiClient — same shape as sync_processor_test.dart's.
class _FakeApi implements SyncApiClient {
  _FakeApi(this.handler);

  final SyncApiResponse Function(String endpoint) handler;
  final List<String> calls = <String>[];

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    calls.add(endpoint);
    return handler(endpoint);
  }
}

const SyncApiResponse _ok = SyncApiResponse(statusCode: 200);
const SyncApiResponse _badRequest = SyncApiResponse(statusCode: 400);
const SyncApiResponse _serverErr = SyncApiResponse(statusCode: 503);

void main() {
  // Opening the same file twice is the POINT here (kill → relaunch), and each open
  // gets its own executor with the previous one closed, so drift's
  // "multiple databases" warning is a false positive in these tests only.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  final DateTime t0 = DateTime.utc(2026, 8, 5, 9);
  DateTime at(int minutes) => t0.add(Duration(minutes: minutes));

  late Directory tmp;
  late File dbFile;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('juneflow_queue_test');
    dbFile = File('${tmp.path}/juneflow_sync_queue.sqlite');
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  /// Opens a fresh queue instance over the test file — i.e. "launch the app".
  DriftSyncQueue launch() => openSyncQueueAt(dbFile);

  group('durable store — a queued write survives an app kill', () {
    test('the op is still there, field for field, after a restart', () async {
      final DriftSyncQueue first = launch();
      await first.enqueue(_op('a', createdAt: t0));
      expect(await first.length(), 1);
      await first.close(); // app killed

      final DriftSyncQueue second = launch(); // app relaunched
      expect(
        await second.length(),
        1,
        reason: 'the write must outlive the process — this is the whole point',
      );
      final SyncOperation restored = (await second.pending()).single;
      expect(restored.id, 'a');
      expect(restored.entityType, 'pm_checkin');
      expect(restored.kind, SyncOpKind.create);
      expect(restored.method, 'POST');
      expect(restored.endpoint, '/pm/workorders/a/checkin');
      expect(restored.payload, <String, Object?>{'gps': '13.7563, 100.5018'});
      expect(restored.createdAt, t0);
      expect(restored.createdAt.isUtc, isTrue);
      expect(restored.status, SyncOpStatus.pending);
      expect(restored.attemptCount, 0);
      await second.close();
    });

    test(
      'the restored op is DRAINABLE, and the removal is durable too',
      () async {
        final DriftSyncQueue first = launch();
        await first.enqueue(_op('a', createdAt: t0));
        await first.close();

        final DriftSyncQueue second = launch();
        final _FakeApi api = _FakeApi((_) => _ok);
        final DrainReport report = await QueueDrainProcessor(
          second,
          api,
        ).drain();

        expect(api.calls, <String>['/pm/workorders/a/checkin']);
        expect(report.attemptFor('a')?.outcome, SyncOutcome.synced);
        expect(await second.length(), 0);
        await second.close();

        // ...and the 2xx removal itself survives the next restart (a durable store
        // that forgot the DELETE would double-post on the following launch).
        final DriftSyncQueue third = launch();
        expect(await third.length(), 0);
        await third.close();
      },
    );

    test('FIFO by createdAt is preserved across the restart', () async {
      final DriftSyncQueue first = launch();
      // Enqueued out of order on purpose — order must come from createdAt, not
      // from insertion or from SQLite's row order.
      await first.enqueue(_op('c', createdAt: at(20)));
      await first.enqueue(_op('a', createdAt: at(0)));
      await first.enqueue(_op('b', createdAt: at(10)));
      await first.close();

      final DriftSyncQueue second = launch();
      final _FakeApi api = _FakeApi((_) => _ok);
      await QueueDrainProcessor(second, api).drain();
      expect(api.calls, <String>[
        '/pm/workorders/a/checkin',
        '/pm/workorders/b/checkin',
        '/pm/workorders/c/checkin',
      ]);
      await second.close();
    });

    test(
      'a 5xx deferral survives with its attempt count and retries',
      () async {
        final DriftSyncQueue first = launch();
        await first.enqueue(_op('a', createdAt: t0));
        await QueueDrainProcessor(first, _FakeApi((_) => _serverErr)).drain();
        await first.close();

        final DriftSyncQueue second = launch();
        final SyncOperation restored = (await second.pending()).single;
        expect(
          restored.status,
          SyncOpStatus.pending,
          reason: '5xx stays retryable',
        );
        expect(restored.attemptCount, 1);
        expect(restored.lastError, 'HTTP 503');
        // ...and the next launch's drain does retry it.
        final _FakeApi api = _FakeApi((_) => _ok);
        await QueueDrainProcessor(second, api).drain();
        expect(api.calls, <String>['/pm/workorders/a/checkin']);
        expect(await second.length(), 0);
        await second.close();
      },
    );

    test(
      'a 4xx dead-letter survives as a dead-letter (kept, never replayed)',
      () async {
        final DriftSyncQueue first = launch();
        await first.enqueue(_op('a', createdAt: t0));
        await QueueDrainProcessor(first, _FakeApi((_) => _badRequest)).drain();
        await first.close();

        final DriftSyncQueue second = launch();
        final SyncOperation restored = (await second.pending()).single;
        expect(restored.status, SyncOpStatus.failed, reason: 'kept + visible');
        expect(restored.attemptCount, 1);
        expect(restored.lastError, 'HTTP 400');
        // The next launch does NOT replay it (unchanged (a) policy: 4xx is permanent).
        final _FakeApi api = _FakeApi((_) => _ok);
        await QueueDrainProcessor(second, api).drain();
        expect(api.calls, isEmpty);
        expect(await second.length(), 1, reason: 'never silently dropped');
        await second.close();
      },
    );

    test('a dead-letter does not block a live op queued behind it', () async {
      final DriftSyncQueue first = launch();
      await first.enqueue(_op('dead', createdAt: at(0)));
      await QueueDrainProcessor(first, _FakeApi((_) => _badRequest)).drain();
      await first.enqueue(_op('live', createdAt: at(5)));
      await first.close();

      final DriftSyncQueue second = launch();
      final _FakeApi api = _FakeApi((_) => _ok);
      await QueueDrainProcessor(second, api).drain();
      expect(api.calls, <String>['/pm/workorders/live/checkin']);
      expect(await second.length(), 1, reason: 'only the dead-letter remains');
      await second.close();
    });

    test(
      'enqueue is idempotent on id across a restart (no duplicate write)',
      () async {
        final DriftSyncQueue first = launch();
        await first.enqueue(_op('a', createdAt: t0));
        await first.close();

        // Same client action retried after a relaunch → same idempotency key.
        final DriftSyncQueue second = launch();
        await second.enqueue(_op('a', createdAt: t0));
        expect(await second.length(), 1);
        await second.close();
      },
    );
  });

  group('openDurableSyncQueue — honest null without a platform channel', () {
    test('returns null in a plain unit test instead of throwing', () async {
      // No Flutter platform channel here, so path_provider cannot answer. The
      // contract is a null (caller degrades to in-memory), never a boot crash.
      expect(await openDurableSyncQueue(), isNull);
    });
  });

  group('contrast — the in-memory queue this replaced loses the write', () {
    // POSITIVE REGRESSION GUARD: true both before and after this slice. It does not
    // die on a revert; it is here to pin WHY the durable store is required, so a
    // future "just use the in-memory one, it's simpler" is caught by a red test.
    test(
      'a fresh InMemorySyncQueue instance has forgotten everything',
      () async {
        final InMemorySyncQueue before = InMemorySyncQueue();
        await before.enqueue(_op('a', createdAt: t0));
        expect(await before.length(), 1);

        final InMemorySyncQueue afterKill = InMemorySyncQueue();
        expect(
          await afterKill.length(),
          0,
          reason: 'this is the data loss B-262 fixes',
        );
      },
    );
  });
}
