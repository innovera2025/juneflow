// Widget tests for the mobile quick-PR screen (route field-pr).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The assertions prove the honest behaviour: the real BOQ + line
// selection, the withheld estimate, the em-dashed urgency/photo slots, the dropped
// approval-chain claim, the CTA gate, the server-stated amount, and — the one that
// matters most here — the three DISTINCT outcomes of the two-step submission, in
// particular that a created-but-unsubmitted PR is never re-created by a retry.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/field_pr/field_pr_agg.dart';
import 'package:juneflow_mobile/screens/field_pr/field_pr_repository.dart';
import 'package:juneflow_mobile/screens/field_pr/field_pr_screen.dart';

/// A fake repo with canned reads and scripted create/submit outcomes.
class _FakeRepo implements FieldPrRepository {
  _FakeRepo({
    this.boqs = const <FieldPrEnt>[],
    this.items = const <FieldPrEnt>[],
    this.created,
    this.submitOk = true,
    this.readThrows = false,
  });

  final List<FieldPrEnt> boqs;
  final List<FieldPrEnt> items;

  /// The 201 body to return, or null to make the create fail.
  final FieldPrEnt? created;
  final bool submitOk;
  final bool readThrows;

  int creates = 0;
  int submits = 0;
  Map<String, Object?>? lastBody;
  String? lastSubmitId;

  @override
  Future<List<FieldPrEnt>> listBoqDocs() async {
    if (readThrows) throw Exception('offline');
    return boqs;
  }

  @override
  Future<List<FieldPrEnt>> listBoqItems(String boqId) async {
    if (readThrows) throw Exception('offline');
    return items;
  }

  @override
  Future<FieldPrCreateResult> createPr(Map<String, Object?> body) async {
    creates++;
    lastBody = body;
    return created;
  }

  @override
  Future<bool> submitPr(String prId) async {
    submits++;
    lastSubmitId = prId;
    return submitOk;
  }
}

FieldPrEnt _boq() => <String, Object?>{
  'id': 'b1',
  'no': 'BOQ-2026-B-02',
  'name': 'Block B structure',
  'project_id': 'proj1',
  'status': 'approved',
  'currency_code': 'THB',
  'total': 8200000,
};

FieldPrEnt _item() => <String, Object?>{
  'id': 'i1',
  'code': 'ST-016',
  'name': 'Rebar SD40 16mm',
  'unit': 'length',
  'qty': 500,
  'price': 683.33,
  'currency_code': 'THB',
  'remain_qty': 120,
};

