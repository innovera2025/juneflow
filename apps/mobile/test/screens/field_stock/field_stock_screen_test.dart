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

/// A warehouse wire row. [name] null = the wire resolved the warehouse but carried
/// no name — the eyebrow's own em-dash site.
FieldStockEnt _wh(String id, {String? name = 'คลัง Block B'}) =>
    <String, Object?>{
      'id': id,
      if (name != null) 'name': name,
      'created_at': '2026-01-01T00:00:00Z',
    };

/// A project wire row. [name] null = a real project with no name on the wire — the
/// used-with slot's and the picker sheet's own em-dash sites.
FieldStockEnt _project(String id, {String? name = 'juneflow พาร์ค ราชพฤกษ์'}) =>
    <String, Object?>{'id': id, if (name != null) 'name': name};

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

  /// Which warehouse ids the screen actually asked for stock on — so a pushed id
  /// can be proven to reach the READ, not merely the eyebrow.
  final List<String> stockReadFor = <String>[];

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) async {
    stockReadFor.add(warehouseId);
    return stock ?? <FieldStockEnt>[_stock()];
  }

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

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? warehouseId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FieldStockScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          warehouseId: warehouseId,
        ),
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
      // EXACTLY two, and the count is the point: a `findsWidgets` here was
      // satisfied by the honest-empty BODY alone, so it went green even when the
      // header eyebrow stopped em-dashing. Both sites also have their own
      // dies-alone test in the "each em-dash site" group below.
      expect(
        find.text('—'),
        findsNWidgets(2),
        reason: 'the header eyebrow AND the honest-empty body',
      );
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

    testWidgets(
      'a FOREIGN pushed warehouse id renders honest-empty — it never draws down '
      'a different shelf',
      (WidgetTester tester) async {
        // The screen passes its pushed id straight to selectWarehouse, so this is
        // a SECOND site for that rule and needs its own assertion: the agg test
        // alone would still pass if the screen ignored a null resolution and fell
        // back to the newest warehouse. On a screen that decrements stock and posts
        // a JV, silently issuing from another warehouse is the worst failure
        // available.
        final _FakeRepo repo = _FakeRepo(
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo, warehouseId: 'not-my-warehouse');

        expect(find.text('ปูนซีเมนต์ตราเสือ'), findsNothing);
        expect(find.text('ยืนยัน'), findsNothing, reason: 'no action bar');
        expect(find.text('—'), findsWidgets);
      },
    );

    testWidgets('a pushed warehouse id is the one whose stock is read', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        warehouses: <FieldStockEnt>[_wh('w1'), _wh('w2')],
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo, warehouseId: 'w2');
      expect(repo.stockReadFor, <String>['w2']);
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

  // Each `?? _dash` in the screen gets a scenario where it is the ONLY em-dash in
  // the tree, so mutating that ONE site to `?? ''` turns exactly this test red.
  // A shared `findsWidgets` assertion cannot do that: a sibling site satisfies it
  // and the mutation ships green — which is how the eyebrow, the used-with slot
  // and the picker row went unpinned while the row's name/code/unit/on-hand were
  // covered (they are pinned by the exact `'— · สต็อก — —'` string).
  group('each em-dash site is pinned so it dies ALONE', () {
    testWidgets('the header eyebrow — a resolved warehouse with no name', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          warehouses: <FieldStockEnt>[_wh('w1', name: null)],
          projects: <FieldStockEnt>[_project('p1')],
        ),
      );
      // The stock row, the project and the title are all fully populated, so the
      // eyebrow is the only site that can produce this glyph.
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('the used-with slot — a real project with no name', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(projects: <FieldStockEnt>[_project('p1', name: null)]),
      );
      // The project resolves (it has an id, so `project_id` is set and the CTA is
      // live) — it is only its NAME that the wire did not carry.
      expect(find.text('ยืนยัน'), findsOneWidget);
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('a picker-sheet row — one named project, one with no name', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          projects: <FieldStockEnt>[
            _project('p1', name: 'A'),
            _project('p2', name: null),
          ],
        ),
      );
      expect(find.text('—'), findsNothing, reason: 'nothing dashes yet');

      await tester.tap(find.text('A')); // the used-with slot
      await tester.pumpAndSettle();

      // The sheet is open: one row carries its name, the other em-dashes. The
      // used-with slot still shows 'A', so this glyph can only be the sheet row.
      expect(find.byType(ListTile), findsNWidgets(2));
      expect(find.text('—'), findsOneWidget);
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

    testWidgets(
      'a CONFIRMED issue EMPTIES the basket — that IS the confirmation, and the '
      'CTA is then inert rather than draining an empty queue',
      (WidgetTester tester) async {
        // The `confirmed` branch had NO UI assertion at all: the synced tests
        // checked repo.submits / sentPicks only, so the screen could render
        // nothing whatsoever on a successful issue and stay green.
        final _FakeRepo repo = _FakeRepo(
          outcome: SyncOutcome.synced,
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo);
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pump();
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        expect(find.text('2'), findsOneWidget);

        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        final int drainsAfterConfirm = repo.drains;

        expect(repo.submits, 1);
        expect(repo.sentPicks.single.single.qty, 2);
        // THE VISIBLE CHANGE. No chip and no takeover — neither has a key — but
        // the staged quantity is gone, which is a state change the storekeeper
        // cannot miss and which costs no copy.
        expect(find.text('2'), findsNothing);
        expect(find.text('0'), findsOneWidget);
        expect(find.text('รอส่ง'), findsNothing);
        expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsNothing);

        // The emptied basket also disables the CTA, so a stray tap posts nothing
        // and does not silently re-drain either.
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        expect(repo.submits, 1);
        expect(repo.drains, drainsAfterConfirm);
      },
    );

    testWidgets(
      'a SECOND issue in the same mount is really SUBMITTED — the CTA does not '
      'go silently dead after one confirmed issue',
      (WidgetTester tester) async {
        // The 09:00 / 10:00 storekeeper: two issues from the same tab, no
        // remount. Before this fix the second tap took the drain branch against
        // an empty queue, resolved to `confirmed` again, rendered NOTHING, and
        // the second issue was silently lost.
        final _FakeRepo repo = _FakeRepo(
          outcome: SyncOutcome.synced,
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo);
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        final int drainsAfterConfirm = repo.drains;

        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pump();
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();

        // Asserted as a PAIR so a regression reports both halves of the defect at
        // once: before the fix this read [submits 1, drains 2] — the second tap
        // took the drain branch against an empty queue, resolved to `confirmed`
        // again, and rendered nothing at all.
        expect(
          <int>[repo.submits, repo.drains],
          <int>[2, drainsAfterConfirm],
          reason:
              'a NEW issue is an ENQUEUE, never a re-drain of a finished op',
        );
        expect(
          repo.opIds.toSet(),
          hasLength(2),
          reason:
              'a new issue must NOT reuse the confirmed op key — the server '
              'would resolve it to the FIRST issue and the second would never post',
        );
        expect(repo.sentPicks.last.single.qty, 2);
      },
    );

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

  // The queue replays `op.payload` VERBATIM. So from the moment an op is live, the
  // basket on screen must be exactly the basket that will be posted: an edit that
  // is accepted and displayed but not sent is a lie about how much material is
  // leaving the warehouse.
  group('a QUEUED basket is FROZEN — what is shown is what will be replayed', () {
    testWidgets('the steppers cannot move a queued quantity', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      for (int i = 0; i < 3; i++) {
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pump();
      }
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(find.text('รอส่ง'), findsOneWidget);
      expect(repo.sentPicks.single.single.qty, 3);

      await tester.tap(find.byIcon(Icons.remove).first);
      await tester.pump();
      await tester.tap(find.byIcon(Icons.remove).first);
      await tester.pumpAndSettle();

      // 3 m³ of sand are in the queue; the screen must not read 1.
      expect(
        find.text('3'),
        findsOneWidget,
        reason: 'the displayed basket is the queued basket',
      );
      expect(find.text('1'), findsNothing);

      // And the retry still replays the SAME op — the freeze is not a disguised
      // re-enqueue, which would be a SECOND write of the same material.
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(repo.submits, 1);
      expect(repo.sentPicks.single.single.qty, 3);
    });

    testWidgets('the project picker is frozen while an op is queued', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[
          _project('p1', name: 'A'),
          _project('p2', name: 'B'),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(find.text('รอส่ง'), findsOneWidget);

      await tester.tap(find.text('A')); // the used-with slot
      await tester.pumpAndSettle();

      // `project_id` is inside the enqueued payload: re-picking here would show
      // one project and charge a different project's WIP on the replay.
      expect(find.byType(ListTile), findsNothing);
      expect(find.text('B'), findsNothing);
      expect(repo.lastProjectId, 'p1');
    });

    testWidgets('the picker WORKS when no op is live (the contrast)', (
      WidgetTester tester,
    ) async {
      // Without this, "frozen" above would also pass on a picker that never
      // opened at all.
      final _FakeRepo repo = _FakeRepo(
        outcome: SyncOutcome.synced,
        projects: <FieldStockEnt>[
          _project('p1', name: 'A'),
          _project('p2', name: 'B'),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      expect(find.byType(ListTile), findsNWidgets(2));

      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();
      expect(find.text('B'), findsOneWidget, reason: 'the slot now reads B');

      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(repo.lastProjectId, 'p2');
    });

    testWidgets(
      'a FAILED basket is editable again, and the edit is what gets sent',
      (WidgetTester tester) async {
        // The negative-stock 409 is a 4xx and is TODAY the common outcome, and
        // reducing the quantity is its only recovery — so the freeze must end
        // with the op. Nothing was written under the old key, and the fresh op
        // carries the EDITED basket, not the rejected one.
        final _FakeRepo repo = _FakeRepo(
          outcome: SyncOutcome.permanentlyFailed,
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo);
        for (int i = 0; i < 3; i++) {
          await tester.tap(find.byIcon(Icons.add).first);
          await tester.pump();
        }
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        expect(
          find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'),
          findsOneWidget,
        );

        await tester.tap(find.byIcon(Icons.remove).first);
        await tester.pump();
        await tester.tap(find.byIcon(Icons.remove).first);
        await tester.pumpAndSettle();
        expect(find.text('1'), findsOneWidget);

        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();

        expect(repo.submits, 2);
        expect(repo.opIds.toSet(), hasLength(2));
        expect(
          repo.sentPicks.last.single.qty,
          1,
          reason: 'the retry sends the reduced quantity, not the rejected 3',
        );
      },
    );
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
