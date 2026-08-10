// The signature pad for mobile `pm-close` — a pure-Flutter `CustomPaint` capture
// surface that emits the B-331 stroke JSON. NO PACKAGE: that is precisely why Wei
// ruled stroke JSON over an SVG path or a data-URI PNG (BLOCKERS.md B-331), and
// reaching for a dependency here would mean the shape had drifted.
//
// ══ THIS IS AN ADDITION BEYOND THE PROTOTYPE — DELIBERATELY, UNDER A RULING ═══════
// Recorded rather than shipped quietly, because §0 rule 1 forbids inventing UI:
// BOTH prototypes' pads are decorative. pototype/mobile-pm.jsx L206 is a TAP TOGGLE
// (`onClick={() => setSigned(true)}`) that paints a hardcoded cursive customer name;
// pototype/pm3.jsx L137 is a static div. Neither captures anything, so a real drawing
// surface exists in neither. B-331 authorises it — it is the ruling that closes B-288
// ("the pm-close close action can now be performed honestly rather than withheld") —
// and a pad that captures nothing cannot produce the value the ruling is about.
//
// What is kept EXACTLY: the prototype's box (110px tall, radius 10, a 1.5px dashed
// border, mobile-pm.jsx L206) and its two tones — border-strong over surface-2 while
// empty, ok over ok-soft once there is ink. What the prototype paints INSIDE the
// signed box (a hardcoded customer name) is not reproduced: this paints the real
// strokes.
//
// The CLEAR control is the second addition, and it is load-bearing rather than
// convenient: without it a mis-stroke can never be taken back, so the technician's
// only ways forward would be to hand the customer a pad carrying a wrong mark or to
// abandon the close. It is ICON-ONLY on purpose — an icon needs no i18n key, so this
// screen stays ZERO-MINT (docs/extract/i18n-full.json is sacred and untouched).
// It appears only when there is something to clear.
import 'dart:ui' show PathMetric;

import 'package:flutter/gestures.dart' show EagerGestureRecognizer;
import 'package:flutter/material.dart';

import '../../theme/juneflow_theme.dart';
import 'signature_ink.dart';

/// A capture pad that reports its ink on every change.
///
/// The widget owns the strokes; the screen owns the decision of what to do with
/// them. [onChanged] fires with the CURRENT ink after every stroke and after a clear
/// — never with a partially-drawn stroke, so a listener never sees a mark the
/// customer has not finished making.
class SignaturePad extends StatefulWidget {
  const SignaturePad({
    super.key,
    required this.onChanged,
    this.height = 110,
    this.enabled = true,
  });

  /// Called with the pad's ink after each completed stroke and after a clear. The
  /// ink is empty (`hasInk == false`) after a clear.
  final ValueChanged<SignatureInk> onChanged;

  /// Pad height in logical px (mobile-pm.jsx L206: 110).
  final double height;

  /// When false the pad ignores pointers — used while a submit is in flight, so the
  /// signature cannot change under a request that is already carrying it.
  final bool enabled;

  @override
  State<SignaturePad> createState() => SignaturePadState();
}

@visibleForTesting
class SignaturePadState extends State<SignaturePad> {
  /// Completed strokes, in draw order.
  final List<List<SignaturePoint>> _strokes = <List<SignaturePoint>>[];

  /// The stroke being drawn right now, or null between pen-up and the next pen-down.
  List<SignaturePoint>? _active;

  /// The pad's own size, captured at paint time. This is the `w`/`h` written into the
  /// stroke JSON, so it must be the box the points were actually measured in — never
  /// a constant, or stored ink would re-render at the wrong aspect ratio.
  ///
  /// It can CHANGE while a signature is being made (a rotation as the phone is handed
  /// across, a split-screen resize), which is why [_adoptSize] rescales the ink into
  /// the new box rather than simply relabelling it — B-357/F6.
  Size _size = Size.zero;

  /// Whether the pad carries any completed mark.
  bool get hasInk => _strokes.any((List<SignaturePoint> s) => s.isNotEmpty);

  /// Everything drawn so far, including the in-progress stroke, as re-renderable ink.
  SignatureInk get ink => SignatureInk(
    width: _size.width,
    height: _size.height,
    strokes: <List<SignaturePoint>>[
      ..._strokes,
      if (_active != null && _active!.isNotEmpty) _active!,
    ],
  );

  /// Drop every stroke. Reports the now-empty ink so a listener that had enabled a
  /// submit control disables it again.
  void clear() {
    if (_strokes.isEmpty && _active == null) return;
    setState(() {
      _strokes.clear();
      _active = null;
    });
    widget.onChanged(ink);
  }

