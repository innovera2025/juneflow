// Widget tests for the mobile PM check-in screen (route pm-checkin).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + a FAKE GpsSource + inline i18n/strings,
// so nothing touches the network OR a device sensor. The assertions prove the honest
// offline-write behaviour — the chrome, a REAL coordinate flowing into the write +
// map caption, the online-confirmed success, the offline-queued / permanently-failed
// states (never a fake success), the permission-denied "no fix, no enqueue" path,
// and the no-selection honest-empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/gps_source.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_repository.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_screen.dart';

/// A canned coordinate source. [fix] null = no fix available (denied / off).
class _FakeGps implements GpsSource {
  _FakeGps(this.fix);
  final String? fix;
  int calls = 0;
  @override
  Future<String?> currentFix() async {
    calls++;
    return fix;
  }
}

/// A fake repo that returns a scripted drain outcome for the enqueued op. When
/// [outcome] is null the drain "touched nothing" (an offline no-response).
class _FakeRepo implements PmCheckinRepository {
  _FakeRepo({this.outcome});

  final SyncOutcome? outcome;
  String? lastOpId;
  String? lastGps;
  int submits = 0;

  @override
  Future<DrainReport> submitCheckin({
    required String workOrderId,
    required String opId,
    required String gps,
    required DateTime now,
  }) async {
    submits++;
    lastOpId = opId;
    lastGps = gps;
    return _drainReport(opId);
  }

  @override
  Future<DrainReport> drain() async {
    final String? id = lastOpId;
    return id == null ? const DrainReport(<SyncAttempt>[]) : _drainReport(id);
  }

  DrainReport _drainReport(String opId) {
    final SyncOutcome? o = outcome;
    if (o == null) return const DrainReport(<SyncAttempt>[]);
    return DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: o)]);
  }

  @override
  Future<List<SyncOperation>> due() async => const <SyncOperation>[];
}

/// th i18n with just the dict keys the screen references (values from i18n-full.json).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "pm.checkinTitle": {"th":"Check-in จุดบริการ"},
    "pm.serviceZone": {"th":"เขตบริการ"},
    "pm.sla": {"th":"SLA"},
    "pm.contractRef": {"th":"อ้างอิงสัญญา"},
    "subcon.photoGps": {"th":"พิกัด GPS"},
    "pm.checkinBtn": {"th":"Check-in หน้างาน"},
    "pm.toastCheckedIn": {"th":"Check-in หน้างานสำเร็จ · {time}"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "pm.checklistTitle": {"th":"Checklist ตรวจเช็ค"}
  },
  "nav_i18n": {}, "phrases": {}, "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape: field -> dict stable-id (resolved via t()/tf()).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "pm.checkinTitle",
  "serviceZone": "pm.serviceZone",
  "sla": "pm.sla",
  "contractRef": "pm.contractRef",
  "gpsLabel": "subcon.photoGps",
  "checkinBtn": "pm.checkinBtn",
  "successAt": "pm.toastCheckedIn",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "checklistNext": "pm.checklistTitle"
}
''');

const String _fix = '13.806000, 100.451900';

Future<void> _pump(
  WidgetTester tester,
  PmCheckinRepository repo, {
  GpsSource? gps,
  String? workOrderId = 'w1',
  String? assetName = 'Lift MX-1000',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PmCheckinScreen(
          repo: repo,
          gpsSource: gps ?? _FakeGps(_fix),
          strings: _strings,
          i18n: _i18n,
          workOrderId: workOrderId,
          assetName: assetName,
        ),
      ),
    ),
  );
  await tester.pump(); // settle the on-mount drain
}

Future<void> _tapCheckin(WidgetTester tester) async {
  await tester.tap(find.text('Check-in หน้างาน'));
  // acquire fix -> enqueue -> drain -> due -> state (several async gaps).
  for (int i = 0; i < 6; i++) {
    await tester.pump();
  }
}

void main() {
  testWidgets(
    'chrome: title, asset eyebrow, service labels + GPS caption em-dashes',
    (WidgetTester tester) async {
      await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));

      expect(find.text('Check-in จุดบริการ'), findsOneWidget); // header title
      expect(
        find.text('Lift MX-1000'),
        findsOneWidget,
      ); // real joined asset eyebrow
      expect(find.text('เขตบริการ'), findsOneWidget);
      expect(find.text('SLA'), findsOneWidget);
      expect(find.text('อ้างอิงสัญญา'), findsOneWidget);
      expect(find.text('พิกัด GPS'), findsOneWidget); // map caption label
      // 3 service values + the GPS caption all em-dash before a fix is obtained.
      expect(find.text('—'), findsNWidgets(4));
      expect(find.text('Check-in หน้างาน'), findsOneWidget);
    },
  );

  testWidgets(
    'real GPS + 2xx -> online-confirmed, coordinate shown in the caption',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.synced);
      final _FakeGps gps = _FakeGps(_fix);
      await _pump(tester, repo, gps: gps);
      await _tapCheckin(tester);

      // A real coordinate was acquired and sent to the write (never fabricated/null).
      expect(gps.calls, 1);
      expect(repo.submits, 1);
      expect(repo.lastGps, _fix);
      // The success card + the real coordinate in the map caption.
      expect(find.textContaining('Check-in หน้างานสำเร็จ · '), findsOneWidget);
      expect(find.text(_fix), findsOneWidget);
      // On success the sticky button becomes the (disabled) onward checklist step.
      expect(find.text('Checklist ตรวจเช็ค'), findsOneWidget);
      expect(find.text('Check-in หน้างาน'), findsNothing);
    },
  );

  testWidgets('real GPS + offline -> honest QUEUED (not a fake success)', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.deferred);
    await _pump(tester, repo);
    await _tapCheckin(tester);

    expect(repo.submits, 1); // the write WAS enqueued (a real fix existed)
    expect(find.text('รอส่ง'), findsOneWidget); // pending-sync, honest
    expect(find.textContaining('Check-in หน้างานสำเร็จ'), findsNothing);
    expect(find.text('Check-in หน้างาน'), findsOneWidget); // stays retryable
  });

  testWidgets('real GPS + 4xx -> honest permanently-failed', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(outcome: SyncOutcome.permanentlyFailed));
    await _tapCheckin(tester);

    expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
    expect(find.textContaining('Check-in หน้างานสำเร็จ'), findsNothing);
  });

  testWidgets('permission denied (no fix) -> honest error, NOTHING enqueued', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.synced);
    final _FakeGps gps = _FakeGps(null); // no fix available
    await _pump(tester, repo, gps: gps);
    await _tapCheckin(tester);

    expect(gps.calls, 1); // a fix was attempted
    expect(
      repo.submits,
      0,
    ); // ...and NO op was enqueued (no gps-blank dead-letter)
    // The honest error copy shows; the caption stays em-dash (no fabricated coord).
    expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
    expect(find.textContaining('Check-in หน้างานสำเร็จ'), findsNothing);
    expect(find.text(_fix), findsNothing);
    // Still retryable (a later fix could succeed).
    expect(find.text('Check-in หน้างาน'), findsOneWidget);
  });

  testWidgets('no work order selected -> honest-empty, no check-in button', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(outcome: SyncOutcome.synced),
      workOrderId: null,
    );

    expect(find.text('Check-in หน้างาน'), findsNothing);
    expect(find.text('—'), findsWidgets);
  });
}
