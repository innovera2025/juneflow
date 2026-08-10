// The wire encoding of `pm_workorder.customer_sign` — STROKE JSON (BLOCKERS.md
// B-331, ruled by Wei 2026-08-07). Pure Dart: `dart:convert` and nothing else, so
// the encoding is unit-testable without a widget tree and cannot drift into the pad.
//
// ══ THE SHAPE ════════════════════════════════════════════════════════════════════
//   {"v":1,"w":300.0,"h":110.0,"s":[[[12.0,40.5],[13.0,41.2]],[[80.0,44.0]]]}
//
//   v  schema version (int, currently 1)
//   w  capture viewport WIDTH  in logical px (> 0)
//   h  capture viewport HEIGHT in logical px (> 0)
//   s  strokes; each stroke is a list of [x, y] points in that viewport's own
//      coordinate space, one decimal place
//
// `w`/`h` are LOAD-BEARING, not metadata. Without them the points are unitless and
// cannot be re-rendered at any other size — a signature captured on a 300px-wide
// phone pad would be unreadable in a 640px web certificate view. [SignatureInk.fit]
// is the one place that scaling is expressed, so both readers agree.
//
// `v` is load-bearing for a different reason: `customer_sign` is a bare `text`
// column (packages/db/src/schema/pm.ts L182) with no migration path and no shape
// check anywhere in the stack. Without a version, a later change to this structure
// would be undetectable in stored data. [decodeSignatureInk] therefore returns null
// for ANY version it does not know rather than guessing at the fields.
//
// ══ WHAT THIS DELIBERATELY DOES NOT STORE ════════════════════════════════════════
// Each of these was considered and excluded because it is unnecessary, not merely
// awkward:
//
//   * PRESSURE. Flutter reports a constant 1.0 (and the web Pointer Events spec 0.5)
//     on any digitizer that does not sense force — i.e. the overwhelming majority of
//     the phones and tablets this ships to. It would store a constant. Its only
//     consumer is stroke-width modulation, which is cosmetic; a signature's identity
//     is its geometry.
//   * TIMING / TIMESTAMPS. Per-point timing is what BIOMETRIC signature verification
//     (velocity/acceleration matching) needs. Nothing in Juneflow verifies a
//     signature — all four readers test presence only. Storing timing would convert
//     an inert mark into behavioural biometric data: PDPA-sensitive personal data,
//     with no consent surface and no purpose. Excluding it is a positive.
//   * STROKE WIDTH / COLOUR. A render-side choice. Storing it would freeze today's
//     theme into permanent data; width is derived from the viewport scale instead.
//   * DEVICE / USER-AGENT METADATA. The AuditLog middleware already records every
//     mutation (root CLAUDE.md), so this would duplicate it inside an unversioned
//     blob.
//   * THE SIGNER'S NAME. UNAVAILABLE, not omitted: the customer is three hops away
//     and `contractWire` stops at `customer_id` (apps/api/src/routes/pm.ts L276-288).
//     Including it would fabricate it — the same reason the pad's caption em-dashes.
import 'dart:convert';

/// The current schema version written by [encodeSignatureInk].
const int kSignatureInkVersion = 1;

/// Hard ceiling on the points ONE signature may carry.
///
/// Not a style limit — a body-size guarantee. `apps/api/src/app.ts` constructs
/// Fastify with no `bodyLimit`, so the only bound on this column is Fastify's 1 MiB
/// default; the column itself is `text` (~1 GB). At ~14 bytes per encoded point this
/// cap is ~140 KB, two orders of magnitude clear of that limit and two orders of
/// magnitude above any real signature (a 10-second capture at 60 Hz, before
/// [kSignatureMinPointGap] thinning, is ~600 points). Points past the cap are
/// IGNORED — never silently dropped from the middle of a stroke, so what is stored is
/// always a real prefix of what was drawn.
const int kSignatureMaxPoints = 10000;

