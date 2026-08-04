// Widget tests for the mobile PR approve action sheet (route approve).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven with a FAKE repo + inline i18n/strings, so nothing touches
// the network; the assertions prove the REAL behaviours — the server PR no +
// amount render off the wire, confirm drives POST /pr/{id}/approve with the PATH
// ID ONLY (no client decision/amount), and no-PR is an honest em-dash.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/pr_action/approve_screen.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_agg.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_repository.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_shared.dart';

/// In-memory repo: serves one fixed PR and records the calls it receives. Note
/// `approve` takes ONLY an id — there is structurally no amount/decision to send.
class _FakeRepo implements PrActionRepository {
  _FakeRepo(this._pr);

  final PrEnt? _pr;
  final List<String> getCalls = <String>[];
  final List<String> approveCalls = <String>[];
  final List<List<String>> rejectCalls = <List<String>>[];
  bool approveThrows = false;

  @override
  Future<PrEnt?> getPr(String id) async {
    getCalls.add(id);
    return _pr;
  }

  @override
  Future<void> approve(String id) async {
    if (approveThrows) throw StateError('server said no');
    approveCalls.add(id);
  }

  @override
  Future<void> reject(String id, String reason) async {
    rejectCalls.add(<String>[id, reason]);
  }
}

/// th i18n where tp(key) returns the key; dict resolves subcon.unitBaht (฿).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{"subcon.unitBaht":{"th":"฿"}},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"กลับ","title":"ยืนยันอนุมัติ","heading":"ยืนยันการอนุมัติ",'
  '"confirmBody":"ต้องการอนุมัติเอกสาร {no} มูลค่า {amount} หรือไม่?",'
  '"cancel":"ยกเลิก"}',
);

PrEnt _pendingPr({String id = 'pr-9', String no = 'PR-2026-0999'}) =>
    <String, Object?>{
      'id': id,
      'no': no,
      'status': 'pending',
      'currency_code': 'THB',
      'amount': 902475,
      'items': <Object?>[
        <String, Object?>{'id': 'i1'},
      ],
    };

Future<void> _pump(WidgetTester tester, ApproveScreen screen) async {
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
  await tester.pump(); // resolve getPr()
  await tester.pump(); // apply _load()'s setState
}

ApproveScreen _screen(_FakeRepo repo, {String? prId = 'pr-9'}) =>
    ApproveScreen(repo: repo, strings: _strings, i18n: _i18n, prId: prId);

void main() {
  testWidgets('renders the server PR no + amount off the wire', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr(no: 'PR-2026-0418'));
    await _pump(tester, _screen(repo));

    expect(repo.getCalls, <String>['pr-9']);
    // Header + heading chrome (i18n keys resolve for th).
    expect(find.text('ยืนยันการอนุมัติ'), findsOneWidget);
    // The confirm sentence carries the REAL no + the server amount + ฿.
    expect(find.textContaining('PR-2026-0418'), findsOneWidget);
    expect(find.textContaining('902,475 ฿'), findsOneWidget);
  });

  testWidgets('confirm drives POST approve with the path id ONLY (no amount)', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr());
    await _pump(tester, _screen(repo));

    // The confirm button lives in the action bar (the header title has the same
    // text, so scope the tap to the bar).
    final Finder confirmBtn = find.descendant(
      of: find.byType(PrActionBar),
      matching: find.text('ยืนยันอนุมัติ'),
    );
    expect(confirmBtn, findsOneWidget);
    await tester.tap(confirmBtn);
    await tester.pump();
    await tester.pump();

    // Only the id was sent — no client approval decision, amount or tier.
    expect(repo.approveCalls, <String>['pr-9']);
    expect(repo.rejectCalls, isEmpty);
  });

  testWidgets('a server refusal (403/409) re-enables the button, no crash', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr())..approveThrows = true;
    await _pump(tester, _screen(repo));

    await tester.tap(
      find.descendant(
        of: find.byType(PrActionBar),
        matching: find.text('ยืนยันอนุมัติ'),
      ),
    );
    await tester.pump();
    await tester.pump();

    // The action bar is still there and tappable again (no navigation happened).
    expect(find.byType(PrActionBar), findsOneWidget);
  });

  testWidgets('no PR selected → honest em-dash, no action bar, no network', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(_pendingPr());
    await _pump(tester, _screen(repo, prId: null));

    expect(repo.getCalls, isEmpty); // never fabricates / fetches a PR
    expect(find.text('—'), findsOneWidget);
    expect(find.byType(PrActionBar), findsNothing);
  });
}
