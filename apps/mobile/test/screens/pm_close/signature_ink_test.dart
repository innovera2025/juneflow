// Unit tests for the `customer_sign` stroke-JSON codec (BLOCKERS.md B-331).
//
// This is the wire encoding two platforms share, so the tests are about the CONTRACT,
// not about the pad: the exact bytes, the round trip, the re-render at a different
// size, and every case where the encoder must REFUSE rather than produce a value that
// would be read as the customer's consent.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/pm_close/signature_ink.dart';

SignatureInk _ink(
  List<List<List<double>>> strokes, {
  double w = 300,
  double h = 110,
}) => SignatureInk(
  width: w,
  height: h,
  strokes: <List<SignaturePoint>>[
    for (final List<List<double>> s in strokes)
      <SignaturePoint>[
        for (final List<double> p in s) SignaturePoint(p[0], p[1]),
      ],
  ],
);

void main() {
  group('the shape as shipped', () {
    test('encodes exactly {v,w,h,s} and nothing else', () {
      final String? raw = encodeSignatureInk(
        _ink(<List<List<double>>>[
          <List<double>>[
            <double>[12, 40.5],
            <double>[13, 41.2],
          ],
          <List<double>>[
            <double>[80, 44],
            <double>[81, 44],
          ],
        ]),
      );
      expect(raw, isNotNull);
      final Map<String, Object?> j = jsonDecode(raw!) as Map<String, Object?>;

      // The key set is the contract. An EXTRA key would be a silent schema change on
      // a bare `text` column with no migration path, so it is pinned exhaustively.
      expect(j.keys.toSet(), <String>{'v', 'w', 'h', 's'});
      expect(j['v'], 1);
      expect(j['w'], 300.0);
      expect(j['h'], 110.0);
      expect(j['s'], <Object?>[
        <Object?>[
          <Object?>[12.0, 40.5],
          <Object?>[13.0, 41.2],
        ],
        <Object?>[
          <Object?>[80.0, 44.0],
          <Object?>[81.0, 44.0],
        ],
      ]);
    });

    test('stores NO pressure, NO timing and NO signer identity', () {
      // Each was excluded on purpose (see signature_ink.dart): pressure is a constant
      // on non-force digitizers; per-point timing would turn an inert mark into
      // BIOMETRIC data with no consent surface; the signer's name is three hops away
      // and would be fabricated. A regression that started storing any of them would
      // be invisible to every other test in this file.
      final String raw = encodeSignatureInk(
        _ink(<List<List<double>>>[
          <List<double>>[
            <double>[1, 2],
            <double>[3, 4],
          ],
        ]),
      )!;
      for (final String forbidden in <String>[
        'pressure',
        'force',
        't',
        'time',
        'ts',
        'name',
        'signer',
        'device',
      ]) {
        expect(
          (jsonDecode(raw) as Map<String, Object?>).containsKey(forbidden),
          isFalse,
          reason: 'the blob carries "$forbidden"',
        );
      }
    });

    test('rounds coordinates to one decimal place', () {
      final String raw = encodeSignatureInk(
        _ink(<List<List<double>>>[
          <List<double>>[
            <double>[12.34567, 40.55],
            <double>[13.99, 41.04],
          ],
        ]),
      )!;
      expect((jsonDecode(raw) as Map<String, Object?>)['s'], <Object?>[
        <Object?>[
          <Object?>[12.3, 40.6],
          <Object?>[14.0, 41.0],
        ],
      ]);
    });
  });

  group('round trip', () {
    test('draw -> serialise -> parse gives back the same ink', () {
      final SignatureInk original = _ink(
        <List<List<double>>>[
          <List<double>>[
            <double>[12, 40.5],
            <double>[13.4, 41.2],
            <double>[20, 44],
          ],
          <List<double>>[
            <double>[80, 44],
            <double>[95.5, 12.1],
          ],
        ],
        w: 320,
        h: 110,
      );

      final SignatureInk back = decodeSignatureInk(
        encodeSignatureInk(original),
      )!;

      expect(back.width, 320);
      expect(back.height, 110);
      expect(back.strokes.length, 2);
      expect(back.strokes[0].length, 3);
      expect(back.strokes[1], <SignaturePoint>[
        const SignaturePoint(80, 44),
        const SignaturePoint(95.5, 12.1),
      ]);
      expect(back.pointCount, original.pointCount);
    });

    test(
      're-encoding parsed ink is byte-identical (stable, not lossy-drifting)',
      () {
        final String first = encodeSignatureInk(
          _ink(<List<List<double>>>[
            <List<double>>[
              <double>[12.34567, 40.55],
              <double>[13.99, 41.04],
            ],
          ]),
        )!;
        // A value that changed on every save/load cycle would make stored signatures
        // impossible to compare or de-duplicate.
        expect(encodeSignatureInk(decodeSignatureInk(first)!), first);
      },
    );

    test(
      'RESIZE — parsed ink re-renders into a box of a DIFFERENT size, undistorted',
      () {
        // The reason w/h are stored at all. A 300x110 phone capture shown in a
        // 640x180 web box must scale uniformly and stay inside the target.
        final SignatureInk ink = decodeSignatureInk(
          encodeSignatureInk(
            _ink(
              <List<List<double>>>[
                <List<double>>[
                  <double>[0, 0],
                  <double>[300, 110],
                ],
              ],
              w: 300,
              h: 110,
            ),
          ),
        )!;

        // min(640/300, 180/110) = min(2.133…, 1.636…) = the HEIGHT-bound scale.
        final double scale = ink.fit(640, 180);
        expect(scale, closeTo(180 / 110, 1e-9));

        // Uniform: one scale for both axes, so the mark is not stretched.
        expect(ink.width * scale, lessThanOrEqualTo(640 + 1e-9));
        expect(ink.height * scale, closeTo(180, 1e-9));

        // …and the same ink shrinks into a box SMALLER than it was captured in.
        final double small = ink.fit(150, 55);
        expect(small, closeTo(0.5, 1e-9));
        expect(ink.width * small, closeTo(150, 1e-9));

        // A degenerate target draws nothing rather than dividing by zero.
        expect(ink.fit(0, 100), 0);
        expect(ink.fit(100, 0), 0);
      },
    );
  });

  group('the encoder REFUSES rather than fabricating consent', () {
    test('an EMPTY pad encodes to null — never an empty-but-present value', () {
      // The defect this prevents: `{"v":1,"w":300,"h":110,"s":[]}` is a NON-EMPTY
      // string, and every reader in the product (web wo-rows.ts L206, mobile
      // pm_jobs_agg L128, api counts.ts L132) marks the work order DONE on non-
      // emptiness alone, without looking inside. That is a fabricated record of the
      // customer's consent.
      expect(encodeSignatureInk(_ink(<List<List<double>>>[])), isNull);
      expect(
        encodeSignatureInk(_ink(<List<List<double>>>[<List<double>>[]])),
        isNull,
      );
    });

    test('a pad carrying only TAPS encodes to null', () {
      // A single-point stroke is a tap — the exact gesture the prototype used to
      // fabricate a signature, and what an accidental brush produces.
      expect(
        encodeSignatureInk(
          _ink(<List<List<double>>>[
            <List<double>>[
              <double>[10, 10],
            ],
            <List<double>>[
              <double>[20, 20],
            ],
          ]),
        ),
        isNull,
      );
    });

    test('a dot INSIDE a real signature is kept', () {
      // The complement of the rule above: the dot over an "i" must survive.
      final String raw = encodeSignatureInk(
        _ink(<List<List<double>>>[
          <List<double>>[
            <double>[10, 10],
            <double>[30, 30],
          ],
          <List<double>>[
            <double>[40, 5],
          ],
        ]),
      )!;
      expect((jsonDecode(raw) as Map<String, Object?>)['s'], hasLength(2));
    });

    test(
      'a degenerate viewport encodes to null (points would be unitless)',
      () {
        final List<List<List<double>>> s = <List<List<double>>>[
          <List<double>>[
            <double>[1, 1],
            <double>[2, 2],
          ],
        ];
        expect(encodeSignatureInk(_ink(s, w: 0)), isNull);
        expect(encodeSignatureInk(_ink(s, h: -5)), isNull);
        expect(encodeSignatureInk(_ink(s, w: double.nan)), isNull);
        expect(encodeSignatureInk(_ink(s, h: double.infinity)), isNull);
      },
    );

    test('non-finite coordinates are dropped, not written as JSON null', () {
      // jsonEncode turns NaN/Infinity handling into a trap: a point that survived as
      // `null` would decode to nothing renderable.
      final String raw = encodeSignatureInk(
        const SignatureInk(
          width: 300,
          height: 110,
          strokes: <List<SignaturePoint>>[
            <SignaturePoint>[
              SignaturePoint(1, 1),
              SignaturePoint(double.nan, 5),
              SignaturePoint(2, 2),
            ],
          ],
        ),
      )!;
      expect(raw, isNot(contains('null')));
      expect(decodeSignatureInk(raw)!.strokes.single, hasLength(2));
    });

    test(
      'the point budget is a hard cap, and truncation keeps a real prefix',
      () {
        final SignatureInk huge = SignatureInk(
          width: 300,
          height: 110,
          strokes: <List<SignaturePoint>>[
            <SignaturePoint>[
              for (int i = 0; i < kSignatureMaxPoints + 500; i++)
                SignaturePoint(i % 300, i % 110),
            ],
          ],
        );
        final SignatureInk back = decodeSignatureInk(encodeSignatureInk(huge))!;
        expect(back.pointCount, kSignatureMaxPoints);
        // A prefix, so what is stored is genuinely the start of what was drawn.
        expect(back.strokes.single.first, const SignaturePoint(0, 0));
      },
    );
  });

  group('cross-platform: the WEB encoder writes the same column', () {
    test("Dart decodes the web encoder's INTEGER-valued output", () {
      // Not a hypothetical difference. Dart's jsonEncode writes a whole double as
      // `300.0`; JSON.stringify writes `300`. Both are the same NUMBER, and nothing
      // anywhere compares these strings — but a decoder that only accepted doubles
      // would refuse every signature captured on the web, and the failure mode would
      // be silent (the pad falls back to a check icon, which reads as "signed but not
      // drawable"). This is the literal output of encodeSignatureInk in
      // apps/web/src/screens/pm/use-pm.ts for the same input.
      const String fromWeb =
          '{"v":1,"w":300,"h":110,"s":[[[12,40.5],[13,41.2]],[[80,44],[81,44]]]}';
      final SignatureInk ink = decodeSignatureInk(fromWeb)!;

      expect(ink.width, 300);
      expect(ink.height, 110);
      expect(ink.strokes, <List<SignaturePoint>>[
        <SignaturePoint>[
          const SignaturePoint(12, 40.5),
          const SignaturePoint(13, 41.2),
        ],
        <SignaturePoint>[
          const SignaturePoint(80, 44),
          const SignaturePoint(81, 44),
        ],
      ]);
      // …and it re-renders like any other ink.
      expect(ink.fit(600, 220), closeTo(2, 1e-9));
    });

    test('and the DART encoder round-trips its own doubles', () {
      // The other direction, so neither encoder is only ever read by itself.
      const String fromDart =
          '{"v":1,"w":300.0,"h":110.0,"s":[[[12.0,40.5],[13.0,41.2]]]}';
      final SignatureInk ink = decodeSignatureInk(fromDart)!;
      expect(ink.width, 300);
      expect(ink.strokes.single, hasLength(2));
    });
  });

  group('the decoder REFUSES rather than half-drawing', () {
    test('null / empty / non-JSON / non-object', () {
      expect(decodeSignatureInk(null), isNull);
      expect(decodeSignatureInk(''), isNull);
      expect(decodeSignatureInk('not json'), isNull);
      expect(decodeSignatureInk('[1,2,3]'), isNull);
      expect(decodeSignatureInk('"a string"'), isNull);
    });

    test('an UNKNOWN version is refused, not guessed at', () {
      // Why `v` exists: `customer_sign` is a bare text column with no migration path,
      // so a future shape change is only detectable by this field.
      expect(
        decodeSignatureInk('{"v":2,"w":10,"h":10,"s":[[[1,1],[2,2]]]}'),
        isNull,
      );
      expect(decodeSignatureInk('{"w":10,"h":10,"s":[[[1,1],[2,2]]]}'), isNull);
    });

    test('a LEGACY opaque blob decodes to null — which is NOT "unsigned"', () {
      // The column predates this encoding. Callers must keep reading the column's
      // EMPTINESS for signed-ness and treat a null here as "cannot draw it".
      expect(decodeSignatureInk('sig-blob'), isNull);
      expect(decodeSignatureInk('data:image/png;base64,iVBOR'), isNull);
    });

    test('a malformed point poisons the whole value', () {
      // Half a signature rendered as if it were the whole one is worse than no
      // picture, so one bad point rejects the value rather than being skipped.
      for (final String bad in <String>[
        '{"v":1,"w":10,"h":10,"s":[[[1]]]}', // wrong arity
        '{"v":1,"w":10,"h":10,"s":[[[1,2,3]]]}', // wrong arity
        '{"v":1,"w":10,"h":10,"s":[[["1","2"]]]}', // strings, not numbers
        '{"v":1,"w":10,"h":10,"s":[[[1,null]]]}',
        '{"v":1,"w":10,"h":10,"s":[["nope"]]}',
        '{"v":1,"w":10,"h":10,"s":"nope"}',
      ]) {
        expect(decodeSignatureInk(bad), isNull, reason: bad);
      }
    });

    test('a non-positive viewport is refused', () {
      expect(
        decodeSignatureInk('{"v":1,"w":0,"h":10,"s":[[[1,1],[2,2]]]}'),
        isNull,
      );
      expect(
        decodeSignatureInk('{"v":1,"w":10,"h":-1,"s":[[[1,1],[2,2]]]}'),
        isNull,
      );
      expect(
        decodeSignatureInk('{"v":1,"w":"10","h":10,"s":[[[1,1],[2,2]]]}'),
        isNull,
      );
    });

    test('a valid but INK-LESS value decodes to null', () {
      // The mirror of the encoder's refusal: if such a value ever reached the column
      // from elsewhere, nothing here treats it as a drawable signature.
      expect(decodeSignatureInk('{"v":1,"w":10,"h":10,"s":[]}'), isNull);
      expect(decodeSignatureInk('{"v":1,"w":10,"h":10,"s":[[]]}'), isNull);
    });
  });
}
