// Tests for the S-curve PAINTER (route exec) — the 151 lines that actually draw.
//
// WHY THIS FILE EXISTS. An independent review made `ExecScurvePainter.paint()` a
// complete no-op and the whole mobile suite still passed: the geometry and the
// text were covered, the drawing was not. The most fabrication-prone code on the
// screen — a chart, which interpolates by nature — was asserted by prose only.
// Every test here dies if the painter stops emitting strokes.
//
// HOW IT ASSERTS WITHOUT A GOLDEN. A golden pins pixels, which drift with fonts
// and platforms and say nothing about provenance. These tests instead capture the
// painter's own canvas calls through a recording [Canvas] and check the drawn
// GEOMETRY against the served series:
//
//   * the solid EV curve is one Path — its points are recovered by sampling with
//     PathMetrics and each sample must lie ON the straight polyline through the
//     mapped vertices. That single assertion pins three claims at once: the
//     vertices come from the served points, the segments are STRAIGHT (a bezier
//     would bow off the polyline — the deliberate deviation from the prototype's
//     Q/T smoothing), and no extra vertex was invented between two periods.
//   * the dashed PV curve emits drawLine calls — every dash endpoint must lie on
//     the plan polyline, and the dashes must span it end to end.
//   * a MISSING period must widen the segment, never grow an interpolated point:
//     the painted line is required to pass through the real-elapsed-months
//     position and to MISS the index-spaced one.
//
// All coordinates are derived here from the wire rows independently of
// exec_agg.evmChartGeometry, so a change in either the geometry or the painter
// has to be a deliberate one.
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/exec/exec_agg.dart';
import 'package:juneflow_mobile/screens/exec/exec_scurve_painter.dart';

/// The size the screen paints the chart at (exec_screen.dart: full width, 100
/// high — mobile-screens.jsx L681).
const Size _size = Size(320, 100);

/// The painter's vertical inset — half the 2.5 curve stroke, so a point on the
/// baseline or the maximum is not clipped (exec_scurve_painter.dart).
const double _inset = 2.5 / 2;

/// A wire EVM row as `GET /boq/reports/evm` serves it.
Map<String, Object?> _row(String period, num pv, num ev) => <String, Object?>{
  'period_label': period,
  'pv': pv,
  'ev': ev,
};

final DateTime _may2026 = DateTime.utc(2026, 5, 15);

/// A [Canvas] that records the primitives the painter emits. `implements Canvas`
/// + a `noSuchMethod` body gives Dart's implicit forwarders for everything this
/// painter never calls, so the fake stays honest about what it does not model.
class _RecordingCanvas implements Canvas {
  final List<(Offset, Offset)> lines = <(Offset, Offset)>[];
  final List<(Offset, double)> circles = <(Offset, double)>[];
  final List<Path> paths = <Path>[];

  @override
  void drawLine(Offset p1, Offset p2, Paint paint) => lines.add((p1, p2));

  @override
  void drawCircle(Offset c, double radius, Paint paint) =>
      circles.add((c, radius));

