// Unit tests for the pure pm-notes derivations (route pm-notes).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// These exercise the agg directly — no widgets, no network.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_agg.dart';

SyncOperation _op(String id, SyncOpStatus status) => SyncOperation(
  id: id,
  entityType: 'pm_notes',
  kind: SyncOpKind.update,
  endpoint: '/pm/workorders/wo-1/close',
  method: 'POST',
  payload: const <String, Object?>{},
  createdAt: DateTime.utc(2026, 1, 1),
  status: status,
);

void main() {
  group('pmNotesStr', () {
    test('returns a non-empty string, else null', () {
      expect(
        pmNotesStr(<String, Object?>{'cause': 'ประตูค้าง'}, 'cause'),
        'ประตูค้าง',
      );
      expect(pmNotesStr(<String, Object?>{'cause': ''}, 'cause'), isNull);
      expect(pmNotesStr(<String, Object?>{'cause': null}, 'cause'), isNull);
      expect(pmNotesStr(const <String, Object?>{}, 'cause'), isNull);
    });

    test('a non-string wire value is absence, never coerced', () {
      expect(pmNotesStr(<String, Object?>{'cause': 42}, 'cause'), isNull);
      expect(
        pmNotesStr(<String, Object?>{
          'cause': <String>['x'],
        }, 'cause'),
        isNull,
      );
    });
  });

  group('parsePmNotes', () {
    test('reads the three REAL stored columns', () {
      final PmNotes n = parsePmNotes(<String, Object?>{
        'id': 'wo-1',
        'cause': 'เซนเซอร์ขอบประตูเสื่อม',
        'fix': 'เปลี่ยนเซนเซอร์ใหม่',
        'advice': 'ตรวจสลิงรอบหน้า',
        // Never read by this screen — proves nothing else leaks in.
        'items': <Object?>[],
        'customer_sign': 'someone',
      });
      expect(n.cause, 'เซนเซอร์ขอบประตูเสื่อม');
      expect(n.fix, 'เปลี่ยนเซนเซอร์ใหม่');
      expect(n.advice, 'ตรวจสลิงรอบหน้า');
      expect(n.isEmpty, isFalse);
    });

    test(
      'a work order with no log yet is honestly empty (no mock sentences)',
      () {
        final PmNotes n = parsePmNotes(<String, Object?>{'id': 'wo-1'});
        expect(n.cause, isNull);
        expect(n.fix, isNull);
        expect(n.advice, isNull);
        expect(n.isEmpty, isTrue);
      },
    );

    test('blank columns are absence', () {
      final PmNotes n = parsePmNotes(<String, Object?>{
        'cause': '',
        'fix': '',
        'advice': '',
      });
      expect(n.isEmpty, isTrue);
    });

    test('one filled column is not empty', () {
      expect(parsePmNotes(<String, Object?>{'advice': 'x'}).isEmpty, isFalse);
    });
  });

  group('findWorkOrder', () {
    final List<PmNotesEnt> rows = <PmNotesEnt>[
      <String, Object?>{'id': 'a', 'cause': 'A'},
      <String, Object?>{'id': 'b', 'cause': 'B'},
    ];

    test('picks the row by id', () {
      expect(findWorkOrder(rows, 'b')?['cause'], 'B');
    });

    test('an unknown or empty id is null (never the first row)', () {
      expect(findWorkOrder(rows, 'zzz'), isNull);
      expect(findWorkOrder(rows, ''), isNull);
      expect(findWorkOrder(const <PmNotesEnt>[], 'a'), isNull);
    });

    test('a row whose id is not a string never matches', () {
      expect(
        findWorkOrder(<PmNotesEnt>[
          <String, Object?>{'id': 7},
        ], '7'),
        isNull,
      );
    });
  });

  group('notesPayload', () {
    test('always sends ALL THREE keys — the server keys off presence', () {
      // A key the body omits leaves its column untouched (pm.ts `has(body,…)`), so
      // an omitted key could never CLEAR a field the technician just emptied.
      final Map<String, Object?> body = notesPayload(const PmNotes(cause: 'c'));
      expect(body.keys.toSet(), <String>{'cause', 'fix', 'advice'});
      expect(body['cause'], 'c');
      expect(body['fix'], '');
      expect(body['advice'], '');
    });

    test('trims each value', () {
      final Map<String, Object?> body = notesPayload(
        const PmNotes(cause: '  c  ', fix: '\n f \n', advice: 'a '),
      );
      expect(body['cause'], 'c');
      expect(body['fix'], 'f');
      expect(body['advice'], 'a');
    });

    test('a whitespace-only field is sent as "" (the server stores NULL)', () {
      expect(notesPayload(const PmNotes(cause: '   '))['cause'], '');
    });

    test('never sends a signature — that column belongs to pm-close', () {
      final Map<String, Object?> body = notesPayload(
        const PmNotes(cause: 'c', fix: 'f', advice: 'a'),
      );
      expect(body.containsKey('signature'), isFalse);
      expect(body.containsKey('customer_sign'), isFalse);
      expect(body.containsKey('customerSign'), isFalse);
    });

    test('is idempotent — the same form yields the same body', () {
      const PmNotes n = PmNotes(cause: 'c', fix: 'f', advice: 'a');
      expect(notesPayload(n), notesPayload(n));
    });
  });

  group('resolveNotesSaveState', () {
    test('the drain report is authoritative when it touched the op', () {
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: 'op-1', outcome: SyncOutcome.synced),
          ]),
          const <SyncOperation>[],
        ),
        PmNotesSaveState.saved,
      );
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: 'op-1', outcome: SyncOutcome.deferred),
          ]),
          const <SyncOperation>[],
        ),
        PmNotesSaveState.queued,
      );
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: 'op-1', outcome: SyncOutcome.permanentlyFailed),
          ]),
          const <SyncOperation>[],
        ),
        PmNotesSaveState.failed,
      );
    });

    test('an untouched op falls back to the QUEUE, never to optimism', () {
      // Still pending in the queue → queued, not saved.
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[_op('op-1', SyncOpStatus.pending)],
        ),
        PmNotesSaveState.queued,
      );
      // Dead-lettered in the queue → failed.
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[_op('op-1', SyncOpStatus.failed)],
        ),
        PmNotesSaveState.failed,
      );
    });

    test('gone from the queue and untouched = synced by an earlier drain', () {
      expect(
        resolveNotesSaveState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[_op('other', SyncOpStatus.pending)],
        ),
        PmNotesSaveState.saved,
      );
    });
  });
}
