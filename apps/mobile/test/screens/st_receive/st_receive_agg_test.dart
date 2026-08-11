// Unit tests for the pure count-and-receive derivations (route st-receive).
//
// The module under test has no Flutter / Dio / i18n dependency, so these are plain
// unit tests over real wire shapes (pr.ts prItemWire, po.ts poWire).
//
// The load-bearing assertions are the HONEST-OMIT ones: that a line the wire cannot
// name is left null rather than defaulted, and — the money one — that the POST /gr
// payload carries no `name`, no `price`, no `unit` and no `ordered_qty`, because
// that omission is the ONLY thing standing between this screen and either a
// client-originated price or a fabricated "0" on the merged web GR list.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_agg.dart';

/// A real GET /pr/:id item row (pr.ts prItemWire) — note it DOES carry `price`
/// and `amount`, which this screen must never read or echo.
StRecvEnt _item({
  String id = 'i1',
  Object? qty = 800,
  Object? price = 32.5,
  String? name,
  String? unit,
}) {
  return <String, Object?>{
    'id': id,
    'pr_id': 'pr1',
    'boq_item_id': 'b1',
    'qty': qty,
    'price': price,
    'amount': 26000,
    if (name != null) 'name': name,
    if (unit != null) 'unit': unit,
  };
}

