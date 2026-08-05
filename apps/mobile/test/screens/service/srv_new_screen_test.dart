// Widget tests for the mobile resident new-repair-request form (route srv-new).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven directly with a FAKE repository + inline i18n/strings, so nothing
// touches the network; the assertions prove the REAL behaviours — the exact create
// body (and every key it refuses to send), the WITHHELD category write (no ruled
// vocabulary yet — BLOCKERS.md B-292) proved in BOTH display languages, the
// required-title gate, the SERVER-allocated number on success, the honest failure
// state, and the three prototype controls that are dropped because no column backs
// them.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/service/service_agg.dart';
import 'package:juneflow_mobile/screens/service/service_repository.dart';
import 'package:juneflow_mobile/screens/service/srv_new_screen.dart';

/// In-memory repo recording every create body it is handed.
class _FakeRepo implements ServiceRepository {
  _FakeRepo({this.throwOnCreate = false, this.createdNo = 'SR-2026-0051'});

  final bool throwOnCreate;
  final String createdNo;
  final List<Map<String, Object?>> creates = <Map<String, Object?>>[];

  @override
  Future<List<ServiceEnt>> listTickets() async => const <ServiceEnt>[];

  @override
  Future<ServiceEnt?> getTicket(String id) async => null;

  @override
  Future<ServiceEnt?> createTicket(Map<String, Object?> body) async {
    creates.add(body);
    if (throwOnCreate) throw StateError('400');
    return <String, Object?>{'id': 'new', 'no': createdNo};
  }

  @override
  Future<void> runTransition(String id, ServiceOp op) async {}

  @override
  Future<ServiceUser> currentUser() async =>
      const ServiceUser(id: '', name: '');
}

/// Two languages so the category-VALUE test can prove the stored string stays Thai
/// while the DISPLAY follows the locale.
const String _i18nJson =
    '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"},'
    '{"code":"en","label":"English","en":"English","dir":"ltr"}],'
    '"dict":{'
    '"sales.service.catPlumbing":{"th":"ระบบประปา","en":"Plumbing"},'
    '"sales.service.catElectrical":{"th":"ระบบไฟฟ้า","en":"Electrical"},'
    '"sales.service.catPaint":{"th":"ทาสี","en":"Painting"},'
    '"sales.service.catWindowDoor":{"th":"หน้าต่าง/ประตู","en":"Windows/Doors"},'
    '"sales.service.catAircon":{"th":"ระบบแอร์","en":"Air-conditioning"},'
    '"sales.service.catFloorTile":{"th":"พื้น/กระเบื้อง","en":"Floor/Tiles"},'
    '"labor.att.savedBadge":{"th":"บันทึกแล้ว","en":"Saved"},'
    '"admin.common.actionFailedToast":{"th":"ทำรายการไม่สำเร็จ","en":"Failed"}'
    '},"nav_i18n":{},"phrases":{}}';

