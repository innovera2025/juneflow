// Unit tests for the pure PM-checklist derivations (route pm-checklist).
//
// The module is Flutter-free, so these run as plain unit tests. They lock the
// honesty rules the port depends on: photo state comes from the STORED reference
// (never from the result toggle, which is the prototype's mock coupling), the PUT
// payload echoes the whole array positionally (so the server's positional merge
// cannot erase a stored photo), and an unchecked line sends no `result`.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_agg.dart';

SyncOperation _op(String id, SyncOpStatus status) => SyncOperation(
  id: id,
  entityType: 'pm_checklist',
  kind: SyncOpKind.update,
  endpoint: '/pm/workorders/wo-1/checklist',
  method: 'PUT',
  payload: const <String, Object?>{},
  createdAt: DateTime.utc(2026, 8, 5),
  status: status,
);

void main() {
  group('parsePmCheckResult / pmCheckResultWire', () {
    test('maps exactly the server vocabulary (pm.ts CHECKLIST_RESULTS)', () {
      expect(parsePmCheckResult('normal'), PmCheckResult.normal);
      expect(parsePmCheckResult('adjust'), PmCheckResult.adjust);
      expect(parsePmCheckResult('repair'), PmCheckResult.repair);
    });

    test('anything absent/blank/unknown is unchecked — never guessed', () {
      expect(parsePmCheckResult(null), PmCheckResult.none);
      expect(parsePmCheckResult(''), PmCheckResult.none);
      expect(parsePmCheckResult('none'), PmCheckResult.none);
      expect(parsePmCheckResult('NORMAL'), PmCheckResult.none);
      expect(parsePmCheckResult(7), PmCheckResult.none);
    });

    test('the unchecked state has NO wire value (the server omits result)', () {
      expect(pmCheckResultWire(PmCheckResult.none), isNull);
      expect(pmCheckResultWire(PmCheckResult.normal), 'normal');
      expect(pmCheckResultWire(PmCheckResult.adjust), 'adjust');
      expect(pmCheckResultWire(PmCheckResult.repair), 'repair');
    });

    test('the toggles are MPM_RESULTS.slice(1) — none is not selectable', () {
      expect(kPmSelectableResults, <PmCheckResult>[
        PmCheckResult.normal,
        PmCheckResult.adjust,
        PmCheckResult.repair,
      ]);
      expect(kPmSelectableResults, isNot(contains(PmCheckResult.none)));
    });
  });

  group('parseChecklistItems', () {
    test('reads the real stored columns of each row', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{
          'label': 'brake check',
          'result': 'repair',
          'before': 'file-1',
          'after': 'file-2',
        },
      ]);
      expect(items, hasLength(1));
      expect(items.single.label, 'brake check');
      expect(items.single.result, PmCheckResult.repair);
      expect(items.single.before, 'file-1');
      expect(items.single.after, 'file-2');
      expect(items.single.isChecked, isTrue);
    });

    test('photo slots are null when unattached — NOT derived from the result '
        '(the prototype fills "after" from results[i] !== "none")', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'a', 'result': 'normal'},
        <String, Object?>{'label': 'b', 'before': '', 'after': ''},
      ]);
      expect(items[0].result, PmCheckResult.normal);
      expect(items[0].before, isNull);
      expect(items[0].after, isNull, reason: 'a result is not a photo');
      expect(items[1].before, isNull, reason: 'a blank string is an absence');
      expect(items[1].after, isNull);
    });

    test('a missing label stays empty so the view can em-dash it', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'result': 'normal'},
      ]);
      expect(items.single.label, '');
    });

    test('order is preserved — the server merges POSITIONALLY', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'first'},
        <String, Object?>{'label': 'second'},
        <String, Object?>{'label': 'third'},
      ]);
      expect(items.map((PmChecklistItem i) => i.label), <String>[
        'first',
        'second',
        'third',
      ]);
    });

    test('a non-list / non-map payload yields nothing, never a fake row', () {
      expect(parseChecklistItems(null), isEmpty);
      expect(parseChecklistItems('items'), isEmpty);
      expect(parseChecklistItems(<Object?>[1, 'x', null]), isEmpty);
    });
  });

  group('findWorkOrder', () {
    final List<PmChecklistEnt> rows = <PmChecklistEnt>[
      <String, Object?>{'id': 'wo-1'},
      <String, Object?>{'id': 'wo-2'},
    ];

    test('picks the row with the given id', () {
      expect(findWorkOrder(rows, 'wo-2')!['id'], 'wo-2');
    });

    test('an absent or empty id resolves to null (honest-unknown)', () {
      expect(findWorkOrder(rows, 'wo-9'), isNull);
      expect(findWorkOrder(rows, ''), isNull);
      expect(findWorkOrder(const <PmChecklistEnt>[], 'wo-1'), isNull);
    });
  });

  group('checkedCount', () {
    test('counts only lines with a real stored result', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'a', 'result': 'normal'},
        <String, Object?>{'label': 'b'},
        <String, Object?>{'label': 'c', 'result': 'repair'},
      ]);
      expect(checkedCount(items), 2);
      expect(checkedCount(const <PmChecklistItem>[]), 0);
    });
  });

  group('checklistPayload', () {
    test(
      'echoes label + stored photos so the positional merge cannot erase them '
      '(pm.ts mergeChecklistRow drops any field the body omits)',
      () {
        final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
          <String, Object?>{
            'label': 'sling',
            'result': 'adjust',
            'before': 'file-1',
            'after': 'file-2',
          },
        ]);
        expect(checklistPayload(items), <Map<String, Object?>>[
          <String, Object?>{
            'label': 'sling',
            'result': 'adjust',
            'before': 'file-1',
            'after': 'file-2',
          },
        ]);
      },
    );

    test('an unchecked line sends NO result key', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'door'},
      ]);
      final Map<String, Object?> row = checklistPayload(items).single;
      expect(row.containsKey('result'), isFalse);
      expect(row, <String, Object?>{'label': 'door'});
    });

    test('an edited result rides out while the photos stay untouched', () {
      final PmChecklistItem item = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'motor', 'before': 'file-1'},
      ]).single.withResult(PmCheckResult.repair);
      expect(
        checklistPayload(<PmChecklistItem>[item]).single,
        <String, Object?>{
          'label': 'motor',
          'result': 'repair',
          'before': 'file-1',
        },
      );
    });

    test('the whole array rides out in order', () {
      final List<PmChecklistItem> items = parseChecklistItems(<Object?>[
        <String, Object?>{'label': 'a'},
        <String, Object?>{'label': 'b'},
      ]);
      expect(
        checklistPayload(items).map((Map<String, Object?> r) => r['label']),
        <String>['a', 'b'],
      );
    });
  });

  group('resolveChecklistSaveState', () {
    test('a 2xx in this pass is the only "saved"', () {
      const DrainReport report = DrainReport(<SyncAttempt>[
        SyncAttempt(id: 'op-1', outcome: SyncOutcome.synced),
      ]);
      expect(
        resolveChecklistSaveState('op-1', report, const <SyncOperation>[]),
        PmChecklistSaveState.saved,
      );
    });

    test('a deferred outcome is QUEUED — never reported as a success', () {
      const DrainReport report = DrainReport(<SyncAttempt>[
        SyncAttempt(id: 'op-1', outcome: SyncOutcome.deferred),
      ]);
      expect(
        resolveChecklistSaveState('op-1', report, const <SyncOperation>[]),
        PmChecklistSaveState.queued,
      );
    });

    test('a 4xx dead-letter is FAILED', () {
      const DrainReport report = DrainReport(<SyncAttempt>[
        SyncAttempt(id: 'op-1', outcome: SyncOutcome.permanentlyFailed),
      ]);
      expect(
        resolveChecklistSaveState('op-1', report, const <SyncOperation>[]),
        PmChecklistSaveState.failed,
      );
    });

    test('an untouched op falls back to the queue as the source of truth', () {
      const DrainReport empty = DrainReport(<SyncAttempt>[]);
      expect(
        resolveChecklistSaveState('op-1', empty, <SyncOperation>[
          _op('op-1', SyncOpStatus.pending),
        ]),
        PmChecklistSaveState.queued,
      );
      expect(
        resolveChecklistSaveState('op-1', empty, <SyncOperation>[
          _op('op-1', SyncOpStatus.failed),
        ]),
        PmChecklistSaveState.failed,
      );
      // Gone from the queue = the server took it.
      expect(
        resolveChecklistSaveState('op-1', empty, <SyncOperation>[
          _op('other', SyncOpStatus.pending),
        ]),
        PmChecklistSaveState.saved,
      );
    });

    test('another op\'s attempt never decides this op\'s state', () {
      const DrainReport report = DrainReport(<SyncAttempt>[
        SyncAttempt(id: 'other', outcome: SyncOutcome.synced),
      ]);
      expect(
        resolveChecklistSaveState('op-1', report, <SyncOperation>[
          _op('op-1', SyncOpStatus.pending),
        ]),
        PmChecklistSaveState.queued,
      );
    });
  });
}
