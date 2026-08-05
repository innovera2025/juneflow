// Widget tests for the mobile technician close-out screen (route tech-close).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven directly with a FAKE repository + inline i18n/strings, so nothing
// touches the network; the assertions prove the REAL behaviours — the thin-honest
// em-dashed slots (no signature / photo / work-detail / materials column), the
// ABSENCE of any capture affordance, the machine-derived action, the POST each
// button issues, the honest failure state, and honest-empty with no selection.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/service/service_agg.dart';
import 'package:juneflow_mobile/screens/service/service_repository.dart';
import 'package:juneflow_mobile/screens/service/tech_close_screen.dart';

/// In-memory repo serving one ticket and recording the transitions it is asked for.
/// [statusAfter] models the SERVER's answer to the re-read that follows a move.
class _FakeRepo implements ServiceRepository {
  _FakeRepo({this.ticket, this.throwOnWrite = false, this.statusAfter});

  ServiceEnt? ticket;
  final bool throwOnWrite;
  final String? statusAfter;
  final List<(String, ServiceOp)> calls = <(String, ServiceOp)>[];

  @override
  Future<List<ServiceEnt>> listTickets() async => const <ServiceEnt>[];

  @override
  Future<ServiceEnt?> getTicket(String id) async => ticket;

  @override
  Future<ServiceEnt?> createTicket(Map<String, Object?> body) async => null;

  @override
  Future<void> runTransition(String id, ServiceOp op) async {
    calls.add((id, op));
    if (throwOnWrite) throw StateError('409');
    final ServiceEnt? t = ticket;
    if (t != null && statusAfter != null) {
      ticket = <String, Object?>{...t, 'status': statusAfter};
    }
  }

  @override
  Future<ServiceUser> currentUser() async =>
      const ServiceUser(id: '', name: '');
}

final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"sales.service.statusFixed":{"th":"ซ่อมเสร็จ"},'
  '"sales.service.statusClosed":{"th":"ปิดงาน"},'
  '"sales.service.btnClosedDone":{"th":"ปิดงานแล้ว"},'
  '"labor.att.savedBadge":{"th":"บันทึกแล้ว"},'
  '"admin.common.actionFailedToast":{"th":"ทำรายการไม่สำเร็จ"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"title":"ปิดงานซ่อม","fieldBefore":"ก่อนซ่อม","fieldAfter":"หลังซ่อม",'
  '"fieldWorkDetails":"รายละเอียดงานที่ทำ","fieldMaterials":"วัสดุที่ใช้",'
  '"signatureTitle":"ลายเซ็นรับงานจากลูกค้า",'
  '"btnFix":"sales.service.statusFixed","btnClose":"sales.service.statusClosed",'
  '"btnClosedDone":"sales.service.btnClosedDone",'
  '"saved":"labor.att.savedBadge","failed":"admin.common.actionFailedToast"}',
);

