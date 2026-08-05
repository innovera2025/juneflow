// Unit tests for the pure pm-close derivations (no Flutter, no network).
//
// The point of most of these is the SAME reasoning error, applied at every site in
// this screen where a value is composed from more than one independently-absent
// input: finding the container does not establish that its contents exist. So
// `assetLine` is asserted per column, `tallyChecks` per checklist line, and the
// always-null summary slots are pinned as always-null so a later "improvement"
// cannot quietly start deriving a duration, a parts total, or a customer name from
// something that does not carry one.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_agg.dart';

PmCloseEnt _asset(String id, {String? name, String? code}) => <String, Object?>{
  'id': id,
  if (name != null) 'name': name,
  if (code != null) 'code': code,
};

PmCloseEnt _wo(
  String id, {
  String? assetId,
  Object? items,
  String? customerSign,
}) => <String, Object?>{
  'id': id,
  if (assetId != null) 'asset_id': assetId,
  if (items != null) 'items': items,
  if (customerSign != null) 'customer_sign': customerSign,
};

Map<String, Object?> _line(String label, [String? result]) => <String, Object?>{
  'label': label,
  if (result != null) 'result': result,
};

void main() {
  group('findWorkOrder', () {
    test('matches by id and yields null for an id not in the page', () {
      final List<PmCloseEnt> rows = <PmCloseEnt>[_wo('a'), _wo('b')];
      expect(findWorkOrder(rows, 'b')?['id'], 'b');
      expect(findWorkOrder(rows, 'zzz'), isNull);
      expect(findWorkOrder(rows, ''), isNull);
      expect(findWorkOrder(const <PmCloseEnt>[], 'a'), isNull);
    });
  });

  group('assetLine — each column decided on its OWN presence', () {
    // The defect this guards: gating on "the asset row was found" and then printing
    // "$name ($code)" regardless. Both columns are nullable INDEPENDENTLY
    // (pm_asset.name / pm_asset.code, migration 0034), so a found row proves neither.
    test('both columns -> the prototype "name (code)" shape', () {
      expect(assetLine('Lift MX-1000', 'LIFT-A01'), 'Lift MX-1000 (LIFT-A01)');
    });

    test('name only -> the name alone, with no orphan parentheses', () {
      expect(assetLine('Lift MX-1000', null), 'Lift MX-1000');
      expect(assetLine('Lift MX-1000', ''), 'Lift MX-1000');
    });

    test('code only -> the bare code, not "(code)"', () {
      expect(assetLine(null, 'LIFT-A01'), 'LIFT-A01');
      expect(assetLine('', 'LIFT-A01'), 'LIFT-A01');
    });

    test('neither -> null, so the row em-dashes', () {
      expect(assetLine(null, null), isNull);
      expect(assetLine('', ''), isNull);
    });
  });

  group('buildAssetMap', () {
    test('indexes by id and keeps each display column separately nullable', () {
      final Map<String, PmCloseAsset> map = buildAssetMap(<PmCloseEnt>[
        _asset('a1', name: 'Lift', code: 'L-1'),
        _asset('a2', name: 'Pump'), // no code
        _asset('a3', code: 'C-3'), // no name
        _asset('a4'), // neither
      ]);
      expect(map['a1']!.name, 'Lift');
      expect(map['a1']!.code, 'L-1');
      expect(map['a2']!.code, isNull);
      expect(map['a3']!.name, isNull);
      expect(map['a4']!.name, isNull);
      expect(map['a4']!.code, isNull);
    });

    test('a row with no id is skipped (nothing could join to it)', () {
      expect(
        buildAssetMap(<PmCloseEnt>[
          <String, Object?>{'name': 'orphan'},
        ]),
        isEmpty,
      );
    });
  });

  group('tallyChecks — every count is per line', () {
    test('counts checked + repair from each line OWN stored result', () {
      final PmCloseChecks c = tallyChecks(<Object?>[
        _line('a', 'normal'),
        _line('b', 'adjust'),
        _line('c', 'repair'),
        _line('d', 'repair'),
        _line('e'), // unchecked
      ]);
      expect(c.total, 5);
      expect(c.checked, 4);
      expect(c.repair, 2);
      expect(c.hasLines, isTrue);
    });

    test('a result outside the server vocabulary is UNCHECKED, not checked', () {
      // pm.ts CHECKLIST_RESULTS is normal|adjust|repair. Anything else is not a
      // result, so it must not inflate the "checked" numerator — that is the
      // every-element-numerator / qualifying-element-denominator mismatch.
      final PmCloseChecks c = tallyChecks(<Object?>[
        _line('a', 'done'),
        _line('b', ''),
        _line('c', 'REPAIR'), // wrong case is not the stored value
        _line('d', 'normal'),
      ]);
      expect(c.total, 4);
      expect(c.checked, 1);
      expect(c.repair, 0);
    });

    test('a non-object entry is not a line at all', () {
      final PmCloseChecks c = tallyChecks(<Object?>[
        _line('a', 'normal'),
        'garbage',
        42,
        null,
      ]);
      expect(c.total, 1);
      expect(c.checked, 1);
    });

    test(
      'an empty or non-list items yields hasLines=false (0/0 is NOT "done")',
      () {
        // The trap: 0/0 renders as a fully checked list. A tally over nothing is not a
        // statement about the job, so the view must withhold it.
        for (final Object? items in <Object?>[
          <Object?>[],
          null,
          'not a list',
          <String, Object?>{'not': 'a list'},
        ]) {
          final PmCloseChecks c = tallyChecks(items);
          expect(c.total, 0, reason: 'items=$items');
          expect(c.checked, 0);
          expect(c.repair, 0);
          expect(
            c.hasLines,
            isFalse,
            reason: 'items=$items must not read as done',
          );
        }
      },
    );

    test('all lines unchecked still hasLines — 0/5 is a real fact', () {
      final PmCloseChecks c = tallyChecks(<Object?>[_line('a'), _line('b')]);
      expect(c.hasLines, isTrue);
      expect(c.checked, 0);
      expect(c.total, 2);
    });
  });

  group('isSigned — the stored column, never a gesture', () {
    test('a non-empty customer_sign is signed', () {
      expect(isSigned(_wo('w', customerSign: 'sig-blob')), isTrue);
    });

    test('absent or blank customer_sign is NOT signed', () {
      expect(isSigned(_wo('w')), isFalse);
      expect(isSigned(_wo('w', customerSign: '')), isFalse);
    });

    test('a non-string customer_sign is not a signature', () {
      expect(
        isSigned(<String, Object?>{'id': 'w', 'customer_sign': 1}),
        isFalse,
      );
      expect(
        isSigned(<String, Object?>{'id': 'w', 'customer_sign': true}),
        isFalse,
      );
    });
  });

  group('buildSummary', () {
    test('joins the asset, tallies the checks and reads the signature', () {
      final PmCloseSummary s = buildSummary(
        _wo(
          'w1',
          assetId: 'a1',
          items: <Object?>[_line('x', 'repair'), _line('y', 'normal')],
          customerSign: 'sig',
        ),
        buildAssetMap(<PmCloseEnt>[_asset('a1', name: 'Lift', code: 'L-1')]),
      );
      expect(s.asset, 'Lift (L-1)');
      expect(s.checks.total, 2);
      expect(s.checks.checked, 2);
      expect(s.checks.repair, 1);
      expect(s.signed, isTrue);
    });

    test('a missing asset row em-dashes the asset row, never the uuid', () {
      final PmCloseSummary s = buildSummary(
        _wo('w1', assetId: 'a-gone'),
        const <String, PmCloseAsset>{},
      );
      expect(s.asset, isNull);
      // Belt and braces: the raw id must not leak into the rendered value.
      expect(s.asset, isNot(contains('a-gone')));
    });

    test('an asset row found but empty is still null (found != populated)', () {
      final PmCloseSummary s = buildSummary(
        _wo('w1', assetId: 'a1'),
        buildAssetMap(<PmCloseEnt>[_asset('a1')]),
      );
      expect(s.asset, isNull);
    });

    test('a work order with no asset_id em-dashes the asset row', () {
      final PmCloseSummary s = buildSummary(
        _wo('w1'),
        buildAssetMap(<PmCloseEnt>[_asset('a1', name: 'Lift')]),
      );
      expect(s.asset, isNull);
    });

    test('the four unbacked slots are ALWAYS null, whatever the wire carries', () {
      // Pins the honest gaps so a later change cannot start deriving them. Each has
      // a different reason (see PmCloseSummary): no clock column at all for the two
      // time rows, no parts column + money = SERVER for parts, and a customer name
      // that stops at a uuid three hops away for the recipient.
      for (final PmCloseEnt wo in <PmCloseEnt>[
        _wo('w1'),
        _wo(
          'w1',
          assetId: 'a1',
          items: <Object?>[_line('a', 'normal')],
          customerSign: 'sig',
        ),
        // Even if the wire grew these keys tomorrow, the slots stay null until a
        // slice deliberately wires them.
        <String, Object?>{
          'id': 'w1',
          'created_at': '2026-08-05T09:14:00Z',
          'updated_at': '2026-08-05T10:48:00Z',
          'parts': <Object?>[
            <String, Object?>{'label': 'p', 'qty': 1, 'price': 3200},
          ],
          'customer': 'someone',
        },
      ]) {
        final PmCloseSummary s = buildSummary(
          wo,
          const <String, PmCloseAsset>{},
        );
        expect(s.startEnd, isNull);
        expect(s.totalTime, isNull);
        expect(s.parts, isNull);
        expect(s.recipient, isNull);
      }
    });
  });
}
