// Unit tests for the mobile store awaiting-PO-receipt honest-derivation logic
// (route st-grlist).
//
// These assert the rules that keep the screen honest: the list is the REAL POs
// narrowed to the receivable (approved) set, the vendor name is a real GET
// /vendors join (never invented), and nothing is fabricated for the mock-only
// items/due/truck/urgent/warehouse fields (po.ts wire gaps).
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/st_grlist/st_grlist_agg.dart';

/// The vendors page used across the join tests.
const List<StGrEnt> _vendors = <StGrEnt>[
  <String, Object?>{'id': 'v1', 'name': 'บจก. ไทยสตีล'},
  <String, Object?>{'id': 'v2', 'name': 'หจก. ศรีสุขคอนกรีต'},
  <String, Object?>{'id': 'v3'}, // no name → skipped
];

void main() {
  group('parsePo', () {
    test('projects the real wire columns onto a typed row', () {
      final StGrRow r = parsePo(<String, Object?>{
        'id': 'po1',
        'no': 'PO-2569-0388',
        'vendor_id': 'v1',
        'status': 'approved',
      }, vendorNameMap(_vendors));
      expect(r.id, 'po1');
      expect(r.no, 'PO-2569-0388');
      expect(r.vendorId, 'v1');
      expect(r.status, 'approved');
      expect(r.vendorName, 'บจก. ไทยสตีล');
    });

    test('accepts camelCase vendorId as well as snake_case vendor_id', () {
      final StGrRow r = parsePo(<String, Object?>{
        'vendorId': 'v2',
      }, vendorNameMap(_vendors));
      expect(r.vendorId, 'v2');
      expect(r.vendorName, 'หจก. ศรีสุขคอนกรีต');
    });

    test('vendorName is null when the vendor is not in the fetched page', () {
      final StGrRow r = parsePo(<String, Object?>{
        'vendor_id': 'unknown',
      }, vendorNameMap(_vendors));
      expect(r.vendorName, isNull);
    });

    test('vendorName is null when the PO carries no vendor_id', () {
      final StGrRow r = parsePo(<String, Object?>{
        'no': 'PO-1',
      }, vendorNameMap(_vendors));
      expect(r.vendorId, '');
      expect(r.vendorName, isNull);
    });

    test(
      'missing string fields default to empty, never a fabricated value',
      () {
        final StGrRow r = parsePo(
          const <String, Object?>{},
          const <String, String>{},
        );
        expect(r.id, '');
        expect(r.no, '');
        expect(r.vendorId, '');
        expect(r.status, '');
        expect(r.vendorName, isNull);
      },
    );
  });

  group('vendorNameMap', () {
    test('maps id → name and skips rows with no id or no name', () {
      final Map<String, String> m = vendorNameMap(_vendors);
      expect(m, <String, String>{
        'v1': 'บจก. ไทยสตีล',
        'v2': 'หจก. ศรีสุขคอนกรีต',
      });
      expect(m.containsKey('v3'), isFalse);
    });
  });

  group(
    'parseAwaitingPos — receivable (approved) only, vendor-joined, ordered',
    () {
      test('keeps only approved POs (draft/pending/rejected are dropped)', () {
        final List<StGrRow> rows = parseAwaitingPos(<StGrEnt>[
          <String, Object?>{'id': 'a', 'no': 'PO-3', 'status': 'approved'},
          <String, Object?>{'id': 'b', 'no': 'PO-1', 'status': 'draft'},
          <String, Object?>{'id': 'c', 'no': 'PO-2', 'status': 'pending'},
          <String, Object?>{'id': 'd', 'no': 'PO-4', 'status': 'rejected'},
          <String, Object?>{'id': 'e', 'no': 'PO-0', 'status': 'approved'},
        ], _vendors);
        expect(rows.map((StGrRow r) => r.id).toList(), <String>['e', 'a']);
      });

      test('orders by PO no ascending; an empty no sorts last', () {
        final List<StGrRow> rows = parseAwaitingPos(<StGrEnt>[
          <String, Object?>{
            'id': 'x',
            'no': 'PO-2569-0394',
            'status': 'approved',
          },
          <String, Object?>{'id': 'y', 'no': '', 'status': 'approved'},
          <String, Object?>{
            'id': 'z',
            'no': 'PO-2569-0388',
            'status': 'approved',
          },
        ], _vendors);
        expect(rows.map((StGrRow r) => r.no).toList(), <String>[
          'PO-2569-0388',
          'PO-2569-0394',
          '',
        ]);
      });

      test('joins the real vendor name onto each kept row', () {
        final List<StGrRow> rows = parseAwaitingPos(<StGrEnt>[
          <String, Object?>{
            'id': 'a',
            'no': 'PO-1',
            'vendor_id': 'v1',
            'status': 'approved',
          },
        ], _vendors);
        expect(rows.single.vendorName, 'บจก. ไทยสตีล');
      });

      test('an empty PO page yields an empty list (honest-empty)', () {
        expect(parseAwaitingPos(const <StGrEnt>[], _vendors), isEmpty);
      });
    },
  );
}
