// Widget tests for the mobile service-technician job list (route tech-jobs).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven directly with a FAKE repository + inline i18n/strings, so nothing
// touches the network; the assertions prove the REAL behaviours — the "mine" scope
// off GET /me, honest-empty with no identity, the two derivable stat tiles and the
// ABSENT rating tile, the machine-derived per-status buttons (and the three dropped
// prototype buttons), the actual POST that each button issues, the honest failure
// state, and the REAL ticket id carried into the close screen.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/service/service_agg.dart';
import 'package:juneflow_mobile/screens/service/service_repository.dart';
import 'package:juneflow_mobile/screens/service/tech_jobs_screen.dart';

/// In-memory repo: a fixed register + profile, recording every transition it is
/// asked to run so a test can prove WHICH op reached the server.
class _FakeRepo implements ServiceRepository {
  _FakeRepo({
    required this.rows,
    this.user = const ServiceUser(id: 'me', name: 'ช่างวิชัย'),
    this.throwOnWrite = false,
  });

  List<ServiceEnt> rows;
  final ServiceUser user;
  final bool throwOnWrite;
  final List<(String, ServiceOp)> calls = <(String, ServiceOp)>[];

  @override
  Future<List<ServiceEnt>> listTickets() async => rows;

  @override
  Future<ServiceEnt?> getTicket(String id) async => null;

  @override
  Future<ServiceEnt?> createTicket(Map<String, Object?> body) async => null;

  @override
  Future<void> runTransition(String id, ServiceOp op) async {
    calls.add((id, op));
    if (throwOnWrite) throw StateError('409');
  }

  @override
  Future<ServiceUser> currentUser() async => user;
}

final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"sales.common.today":{"th":"วันนี้"},'
  '"sales.service.prioHigh":{"th":"ด่วน"},'
  '"sales.service.btnStartFix":{"th":"เริ่มซ่อม"},'
  '"sales.service.statusReceived":{"th":"รับเรื่อง"},'
  '"sales.service.statusScheduled":{"th":"นัดช่าง"},'
  '"sales.service.statusFixing":{"th":"กำลังซ่อม"},'
  '"sales.service.statusFixed":{"th":"ซ่อมเสร็จ"},'
  '"sales.service.statusClosed":{"th":"ปิดงาน"},'
  '"admin.common.actionFailedToast":{"th":"ทำรายการไม่สำเร็จ"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"title":"งานของฉัน","btnClose":"ปิดงานซ่อม",'
  '"statToday":"sales.common.today","statUrgent":"sales.service.prioHigh",'
  '"btnSchedule":"sales.service.statusScheduled",'
  '"btnStart":"sales.service.btnStartFix",'
  '"statusReceived":"sales.service.statusReceived",'
  '"statusScheduled":"sales.service.statusScheduled",'
  '"statusFixing":"sales.service.statusFixing",'
  '"statusFixed":"sales.service.statusFixed",'
  '"statusClosed":"sales.service.statusClosed",'
  '"failed":"admin.common.actionFailedToast"}',
);

ServiceEnt _row({
  required String id,
  required String no,
  String status = 'received',
  String assignee = 'me',
  String priority = 'normal',
  String scheduled = '',
  String title = 'ก๊อกน้ำห้องครัวรั่ว',
}) => <String, Object?>{
  'id': id,
  'no': no,
  'title': title,
  'status': status,
  'priority': priority,
  'assignee_user_id': assignee,
  'scheduled_date': scheduled,
};

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  Widget Function(String)? closeBuilder,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TechJobsScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          closeBuilder: closeBuilder,
        ),
      ),
    ),
  );
  await tester.pump(); // currentUser()
  await tester.pump(); // listTickets()
  await tester.pump();
}

