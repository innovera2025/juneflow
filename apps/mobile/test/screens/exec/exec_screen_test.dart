// Widget tests for the mobile executive dashboard (route exec).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repository + inline i18n/strings, so
// nothing touches the network. The assertions prove the real behaviours — the
// REAL approvals rows and count, the S-curve's honest empty state, and above all
// that no fabricated figure reaches the glass.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_agg.dart';
import 'package:juneflow_mobile/screens/exec/exec_agg.dart';
import 'package:juneflow_mobile/screens/exec/exec_repository.dart';
import 'package:juneflow_mobile/screens/exec/exec_screen.dart';

/// In-memory repo over fixed opaque wire payloads.
class _FakeRepo implements ExecRepository {
  _FakeRepo({
    this.summaryBody,
    this.series = const <ExecEnt>[],
    this.rows = const <InboxEnt>[],
    this.summaryThrows = false,
  });

  final ExecEnt? summaryBody;
  final List<ExecEnt> series;
  final List<InboxEnt> rows;
  final bool summaryThrows;

  /// What the EVM read was actually scoped to (the assertion for the summary hop).
  String? askedProjectId;
  int evmCalls = 0;

  @override
  Future<ExecEnt?> summary() async {
    if (summaryThrows) throw StateError('offline');
    return summaryBody;
  }

  @override
  Future<List<ExecEnt>> evmSeries(String? projectId) async {
    askedProjectId = projectId;
    evmCalls++;
    return series;
  }

  @override
  Future<List<InboxEnt>> approvals() async => rows;
}

/// A repo whose approvals read fails, to prove a failed load is UNKNOWN.
class _BrokenRepo implements ExecRepository {
  @override
  Future<ExecEnt?> summary() async => null;
  @override
  Future<List<ExecEnt>> evmSeries(String? projectId) async => const <ExecEnt>[];
  @override
  Future<List<InboxEnt>> approvals() async => throw StateError('boom');
}

/// th i18n carrying the real dict labels this screen resolves with t().
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"sales.dashboard.kpiSalesCumulative":{"th":"ยอดขายสะสม"},'
  '"pm.unitJobs":{"th":"งาน"},'
  '"subcon.unitBaht":{"th":"฿"},'
  '"sales.common.today":{"th":"วันนี้"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real sidecar shape (dict ids + phrase-as-key slots).
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"title":"Dashboard",'
  '"heroLabel":"sales.dashboard.kpiSalesCumulative",'
  '"heroUnits":"ยูนิตขายแล้ว",'
  '"kpiCash":"กระแสเงินสด 7 วัน","kpiPending":"เอกสารรออนุมัติ",'
  '"kpiDue":"Project ใกล้กำหนด","kpiSalesMonth":"ขายเดือนนี้",'
  '"unitMBaht":"M ฿","unitDocs":"ฉบับ","unitJobs":"pm.unitJobs",'
  '"unitBaht":"subcon.unitBaht","scurveTitle":"S-Curve ความคืบหน้า",'
  '"legendPlan":"แผน","legendActual":"จริง","today":"sales.common.today",'
  '"approvalsTitle":"รออนุมัติของฉัน"}',
);

final DateTime _may2026 = DateTime.utc(2026, 5, 15);

Future<void> _pump(WidgetTester tester, ExecRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ExecScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          now: _may2026,
        ),
      ),
    ),
  );
  await tester.pump(); // resolve the fake futures
  await tester.pump();
}

Map<String, Object?> _evmRow(String period, num pv, num ev) =>
    <String, Object?>{'period_label': period, 'pv': pv, 'ev': ev};

