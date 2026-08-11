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
import 'dart:async';
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
///
/// [createdAt] is what `selectWarehouse` sorts the bare tab route's "newest" by, so a
/// fixture that adds a warehouse mid-mount has to be able to make it NEWER than the
/// one already on screen — otherwise "the register grew" and "the subject moved" are
/// indistinguishable and the growth proves nothing.
FieldStockEnt _wh(
  String id, {
  String? name = 'คลัง Block B',
  String createdAt = '2026-01-01T00:00:00Z',
}) => <String, Object?>{
  'id': id,
  if (name != null) 'name': name,
  'created_at': createdAt,
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

  /// The ops the queue still holds.
  ///
  /// NOTHING IS DUE BEFORE A SUBMIT. The earlier version answered with an op keyed
  /// `'x'` even when this repo had never been asked to enqueue anything, which is not
  /// a queue any device has: it made the ON-MOUNT adoption read see a phantom op. It
  /// stayed inert only because that op ALSO carried an empty payload, so the anchor
  /// could not match it — one accident cancelling another. Both halves are fixed here
  /// rather than one, because the payload fix alone would have made every
  /// `deferred` test adopt a phantom on mount and freeze its basket before it began.
  ///
  /// AND THE PAYLOAD NOW CARRIES THE ANCHOR. `fieldStockOpIdentity` matches on
  /// `from_warehouse_id`, so an anchorless op is unadoptable no matter WHAT its
  /// status is — which meant "a 4xx dead-letter is not adopted" was proven by the
  /// empty payload rather than by the status check it is named for. With a real
  /// anchor the status check is the only thing left holding it, and deleting that
  /// check now turns the test red.
  ///
  /// `outcome == null` means the drain touched nothing AND the queue no longer holds
  /// it — an earlier pass already synced it — which is what `resolveIssueState` reads
  /// an absence as.
  @override
  Future<List<SyncOperation>> due() async {
    if (opIds.isEmpty) return const <SyncOperation>[];
    if (outcome == SyncOutcome.deferred) {
      return <SyncOperation>[
        // `lastWarehouseId` is non-null whenever `opIds` is non-empty (both are set
        // by `submitIssue`), so this asserts an invariant rather than defaulting
        // around a null and anchoring the op to the wrong shelf in silence.
        _op(opIds.last, SyncOpStatus.pending, warehouseId: lastWarehouseId!),
      ];
    }
    if (outcome == SyncOutcome.permanentlyFailed) {
      return <SyncOperation>[
        _op(opIds.last, SyncOpStatus.failed, warehouseId: lastWarehouseId!),
      ];
    }
    return const <SyncOperation>[];
  }

  DrainReport _report(String opId) => outcome == null
      ? const DrainReport(<SyncAttempt>[])
      : DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: outcome!)]);
}

/// A [_FakeRepo] whose WRITE blocks until [gate] is completed.
///
/// EVERY other fake in this file resolves synchronously, so `pumpAndSettle` walks
/// straight past `submitting` and NOTHING in the suite ever observes the screen in
/// it. That is how both of the guards keyed to that state — the re-entrancy return in
/// `_onConfirm` and the `_state != FieldStockState.submitting` term that greys the
/// CTA — could be deleted with the suite still green. A held write is the only thing
/// that makes the state last long enough to look at.
class _GatedRepo extends _FakeRepo {
  _GatedRepo({super.outcome, super.projects});

  final Completer<void> gate = Completer<void>();

  @override
  Future<DrainReport> submitIssue({
    required String projectId,
    required String warehouseId,
    required List<FieldStockPick> picks,
    required String opId,
    required DateTime now,
  }) async {
    await gate.future;
    return super.submitIssue(
      projectId: projectId,
      warehouseId: warehouseId,
      picks: picks,
      opId: opId,
      now: now,
    );
  }
}

/// A [_FakeRepo] whose shelf CHANGES between reads, which is what a real
/// GET /inventory/stock does the moment an issue commits.
///
/// A fixture that returns the same balance forever cannot tell a screen that re-reads
/// from one that does not — both render 1,240 — so the refresh has to be measured
/// against a server whose answer actually moved.
/// 1,240 before the first issue, then −100 per read as each issue's ledger row
/// lands. A CLAMPED two-entry list was the first version of this, and it made the
/// third read hand back 1,140 again — a physically impossible balance sitting in the
/// tree of the two-issue test, inert only because nothing looks at it yet. A
/// fixture that goes quietly wrong past the case it was written for is a trap for
/// the next assertion added to it, so it decrements without end instead.
class _RefreshingRepo extends _FakeRepo {
  _RefreshingRepo({super.outcome, super.projects});

