// Widget tests for the mobile PR detail (route detail).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repo + inline i18n/strings, so nothing
// touches the network; the assertions prove the REAL behaviours — the server
// no/title/amount/requester/vendor/lines/need-date render off the wire, the project
// name resolves via the GET /projects join (em-dash when unresolved) with the real
// phase beside it, item material names em-dash (no wire), the pending banner shows
// the real approval_step, the approve caption shows the SERVER amount verbatim, and
// a 404 is an honest em-dash with no action bar.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/pr_detail/pr_detail_agg.dart';
import 'package:juneflow_mobile/screens/pr_detail/pr_detail_repository.dart';
import 'package:juneflow_mobile/screens/pr_detail/pr_detail_screen.dart';

/// In-memory repo: serves one fixed PR (or null) + a project catalogue, and records
/// the calls it receives.
class _FakeRepo implements PrDetailRepository {
  _FakeRepo(this._pr, {this.projects = const <PrDetailEnt>[]});
  final PrDetailEnt? _pr;
  final List<PrDetailEnt> projects;
  final List<String> getCalls = <String>[];
  int projectCalls = 0;

  @override
  Future<PrDetailEnt?> getPr(String id) async {
    getCalls.add(id);
    return _pr;
  }

  @override
  Future<List<PrDetailEnt>> listProjects() async {
    projectCalls++;
    return projects;
  }
}

/// th i18n where tp(key) echoes the key; dict resolves the mob.approval.detail.*
/// templates + subcon.unitBaht (the ฿).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"subcon.unitBaht":{"th":"฿"},'
  '"mob.approval.detail.netTotal":{"th":"ยอดรวมสุทธิ"},'
  '"mob.approval.detail.lineCountVat":{"th":"{count} รายการ · รวม VAT {vatPct}%"},'
  '"mob.approval.detail.awaitingYou":{"th":"รอคุณอนุมัติ · ชั้นที่ {level} จาก {total}"},'
  '"mob.approval.detail.approveWithAmount":{"th":"อนุมัติ · {amount} ฿"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"sub":"ใบขอซื้อ","statusPending":"รออนุมัติ","statusApproved":"อนุมัติแล้ว",'
  '"statusRejected":"ปฏิเสธ","statusDraft":"ฉบับร่าง","requesterLabel":"ผู้ขอ",'
  '"projectLabel":"โครงการ","needDateLabel":"วันที่ต้องการ","vendorLabel":"ผู้ขาย",'
  '"materialsLabel":"รายการวัสดุ","viewAll":"ดูทั้งหมด"}',
);

const List<PrDetailEnt> _projects = <PrDetailEnt>[
  <String, Object?>{'id': 'proj-uuid', 'name': 'Ratchaphruek'},
];

PrDetailEnt _pendingPr() => <String, Object?>{
  'id': 'pr-9',
  'no': 'PR-2026-0418',
  'title': 'ปูนซีเมนต์ + เหล็กเส้น',
  'status': 'pending',
  'approval_step': 2,
  'currency_code': 'THB',
  'amount': 902475,
  'project_id': 'proj-uuid',
  'phase': 'เฟส 2 · B',
  'need_date': '2026-06-02',
  'vendor': 'CPAC',
  'requester': 'Wipha',
  'items': <Object?>[
    <String, Object?>{'id': 'l1', 'qty': 1200, 'amount': 202200},
    <String, Object?>{'id': 'l2', 'qty': 540, 'amount': 229500},
  ],
};

Future<void> _pump(WidgetTester tester, _FakeRepo repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PrDetailScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          prId: 'pr-9',
        ),
      ),
    ),
  );
  await tester.pump(); // resolve getPr()
  await tester.pump(); // resolve listProjects()
  await tester.pump(); // apply _load()'s setState
}

