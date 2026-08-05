// Widget tests for the mobile work-period delivery screen (route field-progress).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The assertions prove the honest behaviour: the contract picker and its
// real vendor join, the period's REAL status where the prototype shows a percentage
// (and the em-dash where the number was), the deliver action offered ONLY on a
// pending period, the online-sent / offline-queued / permanently-failed states (never
// a fake success), the retry reusing the SAME op id, and the two different kinds of
// "nothing here".
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_agg.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_repository.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_screen.dart';

/// A fake repo with canned reads and a scripted drain outcome. When [outcome] is null
/// the drain "touched nothing" (an offline no-response).
class _FakeRepo implements FieldProgressRepository {
  _FakeRepo({
    this.contracts = const <FieldProgressEnt>[],
    this.vendors = const <FieldProgressEnt>[],
    this.periods = const <FieldProgressEnt>[],
    this.periodsAfterDeliver,
    this.outcome,
    this.readThrows = false,
  });

  final List<FieldProgressEnt> contracts;
  final List<FieldProgressEnt> vendors;
  final List<FieldProgressEnt> periods;
  final List<FieldProgressEnt>? periodsAfterDeliver;
  final SyncOutcome? outcome;
  final bool readThrows;

  String? lastOpId;
  String? lastPeriodId;
  int delivers = 0;
  int drains = 0;
  int periodReads = 0;

  @override
  Future<List<FieldProgressEnt>> listContracts() async {
    if (readThrows) throw Exception('offline');
    return contracts;
  }

  @override
  Future<List<FieldProgressEnt>> listVendors() async {
    if (readThrows) throw Exception('offline');
    return vendors;
  }

  @override
  Future<List<FieldProgressEnt>> listPeriods(String contractId) async {
    if (readThrows) throw Exception('offline');
    periodReads++;
    final List<FieldProgressEnt>? after = periodsAfterDeliver;
    return delivers > 0 && after != null ? after : periods;
  }

  @override
  Future<DrainReport> deliver({
    required String periodId,
    required String opId,
    required DateTime now,
  }) async {
    delivers++;
    lastOpId = opId;
    lastPeriodId = periodId;
    return _report(opId);
  }

  @override
  Future<DrainReport> drain() async {
    drains++;
    final String? id = lastOpId;
    return id == null ? const DrainReport(<SyncAttempt>[]) : _report(id);
  }

  DrainReport _report(String opId) {
    final SyncOutcome? o = outcome;
    if (o == null) return const DrainReport(<SyncAttempt>[]);
    return DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: o)]);
  }

  @override
  Future<List<SyncOperation>> due() async => const <SyncOperation>[];
}

FieldProgressEnt _contract({String id = 'c1', String? no = 'SC-2026-001'}) =>
    <String, Object?>{
      'id': id,
      'no': no,
      'vendor_id': 'v1',
      'project_id': 'proj1',
      'value': 5000000,
      'currency_code': 'THB',
    };

FieldProgressEnt _period({
  String id = 'p1',
  Object? seq = 3,
  String status = 'pending',
}) => <String, Object?>{
  'id': id,
  'contract_id': 'c1',
  'seq': seq,
  'pct': 78,
  'amount': 645000,
  'currency_code': 'THB',
  'status': status,
  'project_name': 'Ratchaphruek',
  'title': 'SC-2026-001',
};

