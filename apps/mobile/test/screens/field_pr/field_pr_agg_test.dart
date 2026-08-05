// Unit tests for the field-pr parse + honest derivations.
//
// Pure Dart — no Flutter, no network. Each test pins ONE honest rule, so reverting
// that rule turns exactly this test red.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/field_pr/field_pr_agg.dart';

/// A BOQ doc row shaped exactly like docWire (apps/api/src/routes/boq.ts).
FieldPrEnt _boq({
  String id = 'b1',
  String? no = 'BOQ-2026-B-02',
  String? name = 'Block B structure',
  String projectId = 'proj1',
  String status = 'approved',
}) => <String, Object?>{
  'id': id,
  'no': no,
  'name': name,
  'scope': null,
  'project_id': projectId,
  'version': 1,
  'status': status,
  'currency_code': 'THB',
  'total': 8200000,
};

/// A BOQ item row shaped exactly like itemWire (boq.ts).
FieldPrEnt _item({
  String id = 'i1',
  String? code = 'ST-016',
  String? name = 'Rebar SD40 16mm',
  String? unit = 'length',
  Object? remainQty = 120,
}) => <String, Object?>{
  'id': id,
  'group_id': 'g1',
  'code': code,
  'name': name,
  'detail': null,
  'cat': 'M',
  'qty': 500,
  'unit': unit,
  'price': 683.33,
  'currency_code': 'THB',
  'remain_qty': remainQty,
};

void main() {
  group('BOQ documents', () {
    test('a doc keeps only real columns', () {
      final FieldPrBoq b = parseBoqDoc(_boq());
      expect(b.id, 'b1');
      expect(b.no, 'BOQ-2026-B-02');
      expect(b.name, 'Block B structure');
      // The PR's project comes from the BOQ's own project_id — nothing is guessed
      // and no separate project picker is invented.
      expect(b.projectId, 'proj1');
      expect(b.status, 'approved');
    });

    test('a doc with no project_id is not selectable — POST /pr would 400', () {
      final List<FieldPrBoq> rows = selectableBoqs(<FieldPrEnt>[
        _boq(id: 'ok'),
        _boq(id: 'noproj', projectId: ''),
        _boq(id: ''),
      ]);
      expect(rows.map((FieldPrBoq b) => b.id).toList(), <String>['ok']);
    });

    test('docs are NOT narrowed by status — the server imposes no such rule', () {
      // Only POST /boq/{id}/generate-pr requires an approved BOQ; POST /pr does not.
      // Filtering here would be a business rule this port invented.
      final List<FieldPrBoq> rows = selectableBoqs(<FieldPrEnt>[
        _boq(id: 'a', no: 'A', status: 'draft'),
        _boq(id: 'b', no: 'B', status: 'approved'),
        _boq(id: 'c', no: 'C', status: 'revise'),
      ]);
      expect(rows.length, 3);
    });

    test('docs sort by number, un-numbered last', () {
      final List<FieldPrBoq> rows = selectableBoqs(<FieldPrEnt>[
        _boq(id: 'b', no: 'BOQ-2'),
        _boq(id: 'none', no: null),
        _boq(id: 'a', no: 'BOQ-1'),
      ]);
      expect(rows.map((FieldPrBoq b) => b.id).toList(), <String>[
        'a',
        'b',
        'none',
      ]);
    });
  });

  group('BOQ items', () {
    test('an item keeps only real columns', () {
      final FieldPrItem it = parseBoqItem(_item());
      expect(it.id, 'i1');
      expect(it.code, 'ST-016');
      expect(it.name, 'Rebar SD40 16mm');
      expect(it.unit, 'length');
      expect(it.remainQty, 120);
    });

    test('the typed item exposes NO price or estimate field', () {
      // The wire row carries price=683.33 + currency THB. The projection drops both:
      // qty x price is client money math (money = SERVER), and on a screen that
      // creates a requisition a price beside a quantity reads as its value.
      final FieldPrItem it = parseBoqItem(_item());
      expect(it.remainQty, isNotNull);
      expect(FieldPrItem.estimate, contains('withheld'));
    });

    test('a missing remaining quantity is null, never 0', () {
      expect(parseBoqItem(_item(remainQty: null)).remainQty, isNull);
      // A numeric-string wire value still parses.
      expect(parseBoqItem(_item(remainQty: '12.5')).remainQty, 12.5);
    });

    test('an item with no id is dropped', () {
      final List<FieldPrItem> rows = parseBoqItems(<FieldPrEnt>[
        _item(id: ''),
        _item(id: 'keep'),
      ]);
      expect(rows.map((FieldPrItem i) => i.id).toList(), <String>['keep']);
    });
  });

  group('requested quantity', () {
    test('accepts what the server accepts', () {
      expect(parseRequestedQty('120'), 120);
      expect(parseRequestedQty(' 12.5 '), 12.5);
      // The server rejects qty < 0 only, so 0 is permitted here too — inventing a
      // stricter rule is not this screen's place.
      expect(parseRequestedQty('0'), 0);
    });

    test('rejects what the server would reject or cannot read', () {
      for (final String bad in <String>['', '  ', 'abc', '-1', '1e999']) {
        expect(parseRequestedQty(bad), isNull, reason: bad);
      }
    });
  });

  group('PR payload', () {
    Map<String, Object?> body() => prPayload(
      no: '  PR-2026-0777  ',
      projectId: 'proj1',
      boqItemId: 'i1',
      qty: 120,
    );

    test('carries the requester-entered number, trimmed', () {
      expect(body()['no'], 'PR-2026-0777');
    });

    test('carries the fixed type and the BOQ-derived project', () {
      expect(body()['type'], kFieldPrType);
      expect(kFieldPrType, 'material');
      expect(body()['project_id'], 'proj1');
    });

    test('carries exactly one line, referencing the real BOQ item', () {
      final List<Object?> items = body()['items']! as List<Object?>;
      expect(items.length, 1);
      expect(items.single, <String, Object?>{'boq_item_id': 'i1', 'qty': 120});
    });

    test('sends no amount and no need_date', () {
      final Map<String, Object?> b = body();
      for (final String k in <String>[
        'amount',
        'total',
        'price',
        'currency_code',
        'need_date',
        'needDate',
        'urgency',
      ]) {
        expect(b.containsKey(k), isFalse, reason: k);
      }
    });
  });

  group('the created PR amount', () {
    test('is read straight off the 201 body', () {
      final ({num amount, String currency})? a = createdPrAmount(
        <String, Object?>{'amount': 82000, 'currency_code': 'THB'},
      );
      expect(a?.amount, 82000);
      expect(a?.currency, 'THB');
    });

    test('is null when either half is missing — never a partial figure', () {
      expect(createdPrAmount(<String, Object?>{'amount': 82000}), isNull);
      expect(
        createdPrAmount(<String, Object?>{'currency_code': 'THB'}),
        isNull,
      );
      expect(createdPrAmount(const <String, Object?>{}), isNull);
    });
  });
}