/// Minimum logical-pixel distance between two consecutive points of one stroke.
///
/// A pointer stream emits many sub-pixel samples while the finger is nearly still;
/// they add bytes and change no geometry. Thinning at 1 px is invisible on screen and
/// keeps a normal signature well under a few hundred points.
///
/// THIS IS NOT THE GUARD, and reading it as one was the defect B-357/F2 records. It
/// filters ADJACENT samples for size; it says nothing about how far the mark
/// travelled. What decides whether ink counts as a signature is
/// [kSignatureMinStrokeSpan].
const double kSignatureMinPointGap = 1.0;

/// Minimum SPAN — bounding-box diagonal in logical px — that ONE stroke must cover
/// before the ink counts as a signature ([SignatureInk.hasSignature]).
///
/// WHY A SPAN AND NOT A POINT COUNT. The rule used to be "a stroke with 2+ points",
/// and [kSignatureMinPointGap] admits the second point at 1.0 px — so the smallest
/// accepted signature was a ONE-PIXEL DRAG, while the rule was documented as stopping
/// "an accidental brush against the pad". It did not. Distance travelled is the
/// property the rule was always about, so it is now the property measured.
///
/// WHY 8 AND NOT `kTouchSlop` (Flutter's 18 px, the distance under which a drag is
/// still classified as a tap). The slop is tuned to classify a GESTURE; borrowing it
/// here would refuse a legitimately small INTENTIONAL mark — a tick, one initial, the
/// short final stroke of a name. 8 px sits deliberately under it: well clear of
/// pointer jitter (sub-pixel to a few px, and it stays in place rather than
/// travelling) and well under anything a person means to draw.
///
/// MEASURED PER STROKE, not over the whole pad, so two unrelated accidents — a 1 px
/// twitch here and a stray dot 200 px away — cannot add up to a signature between
/// them. The union's span would call that pair an 8 px mark; neither stroke is one.
///
/// WHAT IT STILL DOES NOT STOP, stated because the previous comment overclaimed: a
/// hand dragged across the pad, or a deliberate scribble, travels far more than 8 px
/// and is geometrically indistinguishable from a mark. No client-side rule can
/// separate those from a signature — only the person holding the phone can.
const double kSignatureMinStrokeSpan = 8.0;

/// One captured point, in the capture viewport's own coordinate space.
class SignaturePoint {
  const SignaturePoint(this.x, this.y);

  final double x;
  final double y;

  @override
  bool operator ==(Object other) =>
      other is SignaturePoint && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'SignaturePoint($x, $y)';
}

/// A whole captured signature: the strokes plus the viewport they were drawn in.
class SignatureInk {
  const SignatureInk({
    required this.width,
    required this.height,
    required this.strokes,
  });

  /// Capture viewport width in logical px (> 0 for any ink [encodeSignatureInk]
  /// will accept).
  final double width;

  /// Capture viewport height in logical px (> 0, as above).
  final double height;

  /// The strokes, in draw order. Each is a pen-down → pen-up run of points.
  final List<List<SignaturePoint>> strokes;

  /// Whether this ink carries any actual mark.
  ///
  /// LOAD-BEARING. Every reader in the product treats a NON-EMPTY `customer_sign` as
  /// "the customer signed and the work order is done" (web wo-rows.ts L206, mobile
  /// pm_jobs_agg L128, api counts.ts L132 `isNull`) — none of them looks inside. So a
  /// syntactically valid but EMPTY signature (`{"v":1,...,"s":[]}`) would mark a work
  /// order complete with no signature on it: a fabricated record of consent. Callers
  /// must refuse to submit when this is false, and [encodeSignatureInk] refuses to
  /// encode it at all so there is no way to reach the wire around them.
  bool get hasInk => strokes.any((List<SignaturePoint> s) => s.isNotEmpty);

