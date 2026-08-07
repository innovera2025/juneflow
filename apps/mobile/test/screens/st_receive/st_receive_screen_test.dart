// Widget + repository tests for the mobile count-and-receive screen (st-receive).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network. The repository group instead drives the REAL QueueDrainProcessor over
// an InMemorySyncQueue and a counting fake transport, so the offline claims are
// proven against the real queue rather than a stub of it.
//
// The assertions that matter most are the negative ones: the em-dash where the wire
// carries nothing, the ABSENCE of any invented delta word, the absence of price/name
// in the body, and the fact that a queued write is never rendered as a success.
import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_agg.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_repository.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_screen.dart';

/// th i18n with just the keys the screen references (values from i18n-full.json).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "gr.create.colOrdered": {"th":"สั่ง"},
    "gr.create.colReceived": {"th":"รับ"},
    "common.confirm": {"th":"ยืนยัน"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"}
  },
  "nav_i18n": {},
  "phrases": {
    "ตรวจนับ-รับของ": {"en":"Count & Receive"},
    "ใบส่งของ": {"en":"Delivery Note"}
  },
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape.
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "ตรวจนับ-รับของ",
  "deliveryNote": "ใบส่งของ",
  "colOrdered": "gr.create.colOrdered",
  "colReceived": "gr.create.colReceived",
  "confirm": "common.confirm",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast"
}
''');

/// A real GET /pr/:id item row (pr.ts prItemWire) — carries price/amount, which
/// the screen must never surface.
StRecvEnt _item(String id, Object qty) => <String, Object?>{
  'id': id,
  'pr_id': 'pr1',
  'boq_item_id': 'b1',
  'qty': qty,
  'price': 32.5,
  'amount': 26000,
};

/// A fake repo returning a scripted drain outcome. [outcome] null = the drain
/// touched nothing (an offline no-response).
class _FakeRepo implements StReceiveRepository {
  _FakeRepo({this.outcome, this.items, this.po});

  final SyncOutcome? outcome;
  final List<StRecvEnt>? items;
  final StRecvEnt? po;

  int submits = 0;
  int drains = 0;
  String? lastOpId;
  List<double>? lastCounts;

  @override
  Future<StRecvEnt?> loadPo(String poId) async =>
      po ?? <String, Object?>{'id': poId, 'no': 'PO-1', 'pr_id': 'pr1'};

  @override
  Future<StRecvEnt?> loadPr(String prId) async => <String, Object?>{
    'id': prId,
    'items': items ?? <StRecvEnt>[_item('a', 800), _item('b', 40)],
  };

  @override
  Future<DrainReport> submitReceipt({
    required String poId,
    required List<double> counts,
    required String opId,
    required DateTime now,
  }) async {
    submits++;
    lastOpId = opId;
    lastCounts = List<double>.of(counts);
    return _report(opId);
  }

  @override
  Future<DrainReport> drain() async {
    drains++;
    final String? id = lastOpId;
    return id == null ? const DrainReport(<SyncAttempt>[]) : _report(id);
  }

  DrainReport _report(String opId) {
    final SyncOutcome? o = outcome;
    if (o == null) return const DrainReport(<SyncAttempt>[]);
    return DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: o)]);
  }

  @override
  Future<List<SyncOperation>> due() async => const <SyncOperation>[];
}

class _RecordingObserver extends NavigatorObserver {
  final List<Route<dynamic>> pops = <Route<dynamic>>[];

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pops.add(route);
  }
}

Future<void> _pump(
  WidgetTester tester,
  StReceiveRepository repo, {
  String? poId = 'po1',
  String? poNo = 'PO-2569-0388',
  String? vendorName = 'Thai Steel Co.',
  NavigatorObserver? observer,
}) async {
  // Mounted as a PUSHED route on top of a trivial home — the way st-grlist
  // actually reaches this screen. It also makes the confirmed-outcome pop
  // observable: maybePop on a root route is a no-op.
  await tester.pumpWidget(
    MaterialApp(
      navigatorObservers: <NavigatorObserver>[if (observer != null) observer],
      home: const Scaffold(body: SizedBox.shrink()),
    ),
  );
  final NavigatorState nav = tester.state(find.byType(Navigator));
  unawaited(
    nav.push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => Scaffold(
          body: StReceiveScreen(
            repo: repo,
            strings: _strings,
            i18n: _i18n,
            poId: poId,
            poNo: poNo,
            vendorName: vendorName,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400)); // route transition
  for (int i = 0; i < 5; i++) {
    await tester.pump();
  }
}

Future<void> _tapConfirm(WidgetTester tester) async {
  await tester.tap(find.text('ยืนยัน'));
  for (int i = 0; i < 6; i++) {
    await tester.pump();
  }
}

void main() {
  group('chrome + honest read', () {
    testWidgets('header, per-line ordered qty, labels and CTA render', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));

      expect(find.text('ตรวจนับ-รับของ'), findsOneWidget); // title
      expect(
        find.text('PO-2569-0388 · Thai Steel Co.'),
        findsOneWidget,
      ); // real PO + real resolved vendor
      expect(find.text('สั่ง'), findsNWidgets(2)); // ordered label per line
      expect(find.text('รับ'), findsNWidgets(2)); // received label per line
      expect(find.text('800'), findsNWidgets(2)); // ordered + pre-filled count
      expect(find.text('40'), findsNWidgets(2));
      expect(find.text('ยืนยัน'), findsOneWidget);
      expect(
        find.text('ใบส่งของ'),
        findsNWidgets(2),
      ); // inert delivery-note slot
    });

    testWidgets(
      'HONEST-OMIT: the un-named, un-united line renders em-dashes, never 0 '
      'and never a guessed material name',
      (WidgetTester tester) async {
        await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));
        // Per line: name + unit(ordered row) + unit(stepper row) = 3 em-dashes.
        expect(find.text('—'), findsNWidgets(6));
        expect(find.text('0'), findsNothing);
      },
    );

    testWidgets('the DROPPED success-view claims never appear', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));
      // No fabricated GR number, no stock/AP/notification claim, no photo tile.
      expect(find.textContaining('GR-'), findsNothing);
      expect(find.textContaining('สต๊อก'), findsNothing);
      expect(find.textContaining('AP'), findsNothing);
      expect(find.textContaining('จัดซื้อ'), findsNothing);
      expect(find.textContaining('รูปของ'), findsNothing);
      expect(find.textContaining('✓'), findsNothing);
    });

    testWidgets('no PO selected → honest-empty em-dash, no CTA', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(), poId: null);
      expect(find.text('—'), findsWidgets);
      expect(find.text('ยืนยัน'), findsNothing);
    });

    testWidgets('a PO whose PR yields no line → honest-empty, no CTA', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(outcome: SyncOutcome.synced, items: <StRecvEnt>[]),
      );
      expect(find.text('ยืนยัน'), findsNothing);
    });

    testWidgets('a PO with no pr_id yields no lines — never a fabricated row', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          outcome: SyncOutcome.synced,
          po: <String, Object?>{'id': 'po1', 'no': 'PO-1'},
        ),
      );
      expect(find.text('ยืนยัน'), findsNothing);
    });
  });

  group('counting', () {
    testWidgets('the stepper adjusts the count and shows a signed delta', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.synced);
      await _pump(tester, repo);

      await tester.tap(find.byIcon(Icons.remove).first);
      await tester.pump();

      expect(find.text('790'), findsOneWidget); // 800 - 10
      expect(
        find.text('-10'),
        findsOneWidget,
      ); // signed delta, no invented word
    });

    testWidgets('an over-count shows a + delta', (WidgetTester tester) async {
      await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pump();
      expect(find.text('810'), findsOneWidget);
      expect(find.text('+10'), findsOneWidget);
    });

    testWidgets(
      'the delta NEVER renders an invented Thai word (ขาด / เกิน have no key)',
      (WidgetTester tester) async {
        await _pump(tester, _FakeRepo(outcome: SyncOutcome.synced));
        await tester.tap(find.byIcon(Icons.remove).first);
        await tester.pump();
        expect(find.textContaining('ขาด'), findsNothing);
        expect(find.textContaining('เกิน'), findsNothing);
      },
    );

    testWidgets('the counted quantity is what reaches the write', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.synced);
      await _pump(tester, repo);
      await tester.tap(find.byIcon(Icons.remove).first);
      await tester.pump();
      await _tapConfirm(tester);
      expect(repo.lastCounts, <double>[790, 40]);
    });
  });

  group('the three honest outcomes', () {
    testWidgets('2xx → pops back to st-grlist (no fabricated takeover)', (
      WidgetTester tester,
    ) async {
      final _RecordingObserver observer = _RecordingObserver();
      await _pump(
        tester,
        _FakeRepo(outcome: SyncOutcome.synced),
        observer: observer,
      );
      await _tapConfirm(tester);

      expect(observer.pops.length, 1);
      // The prototype's success copy is never rendered — it has no key and its
      // claims are unbacked.
      expect(find.textContaining('สำเร็จ'), findsNothing);
    });

    testWidgets(
      'deferred → stays on the counting view with the QUEUED card, never success',
      (WidgetTester tester) async {
        final _RecordingObserver observer = _RecordingObserver();
        await _pump(
          tester,
          _FakeRepo(outcome: SyncOutcome.deferred),
          observer: observer,
        );
        await _tapConfirm(tester);

        expect(find.text('รอส่ง'), findsOneWidget);
        expect(observer.pops, isEmpty); // did NOT leave as if confirmed
        expect(find.text('ยืนยัน'), findsOneWidget); // still retryable
      },
    );

    testWidgets('4xx → stays with the FAILED card', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(outcome: SyncOutcome.permanentlyFailed));
      await _tapConfirm(tester);
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);
    });

    testWidgets('a re-tap RE-DRAINS the same op — never a second enqueue', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(outcome: SyncOutcome.deferred);
      await _pump(tester, repo);

      await _tapConfirm(tester);
      final String? firstOpId = repo.lastOpId;
      await _tapConfirm(tester);
      await _tapConfirm(tester);

      expect(repo.submits, 1); // enqueued exactly once
      expect(repo.lastOpId, firstOpId); // same idempotency key throughout
      expect(repo.drains, greaterThanOrEqualTo(2)); // the retries re-drained
    });
  });

  group('repository over the REAL queue + processor', () {
    late List<Map<String, Object?>> posted;
    late List<String> endpoints;

    /// A transport that records every replay. [status] drives the outcome.
    SyncApiClient client(int status) =>
        _CountingClient(status, posted, endpoints);

    setUp(() {
      posted = <Map<String, Object?>>[];
      endpoints = <String>[];
    });

    test(
      'the body carries idempotency_key == the SyncOperation id (B-261)',
      () async {
        final QueueDrainProcessor p = QueueDrainProcessor(
          InMemorySyncQueue(),
          client(201),
        );
        final DioStReceiveRepository repo = DioStReceiveRepository(
          _unusedDio,
          p,
        );
        await repo.submitReceipt(
          poId: 'po1',
          counts: <double>[790],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );

        expect(endpoints, <String>['/gr']);
        expect(posted.single['idempotency_key'], 'op-abc');
        expect(posted.single['po_id'], 'po1');
      },
    );

    test(
      'a 5xx keeps the op queued; re-draining REPLAYS the byte-identical payload '
      'under the SAME key — the client half of the B-264 replay contract',
      () async {
        final QueueDrainProcessor p = QueueDrainProcessor(
          InMemorySyncQueue(),
          client(503),
        );
        final DioStReceiveRepository repo = DioStReceiveRepository(
          _unusedDio,
          p,
        );

        await repo.submitReceipt(
          poId: 'po1',
          counts: <double>[790],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );
        await repo.drain();
        await repo.drain();

        // Replayed three times total, always the same key and the same body — so
        // the server's key+anchor pre-check resolves every replay to the ORIGINAL
        // receipt instead of creating a second GR.
        expect(posted.length, 3);
        expect(
          posted.every(
            (Map<String, Object?> b) => b['idempotency_key'] == 'op-abc',
          ),
          isTrue,
        );
        // Byte-identical bodies (Maps have no value equality — compare encodings).
        expect(posted.map(jsonEncode).toSet().length, 1);
        expect((await repo.due()).single.id, 'op-abc'); // still exactly ONE op
      },
    );

    test(
      'a re-enqueue of the same op id does not duplicate the queued write',
      () async {
        final QueueDrainProcessor p = QueueDrainProcessor(
          InMemorySyncQueue(),
          client(503),
        );
        final DioStReceiveRepository repo = DioStReceiveRepository(
          _unusedDio,
          p,
        );

        await repo.submitReceipt(
          poId: 'po1',
          counts: <double>[790],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );
        await repo.submitReceipt(
          poId: 'po1',
          counts: <double>[790],
          opId: 'op-abc',
          now: DateTime.utc(2026),
        );

        expect((await repo.due()).length, 1);
      },
    );

    test('a 2xx removes the op — nothing is left to replay', () async {
      final QueueDrainProcessor p = QueueDrainProcessor(
        InMemorySyncQueue(),
        client(201),
      );
      final DioStReceiveRepository repo = DioStReceiveRepository(_unusedDio, p);
      await repo.submitReceipt(
        poId: 'po1',
        counts: <double>[790],
        opId: 'op-abc',
        now: DateTime.utc(2026),
      );
      expect(await repo.due(), isEmpty);
    });
  });
}

/// The reads are never exercised in the repository group (only the queue-backed
/// write is), so this Dio is a never-called constructor placeholder.
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
