// Widget + repository tests for the mobile on-site material-issue screen
// (field-stock).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The repository group instead drives the REAL QueueDrainProcessor over
// an InMemorySyncQueue and a counting fake transport, so the offline + idempotency
// claims are proven against the real queue rather than a stub of it.
//
// The assertions that matter most are the negative ones: NO currency figure on the
// CTA, no price/value/currency anywhere in the rendered tree OR the posted body, an
// em-dash where the wire carries nothing, and a queued write never rendered as a
// success.
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_agg.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_repository.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_screen.dart';

/// th i18n with just the keys the screen references (values from i18n-full.json).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "inv.issueAdd.title": {"th":"เบิกวัสดุออก (Material Issue)"},
    "inv.issueAdd.itemsTitle": {"th":"รายการที่เบิก"},
    "inv.issueAdd.colStock": {"th":"สต็อก"},
    "inv.issue.colUsedFor": {"th":"ใช้กับ"},
    "common.confirm": {"th":"ยืนยัน"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape.
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "inv.issueAdd.title",
  "itemsTitle": "inv.issueAdd.itemsTitle",
  "stockLabel": "inv.issueAdd.colStock",
  "usedFor": "inv.issue.colUsedFor",
  "confirm": "common.confirm",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast"
}
''');

/// A real GET /inventory/stock row — it carries price/value/currency_code, which
/// the screen must never surface.
FieldStockEnt _stock({
  String itemId = 'i1',
  String? name = 'ปูนซีเมนต์ตราเสือ',
  String? code = 'MAT-CEM-001',
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

FieldStockEnt _wh(String id) => <String, Object?>{
  'id': id,
  'name': 'คลัง Block B',
  'created_at': '2026-01-01T00:00:00Z',
};

FieldStockEnt _project(String id) => <String, Object?>{
  'id': id,
  'name': 'juneflow พาร์ค ราชพฤกษ์',
};

/// A fake repo returning a scripted drain outcome. [outcome] null = the drain
/// touched nothing.
class _FakeRepo implements FieldStockRepository {
  _FakeRepo({
    this.outcome,
    this.stock,
    this.warehouses,
    this.projects = const <FieldStockEnt>[],
  });

  final SyncOutcome? outcome;
  final List<FieldStockEnt>? stock;
  final List<FieldStockEnt>? warehouses;
  final List<FieldStockEnt> projects;

  int submits = 0;
  int drains = 0;
  final List<String> opIds = <String>[];
  final List<List<FieldStockPick>> sentPicks = <List<FieldStockPick>>[];
  String? lastProjectId;
  String? lastWarehouseId;

  @override
  Future<List<FieldStockEnt>> listWarehouses() async =>
      warehouses ?? <FieldStockEnt>[_wh('w1')];

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) async =>
      stock ?? <FieldStockEnt>[_stock()];

  @override
  Future<List<FieldStockEnt>> listProjects() async => projects;

  @override
  Future<DrainReport> submitIssue({
    required String projectId,
    required String warehouseId,
    required List<FieldStockPick> picks,
    required String opId,
    required DateTime now,
  }) async {
    submits++;
    opIds.add(opId);
    sentPicks.add(picks);
    lastProjectId = projectId;
    lastWarehouseId = warehouseId;
    return _report(opId);
  }

  @override
  Future<DrainReport> drain() async {
    drains++;
    return const DrainReport(<SyncAttempt>[]);
  }

  @override
  Future<List<SyncOperation>> due() async {
    if (outcome == SyncOutcome.deferred) {
      return <SyncOperation>[
        _op(opIds.isEmpty ? 'x' : opIds.last, SyncOpStatus.pending),
      ];
    }
    if (outcome == SyncOutcome.permanentlyFailed) {
      return <SyncOperation>[
        _op(opIds.isEmpty ? 'x' : opIds.last, SyncOpStatus.failed),
      ];
    }
    return const <SyncOperation>[];
  }

  DrainReport _report(String opId) => outcome == null
      ? const DrainReport(<SyncAttempt>[])
      : DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: outcome!)]);
}

SyncOperation _op(String id, SyncOpStatus status) => SyncOperation(
  id: id,
  entityType: 'inventory_issue',
  kind: SyncOpKind.create,
  endpoint: '/inventory/issues',
  method: 'POST',
  payload: const <String, Object?>{},
  createdAt: DateTime.utc(2026),
  status: status,
);

Future<void> _pump(WidgetTester tester, _FakeRepo repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FieldStockScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Every text string currently in the tree.
List<String> _texts(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((Text t) => t.data ?? '')
    .toList();

void main() {
  group('render', () {
    testWidgets('shows the real material name, code, stock and unit', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(projects: <FieldStockEnt>[_project('p1')]));
      expect(find.text('ปูนซีเมนต์ตราเสือ'), findsOneWidget);
      // `code · stock N unit`, with the stock word from the sacred dict.
      expect(find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'), findsOneWidget);
    });

    testWidgets('the header eyebrow is the REAL warehouse name from the wire', (
      WidgetTester tester,
    ) async {
      // NOT the phrases-layer entry that exists for this very Thai string — that
      // entry is a seeded warehouse NAME, not UI copy (sidecar _deviations).
      await _pump(tester, _FakeRepo(projects: <FieldStockEnt>[_project('p1')]));
      expect(find.text('คลัง Block B'), findsOneWidget);
    });

    testWidgets('an absent name / code / unit / on-hand each em-dash', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          stock: <FieldStockEnt>[
            <String, Object?>{'item_id': 'i1'},
          ],
          projects: <FieldStockEnt>[_project('p1')],
        ),
      );
      expect(find.text('—'), findsWidgets);
      expect(find.text('— · สต็อก — —'), findsOneWidget);
    });

    testWidgets('an absent on-hand renders an em-dash, NEVER a 0', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          stock: <FieldStockEnt>[_stock(onHand: null)],
          projects: <FieldStockEnt>[_project('p1')],
        ),
      );
      // The stock line must not print a fabricated zero balance.
      expect(find.text('MAT-CEM-001 · สต็อก — ถุง'), findsOneWidget);
      expect(find.text('MAT-CEM-001 · สต็อก 0 ถุง'), findsNothing);
    });

    testWidgets('no warehouse resolves → honest-empty, no action bar', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(warehouses: const <FieldStockEnt>[]));
      expect(find.text('ยืนยัน'), findsNothing);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('an empty ledger renders honest-empty (today\'s real state)', (
      WidgetTester tester,
    ) async {
      // stock_ledger has no inbound writer anywhere in the system, so every real
      // balance read is empty. The screen must show that, not invent a shelf.
      await _pump(tester, _FakeRepo(stock: const <FieldStockEnt>[]));
      expect(find.text('ปูนซีเมนต์ตราเสือ'), findsNothing);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('the used-with slot shows the primary project', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(projects: <FieldStockEnt>[_project('p1'), _project('p2')]),
      );
      expect(find.text('ใช้กับ'), findsOneWidget);
      expect(find.text('juneflow พาร์ค ราชพฤกษ์'), findsWidgets);
    });
  });

  group('money — the 18,000 ฿ is gone and nothing replaces it', () {
    testWidgets('the CTA carries NO currency figure', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(projects: <FieldStockEnt>[_project('p1')]));
      // The prototype's CTA is `ยืนยันเบิก · 18,000 ฿`. Ours states the act only.
      expect(find.text('ยืนยัน'), findsOneWidget);
      expect(find.textContaining('18,000'), findsNothing);
      expect(find.textContaining('฿'), findsNothing);
    });

    testWidgets('no monetary token from the stock wire reaches the tree', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      // Stage a quantity — if a total were ever computed client-side, this is when
      // it would appear.
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();

      final String all = _texts(tester).join('|');
      expect(all, isNot(contains('168.5')));
      expect(all, isNot(contains('208940')));
      expect(all, isNot(contains('208,940')));
      expect(all, isNot(contains('THB')));
      expect(all, isNot(contains('฿')));
      // 80 × 168.5 = 13,480 — the total this screen refuses to compute.
      expect(all, isNot(contains('13,480')));
    });

    testWidgets(
      'a stock row whose ONLY values are monetary renders no number',
      (WidgetTester tester) async {
        await _pump(
          tester,
          _FakeRepo(
            stock: <FieldStockEnt>[
              <String, Object?>{
                'item_id': 'i1',
                'price': 168.5,
                'value': 208940,
                'currency_code': 'THB',
              },
            ],
            projects: <FieldStockEnt>[_project('p1')],
          ),
        );
        final String all = _texts(tester).join('|');
        expect(all, isNot(contains('168.5')));
        expect(all, isNot(contains('208940')));
        expect(all, isNot(contains('THB')));
        expect(find.text('— · สต็อก — —'), findsOneWidget);
      },
    );
  });

  group('the write', () {
    testWidgets('sends the staged quantities, the project and the warehouse', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(repo.submits, 1);
      expect(repo.lastProjectId, 'p1');
      expect(repo.lastWarehouseId, 'w1');
      expect(repo.sentPicks.single.single.itemId, 'i1');
      expect(repo.sentPicks.single.single.qty, 1);
    });

    testWidgets('the CTA is inert until a quantity is staged', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      // An empty basket 400s, and every 4xx is dead-lettered permanently — so it
      // must never reach the queue at all.
      expect(repo.submits, 0);
    });

    testWidgets('the CTA is inert with no project — project_id is required', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(projects: const <FieldStockEnt>[]);
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(repo.submits, 0);
    });
  });

  group('honest outcome', () {
    testWidgets('a DEFERRED write renders QUEUED, never a success', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      // SAVED, will retry — nothing was posted, so no stock was cut.
      expect(find.text('รอส่ง'), findsOneWidget);
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsNothing);
    });

    testWidgets('a queued retry REPLAYS the same op — never a second enqueue', (
      WidgetTester tester,
    ) async {
      // The outcome is UNKNOWN on this branch (the issue may have committed with
      // the response lost), so the same idempotency key must be reused.
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      final int drainsAfterFirst = repo.drains;
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(
        repo.submits,
        1,
        reason: 'a retry must not enqueue a second issue',
      );
      expect(repo.drains, greaterThan(drainsAfterFirst));
    });

    testWidgets('a 4xx renders FAILED', (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.permanentlyFailed,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
      expect(find.text('รอส่ง'), findsNothing);
    });

    testWidgets('retrying after a 4xx starts a FRESH op with a FRESH key', (
      WidgetTester tester,
    ) async {
      // A 4xx means the single-transaction handler wrote NOTHING, and drain()
      // never replays a dead-letter — so reusing the old key would be a button
      // that visibly does nothing.
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.permanentlyFailed,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(repo.submits, 2);
      expect(repo.opIds.toSet(), hasLength(2), reason: 'a fresh key each time');
    });
  });

  group('repository over the REAL queue + processor', () {
    late List<Map<String, Object?>> posted;
    late List<String> endpoints;

    setUp(() {
      posted = <Map<String, Object?>>[];
      endpoints = <String>[];
    });

    test(
      'posts to /inventory/issues with idempotency_key == the op id',
      () async {
        final QueueDrainProcessor p = QueueDrainProcessor(
          InMemorySyncQueue(),
          _CountingClient(201, posted, endpoints),
        );
        await DioFieldStockRepository(_unusedDio, p).submitIssue(
          projectId: 'p1',
          warehouseId: 'w1',
          picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 80)],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );

        expect(endpoints, <String>['/inventory/issues']);
        expect(posted.single['idempotency_key'], 'op-abc');
        expect(posted.single['project_id'], 'p1');
        expect(posted.single['from_warehouse_id'], 'w1');
      },
    );

    test('the posted body carries NO monetary field at all', () async {
      final QueueDrainProcessor p = QueueDrainProcessor(
        InMemorySyncQueue(),
        _CountingClient(201, posted, endpoints),
      );
      await DioFieldStockRepository(_unusedDio, p).submitIssue(
        projectId: 'p1',
        warehouseId: 'w1',
        picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 80)],
        opId: 'op-abc',
        now: DateTime.utc(2026),
      );

      final String body = jsonEncode(posted.single);
      for (final String token in <String>[
        'price',
        'value',
        'currency',
        'amount',
        '168.5',
      ]) {
        expect(
          body,
          isNot(contains(token)),
          reason: '$token must never be sent',
        );
      }
    });

    test(
      'a 5xx keeps the op queued; re-draining replays the byte-identical payload '
      'under the SAME key — so B-312 resolves it to the ORIGINAL issue',
      () async {
        final QueueDrainProcessor p = QueueDrainProcessor(
          InMemorySyncQueue(),
          _CountingClient(503, posted, endpoints),
        );
        final DioFieldStockRepository repo = DioFieldStockRepository(
          _unusedDio,
          p,
        );
        await repo.submitIssue(
          projectId: 'p1',
          warehouseId: 'w1',
          picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 80)],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );
        await repo.drain();
        await repo.drain();

        // Without a stable key in the BODY, these three replays would be three
        // material issues: three JVs and a triple stock decrement.
        expect(posted.length, 3);
        expect(
          posted.every(
            (Map<String, Object?> b) => b['idempotency_key'] == 'op-abc',
          ),
          isTrue,
        );
        expect(posted.map(jsonEncode).toSet().length, 1);
      },
    );

    test('a 4xx dead-letters and is never replayed by a later drain', () async {
      // Why the screen mints a fresh key to retry a permanent failure.
      final QueueDrainProcessor p = QueueDrainProcessor(
        InMemorySyncQueue(),
        _CountingClient(409, posted, endpoints),
      );
      final DioFieldStockRepository repo = DioFieldStockRepository(
        _unusedDio,
        p,
      );
      await repo.submitIssue(
        projectId: 'p1',
        warehouseId: 'w1',
        picks: const <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: 80)],
        opId: 'op-abc',
        now: DateTime.utc(2026),
      );
      await repo.drain();
      await repo.drain();

      expect(posted.length, 1, reason: 'a dead-letter must never be replayed');
    });
  });
}

final Dio _unusedDio = Dio();

class _CountingClient implements SyncApiClient {
  _CountingClient(this.status, this.posted, this.endpoints);

  final int status;
  final List<Map<String, Object?>> posted;
  final List<String> endpoints;

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    endpoints.add(endpoint);
    posted.add(Map<String, Object?>.of(payload));
    return SyncApiResponse(statusCode: status);
  }
}
