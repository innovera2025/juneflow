// AppServices offline wiring (B-262).
//
// Two claims are under test, both about WHERE the offline machinery lives:
//   1. bootstrap() takes the DURABLE queue when the platform can open one, so a
//      write queued in one app run is still there in the next;
//   2. there is exactly ONE drain processor, owned here and draining THE app queue —
//      it used to be constructed inside three screens' build methods, which is why a
//      queued op only drained while one of those screens was mounted.
//
// The "restart" here is a real one: the whole bootstrap runs twice over the same
// SQLite file, with the first run's handle closed in between.
import 'dart:async';
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/local_db.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/offline/sync_queue_store_io.dart';

/// A SyncApiClient whose send() hangs until [release] is called — lets a test hold
/// one drain mid-flight while a second trigger arrives.
class _BlockingApi implements SyncApiClient {
  final List<String> calls = <String>[];
  final List<Completer<SyncApiResponse>> _pending =
      <Completer<SyncApiResponse>>[];

  void release(SyncApiResponse response) {
    for (final Completer<SyncApiResponse> c in _pending) {
      if (!c.isCompleted) c.complete(response);
    }
  }

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) {
    calls.add(endpoint);
    final Completer<SyncApiResponse> c = Completer<SyncApiResponse>();
    _pending.add(c);
    return c.future;
  }
}

SyncOperation _op(String id) {
  return SyncOperation(
    id: id,
    entityType: 'pm_checkin',
    kind: SyncOpKind.create,
    endpoint: '/pm/workorders/$id/checkin',
    method: 'POST',
    payload: <String, Object?>{'gps': '13.7563, 100.5018'},
    createdAt: DateTime.utc(2026, 8, 5, 9),
  );
}

void main() {
  // bootstrap() reads i18n assets through rootBundle.
  TestWidgetsFlutterBinding.ensureInitialized();
  // Opening the same file twice is the POINT of the restart test (each open gets a
  // fresh executor, the previous one closed), so drift's "multiple databases"
  // warning is a false positive in these tests only.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  late Directory tmp;
  late File dbFile;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('juneflow_app_services_test');
    dbFile = File('${tmp.path}/juneflow_sync_queue.sqlite');
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  group('bootstrap — queue selection', () {
    test('takes the durable queue the opener supplies', () async {
      final DriftSyncQueue durable = openSyncQueueAt(dbFile);
      final AppServices services = await AppServices.bootstrap(
        openQueue: () async => durable,
      );

      expect(identical(services.syncQueue, durable), isTrue);
      expect(services.syncQueue, isA<DriftSyncQueue>());
      await durable.close();
    });

    test(
      'falls back to in-memory when the platform has no durable store',
      () async {
        // The web case (BLOCKERS.md B-289): honest degradation, not a boot crash.
        final AppServices services = await AppServices.bootstrap(
          openQueue: () async => null,
        );
        expect(services.syncQueue, isA<InMemorySyncQueue>());
      },
    );

    test('an explicitly injected queue still wins over the opener', () async {
      final InMemorySyncQueue injected = InMemorySyncQueue();
      final AppServices services = await AppServices.bootstrap(
        syncQueue: injected,
        openQueue: () async => openSyncQueueAt(dbFile),
      );
      expect(identical(services.syncQueue, injected), isTrue);
    });

    test('the default opener boots without a platform channel', () async {
      // No openQueue, no syncQueue: path_provider cannot answer in a unit test, so
      // the durable open returns null and boot degrades instead of throwing.
      final AppServices services = await AppServices.bootstrap();
      expect(services.syncQueue, isA<InMemorySyncQueue>());
    });
  });

  group('bootstrap — the shared drain processor', () {
    test('drains THE app queue (one store, not two)', () async {
      final AppServices services = await AppServices.bootstrap(
        openQueue: () async => null,
      );
      expect(
        identical(services.syncProcessor.queue, services.syncQueue),
        isTrue,
        reason: 'a processor over a different store would never see the write',
      );
    });

    test('an op enqueued on the queue is visible to the processor', () async {
      final AppServices services = await AppServices.bootstrap(
        openQueue: () async => null,
      );
      await services.syncQueue.enqueue(_op('a'));
      final List<SyncOperation> due = await services.syncProcessor.queue
          .pending();
      expect(due.single.id, 'a');
    });

    test(
      'overlapping triggers on the ONE processor replay the op once',
      () async {
        // Why the processor is a single long-lived instance and not built per
        // screen-build: the re-entrancy guard is per-INSTANCE. Two triggers can
        // genuinely overlap (a screen's post-enqueue drain and the app-resume drain).
        final AppServices services = await AppServices.bootstrap(
          openQueue: () async => null,
        );
        final _BlockingApi api = _BlockingApi();
        final QueueDrainProcessor shared = QueueDrainProcessor(
          services.syncQueue,
          api,
        );
        await services.syncQueue.enqueue(_op('a'));

        final Future<DrainReport> first = shared.drain();
        final Future<DrainReport> second = shared
            .drain(); // overlapping trigger
        await Future<void>.delayed(Duration.zero);
        api.release(const SyncApiResponse(statusCode: 200));
        await first;
        await second;

        expect(api.calls, <String>['/pm/workorders/a/checkin']);
        await services.syncQueue.length().then((int n) => expect(n, 0));
      },
    );

    test('TWO processors over the same queue would replay it twice', () async {
      // POSITIVE REGRESSION GUARD (true before and after this slice): it does not
      // die on a revert. It documents the cost the hoist removes — this is exactly
      // what three screens each building their own processor could produce.
      final AppServices services = await AppServices.bootstrap(
        openQueue: () async => null,
      );
      final _BlockingApi api = _BlockingApi();
      final QueueDrainProcessor a = QueueDrainProcessor(
        services.syncQueue,
        api,
      );
      final QueueDrainProcessor b = QueueDrainProcessor(
        services.syncQueue,
        api,
      );
      await services.syncQueue.enqueue(_op('a'));

      final Future<DrainReport> first = a.drain();
      final Future<DrainReport> second = b.drain();
      await Future<void>.delayed(Duration.zero);
      api.release(const SyncApiResponse(statusCode: 200));
      await first;
      await second;

      expect(
        api.calls.length,
        2,
        reason: 'separate instances = separate re-entrancy guards',
      );
    });
  });

  group('a write queued in one app run is there in the next', () {
    test('enqueue → kill the app → bootstrap again → still queued', () async {
      final DriftSyncQueue runOne = openSyncQueueAt(dbFile);
      final AppServices first = await AppServices.bootstrap(
        openQueue: () async => runOne,
      );
      await first.syncQueue.enqueue(_op('a'));
      await runOne.close(); // app killed with the write unsent

      final DriftSyncQueue runTwo = openSyncQueueAt(dbFile);
      final AppServices second = await AppServices.bootstrap(
        openQueue: () async => runTwo,
      );
      final List<SyncOperation> due = await second.syncQueue.pending();
      expect(due.single.id, 'a');
      expect(due.single.endpoint, '/pm/workorders/a/checkin');
      // ...and the new run's shared processor is the thing that can replay it.
      expect(identical(second.syncProcessor.queue, second.syncQueue), isTrue);
      await runTwo.close();
    });
  });
}