  static const int openingBalance = 1240;
  static const int cutPerIssue = 100;

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) async {
    final int call = stockReadFor.length;
    stockReadFor.add(warehouseId);
    return <FieldStockEnt>[_stock(onHand: openingBalance - cutPerIssue * call)];
  }
}

/// A [_FakeRepo] whose REGISTER GAINS A WAREHOUSE between reads — an admin creating
/// one while the storekeeper is working, which is the only thing needed to move a
/// subject that is re-derived as "the newest".
///
/// The new row is NEWER than the one on screen, because `selectWarehouse` sorts the
/// bare tab route's choice by `created_at`: a register that merely grew by an OLDER
/// row could not tell a pinned subject from a re-derived one.
///
/// It grows ONCE and then stays put — a warehouse that has been created does not
/// un-create itself — so read 3 and read 30 answer the same thing as read 2. A
/// fixture that toggled would make any later assertion depend on the read count.
///
/// The SHELF is inherited unchanged, so both warehouses hand back the identical stock
/// row. That is deliberate: it means the test cannot detect a moved subject by reading
/// the rows, and has to prove it where it matters — `stockReadFor` (which warehouse's
/// balances were actually requested) and `lastWarehouseId` (which warehouse the WRITE
/// named). A fixture that gave the two shelves different contents would let the test
/// pass on the display while the payload moved underneath it.
class _GrowingRegisterRepo extends _FakeRepo {
  _GrowingRegisterRepo({super.outcome, super.projects});

  /// How many times the screen asked for the register. The post-confirm refresh is
  /// the second, and it is the whole point of this fixture.
  int warehouseReads = 0;

  @override
  Future<List<FieldStockEnt>> listWarehouses() async {
    warehouseReads++;
    return <FieldStockEnt>[
      _wh('w-B', name: 'คลัง Block B'),
      if (warehouseReads > 1)
        _wh(
          'w-C',
          name: 'คลัง Block C',
          createdAt: '2026-06-01T00:00:00Z', // NEWER than w-B
        ),
    ];
  }
}

/// A [_FakeRepo] whose queue ALREADY HOLDS a pending issue when the screen mounts —
/// the tab swap that destroys this screen's State while the queue survives (B-330).
///
/// [queue] IS the queue: `due()` hands back exactly what is in it, so a test that
/// wants the op to sync removes it rather than asking the fixture to guess. Nothing
/// here clears it on drain, and that is faithful rather than convenient — the device
/// is offline, which is why the op is still there.
class _QueuedOnMountRepo extends _FakeRepo {
  _QueuedOnMountRepo({
    String opId = 'op-from-the-last-mount',
    String projectId = 'p1',
    String warehouseId = 'w1',
    super.projects,
  }) : queue = <SyncOperation>[
         _op(
           opId,
           SyncOpStatus.pending,
           warehouseId: warehouseId,
           projectId: projectId,
           qty: 3,
         ),
       ];

  final List<SyncOperation> queue;

  @override
  Future<List<SyncOperation>> due() async => List<SyncOperation>.of(queue);
}

/// A [_FakeRepo] whose POST-CONFIRM REFRESH fails — the site connection that dropped
/// between the issue committing and the shelf being re-read.
///
/// The first read succeeds (there has to be a shelf to issue from) and EVERY read
/// after it throws, so it cannot quietly come back to life in a later assertion.
class _RefreshThrowsRepo extends _FakeRepo {
  _RefreshThrowsRepo({super.outcome, super.projects});

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) async {
    final bool first = stockReadFor.isEmpty;
    stockReadFor.add(warehouseId);
    if (!first) throw Exception('no route to host');
    return <FieldStockEnt>[_stock()];
  }
}

/// The confirm CTA's tap handler, or null when the button is dead. Read off the
/// GestureDetector rather than inferred from a colour, because "dead" is a property
/// of the callback and the colour merely reports it.
VoidCallback? _ctaOnTap(WidgetTester tester) => tester
    .widget<GestureDetector>(
      find
          .ancestor(
            of: find.text('ยืนยัน'),
            matching: find.byType(GestureDetector),
          )
          .first,
    )
    .onTap;

