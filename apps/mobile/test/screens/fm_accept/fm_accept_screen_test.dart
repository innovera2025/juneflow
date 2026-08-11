// Widget tests for the mobile foreman acceptance queue (route fm-accept).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The assertions prove the honest behaviour: the real rows and their
// real columns, the withheld money / wait / description / attachment slots, the tab
// predicate, the actions offered ONLY where the endpoint would accept them, the
// re-read that proves a successful inspection, the honest failure, and the two
// different kinds of "nothing here" (unreadable vs genuinely empty).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/fm_accept/fm_accept_agg.dart';
import 'package:juneflow_mobile/screens/fm_accept/fm_accept_repository.dart';
import 'package:juneflow_mobile/screens/fm_accept/fm_accept_screen.dart';

/// A fake repo returning canned feeds and a scripted inspect outcome. Reads can be
/// scripted to throw (the offline / unreadable case) and to CHANGE after the first
/// call, so the post-action re-read can be observed.
class _FakeRepo implements FmAcceptRepository {
  _FakeRepo({
    this.periods = const <FmAcceptEnt>[],
    this.grs = const <FmAcceptEnt>[],
    this.periodsAfterAction,
    this.readThrows = false,
    this.outcome = FmInspectOutcome.ok,
  });

  final List<FmAcceptEnt> periods;
  final List<FmAcceptEnt> grs;
  final List<FmAcceptEnt>? periodsAfterAction;
  final bool readThrows;
  final FmInspectOutcome outcome;

  int periodReads = 0;
  int inspects = 0;
  String? lastPeriodId;

  @override
  Future<List<FmAcceptEnt>> listPeriodQueue() async {
    if (readThrows) throw Exception('offline');
    periodReads++;
    final List<FmAcceptEnt>? after = periodsAfterAction;
    return inspects > 0 && after != null ? after : periods;
  }

  @override
  Future<List<FmAcceptEnt>> listGrQueue() async {
    if (readThrows) throw Exception('offline');
    return grs;
  }

  @override
  Future<FmInspectOutcome> inspectPass({required String periodId}) async {
    inspects++;
    lastPeriodId = periodId;
    return outcome;
  }
}

FmAcceptEnt _period({
  String id = 'p1',
  String? title = 'SC-2026-001',
  Object? seq = 3,
  String status = 'delivered',
  String? projectName = 'Ratchaphruek',
  Object? defect,
}) => <String, Object?>{
  'id': id,
  'seq': seq,
  'amount': 645000,
  'currency_code': 'THB',
  'status': status,
  'project_name': projectName,
  'title': title,
  'defect': defect,
};

