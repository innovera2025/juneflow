// Unit tests for the level-(ก) drain policy (QueueDrainProcessor, B-242).
//
// These are the load-bearing tests of this slice: they pin the "queue-and-replay"
// contract against InMemorySyncQueue + a fake SyncApiClient (no network, no Dio):
//   2xx -> removed · 4xx -> failed-and-kept (never retried) · 5xx -> pending-and-
//   retried-next-drain · transport-throw -> deferred · FIFO order preserved · a
//   stuck op blocks the ones behind it · empty-queue safe · attempts increments ·
//   the re-entrancy guard · the DrainReport surface.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';

/// One queued write. Distinct createdAt values control FIFO order deterministically.
SyncOperation _op(String id, {required DateTime createdAt}) {
  return SyncOperation(
    id: id,
    entityType: 'pm_checkin',
    kind: SyncOpKind.create,
    endpoint: '/pm/workorders/$id/checkin',
    method: 'POST',
    payload: <String, Object?>{'gps': null},
    createdAt: createdAt,
  );
}

/// A scriptable SyncApiClient. [handler] answers each call by (0-based) call index,
/// method, endpoint and payload; it may RETURN a response or THROW to simulate a
/// transport failure (no HTTP response reached the client).
class _FakeApi implements SyncApiClient {
  _FakeApi(this.handler);

  final SyncApiResponse Function(
    int callIndex,
    String method,
    String endpoint,
    Map<String, Object?> payload,
  )
  handler;

  /// The endpoints called, in order — lets a test assert FIFO + no-skip behaviour.
  final List<String> calls = <String>[];

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    final int i = calls.length;
    calls.add(endpoint);
    return handler(i, method, endpoint, payload);
  }
}

/// The op with [id] currently in the queue (any due status), or null when removed.
Future<SyncOperation?> _find(InMemorySyncQueue q, String id) async {
  for (final SyncOperation op in await q.pending()) {
    if (op.id == id) return op;
  }
  return null;
}

const SyncApiResponse _ok = SyncApiResponse(statusCode: 200);
const SyncApiResponse _badRequest = SyncApiResponse(statusCode: 400);
const SyncApiResponse _serverErr = SyncApiResponse(statusCode: 503);