  /// Adopt a new pad size, RESCALING everything already drawn into it (B-357/F6).
  ///
  /// Called from the layout builder, so it runs before the painter is constructed for
  /// this frame and the remapped ink is what gets drawn. It must not `setState` —
  /// nothing here needs one, because it is already inside a build.
  ///
  /// The listener DOES have to be told, and after the frame rather than during it: the
  /// parent holds the ENCODED value ([PmCloseScreen] keeps `_pending`), which still
  /// describes the OLD viewport and is the string a submit would send. Notifying
  /// synchronously would `setState` a parent that is mid-build; a post-frame callback
  /// lands the moment the frame is done, and cannot loop — the next build sees an
  /// unchanged size and rescales nothing.
  void _adoptSize(Size next) {
    if (next == _size) return;
    final Size previous = _size;
    _size = next;
    final bool remapped = rescaleSignatureStrokes(
      // A fresh OUTER list over the SAME inner lists: the rewrite is in place, so the
      // stroke a finger may still be drawing keeps its identity.
      <List<SignaturePoint>>[..._strokes, if (_active != null) _active!],
      fromWidth: previous.width,
      fromHeight: previous.height,
      toWidth: next.width,
      toHeight: next.height,
    );
    if (!remapped) return;
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      if (mounted) widget.onChanged(ink);
    });
  }

  /// Clamp a raw pointer position into the pad.
  ///
  /// A finger that leaves the box mid-stroke keeps sending events; storing those
  /// out-of-range points would put ink outside the `w`x`h` viewport that defines the
  /// coordinate space, and any re-render would then either clip it or shrink the
  /// whole signature to fit a stray excursion.
  SignaturePoint _clamp(Offset p) => SignaturePoint(
    p.dx.clamp(0.0, _size.width),
    p.dy.clamp(0.0, _size.height),
  );

  void _down(Offset p) {
    if (!widget.enabled || _size.isEmpty) return;
    setState(() => _active = <SignaturePoint>[_clamp(p)]);
  }

  void _move(Offset p) {
    final List<SignaturePoint>? active = _active;
    if (!widget.enabled || active == null) return;
    final SignaturePoint next = _clamp(p);
    // Thinning: a nearly-still finger emits many sub-pixel samples that add bytes and
    // change no geometry (kSignatureMinPointGap).
    final SignaturePoint last = active.last;
    final double dx = next.x - last.x;
    final double dy = next.y - last.y;
    if (dx * dx + dy * dy < kSignatureMinPointGap * kSignatureMinPointGap) {
      return;
    }
    setState(() => active.add(next));
  }

  void _up() {
    final List<SignaturePoint>? active = _active;
    if (active == null) return;
    setState(() {
      // A tap with no movement is a single point — a dot IS a mark a person can make,
      // so it is kept. An empty run is not a stroke and is dropped.
      if (active.isNotEmpty) _strokes.add(active);
      _active = null;
    });
    widget.onChanged(ink);
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          _adoptSize(Size(constraints.maxWidth, widget.height));
          return Stack(
            children: <Widget>[
              Positioned.fill(child: _surface()),
              if (hasInk && widget.enabled)
                Positioned(top: 4, right: 4, child: _clearButton()),
            ],
          );
        },
      ),
    );
  }

  /// The drawing surface.
  ///
  /// [EagerGestureRecognizer] wins the gesture arena the moment a pointer lands here,
  /// which is what stops the enclosing ListView from reading a downward stroke as a
  /// SCROLL and swallowing it. Points themselves come from [Listener], which sees raw
  /// pointer events and therefore never loses one to arena resolution.
  Widget _surface() {
    return RawGestureDetector(
      behavior: HitTestBehavior.opaque,
      gestures: <Type, GestureRecognizerFactory>{
        EagerGestureRecognizer:
            GestureRecognizerFactoryWithHandlers<EagerGestureRecognizer>(
              () => EagerGestureRecognizer(),
              (EagerGestureRecognizer _) {},
            ),
      },
      child: Listener(
        onPointerDown: (PointerDownEvent e) => _down(e.localPosition),
        onPointerMove: (PointerMoveEvent e) => _move(e.localPosition),
        onPointerUp: (PointerUpEvent _) => _up(),
        onPointerCancel: (PointerCancelEvent _) => _up(),
        child: CustomPaint(
          painter: SignatureInkPainter(
            strokes: ink.strokes,
            signed: hasInk || _active != null,
            sourceWidth: _size.width,
            sourceHeight: _size.height,
          ),
          child: Center(
            child: hasInk || _active != null
                ? const SizedBox.shrink()
                // The empty pad shows the same draw glyph the read-only slice used.
                // No prompt text: the section already carries pm.signatureLabel
                // ("customer / building-supervisor signature") directly above the box,
                // and the prototype's own prompt promised an interaction it did not
                // have. Icon over text also keeps this screen zero-mint.
                : const Icon(
                    Icons.draw_outlined,
                    size: 20,
                    color: JuneflowTokens.textTertiary,
                  ),
          ),
        ),
      ),
    );
  }

  /// Icon-only clear (see the file header: an icon needs no i18n key).
  Widget _clearButton() {
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: clear,
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: JuneflowTokens.surfaceCard,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.refresh,
            size: 16,
            color: JuneflowTokens.textSecondary,
          ),
        ),
      ),
    );
  }
}