void main() {
  group('read chain — prIdOfPo', () {
    test('reads the real pr_id hop off a PO wire row', () {
      expect(prIdOfPo(<String, Object?>{'id': 'po1', 'pr_id': 'pr9'}), 'pr9');
      // camelCase tolerated (mirrors the web toGrRow robustness).
      expect(prIdOfPo(<String, Object?>{'prId': 'pr9'}), 'pr9');
    });

    test(
      'a PO with no pr_id yields null — the screen has no honest line source',
      () {
        expect(prIdOfPo(<String, Object?>{'id': 'po1'}), isNull);
        expect(prIdOfPo(<String, Object?>{'pr_id': ''}), isNull);
      },
    );
  });

  group('parseReceiptLines', () {
    test('takes the REAL ordered qty and preserves the server order', () {
      final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
        _item(id: 'a', qty: 800),
        _item(id: 'b', qty: 520),
        _item(id: 'c', qty: 40),
      ]);
      expect(lines.map((StRecvLine l) => l.id).toList(), <String>[
        'a',
        'b',
        'c',
      ]);
      expect(lines.map((StRecvLine l) => l.orderedQty).toList(), <double>[
        800,
        520,
        40,
      ]);
    });

    test(
      'numeric strings parse (numeric columns cross the wire either way)',
      () {
        final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
          _item(qty: '520.5'),
        ]);
        expect(lines.single.orderedQty, 520.5);
      },
    );

    test(
      'HONEST-OMIT: name and unit are null today — the wire carries neither',
      () {
        final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[_item()]);
        expect(lines.single.name, isNull);
        expect(lines.single.unit, isNull);
      },
    );

    test(
      'name/unit light up honestly IF the wire ever grows them (never invented)',
      () {
        final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
          _item(name: 'SD40 12mm', unit: 'rod'),
        ]);
        expect(lines.single.name, 'SD40 12mm');
        expect(lines.single.unit, 'rod');
      },
    );

    test('a row with no id or no qty is skipped, never defaulted to 0', () {
      final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
        <String, Object?>{'qty': 10}, // no id → cannot key a counter
        <String, Object?>{'id': 'x'}, // no qty → "unknown" is not 0
        _item(id: 'ok', qty: 5),
      ]);
      expect(lines.map((StRecvLine l) => l.id).toList(), <String>['ok']);
    });

    test('prItemsOf reads the items[] array off a GET /pr/:id body', () {
      expect(
        prItemsOf(<String, Object?>{
          'id': 'pr1',
          'items': <Object?>[_item(id: 'a'), _item(id: 'b')],
        }).length,
        2,
      );
      // A body with no items[] (or a wrong-typed one) yields nothing, not a throw.
      expect(prItemsOf(<String, Object?>{'id': 'pr1'}), isEmpty);
      expect(prItemsOf(<String, Object?>{'items': 'nope'}), isEmpty);
    });
  });

  group('per-line short/over classification', () {
    test('short / exact / over against the REAL ordered qty', () {
      expect(classifyDelta(790, 800), StRecvDelta.short);
      expect(classifyDelta(800, 800), StRecvDelta.exact);
      expect(classifyDelta(810, 800), StRecvDelta.over);
    });

    test('fractional quantities classify without a rounding smudge', () {
      expect(classifyDelta(0.5, 0.75), StRecvDelta.short);
      expect(classifyDelta(0.75, 0.75), StRecvDelta.exact);
    });

    test('anyShort drives the CTA tone across all lines', () {
      final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
        _item(id: 'a', qty: 800),
        _item(id: 'b', qty: 520),
      ]);
      expect(anyShort(lines, <double>[800, 520]), isFalse);
      expect(anyShort(lines, <double>[800, 510]), isTrue);
      // Over on one line does NOT make the receipt short.
      expect(anyShort(lines, <double>[900, 520]), isFalse);
    });

    test('initialCounts pre-fills each line with its real ordered qty', () {
      final List<StRecvLine> lines = parseReceiptLines(<StRecvEnt>[
        _item(id: 'a', qty: 800),
        _item(id: 'b', qty: 40),
      ]);
      expect(initialCounts(lines), <double>[800, 40]);
    });
  });

  group('stepper', () {
    test('steps by the prototype delta and clamps at zero', () {
      expect(adjustCount(800, kStRecvStep), 810);
      expect(adjustCount(800, -kStRecvStep), 790);
      expect(adjustCount(5, -kStRecvStep), 0); // Math.max(0, v + d)
      expect(adjustCount(0, -kStRecvStep), 0);
    });
  });

  group('buildReceiptPayload — money = SERVER by omission', () {
    Map<String, Object?> build() => buildReceiptPayload(
      poId: 'po1',
      counts: <double>[790, 520],
      idempotencyKey: 'op-1',
    );

    test('carries the anchor, the counts and the idempotency key', () {
      final Map<String, Object?> body = build();
      expect(body['po_id'], 'po1');
      expect(body['idempotency_key'], 'op-1');
      final List<Object?> lines = body['lines']! as List<Object?>;
      expect(lines.length, 2);
      expect((lines[0]! as Map<String, Object?>)['qty_ok'], 790);
      expect((lines[1]! as Map<String, Object?>)['qty_ok'], 520);
    });

    test(
      'NEVER sends price — gr.ts stores it verbatim and derives the receipt money '
      'from it, so sending one would originate a monetary value on the client',
      () {
        for (final Object? l in build()['lines']! as List<Object?>) {
          expect((l! as Map<String, Object?>).containsKey('price'), isFalse);
        }
      },
    );

    test(
      'NEVER sends name — gr.ts gates gr_item creation on it, so a named line '
      'would persist price 0.00 and make the web GR list print a fabricated "0"',
      () {
        for (final Object? l in build()['lines']! as List<Object?>) {
          expect((l! as Map<String, Object?>).containsKey('name'), isFalse);
        }
      },
    );

    test(
      'sends no unit / ordered_qty / no — inert or invented on a nameless line',
      () {
        final Map<String, Object?> body = build();
        expect(
          body.containsKey('no'),
          isFalse,
        ); // gr.no would be client-invented
        for (final Object? l in body['lines']! as List<Object?>) {
          final Map<String, Object?> line = l! as Map<String, Object?>;
          expect(line.containsKey('unit'), isFalse);
          expect(line.containsKey('ordered_qty'), isFalse);
        }
      },
    );

    test(
      'qty_rejected is always 0 — one count per line cannot express damage',
      () {
        for (final Object? l in build()['lines']! as List<Object?>) {
          expect((l! as Map<String, Object?>)['qty_rejected'], 0);
        }
      },
    );

    test(
      'the payload has exactly the four permitted line keys, nothing else',
      () {
        for (final Object? l in build()['lines']! as List<Object?>) {
          expect((l! as Map<String, Object?>).keys.toSet(), <String>{
            'qty_ok',
            'qty_rejected',
          });
        }
        expect(build().keys.toSet(), <String>{
          'po_id',
          'idempotency_key',
          'lines',
        });
      },
    );

    test(
      'a whole count crosses the wire as an int, a fractional one as a double',
      () {
        final List<Object?> lines =
            buildReceiptPayload(
                  poId: 'po1',
                  counts: <double>[800, 12.5],
                  idempotencyKey: 'k',
                )['lines']!
                as List<Object?>;
        expect((lines[0]! as Map<String, Object?>)['qty_ok'], isA<int>());
        expect((lines[1]! as Map<String, Object?>)['qty_ok'], 12.5);
      },
    );

    test('a zero count is sent as 0 — a real "nothing arrived" count', () {
      final List<Object?> lines =
          buildReceiptPayload(
                poId: 'po1',
                counts: <double>[0],
                idempotencyKey: 'k',
              )['lines']!
              as List<Object?>;
      expect((lines[0]! as Map<String, Object?>)['qty_ok'], 0);
    });
  });

  group('resolveReceiveState — the three honest outcomes', () {
    DrainReport report(SyncOutcome o) =>
        DrainReport(<SyncAttempt>[SyncAttempt(id: 'op-1', outcome: o)]);

    test('2xx → confirmed', () {
      expect(
        resolveReceiveState(
          'op-1',
          report(SyncOutcome.synced),
          const <SyncOperation>[],
        ),
        StRecvState.confirmed,
      );
    });

    test('5xx / transport → queued (SAVED, never shown as a success)', () {
      expect(
        resolveReceiveState(
          'op-1',
          report(SyncOutcome.deferred),
          const <SyncOperation>[],
        ),
        StRecvState.queued,
      );
    });

    test('4xx → failed (permanent dead-letter)', () {
      expect(
        resolveReceiveState(
          'op-1',
          report(SyncOutcome.permanentlyFailed),
          const <SyncOperation>[],
        ),
        StRecvState.failed,
      );
    });

    test(
      'untouched by the drain → the QUEUE decides, not an optimistic guess',
      () {
        final SyncOperation queued = SyncOperation(
          id: 'op-1',
          entityType: 'gr',
          kind: SyncOpKind.create,
          endpoint: '/gr',
          method: 'POST',
          payload: const <String, Object?>{},
          createdAt: DateTime.utc(2026),
        );
        const DrainReport empty = DrainReport(<SyncAttempt>[]);

        // Still pending in the queue → queued.
        expect(
          resolveReceiveState('op-1', empty, <SyncOperation>[queued]),
          StRecvState.queued,
        );
        // Marked failed in the queue → failed.
        expect(
          resolveReceiveState('op-1', empty, <SyncOperation>[
            queued.copyWith(status: SyncOpStatus.failed),
          ]),
          StRecvState.failed,
        );
        // Gone from the queue → it was synced.
        expect(
          resolveReceiveState('op-1', empty, const <SyncOperation>[]),
          StRecvState.confirmed,
        );
        // Another screen's op in the queue must not be mistaken for ours.
        expect(
          resolveReceiveState('op-1', empty, <SyncOperation>[
            queued.copyWith(status: SyncOpStatus.failed),
          ]),
          StRecvState.failed,
        );
      },
    );
  });

  group('formatQty', () {
    test('groups whole quantities and trims fractional ones', () {
      expect(formatQty(1200), '1,200');
      expect(formatQty(800), '800');
      expect(formatQty(1.5), '1.5');
      expect(formatQty(-40), '-40');
      expect(formatQty(double.nan), '0');
    });
  });
}