void main() {
  testWidgets('scopes the register to MY tickets and shows the real name', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[
          _row(id: 'a', no: 'SR-MINE'),
          _row(id: 'b', no: 'SR-THEIRS', assignee: 'someone-else'),
        ],
      ),
    );

    expect(find.text('งานของฉัน'), findsOneWidget);
    expect(find.text('ช่างวิชัย'), findsOneWidget); // the REAL /me name
    expect(find.text('SR-MINE'), findsOneWidget);
    // GET /sales/service returns the whole tenant register; only mine may show.
    expect(find.text('SR-THEIRS'), findsNothing);
  });

  testWidgets('no identity => honest-empty, never the whole tenant register', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[_row(id: 'a', no: 'SR-SOMEONE')],
        user: const ServiceUser(id: '', name: ''),
      ),
    );
    expect(find.text('SR-SOMEONE'), findsNothing);
    expect(find.text('—'), findsWidgets); // the eyebrow + the empty state
  });

  testWidgets('the stat tiles are real counts and the rating tile is absent', (
    WidgetTester tester,
  ) async {
    final String today = serviceTodayIso();
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[
          _row(id: 'a', no: 'SR-1', priority: 'high', scheduled: today),
          _row(id: 'b', no: 'SR-2', scheduled: '2020-01-01'),
        ],
      ),
    );

    expect(find.text('วันนี้'), findsOneWidget);
    expect(find.text('ด่วน'), findsOneWidget);
    expect(find.text('1'), findsNWidgets(2)); // 1 scheduled today, 1 urgent
    // service_ticket has NO rating column — no star tile may exist.
    expect(find.textContaining('★'), findsNothing);
    expect(find.text('เรตติ้ง'), findsNothing);
  });

  testWidgets('per-status buttons are exactly the machine\'s legal moves', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[
          _row(id: 'a', no: 'SR-1', status: 'received'),
          _row(id: 'b', no: 'SR-2', status: 'scheduled'),
          _row(id: 'c', no: 'SR-3', status: 'fixing'),
          _row(id: 'd', no: 'SR-4', status: 'fixed'),
        ],
      ),
    );

    // received -> schedule (labelled with the destination status: it also appears
    // as the scheduled row's pill, hence two matches).
    expect(find.text('นัดช่าง'), findsNWidgets(2));
    // scheduled -> start
    expect(find.text('เริ่มซ่อม'), findsOneWidget);
    // fixing + fixed -> open the close screen (one button each)
    expect(find.text('ปิดงานซ่อม'), findsNWidgets(2));

    // The three prototype buttons that promise something the API cannot do.
    expect(find.text('เลื่อนนัด'), findsNothing); // no reschedule op exists
    expect(find.text('ซ่อมเสร็จ + ปิดงาน'), findsNothing); // two moves in one
    expect(find.text('นัดลูกค้า'), findsNothing); // nothing notifies a customer
  });

  testWidgets('a closed ticket is terminal: a pill, never an action button', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[_row(id: 'e', no: 'SR-5', status: 'closed')],
      ),
    );
    // The status label appears exactly once — as the pill. No button carries it,
    // and no other move is offered from a terminal state.
    expect(find.text('ปิดงาน'), findsOneWidget);
    expect(find.text('ปิดงานซ่อม'), findsNothing);
    expect(find.text('นัดช่าง'), findsNothing);
    expect(find.text('เริ่มซ่อม'), findsNothing);
  });

  testWidgets('the schedule button POSTs the schedule op for that ticket', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      rows: <ServiceEnt>[_row(id: 'tick-1', no: 'SR-1', status: 'received')],
    );
    await _pump(tester, repo);

    await tester.tap(find.text('นัดช่าง'));
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(repo.calls, <(String, ServiceOp)>[('tick-1', ServiceOp.schedule)]);
  });

  testWidgets('the start button POSTs the start op for that ticket', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      rows: <ServiceEnt>[_row(id: 'tick-2', no: 'SR-2', status: 'scheduled')],
    );
    await _pump(tester, repo);

    await tester.tap(find.text('เริ่มซ่อม'));
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(repo.calls, <(String, ServiceOp)>[('tick-2', ServiceOp.start)]);
  });

  testWidgets('a rejected move is surfaced as FAILED, never as a success', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      rows: <ServiceEnt>[_row(id: 'tick-3', no: 'SR-3', status: 'received')],
      throwOnWrite: true,
    );
    await _pump(tester, repo);
    expect(find.text('ทำรายการไม่สำเร็จ'), findsNothing);

    await tester.tap(find.text('นัดช่าง'));
    await tester.pump();
    await tester.pump();

    expect(repo.calls.single.$2, ServiceOp.schedule);
    expect(find.text('ทำรายการไม่สำเร็จ'), findsOneWidget);
  });

  testWidgets('opening the close screen carries the REAL ticket id', (
    WidgetTester tester,
  ) async {
    final List<String> opened = <String>[];
    await _pump(
      tester,
      _FakeRepo(
        rows: <ServiceEnt>[
          _row(id: 'ticket-uuid-42', no: 'SR-9', status: 'fixing'),
        ],
      ),
      closeBuilder: (String id) {
        opened.add(id);
        return const Scaffold(body: Text('close-screen'));
      },
    );

    await tester.tap(find.text('ปิดงานซ่อม'));
    await tester.pumpAndSettle();

    expect(opened, <String>['ticket-uuid-42']);
    expect(find.text('close-screen'), findsOneWidget);
  });

  testWidgets(
    'tapping the card body also opens the close screen with that id',
    (WidgetTester tester) async {
      final List<String> opened = <String>[];
      await _pump(
        tester,
        _FakeRepo(
          rows: <ServiceEnt>[
            _row(id: 'ticket-uuid-7', no: 'SR-7', status: 'received'),
          ],
        ),
        closeBuilder: (String id) {
          opened.add(id);
          return const Scaffold(body: Text('close-screen'));
        },
      );

      await tester.tap(find.text('SR-7'));
      await tester.pumpAndSettle();

      expect(opened, <String>['ticket-uuid-7']);
    },
  );

  testWidgets('an unassigned register renders honest-empty', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(rows: const <ServiceEnt>[]));
    expect(find.text('—'), findsWidgets);
    expect(find.text('0'), findsNWidgets(2)); // both stat tiles count zero
  });
}