ServiceEnt _ticket({String status = 'fixing', String no = 'SR-2026-0048'}) =>
    <String, Object?>{
      'id': 'tick-1',
      'no': no,
      'status': status,
      'title': 'ก๊อกน้ำห้องครัวรั่ว',
    };

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? ticketId = 'tick-1',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TechCloseScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          ticketId: ticketId,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('every content slot is a kept label over an honest em-dash', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(ticket: _ticket()));

    expect(find.text('ปิดงานซ่อม'), findsOneWidget);
    expect(find.text('SR-2026-0048'), findsOneWidget); // the REAL eyebrow
    expect(find.text('ก่อนซ่อม'), findsOneWidget);
    // "หลังซ่อม" is required in the prototype; the asterisk is dropped because
    // nothing here could satisfy it, so the label matches exactly.
    expect(find.text('หลังซ่อม'), findsOneWidget);
    expect(find.text('รายละเอียดงานที่ทำ'), findsOneWidget);
    expect(find.text('วัสดุที่ใช้'), findsOneWidget);
    expect(find.text('ลายเซ็นรับงานจากลูกค้า'), findsOneWidget);

    // Four field slots + the signature pad, all em-dashed: no column backs any.
    expect(find.text('—'), findsNWidgets(5));
  });

  testWidgets('no capture affordance is offered for data nothing stores', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(ticket: _ticket()));
    // No photo picker (no photo column), no signature pad (no signature column),
    // no editable field at all (no work-detail / materials column).
    expect(find.byType(TextField), findsNothing);
    expect(find.byIcon(Icons.add), findsNothing);
    expect(find.byIcon(Icons.edit), findsNothing);
    expect(find.byType(CustomPaint).evaluate().isEmpty, isFalse); // chrome only
    // The prototype's survey promise never reaches the button.
    expect(find.text('ปิดงาน + ส่งแบบประเมิน'), findsNothing);
    expect(find.text('เซ็นที่นี่'), findsNothing);
  });

  testWidgets('a fixing ticket offers the fix move and POSTs exactly it', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      ticket: _ticket(status: 'fixing'),
      statusAfter: 'fixed',
    );
    await _pump(tester, repo);

    expect(find.text('ซ่อมเสร็จ'), findsOneWidget);
    expect(find.text('ปิดงาน'), findsNothing); // close is NOT legal from fixing

    await tester.tap(find.text('ซ่อมเสร็จ'));
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(repo.calls, <(String, ServiceOp)>[('tick-1', ServiceOp.fix)]);
    expect(find.text('บันทึกแล้ว'), findsOneWidget);
    // The re-read moved the ticket on, so the NEXT legal move is now offered.
    expect(find.text('ปิดงาน'), findsOneWidget);
  });

  testWidgets('a fixed ticket offers the close move and POSTs exactly it', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      ticket: _ticket(status: 'fixed'),
      statusAfter: 'closed',
    );
    await _pump(tester, repo);

    expect(find.text('ปิดงาน'), findsOneWidget);

    await tester.tap(find.text('ปิดงาน'));
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(repo.calls, <(String, ServiceOp)>[('tick-1', ServiceOp.close)]);
    // Terminal now: the honest-DISABLED "already closed" state, no further move.
    expect(find.text('ปิดงานแล้ว'), findsOneWidget);
  });

  testWidgets('a closed ticket offers no move at all', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(ticket: _ticket(status: 'closed'));
    await _pump(tester, repo);

    expect(find.text('ปิดงานแล้ว'), findsOneWidget);
    expect(find.text('ซ่อมเสร็จ'), findsNothing);

    await tester.tap(find.text('ปิดงานแล้ว'));
    await tester.pump();
    expect(repo.calls, isEmpty);
  });

  testWidgets('received/scheduled hold no legal move here — the button is dead', (
    WidgetTester tester,
  ) async {
    for (final String status in <String>['received', 'scheduled']) {
      final _FakeRepo repo = _FakeRepo(ticket: _ticket(status: status));
      await _pump(tester, repo);
      // Their move belongs to tech-jobs; offering it here would be an illegal jump.
      await tester.tap(find.text('ซ่อมเสร็จ'));
      await tester.pump();
      expect(repo.calls, isEmpty, reason: 'status $status must not write');
    }
  });

  testWidgets('a rejected move is surfaced as FAILED, never as a success', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      ticket: _ticket(status: 'fixing'),
      throwOnWrite: true,
    );
    await _pump(tester, repo);

    await tester.tap(find.text('ซ่อมเสร็จ'));
    await tester.pump();
    await tester.pump();

    expect(repo.calls.single.$2, ServiceOp.fix);
    expect(find.text('ทำรายการไม่สำเร็จ'), findsOneWidget);
    expect(find.text('บันทึกแล้ว'), findsNothing);
  });

  testWidgets('no selection, and an unreadable ticket, are honest-empty', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(), ticketId: null);
    expect(find.text('—'), findsNWidgets(2)); // the eyebrow + the empty state
    expect(find.text('ก่อนซ่อม'), findsNothing);

    // A ticket outside this tenant (the repo answers 404 -> null) behaves the same.
    await _pump(tester, _FakeRepo(ticket: null));
    expect(find.text('ก่อนซ่อม'), findsNothing);
  });
}