  /// Whether this ink is a SIGNATURE — at least one stroke that TRAVELLED at least
  /// [kSignatureMinStrokeSpan] logical px, measured as its bounding-box diagonal.
  ///
  /// Stricter than [hasInk], and the difference is the whole point: every reader in
  /// the product treats a non-empty `customer_sign` as the customer's consent without
  /// looking inside, so ink that nobody set out to make must not be able to close a
  /// work order.
  ///
  /// WHAT IT REJECTS, exactly:
  ///   * a still TAP (one point) — the prototype's own fabrication gesture
  ///     (pototype/mobile-pm.jsx L206 flips a flag and paints a hardcoded name);
  ///   * a ONE-PIXEL DRAG, which the previous "2+ points" rule accepted because
  ///     [kSignatureMinPointGap] admits the second point at exactly 1.0 px;
  ///   * jitter in place — a finger resting on the pad emits many points, but they
  ///     stay inside a few px, and a span measures travel rather than sample count.
  ///
  /// WHAT IT DOES NOT REJECT, and this is a limit rather than an oversight: a hand
  /// dragged across the pad while the phone changes hands, or a deliberate scribble.
  /// Both travel far more than 8 px and are geometrically identical to a small mark.
  /// The guard makes a still or twitching contact insufficient; it cannot make consent
  /// verifiable.
  ///
  /// Dots inside a REAL signature are unaffected — the dot over an "i" rides along
  /// with the stroke that travelled; it simply cannot be the only thing on the pad.
  bool get hasSignature => strokes.any(_isSignatureStroke);

  /// Total points across every stroke.
  int get pointCount =>
      strokes.fold<int>(0, (int n, List<SignaturePoint> s) => n + s.length);

  /// The uniform scale that fits this ink into a [targetWidth] x [targetHeight] box
  /// without distorting it — the single expression of the re-render contract, shared
  /// by every surface that draws stored ink.
  ///
  /// `min` (not `max`, and not two independent axis scales): a signature stretched
  /// unevenly is a different mark. Returns 0 for a degenerate target or viewport,
  /// which draws nothing rather than dividing by zero.
  double fit(double targetWidth, double targetHeight) {
    if (width <= 0 || height <= 0) return 0;
    if (targetWidth <= 0 || targetHeight <= 0) return 0;
    final double sx = targetWidth / width;
    final double sy = targetHeight / height;
    return sx < sy ? sx : sy;
  }
}

/// Re-express [strokes], captured in a `fromWidth` x `fromHeight` viewport, in a
/// `toWidth` x `toHeight` one. Returns whether anything was rewritten.
///
/// THE DEFECT THIS CLOSES (B-357/F6). A pad records ONE `w`/`h`, read back at render
/// time, and nothing used to reconcile the two when the box changed size. Sign the
/// first stroke in portrait (360 px wide), the phone rotates while it is handed
/// across, the customer finishes in landscape (780 px) — [encodeSignatureInk] then
/// stamped `w: 780` onto points measured in a 360 px space, and every re-render scaled
/// the pre-rotation half against the wrong unit. The round trip was arithmetically
/// perfect and the picture was wrong.
///
/// The transform is [SignatureInk.fit] plus centring — the SAME expression
/// [SignatureInkPainter] uses to draw stored ink into a box of another size — so the
/// mark that was on the pad before the resize is the mark on it afterwards, drawn in
/// the new box. A per-axis stretch would make it a different signature.
///
/// REWRITES IN PLACE, and that is load-bearing rather than a style choice: the caller
/// may be holding the stroke a finger is still drawing, and swapping the list out from
/// under it would leave the rest of that stroke appended to a detached copy — the mark
/// would simply stop at the rotation.
///
/// A degenerate viewport on either side is refused (nothing is rewritten): points
/// measured against 0 would be unitless, and there is no honest transform out of one.
bool rescaleSignatureStrokes(
  List<List<SignaturePoint>> strokes, {
  required double fromWidth,
  required double fromHeight,
  required double toWidth,
  required double toHeight,
}) {
  if (fromWidth == toWidth && fromHeight == toHeight) return false;
  // Checked HERE rather than left to [SignatureInk.fit]: `fit` compares with `<`, and
  // any comparison against NaN is false, so a NaN dimension falls through it as the
  // OTHER axis's scale — a plausible-looking 1.0 that then makes every offset NaN.
  // An infinite dimension does the same to the centring term.
  if (!fromWidth.isFinite ||
      !fromHeight.isFinite ||
      !toWidth.isFinite ||
      !toHeight.isFinite) {
    return false;
  }
  if (fromWidth <= 0 || fromHeight <= 0 || toWidth <= 0 || toHeight <= 0) {
    return false;
  }
  final double scale = SignatureInk(
    width: fromWidth,
    height: fromHeight,
    strokes: const <List<SignaturePoint>>[],
  ).fit(toWidth, toHeight);
  if (!scale.isFinite || scale <= 0) return false;
  final double dx = (toWidth - fromWidth * scale) / 2;
  final double dy = (toHeight - fromHeight * scale) / 2;
  for (final List<SignaturePoint> stroke in strokes) {
    for (int i = 0; i < stroke.length; i++) {
      final SignaturePoint p = stroke[i];
      stroke[i] = SignaturePoint(dx + p.x * scale, dy + p.y * scale);
    }
  }
  return true;
}