FmAcceptEnt _gr({String id = 'g1', String? no = 'GR-2026-0044'}) =>
    <String, Object?>{
      'id': id,
      'type': 'gr',
      'no': no,
      'received': 100,
      'rejected': 4,
      'status': 'posted',
      'project_name': 'Ratchaphruek',
      'title': no,
    };

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "accept.crumbSelf": {"th":"ศูนย์ตรวจรับ"},
    "common.all": {"th":"ทั้งหมด"},
    "accept.unitPhase": {"th":"งวด"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "boq.edEmptyRowsFilter": {"th":"ไม่พบรายการที่ตรงกับตัวกรอง"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (mixed layers — see fm_accept_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "centre": "accept.crumbSelf",
  "title": "รอตรวจรับ",
  "tabAll": "common.all",
  "tabWait": "รอตรวจ",
  "tabRejected": "ตีกลับ",
  "pillPeriod": "งวดงาน",
  "pillGr": "รับของ",
  "pillRejected": "ตีกลับ",
  "unitPeriod": "accept.unitPhase",
  "btnPass": "ตรวจรับผ่าน",
  "btnReject": "ตีกลับ",
  "failed": "admin.common.actionFailedToast",
  "empty": "boq.edEmptyRowsFilter"
}
''');

Future<void> _pump(WidgetTester tester, FmAcceptRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FmAcceptScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Every rendered string on screen.
List<String> _texts(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((Text t) => t.data ?? t.textSpan?.toPlainText() ?? '')
    .toList();

void main() {
  group('chrome + real columns', () {
    testWidgets('the header names the acceptance centre, not a mock site', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(periods: <FmAcceptEnt>[_period()]));
      expect(find.text('ศูนย์ตรวจรับ'), findsOneWidget);
      expect(find.text('รอตรวจรับ'), findsOneWidget);
      // The prototype's site name (L153) is mock and is dropped.
      expect(find.textContaining('ไซต์'), findsNothing);
    });

    testWidgets('a period card shows the REAL doc number + ordinal', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(periods: <FmAcceptEnt>[_period()]));
      // The server refuses to compose the ordinal, so the client does — around the
      // real seq and the real dict word.
      expect(find.text('SC-2026-001 · งวด 3'), findsOneWidget);
      expect(find.text('Ratchaphruek · — · 📎 —'), findsOneWidget);
    });

    testWidgets('the money slot is an em-dash, never the wire amount', (
      WidgetTester tester,
    ) async {
      // The row carries amount=645000 + currency THB. It is still withheld: for 3 of
      // the 4 bases that column is not the payable, and the payable is computed by
      // approve-payment — a different action this screen must not imply it performs.
      await _pump(tester, _FakeRepo(periods: <FmAcceptEnt>[_period()]));
      final String all = _texts(tester).join('|');
      expect(all.contains('645000'), isFalse);
      expect(all.contains('645,000'), isFalse);
      expect(all.contains('THB'), isFalse);
    });

    testWidgets('a rejected period shows its REAL defect items', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          periods: <FmAcceptEnt>[
            _period(status: 'rejected', defect: <Object?>['crack on B-3']),
          ],
        ),
      );
      expect(find.text('⚠ crack on B-3'), findsOneWidget);
      expect(find.text('ตีกลับ'), findsWidgets); // the rejected pill
    });

    testWidgets('a gr row renders with the receipt pill', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FmAcceptEnt>[_gr()]));
      expect(find.text('GR-2026-0044'), findsOneWidget);
      expect(find.text('รับของ'), findsOneWidget);
    });
  });

  group('tabs', () {
    testWidgets('the counts are the real row counts', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          periods: <FmAcceptEnt>[
            _period(id: 'a', title: 'A'),
            _period(id: 'b', title: 'B', status: 'rejected'),
          ],
          grs: <FmAcceptEnt>[_gr()],
        ),
      );
      expect(find.text('ทั้งหมด (3)'), findsOneWidget);
      // The gr row counts as rejected because rejected>0 is why the server put it in
      // the feed at all.
      expect(find.text('⚠ ตีกลับ (2)'), findsOneWidget);
    });

    testWidgets('the wait tab hides the rejected rows', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          periods: <FmAcceptEnt>[
            _period(id: 'a', title: 'A'),
            _period(id: 'b', title: 'B', status: 'rejected'),
          ],
        ),
      );
      await tester.tap(find.text('รอตรวจ'));
      await tester.pumpAndSettle();
      expect(find.textContaining('A · งวด'), findsOneWidget);
      expect(find.textContaining('B · งวด'), findsNothing);
    });
  });

  group('the actions', () {
    testWidgets('a delivered period offers PASS live and REJECT disabled', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(periods: <FmAcceptEnt>[_period()]));
      expect(find.text('ตรวจรับผ่าน'), findsOneWidget);
      // Still rendered (the prototype's two-button row), but inert — see the
      // two tests below.
      expect(find.text('ตีกลับ'), findsOneWidget);
    });

    testWidgets('a REJECTED period offers none — the endpoint would 409', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(periods: <FmAcceptEnt>[_period(status: 'rejected')]),
      );
      expect(find.text('ตรวจรับผ่าน'), findsNothing);
    });

    testWidgets('a GOODS RECEIPT offers none — no endpoint inspects one', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FmAcceptEnt>[_gr()]));
      expect(find.text('ตรวจรับผ่าน'), findsNothing);
      // The prototype DOES render them there; this port withholds them.
      expect(find.text('รับของ'), findsOneWidget);
    });

    testWidgets('a pass posts the real result and RE-READS the queue', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        periods: <FmAcceptEnt>[_period()],
        // After a pass the period leaves the acceptance queue entirely.
        periodsAfterAction: const <FmAcceptEnt>[],
      );
      await _pump(tester, repo);
      expect(repo.periodReads, 1);

      await tester.tap(find.text('ตรวจรับผ่าน'));
      await tester.pumpAndSettle();

      expect(repo.inspects, 1);
      expect(repo.lastPeriodId, 'p1');
      // The proof of success is the SERVER's answer, not a local flag: the row is
      // gone because the re-read says so.
      expect(repo.periodReads, 2);
      expect(find.text('SC-2026-001 · งวด 3'), findsNothing);
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsOneWidget);
    });

    testWidgets(
      'the REJECT button is inert — tapping it sends NOTHING (B-297 item 1)',
      (WidgetTester tester) async {
        // The one-tap reject is withheld: `rejected` is a TERMINAL work-period
        // state (no door in subcon.ts leaves it) and this screen has no defect
        // form, so the reject it could send would carry an EMPTY Defect List —
        // one tap would permanently fail a subcontractor's period with no record
        // of why. The button keeps the prototype's two-button shape, disabled.
        final _FakeRepo repo = _FakeRepo(periods: <FmAcceptEnt>[_period()]);
        await _pump(tester, repo);

        // It is rendered — the affordance names where rejecting will live.
        expect(find.text('ตีกลับ'), findsOneWidget);

        await tester.tap(find.text('ตีกลับ'));
        await tester.pumpAndSettle();

        // No request, and no re-read triggered by one.
        expect(repo.inspects, 0);
        expect(repo.lastPeriodId, isNull);
        expect(repo.periodReads, 1);
        // The row is untouched — no failure line, no state change.
        expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsNothing);
        expect(find.text('SC-2026-001 · งวด 3'), findsOneWidget);
      },
    );

    testWidgets('the reject button carries NO tap handler at all', (
      WidgetTester tester,
    ) async {
      // Stronger than "the tap did nothing": there is no GestureDetector around
      // it, so no future wiring can make it fire by accident.
      await _pump(tester, _FakeRepo(periods: <FmAcceptEnt>[_period()]));
      final Finder rejectLabel = find.text('ตีกลับ');
      expect(
        find.ancestor(of: rejectLabel, matching: find.byType(GestureDetector)),
        findsNothing,
      );
      // The PASS button, by contrast, has one.
      expect(
        find.ancestor(
          of: find.text('ตรวจรับผ่าน'),
          matching: find.byType(GestureDetector),
        ),
        findsWidgets,
      );
    });

    testWidgets('a failed inspect is shown as a failure, never as done', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        periods: <FmAcceptEnt>[_period()],
        outcome: FmInspectOutcome.failed,
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ตรวจรับผ่าน'));
      await tester.pumpAndSettle();
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
      // Nothing anywhere claims the result reached the system (the prototype's own
      // done banner, L173, which this port dropped).
      expect(find.textContaining('ตรวจแล้ว'), findsNothing);
    });
  });

  group('honest nothing', () {
    testWidgets('an UNREADABLE queue renders an em-dash, not an empty state', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(readThrows: true));
      expect(find.text('—'), findsOneWidget);
      // "no rows match" would tell the foreman there is nothing to inspect; we do
      // not know that.
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsNothing);
    });

    testWidgets('a GENUINELY empty queue renders the empty-state key', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsOneWidget);
      expect(find.text('ทั้งหมด (0)'), findsOneWidget);
    });
  });
}