void main() {
  testWidgets('renders the header and all four prototype blocks', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());
    expect(find.text('Dashboard'), findsOneWidget);
    expect(find.text('ยอดขายสะสม'), findsOneWidget); // hero label
    expect(find.text('กระแสเงินสด 7 วัน'), findsOneWidget); // tile 1
    expect(find.text('เอกสารรออนุมัติ'), findsOneWidget); // tile 2
    expect(find.text('Project ใกล้กำหนด'), findsOneWidget); // tile 3
    expect(find.text('ขายเดือนนี้'), findsOneWidget); // tile 4
    expect(find.text('S-Curve ความคืบหน้า'), findsOneWidget);
    expect(find.textContaining('รออนุมัติของฉัน'), findsOneWidget);
  });

  testWidgets('the header eyebrow is OMITTED — no user-profile wire', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo());
    // The prototype's eyebrow is a person's name (L650). Nothing may stand in
    // for it — not a fabricated name, and not the tenant/project name either.
    expect(find.text('ผอ.สมพร เพชรชัย'), findsNothing);
  });

  testWidgets('the EVM read is SCOPED to the summary project id', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      summaryBody: <String, Object?>{'project_id': 'proj-1'},
    );
    await _pump(tester, repo);
    // An unscoped read would merge every owned project's snapshots into one
    // curve (evm-series.ts loadEvmSeries), so this hop is load-bearing.
    expect(repo.askedProjectId, 'proj-1');
  });

  testWidgets('a failed summary degrades to the unscoped series, not a blank '
      'screen', (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(
      summaryThrows: true,
      rows: <InboxEnt>[
        <String, Object?>{'id': 'a', 'kind': 'PR', 'doc_no': 'PR-1'},
      ],
    );
    await _pump(tester, repo);
    expect(repo.evmCalls, 1);
    expect(repo.askedProjectId, isNull);
    expect(find.text('PR-1'), findsOneWidget);
  });

  group('the approvals card', () {
    testWidgets('shows the REAL count and the REAL server rows', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          rows: <InboxEnt>[
            <String, Object?>{
              'id': 'a',
              'kind': 'PR',
              'doc_no': 'PR-2026-0418',
              'amount': 902475,
              'currency_code': 'THB',
            },
            <String, Object?>{
              'id': 'b',
              'kind': 'WO',
              'doc_no': 'WO-2026-0117',
              'amount': 645000,
              'currency_code': 'THB',
            },
          ],
        ),
      );
      // "รออนุมัติของฉัน · 2 ฉบับ" — the count is the real row count.
      expect(find.text('รออนุมัติของฉัน · 2 ฉบับ'), findsOneWidget);
      expect(find.text('PR'), findsOneWidget);
      expect(find.text('WO'), findsOneWidget);
      expect(find.text('PR-2026-0418'), findsOneWidget);
      // SERVER amount, formatted not computed.
      expect(find.text('902,475 ฿'), findsOneWidget);
      expect(find.text('645,000 ฿'), findsOneWidget);
    });

    testWidgets('a null doc_no / amount em-dashes rather than inventing', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          rows: <InboxEnt>[
            <String, Object?>{
              'id': 'a',
              'kind': 'PO',
              'doc_no': null,
              'amount': null,
            },
          ],
        ),
      );
      expect(find.text('PO'), findsOneWidget);
      // Both nullable-but-real columns render the dash; no "0" and no "-".
      expect(find.text('0'), findsNothing);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('NO approve button — this screen performs no approval', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          rows: <InboxEnt>[
            <String, Object?>{'id': 'a', 'kind': 'PR', 'doc_no': 'PR-1'},
          ],
        ),
      );
      // The prototype puts a green one-tap "อนุมัติ" on every row (L708). The
      // tier logic lives on the merged approve/reject sheets, not here, so the
      // button is dropped rather than shipped inert (B-299).
      expect(find.text('อนุมัติ'), findsNothing);
    });

    testWidgets('no rows renders honest-empty with a real zero count', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('รออนุมัติของฉัน · 0 ฉบับ'), findsOneWidget);
    });
  });

  group('the S-curve', () {
    testWidgets('an empty series renders the empty state, never a flat zero '
        'line', (WidgetTester tester) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('S-Curve ความคืบหน้า'), findsOneWidget);
      // No axis labels at all when there is nothing to plot.
      expect(find.text('2026-01'), findsNothing);
    });

    testWidgets('the axis ends are the SERVER period labels, verbatim', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          series: <ExecEnt>[
            _evmRow('2026-01', 0, 0),
            _evmRow('2026-09', 80, 70),
          ],
        ),
      );
      // Rendered as the wire's own 'YYYY-MM' key — not translated into Thai
      // month abbreviations, which would be new copy over an invented mapping.
      expect(find.text('2026-01'), findsOneWidget);
      expect(find.text('2026-09'), findsOneWidget);
      expect(find.text('ม.ค.'), findsNothing);
    });

    testWidgets('the today marker shows only when today is in range', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          series: <ExecEnt>[
            _evmRow('2026-01', 0, 0),
            _evmRow('2026-09', 80, 70),
          ],
        ),
      );
      expect(find.text('↑วันนี้'), findsOneWidget);
    });

    testWidgets('the today marker is absent when today is outside the range', (
      WidgetTester tester,
    ) async {
      // A separate test, not a second pump into the same tree: the screen loads
      // ONCE (its future is late-final), so re-pumping would reuse the existing
      // State and the assertion would silently prove nothing.
      await _pump(
        tester,
        _FakeRepo(
          series: <ExecEnt>[_evmRow('2020-01', 0, 0), _evmRow('2020-03', 8, 7)],
        ),
      );
      expect(find.text('↑วันนี้'), findsNothing);
      // The chart itself still renders — only the marker is withheld.
      expect(find.text('2020-01'), findsOneWidget);
    });

    testWidgets('the legend percentages are em-dashed — BAC is not served', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          series: <ExecEnt>[
            _evmRow('2026-01', 0, 0),
            _evmRow('2026-05', 65, 62),
          ],
        ),
      );
      expect(find.text('แผน —'), findsOneWidget);
      expect(find.text('จริง —'), findsOneWidget);
      // The mock's own numbers must never reappear, and no percentage may be
      // derived from the series (percent-complete needs BAC, which the /evm
      // response body omits).
      expect(find.textContaining('65%'), findsNothing);
      expect(find.textContaining('62%'), findsNothing);
    });
  });

  group('nothing fabricated reaches the glass', () {
    testWidgets('every mock hero/KPI number is absent', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          summaryBody: <String, Object?>{
            'project_id': 'p',
            // A rich budget payload: NONE of it may be relabelled as sales.
            'budget_total': 284500000,
            'actual_total': 54200000,
            'committed_total': 18400000,
            'remaining_total': 3,
            'health_score': 71,
            'currency_code': 'THB',
          },
          rows: <InboxEnt>[
            <String, Object?>{'id': 'a', 'kind': 'PR'},
          ],
        ),
      );
      for (final String mock in <String>[
        '284.5',
        '148/240',
        '+12% YoY ↑',
        '-18.4',
        '54.2',
        '17',
      ]) {
        expect(
          find.textContaining(mock),
          findsNothing,
          reason: 'the mock literal "$mock" reached the screen',
        );
      }
      // And no summary budget figure was smuggled into a sales slot.
      expect(find.textContaining('284,500,000'), findsNothing);
      expect(find.textContaining('71'), findsNothing);
    });

    testWidgets('a failed load renders UNKNOWN, not a zeroed dashboard', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _BrokenRepo());
      // A zeroed dashboard would read as "nothing pending, no progress" — both
      // of which are claims. The dash says "not known".
      expect(find.text('—'), findsOneWidget);
      expect(find.textContaining('รออนุมัติของฉัน'), findsNothing);
    });
  });
}