  @override
  void drawPath(Path path, Paint paint) => paths.add(path);

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

/// Paint [series] and return everything that reached the canvas.
_RecordingCanvas _paint(List<Object?> series, {DateTime? now, Size? size}) {
  final EvmChartGeometry g = evmChartGeometry(
    parseEvmSeries(series),
    now ?? _may2026,
  );
  final _RecordingCanvas canvas = _RecordingCanvas();
  ExecScurvePainter(g).paint(canvas, size ?? _size);
  return canvas;
}

/// The pixel a served point MUST map to, derived here from the wire values —
/// deliberately not from evmChartGeometry, so the two must agree.
///
/// x = real elapsed months across the plotted span; y = the value against a
/// baseline of min(0, lowest) topped at max(0, highest) across BOTH series,
/// flipped for screen coordinates and inset by half a stroke.
Offset _expected(
  List<(String, num, num)> rows,
  int index, {
  required bool plan,
  Size size = _size,
}) {
  int ordOf(String p) =>
      int.parse(p.substring(0, 4)) * 12 + int.parse(p.substring(5, 7)) - 1;
  final List<int> ords = rows
      .map(((String, num, num) r) => ordOf(r.$1))
      .toList();
  final int minOrd = ords.reduce(math.min);
  final int span = ords.reduce(math.max) - minOrd;
  double lowest = 0;
  double highest = 0;
  for (final (String, num, num) r in rows) {
    lowest = math.min(lowest, math.min(r.$2.toDouble(), r.$3.toDouble()));
    highest = math.max(highest, math.max(r.$2.toDouble(), r.$3.toDouble()));
  }
  final double range = highest - lowest;
  final double x = span == 0 ? 0.5 : (ords[index] - minOrd) / span;
  final double v = plan ? rows[index].$2.toDouble() : rows[index].$3.toDouble();
  final double y = range == 0 ? 0 : (v - lowest) / range;
  final double h = math.max(0, size.height - 2 * _inset);
  return Offset(x * size.width, _inset + (1 - y) * h);
}

/// Shortest distance from [p] to the segment [a]-[b].
double _distToSegment(Offset p, Offset a, Offset b) {
  final double len2 = (b - a).distanceSquared;
  if (len2 == 0) return (p - a).distance;
  final double t = (((p - a).dx * (b - a).dx + (p - a).dy * (b - a).dy) / len2)
      .clamp(0.0, 1.0);
  return (p - (a + (b - a) * t)).distance;
}

/// Shortest distance from [p] to the polyline through [vertices].
double _distToPolyline(Offset p, List<Offset> vertices) {
  double best = double.infinity;
  for (int i = 1; i < vertices.length; i++) {
    best = math.min(best, _distToSegment(p, vertices[i - 1], vertices[i]));
  }
  return best;
}

/// Sample [path] at [count] evenly spaced arc-length positions.
List<Offset> _samplePath(Path path, {int count = 60}) {
  final List<Offset> out = <Offset>[];
  for (final ui.PathMetric m in path.computeMetrics()) {
    for (int i = 0; i <= count; i++) {
      final ui.Tangent? t = m.getTangentForOffset(m.length * i / count);
      if (t != null) out.add(t.position);
    }
  }
  return out;
}

/// Total arc length of [path].
double _pathLength(Path path) => path.computeMetrics().fold<double>(
  0,
  (double a, ui.PathMetric m) => a + m.length,
);

void main() {
  group('the painter draws AT ALL', () {
    test('a real series puts strokes on the canvas', () {
      final _RecordingCanvas c = _paint(<Object?>[
        _row('2026-01', 10, 8),
        _row('2026-05', 65, 62),
      ]);
      // The EV curve is a Path; the dashed PV curve is a run of drawLine calls.
      // A painter that draws nothing fails right here.
      expect(c.paths, hasLength(1), reason: 'the solid EV curve is one path');
      expect(
        c.lines,
        isNotEmpty,
        reason: 'the dashed PV curve must emit dash segments',
      );
      expect(_pathLength(c.paths.single), greaterThan(0));
    });

    test('an empty series draws NOTHING — no axis, no flat zero line', () {
      final _RecordingCanvas c = _paint(const <Object?>[]);
      // The state every seeded caller reaches (the primary project has no
      // snapshots). A flat line here would assert real zero progress.
      expect(c.paths, isEmpty);
      expect(c.lines, isEmpty);
      expect(c.circles, isEmpty);
    });
  });

  group('every plotted vertex derives from the served series', () {
    test('the solid EV curve passes through each served point and is STRAIGHT '
        'between them', () {
      const List<(String, num, num)> rows = <(String, num, num)>[
        ('2026-01', 10, 8),
        ('2026-02', 30, 24),
        ('2026-03', 70, 61),
      ];
      final _RecordingCanvas c = _paint(<Object?>[
        for (final (String, num, num) r in rows) _row(r.$1, r.$2, r.$3),
      ]);
      final List<Offset> vertices = <Offset>[
        for (int i = 0; i < rows.length; i++) _expected(rows, i, plan: false),
      ];

      // 1. The path starts and ends exactly on the first and last served points.
      final List<Offset> samples = _samplePath(c.paths.single);
      expect((samples.first - vertices.first).distance, lessThan(0.5));
      expect((samples.last - vertices.last).distance, lessThan(0.5));

      // 2. EVERY sampled point lies on the polyline through the served vertices.
      //    A bezier (the prototype's Q/T smoothing) would bow away from it, and
      //    any invented vertex would pull the stroke off it.
      for (final Offset s in samples) {
        expect(
          _distToPolyline(s, vertices),
          lessThan(0.5),
          reason: 'painted point $s is not on the served polyline',
        );
      }

      // 3. Arc length == the sum of the straight segments. Smoothing would make
      //    the drawn stroke longer than the polyline it claims to be.
      double expectedLength = 0;
      for (int i = 1; i < vertices.length; i++) {
        expectedLength += (vertices[i] - vertices[i - 1]).distance;
      }
      expect(_pathLength(c.paths.single), closeTo(expectedLength, 0.5));
    });

    test('the dashed PV curve dashes ALONG the plan polyline, end to end', () {
      const List<(String, num, num)> rows = <(String, num, num)>[
        ('2026-01', 10, 8),
        ('2026-03', 40, 33),
        ('2026-06', 90, 80),
      ];
      final _RecordingCanvas c = _paint(<Object?>[
        for (final (String, num, num) r in rows) _row(r.$1, r.$2, r.$3),
      ]);
      final List<Offset> planVertices = <Offset>[
        for (int i = 0; i < rows.length; i++) _expected(rows, i, plan: true),
      ];
      final List<Offset> evVertices = <Offset>[
        for (int i = 0; i < rows.length; i++) _expected(rows, i, plan: false),
      ];

      // With no today rule in range these are the PV dashes alone.
      final _RecordingCanvas outOfRange = _paint(<Object?>[
        for (final (String, num, num) r in rows) _row(r.$1, r.$2, r.$3),
      ], now: DateTime.utc(2030, 1, 1));
      expect(outOfRange.lines, isNotEmpty);
      for (final (Offset, Offset) seg in outOfRange.lines) {
        expect(_distToPolyline(seg.$1, planVertices), lessThan(0.5));
        expect(_distToPolyline(seg.$2, planVertices), lessThan(0.5));
      }
      // The dashing spans the whole curve rather than stopping short.
      final double firstX = outOfRange.lines.first.$1.dx;
      final double lastX = outOfRange.lines.last.$2.dx;
      expect(firstX, closeTo(planVertices.first.dx, 0.5));
      expect(lastX, closeTo(planVertices.last.dx, 4.0));

      // PV and EV are genuinely different strokes here (pv > ev every period),
      // so a painter that drew one series twice would be caught.
      expect(planVertices, isNot(equals(evVertices)));
      expect(c.paths, hasLength(1));
    });
  });

  group('a missing period is a GAP, never an interpolated point', () {
    test('the painted line passes through real elapsed time and MISSES the '
        'index-spaced position', () {
      // March is absent. Real ordinals 0/1/3 put the middle vertex at x = 1/3;
      // index spacing would put it at x = 1/2. The two are 53px apart at this
      // width, so the assertion cannot pass by accident.
      const List<(String, num, num)> rows = <(String, num, num)>[
        ('2026-01', 0, 0),
        ('2026-02', 30, 30),
        ('2026-04', 90, 90),
      ];
      final _RecordingCanvas c = _paint(<Object?>[
        for (final (String, num, num) r in rows) _row(r.$1, r.$2, r.$3),
      ]);
      final List<Offset> vertices = <Offset>[
        for (int i = 0; i < rows.length; i++) _expected(rows, i, plan: false),
      ];
      final Offset realMiddle = vertices[1];
      expect(realMiddle.dx, closeTo(_size.width / 3, 0.5));

      // The index-spaced middle: same y, x at the halfway point.
      final Offset indexMiddle = Offset(_size.width / 2, realMiddle.dy);
      expect((realMiddle - indexMiddle).distance, greaterThan(50));

      final List<Offset> samples = _samplePath(c.paths.single, count: 400);
      double nearestToReal = double.infinity;
      double nearestToIndex = double.infinity;
      for (final Offset s in samples) {
        nearestToReal = math.min(nearestToReal, (s - realMiddle).distance);
        nearestToIndex = math.min(nearestToIndex, (s - indexMiddle).distance);
      }
      // The stroke goes through the real position...
      expect(nearestToReal, lessThan(1.0));
      // ...and nowhere near the index-spaced one, which is where a zero-filled
      // or resampled series would have put it.
      expect(nearestToIndex, greaterThan(10.0));
    });

    test('the skipped period gets NO vertex of its own', () {
      const List<(String, num, num)> rows = <(String, num, num)>[
        ('2026-01', 0, 0),
        ('2026-02', 30, 30),
        ('2026-04', 90, 90),
      ];
      final _RecordingCanvas c = _paint(<Object?>[
        for (final (String, num, num) r in rows) _row(r.$1, r.$2, r.$3),
      ]);
      final List<Offset> vertices = <Offset>[
        for (int i = 0; i < rows.length; i++) _expected(rows, i, plan: false),
      ];
      // Three served rows -> exactly two straight segments. A zero-filled March
      // would add a third and lengthen the stroke.
      double twoSegments = 0;
      for (int i = 1; i < vertices.length; i++) {
        twoSegments += (vertices[i] - vertices[i - 1]).distance;
      }
      expect(_pathLength(c.paths.single), closeTo(twoSegments, 0.5));
    });
  });

  group('a single period is a dot, not a line', () {
    test('two marks and no stroke — one moment cannot make a line', () {
      final _RecordingCanvas c = _paint(<Object?>[_row('2026-05', 40, 36)]);
      // One mark for PV, one for EV, at the centre of the axis.
      expect(c.circles, hasLength(2));
      expect(c.paths, isEmpty, reason: 'a segment would imply a second value');
      for (final (Offset, double) dot in c.circles) {
        expect(dot.$1.dx, closeTo(_size.width / 2, 0.5));
      }
      // The two values are distinct, so the marks must be too.
      expect(c.circles[0].$1.dy, isNot(closeTo(c.circles[1].$1.dy, 0.5)));
    });
  });

  group('the today rule', () {
    test('is drawn as a vertical rule at the REAL position of this month', () {
      // Jan..Sep 2026 with today = May: (2026-05 - 2026-01) / 8 months = 0.5.
      final _RecordingCanvas c = _paint(<Object?>[
        _row('2026-01', 0, 0),
        _row('2026-09', 80, 70),
      ], now: _may2026);
      final List<(Offset, Offset)> vertical = c.lines
          .where(((Offset, Offset) l) => (l.$1.dx - l.$2.dx).abs() < 0.001)
          .toList();
      expect(vertical, isNotEmpty, reason: 'the today rule must be drawn');
      for (final (Offset, Offset) seg in vertical) {
        expect(seg.$1.dx, closeTo(_size.width * 0.5, 0.5));
      }
    });

    test('is ABSENT when today falls outside the plotted range', () {
      final _RecordingCanvas c = _paint(<Object?>[
        _row('2020-01', 0, 0),
        _row('2020-03', 8, 7),
      ], now: _may2026);
      final List<(Offset, Offset)> vertical = c.lines
          .where(((Offset, Offset) l) => (l.$1.dx - l.$2.dx).abs() < 0.001)
          .toList();
      // A rule beyond the last point would assert the axis covers a period the
      // series does not.
      expect(vertical, isEmpty);
      // The curve itself still draws — only the marker is withheld.
      expect(c.paths, hasLength(1));
    });
  });
}