/// Round to one decimal place — the stored precision.
///
/// A tenth of a logical pixel is finer than any display can render and finer than any
/// finger can aim; keeping more digits would only add bytes. Applied identically by
/// the web encoder (apps/web/src/screens/pm/use-pm.ts) so the two clients produce the
/// same bytes for the same gesture.
double roundSignatureCoord(double v) => (v * 10).roundToDouble() / 10;

/// Encode [ink] as the stroke JSON stored in `customer_sign`, or null when there is
/// nothing honest to store.
///
/// Returns null — rather than an empty-but-present value — when:
///   * the viewport is degenerate (width/height <= 0 or not finite): the points would
///     be unitless and could never be re-rendered;
///   * no point survives (empty ink): see [SignatureInk.hasInk]. Every reader would
///     take that as a completed signature;
///   * no stroke TRAVELLED [kSignatureMinStrokeSpan] px: see
///     [SignatureInk.hasSignature]. Taps, one-pixel drags and jitter in place all
///     land here. This is the ONE choke point for that rule, deliberately — putting
///     it in the encoder rather than in a screen's button state means no future
///     caller can reach the wire with a stray mark by wiring a control differently.
///
/// A null return is the honest refusal the close path must respect: the `signature`
/// key is then OMITTED from the body entirely. Sending it empty would not merely be
/// useless — `POST /pm/workorders/:id/close` writes `str(...).trim() || null`, so an
/// empty string ERASES a signature that was already there.
String? encodeSignatureInk(SignatureInk ink) {
  if (!ink.width.isFinite || !ink.height.isFinite) return null;
  if (ink.width <= 0 || ink.height <= 0) return null;
  if (!ink.hasSignature) return null;

  final List<List<List<double>>> strokes = <List<List<double>>>[];
  int budget = kSignatureMaxPoints;
  for (final List<SignaturePoint> stroke in ink.strokes) {
    if (budget <= 0) break;
    final List<List<double>> out = <List<double>>[];
    for (final SignaturePoint p in stroke) {
      if (budget <= 0) break;
      // Never store a NaN/infinite coordinate: it survives jsonEncode as `null`,
      // which no reader could re-render.
      if (!p.x.isFinite || !p.y.isFinite) {
        continue;
      }
      out.add(<double>[roundSignatureCoord(p.x), roundSignatureCoord(p.y)]);
      budget--;
    }
    // A pen-down that produced no usable point is not a stroke.
    if (out.isNotEmpty) {
      strokes.add(out);
    }
  }
  if (strokes.isEmpty) return null;

  return jsonEncode(<String, Object?>{
    'v': kSignatureInkVersion,
    'w': roundSignatureCoord(ink.width),
    'h': roundSignatureCoord(ink.height),
    's': strokes,
  });
}

