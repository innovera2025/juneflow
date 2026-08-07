// Unit tests for the pure field-gr aggregate (route field-gr).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
//
// The centre of gravity is the WITHHELD cases. This screen's whole position is
// that an absent value renders as an em-dash and never as 0, and that a quantity
// the wire did not carry cannot tint a row "complete" — so every absence gets its
// own test, and each one dies if the null-handling is replaced by a default.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/field_gr/field_gr_agg.dart';

/// One real gr_item wire row (gr.ts grItemWire), with the money fields PRESENT —
/// so a test can prove the agg drops them rather than merely never seeing them.
FieldGrEnt _item({
  String id = 'gi-1',
  Object? name = 'ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ',
  Object? orderedQty = 480,
  Object? receivedQty = 480,
  Object? unit = 'ถุง',
}) => <String, Object?>{
  'id': id,
  'name': name,
  'boq_item_id': 'bi-9',
  'ordered_qty': orderedQty,
  'received_qty': receivedQty,
  'unit': unit,
  'price': 138.5,
  'currency_code': 'THB',
};

/// One real gr wire row (gr.ts grWire).
FieldGrEnt _gr({
  String id = 'gr-1',
  String status = 'received',
  String? poId = 'po-1',
  String? woId,
  Object? vendor = 'บจก. ซีแพคคอนกรีต',
  String date = '2026-05-28T03:00:00.000Z',
  List<FieldGrEnt>? items,
}) => <String, Object?>{
  'id': id,
  'no': 'GR-2026-0148',
  'po_id': poId,
  'wo_id': woId,
  'status': status,
  'received': 320,
  'rejected': 0,
  'photos': <String>[],
  'vendor': vendor,
  'date': date,
  'money': 66480,
  'currency_code': 'THB',
  'items': items ?? <FieldGrEnt>[_item()],
};