FieldPrEnt _createdPr({String? id = 'pr1'}) => <String, Object?>{
  'id': id,
  'no': 'PR-2026-0777',
  'type': 'material',
  'project_id': 'proj1',
  'status': 'draft',
  'amount': 82000,
  'currency_code': 'THB',
};

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "gl.inbox.colDocNo": {"th":"เลขที่เอกสาร"},
    "inv.colQty": {"th":"จำนวน"},
    "common.submit": {"th":"ส่งอนุมัติ"},
    "labor.att.savedBadge": {"th":"บันทึกแล้ว"},
    "pr.form.draftSavedToast": {"th":"บันทึกร่างแล้ว"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "boq.edEmptyRowsFilter": {"th":"ไม่พบรายการที่ตรงกับตัวกรอง"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (mixed layers — see field_pr_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "ขอซื้อด่วน",
  "sub": "PR ด่วนจากหน้างาน",
  "fieldNo": "gl.inbox.colDocNo",
  "fieldBoq": "เลือกจาก BOQ",
  "fieldItems": "รายการที่ขอซื้อ",
  "fieldQty": "inv.colQty",
  "fieldUrgency": "ความเร่งด่วน",
  "fieldPhotos": "รูปประกอบ + เหตุผล",
  "submit": "common.submit",
  "submitted": "labor.att.savedBadge",
  "draftOnly": "pr.form.draftSavedToast",
  "failed": "admin.common.actionFailedToast",
  "empty": "boq.edEmptyRowsFilter"
}
''');

Future<void> _pump(WidgetTester tester, FieldPrRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FieldPrScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

List<String> _texts(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((Text t) => t.data ?? t.textSpan?.toPlainText() ?? '')
    .toList();

/// Fill the form to the point where the CTA is enabled.
Future<void> _fillForm(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField).first, 'PR-2026-0777');
  await tester.pumpAndSettle();
  await tester.tap(find.text('BOQ-2026-B-02'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Rebar SD40 16mm'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).last, '120');
  await tester.pumpAndSettle();
}

void main() {
  group('chrome + honest slots', () {
    testWidgets('the header is the prototype eyebrow + title', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(boqs: <FieldPrEnt>[_boq()]));
      expect(find.text('PR ด่วนจากหน้างาน'), findsOneWidget);
      expect(find.text('ขอซื้อด่วน'), findsOneWidget);
    });

    testWidgets('urgency and photos are em-dashed — no column backs them', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(boqs: <FieldPrEnt>[_boq()]));
      expect(find.text('ความเร่งด่วน'), findsOneWidget);
      expect(find.text('รูปประกอบ + เหตุผล'), findsOneWidget);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('the approval-chain claim is nowhere on the screen', (
      WidgetTester tester,
    ) async {
      // The prototype states a chain with a "limit >= 100K" threshold (L464-469).
      // The implemented tiers are 500,000 / 2,000,000 — rendering the prototype text
      // would tell the requester something false about their own document.
      await _pump(tester, _FakeRepo(boqs: <FieldPrEnt>[_boq()]));
      final String all = _texts(tester).join('|');
      for (final String claim in <String>['100K', 'Approval', 'จัดซื้อ']) {
        expect(all.contains(claim), isFalse, reason: claim);
      }
    });

    testWidgets('the BOQ line shows real columns and NO price estimate', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('BOQ-2026-B-02'));
      await tester.pumpAndSettle();
      expect(find.text('Rebar SD40 16mm'), findsOneWidget);
      expect(find.text('ST-016'), findsOneWidget);

      await tester.tap(find.text('Rebar SD40 16mm'));
      await tester.pumpAndSettle();
      expect(find.text('120 length'), findsOneWidget);
      // price=683.33 is on the wire and must not surface, nor any product of it.
      final String all = _texts(tester).join('|');
      for (final String money in <String>['683', '82000', '82,000', 'THB']) {
        expect(all.contains(money), isFalse, reason: money);
      }
    });
  });

  group('the CTA gate', () {
    testWidgets('an incomplete form cannot submit', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(repo.creates, 0);
    });

    testWidgets('a non-numeric quantity cannot submit', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(),
      );
      await _pump(tester, repo);
      await tester.enterText(find.byType(TextField).first, 'PR-1');
      await tester.pumpAndSettle();
      await tester.tap(find.text('BOQ-2026-B-02'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rebar SD40 16mm'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'abc');
      await tester.pumpAndSettle();
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(repo.creates, 0);
    });
  });

  group('the two-step submission', () {
    testWidgets('both steps landing shows SUBMITTED with the SERVER amount', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(),
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();

      expect(repo.creates, 1);
      expect(repo.submits, 1);
      expect(repo.lastSubmitId, 'pr1');
      // The body is the real payload — the requester's number, the BOQ's project,
      // the chosen line.
      expect(repo.lastBody?['no'], 'PR-2026-0777');
      expect(repo.lastBody?['project_id'], 'proj1');
      expect(repo.lastBody?['type'], 'material');
      // The ONLY money on this screen is the server's own figure off the 201 body.
      expect(find.text('บันทึกแล้ว · 82000 THB'), findsOneWidget);
    });

    testWidgets('a failed CREATE shows FAILED and creates nothing', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        // e.g. the 409 DUPLICATE_CODE a colliding number raises.
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();

      expect(repo.creates, 1);
      expect(repo.submits, 0);
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
      expect(find.textContaining('บันทึกแล้ว'), findsNothing);
    });

    testWidgets('a failed SUBMIT shows DRAFT-ONLY, not a plain failure', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(),
        submitOk: false,
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();

      expect(repo.creates, 1);
      expect(repo.submits, 1);
      // The PR EXISTS. Saying "failed" here would invite a second attempt which,
      // with no unique index on pr.no, would really create a duplicate.
      expect(find.text('บันทึกร่างแล้ว'), findsOneWidget);
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsNothing);
    });

    testWidgets('a retry after DRAFT-ONLY re-submits and never re-creates', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(),
        submitOk: false,
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(repo.creates, 1);

      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      // THE duplicate-PR guard: still ONE create, a second submit of the same id.
      expect(repo.creates, 1);
      expect(repo.submits, 2);
      expect(repo.lastSubmitId, 'pr1');
    });

    testWidgets('editing the form does NOT forget an existing draft PR', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(),
        submitOk: false,
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(find.text('บันทึกร่างแล้ว'), findsOneWidget);

      // Typing clears a resolved outcome on every OTHER state; forgetting a draft id
      // is exactly how a second PR gets created, so this one survives.
      await tester.enterText(find.byType(TextField).last, '130');
      await tester.pumpAndSettle();
      expect(find.text('บันทึกร่างแล้ว'), findsOneWidget);

      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(repo.creates, 1);
      expect(repo.submits, 2);
    });

    testWidgets('a 201 with no id is DRAFT-ONLY, never a success', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        boqs: <FieldPrEnt>[_boq()],
        items: <FieldPrEnt>[_item()],
        created: _createdPr(id: null),
      );
      await _pump(tester, repo);
      await _fillForm(tester);
      await tester.tap(find.text('ส่งอนุมัติ'));
      await tester.pumpAndSettle();
      expect(repo.submits, 0);
      expect(find.text('บันทึกร่างแล้ว'), findsOneWidget);
    });
  });

  group('honest nothing', () {
    testWidgets('an UNREADABLE BOQ list renders an em-dash', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(readThrows: true));
      expect(find.text('—'), findsOneWidget);
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsNothing);
    });

    testWidgets('a GENUINELY empty BOQ list renders the empty key', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsOneWidget);
    });
  });
}
