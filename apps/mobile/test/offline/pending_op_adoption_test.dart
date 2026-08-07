// Unit tests for the post-restart adoption rules (B-330, pending_op_adoption.dart).
//
// These pin the two properties every offline-write screen leans on and that no
// single screen can be trusted to restate correctly five times over:
//   1. only a STILL-REPLAYABLE (`pending`) op is adoptable — a 4xx dead-letter must
//      NOT be adopted, or the user is stranded on a write the drain will never send
//      again and can never re-make (the mirror-image defect of the duplicate);
//   2. a screen adopts ONLY ITS OWN op — the queue is one global FIFO, so entity
//      type + the record anchor is the whole of identity, and matching too loosely
//      makes one record's screen swallow another record's write.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/pending_op_adoption.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';

SyncOperation _op({
  required String id,
  String entityType = 'pm_notes',
  String endpoint = '/pm/workorders/wo-1/close',
  Map<String, Object?> payload = const <String, Object?>{},
  SyncOpStatus status = SyncOpStatus.pending,
  int minute = 0,
}) => SyncOperation(
  id: id,
  entityType: entityType,
  kind: SyncOpKind.update,
  endpoint: endpoint,
  method: 'POST',
  payload: payload,
  createdAt: DateTime.utc(2026, 8, 7, 9, minute),
  status: status,
);

const SyncOpIdentity _notesWo1 = SyncOpIdentity(
  entityType: 'pm_notes',
  endpoint: '/pm/workorders/wo-1/close',
);