final JuneflowI18n _th = JuneflowI18n.fromJsonString(_i18nJson, lang: 'th');
final JuneflowI18n _en = JuneflowI18n.fromJsonString(_i18nJson, lang: 'en');

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"ลูกบ้าน · แจ้งซ่อม","title":"แจ้งซ่อมใหม่",'
  '"fieldUnit":"ยูนิตของฉัน","fieldCategory":"เลือกหมวด",'
  '"fieldProblem":"คำอธิบายปัญหา","submit":"ส่งแจ้งซ่อม",'
  '"catPlumbing":"sales.service.catPlumbing",'
  '"catElectrical":"sales.service.catElectrical",'
  '"catPaint":"sales.service.catPaint",'
  '"catWindowDoor":"sales.service.catWindowDoor",'
  '"catAircon":"sales.service.catAircon",'
  '"catFloorTile":"sales.service.catFloorTile",'
  '"saved":"labor.att.savedBadge","failed":"admin.common.actionFailedToast"}',
);

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? unitId,
  JuneflowI18n? i18n,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SrvNewScreen(
          repo: repo,
          strings: _strings,
          i18n: i18n ?? _th,
          unitId: unitId,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('renders the chrome and the six category tiles', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());

    expect(find.text('แจ้งซ่อมใหม่'), findsOneWidget);
    expect(find.text('ลูกบ้าน · แจ้งซ่อม'), findsOneWidget);
    expect(find.text('ยูนิตของฉัน'), findsOneWidget);
    // The problem field carries the prototype's required asterisk, so its rendered
    // span is "<label> *" — match the label inside it. The category label does NOT:
    // an asterisk over a control nothing can operate is a promise (same reason the
    // unit field above drops it).
    expect(find.text('เลือกหมวด'), findsOneWidget);
    expect(find.textContaining('คำอธิบายปัญหา'), findsOneWidget);
    expect(find.text('ส่งแจ้งซ่อม'), findsOneWidget);

    for (final String cat in <String>[
      'ระบบประปา',
      'ระบบไฟฟ้า',
      'ทาสี',
      'หน้าต่าง/ประตู',
      'ระบบแอร์',
      'พื้น/กระเบื้อง',
    ]) {
      expect(find.text(cat), findsOneWidget, reason: 'tile "$cat" missing');
    }
  });

  testWidgets('the three unbacked prototype controls are absent', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());
    // No photo column and no upload seam on this route.
    expect(find.text('รูปประกอบ (อย่างน้อย 1 รูป)'), findsNothing);
    expect(find.byIcon(Icons.add), findsNothing);
    // scheduled_date means "the appointment set", not the resident's wish.
    expect(find.text('นัดวันสะดวก'), findsNothing);
    // The machine has no draft state.
    expect(find.text('บันทึกร่าง'), findsNothing);
    // The unit has no label endpoint -> the kept label sits over an em-dash.
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('submission is blocked until the required problem text exists', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);

    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    expect(repo.creates, isEmpty); // the server's one required field is blank

    await tester.enterText(find.byType(TextField), 'ก๊อกน้ำรั่ว');
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();
    expect(repo.creates, hasLength(1));
  });

  testWidgets('the create body carries only real columns', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo, unitId: 'unit-uuid-1');

    await tester.enterText(find.byType(TextField), '  ก๊อกน้ำรั่ว  ');
    await tester.pump();
    // Tapping a tile changes nothing: the grid is inert until B-292 rules which
    // vocabulary service_ticket.category holds.
    await tester.tap(find.text('ระบบประปา'));
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();

    expect(repo.creates.single, <String, Object?>{
      'title': 'ก๊อกน้ำรั่ว', // the problem text -> the only free-text column
      'unit_id': 'unit-uuid-1', // the REAL uuid the flow carried
    });
  });

  testWidgets(
    'the category grid is inert chrome — no tile can be picked, no value stored',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo();
      await _pump(tester, repo);

      // The tiles are DRAWN (prototype chrome) but carry no gesture at all: a tap
      // that silently discarded the pick is the failure mode the photo strip was
      // dropped to avoid.
      for (final String cat in <String>['ระบบประปา', 'พื้น/กระเบื้อง']) {
        expect(
          find.ancestor(
            of: find.text(cat),
            matching: find.byType(GestureDetector),
          ),
          findsNothing,
          reason: 'tile "$cat" must not be tappable',
        );
      }

      await tester.enterText(find.byType(TextField), 'leak');
      await tester.pump();
      for (final String cat in <String>[
        'ระบบประปา',
        'หน้าต่าง/ประตู',
        'พื้น/กระเบื้อง',
      ]) {
        await tester.tap(find.text(cat), warnIfMissed: false);
        await tester.pump();
      }
      await tester.tap(find.text('ส่งแจ้งซ่อม'));
      await tester.pump();
      await tester.pump();

      // Nothing about a category reaches the server. The dict values, the seed
      // values and the mobile prototype's own tiles are three different sets (only
      // one value is common to all three), so writing any of them would fork a
      // free-text column the web register renders raw. B-292 holds the ruling.
      expect(repo.creates.single.containsKey('category'), isFalse);
      expect(repo.creates.single, <String, Object?>{'title': 'leak'});
    },
  );

  testWidgets('no category is written under a non-Thai display language either', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo, i18n: _en);

    // The TILE label follows the locale (display only)...
    expect(find.text('Plumbing'), findsOneWidget);
    expect(find.text('ระบบประปา'), findsNothing);

    await tester.enterText(find.byType(TextField), 'leak');
    await tester.pump();
    await tester.tap(find.text('Plumbing'), warnIfMissed: false);
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();

    // ...and NEITHER language writes a category: not the English label, and not
    // the Thai one behind it.
    expect(repo.creates.single.containsKey('category'), isFalse);
  });

  testWidgets('no unit and no category => those keys are simply not sent', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(tester, repo);

    await tester.enterText(find.byType(TextField), 'leak');
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();

    expect(repo.creates.single, <String, Object?>{'title': 'leak'});
  });

  testWidgets('success shows the SERVER-allocated number, not an invented one', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(createdNo: 'SR-2026-0099');
    await _pump(tester, repo);

    await tester.enterText(find.byType(TextField), 'leak');
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();

    expect(find.text('บันทึกแล้ว · SR-2026-0099'), findsOneWidget);

    // A second tap cannot raise a second ticket (there is no idempotency key).
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    expect(repo.creates, hasLength(1));
  });

  testWidgets('a rejected create says FAILED and never claims a ticket', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(throwOnCreate: true);
    await _pump(tester, repo);

    await tester.enterText(find.byType(TextField), 'leak');
    await tester.pump();
    await tester.tap(find.text('ส่งแจ้งซ่อม'));
    await tester.pump();
    await tester.pump();

    expect(find.text('ทำรายการไม่สำเร็จ'), findsOneWidget);
    expect(find.textContaining('บันทึกแล้ว'), findsNothing);
  });
}
