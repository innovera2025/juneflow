// Unit tests for the executive dashboard's pure layer (route exec).
//
// The S-curve is the risky part of this screen: a chart interpolates by nature,
// so the exact boundary between "drawn from a real point" and "drawn by the
// renderer" has to be pinned, not assumed. These tests hold that line —
// especially that a MISSING period leaves a real gap and is never zero-filled,
// and that nothing monetary is derived from anything.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_agg.dart';
import 'package:juneflow_mobile/screens/exec/exec_agg.dart';

/// A wire EVM row as `GET /boq/reports/evm` serves it.
Map<String, Object?> _row(String period, num pv, num ev) => <String, Object?>{
  'period_label': period,
  'pv': pv,
  'ev': ev,
  'ac': 0,
};

/// A fixed clock so the "today" marker is never ambient.
final DateTime _may2026 = DateTime.utc(2026, 5, 15);

void main() {
  group('parseSummaryProjectId', () {
    test('reads the project id that scopes the EVM series', () {
      expect(
        parseSummaryProjectId(<String, Object?>{'project_id': 'p1'}),
        'p1',
      );
      expect(parseSummaryProjectId(<String, Object?>{'projectId': 'p2'}), 'p2');
    });

    test('a tenant with no project yields null, never a fabricated id', () {
      // dashboard.ts summary returns project_id: null for a tenant with no
      // projects — the caller must fall back, not invent a scope.
      expect(
        parseSummaryProjectId(<String, Object?>{'project_id': null}),
        null,
      );
      expect(parseSummaryProjectId(<String, Object?>{}), null);
      expect(parseSummaryProjectId(null), null);
    });
  });

  group('monthOrdinal', () {
    test('parses a YYYY-MM period into a month count', () {
      expect(monthOrdinal('2026-01'), 2026 * 12 + 0);
      expect(monthOrdinal('2026-12'), 2026 * 12 + 11);
      // Consecutive months differ by exactly 1, across a year boundary.
      expect(monthOrdinal('2027-01')! - monthOrdinal('2026-12')!, 1);
    });

    test('refuses anything that is not a real YYYY-MM month', () {
      for (final String bad in <String>[
        '',
        '2026',
        '2026-1',
        '2026/01',
        '2026-00', // month 0 does not exist
        '2026-13', // nor 13
        'abcd-ef',
        '2026-01-01',
      ]) {
        expect(monthOrdinal(bad), isNull, reason: 'accepted "$bad"');
      }
    });
  });

  group('parseEvmSeries', () {
    test('reads pv/ev verbatim, preserving server order', () {
      final List<EvmPoint> pts = parseEvmSeries(<Object?>[
        _row('2026-01', 100, 90),
        _row('2026-02', 250.5, 210.25),
      ]);
      expect(pts.length, 2);
      expect(pts[0].period, '2026-01');
      expect(pts[0].pv, 100);
      expect(pts[0].ev, 90);
      // Verbatim: no rounding, no scaling, no accumulation of the previous row.
      expect(pts[1].pv, 250.5);
      expect(pts[1].ev, 210.25);
    });

    test('numeric strings are accepted (drizzle numerics arrive as text)', () {
      final List<EvmPoint> pts = parseEvmSeries(<Object?>[
        <String, Object?>{'period_label': '2026-03', 'pv': '10.5', 'ev': '7'},
      ]);
      expect(pts.single.pv, 10.5);
      expect(pts.single.ev, 7);
    });

    test('drops a row that cannot be plotted honestly — never defaults it', () {
      final List<EvmPoint> pts = parseEvmSeries(<Object?>[
        _row('2026-01', 100, 90), // good
        <String, Object?>{'pv': 1, 'ev': 1}, // no period at all
        _row('not-a-month', 5, 5), // unplaceable on a time axis
        <String, Object?>{'period_label': '2026-04', 'ev': 3}, // pv missing
        <String, Object?>{'period_label': '2026-05', 'pv': 3}, // ev missing
        <String, Object?>{
          'period_label': '2026-06',
          'pv': double.nan,
          'ev': 1,
        }, // not finite
        'garbage',
        _row('2026-07', 200, 180), // good
      ]);
      // Only the two readable rows survive; nothing was filled in with a 0,
      // which would have drawn a real point the series does not contain.
      expect(pts.map((EvmPoint p) => p.period).toList(), <String>[
        '2026-01',
        '2026-07',
      ]);
    });

    test('a non-list / absent series is honestly empty', () {
      expect(parseEvmSeries(null), isEmpty);
      expect(parseEvmSeries(<String, Object?>{}), isEmpty);
      expect(parseEvmSeries(const <Object?>[]), isEmpty);
    });
  });

  group('evmChartGeometry', () {
    test('one vertex per served point, in order, on both curves', () {
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[
          _row('2026-01', 0, 0),
          _row('2026-02', 50, 40),
          _row('2026-03', 100, 80),
        ]),
        _may2026,
      );
      expect(g.plan.length, 3);
      expect(g.actual.length, 3);
      expect(g.isEmpty, isFalse);
      expect(g.isSinglePoint, isFalse);
      // x spans 0..1 across the real range.
      expect(g.plan.first.x, 0);
      expect(g.plan.last.x, 1);
      // y is the value against a ZERO baseline: pv 50 of a 100 max sits at 0.5.
      expect(g.plan[1].y, closeTo(0.5, 1e-9));
      expect(g.actual[1].y, closeTo(0.4, 1e-9));
      expect(g.firstLabel, '2026-01');
      expect(g.lastLabel, '2026-03');
    });

    test('A MISSING PERIOD IS A GAP — x is real elapsed time, not an index', () {
      // Jan, Feb, then a jump to Jun: the Feb->Jun segment covers 4 months and
      // must be 4x as wide as Jan->Feb. Index-based spacing would render all
      // three evenly and silently erase the three missing months.
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[
          _row('2026-01', 0, 0),
          _row('2026-02', 10, 10),
          _row('2026-06', 50, 50),
        ]),
        _may2026,
      );
      expect(g.plan.length, 3, reason: 'no interpolated points were inserted');
      expect(g.plan[0].x, 0);
      expect(g.plan[1].x, closeTo(1 / 5, 1e-9)); // 1 month of a 5-month span
      expect(g.plan[2].x, 1);
    });

    test('never invents a point for a period the series skips', () {
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[
          _row('2026-01', 0, 0),
          _row('2026-06', 50, 50),
        ]),
        _may2026,
      );
      // Two served periods 5 months apart => exactly two vertices, not six.
      expect(g.plan.length, 2);
      expect(g.actual.length, 2);
    });

    test('a single period is a dot, not a line', () {
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[_row('2026-05', 42, 40)]),
        _may2026,
      );
      expect(g.isSinglePoint, isTrue);
      expect(g.plan.single.x, 0.5, reason: 'centred; no span to spread across');
      expect(g.firstLabel, '2026-05');
      expect(g.lastLabel, '2026-05');
    });

    test('an empty series produces an empty geometry (no axis, no curve)', () {
      final EvmChartGeometry g = evmChartGeometry(const <EvmPoint>[], _may2026);
      expect(g.isEmpty, isTrue);
      expect(g.plan, isEmpty);
      expect(g.actual, isEmpty);
      expect(g.todayX, isNull);
      expect(g.firstLabel, isNull);
      expect(g.lastLabel, isNull);
    });

    test('y is anchored at zero so a shape is not exaggerated', () {
      // Values 100..120 against a zero baseline: the low point must NOT be
      // flattened to y=0 (a floating floor would make a 20% rise look total).
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[
          _row('2026-01', 100, 100),
          _row('2026-02', 120, 120),
        ]),
        _may2026,
      );
      expect(g.plan[0].y, closeTo(100 / 120, 1e-9));
      expect(g.plan[1].y, 1);
    });

    test('a flat series is drawn flat rather than dividing by zero', () {
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[_row('2026-01', 0, 0), _row('2026-02', 0, 0)]),
        _may2026,
      );
      expect(g.plan.every((ChartXY p) => p.y == 0), isTrue);
      expect(g.plan.every((ChartXY p) => p.y.isFinite), isTrue);
    });

    test('negative values keep a sane baseline', () {
      final EvmChartGeometry g = evmChartGeometry(
        parseEvmSeries(<Object?>[
          _row('2026-01', -50, -50),
          _row('2026-02', 50, 50),
        ]),
        _may2026,
      );
      expect(g.plan[0].y, 0);
      expect(g.plan[1].y, 1);
    });

    group('the today marker', () {
      test('sits at the REAL position of the current month', () {
        final EvmChartGeometry g = evmChartGeometry(
          parseEvmSeries(<Object?>[
            _row('2026-01', 0, 0),
            _row('2026-09', 80, 70),
          ]),
          _may2026, // May = 4 months into an 8-month span
        );
        expect(g.todayX, closeTo(4 / 8, 1e-9));
      });

      test('is ABSENT when today falls outside the plotted range', () {
        // The prototype pins this rule at a fixed x; here it must not be drawn
        // at all rather than assert the axis reaches a period nobody reported.
        final EvmChartGeometry after = evmChartGeometry(
          parseEvmSeries(<Object?>[
            _row('2025-01', 0, 0),
            _row('2025-03', 10, 10),
          ]),
          _may2026, // long after the last period
        );
        expect(after.todayX, isNull);

        final EvmChartGeometry before = evmChartGeometry(
          parseEvmSeries(<Object?>[
            _row('2027-01', 0, 0),
            _row('2027-03', 10, 10),
          ]),
          _may2026, // before the first period
        );
        expect(before.todayX, isNull);
      });

      test('is drawn on the boundary months themselves', () {
        final EvmChartGeometry g = evmChartGeometry(
          parseEvmSeries(<Object?>[
            _row('2026-05', 0, 0),
            _row('2026-08', 10, 10),
          ]),
          _may2026,
        );
        expect(g.todayX, 0);
      });
    });
  });

  group('parseSummaryProjectName', () {
    test('reads the project name that LABELS the chart', () {
      expect(
        parseSummaryProjectName(<String, Object?>{
          'project_name': 'juneflow บางบัวทอง',
        }),
        'juneflow บางบัวทอง',
      );
      expect(
        parseSummaryProjectName(<String, Object?>{'projectName': 'RJP'}),
        'RJP',
      );
    });

    test('an absent / blank name is null — a scope is never invented', () {
      expect(parseSummaryProjectName(null), isNull);
      expect(parseSummaryProjectName(<String, Object?>{}), isNull);
      expect(
        parseSummaryProjectName(<String, Object?>{'project_name': ''}),
        isNull,
      );
      // The id is NOT a fallback label: a uuid names nothing to a reader.
      expect(
        parseSummaryProjectName(<String, Object?>{'project_id': 'p1'}),
        isNull,
      );
    });
  });

  group('parseEnvelopeTotal', () {
    test('reads the B-014 envelope total', () {
      expect(parseEnvelopeTotal(<String, Object?>{'total': 5}), 5);
      expect(parseEnvelopeTotal(<String, Object?>{'total': 0}), 0);
      // drizzle numerics can arrive as text.
      expect(parseEnvelopeTotal(<String, Object?>{'total': '12'}), 12);
    });

    test('an absent or nonsensical total is UNKNOWN, never 0 and never a '
        'row count', () {
      expect(parseEnvelopeTotal(null), isNull);
      expect(parseEnvelopeTotal(<String, Object?>{}), isNull);
      expect(parseEnvelopeTotal(<String, Object?>{'total': -1}), isNull);
      expect(parseEnvelopeTotal(<String, Object?>{'total': 1.5}), isNull);
      expect(parseEnvelopeTotal(<String, Object?>{'total': 'many'}), isNull);
      // A payload carrying rows but no total still yields null: the count is a
      // server fact or it is unknown.
      expect(
        parseEnvelopeTotal(<String, Object?>{
          'data': <Object?>[1, 2, 3],
        }),
        isNull,
      );
    });
  });

  group('buildExecDashboard', () {
    test('every KPI and hero figure is honestly unknown', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: <Object?>[_row('2026-05', 1, 1)],
        approvals: kEmptyExecApprovals,
        now: _may2026,
      );
      // No feed backs any of these; the screen em-dashes each one. If a future
      // slice wires one, this test is where the claim gets made.
      expect(d.kpis.salesCumulative, isNull);
      expect(d.kpis.unitsSold, isNull);
      expect(d.kpis.unitsTotal, isNull);
      expect(d.kpis.yoyPercent, isNull);
      expect(d.kpis.cashFlow7d, isNull);
      expect(d.kpis.pendingDocs, isNull);
      expect(d.kpis.projectsDue, isNull);
      expect(d.kpis.salesMonth, isNull);
    });

    test('the approvals count is the SERVER envelope total', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: null,
        approvals: const ExecApprovals(
          rows: <InboxEnt>[
            <String, Object?>{'id': 'a', 'kind': 'PR', 'amount': 902475},
            <String, Object?>{'id': 'b', 'kind': 'WO', 'amount': 645000},
          ],
          total: 2,
        ),
        now: _may2026,
      );
      expect(d.approvalsCount, 2);
      expect(d.approvals.map((InboxRow r) => r.kindCode), <String>['PR', 'WO']);
      // SERVER amounts, verbatim — nothing is summed into a client total.
      expect(d.approvals[0].amount, 902475);
      expect(d.approvals[1].amount, 645000);
    });

    test('rows with no id are dropped, but the COUNT stays the server total', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: null,
        approvals: const ExecApprovals(
          rows: <InboxEnt>[
            <String, Object?>{'kind': 'PR'},
            <String, Object?>{'id': 'b', 'kind': 'PO'},
          ],
          total: 2,
        ),
        now: _may2026,
      );
      // One row is renderable...
      expect(d.approvals.length, 1);
      // ...but two docs await the caller, and that is the server's fact. Taking
      // the list length here would publish a CLIENT filter's result as the
      // server's count and understate the backlog.
      expect(d.approvalsCount, 2);
    });

    test('a missing envelope total leaves the count UNKNOWN, never the row '
        'count and never zero', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: null,
        approvals: const ExecApprovals(
          rows: <InboxEnt>[
            <String, Object?>{'id': 'a', 'kind': 'PR'},
          ],
          total: null,
        ),
        now: _may2026,
      );
      expect(d.approvals.length, 1);
      expect(d.approvalsCount, isNull);
    });

    test('the chart carries the project name that scopes it', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: <Object?>[_row('2026-05', 1, 1)],
        approvals: kEmptyExecApprovals,
        now: _may2026,
        scopeLabel: 'juneflow บางบัวทอง',
      );
      expect(d.scopeLabel, 'juneflow บางบัวทอง');
    });

    test('an unreadable series still yields a usable dashboard', () {
      final ExecDashboard d = buildExecDashboard(
        evmSeries: 'nonsense',
        approvals: const ExecApprovals(
          rows: <InboxEnt>[
            <String, Object?>{'id': 'a', 'kind': 'PR'},
          ],
          total: 1,
        ),
        now: _may2026,
      );
      expect(d.chart.isEmpty, isTrue);
      expect(d.approvalsCount, 1, reason: 'the feeds are independent');
    });

    test('THE SEEDED STACK: the primary project serves an empty series, so the '
        'chart is empty and the scope is still named', () {
      // Reproduced from the payloads captured LIVE against the seeded stack:
      //   GET /boq/reports/evm?project_id=13ed4a49-… -> {"series":[], …}
      // Only project:rjp has evm_snapshot rows; the primary project is BBT.
      final ExecDashboard d = buildExecDashboard(
        evmSeries: const <Object?>[],
        approvals: const ExecApprovals(rows: <InboxEnt>[], total: 0),
        now: _may2026,
        scopeLabel: 'juneflow บางบัวทอง',
      );
      expect(d.chart.isEmpty, isTrue);
      expect(d.chart.plan, isEmpty);
      expect(d.chart.actual, isEmpty);
      expect(d.chart.firstLabel, isNull);
      expect(d.chart.todayX, isNull);
      // The reader is still told WHOSE curve is missing.
      expect(d.scopeLabel, 'juneflow บางบัวทอง');
    });
  });
}
