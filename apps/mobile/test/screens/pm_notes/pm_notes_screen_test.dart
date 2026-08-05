// Widget tests for the mobile PM maintenance-log screen (route pm-notes).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The assertions prove the honest behaviour: the chrome, the REAL stored
// cause/fix/advice seeding the form, the whole-form body, the parts slot em-dashed
// (no wire), the dropped LINE-OA banner, the online-saved / offline-queued /
// permanently-failed states (never a fake success and never a certificate claim), the
// retry reusing the SAME op id, and the honest-empty variants.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_agg.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_repository.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_screen.dart';

/// A fake repo returning canned work orders and a scripted drain outcome. When
/// [outcome] is null the drain "touched nothing" (an offline no-response).
class _FakeRepo implements PmNotesRepository {
  _FakeRepo({
    this.rows = const <PmNotesEnt>[],
    this.outcome,
    this.readThrows = false,
  });

  final List<PmNotesEnt> rows;
  final SyncOutcome? outcome;
  final bool readThrows;

  String? lastOpId;
  String? lastWorkOrderId;
  Map<String, Object?>? lastBody;
  int saves = 0;
  int drains = 0;

  @override
  Future<List<PmNotesEnt>> listWorkOrders() async {
    if (readThrows) throw Exception('offline');
    return rows;
  }

