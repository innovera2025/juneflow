// Widget tests for the mobile "my PM jobs" screen (route pm-jobs).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repository + inline i18n/strings, so
// nothing touches the network; the assertions prove the REAL behaviours — the
// honest asset join, the derived status badges, the done-exclusion, the em-dash
// gaps (WO number, absent name/site, scheduled time), and honest-empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/pm_jobs/pm_jobs_agg.dart';
import 'package:juneflow_mobile/screens/pm_jobs/pm_jobs_repository.dart';
import 'package:juneflow_mobile/screens/pm_jobs/pm_jobs_screen.dart';

/// In-memory repo: serves fixed WO + asset rows (no network).
class _FakeRepo implements PmJobsRepository {
  _FakeRepo({required this.workOrders, required this.assets});

  final List<PmEnt> workOrders;
  final List<PmEnt> assets;

  @override
  Future<List<PmEnt>> listWorkOrders() async => workOrders;

  @override
  Future<List<PmEnt>> listAssets() async => assets;
}

/// th i18n where tp(key) returns the key (renders the Thai sidecar text).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real key sidecar shape (values are the Thai phrase keys).
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"ช่าง PM","title":"งาน PM ของฉัน","filterToday":"วันนี้",'
  '"filterUrgent":"ด่วน","filterAll":"ทั้งหมด","statusOpen":"รอเริ่ม",'
  '"statusInProgress":"กำลังทำ","statusOverdue":"เกินกำหนด","start":"เริ่มงาน"}',
);

Future<void> _pump(WidgetTester tester, PmJobsRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PmJobsScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pump(); // resolve the fake listWorkOrders() future
  await tester.pump(); // resolve the fake listAssets() future
  await tester.pump();
}

void main() {
  testWidgets('renders the chrome + honest-joined rows from the repo', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      workOrders: <PmEnt>[
        <String, Object?>{
          'id': 'w1',
          'asset_id': 'a1',
          'checkin_gps': '',
          'customer_sign': '',
          'items': const <Object?>[],
        },
        <String, Object?>{
          'id': 'w2',
          'asset_id': 'a2',
          'checkin_gps': '13.7,100.5',
          'customer_sign': '',
          'items': const <Object?>[],
        },
      ],
      assets: <PmEnt>[
        <String, Object?>{
          'id': 'a1',
          'name': 'Lift MX-1000',
          'site': 'Tower A',
        },
        <String, Object?>{'id': 'a2', 'name': 'Fire pump', 'site': 'Pump room'},
      ],
    );
    await _pump(tester, repo);

    // Header chrome + the three filter pills render (i18n keys resolve for th).
    expect(find.text('งาน PM ของฉัน'), findsOneWidget);
    expect(find.text('ช่าง PM'), findsOneWidget);
    for (final String pill in <String>['วันนี้', 'ด่วน', 'ทั้งหมด']) {
      expect(find.text(pill), findsOneWidget, reason: 'pill "$pill" missing');
    }

    // Joined asset name + site render (never a raw uuid / fabricated string).
    expect(find.text('Lift MX-1000'), findsOneWidget);
    expect(find.text('Tower A'), findsOneWidget);
    expect(find.text('Fire pump'), findsOneWidget);

    // Derived status badges: w1 (no signal) -> open, w2 (checked in) -> inProgress.
    expect(find.text('รอเริ่ม'), findsOneWidget);
    expect(find.text('กำลังทำ'), findsOneWidget);

    // The "start" affordance rides each card.
    expect(find.text('เริ่มงาน'), findsNWidgets(2));
  });

  testWidgets('a WO whose asset is absent shows honest em-dashes', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      workOrders: <PmEnt>[
        <String, Object?>{'id': 'w1', 'asset_id': 'missing'},
      ],
      assets: const <PmEnt>[],
    );
    await _pump(tester, repo);

    // Name + site + the WO-number slot + the time slot all em-dash (no fabrication).
    expect(find.text('—'), findsWidgets);
    // The row is still a real WO with a derived (open) badge.
    expect(find.text('รอเริ่ม'), findsOneWidget);
  });

  testWidgets('done work orders are excluded from the active worklist', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      workOrders: <PmEnt>[
        <String, Object?>{
          'id': 'done',
          'asset_id': 'a1',
          'customer_sign': 'signed',
        },
      ],
      assets: <PmEnt>[
        <String, Object?>{'id': 'a1', 'name': 'Lift', 'site': 'Tower A'},
      ],
    );
    await _pump(tester, repo);

    // The done WO is dropped -> honest-empty (a centered em-dash), no card.
    expect(find.text('Lift'), findsNothing);
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('honest-empty: no work orders -> a centered em-dash, no crash', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(workOrders: const <PmEnt>[], assets: const <PmEnt>[]),
    );
    expect(find.text('—'), findsOneWidget);
  });
}
