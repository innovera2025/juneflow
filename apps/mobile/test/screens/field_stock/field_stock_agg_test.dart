// Pure-logic tests for the mobile on-site material-issue aggregate (field-stock).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
//
// The assertions that matter most are the NEGATIVE ones — what never reaches the
// payload, and what is never defaulted to a number the wire did not carry. The
// `money` group is the one that would have caught B-315, and it is written so that
// deleting the discipline makes it RED rather than merely un-asserted: it feeds a
// stock row whose ONLY populated values are monetary and then greps the encoded
// payload for every one of them.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_agg.dart';

/// A real GET /inventory/stock row (inventory.ts stockWire L382-402) — it DOES
/// carry price / value / currency_code, which this screen must never surface.
FieldStockEnt _stock({
  String itemId = 'i1',
  String? code = 'MAT-CEM-001',
  String? name = 'ปูนซีเมนต์ตราเสือ',
  String? unit = 'ถุง',
  Object? onHand = 1240,
}) => <String, Object?>{
  'item_id': itemId,
  'warehouse_id': 'w1',
  'item_code': code,
  'item_name': name,
  'unit': unit,
  'warehouse_name': 'คลัง Block B',
  'price': 168.5,
  'currency_code': 'THB',
  'on_hand': onHand,
  'value': 208940,
};

