// Unit tests for the level-agnostic offline queue contract (P0-MOB-05).
//
// These exercise the SyncQueue semantics through InMemorySyncQueue (no native
// SQLite needed) plus the SyncOperation model. DriftSyncQueue shares the exact
// same contract; it is exercised against a real device DB in Phase 4. Nothing
// here asserts any offline-level (a)/(b) policy — that is Open Q #5, deferred.

import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/offline.dart';

SyncOperation _op(String id, {required DateTime createdAt}) {
  return SyncOperation(
    id: id,
    entityType: 'defect',
    kind: SyncOpKind.create,
    endpoint: '/defects/$id/fix',
    method: 'POST',
    payload: {'note': 'fixed', 'seq': id},
    createdAt: createdAt,
  );
}

void main() {
  final t0 = DateTime.utc(2026, 7, 12, 8);

  group('SyncOperation model', () {
    test('normalises createdAt to UTC', () {
      final local = DateTime(2026, 7, 12, 8);
      final op = _op('a', createdAt: local);
      expect(op.createdAt.isUtc, isTrue);
      expect(op.createdAt, local.toUtc());
    });

    test('round-trips through toRow/fromRow', () {
      final op = _op('a', createdAt: t0).copyWith(
        status: SyncOpStatus.failed,
        attemptCount: 2,
        lastError: 'boom',
      );
      final back = SyncOperation.fromRow(op.toRow());

      expect(back.id, op.id);
      expect(back.entityType, op.entityType);
      expect(back.kind, op.kind);
      expect(back.endpoint, op.endpoint);
      expect(back.method, op.method);
      expect(back.payload, op.payload);
      expect(back.createdAt, op.createdAt);
      expect(back.status, SyncOpStatus.failed);
      expect(back.attemptCount, 2);
      expect(back.lastError, 'boom');
    });

    test('copyWith can clear lastError', () {
      final op = _op('a', createdAt: t0).copyWith(lastError: 'boom');
      expect(op.copyWith(clearLastError: true).lastError, isNull);
    });
  });

  group('SyncQueue contract (InMemorySyncQueue)', () {
    late SyncQueue queue;
    setUp(() => queue = InMemorySyncQueue());

    test('enqueue then length counts every status', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.enqueue(
        _op('b', createdAt: t0.add(const Duration(minutes: 1))),
      );
      expect(await queue.length(), 2);
    });

    test('enqueue is idempotent on id', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.enqueue(_op('a', createdAt: t0));
      expect(await queue.length(), 1);
    });

    test('pending is FIFO by createdAt', () async {
      await queue.enqueue(
        _op('late', createdAt: t0.add(const Duration(hours: 1))),
      );
      await queue.enqueue(_op('early', createdAt: t0));
      final due = await queue.pending();
      expect(due.map((o) => o.id).toList(), ['early', 'late']);
    });

    test('pending honours limit', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.enqueue(
        _op('b', createdAt: t0.add(const Duration(minutes: 1))),
      );
      await queue.enqueue(
        _op('c', createdAt: t0.add(const Duration(minutes: 2))),
      );
      final due = await queue.pending(limit: 2);
      expect(due.map((o) => o.id).toList(), ['a', 'b']);
    });

    test(
      'inFlight items are excluded from pending but still counted',
      () async {
        await queue.enqueue(_op('a', createdAt: t0));
        await queue.markInFlight('a');
        expect(await queue.pending(), isEmpty);
        expect(await queue.length(), 1);
      },
    );

    test('markSynced removes the item', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.markSynced('a');
      expect(await queue.length(), 0);
      expect(await queue.pending(), isEmpty);
    });

    test('markFailed increments attempts, records error, stays due', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.markFailed('a', error: 'network');
      final due = await queue.pending();
      expect(due, hasLength(1));
      expect(due.single.status, SyncOpStatus.failed);
      expect(due.single.attemptCount, 1);
      expect(due.single.lastError, 'network');

      await queue.markInFlight('a');
      await queue.markFailed('a', error: 'again');
      final again = (await queue.pending()).single;
      expect(again.attemptCount, 2);
      expect(again.lastError, 'again');
    });

    test('transitions on a missing id are no-ops', () async {
      await queue.markInFlight('nope');
      await queue.markSynced('nope');
      await queue.markFailed('nope', error: 'x');
      expect(await queue.length(), 0);
    });

    test('clear empties the queue', () async {
      await queue.enqueue(_op('a', createdAt: t0));
      await queue.enqueue(_op('b', createdAt: t0));
      await queue.clear();
      expect(await queue.length(), 0);
    });
  });
}