/// Paints the prototype's dashed box (mobile-pm.jsx L206: 110px, radius 10, 1.5px
/// dashed, two tones) and the ink inside it.
///
/// Used BOTH by the live pad and by the read-back of a stored signature, which is why
/// it scales: [sourceWidth]/[sourceHeight] are the viewport the strokes were captured
/// in, and stored ink is almost never re-rendered at its capture size. The scale is
/// [SignatureInk.fit] — uniform, so a signature is never stretched into a different
/// mark — and the result is centred in the box.
class SignatureInkPainter extends CustomPainter {
  const SignatureInkPainter({
    required this.strokes,
    required this.signed,
    required this.sourceWidth,
    required this.sourceHeight,
  });

  /// Strokes in the [sourceWidth] x [sourceHeight] coordinate space.
  final List<List<SignaturePoint>> strokes;

  /// Drives only the prototype's two border/background tones.
  final bool signed;

  final double sourceWidth;
  final double sourceHeight;

  @override
  void paint(Canvas canvas, Size size) {
    final RRect box = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(10),
    );
    canvas.drawRRect(
      box,
      Paint()
        ..color = signed
            ? JuneflowTokens.statusOkSoft
            : JuneflowTokens.surfaceAlt,
    );

    final Paint border = Paint()
      ..color = signed
          ? JuneflowTokens.statusOkFg
          : JuneflowTokens.surfaceBorderStrong
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    const double dash = 4;
    const double gap = 3;
    for (final PathMetric m in (Path()..addRRect(box)).computeMetrics()) {
      double at = 0;
      while (at < m.length) {
        final double end = (at + dash).clamp(0, m.length);
        canvas.drawPath(m.extractPath(at, end), border);
        at = end + gap;
      }
    }

    _paintInk(canvas, size);
  }

  void _paintInk(Canvas canvas, Size size) {
    if (strokes.isEmpty) return;
    final SignatureInk ink = SignatureInk(
      width: sourceWidth,
      height: sourceHeight,
      strokes: strokes,
    );
    final double scale = ink.fit(size.width, size.height);
    if (scale <= 0) return;
    // Centre the scaled ink: `fit` leaves slack on one axis whenever the aspect
    // ratios differ (a phone capture re-drawn in a wider box).
    final double dx = (size.width - sourceWidth * scale) / 2;
    final double dy = (size.height - sourceHeight * scale) / 2;

    final Paint pen = Paint()
      ..color = JuneflowTokens.textPrimary
      ..style = PaintingStyle.stroke
      // Width tracks the scale so a shrunk signature does not turn into a blob, with
      // a floor so it never disappears. Width is NOT stored (see signature_ink.dart).
      ..strokeWidth = (2.0 * scale).clamp(1.0, 3.0)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    for (final List<SignaturePoint> stroke in strokes) {
      if (stroke.isEmpty) continue;
      Offset at(SignaturePoint p) => Offset(dx + p.x * scale, dy + p.y * scale);
      if (stroke.length == 1) {
        // A dot: a zero-length line with a round cap draws nothing on some backends,
        // so it is painted as a filled disc of the same visual weight.
        canvas.drawCircle(
          at(stroke.first),
          pen.strokeWidth / 2,
          Paint()..color = pen.color,
        );
        continue;
      }
      final Path path = Path()
        ..moveTo(at(stroke.first).dx, at(stroke.first).dy);
      for (final SignaturePoint p in stroke.skip(1)) {
        path.lineTo(at(p).dx, at(p).dy);
      }
      canvas.drawPath(path, pen);
    }
  }

  /// Repaint whenever anything visible could differ.
  ///
  /// Identity comparison on [strokes] is deliberate and is what makes an
  /// IN-PROGRESS stroke animate: the pad rebuilds this painter from
  /// `SignaturePadState.ink`, which composes a fresh list on every read, so growing
  /// the active stroke by one point yields a new identity here even though the
  /// stroke's own list was mutated in place. Comparing lengths instead would miss a
  /// clear-then-redraw of the same size.
  @override
  bool shouldRepaint(covariant SignatureInkPainter old) =>
      old.signed != signed ||
      !identical(old.strokes, strokes) ||
      old.sourceWidth != sourceWidth ||
      old.sourceHeight != sourceHeight;
}
