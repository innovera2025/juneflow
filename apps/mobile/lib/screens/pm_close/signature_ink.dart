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
const double kSignatureMinPointGap = 1.0;

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

  /// Whether this ink is a SIGNATURE — at least one stroke that actually moved.
  ///
  /// Stricter than [hasInk], and the difference is the whole point: a single-point
  /// stroke is a TAP, and a tap is precisely the gesture the prototype used to
  /// fabricate a signature (pototype/mobile-pm.jsx L206 flips a flag and paints a
  /// hardcoded name). It is also what an accidental brush against the pad produces.
  /// Since every reader treats a non-empty `customer_sign` as the customer's
  /// consent, a stray dot must not be able to close a work order.
  ///
  /// Dots inside a REAL signature are unaffected — the dot over an "i" rides along
  /// with the strokes that moved; it simply cannot be the only thing on the pad.
  bool get hasSignature =>
      strokes.any((List<SignaturePoint> s) => s.length >= 2);

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
///   * nothing but taps was captured: see [SignatureInk.hasSignature]. This is the
///     ONE choke point for that rule, deliberately — putting it in the encoder rather
///     than in a screen's button state means no future caller can reach the wire with
///     a stray dot by wiring a control differently.
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