/// One queued issue as the REAL repository would have built it — same entityType,
/// same endpoint and, decisively, the same `from_warehouse_id` anchor
/// `fieldStockOpIdentity` matches on. [projectId] is the attribution the op CHARGES,
/// which the anchor deliberately excludes.
///
/// The payload is built by `buildIssuePayload` itself rather than hand-written, so a
/// change to the real body shape cannot leave this fixture describing a body no
/// repository would produce. Its line is `i1`, which is `_stock()`'s default item —
/// the two are tied on purpose, so an op in the queue refers to a row that is really
/// on the shelf the screen loads.
///
/// [warehouseId] is REQUIRED-with-a-default rather than nullable: every caller knows
/// its warehouse, and a `?? 'w1'` fallback would let a null slip through as a
/// silently-anchored op that matches the wrong screen.
SyncOperation _op(
  String id,
  SyncOpStatus status, {
  String warehouseId = 'w1',
  String projectId = 'p1',
  double qty = 1,
}) => SyncOperation(
  id: id,
  entityType: 'inventory_issue',
  kind: SyncOpKind.create,
  endpoint: '/inventory/issues',
  method: 'POST',
  payload: buildIssuePayload(
    projectId: projectId,
    fromWarehouseId: warehouseId,
    picks: <FieldStockPick>[FieldStockPick(itemId: 'i1', qty: qty)],
    idempotencyKey: id,
  ),
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

  // `submitting` was, until this group, a state no test had ever seen: every fake
  // resolves in a microtask, so `pumpAndSettle` steps over it and the two guards keyed
  // to it were unfalsifiable. A Completer-held write makes it last.
  group('submitting is a state something can be IN', () {
    testWidgets('the CTA is DEAD while the write is in flight', (
      WidgetTester tester,
    ) async {
      final _GatedRepo repo = _GatedRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      expect(
        _ctaOnTap(tester),
        isNotNull,
        reason:
            'staged and idle — the button is live, or the test proves nothing',
      );

      await tester.tap(find.text('ยืนยัน'));
      await tester.pump(); // repaint with the submit in flight

      expect(
        _ctaOnTap(tester),
        isNull,
        reason:
            'a live-looking button over an in-flight material issue invites the '
            'second tap this whole round exists to make impossible; the basket '
            'is still staged, so `_canSubmit` alone keeps it enabled and only '
            'the `_state != submitting` term takes it down',
      );

      repo.gate.complete();
      await tester.pumpAndSettle();
      expect(repo.submits, 1);
      expect(
        _ctaOnTap(tester),
        isNotNull,
        reason: 'and it comes back once the write lands — dead, not disabled',
      );
    });
  });

  // A confirmed issue really did cut the ledger, so every `on_hand` on screen is now
  // the PRE-ISSUE balance. The emptied basket says "done"; a stale balance states a
  // FACT that is no longer true, and it is the number the next issue is sized against.
  group('a confirmed issue re-reads the shelf', () {
    testWidgets(
      'the row shows the POST-issue balance, not the one it was sized '
      'against',
      (WidgetTester tester) async {
        final _RefreshingRepo repo = _RefreshingRepo(
          outcome: SyncOutcome.synced,
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo);
        expect(find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'), findsOneWidget);

        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();

        expect(
          repo.stockReadFor.length,
          2,
          reason: 'the confirmation must re-run GET /inventory/stock',
        );
        expect(find.text('MAT-CEM-001 · สต็อก 1,140 ถุง'), findsOneWidget);
        expect(
          find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'),
          findsNothing,
          reason: 'the pre-issue figure must be GONE, not merely joined',
        );
      },
    );

    testWidgets('a QUEUED issue does NOT re-read — nothing has been cut yet', (
      WidgetTester tester,
    ) async {
      // Pins the refresh to `confirmed` specifically. A deferred write has touched
      // no ledger, so re-reading would either change nothing or — worse, on a
      // half-open link — spend a round trip to redraw the same number while the
      // real write is still waiting.
      final _RefreshingRepo repo = _RefreshingRepo(
        outcome: SyncOutcome.deferred,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(repo.stockReadFor.length, 1);
      expect(find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'), findsOneWidget);
    });

    testWidgets(
      'the refresh does NOT re-subject the screen when the register gains a '
      'NEWER warehouse — the shelf that was issued from is the shelf that stays',
      (WidgetTester tester) async {
        // THE ANCHOR'S OWN INVARIANT, and it is the one the whole B-330 design rests
        // on: `from_warehouse_id` is what recognises this screen's queued op, so it
        // has to be the same value for the life of the mount.
        //
        // `_load()` has TWO call sites — `initState` and the post-`confirmed`
        // refresh — and the bare TAB route carries no `warehouseId`
        // (mobile_screen_router.dart pushes `const FieldStockScreenHost()`, so this
        // is 100% of production mounts). Re-resolving the subject from
        // `widget.warehouseId` therefore re-runs "follow the register's NEWEST"
        // against a register that may have grown since. The storekeeper standing at
        // Block B would then find the eyebrow, the shelf and the write's warehouse
        // silently moved to a warehouse created a minute ago by an admin — and his
        // next confirm posts a `stock_ledger` row at −qty against the WRONG shelf
        // plus a Dr 1140 / Cr 5020 JV, with no return or reverse op anywhere in the
        // nine /inventory paths to undo it.
        final _GrowingRegisterRepo repo = _GrowingRegisterRepo(
          outcome: SyncOutcome.synced,
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo); // the bare tab route: NO warehouseId
        expect(repo.stockReadFor, <String>['w-B']);
        expect(find.text('คลัง Block B'), findsOneWidget);

        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        expect(repo.lastWarehouseId, 'w-B');

        // The refresh really did re-read a register that really did grow — without
        // both halves this proves nothing.
        expect(
          repo.warehouseReads,
          2,
          reason: 'the confirmation re-runs the whole read chain',
        );
        expect(repo.stockReadFor, <String>[
          'w-B',
          'w-B',
        ], reason: 'the re-read must be of the SAME shelf');
        expect(find.text('คลัง Block B'), findsOneWidget);
        expect(find.text('คลัง Block C'), findsNothing);

        // And the NEXT issue in the same mount still draws down w-B. This is the
        // assertion with the money behind it: the eyebrow is a display, the
        // warehouse on the write is a stock movement.
        await tester.tap(find.byIcon(Icons.add).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();
        expect(repo.submits, 2);
        expect(repo.lastWarehouseId, 'w-B');
      },
    );

    testWidgets('a refresh that FAILS is not painted as a failed ISSUE, and the shelf keeps '
        'its last known balance', (WidgetTester tester) async {
      // The refresh is fired unawaited and its errors are swallowed on purpose:
      // the issue COMMITTED, and a dropped connection on the follow-up read must
      // not turn a successful write into a failure chip. Until now that swallow
      // was unpinned — deleting the `onError` handler left the suite green while
      // the error escaped as an unhandled async exception.
      final _RefreshThrowsRepo repo = _RefreshThrowsRepo(
        outcome: SyncOutcome.synced,
        projects: <FieldStockEnt>[_project('p1')],
      );
      await _pump(tester, repo);
      expect(find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();

      expect(
        repo.stockReadFor.length,
        2,
        reason: 'the refresh was attempted, and it threw',
      );
      expect(repo.submits, 1);
      // Neither chip: the ISSUE succeeded.
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsNothing);
      expect(find.text('รอส่ง'), findsNothing);
      // The confirmation still landed — the emptied basket IS the confirmation.
      expect(find.text('0'), findsOneWidget);
      // And the row keeps its LAST KNOWN balance rather than blanking to an
      // em-dash: `_apply` simply never ran.
      expect(find.text('MAT-CEM-001 · สต็อก 1,240 ถุง'), findsOneWidget);
    });

    testWidgets('the refresh does NOT reset a picked project back to the primary', (
      WidgetTester tester,
    ) async {
      // The reload runs the same `_apply` as the first load, and `_apply` is where
      // the primary-project default lives. Re-defaulting there would move the NEXT
      // issue's attribution off the project the storekeeper deliberately chose —
      // a wrong `project_id` on a money write, made invisibly by a refresh.
      final _RefreshingRepo repo = _RefreshingRepo(
        outcome: SyncOutcome.synced,
        projects: <FieldStockEnt>[
          _project('p1', name: 'A'),
          _project('p2', name: 'B'),
        ],
      );
      await _pump(tester, repo);
      await tester.tap(find.text('A')); // the used-with slot
      await tester.pumpAndSettle();
      await tester.tap(find.text('B').last); // the sheet row
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(repo.lastProjectId, 'p2');

      // The shelf was re-read, and the attribution survived it.
      expect(repo.stockReadFor.length, 2);
      expect(find.text('B'), findsOneWidget);
      expect(find.text('A'), findsNothing);

      // And the NEXT issue still charges p2.
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('ยืนยัน'));
      await tester.pumpAndSettle();
      expect(repo.lastProjectId, 'p2');
      expect(repo.submits, 2);
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

  // The tab swap (B-330) destroys this State and leaves the QUEUE alone, so the
  // screen comes back and ADOPTS its own outstanding op. What the returning screen
  // then SAYS about that op, and what it lets the storekeeper DO about it, are two
  // separate claims and both were unpinned.
  group('an ADOPTED op — what the returning screen states, and what it allows', () {
    testWidgets(
      'the frozen picker shows the project the op CHARGES, not the primary the '
      'fresh load defaulted to',
      (WidgetTester tester) async {
        // The CONTRAST for the em-dash test below: without it, "the slot shows an
        // em-dash" would also pass on a screen that never adopted anything at all.
        final _QueuedOnMountRepo repo = _QueuedOnMountRepo(
          projectId: 'p2',
          projects: <FieldStockEnt>[
            _project('p1', name: 'โครงการ A'),
            _project('p2', name: 'โครงการ B'),
          ],
        );
        await _pump(tester, repo);

        expect(
          find.text('รอส่ง'),
          findsOneWidget,
          reason: 'the op was adopted',
        );
        expect(find.text('โครงการ B'), findsOneWidget);
        expect(
          find.text('โครงการ A'),
          findsNothing,
          reason:
              'the default must not be shown as the outstanding write\'s '
              'attribution',
        );
      },
    );

    testWidgets('a charged project that no longer resolves em-dashes — it does NOT fall '
        'back to a DIFFERENT real project\'s name', (WidgetTester tester) async {
      // The archived / paged-out project (GET /projects sends no pagination
      // params, so page 1 is all this screen ever sees). The op charges p-GONE and
      // the picker is FROZEN behind it, so whatever the slot says is presented as
      // the attribution of a write the storekeeper cannot edit. An em-dash is
      // honest; the primary project's name is an affirmative false statement, and
      // it is not made honest by being a real name rather than an invented one.
      final _QueuedOnMountRepo repo = _QueuedOnMountRepo(
        projectId: 'p-GONE',
        projects: <FieldStockEnt>[_project('p1', name: 'โครงการ A')],
      );
      await _pump(tester, repo);

      expect(find.text('รอส่ง'), findsOneWidget, reason: 'the op was adopted');
      expect(
        find.text('โครงการ A'),
        findsNothing,
        reason: 'the op does not charge โครงการ A',
      );
      // The eyebrow, the material row and the title are all fully populated, so
      // the used-with slot is the ONLY site that can produce this glyph — the
      // em-dash dies alone here.
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets(
      'the CTA is a LIVE manual retry over the adopted op — it re-drains that op '
      'and never enqueues a second',
      (WidgetTester tester) async {
        // The adopted basket is EMPTY (the quantities died with the old State), so
        // `_canSubmit` is false and the CTA used to be dead: the storekeeper was
        // shown `รอส่ง` over a zeroed frozen basket with no way to act at all,
        // recoverable only by switching tabs again. `_onConfirm`'s own doc claimed
        // the opposite — "while an outcome is UNKNOWN (queued) it re-drains the SAME
        // op, a manual retry" — so this pins the doc, not just the button.
        final _QueuedOnMountRepo repo = _QueuedOnMountRepo(
          projects: <FieldStockEnt>[_project('p1')],
        );
        await _pump(tester, repo);
        expect(find.text('รอส่ง'), findsOneWidget);
        expect(
          find.text('0'),
          findsOneWidget,
          reason: 'the adopted basket really is empty, or this proves nothing',
        );

        expect(
          _ctaOnTap(tester),
          isNotNull,
          reason: 'a queued op with no basket must still be retryable',
        );

        final int drainsBefore = repo.drains;
        await tester.tap(find.text('ยืนยัน'));
        await tester.pumpAndSettle();

        expect(
          repo.drains,
          greaterThan(drainsBefore),
          reason: 'the tap re-drained the adopted op',
        );
        expect(
          repo.submits,
          0,
          reason:
              'a retry of a live op must never enqueue a second issue — that '
              'is a second stock cut and a second Dr 1140 / Cr 5020 JV',
        );
        // Still queued, still frozen: nothing about the op changed.
        expect(find.text('รอส่ง'), findsOneWidget);
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