/// Parse stored `customer_sign` stroke JSON back into re-renderable ink, or null.
///
/// Null means "not ink this build can draw", which is NOT the same as "not signed":
/// the column is `text` and predates this encoding, so it may hold an opaque legacy
/// value, and a future `v` may hold a shape this build does not know. Callers must
/// keep treating a non-empty column as SIGNED and fall back to a non-pictorial
/// indicator — never conclude from a null here that the work order is unsigned.
///
/// Strict by construction: an unknown version, a non-positive/non-finite viewport, or
/// any malformed point yields null rather than a partially-guessed drawing. Half of a
/// signature rendered as if it were the whole one is worse than no picture.
SignatureInk? decodeSignatureInk(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (decoded is! Map) return null;

  if (decoded['v'] != kSignatureInkVersion) return null;

  final double? w = _positiveDim(decoded['w']);
  final double? h = _positiveDim(decoded['h']);
  if (w == null || h == null) return null;

  final Object? rawStrokes = decoded['s'];
  if (rawStrokes is! List) return null;

  final List<List<SignaturePoint>> strokes = <List<SignaturePoint>>[];
  for (final Object? rawStroke in rawStrokes) {
    if (rawStroke is! List) return null;
    final List<SignaturePoint> points = <SignaturePoint>[];
    for (final Object? rawPoint in rawStroke) {
      if (rawPoint is! List || rawPoint.length != 2) return null;
      final double? x = _coord(rawPoint[0]);
      final double? y = _coord(rawPoint[1]);
      if (x == null || y == null) return null;
      points.add(SignaturePoint(x, y));
    }
    if (points.isNotEmpty) strokes.add(points);
  }
  if (strokes.isEmpty) return null; // valid JSON, but no mark — see [hasInk]

  return SignatureInk(width: w, height: h, strokes: strokes);
}

/// Whether ONE stroke travelled far enough to be a signature stroke.
///
/// The measure is the bounding-box DIAGONAL, not the summed path length: a finger
/// resting on the pad emits a long jittering path inside a few px, and path length
/// would read that as a mark. A diagonal asks "how far did this get from itself",
/// which is what "it travelled" means.
///
/// NON-FINITE POINTS ARE IGNORED, matching [encodeSignatureInk] — it drops them
/// before writing, so counting them here would let a stroke qualify on coordinates
/// that never reach the wire.
///
/// Compared squared, so no `dart:math` import is needed for a pure-`dart:convert`
/// file and no square root runs on a 60 Hz path.
bool _isSignatureStroke(List<SignaturePoint> stroke) {
  double? minX;
  double maxX = 0;
  double minY = 0;
  double maxY = 0;
  for (final SignaturePoint p in stroke) {
    if (!p.x.isFinite || !p.y.isFinite) continue;
    if (minX == null) {
      minX = p.x;
      maxX = p.x;
      minY = p.y;
      maxY = p.y;
      continue;
    }
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX == null) return false;
  final double dx = maxX - minX;
  final double dy = maxY - minY;
  return dx * dx + dy * dy >= kSignatureMinStrokeSpan * kSignatureMinStrokeSpan;
}

/// A finite, strictly positive viewport dimension, else null.
double? _positiveDim(Object? v) {
  final double? d = _coord(v);
  if (d == null || d <= 0) return null;
  return d;
}

/// A finite numeric coordinate, else null. Strings are REJECTED rather than parsed:
/// this encoder never writes one, so a string here means the value came from
/// something else and its shape is not this shape.
double? _coord(Object? v) {
  if (v is num) {
    final double d = v.toDouble();
    return d.isFinite ? d : null;
  }
  return null;
}