void main() {
  group('SyncOpIdentity.matches', () {
    test('matches its own entity type + endpoint', () {
      expect(_notesWo1.matches(_op(id: 'k1')), isTrue);
    });

    test('a DIFFERENT record of the same screen does not match', () {
      // The endpoint carries the anchor: wo-2's log write is not wo-1's.
      expect(
        _notesWo1.matches(_op(id: 'k1', endpoint: '/pm/workorders/wo-2/close')),
        isFalse,
      );
    });

    test('a DIFFERENT screen on the same record does not match', () {
      // Same work order, different write. Entity type alone would collide if the
      // endpoint were ignored, and the endpoint alone would collide for `/gr`.
      expect(
        _notesWo1.matches(
          _op(
            id: 'k1',
            entityType: 'pm_checklist',
            endpoint: '/pm/workorders/wo-1/checklist',
          ),
        ),
        isFalse,
      );
    });

    test(
      'a record-agnostic endpoint is pinned by the PAYLOAD anchor instead — the '
      'st-receive (POST /gr) case, where every PO shares one path',
      () {
        const SyncOpIdentity poA = SyncOpIdentity(
          entityType: 'gr',
          endpoint: '/gr',
          payloadAnchor: <String, Object?>{'po_id': 'po-A'},
        );
        SyncOperation grFor(String poId) => _op(
          id: 'k',
          entityType: 'gr',
          endpoint: '/gr',
          payload: <String, Object?>{'po_id': poId, 'idempotency_key': 'k'},
        );

        expect(poA.matches(grFor('po-A')), isTrue);
        // Endpoint + entity type are IDENTICAL here; only the anchor differs. If
        // this ever returns true, PO-B's receipt screen adopts PO-A's key and
        // PO-B's receipt is silently never sent — on a money path.
        expect(poA.matches(grFor('po-B')), isFalse);
      },
    );

    test('an op missing the anchor field entirely does not match', () {
      const SyncOpIdentity poA = SyncOpIdentity(
        entityType: 'gr',
        endpoint: '/gr',
        payloadAnchor: <String, Object?>{'po_id': 'po-A'},
      );
      expect(
        poA.matches(_op(id: 'k', entityType: 'gr', endpoint: '/gr')),
        isFalse,
      );
    });
  });

  group('findAdoptableOp', () {
    test('adopts a pending op of its own', () {
      final SyncOperation? found = findAdoptableOp(<SyncOperation>[
        _op(id: 'k1'),
      ], _notesWo1);
      expect(found?.id, 'k1');
    });

    test('nothing due → null (so the caller mints a fresh key, as before)', () {
      expect(findAdoptableOp(const <SyncOperation>[], _notesWo1), isNull);
    });

    test('never adopts another record\'s op', () {
      final SyncOperation? found = findAdoptableOp(<SyncOperation>[
        _op(id: 'k-other', endpoint: '/pm/workorders/wo-2/close'),
      ], _notesWo1);
      expect(found, isNull);
    });

    test(
      'NEVER adopts a 4xx dead-letter: it is skipped by every future drain, so '
      'adopting it would strand the write instead of duplicating it',
      () {
        final SyncOperation? found = findAdoptableOp(<SyncOperation>[
          _op(id: 'k-dead', status: SyncOpStatus.failed),
        ], _notesWo1);
        expect(found, isNull);
      },
    );

    test('a dead-letter does not hide the pending op sitting behind it', () {
      final SyncOperation? found = findAdoptableOp(<SyncOperation>[
        _op(id: 'k-dead', status: SyncOpStatus.failed, minute: 1),
        _op(id: 'k-live', minute: 2),
      ], _notesWo1);
      expect(found?.id, 'k-live');
    });

    test('adopts the FIRST match in the order it was given — the op the next drain '
        'reaches first', () {
      // Deliberately NOT phrased as "the oldest". `findAdoptableOpAmong` does no
      // sorting: it walks `due` as handed to it and returns the first match. A
      // `createdAt` on these two fixtures would be pure decoration — swap them and
      // this still returns the first element — so the oldest-first property is not
      // this function's to hold. It belongs to `SyncQueue.pending()`, and it is
      // exercised where it actually lives, over the REAL queue below.
      final SyncOperation? found = findAdoptableOp(<SyncOperation>[
        _op(id: 'k-first'),
        _op(id: 'k-second'),
      ], _notesWo1);
      expect(found?.id, 'k-first');
    });
  });

  group(
    'findAdoptableOpAmong (field-progress: many anchors on view at once)',
    () {
      const SyncOpIdentity p1 = SyncOpIdentity(
        entityType: 'work_period_deliver',
        endpoint: '/periods/p1/deliver',
      );
      const SyncOpIdentity p2 = SyncOpIdentity(
        entityType: 'work_period_deliver',
        endpoint: '/periods/p2/deliver',
      );

      test('reports WHICH anchor matched, so the caller can pin its row', () {
        final ({SyncOperation op, int identityIndex})? found =
            findAdoptableOpAmong(
              <SyncOperation>[
                _op(
                  id: 'k-p2',
                  entityType: 'work_period_deliver',
                  endpoint: '/periods/p2/deliver',
                ),
              ],
              <SyncOpIdentity>[p1, p2],
            );

        expect(found?.op.id, 'k-p2');
        expect(found?.identityIndex, 1);
      });

      test('a period that is NOT on view is left alone', () {
        final ({SyncOperation op, int identityIndex})? found =
            findAdoptableOpAmong(
              <SyncOperation>[
                _op(
                  id: 'k-p9',
                  entityType: 'work_period_deliver',
                  endpoint: '/periods/p9/deliver',
                ),
              ],
              <SyncOpIdentity>[p1, p2],
            );
        expect(found, isNull);
      });
    },
  );

  group('over the REAL queue', () {
    test(
      'a synced op is RELEASED: nothing is adoptable, so the next submission '
      'genuinely mints a new key instead of being deduped into the first',
      () async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        await queue.enqueue(_op(id: 'k1'));
        expect(findAdoptableOp(await queue.pending(), _notesWo1)?.id, 'k1');

        await queue.markSynced('k1');

        expect(findAdoptableOp(await queue.pending(), _notesWo1), isNull);
      },
    );

    test(
      'a deferred (5xx/transport) op stays adoptable across the failure',
      () async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final SyncOperation op = _op(id: 'k1');
        await queue.enqueue(op);
        // How QueueDrainProcessor records a transient failure: re-enqueued pending
        // with a bumped attempt count (see _deferPending).
        await queue.enqueue(
          op.copyWith(attemptCount: 1, lastError: 'HTTP 503'),
        );

        final SyncOperation? found = findAdoptableOp(
          await queue.pending(),
          _notesWo1,
        );
        expect(found?.id, 'k1');
        expect(found?.attemptCount, 1);
        expect(await queue.length(), 1); // idempotent enqueue — still ONE op
      },
    );

    test('markFailed (a 4xx) makes it un-adoptable', () async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      await queue.enqueue(_op(id: 'k1'));
      await queue.markFailed('k1', error: 'HTTP 400');

      expect(await queue.length(), 1); // kept + visible as a dead-letter…
      expect(
        findAdoptableOp(await queue.pending(), _notesWo1),
        isNull,
      ); // …but never adopted
    });

    test('the OLDEST op is adopted, and it is the QUEUE that makes that true — '
        'enqueue order is not `createdAt` order', () async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      // Enqueued newest FIRST, so insertion order and age disagree. This is the
      // one place `createdAt` can decide anything: `findAdoptableOpAmong` walks
      // the list it is handed, and `pending()` is what sorts that list.
      await queue.enqueue(_op(id: 'k-new', minute: 2));
      await queue.enqueue(_op(id: 'k-old', minute: 1));

      expect(
        findAdoptableOp(await queue.pending(), _notesWo1)?.id,
        'k-old',
        reason:
            'the next drain replays the oldest first, so that is the op the '
            'screen must take back — adopting the newer one would leave the '
            'older write about to be sent under a key nobody is tracking',
      );
    });
  });
}