void main() {
  final DateTime t0 = DateTime.utc(2026, 8, 4, 9);
  DateTime at(int minutes) => t0.add(Duration(minutes: minutes));

  group('QueueDrainProcessor — 2xx success', () {
    test('a 2xx op is marked synced and removed from the queue', () async {
      final InMemorySyncQueue q = InMemorySyncQueue();
      await q.enqueue(_op('a', createdAt: t0));
      final _FakeApi api = _FakeApi((_, _, _, _) => _ok);
      final QueueDrainProcessor p = QueueDrainProcessor(q, api);

      final DrainReport report = await p.drain();

      expect(await q.length(), 0, reason: '2xx removes the op');
      expect(await _find(q, 'a'), isNull);
      expect(api.calls, <String>['/pm/workorders/a/checkin']);
      final SyncAttempt? att = report.attemptFor('a');
      expect(att?.outcome, SyncOutcome.synced);
      expect(att?.statusCode, 200);
    });

    test('the 2xx response body rides back on the attempt', () async {
      final InMemorySyncQueue q = InMemorySyncQueue();
      await q.enqueue(_op('a', createdAt: t0));
      final _FakeApi api = _FakeApi(
        (_, _, _, _) => const SyncApiResponse(
          statusCode: 200,
          body: <String, Object?>{'checkin_gps': '13.8,100.5'},
        ),
      );
      final DrainReport report = await QueueDrainProcessor(q, api).drain();
      expect(report.attemptFor('a')?.body, <String, Object?>{
        'checkin_gps': '13.8,100.5',
      });
    });
  });

  group('QueueDrainProcessor — 4xx permanent dead-letter', () {
    test(
      'a 4xx op is marked failed, KEPT, and visible (never dropped)',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: t0));
        final _FakeApi api = _FakeApi((_, _, _, _) => _badRequest);

        final DrainReport report = await QueueDrainProcessor(q, api).drain();

        expect(
          await q.length(),
          1,
          reason: 'a dead-letter is kept, not dropped',
        );
        final SyncOperation? kept = await _find(q, 'a');
        expect(kept?.status, SyncOpStatus.failed);
        expect(kept?.attemptCount, 1, reason: '4xx increments attempts');
        expect(kept?.lastError, 'HTTP 400');
        expect(report.attemptFor('a')?.outcome, SyncOutcome.permanentlyFailed);
        expect(report.attemptFor('a')?.statusCode, 400);
      },
    );

    test('a 4xx dead-letter is NOT replayed by a later drain', () async {
      final InMemorySyncQueue q = InMemorySyncQueue();
      await q.enqueue(_op('a', createdAt: t0));
      final _FakeApi api = _FakeApi((_, _, _, _) => _badRequest);
      final QueueDrainProcessor p = QueueDrainProcessor(q, api);

      await p.drain(); // one call -> failed
      final DrainReport second = await p
          .drain(); // must NOT re-call the dead-letter

      expect(api.calls.length, 1, reason: 'the dead-letter is never retried');
      expect(second.attempts, isEmpty, reason: 'nothing replayable remains');
      expect((await _find(q, 'a'))?.status, SyncOpStatus.failed);
    });

    test(
      'a 4xx does NOT block the writes behind it — the drain continues',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: at(0))); // will 4xx (dead)
        await q.enqueue(
          _op('b', createdAt: at(1)),
        ); // must still be attempted -> 2xx
        final _FakeApi api = _FakeApi(
          (_, _, String endpoint, _) =>
              endpoint.contains('/a/') ? _badRequest : _ok,
        );

        final DrainReport report = await QueueDrainProcessor(q, api).drain();

        expect(api.calls, <String>[
          '/pm/workorders/a/checkin',
          '/pm/workorders/b/checkin',
        ], reason: 'the drain steps past the dead-letter to b');
        expect(report.attemptFor('a')?.outcome, SyncOutcome.permanentlyFailed);
        expect(report.attemptFor('b')?.outcome, SyncOutcome.synced);
        expect(await _find(q, 'b'), isNull, reason: 'b synced + removed');
        expect((await _find(q, 'a'))?.status, SyncOpStatus.failed);
      },
    );
  });

  group('QueueDrainProcessor — 5xx transient deferral', () {
    test(
      'a 5xx op stays pending, bumps attempts, and STOPS the drain',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: t0));
        final _FakeApi api = _FakeApi((_, _, _, _) => _serverErr);

        final DrainReport report = await QueueDrainProcessor(q, api).drain();

        final SyncOperation? kept = await _find(q, 'a');
        expect(kept, isNotNull, reason: '5xx keeps the op');
        expect(kept?.status, SyncOpStatus.pending, reason: 'still retryable');
        expect(kept?.attemptCount, 1, reason: '5xx increments attempts');
        expect(kept?.lastError, 'HTTP 503');
        expect(report.attemptFor('a')?.outcome, SyncOutcome.deferred);
      },
    );

    test(
      'the 5xx op is retried on the NEXT drain (attempts keep climbing)',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: t0));
        // First call 5xx, second call 2xx -> the retry succeeds.
        final _FakeApi api = _FakeApi(
          (int i, _, _, _) => i == 0 ? _serverErr : _ok,
        );
        final QueueDrainProcessor p = QueueDrainProcessor(q, api);

        await p.drain(); // 5xx -> deferred, attempts = 1, still queued
        expect((await _find(q, 'a'))?.attemptCount, 1);

        final DrainReport second = await p.drain(); // retry -> 2xx -> removed
        expect(api.calls.length, 2, reason: 'the same op is retried');
        expect(await q.length(), 0, reason: 'the retry synced it away');
        expect(second.attemptFor('a')?.outcome, SyncOutcome.synced);
      },
    );

    test(
      'a stuck (5xx) op blocks the ones behind it — FIFO, no skip-ahead',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: at(0))); // stuck (always 5xx)
        await q.enqueue(_op('b', createdAt: at(1))); // must NOT be reached
        await q.enqueue(_op('c', createdAt: at(2)));
        final _FakeApi api = _FakeApi(
          (_, _, String endpoint, _) =>
              endpoint.contains('/a/') ? _serverErr : _ok,
        );

        final DrainReport report = await QueueDrainProcessor(q, api).drain();

        expect(
          api.calls,
          <String>['/pm/workorders/a/checkin'],
          reason: 'the drain stops at the stuck head; b and c are never called',
        );
        expect(report.attempts.length, 1);
        expect(report.attemptFor('a')?.outcome, SyncOutcome.deferred);
        expect(
          await q.length(),
          3,
          reason: 'nothing behind the stuck op is touched',
        );
        expect((await _find(q, 'b'))?.status, SyncOpStatus.pending);
        expect((await _find(q, 'c'))?.status, SyncOpStatus.pending);
      },
    );
  });

  group('QueueDrainProcessor — transport failure (throw)', () {
    test(
      'a thrown transport error defers the op and STOPS the drain',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        await q.enqueue(_op('a', createdAt: at(0)));
        await q.enqueue(_op('b', createdAt: at(1)));
        final _FakeApi api = _FakeApi((_, _, String endpoint, _) {
          if (endpoint.contains('/a/')) {
            throw Exception('SocketException: offline');
          }
          return _ok;
        });

        final DrainReport report = await QueueDrainProcessor(q, api).drain();

        expect(api.calls, <String>[
          '/pm/workorders/a/checkin',
        ], reason: 'a transport failure stops the drain (b not reached)');
        final SyncOperation? kept = await _find(q, 'a');
        expect(
          kept?.status,
          SyncOpStatus.pending,
          reason: 'transient — still retryable',
        );
        expect(kept?.attemptCount, 1);
        expect(kept?.lastError, contains('offline'));
        expect(report.attemptFor('a')?.outcome, SyncOutcome.deferred);
        expect(report.attemptFor('a')?.error, contains('offline'));
      },
    );
  });

  group('QueueDrainProcessor — FIFO + ordering', () {
    test(
      'ops replay oldest-first by createdAt, regardless of enqueue order',
      () async {
        final InMemorySyncQueue q = InMemorySyncQueue();
        // Enqueue out of chronological order; createdAt decides FIFO.
        await q.enqueue(_op('c', createdAt: at(2)));
        await q.enqueue(_op('a', createdAt: at(0)));
        await q.enqueue(_op('b', createdAt: at(1)));
        final _FakeApi api = _FakeApi((_, _, _, _) => _ok);

        await QueueDrainProcessor(q, api).drain();

        expect(api.calls, <String>[
          '/pm/workorders/a/checkin',
          '/pm/workorders/b/checkin',
          '/pm/workorders/c/checkin',
        ]);
        expect(await q.length(), 0);
      },
    );
  });

  group('QueueDrainProcessor — empty + re-entrancy', () {
    test('draining an empty queue is safe and reports nothing', () async {
      final InMemorySyncQueue q = InMemorySyncQueue();
      final _FakeApi api = _FakeApi((_, _, _, _) => _ok);

      final DrainReport report = await QueueDrainProcessor(q, api).drain();

      expect(api.calls, isEmpty);
      expect(report.attempts, isEmpty);
    });

    test('a re-entrant drain is skipped (returns an empty report)', () async {
      final InMemorySyncQueue q = InMemorySyncQueue();
      await q.enqueue(_op('a', createdAt: t0));
      final _FakeApi api = _FakeApi((_, _, _, _) => _ok);
      final QueueDrainProcessor p = QueueDrainProcessor(q, api);

      // drain() runs synchronously up to its first `await queue.pending()`, so it
      // sets the re-entrancy guard before suspending. A second drain() started
      // while the first is in flight must therefore be guarded out (no replay).
      final Future<DrainReport> first = p.drain();
      final DrainReport nested = await p.drain(); // overlaps first's async gap
      await first;

      // Exactly one network call happened; the nested drain was guarded out.
      expect(api.calls.length, 1);
      expect(nested.attempts, isEmpty);
      expect(await q.length(), 0);
    });
  });
}
