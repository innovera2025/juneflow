// Widget tests for the mobile PR reject action sheet (route reject).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven with a FAKE repo + inline i18n/strings; the assertions
// prove the REAL behaviours — the server PR no renders off the wire, the reason is
// REQUIRED (submit disabled while empty), a preset FILLS the reason, submit drives
// POST /pr/{id}/reject with ONLY { reason } (no approval decision/amount), and
// no-PR is an honest em-dash.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_agg.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_repository.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_shared.dart';
import 'package:juneflow_mobile/screens/pr_action/reject_screen.dart';

class _FakeRepo implements PrActionRepository {
  _FakeRepo(this._pr);

  final PrEnt? _pr;
  final List<String> getCalls = <String>[];
  final List<String> approveCalls = <String>[];
  final List<List<String>> rejectCalls = <List<String>>[];

  @override
  Future<PrEnt?> getPr(String id) async {
    getCalls.add(id);
    return _pr;
  }

  @override
  Future<void> approve(String id) async => approveCalls.add(id);

  @override
  Future<void> reject(String id, String reason) async {
    rejectCalls.add(<String>[id, reason]);
  }
}

final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"กลับ","title":"ปฏิเสธเอกสาร",'
  '"banner":"{no} จะถูกส่งกลับให้ผู้ขอแก้ไข — กรุณาระบุเหตุผล",'
  '"commonReasons":"เหตุผลที่พบบ่อย",'
  '"reason1":"ราคาสูงกว่า BOQ ที่ตั้งไว้","reason2":"เอกสารแนบไม่ครบ",'
  '"reason3":"ขอเปรียบเทียบราคาเพิ่มเติม","reason4":"ขอแก้สเปกสินค้า",'
  '"reason5":"อื่นๆ (พิมพ์เหตุผล)",'
  '"detailLabel":"รายละเอียดเพิ่มเติม",'
  '"detailPlaceholder":"โปรดอธิบายเหตุผลเพิ่มเติม...",'
  '"cancel":"ยกเลิก","submit":"ส่งกลับให้แก้ไข"}',
);

PrEnt _pendingPr({String id = 'pr-r', String no = 'PR-2026-0777'}) =>
    <String, Object?>{
      'id': id,
      'no': no,
      'status': 'pending',
      'currency_code': 'THB',
      'amount': 340000,
      'items': <Object?>[],
    };

/// A tall surface so the whole sheet (banner + 5 presets + field + bar) is
/// on-screen and tappable (no loading spinner, so no pumpAndSettle).
Future<void> _pump(WidgetTester tester, RejectScreen screen) async {
  tester.view.physicalSize = const Size(1080, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
  await tester.pump(); // resolve getPr()
  await tester.pump(); // apply _load()'s setState
}

RejectScreen _screen(_FakeRepo repo, {String? prId = 'pr-r'}) =>
    RejectScreen(repo: repo, strings: _strings, i18n: _i18n, prId: prId);

Finder get _submitBtn => find.descendant(
  of: find.byType(PrActionBar),
  matching: find.text('ส่งกลับให้แก้ไข'),
);

void main() {
  testWidgets('renders the banner PR no + the five preset reasons', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr(no: 'PR-2026-0777'));
    await _pump(tester, _screen(repo));

    expect(repo.getCalls, <String>['pr-r']);
    expect(find.textContaining('PR-2026-0777'), findsOneWidget); // banner
    for (final String r in <String>[
      'ราคาสูงกว่า BOQ ที่ตั้งไว้',
      'เอกสารแนบไม่ครบ',
      'ขอเปรียบเทียบราคาเพิ่มเติม',
      'ขอแก้สเปกสินค้า',
      'อื่นๆ (พิมพ์เหตุผล)',
    ]) {
      expect(find.text(r), findsOneWidget, reason: 'preset "$r" missing');
    }
  });

  testWidgets(
    'reason REQUIRED: submit does nothing while empty; a preset fills '
    'it then submit POSTs reject { reason } only',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(_pendingPr());
      await _pump(tester, _screen(repo));

      // Empty reason → submit is disabled (tapping it POSTs nothing).
      await tester.tap(_submitBtn);
      await tester.pump();
      expect(repo.rejectCalls, isEmpty);

      // Tap a common-reason preset → fills the required reason field.
      await tester.tap(find.text('ขอเปรียบเทียบราคาเพิ่มเติม'));
      await tester.pump();

      // Now submit is enabled → POST reject with ONLY the reason (no decision/amount).
      await tester.tap(_submitBtn);
      await tester.pump();
      await tester.pump();

      expect(repo.rejectCalls, <List<String>>[
        <String>['pr-r', 'ขอเปรียบเทียบราคาเพิ่มเติม'],
      ]);
      expect(repo.approveCalls, isEmpty);
    },
  );

  testWidgets('typing a free-text reason enables submit and is sent verbatim', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr());
    await _pump(tester, _screen(repo));

    await tester.enterText(find.byType(TextField), 'ขอข้อมูลเพิ่ม');
    await tester.pump();
    await tester.tap(_submitBtn);
    await tester.pump();
    await tester.pump();

    expect(repo.rejectCalls, <List<String>>[
      <String>['pr-r', 'ขอข้อมูลเพิ่ม'],
    ]);
  });

  testWidgets('the "อื่นๆ" preset clears the reason → submit disabled again', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr());
    await _pump(tester, _screen(repo));

    await tester.tap(find.text('เอกสารแนบไม่ครบ')); // fill
    await tester.pump();
    await tester.tap(find.text('อื่นๆ (พิมพ์เหตุผล)')); // clear
    await tester.pump();

    await tester.tap(_submitBtn);
    await tester.pump();
    expect(repo.rejectCalls, isEmpty);
  });

  testWidgets('no PR selected → honest em-dash, no action bar, no network', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr());
    await _pump(tester, _screen(repo, prId: null));

    expect(repo.getCalls, isEmpty);
    expect(find.text('—'), findsOneWidget);
    expect(find.byType(PrActionBar), findsNothing);
  });
}