void main() {
  group('parseStockLines', () {
    test('reads the real balance columns and preserves server order', () {
      final List<FieldStockLine> lines = parseStockLines(<FieldStockEnt>[
        _stock(itemId: 'i1'),
        _stock(itemId: 'i2', code: 'MAT-STL-024', name: 'เหล็ก SR24 12mm'),
      ]);
      expect(lines, hasLength(2));
      expect(lines[0].itemId, 'i1');
      expect(lines[0].code, 'MAT-CEM-001');
      expect(lines[0].name, 'ปูนซีเมนต์ตราเสือ');
      expect(lines[0].unit, 'ถุง');
      expect(lines[0].onHand, 1240);
      expect(lines[1].itemId, 'i2');
    });

    test('accepts a numeric on_hand that crossed the wire as a string', () {
      // numeric columns arrive as either a number or a string.
      expect(
        parseStockLines(<FieldStockEnt>[_stock(onHand: '24.5')]).single.onHand,
        24.5,
      );
    });

    test('skips a row with no item_id — it could not be sent', () {
      // item_id is the ONE field the write requires per line, so a row without it
      // is not merely unkeyed, it is unissuable.
      final List<FieldStockEnt> rows = <FieldStockEnt>[
        <String, Object?>{'item_name': 'ทรายหยาบ', 'on_hand': 24},
        _stock(itemId: 'i9'),
      ];
      expect(
        parseStockLines(rows).map((FieldStockLine l) => l.itemId),
        <String>['i9'],
      );
    });

    test('keeps a sparse row and em-dash-es each absent field INDEPENDENTLY', () {
      // A balance row with no name still EXISTS on the shelf; dropping it would
      // under-report the warehouse.
      final FieldStockLine line = parseStockLines(<FieldStockEnt>[
        <String, Object?>{'item_id': 'i1', 'item_name': 'ทรายหยาบ'},
      ]).single;
      expect(line.name, 'ทรายหยาบ');
      expect(line.code, isNull);
      expect(line.unit, isNull);
      expect(line.onHand, isNull);
    });

    test('an absent on_hand is null, NEVER 0 — "unknown" is not "none left"', () {
      // The load-bearing honest-omit of this screen: 0 would assert the shelf is
      // empty, which is a different fact from "the wire did not say".
      expect(
        parseStockLines(<FieldStockEnt>[_stock(onHand: null)]).single.onHand,
        isNull,
      );
      expect(
        parseStockLines(<FieldStockEnt>[
          <String, Object?>{'item_id': 'i1'},
        ]).single.onHand,
        isNull,
      );
      // A real zero balance is still read as zero — the honest-omit must not
      // swallow a genuine 0 either.
      expect(
        parseStockLines(<FieldStockEnt>[_stock(onHand: 0)]).single.onHand,
        0,
      );
    });

    test('a non-numeric on_hand is absent rather than 0', () {
      expect(
        parseStockLines(<FieldStockEnt>[_stock(onHand: 'n/a')]).single.onHand,
        isNull,
      );
    });
  });

  group('money = SERVER — the payload and the model carry no monetary value', () {
    test(
      'a stock row whose ONLY populated values are monetary yields an EMPTY line',
      () {
        // The row carries price + value + currency_code and nothing else. If any
        // of the three were parsed, one of these would be non-null.
        final FieldStockLine line = parseStockLines(<FieldStockEnt>[
          <String, Object?>{
            'item_id': 'i1',
            'price': 168.5,
            'value': 208940,
            'currency_code': 'THB',
          },
        ]).single;
        expect(line.itemId, 'i1');
        expect(line.code, isNull);
        expect(line.name, isNull);
        expect(line.unit, isNull);
        expect(line.onHand, isNull);
      },
    );

    test(
      'the encoded payload contains NO price, value or currency — the B-315 probe',
      () {
        final List<FieldStockLine> lines = parseStockLines(<FieldStockEnt>[
          _stock(),
        ]);
        final String body = jsonEncode(
          buildIssuePayload(
            projectId: 'p1',
            fromWarehouseId: 'w1',
            picks: picksFrom(lines, <String, double>{'i1': 80}),
            idempotencyKey: 'op-1',
          ),
        );
        // Every monetary token that WAS on the source row.
        expect(body, isNot(contains('168.5')));
        expect(body, isNot(contains('208940')));
        expect(body, isNot(contains('THB')));
        expect(body, isNot(contains('price')));
        expect(body, isNot(contains('value')));
        expect(body, isNot(contains('currency')));
        expect(body, isNot(contains('amount')));
      },
    );

    test('the payload is EXACTLY four keys, and a line exactly two', () {
      // Pinned as a set, so ADDING a field is red too — not just changing one.
      final Map<String, Object?> payload = buildIssuePayload(
        projectId: 'p1',
        fromWarehouseId: 'w1',
        picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 80)],
        idempotencyKey: 'op-1',
      );
      expect(payload.keys.toSet(), <String>{
        'project_id',
        'from_warehouse_id',
        'idempotency_key',
        'lines',
      });
      final List<Object?> lines = payload['lines']! as List<Object?>;
      final Map<String, Object?> line = lines.single! as Map<String, Object?>;
      expect(line.keys.toSet(), <String>{'item_id', 'qty'});
      expect(line['item_id'], 'i1');
      expect(line['qty'], 80);
      // No cc_id and no issue_date: nothing on mobile lists cost centres, and the
      // device's local date is not a fact about the document.
      expect(payload.containsKey('cc_id'), isFalse);
      expect(payload.containsKey('issue_date'), isFalse);
    });

    test('the idempotency_key is the op id verbatim — B-312 is armed', () {
      // The queue replays op.payload VERBATIM and injects nothing, so a key that
      // did not reach the BODY would leave the partial unique index unarmed and a
      // replay would post a second JV + a second stock decrement.
      final Map<String, Object?> payload = buildIssuePayload(
        projectId: 'p1',
        fromWarehouseId: 'w1',
        picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 1)],
        idempotencyKey: 'field-stock-123-456',
      );
      expect(payload['idempotency_key'], 'field-stock-123-456');
    });

    test(
      'a whole qty crosses the wire as an int, a fractional one as a double',
      () {
        Object? qtyOf(double q) {
          final Map<String, Object?> p = buildIssuePayload(
            projectId: 'p1',
            fromWarehouseId: 'w1',
            picks: <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: q)],
            idempotencyKey: 'op',
          );
          return ((p['lines']! as List<Object?>).single!
              as Map<String, Object?>)['qty'];
        }

        expect(qtyOf(80), 80);
        expect(qtyOf(80), isA<int>());
        expect(qtyOf(4.5), 4.5);
      },
    );
  });

  group('selectWarehouse', () {
    FieldStockEnt wh(String id, String? at) => <String, Object?>{
      'id': id,
      'name': 'คลัง $id',
      if (at != null) 'created_at': at,
    };

    test('a pushed id selects exactly that warehouse', () {
      final List<FieldStockEnt> rows = <FieldStockEnt>[
        wh('w1', '2026-01-01T00:00:00Z'),
        wh('w2', '2026-02-01T00:00:00Z'),
      ];
      expect(selectWarehouse(rows, warehouseId: 'w1')!['id'], 'w1');
    });

    test(
      'a foreign or stale id resolves to NOTHING, never another warehouse',
      () {
        // The worst available failure on a screen that decrements stock would be
        // silently drawing down a different shelf.
        final List<FieldStockEnt> rows = <FieldStockEnt>[
          wh('w1', null),
          wh('w2', null),
        ];
        expect(selectWarehouse(rows, warehouseId: 'nope'), isNull);
      },
    );

    test('with no id it follows the NEWEST, re-derived from created_at', () {
      // Deliberately given in the WRONG order, so passing proves the choice is
      // re-derived here and not inherited from the server's list order.
      final List<FieldStockEnt> rows = <FieldStockEnt>[
        wh('w1', '2026-01-01T00:00:00Z'),
        wh('w3', '2026-03-01T00:00:00Z'),
        wh('w2', '2026-02-01T00:00:00Z'),
      ];
      expect(selectWarehouse(rows)!['id'], 'w3');
    });

    test('a tie breaks on the greater id, and an undated row never wins', () {
      final List<FieldStockEnt> tied = <FieldStockEnt>[
        wh('w1', '2026-01-01T00:00:00Z'),
        wh('w2', '2026-01-01T00:00:00Z'),
      ];
      expect(selectWarehouse(tied)!['id'], 'w2');
      final List<FieldStockEnt> mixed = <FieldStockEnt>[
        wh('w9', null),
        wh('w1', '2026-01-01T00:00:00Z'),
      ];
      expect(selectWarehouse(mixed)!['id'], 'w1');
    });

    test('an empty register resolves to null (honest-empty)', () {
      expect(selectWarehouse(const <FieldStockEnt>[]), isNull);
    });
  });

  group('selectProject', () {
    FieldStockEnt pj(String id) => <String, Object?>{
      'id': id,
      'name': 'โครงการ $id',
    };

    test('a pushed id selects exactly that project', () {
      expect(
        selectProject(<FieldStockEnt>[
          pj('p1'),
          pj('p2'),
        ], projectId: 'p2')!['id'],
        'p2',
      );
    });

    test('a foreign id resolves to NOTHING — never another project', () {
      // Charging a different project's WIP is a money consequence.
      expect(
        selectProject(<FieldStockEnt>[pj('p1')], projectId: 'nope'),
        isNull,
      );
    });

    test('with no id it takes the FIRST in server entry order (the primary)', () {
      // GET /projects is created_at ASC and the app treats the OLDEST as primary
      // (projects.ts B-323 / dashboard resolvePrimaryProject).
      expect(selectProject(<FieldStockEnt>[pj('p1'), pj('p2')])!['id'], 'p1');
    });

    test('a row with no id is skipped rather than chosen', () {
      final List<FieldStockEnt> rows = <FieldStockEnt>[
        <String, Object?>{'name': 'ไม่มี id'},
        pj('p2'),
      ];
      expect(selectProject(rows)!['id'], 'p2');
    });

    test('an empty list resolves to null', () {
      expect(selectProject(const <FieldStockEnt>[]), isNull);
    });
  });

  group('adjustPick', () {
    test('steps up and down', () {
      expect(adjustPick(0, 1), 1);
      expect(adjustPick(80, -1), 79);
    });

    test('clamps at 0 — a negative withdrawal is not a return', () {
      expect(adjustPick(0, -1), 0);
      expect(adjustPick(0.5, -1), 0);
    });

    test('is NOT capped at the on-hand balance', () {
      // Deliberate: the read balance is already stale (the server re-reads the
      // ledger inside the transaction), so a client cap would assert an
      // availability it cannot know AND duplicate a server rule in a second place
      // where the two can disagree. Over-ask is left to the negative-stock guard.
      expect(adjustPick(9999, 1), 10000);
    });
  });

  group('picksFrom', () {
    test('stages only the lines with a quantity, in DISPLAY order', () {
      final List<FieldStockLine> lines = parseStockLines(<FieldStockEnt>[
        _stock(itemId: 'i1'),
        _stock(itemId: 'i2'),
        _stock(itemId: 'i3'),
      ]);
      final List<FieldStockPick> picks = picksFrom(lines, <String, double>{
        'i3': 4,
        'i1': 80,
      });
      expect(picks.map((FieldStockPick p) => p.itemId), <String>['i1', 'i3']);
      expect(picks.map((FieldStockPick p) => p.qty), <double>[80, 4]);
    });

    test('an untouched or zeroed line is NOT sent', () {
      // POST /inventory/issues rejects a qty <= 0 line outright, so including one
      // would 400 the WHOLE issue including the lines that were real.
      final List<FieldStockLine> lines = parseStockLines(<FieldStockEnt>[
        _stock(itemId: 'i1'),
        _stock(itemId: 'i2'),
      ]);
      expect(picksFrom(lines, <String, double>{'i1': 0}), isEmpty);
      expect(picksFrom(lines, const <String, double>{}), isEmpty);
    });

    test('a quantity keyed to an item that is not on the shelf is ignored', () {
      // Quantities are keyed by item_id, so a reload that drops a row drops its
      // staged quantity with it rather than sending an item the warehouse lacks.
      final List<FieldStockLine> lines = parseStockLines(<FieldStockEnt>[
        _stock(itemId: 'i1'),
      ]);
      expect(picksFrom(lines, <String, double>{'ghost': 5}), isEmpty);
    });
  });

  group('canSubmitIssue', () {
    const List<FieldStockPick> one = <FieldStockPick>[
      FieldStockPick(itemId: 'i1', qty: 1),
    ];

    test('needs a project, a warehouse AND at least one line', () {
      // All three 400 when absent, and sync_processor dead-letters every 4xx
      // PERMANENTLY — so gating here is what keeps an un-postable write out of the
      // queue entirely (the B-264 lesson one layer earlier).
      expect(
        canSubmitIssue(projectId: 'p1', warehouseId: 'w1', picks: one),
        isTrue,
      );
      expect(
        canSubmitIssue(projectId: null, warehouseId: 'w1', picks: one),
        isFalse,
      );
      expect(
        canSubmitIssue(projectId: 'p1', warehouseId: null, picks: one),
        isFalse,
      );
      expect(
        canSubmitIssue(
          projectId: 'p1',
          warehouseId: 'w1',
          picks: const <FieldStockPick>[],
        ),
        isFalse,
      );
    });
  });

  group('resolveIssueState', () {
    SyncOperation op(String id, SyncOpStatus status) => SyncOperation(
      id: id,
      entityType: 'inventory_issue',
      kind: SyncOpKind.create,
      endpoint: '/inventory/issues',
      method: 'POST',
      payload: const <String, Object?>{},
      createdAt: DateTime.utc(2026),
      status: status,
    );

    test('the drain report is authoritative when it touched this op', () {
      for (final MapEntry<SyncOutcome, FieldStockState> e
          in <SyncOutcome, FieldStockState>{
            SyncOutcome.synced: FieldStockState.confirmed,
            SyncOutcome.permanentlyFailed: FieldStockState.failed,
            SyncOutcome.deferred: FieldStockState.queued,
          }.entries) {
        expect(
          resolveIssueState(
            'op-1',
            DrainReport(<SyncAttempt>[SyncAttempt(id: 'op-1', outcome: e.key)]),
            const <SyncOperation>[],
          ),
          e.value,
          reason: '${e.key} must resolve to ${e.value}',
        );
      }
    });

    test('a deferred write is QUEUED, never confirmed', () {
      // The single most important branch: a SyncOutcome.deferred must never render
      // as "stock cut". Nothing was posted.
      expect(
        resolveIssueState(
          'op-1',
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: 'op-1', outcome: SyncOutcome.deferred),
          ]),
          const <SyncOperation>[],
        ),
        FieldStockState.queued,
      );
    });

    test('with no attempt, the queue decides: still pending = queued', () {
      expect(
        resolveIssueState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[op('op-1', SyncOpStatus.pending)],
        ),
        FieldStockState.queued,
      );
    });

    test('with no attempt, a dead-lettered op = failed', () {
      expect(
        resolveIssueState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[op('op-1', SyncOpStatus.failed)],
        ),
        FieldStockState.failed,
      );
    });

    test('with no attempt and gone from the queue = synced', () {
      expect(
        resolveIssueState(
          'op-1',
          const DrainReport(<SyncAttempt>[]),
          <SyncOperation>[op('other', SyncOpStatus.pending)],
        ),
        FieldStockState.confirmed,
      );
    });
  });

  group('formatQty', () {
    test('groups whole quantities and trims fractional ones', () {
      expect(formatQty(1240), '1,240');
      expect(formatQty(80), '80');
      expect(formatQty(1.5), '1.5');
      expect(formatQty(1.500), '1.5');
      expect(formatQty(0), '0');
    });

    test('non-finite is 0, and a negative keeps its ASCII sign', () {
      expect(formatQty(double.nan), '0');
      expect(formatQty(-40), '-40');
    });
  });
}
