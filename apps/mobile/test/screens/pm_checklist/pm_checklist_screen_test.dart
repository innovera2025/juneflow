// Widget tests for the mobile PM checklist screen (route pm-checklist).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The assertions prove the honest behaviour: the chrome, the REAL
// work-order snapshot as the checklist, the progress counter, photo slots driven by
// the STORED reference (never by the result toggle), the whole-array positional
// payload, the online-saved / offline-queued / permanently-failed states (never a
// fake success), the retry reusing the SAME op id, and the honest-empty variants.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_agg.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_repository.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_screen.dart';

/// A fake repo returning canned work orders and a scripted drain outcome. When
/// [outcome] is null the drain "touched nothing" (an offline no-response).
class _FakeRepo implements PmChecklistRepository {
  _FakeRepo({
    this.rows = const <PmChecklistEnt>[],
    this.outcome,
    this.readThrows = false,
  });

  final List<PmChecklistEnt> rows;
  final SyncOutcome? outcome;
  final bool readThrows;

  String? lastOpId;
  List<Map<String, Object?>>? lastItems;
  int saves = 0;
  int drains = 0;

  @override
  Future<List<PmChecklistEnt>> listWorkOrders() async {
    if (readThrows) throw Exception('offline');
    return rows;
  }

  @override
  Future<DrainReport> saveChecklist({
    required String workOrderId,
    required String opId,
    required List<Map<String, Object?>> items,
    required DateTime now,
  }) async {
    saves++;
    lastOpId = opId;
    lastItems = items;
    return _report(opId);
  }

  @override
  Future<DrainReport> drain() async {
    drains++;
    final String? id = lastOpId;
    return id == null ? const DrainReport(<SyncAttempt>[]) : _report(id);
  }

  DrainReport _report(String opId) {
    final SyncOutcome? o = outcome;
    if (o == null) return const DrainReport(<SyncAttempt>[]);
    return DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: o)]);
  }

  @override
  Future<List<SyncOperation>> due() async => const <SyncOperation>[];
}