void main() {
  testWidgets('renders the server fields incl title/need-date/step/project·phase', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr(), projects: _projects);
    await _pump(tester, repo);

    expect(repo.getCalls, <String>['pr-9']);
    expect(repo.projectCalls, 1); // the project-name join fired
    // The PR no is the header title; the material title is the parties-card heading.
    expect(find.text('PR-2026-0418'), findsOneWidget);
    expect(find.text('ปูนซีเมนต์ + เหล็กเส้น'), findsOneWidget); // REAL title
    // Pending banner = the awaiting-you status ONLY — no fabricated tier number
    // (PR approval is single-shot; a pending PR is always approval_step 0).
    expect(find.text('รอคุณอนุมัติ'), findsOneWidget);
    expect(find.textContaining('ชั้นที่'), findsNothing);
    // Real net total + ฿ (SERVER amount, verbatim) and the VAT-clause-free count.
    expect(find.text('ยอดรวมสุทธิ'), findsOneWidget);
    expect(find.textContaining('902,475 ฿'), findsWidgets);
    expect(find.text('2 รายการ'), findsOneWidget); // "· รวม VAT" dropped
    // Real parties + resolved project name · real phase + formatted need-date.
    expect(find.text('Wipha'), findsOneWidget);
    expect(find.text('CPAC'), findsOneWidget);
    expect(find.text('Ratchaphruek · เฟส 2 · B'), findsOneWidget);
    expect(find.text('2/6/2026'), findsOneWidget); // need_date reformatted
    // Real line qty (name is em-dashed — no wire).
    expect(find.text('1,200'), findsOneWidget);
    expect(find.text('540'), findsOneWidget);
    // Only the two material names em-dash (everything else resolved).
    expect(find.text('—'), findsWidgets);
    // The approve caption shows the SERVER amount verbatim.
    expect(find.text('อนุมัติ · 902,475 ฿'), findsOneWidget);
  });

  testWidgets('an unresolved project → em-dash name but the real phase shows', (
    WidgetTester tester,
  ) async {
    // No projects catalogue → the project_id cannot resolve to a name.
    await _pump(tester, _FakeRepo(_pendingPr()));
    // The project line falls back to the real phase alone (never a raw uuid).
    expect(find.text('เฟส 2 · B'), findsOneWidget);
    expect(find.text('Ratchaphruek · เฟส 2 · B'), findsNothing);
  });

  testWidgets('a null vendor/requester renders honest em-dashes', (
    WidgetTester tester,
  ) async {
    final PrDetailEnt pr = _pendingPr()
      ..['vendor'] = null
      ..['requester'] = null;
    await _pump(tester, _FakeRepo(pr, projects: _projects));

    expect(find.text('CPAC'), findsNothing);
    expect(find.text('Wipha'), findsNothing);
    // requester + vendor + the two material names → several em-dashes.
    expect(find.text('—'), findsWidgets);
    // The labels still render (the row is present, the value is honest-empty).
    expect(find.text('ผู้ขอ'), findsOneWidget);
    expect(find.text('ผู้ขาย'), findsOneWidget);
    expect(find.text('วันที่ต้องการ'), findsOneWidget);
  });

  testWidgets('a 404 (null PR) → honest em-dash, no action bar', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(null));

    // Honest-empty: the centered body em-dash (and the header title em-dashes too,
    // since no docNo was passed) — and NO approve/reject bar (nothing to act on).
    expect(find.text('—'), findsWidgets);
    expect(find.textContaining('อนุมัติ ·'), findsNothing);
  });

  testWidgets('the status banner is omitted for an unknown status', (
    WidgetTester tester,
  ) async {
    final PrDetailEnt pr = _pendingPr()..['status'] = 'weird';
    await _pump(tester, _FakeRepo(pr, projects: _projects));

    // No status banner renders (unknown → omitted, never fabricated).
    expect(find.textContaining('ชั้นที่'), findsNothing);
    expect(find.textContaining('รอคุณอนุมัติ'), findsNothing);
    for (final String s in <String>[
      'รออนุมัติ',
      'อนุมัติแล้ว',
      'ปฏิเสธ',
      'ฉบับร่าง',
    ]) {
      expect(
        find.text(s),
        findsNothing,
        reason: 'no status banner for unknown',
      );
    }
    // But the doc still renders (amount card present).
    expect(find.text('ยอดรวมสุทธิ'), findsOneWidget);
  });
}
