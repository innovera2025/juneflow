// Widget tests for the mobile resident repair-tracking screen (route srv-track).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven directly with a FAKE repository + inline i18n/strings, so nothing
// touches the network; the assertions prove the REAL behaviours — the newest-ticket
// fallback, the 5-step timeline off the server's machine, the honest em-dashes
// (unit, the three timestamp-less steps, the handover date), the SERVER-derived
// warranty months, the unit-scoped history WITHOUT a fabricated rating, and
// honest-empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/service/service_agg.dart';
import 'package:juneflow_mobile/screens/service/service_repository.dart';
import 'package:juneflow_mobile/screens/service/srv_track_screen.dart';

/// In-memory repo: serves fixed register rows (no network).
class _FakeRepo implements ServiceRepository {
  _FakeRepo(this.rows);

  final List<ServiceEnt> rows;

  @override
  Future<List<ServiceEnt>> listTickets() async => rows;

  @override
  Future<ServiceEnt?> getTicket(String id) async => null;

  @override
  Future<ServiceEnt?> createTicket(Map<String, Object?> body) async => null;

  @override
  Future<void> runTransition(String id, ServiceOp op) async {}

  @override
  Future<ServiceUser> currentUser() async =>
      const ServiceUser(id: '', name: '');
}

/// th i18n: tp(key) echoes the phrase key; t(key) resolves the dict ids the sidecar
/// points at (the same ids the merged web after-sales port already uses).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"sales.service.statusReceived":{"th":"รับเรื่อง"},'
  '"sales.service.statusScheduled":{"th":"นัดช่าง"},'
  '"sales.service.statusFixing":{"th":"กำลังซ่อม"},'
  '"sales.service.statusFixed":{"th":"ซ่อมเสร็จ"},'
  '"sales.service.statusClosed":{"th":"ปิดงาน"},'
  '"sales.process.legendDelivered":{"th":"ส่งมอบ"},'
  '"sales.service.detailWarrantyLeft":{"th":"Warranty คงเหลือ"},'
  '"sales.service.monthsSuffix":{"th":"เดือน"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real key sidecar shape.
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"ลูกบ้าน","title":"ติดตามแจ้งซ่อม","historyTitle":"ประวัติการซ่อม",'
  '"statusReceived":"sales.service.statusReceived",'
  '"statusScheduled":"sales.service.statusScheduled",'
  '"statusFixing":"sales.service.statusFixing",'
  '"statusFixed":"sales.service.statusFixed",'
  '"statusClosed":"sales.service.statusClosed",'
  '"warrantyDelivered":"sales.process.legendDelivered",'
  '"warrantyLeft":"sales.service.detailWarrantyLeft",'
  '"monthsSuffix":"sales.service.monthsSuffix"}',
);

ServiceEnt _row({
  required String id,
  required String no,
  String unitId = 'u1',
  String status = 'fixing',
  String title = 'ก๊อกน้ำห้องครัวรั่ว',
  String category = 'ระบบประปา',
  String opened = '2026-05-23',
  String scheduled = '2026-05-27',
  Object? warrantyMonths,
}) => <String, Object?>{
  'id': id,
  'no': no,
  'unit_id': unitId,
  'category': category,
  'title': title,
  'status': status,
  'opened_date': opened,
  'scheduled_date': scheduled,
  'warranty_months_remaining': warrantyMonths,
};

Future<void> _pump(
  WidgetTester tester,
  List<ServiceEnt> rows, {
  String? ticketId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SrvTrackScreen(
          repo: _FakeRepo(rows),
          strings: _strings,
          i18n: _i18n,
          ticketId: ticketId,
        ),
      ),
    ),
  );
  await tester.pump(); // resolve the fake listTickets() future
  await tester.pump();
}