/// th i18n with just the keys the screen references (dict values copied from
/// docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "subcon.photoBefore": {"th":"รูปก่อน"},
    "pm.emptyChecklist": {"th":"ยังไม่มีรายการตรวจเช็ค"},
    "labor.att.savedBadge": {"th":"บันทึกแล้ว"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "pm.btnNext": {"th":"ถัดไป"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (mixed layers — see pm_checklist_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "Checklist PM",
  "progress": "ตรวจแล้ว {n}/{count}",
  "photoBefore": "subcon.photoBefore",
  "photoAfter": "รูป/วิดีโอหลัง",
  "resultNormal": "ปกติ",
  "resultAdjust": "ปรับตั้ง",
  "resultRepair": "เปลี่ยน/ซ่อม",
  "saveNext": "บันทึกผล + ต่อไป",
  "emptyChecklist": "pm.emptyChecklist",
  "saved": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "next": "pm.btnNext"
}
''', assetPath: 'test/inline');

PmChecklistEnt _wo(String id, List<Object?> items) => <String, Object?>{
  'id': id,
  'items': items,
};

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? workOrderId = 'wo-1',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PmChecklistScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          workOrderId: workOrderId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('chrome + the real checklist snapshot', () {
    testWidgets('renders the header, the WO labels and the toggles', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'ตรวจระบบเบรก'},
            <String, Object?>{'label': 'ตรวจสลิง'},
          ]),
        ],
      );
      await _pump(tester, repo);

      expect(find.text('Checklist PM'), findsOneWidget);
      // Ordinals are zero-padded (mobile-pm.jsx L114).
      expect(find.text('01'), findsOneWidget);
      expect(find.text('02'), findsOneWidget);
      // The labels are the work order's OWN snapshot, not a hardcoded array.
      expect(find.text('ตรวจระบบเบรก'), findsOneWidget);
      expect(find.text('ตรวจสลิง'), findsOneWidget);
      // Three result toggles per line, none preselected.
      expect(find.text('ปกติ'), findsNWidgets(2));
      expect(find.text('ปรับตั้ง'), findsNWidgets(2));
      expect(find.text('เปลี่ยน/ซ่อม'), findsNWidgets(2));
      // Photo captions per line.
      expect(find.text('รูปก่อน'), findsNWidgets(2));
      expect(find.text('รูป/วิดีโอหลัง'), findsNWidgets(2));
      // The sticky CTA.
      expect(find.text('บันทึกผล + ต่อไป'), findsOneWidget);
    });

    testWidgets('the eyebrow counts the REAL stored results', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a', 'result': 'normal'},
            <String, Object?>{'label': 'b'},
            <String, Object?>{'label': 'c'},
          ]),
        ],
      );
      await _pump(tester, repo);
      expect(find.text('ตรวจแล้ว 1/3'), findsOneWidget);
    });

    testWidgets('tapping a toggle advances the counter', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
            <String, Object?>{'label': 'b'},
          ]),
        ],
      );
      await _pump(tester, repo);
      expect(find.text('ตรวจแล้ว 0/2'), findsOneWidget);
      await tester.tap(find.text('ปรับตั้ง').first);
      await tester.pump();
      expect(find.text('ตรวจแล้ว 1/2'), findsOneWidget);
    });

    testWidgets('a label the wire never stored em-dashes', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'result': 'normal'},
          ]),
        ],
      );
      await _pump(tester, repo);
      expect(find.text('—'), findsWidgets);
    });
  });

  group('photo slots are honest', () {
    testWidgets('a stored reference fills the slot; picking a result does NOT '
        '(the prototype derives the after photo from the toggle)', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a', 'before': 'file-1'},
          ]),
        ],
      );
      await _pump(tester, repo);
      // Exactly one filled slot: the stored `before`. `after` is unattached.
      expect(find.byIcon(Icons.photo), findsOneWidget);
      expect(find.byIcon(Icons.add), findsOneWidget);

      await tester.tap(find.text('ปกติ'));
      await tester.pump();
      // Still exactly one filled slot — a result is not a photo.
      expect(find.byIcon(Icons.photo), findsOneWidget);
      expect(find.byIcon(Icons.add), findsOneWidget);
    });

    testWidgets('with no photos at all both slots stay empty', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      expect(find.byIcon(Icons.photo), findsNothing);
      expect(find.byIcon(Icons.add), findsNWidgets(2));
    });
  });

  group('the save write', () {
    testWidgets('sends the WHOLE array positionally, photos echoed', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a', 'before': 'file-1'},
            <String, Object?>{'label': 'b'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('เปลี่ยน/ซ่อม').first);
      await tester.pump();
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();

      expect(repo.saves, 1);
      expect(repo.lastItems, <Map<String, Object?>>[
        <String, Object?>{'label': 'a', 'result': 'repair', 'before': 'file-1'},
        <String, Object?>{'label': 'b'},
      ]);
    });

    testWidgets('a 2xx shows saved and the onward step (honest-disabled)', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();

      expect(find.text('บันทึกแล้ว'), findsOneWidget);
      // pm-notes is not built, so the CTA becomes the disabled onward affordance.
      expect(find.text('ถัดไป'), findsOneWidget);
      expect(find.text('บันทึกผล + ต่อไป'), findsNothing);
    });

    testWidgets('a deferred outcome is QUEUED — never a fake success', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();

      expect(find.text('รอส่ง'), findsOneWidget);
      expect(find.text('บันทึกแล้ว'), findsNothing);
      // The CTA stays the save action so the write can be retried.
      expect(find.text('บันทึกผล + ต่อไป'), findsOneWidget);
    });

    testWidgets('a 4xx dead-letter is surfaced as failed', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.permanentlyFailed,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();

      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
      expect(find.text('บันทึกแล้ว'), findsNothing);
    });

    testWidgets('a retry re-drains the SAME op — never a second enqueue', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();
      final String? first = repo.lastOpId;

      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();

      expect(repo.saves, 1, reason: 'a retry must not enqueue a second op');
      expect(repo.lastOpId, first);
    });

    testWidgets('editing after a queued save starts a NEW write', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmChecklistEnt>[
          _wo('wo-1', <Object?>[
            <String, Object?>{'label': 'a'},
          ]),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();
      final String? first = repo.lastOpId;
      expect(find.text('รอส่ง'), findsOneWidget);

      // A new result means a new payload — the status clears and the next save
      // enqueues its own op rather than retrying the stale one.
      await tester.tap(find.text('ปกติ'));
      await tester.pump();
      expect(find.text('รอส่ง'), findsNothing);

      await tester.tap(find.text('บันทึกผล + ต่อไป'));
      await tester.pumpAndSettle();
      expect(repo.saves, 2);
      expect(repo.lastOpId, isNot(first));
    });
  });

  group('honest-empty states', () {
    testWidgets('no work order selected → an em-dash and no CTA', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(), workOrderId: null);
      // TWO em-dashes, both honest: the header eyebrow (nothing to count — never a
      // fabricated "0/5") and the body.
      expect(find.text('—'), findsNWidgets(2));
      expect(find.text('บันทึกผล + ต่อไป'), findsNothing);
    });

    testWidgets('a work order with an empty snapshot says so, no CTA', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        rows: <PmChecklistEnt>[_wo('wo-1', const <Object?>[])],
      );
      await _pump(tester, repo);
      expect(find.text('ยังไม่มีรายการตรวจเช็ค'), findsOneWidget);
      expect(find.text('บันทึกผล + ต่อไป'), findsNothing);
    });

    testWidgets('an unreadable work order is UNKNOWN, not an empty checklist', (
      WidgetTester tester,
    ) async {
      // The read succeeded but this id was not in the page.
      await _pump(
        tester,
        _FakeRepo(rows: <PmChecklistEnt>[_wo('other', const <Object?>[])]),
      );
      expect(find.text('—'), findsNWidgets(2)); // header eyebrow + body
      expect(find.text('ยังไม่มีรายการตรวจเช็ค'), findsNothing);
    });

    testWidgets('a failed read em-dashes instead of crashing', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(readThrows: true));
      expect(find.text('—'), findsNWidgets(2)); // header eyebrow + body
      expect(find.text('บันทึกผล + ต่อไป'), findsNothing);
    });
  });
}
