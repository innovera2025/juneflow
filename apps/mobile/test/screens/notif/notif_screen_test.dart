// Widget tests for the mobile Notifications screen (route notif).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repository + inline i18n/strings, so
// nothing touches the network; the assertions prove the REAL behaviours — honest
// derivation from the wire, mark-read + mark-all POSTs, and honest-empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/notif/notif_agg.dart';
import 'package:juneflow_mobile/screens/notif/notif_repository.dart';
import 'package:juneflow_mobile/screens/notif/notif_screen.dart';

/// In-memory repo: serves fixed rows, records mark-read calls, and flips `read`.
class _FakeRepo implements NotificationsRepository {
  _FakeRepo(this.rows);

  List<NotifEnt> rows;
  final List<String> readCalls = <String>[];

  @override
  Future<List<NotifEnt>> list() async => rows;

  @override
  Future<void> markRead(String id) async {
    readCalls.add(id);
    rows = rows
        .map(
          (NotifEnt e) =>
              e['id'] == id ? <String, Object?>{...e, 'read': true} : e,
        )
        .toList();
  }
}

/// th i18n where tp(key) returns the key (renders the Thai sidecar text).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real key sidecar shape (values are the Thai phrase keys).
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"แจ้งเตือน","title":"ของฉัน","markRead":"อ่าน",'
  '"filterAll":"ทั้งหมด","filterApproval":"รออนุมัติ",'
  '"filterUpdate":"แจ้งอัปเดต","filterSystem":"ระบบ"}',
);

Future<void> _pump(WidgetTester tester, NotificationsRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: NotifScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pump(); // resolve the fake list() future
  await tester.pump();
}

void main() {
  testWidgets('renders the chrome + honest-derived rows from the repo', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(<NotifEnt>[
      <String, Object?>{
        'id': 'n1',
        'type': 'approval',
        'ref': 'pr:abc-123',
        'read': false,
        'created_at': '2026-08-04T09:00:00Z',
      },
      <String, Object?>{
        'id': 'n2',
        'type': 'alert',
        'ref': 'boq:zzz-9',
        'read': true,
        'created_at': '2026-08-04T08:00:00Z',
      },
    ]);
    await _pump(tester, repo);

    // Header chrome + the four filter pills render (i18n keys resolve for th).
    expect(find.text('ของฉัน'), findsOneWidget);
    expect(find.text('แจ้งเตือน'), findsOneWidget);
    for (final String pill in <String>[
      'ทั้งหมด',
      'รออนุมัติ',
      'แจ้งอัปเดต',
      'ระบบ',
    ]) {
      expect(find.text(pill), findsOneWidget, reason: 'pill "$pill" missing');
    }

    // Honest titles: the real ref, never an invented sentence.
    expect(find.text('pr:abc-123'), findsOneWidget);
    expect(find.text('boq:zzz-9'), findsOneWidget);

    // Icon derived from the real `type` enum (approval → check, alert → warn).
    expect(find.byIcon(Icons.check), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
  });

  testWidgets('a row with neither title nor ref shows an honest em-dash', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(<NotifEnt>[
      <String, Object?>{
        'id': 'bare',
        'type': 'info',
        'read': true,
        'created_at': '2026-08-04T09:00:00Z',
      },
    ]);
    await _pump(tester, repo);

    // The title em-dash (no sentence fabricated). info → info icon.
    expect(find.text('—'), findsWidgets);
    expect(find.byIcon(Icons.info_outline), findsOneWidget);
  });

  testWidgets('honest-empty: no notifications → a centered em-dash, no crash', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(<NotifEnt>[]));
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('tapping an unread row POSTs mark-read for that id', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(<NotifEnt>[
      <String, Object?>{
        'id': 'u1',
        'type': 'info',
        'ref': 'gr:1',
        'read': false,
        'created_at': '2026-08-04T09:00:00Z',
      },
    ]);
    await _pump(tester, repo);

    await tester.tap(find.text('gr:1'));
    await tester.pump();
    await tester.pump();

    expect(repo.readCalls, <String>['u1']);
  });

  testWidgets('tapping an already-read row does not POST', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(<NotifEnt>[
      <String, Object?>{
        'id': 'r1',
        'type': 'info',
        'ref': 'gr:2',
        'read': true,
        'created_at': '2026-08-04T09:00:00Z',
      },
    ]);
    await _pump(tester, repo);

    await tester.tap(find.text('gr:2'));
    await tester.pump();
    await tester.pump();

    expect(repo.readCalls, isEmpty);
  });

  testWidgets('the header "อ่าน" action marks every unread row read', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(<NotifEnt>[
      <String, Object?>{'id': 'a', 'type': 'info', 'ref': 'x:1', 'read': false},
      <String, Object?>{'id': 'b', 'type': 'info', 'ref': 'x:2', 'read': true},
      <String, Object?>{'id': 'c', 'type': 'info', 'ref': 'x:3', 'read': false},
    ]);
    await _pump(tester, repo);

    await tester.tap(find.text('อ่าน'));
    await tester.pump();
    await tester.pump();

    // Only the unread ids (a, c) are POSTed; the read one (b) is untouched.
    expect(repo.readCalls..sort(), <String>['a', 'c']);
  });
}