void main() {
  group('parseGrLines — the four real columns', () {
    test('reads name, ordered, received and unit off a real wire row', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[_item()]);
      expect(lines, hasLength(1));
      expect(lines.single.name, 'ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ');
      expect(lines.single.orderedQty, 480);
      expect(lines.single.receivedQty, 480);
      expect(lines.single.unit, 'ถุง');
    });

    test('accepts numeric strings (numerics cross the wire as either)', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        _item(orderedQty: '320.0000', receivedQty: '280.0000'),
      ]);
      expect(lines.single.orderedQty, 320);
      expect(lines.single.receivedQty, 280);
    });

    test('preserves the server order (no ordering key exists on the wire)', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        _item(id: 'c', name: 'C'),
        _item(id: 'a', name: 'A'),
        _item(id: 'b', name: 'B'),
      ]);
      expect(lines.map((FieldGrLine l) => l.id).toList(), <String>[
        'c',
        'a',
        'b',
      ]);
    });

    test('skips a row with no id — it has no stable key', () {
      final FieldGrEnt keyless = _item()..remove('id');
      expect(parseGrLines(<FieldGrEnt>[keyless]), isEmpty);
    });
  });

  group('WITHHELD — absence is never a zero and never a guess', () {
    test('a missing quantity parses as null, NOT 0', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        _item(orderedQty: null, receivedQty: null),
      ]);
      expect(lines.single.orderedQty, isNull);
      expect(lines.single.receivedQty, isNull);
    });

    test('a non-numeric quantity is null, not 0', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        _item(orderedQty: 'n/a', receivedQty: <String>['bad']),
      ]);
      expect(lines.single.orderedQty, isNull);
      expect(lines.single.receivedQty, isNull);
    });

    test('a missing name or unit is null (em-dash), never a placeholder', () {
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        _item(name: null, unit: ''),
      ]);
      expect(lines.single.name, isNull);
      expect(lines.single.unit, isNull);
    });

    test('a sparse line is KEPT — it still exists on the receipt', () {
      // Dropping it would under-report the document; it renders em-dashed.
      final List<FieldGrLine> lines = parseGrLines(<FieldGrEnt>[
        <String, Object?>{'id': 'gi-x'},
      ]);
      expect(lines, hasLength(1));
      expect(lines.single.id, 'gi-x');
      expect(lines.single.name, isNull);
    });

    test('MONEY: no money key can reach any displayable field', () {
      // A row whose ONLY populated values are monetary. If any parse slot ever
      // learned to read `price` / `amount` / `currency_code` — directly or as a
      // fallback key — one of these fields would light up. Every one must stay
      // null, so the line renders as em-dashes and the receipt shows no money at
      // all (money = NONE; gr.ts derives the receipt's value from `price`
      // server-side and this screen must never echo it back).
      final FieldGrLine line = parseGrLines(<FieldGrEnt>[
        <String, Object?>{
          'id': 'gi-money',
          'price': 138.5,
          'amount': 66480,
          'money': 66480,
          'currency_code': 'THB',
        },
      ]).single;
      expect(line.name, isNull);
      expect(line.unit, isNull);
      expect(line.orderedQty, isNull);
      expect(line.receivedQty, isNull);
      // …and with both quantities unknown the row cannot be tinted at all.
      expect(line.delta, FieldGrDelta.unknown);
    });
  });

  group('delta + shortfall — the prototype short flag, derived', () {
    test('received < ordered is short, and the shortfall is the gap', () {
      final FieldGrLine l = parseGrLines(<FieldGrEnt>[
        _item(orderedQty: 320, receivedQty: 280),
      ]).single;
      expect(l.delta, FieldGrDelta.short);
      expect(l.shortfall, 40); // the prototype's own row-3 number
    });

    test('received == ordered is exact, with no shortfall', () {
      final FieldGrLine l = parseGrLines(<FieldGrEnt>[_item()]).single;
      expect(l.delta, FieldGrDelta.exact);
      expect(l.shortfall, isNull);
    });

    test('received > ordered is over, not folded into exact', () {
      final FieldGrLine l = parseGrLines(<FieldGrEnt>[
        _item(orderedQty: 100, receivedQty: 120),
      ]).single;
      expect(l.delta, FieldGrDelta.over);
      expect(l.shortfall, isNull);
    });

    test('WITHHELD: either quantity absent is unknown, NOT exact', () {
      // The load-bearing case: were this to collapse to `exact`, a row whose
      // received qty never arrived would be painted ok-green as if complete.
      for (final FieldGrEnt row in <FieldGrEnt>[
        _item(receivedQty: null),
        _item(orderedQty: null),
        _item(orderedQty: null, receivedQty: null),
      ]) {
        final FieldGrLine l = parseGrLines(<FieldGrEnt>[row]).single;
        expect(l.delta, FieldGrDelta.unknown);
        expect(l.shortfall, isNull);
      }
    });
  });

  group('selectReceipt', () {
    test('a pushed id shows exactly that receipt', () {
      final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
        _gr(id: 'gr-1'),
        _gr(id: 'gr-2'),
      ], grId: 'gr-2');
      expect(got?['id'], 'gr-2');
    });

    test('WITHHELD: a foreign/stale pushed id resolves to nothing', () {
      // Never a different receipt — that would show one document under another's
      // identity.
      final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
        _gr(id: 'gr-1'),
      ], grId: 'gr-nope');
      expect(got, isNull);
    });

    test('with no id it follows the register newest-first', () {
      final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
        _gr(id: 'old', date: '2026-05-01T00:00:00.000Z'),
        _gr(id: 'new', date: '2026-05-28T00:00:00.000Z'),
        _gr(id: 'mid', date: '2026-05-14T00:00:00.000Z'),
      ]);
      expect(got?['id'], 'new');
    });

    test('a tie on date breaks deterministically on id', () {
      const String same = '2026-05-28T00:00:00.000Z';
      final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
        _gr(id: 'gr-a', date: same),
        _gr(id: 'gr-c', date: same),
        _gr(id: 'gr-b', date: same),
      ]);
      expect(got?['id'], 'gr-c');
    });

    test('a row with an unparseable date never wins by accident', () {
      final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
        _gr(id: 'dated', date: '2026-01-01T00:00:00.000Z'),
        _gr(id: 'undated', date: 'not-a-date'),
      ]);
      expect(got?['id'], 'dated');
    });

    test(
      'WITHHELD: returned/cancelled receipts are not eligible for the bare route',
      () {
        // The screen has no status pill, so showing one of these under a
        // received-items heading would silently misstate the document.
        final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
          _gr(id: 'gr-r', status: 'returned'),
          _gr(id: 'gr-c', status: 'cancelled'),
        ]);
        expect(got, isNull);
      },
    );

    test(
      'WITHHELD: a pushed id for a RETURNED receipt resolves to nothing',
      () {
        // The eligibility rule is a property of the SCREEN, not of one route
        // into it: a receipt that went back to the vendor may not be rendered
        // under the *items received* heading just because an id was pushed.
        // Distinct from the foreign-id case above — this id EXISTS and is the
        // caller's real subject; it is refused on status alone.
        final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
          _gr(id: 'gr-1'),
          _gr(id: 'gr-r', status: 'returned'),
        ], grId: 'gr-r');
        expect(got, isNull);
      },
    );

    test(
      'WITHHELD: a pushed id for a CANCELLED receipt resolves to nothing',
      () {
        final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
          _gr(id: 'gr-1'),
          _gr(id: 'gr-x', status: 'cancelled'),
        ], grId: 'gr-x');
        expect(got, isNull);
      },
    );

    test(
      'an ineligible pushed id yields NOTHING, never the next eligible receipt',
      () {
        // The refusal must not degrade into the bare-route fallback: answering a
        // pushed id with a DIFFERENT document is the one failure worse than an
        // empty screen (the foreign-id precedent above).
        final FieldGrEnt? got = selectReceipt(<FieldGrEnt>[
          _gr(id: 'gr-r', status: 'returned'),
          _gr(id: 'gr-ok', date: '2026-05-29T00:00:00.000Z'),
        ], grId: 'gr-r');
        expect(got, isNull);
      },
    );

    test('an empty register resolves to nothing', () {
      expect(selectReceipt(const <FieldGrEnt>[]), isNull);
    });
  });

  group('anchor number join', () {
    test('maps a po_id to its human document number', () {
      final Map<String, String> map = buildAnchorNoMap(<FieldGrEnt>[
        <String, Object?>{'id': 'po-1', 'no': 'PO-2026-0290'},
      ]);
      final FieldGrReceipt r = buildReceipt(_gr(), map);
      expect(r.anchorNo, 'PO-2026-0290');
    });

    test('falls back to wo_id when the receipt hangs off a work order', () {
      final Map<String, String> map = buildAnchorNoMap(<FieldGrEnt>[
        <String, Object?>{'id': 'wo-7', 'no': 'WO-2026-0117'},
      ]);
      final FieldGrReceipt r = buildReceipt(_gr(poId: null, woId: 'wo-7'), map);
      expect(r.anchorNo, 'WO-2026-0117');
    });

    test('WITHHELD: an unresolved anchor is null — never the raw uuid', () {
      final FieldGrReceipt r = buildReceipt(_gr(), const <String, String>{});
      expect(r.anchorNo, isNull);
      expect(r.anchorNo, isNot('po-1'));
    });

    test('WITHHELD: a document with no `no` contributes no entry', () {
      // Mapping it to '' would print a blank where an honest dash belongs.
      final Map<String, String> map = buildAnchorNoMap(<FieldGrEnt>[
        <String, Object?>{'id': 'po-1', 'no': null},
      ]);
      expect(map, isEmpty);
      expect(buildReceipt(_gr(), map).anchorNo, isNull);
    });
  });

  group('buildReceipt', () {
    test('takes the server-resolved vendor verbatim', () {
      final FieldGrReceipt r = buildReceipt(_gr(), const <String, String>{});
      expect(r.vendor, 'บจก. ซีแพคคอนกรีต');
    });

    test('WITHHELD: an unresolved vendor stays null', () {
      final FieldGrReceipt r = buildReceipt(
        _gr(vendor: null),
        const <String, String>{},
      );
      expect(r.vendor, isNull);
    });

    test('a receipt with no per-line detail honestly has no lines', () {
      // grWire reports items: [] for a receipt recorded without line detail —
      // exactly what st-receive's deliberately nameless lines produce (B-267).
      final FieldGrReceipt r = buildReceipt(
        _gr(items: <FieldGrEnt>[]),
        const <String, String>{},
      );
      expect(r.lines, isEmpty);
    });

    test(
      'a non-list items field degrades to no lines rather than throwing',
      () {
        final FieldGrEnt gr = _gr()..['items'] = 'oops';
        expect(buildReceipt(gr, const <String, String>{}).lines, isEmpty);
      },
    );
  });

  group('formatQty — parity with st_receive_agg / pr_detail_agg', () {
    test('groups whole quantities', () {
      expect(formatQty(1200), '1,200');
      expect(formatQty(540), '540');
      expect(formatQty(902475), '902,475');
    });

    test('trims fractional quantities', () {
      expect(formatQty(1.5), '1.5');
      expect(formatQty(1.500), '1.5');
    });

    test('non-finite is 0, not NaN on screen', () {
      expect(formatQty(double.nan), '0');
      expect(formatQty(double.infinity), '0');
    });
  });
}