  @override
  Future<DrainReport> saveNotes({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  }) async {
    saves++;
    lastOpId = opId;
    lastWorkOrderId = workOrderId;
    lastBody = body;
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

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "pm.maintLogTitle": {"th":"บันทึกการบำรุงรักษา"},
    "pm.fieldCause": {"th":"สาเหตุการเสีย / ความผิดปกติ"},
    "pm.phCause": {"th":"อธิบายอาการ/สาเหตุที่พบ"},
    "pm.fieldFix": {"th":"การแก้ไข / งานที่ทำ"},
    "pm.phFix": {"th":"อธิบายการแก้ไขและอะไหล่ที่เปลี่ยน"},
    "pm.fieldAdvice": {"th":"ข้อเสนอแนะ / งานที่ควรทำเพิ่ม"},
    "pm.phAdvice": {"th":"เช่น แนะนำเปลี่ยนสลิงในรอบหน้า"},
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

/// The screen's real sidecar shape (mixed layers — see pm_notes_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "pm.maintLogTitle",
  "fieldCause": "pm.fieldCause",
  "phCause": "pm.phCause",
  "fieldFix": "pm.fieldFix",
  "phFix": "pm.phFix",
  "fieldAdvice": "pm.fieldAdvice",
  "phAdvice": "pm.phAdvice",
  "fieldParts": "อะไหล่ที่ใช้",
  "closeNext": "ไปสรุป + ปิดงาน",
  "saved": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "next": "pm.btnNext"
}
''', assetPath: 'test/inline');

PmNotesEnt _wo(String id, {String? cause, String? fix, String? advice}) =>
    <String, Object?>{
      'id': id,
      if (cause != null) 'cause': cause,
      if (fix != null) 'fix': fix,
      if (advice != null) 'advice': advice,
    };

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? workOrderId = 'wo-1',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PmNotesScreen(
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

/// The three note fields, in prototype order (cause / fix / advice).
Finder get _fields => find.byType(TextField);

void main() {
  group('chrome + the real stored log', () {
    testWidgets('renders the header, the four field labels and the CTA', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(rows: <PmNotesEnt>[_wo('wo-1')]));

      expect(find.text('บันทึกการบำรุงรักษา'), findsOneWidget);
      expect(find.text('สาเหตุการเสีย / ความผิดปกติ'), findsOneWidget);
      expect(find.text('การแก้ไข / งานที่ทำ'), findsOneWidget);
      expect(find.text('ข้อเสนอแนะ / งานที่ควรทำเพิ่ม'), findsOneWidget);
      expect(find.text('อะไหล่ที่ใช้'), findsOneWidget);
      expect(find.text('ไปสรุป + ปิดงาน'), findsOneWidget);
      expect(_fields, findsNWidgets(3));
    });

    testWidgets('seeds the fields from the REAL stored columns', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          rows: <PmNotesEnt>[
            _wo(
              'wo-1',
              cause: 'เซนเซอร์ขอบประตูเสื่อม',
              fix: 'เปลี่ยนเซนเซอร์ใหม่',
              advice: 'ตรวจสลิงรอบหน้า',
            ),
          ],
        ),
      );
      expect(
        tester.widget<TextField>(_fields.at(0)).controller?.text,
        'เซนเซอร์ขอบประตูเสื่อม',
      );
      expect(
        tester.widget<TextField>(_fields.at(1)).controller?.text,
        'เปลี่ยนเซนเซอร์ใหม่',
      );
      expect(
        tester.widget<TextField>(_fields.at(2)).controller?.text,
        'ตรวจสลิงรอบหน้า',
      );
    });

    testWidgets('a work order with no log starts EMPTY — never the mock text', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(rows: <PmNotesEnt>[_wo('wo-1')]));
      for (int i = 0; i < 3; i++) {
        expect(tester.widget<TextField>(_fields.at(i)).controller?.text, '');
      }
      // The prototype's hardcoded sentences never appear.
      expect(find.textContaining('ประตูลิฟต์ชั้น 3'), findsNothing);
      // The placeholders show instead.
      expect(find.text('อธิบายอาการ/สาเหตุที่พบ'), findsOneWidget);
      expect(find.text('อธิบายการแก้ไขและอะไหล่ที่เปลี่ยน'), findsOneWidget);
      expect(find.text('เช่น แนะนำเปลี่ยนสลิงในรอบหน้า'), findsOneWidget);
    });
  });

  group('the honest gaps', () {
    testWidgets('the parts slot is em-dashed — no part, no amount', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(rows: <PmNotesEnt>[_wo('wo-1', cause: 'c')]),
      );
      // The label is kept (chrome); the value is honestly absent — pm_workorder has
      // no parts column (parts live on pmQuotes.parts, POST /pm/quotes).
      expect(find.text('อะไหล่ที่ใช้'), findsOneWidget);
      // TWO em-dashes on a loaded screen, both honest: the header eyebrow (the
      // prototype's "PMWO-…" has no stored document number) and the parts value.
      expect(find.text('—'), findsNWidgets(2));
      // The prototype's mock part + its money never appear.
      expect(find.textContaining('Safety Edge Sensor'), findsNothing);
      expect(find.textContaining('3,200'), findsNothing);
      expect(find.textContaining('฿'), findsNothing);
    });

    testWidgets('the LINE-OA quote banner is NOT rendered', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(rows: <PmNotesEnt>[_wo('wo-1', cause: 'c')]),
      );
      // mobile-pm.jsx L169-171 promises an automation that does not exist.
      expect(find.textContaining('LINE OA'), findsNothing);
      expect(find.textContaining('ใบเสนอราคา'), findsNothing);
      expect(find.textContaining('อัตโนมัติ'), findsNothing);
    });
  });

  group('the save write', () {
    testWidgets('sends the WHOLE form to the real work order', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        rows: <PmNotesEnt>[_wo('wo-1', cause: 'เดิม')],
      );
      await _pump(tester, repo);
      await tester.enterText(_fields.at(0), 'ประตูค้าง');
      await tester.enterText(_fields.at(1), 'เปลี่ยนเซนเซอร์');
      await tester.pump();
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();

      expect(repo.saves, 1);
      expect(repo.lastWorkOrderId, 'wo-1');
      // All three keys, always — the server keys off presence, so an omitted key
      // could never clear a field the technician just emptied.
      expect(repo.lastBody, <String, Object?>{
        'cause': 'ประตูค้าง',
        'fix': 'เปลี่ยนเซนเซอร์',
        'advice': '',
      });
      // No signature: that column belongs to pm-close.
      expect(repo.lastBody!.containsKey('signature'), isFalse);
    });

    testWidgets('a 2xx shows saved and the onward step (honest-disabled), '
        'and claims NO certificate', (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        rows: <PmNotesEnt>[_wo('wo-1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();

      expect(find.text('บันทึกแล้ว'), findsOneWidget);
      // pm-close is not built, so the CTA becomes the disabled onward affordance.
      expect(find.text('ถัดไป'), findsOneWidget);
      expect(find.text('ไปสรุป + ปิดงาน'), findsNothing);
      // pm.ts L754-758: there is no cert/status column and close never invents one.
      expect(find.textContaining('ใบรับรอง'), findsNothing);
      expect(find.textContaining('ปิดงาน'), findsNothing);
    });

    testWidgets('a deferred outcome is QUEUED — never a fake success', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmNotesEnt>[_wo('wo-1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();

      expect(find.text('รอส่ง'), findsOneWidget);
      expect(find.text('บันทึกแล้ว'), findsNothing);
      // The CTA stays the save action so the write can be retried.
      expect(find.text('ไปสรุป + ปิดงาน'), findsOneWidget);
    });

    testWidgets('a 4xx dead-letter is surfaced as failed', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.permanentlyFailed,
        rows: <PmNotesEnt>[_wo('wo-1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();

      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
      expect(find.text('บันทึกแล้ว'), findsNothing);
    });

    testWidgets('a retry re-drains the SAME op — never a second enqueue', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmNotesEnt>[_wo('wo-1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();
      final String? first = repo.lastOpId;

      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();

      expect(repo.saves, 1, reason: 'a retry must not enqueue a second op');
      expect(repo.lastOpId, first);
    });

    testWidgets('typing after a queued save starts a NEW write', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmNotesEnt>[_wo('wo-1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();
      final String? first = repo.lastOpId;
      expect(find.text('รอส่ง'), findsOneWidget);

      // A typed character means a new body — the status clears and the next save
      // enqueues its own op rather than retrying the stale one.
      await tester.enterText(_fields.at(2), 'ตรวจสลิงรอบหน้า');
      await tester.pump();
      expect(find.text('รอส่ง'), findsNothing);

      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();
      expect(repo.saves, 2);
      expect(repo.lastOpId, isNot(first));
      expect(repo.lastBody!['advice'], 'ตรวจสลิงรอบหน้า');
    });

    testWidgets('seeding the form from the wire is NOT an edit', (
      WidgetTester tester,
    ) async {
      // A load that arrives after mount must not look like the technician typing —
      // otherwise a queued status would clear itself on a rebuild.
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        rows: <PmNotesEnt>[_wo('wo-1', cause: 'จากเซิร์ฟเวอร์')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ไปสรุป + ปิดงาน'));
      await tester.pumpAndSettle();
      expect(find.text('รอส่ง'), findsOneWidget);
      // The seeded text is still the body that was sent.
      expect(repo.lastBody!['cause'], 'จากเซิร์ฟเวอร์');
    });
  });

  group('honest-empty states', () {
    testWidgets('no work order selected → an em-dash and no CTA', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(), workOrderId: null);
      // TWO em-dashes, both honest: the header eyebrow (no stored WO number to print)
      // and the body.
      expect(find.text('—'), findsNWidgets(2));
      expect(find.text('ไปสรุป + ปิดงาน'), findsNothing);
      expect(_fields, findsNothing);
    });

    testWidgets('an unreadable work order is UNKNOWN, not a blank log', (
      WidgetTester tester,
    ) async {
      // The read succeeded but this id was not in the page — showing an editable
      // empty form would read as "this job has no log yet".
      await _pump(tester, _FakeRepo(rows: <PmNotesEnt>[_wo('other')]));
      expect(find.text('—'), findsNWidgets(2)); // header eyebrow + body
      expect(_fields, findsNothing);
      expect(find.text('ไปสรุป + ปิดงาน'), findsNothing);
    });

    testWidgets('a failed read em-dashes instead of crashing', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(readThrows: true));
      expect(find.text('—'), findsNWidgets(2)); // header eyebrow + body
      expect(find.text('ไปสรุป + ปิดงาน'), findsNothing);
    });
  });
}
