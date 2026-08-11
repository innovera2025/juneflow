// The executive dashboard's S-curve painter (pototype/mobile-screens.jsx
// MExecDashboard L681-685). A CustomPainter, not a charting package: adding a
// dependency is a stack decision, and the shape needed here is two polylines and
// a rule.
//
// WHAT IS DRAWN vs WHAT IS SMOOTHING — the fabrication line for a chart:
//   * every VERTEX is a real served point. [EvmChartGeometry] holds one vertex per
//     row of `GET /boq/reports/evm`'s series, positioned by that row's real
//     period and its real pv/ev.
//   * segments are STRAIGHT lines between consecutive vertices. The prototype
//     draws quadratic beziers (`Q`/`T`, L682-683) which bow the stroke away from
//     the data between two points; a straight segment is the minimum claim — "we
//     know these two values, and nothing about the moment between them".
//     Deliberate deviation from the prototype's curve smoothing, in favour of
//     drawing no value the series does not carry.
//   * a period the series SKIPS produces a longer segment, never an interpolated
//     or zero-filled vertex (the x axis is real elapsed months — see
//     exec_agg.evmChartGeometry).
//   * a single-point series draws a DOT and no segment: one moment cannot make a
//     line, and a line needs a second value that does not exist.
//   * the "today" rule is drawn only when the real current month falls inside the
//     plotted range (the prototype pins it at a fixed x, L684).
//
// The DASH pattern carries the prototype's own meaning: plan is dashed
// (strokeDasharray "4 3", L682), actual is solid (L683). Both strokes are the
// brand colour because the prototype's own `--accent` and `--brand` resolve to the
// SAME value in the Fiori theme that is this app's design source
// (pototype/Juneflow Fiori.html L14: `--accent:#2563c9` == `--brand`), which is
// why the two curves in tests/visual/reference/mobile/exec.png differ only by
// their dashing. All colours are generated tokens (PLAN.md §0 rule 2).
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/juneflow_theme.dart';
import 'exec_agg.dart';

/// Stroke width of both curves (mobile-screens.jsx L682-683: 2.5).
const double _kCurveStroke = 2.5;

/// Plan dash pattern (L682: strokeDasharray "4 3").
const double _kPlanDash = 4;
const double _kPlanGap = 3;

/// Today-rule dash pattern (L684: strokeDasharray "2 2").
const double _kTodayDash = 2;
const double _kTodayGap = 2;

/// Paints the two EVM curves and the today rule.
class ExecScurvePainter extends CustomPainter {
  const ExecScurvePainter(this.geometry);

  final EvmChartGeometry geometry;

  @override
  void paint(Canvas canvas, Size size) {
    if (geometry.isEmpty) return;

    // Inset vertically by half the stroke so a point sitting exactly on the
    // baseline or the maximum is not clipped in half.
    const double inset = _kCurveStroke / 2;
    final double h = math.max(0, size.height - _kCurveStroke);

    Offset at(ChartXY p) => Offset(p.x * size.width, inset + (1 - p.y) * h);

    final Paint curve = Paint()
      ..color = JuneflowTokens.brandPrimary
      ..strokeWidth = _kCurveStroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    if (geometry.isSinglePoint) {
      // One real moment: mark both values, draw no line between nothing.
      final Paint dot = Paint()..color = JuneflowTokens.brandPrimary;
      canvas.drawCircle(at(geometry.plan.first), _kCurveStroke, dot);
      canvas.drawCircle(at(geometry.actual.first), _kCurveStroke, dot);
    } else {
      final List<Offset> plan = geometry.plan.map(at).toList();
      final List<Offset> actual = geometry.actual.map(at).toList();
      _dashedPolyline(canvas, plan, curve, _kPlanDash, _kPlanGap);
      _solidPolyline(canvas, actual, curve);
    }

    final double? todayX = geometry.todayX;
    if (todayX != null) {
      final Paint rule = Paint()
        // L684: var(--danger) at opacity 0.6, 1px wide.
        ..color = JuneflowTokens.statusDangerFg.withValues(alpha: 0.6)
        ..strokeWidth = 1
        ..style = PaintingStyle.stroke;
      final double x = todayX * size.width;
      _dashedPolyline(
        canvas,
        <Offset>[Offset(x, 0), Offset(x, size.height)],
        rule,
        _kTodayDash,
        _kTodayGap,
      );
    }
  }

  /// Join [points] with straight segments.
  void _solidPolyline(Canvas canvas, List<Offset> points, Paint paint) {
    final Path path = Path()..moveTo(points.first.dx, points.first.dy);
    for (int i = 1; i < points.length; i++) {
      path.lineTo(points[i].dx, points[i].dy);
    }
    canvas.drawPath(path, paint);
  }

  /// Join [points] with straight segments broken into a [dash]/[gap] pattern.
  ///
  /// The pattern runs CONTINUOUSLY across vertices (the leftover of a segment's
  /// last dash carries into the next one) so the dashing reads as one stroke, the
  /// way an SVG strokeDasharray does — it is a line style, not a data marker, and
  /// must not accidentally place a dash boundary on every vertex and imply one.
  void _dashedPolyline(
    Canvas canvas,
    List<Offset> points,
    Paint paint,
    double dash,
    double gap,
  ) {
    double remaining = dash;
    bool drawing = true;
    for (int i = 1; i < points.length; i++) {
      Offset from = points[i - 1];
      final Offset to = points[i];
      double segment = (to - from).distance;
      if (segment <= 0) continue;
      final Offset unit = (to - from) / segment;
      while (segment > 0) {
        final double step = math.min(remaining, segment);
        final Offset next = from + unit * step;
        if (drawing) canvas.drawLine(from, next, paint);
        from = next;
        segment -= step;
        remaining -= step;
        if (remaining <= 0) {
          drawing = !drawing;
          remaining = drawing ? dash : gap;
        }
      }
    }
  }

  @override
  bool shouldRepaint(ExecScurvePainter oldDelegate) =>
      oldDelegate.geometry != geometry;
}