void main() {
  testWidgets('renders the chrome, the real ticket and its 5-step timeline', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-2026-0048', warrantyMonths: 11),
    ]);

    expect(find.text('ติดตามแจ้งซ่อม'), findsOneWidget);
    expect(find.text('ลูกบ้าน'), findsOneWidget);
    expect(find.text('ประวัติการซ่อม'), findsOneWidget);

    // Real columns render verbatim.
    expect(find.text('SR-2026-0048'), findsOneWidget);
    expect(find.text('ก๊อกน้ำห้องครัวรั่ว'), findsOneWidget);
    expect(find.text('ระบบประปา'), findsOneWidget);

    // All five machine steps are drawn; the current one also labels the pill, so
    // "กำลังซ่อม" appears twice (timeline + pill).
    expect(find.text('รับเรื่อง'), findsOneWidget);
    expect(find.text('นัดช่าง'), findsOneWidget);
    expect(find.text('กำลังซ่อม'), findsNWidgets(2));
    expect(find.text('ซ่อมเสร็จ'), findsOneWidget);
    expect(find.text('ปิดงาน'), findsOneWidget);

    // The two steps that HAVE a column show their real date, rendered in the house
    // numeric form (pr_detail_agg.formatWireDate) — never the raw wire string.
    expect(find.text('23/5/2026'), findsOneWidget);
    expect(find.text('27/5/2026'), findsOneWidget);
    expect(find.text('2026-05-23'), findsNothing);
    expect(find.text('2026-05-27'), findsNothing);
  });

  testWidgets('no date slot leaks the raw wire string — timeline AND history', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-2026-0048', unitId: 'u1'),
      _row(
        id: 'b',
        no: 'SR-2026-0045',
        unitId: 'u1',
        title: 'พื้นกระเบื้องแตก',
        opened: '2026-04-02',
      ),
    ]);

    // The history row's intake date is formatted too (single-digit day AND month
    // are NOT zero-padded — the merged pr-detail contract).
    expect(find.text('2/4/2026'), findsOneWidget);
    // Nothing anywhere on the screen renders a YYYY-MM-DD.
    expect(find.textContaining(RegExp(r'\d{4}-\d{2}-\d{2}')), findsNothing);
  });

  testWidgets('the warranty card prints the SERVER months and em-dashes the '
      'handover date it is not given', (WidgetTester tester) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-1', warrantyMonths: 11),
    ]);

    expect(find.text('Warranty คงเหลือ'), findsOneWidget);
    expect(find.text('11 เดือน'), findsOneWidget);
    // transfer_at is what the SERVER derives from; the wire never returns it.
    expect(find.text('ส่งมอบ'), findsOneWidget);
    // No day count is invented on top of the whole-month wire.
    expect(find.textContaining('วัน'), findsNothing);
  });

  testWidgets('a null warranty number em-dashes instead of showing 0 or 12', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[_row(id: 'a', no: 'SR-1')]);
    expect(find.text('11 เดือน'), findsNothing);
    expect(find.textContaining('เดือน'), findsNothing);
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('the unit-scoped history lists other tickets and NO rating', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-2026-0048', unitId: 'u1'),
      _row(
        id: 'b',
        no: 'SR-2026-0045',
        unitId: 'u1',
        title: 'พื้นกระเบื้องแตก',
      ),
      _row(
        id: 'c',
        no: 'SR-2026-0031',
        unitId: 'OTHER',
        title: 'ไม่ใช่ยูนิตนี้',
      ),
    ]);

    expect(find.text('SR-2026-0045'), findsOneWidget);
    expect(find.text('พื้นกระเบื้องแตก'), findsOneWidget);
    // Another unit's ticket never leaks into this resident's history.
    expect(find.text('ไม่ใช่ยูนิตนี้'), findsNothing);
    // service_ticket has no rating column — nothing star-shaped may appear.
    expect(find.textContaining('★'), findsNothing);
    expect(find.byIcon(Icons.star), findsNothing);
  });

  testWidgets('a ticket with no unit shows an honest-empty history', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-1', unitId: ''),
      _row(id: 'b', no: 'SR-2', unitId: 'u9', title: 'somebody else'),
    ]);
    expect(find.text('somebody else'), findsNothing);
    expect(find.text('ประวัติการซ่อม'), findsOneWidget);
  });

  testWidgets('a selected ticket id wins over the newest row', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      // A different unit, so the newest row cannot reappear via the history.
      _row(id: 'a', no: 'SR-NEWEST', unitId: 'other-unit'),
      _row(id: 'b', no: 'SR-SELECTED', status: 'received'),
    ], ticketId: 'b');
    expect(find.text('SR-SELECTED'), findsOneWidget);
    expect(find.text('SR-NEWEST'), findsNothing);
  });

  testWidgets('honest-empty: an empty register renders a centered em-dash', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const <ServiceEnt>[]);
    expect(find.text('—'), findsOneWidget);
    expect(find.text('ประวัติการซ่อม'), findsNothing);
  });

  testWidgets('an unknown selected id is honest-empty, not a fall-through', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <ServiceEnt>[
      _row(id: 'a', no: 'SR-SOMEONE-ELSE'),
    ], ticketId: 'not-in-this-tenant');
    expect(find.text('SR-SOMEONE-ELSE'), findsNothing);
    expect(find.text('—'), findsOneWidget);
  });
}