const List<FieldProgressEnt> _vendors = <FieldProgressEnt>[
  <String, Object?>{'id': 'v1', 'name': 'Rungruang Construction'},
];

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "subcon.subcontractor": {"th":"ผู้รับเหมา"},
    "subcon.colProgressLong": {"th":"ความคืบหน้า"},
    "accept.unitPhase": {"th":"งวด"},
    "common.status": {"th":"สถานะ"},
    "subcon.statusNotReached": {"th":"ยังไม่ถึง"},
    "subcon.statusRequested": {"th":"ขอตรวจรับ"},
    "subcon.kpiAccepted": {"th":"ตรวจรับแล้ว"},
    "subcon.rejectBtn": {"th":"ตีกลับแก้ไข"},
    "wo.form.deliverWork": {"th":"ส่งมอบงาน"},
    "labor.att.savedBadge": {"th":"บันทึกแล้ว"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "boq.edEmptyRowsFilter": {"th":"ไม่พบรายการที่ตรงกับตัวกรอง"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (mixed layers — see field_progress_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "บันทึกความคืบหน้า",
  "labelSubcon": "subcon.subcontractor",
  "labelWork": "งาน",
  "progressTitle": "subcon.colProgressLong",
  "unitPeriod": "accept.unitPhase",
  "statusLabel": "common.status",
  "statusNotReached": "subcon.statusNotReached",
  "statusRequested": "subcon.statusRequested",
  "statusAccepted": "subcon.kpiAccepted",
  "statusRejected": "subcon.rejectBtn",
  "deliver": "wo.form.deliverWork",
  "sent": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "empty": "boq.edEmptyRowsFilter"
}
''');

Future<void> _pump(
  WidgetTester tester,
  FieldProgressRepository repo, {
  String? contractId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FieldProgressScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          contractId: contractId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

List<String> _texts(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((Text t) => t.data ?? t.textSpan?.toPlainText() ?? '')
    .toList();

void main() {
  group('subject resolution', () {
    testWidgets('with no contract id the REAL contracts are listed', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
        ),
      );
      expect(find.text('SC-2026-001'), findsOneWidget);
      expect(find.text('ผู้รับเหมา: Rungruang Construction'), findsOneWidget);
      // Nothing is pre-selected on the foreman's behalf.
      expect(find.text('ส่งมอบงาน'), findsNothing);
    });

    testWidgets('tapping a contract loads ITS periods', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        contracts: <FieldProgressEnt>[_contract()],
        vendors: _vendors,
        periods: <FieldProgressEnt>[_period()],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('SC-2026-001'));
      await tester.pumpAndSettle();
      expect(repo.periodReads, 1);
      expect(find.text('ความคืบหน้า งวด 3'), findsOneWidget);
    });

    testWidgets('a pushed contract id skips the picker', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[_period()],
        ),
        contractId: 'c1',
      );
      expect(find.text('ความคืบหน้า งวด 3'), findsOneWidget);
      expect(find.text('ส่งมอบงาน'), findsOneWidget);
    });
  });

  group('the percentage is withheld', () {
    testWidgets('the REAL status renders and the percentage is an em-dash', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[_period()],
        ),
        contractId: 'c1',
      );
      // The Thai LABEL for the wire's `pending`, never the English enum itself.
      expect(find.text('สถานะ: ยังไม่ถึง'), findsOneWidget);
      final String all = _texts(tester).join('|');
      // The row carries pct=78. It must not surface as progress anywhere.
      expect(all.contains('78'), isFalse);
      expect(all.contains('%'), isFalse);
      expect(find.text('—'), findsWidgets);
    });

    // The status is this screen's load-bearing value — it stands where the
    // prototype puts a percentage. Rendering the wire column verbatim would put
    // `pending` / `delivered` in front of a Thai-speaking foreman (§0 rule 2).
    // One test per status: each pumps its own tree, so the row is really built and
    // the assertion cannot be weakened by a reused State or a lazy list.
    const Map<String, String> statusLabels = <String, String>{
      'pending': 'สถานะ: ยังไม่ถึง',
      'delivered': 'สถานะ: ขอตรวจรับ',
      'inspecting': 'สถานะ: ขอตรวจรับ',
      'passed': 'สถานะ: ตรวจรับแล้ว',
      'paid': 'สถานะ: ตรวจรับแล้ว',
      'rejected': 'สถานะ: ตีกลับแก้ไข',
    };
    for (final MapEntry<String, String> e in statusLabels.entries) {
      testWidgets(
        'the wire status "${e.key}" renders its Thai label, not itself',
        (WidgetTester tester) async {
          await _pump(
            tester,
            _FakeRepo(
              contracts: <FieldProgressEnt>[_contract()],
              vendors: _vendors,
              periods: <FieldProgressEnt>[_period(status: e.key)],
            ),
            contractId: 'c1',
          );
          final String all = _texts(tester).join('|');
          expect(
            all.contains(e.key),
            isFalse,
            reason: 'raw wire enum ${e.key}',
          );
          expect(find.text(e.value), findsOneWidget, reason: e.key);
        },
      );
    }

    testWidgets('an UNKNOWN status renders an em-dash, never a guessed label', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[_period(status: 'archived')],
        ),
        contractId: 'c1',
      );
      final String all = _texts(tester).join('|');
      expect(all.contains('archived'), isFalse);
      // Not folded into "ยังไม่ถึง" (which the web's default: would do) — that is
      // a claim about the period this build has no evidence for.
      expect(find.text('สถานะ: ยังไม่ถึง'), findsNothing);
      expect(find.text('สถานะ: —'), findsOneWidget);
    });

    testWidgets('a mix of delivered periods produces no ratio anywhere', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[
            _period(id: 'a', seq: 1, status: 'delivered'),
            _period(id: 'b', seq: 2, status: 'delivered'),
            _period(id: 'c', seq: 3, status: 'delivered'),
            _period(id: 'd', seq: 4),
          ],
        ),
        contractId: 'c1',
      );
      final String all = _texts(tester).join('|');
      for (final String forbidden in <String>['%', '75', '3/4', '0.75']) {
        expect(all.contains(forbidden), isFalse, reason: forbidden);
      }
    });

    testWidgets('no money reaches the screen', (WidgetTester tester) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[_period()],
        ),
        contractId: 'c1',
      );
      final String all = _texts(tester).join('|');
      for (final String forbidden in <String>[
        '645000',
        '645,000',
        'THB',
        '5000000',
      ]) {
        expect(all.contains(forbidden), isFalse, reason: forbidden);
      }
    });
  });

  group('the deliver action', () {
    testWidgets('only a PENDING period offers it', (WidgetTester tester) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[
            _period(id: 'a', seq: 1, status: 'delivered'),
            _period(id: 'b', seq: 2),
          ],
        ),
        contractId: 'c1',
      );
      expect(find.text('ส่งมอบงาน'), findsOneWidget);
    });

    testWidgets('a durable success shows SENT and re-reads the periods', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        contracts: <FieldProgressEnt>[_contract()],
        vendors: _vendors,
        periods: <FieldProgressEnt>[_period()],
        periodsAfterDeliver: <FieldProgressEnt>[_period(status: 'delivered')],
        outcome: SyncOutcome.synced,
      );
      await _pump(tester, repo, contractId: 'c1');
      await tester.tap(find.text('ส่งมอบงาน'));
      await tester.pumpAndSettle();

      expect(repo.delivers, 1);
      expect(repo.lastPeriodId, 'p1');
      expect(find.text('บันทึกแล้ว'), findsOneWidget);
      // The server moved the period, so the re-read shows its new status and the
      // action is no longer offered.
      expect(find.text('สถานะ: ขอตรวจรับ'), findsOneWidget);
      expect(find.text('ส่งมอบงาน'), findsNothing);
    });

    testWidgets('a deferred drain shows QUEUED, never a success', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        contracts: <FieldProgressEnt>[_contract()],
        vendors: _vendors,
        periods: <FieldProgressEnt>[_period()],
        outcome: SyncOutcome.deferred,
      );
      await _pump(tester, repo, contractId: 'c1');
      await tester.tap(find.text('ส่งมอบงาน'));
      await tester.pumpAndSettle();
      expect(find.text('รอส่ง'), findsOneWidget);
      expect(find.text('บันทึกแล้ว'), findsNothing);
    });

    testWidgets('a permanent failure shows FAILED', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        contracts: <FieldProgressEnt>[_contract()],
        vendors: _vendors,
        periods: <FieldProgressEnt>[_period()],
        outcome: SyncOutcome.permanentlyFailed,
      );
      await _pump(tester, repo, contractId: 'c1');
      await tester.tap(find.text('ส่งมอบงาน'));
      await tester.pumpAndSettle();
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
    });

    testWidgets('a retry re-drains the SAME op — it never enqueues twice', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        contracts: <FieldProgressEnt>[_contract()],
        vendors: _vendors,
        periods: <FieldProgressEnt>[_period()],
        outcome: SyncOutcome.deferred,
      );
      await _pump(tester, repo, contractId: 'c1');
      await tester.tap(find.text('ส่งมอบงาน'));
      await tester.pumpAndSettle();
      final String? first = repo.lastOpId;
      expect(repo.delivers, 1);

      await tester.tap(find.text('ส่งมอบงาน'));
      await tester.pumpAndSettle();
      // Still ONE enqueue; the second tap re-drained the same client key.
      expect(repo.delivers, 1);
      expect(repo.lastOpId, first);
    });
  });

  group('honest nothing', () {
    testWidgets('an UNREADABLE list renders an em-dash, not an empty state', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(readThrows: true));
      // Two em-dashes, both honest and both load-bearing: the header eyebrow (no
      // contract resolved → no document number to print) and the body (the list is
      // UNKNOWN, not known-empty).
      expect(find.text('—'), findsNWidgets(2));
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsNothing);
    });

    testWidgets('a GENUINELY empty contract list renders the empty key', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('ไม่พบรายการที่ตรงกับตัวกรอง'), findsOneWidget);
    });

    testWidgets('the work line is an em-dash — no column backs it', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          contracts: <FieldProgressEnt>[_contract()],
          vendors: _vendors,
          periods: <FieldProgressEnt>[_period()],
        ),
        contractId: 'c1',
      );
      expect(find.text('งาน: —'), findsOneWidget);
    });
  });
}
