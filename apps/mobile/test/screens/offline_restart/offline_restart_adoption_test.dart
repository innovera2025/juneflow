// The post-restart idempotency-key property, proven on ALL FIVE offline-write
// screens against the REAL queue and the REAL production write path (B-330).
//
// WHY THIS FILE EXISTS, AND WHY IT DOES NOT USE THE SCREENS' FAKE REPOSITORIES
// ------------------------------------------------------------------------------
// Each screen already has its own widget test, and each of those drives a hand-
// written fake repository whose `due()` returns `const []`. A fake that always says
// "nothing is queued" cannot express the failure being fixed here — the whole defect
// IS a queue that still holds something after the State that knew about it is gone.
//
// So these tests keep the production halves and replace only the two things that are
// genuinely irrelevant to the property: the network (a fake transport) and the READ
// endpoints (stubbed on subclasses of the real repositories). Everything that decides
// the outcome is real: the real `SyncOperation` construction, the real
// `SyncOpIdentity`, the real `QueueDrainProcessor` policy, and a real `SyncQueue` that
// OUTLIVES the widget tree — which is exactly the durability asymmetry that made a
// plain `String? _opId` lossy.
//
// THE SCENARIO, in the order the user lives it
// ------------------------------------------------------------------------------
//   session 1 : submit while offline -> the op is enqueued, the drain defers it, the
//               op stays `pending` in the queue
//   kill      : the widget tree is destroyed; the queue is not
//   session 2 : a fresh screen over the SAME queue, still offline -> the user taps
//               again because nothing looks like it happened
//
// Before the fix, session 2's tap minted a second idempotency key and enqueued a
// second op; both replayed when the signal returned and the server wrote TWO rows.
// A partial unique index on the key cannot catch that — two distinct keys are
// legitimately two distinct records — so the assertions below are about what is in
// the queue and what reaches the server, not about any server-side guard.
//
// st-receive is POST /gr, which posts a GL journal voucher: its duplicate is a
// duplicated goods receipt AND a duplicated JV.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/gps_source.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_agg.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_repository.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_screen.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_repository.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_screen.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_agg.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_repository.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_screen.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_agg.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_repository.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_screen.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_agg.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_repository.dart';
import 'package:juneflow_mobile/screens/st_receive/st_receive_screen.dart';

// ---------------------------------------------------------------------------
// Transport + production repositories with only their READS stubbed
// ---------------------------------------------------------------------------

/// The network. While [offline] it THROWS — no HTTP response was received, which is
/// what `QueueDrainProcessor` reads as a transient "deferred" outcome, so the op
/// stays `pending` in the queue. [accepted] therefore records exactly what the SERVER
/// actually received: a duplicate write shows up here as two entries.
class _Transport implements SyncApiClient {
  _Transport({this.offline = true, this.status = 201});

  bool offline;
  int status;

  /// Per-endpoint status override, for the tests that must tell two ops apart by
  /// their outcome within one drain.
  final Map<String, int> statusByEndpoint = <String, int>{};

  final List<({String endpoint, Map<String, Object?> payload})> accepted =
      <({String endpoint, Map<String, Object?> payload})>[];

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    if (offline) throw Exception('no route to host');
    accepted.add((
      endpoint: endpoint,
      payload: Map<String, Object?>.of(payload),
    ));
    return SyncApiResponse(statusCode: statusByEndpoint[endpoint] ?? status);
  }
}

/// Never called — the reads are stubbed on every repository below.
final Dio _unusedDio = Dio();

class _RecvRepo extends DioStReceiveRepository {
  _RecvRepo(QueueDrainProcessor p) : super(_unusedDio, p);

  @override
  Future<StRecvEnt?> loadPo(String poId) async => <String, Object?>{
    'id': poId,
    'no': 'PO-2569-0388',
    'pr_id': 'pr-$poId',
  };

  @override
  Future<StRecvEnt?> loadPr(String prId) async => <String, Object?>{
    'id': prId,
    'items': <Object?>[
      <String, Object?>{'id': 'i1', 'pr_id': prId, 'qty': 800, 'price': 32.5},
    ],
  };
}

class _CheckinRepo extends QueueBackedPmCheckinRepository {
  const _CheckinRepo(super.processor);
}

class _NotesRepo extends DioPmNotesRepository {
  _NotesRepo(QueueDrainProcessor p) : super(_unusedDio, p);

  @override
  Future<List<PmNotesEnt>> listWorkOrders() async => <PmNotesEnt>[
    <String, Object?>{'id': 'wo-1'},
    <String, Object?>{'id': 'wo-2'},
  ];
}

class _ChecklistRepo extends DioPmChecklistRepository {
  _ChecklistRepo(QueueDrainProcessor p) : super(_unusedDio, p);

  @override
  Future<List<PmChecklistEnt>> listWorkOrders() async => <PmChecklistEnt>[
    for (final String id in <String>['wo-1', 'wo-2'])
      <String, Object?>{
        'id': id,
        'items': <Object?>[
          <String, Object?>{'label': 'A'},
        ],
      },
  ];
}

class _ProgressRepo extends DioFieldProgressRepository {
  _ProgressRepo(QueueDrainProcessor p) : super(_unusedDio, p);

  @override
  Future<List<FieldProgressEnt>> listContracts() async => <FieldProgressEnt>[
    <String, Object?>{'id': 'c1', 'no': 'SC-2026-001', 'vendor_id': 'v1'},
  ];

  @override
  Future<List<FieldProgressEnt>> listVendors() async => <FieldProgressEnt>[
    <String, Object?>{'id': 'v1', 'name': 'Rungruang Construction'},
  ];

  @override
  Future<List<FieldProgressEnt>> listPeriods(String contractId) async =>
      <FieldProgressEnt>[
        <String, Object?>{
          'id': 'p1',
          'contract_id': 'c1',
          'seq': 1,
          'status': 'pending',
        },
        <String, Object?>{
          'id': 'p2',
          'contract_id': 'c1',
          'seq': 2,
          'status': 'pending',
        },
      ];
}

// ---------------------------------------------------------------------------
// i18n + sidecars (the real field names; dict values from docs/extract/i18n-full.json)
// ---------------------------------------------------------------------------

final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "gr.create.colOrdered": {"th":"สั่ง"},
    "gr.create.colReceived": {"th":"รับ"},
    "common.confirm": {"th":"ยืนยัน"},
    "common.save": {"th":"บันทึก"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"},
    "labor.att.savedBadge": {"th":"บันทึกแล้ว"},
    "pm.checkinTitle": {"th":"Check-in จุดบริการ"},
    "pm.serviceZone": {"th":"เขตบริการ"},
    "pm.sla": {"th":"SLA"},
    "pm.contractRef": {"th":"อ้างอิงสัญญา"},
    "subcon.photoGps": {"th":"พิกัด GPS"},
    "pm.checkinBtn": {"th":"Check-in หน้างาน"},
    "pm.toastCheckedIn": {"th":"Check-in หน้างานสำเร็จ · {time}"},
    "pm.checklistTitle": {"th":"Checklist ตรวจเช็ค"},
    "pm.maintLogTitle": {"th":"บันทึกการบำรุงรักษา"},
    "pm.fieldCause": {"th":"สาเหตุการเสีย / ความผิดปกติ"},
    "pm.phCause": {"th":"อธิบายอาการ/สาเหตุที่พบ"},
    "pm.fieldFix": {"th":"การแก้ไข / งานที่ทำ"},
    "pm.phFix": {"th":"อธิบายการแก้ไขและอะไหล่ที่เปลี่ยน"},
    "pm.fieldAdvice": {"th":"ข้อเสนอแนะ / งานที่ควรทำเพิ่ม"},
    "pm.phAdvice": {"th":"เช่น แนะนำเปลี่ยนสลิงในรอบหน้า"},
    "pm.btnNext": {"th":"ถัดไป"},
    "pm.emptyChecklist": {"th":"ยังไม่มีรายการตรวจเช็ค"},
    "subcon.photoBefore": {"th":"รูปก่อน"},
    "subcon.subcontractor": {"th":"ผู้รับเหมา"},
    "subcon.colProgressLong": {"th":"ความคืบหน้า"},
    "accept.unitPhase": {"th":"งวด"},
    "common.status": {"th":"สถานะ"},
    "subcon.statusNotReached": {"th":"ยังไม่ถึง"},
    "subcon.statusRequested": {"th":"ขอตรวจรับ"},
    "subcon.kpiAccepted": {"th":"ตรวจรับแล้ว"},
    "subcon.rejectBtn": {"th":"ตีกลับแก้ไข"},
    "wo.form.deliverWork": {"th":"ส่งมอบงาน"},
    "boq.edEmptyRowsFilter": {"th":"ไม่พบรายการที่ตรงกับตัวกรอง"}
  },
  "nav_i18n": {}, "phrases": {}, "phrase_patterns": []
}
''', lang: 'th');

/// The shared honest-offline status copy every one of the five screens renders for a
/// captured-not-confirmed write. Its presence on mount IS the visible half of the
/// rehydration: the relaunched screen says a write is still outstanding.
const String _queuedCard = 'รอส่ง';

final ScreenStrings _recvStrings = ScreenStrings.fromJsonString('''
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

final ScreenStrings _checkinStrings = ScreenStrings.fromJsonString('''
{
  "title": "pm.checkinTitle",
  "serviceZone": "pm.serviceZone",
  "sla": "pm.sla",
  "contractRef": "pm.contractRef",
  "gpsLabel": "subcon.photoGps",
  "checkinBtn": "pm.checkinBtn",
  "successAt": "pm.toastCheckedIn",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "checklistNext": "pm.checklistTitle"
}
''');

final ScreenStrings _notesStrings = ScreenStrings.fromJsonString('''
{
  "title": "pm.maintLogTitle",
  "fieldCause": "pm.fieldCause",
  "phCause": "pm.phCause",
  "fieldFix": "pm.fieldFix",
  "phFix": "pm.phFix",
  "fieldAdvice": "pm.fieldAdvice",
  "phAdvice": "pm.phAdvice",
  "fieldParts": "อะไหล่ที่ใช้",
  "save": "common.save",
  "saved": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "next": "pm.btnNext"
}
''', assetPath: 'test/inline');

final ScreenStrings _checklistStrings = ScreenStrings.fromJsonString('''
{
  "title": "Checklist PM",
  "progress": "ตรวจแล้ว {n}/{count}",
  "photoBefore": "subcon.photoBefore",
  "photoAfter": "รูป/วิดีโอหลัง",
  "resultNormal": "ปกติ",
  "resultAdjust": "ปรับตั้ง",
  "resultRepair": "เปลี่ยน/ซ่อม",
  "saveNext": "บันทึกผล + ต่อไป",
  "emptyChecklist": "pm.emptyChecklist",
  "saved": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "next": "pm.btnNext"
}
''', assetPath: 'test/inline');

final ScreenStrings _progressStrings = ScreenStrings.fromJsonString('''
{
  "title": "บันทึกความคืบหน้า",
  "labelSubcon": "subcon.subcontractor",
  "labelWork": "งาน",
  "progressTitle": "subcon.colProgressLong",
  "unitPeriod": "accept.unitPhase",
  "statusLabel": "common.status",
  "statusNotReached": "subcon.statusNotReached",
  "statusRequested": "subcon.statusRequested",
  "statusAccepted": "subcon.kpiAccepted",
  "statusRejected": "subcon.rejectBtn",
  "deliver": "wo.form.deliverWork",
  "sent": "labor.att.savedBadge",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast",
  "empty": "boq.edEmptyRowsFilter"
}
''');

class _FixedGps implements GpsSource {
  const _FixedGps();
  @override
  Future<String?> currentFix() async => '13.806000, 100.451900';
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// Pump enough frames to flush the mount chain (drain -> due -> setState) or a tap
/// chain. `pumpAndSettle` is unusable on these screens: several of them show an
/// indeterminate CircularProgressIndicator, which never settles.
Future<void> _flush(WidgetTester tester, [int frames = 14]) async {
  for (int i = 0; i < frames; i++) {
    await tester.pump();
  }
}

/// Simulate a process restart: the whole widget tree — and every State object in it,
/// including `_opId` — is destroyed. The queue passed to the next `_mount*` is the
/// SAME instance, because a drift/SQLite queue survives an app kill and State does
/// not. That asymmetry is the entire defect.
Future<void> _kill(WidgetTester tester) async {
  await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
  await _flush(tester, 3);
}

Future<void> _mount(WidgetTester tester, Widget screen) async {
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
  await _flush(tester);
}

Future<void> _tap(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).first);
  await _flush(tester);
}

/// A brand-new processor over the surviving queue — what `AppServices.bootstrap`
/// builds on every launch.
QueueDrainProcessor _processor(InMemorySyncQueue queue, _Transport transport) =>
    QueueDrainProcessor(queue, transport);

Future<List<SyncOperation>> _queued(InMemorySyncQueue queue) => queue.pending();

Future<List<String>> _queuedIds(InMemorySyncQueue queue) async =>
    (await queue.pending()).map((SyncOperation o) => o.id).toList();

// Per-screen mounts, each over a freshly-built production repository.

Future<void> _mountRecv(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  String poId = 'po-A',
}) => _mount(
  tester,
  StReceiveScreen(
    repo: _RecvRepo(_processor(queue, transport)),
    strings: _recvStrings,
    i18n: _i18n,
    poId: poId,
  ),
);

Future<void> _mountCheckin(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  String workOrderId = 'wo-1',
}) => _mount(
  tester,
  PmCheckinScreen(
    repo: _CheckinRepo(_processor(queue, transport)),
    gpsSource: const _FixedGps(),
    strings: _checkinStrings,
    i18n: _i18n,
    workOrderId: workOrderId,
  ),
);

Future<void> _mountNotes(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  String workOrderId = 'wo-1',
}) => _mount(
  tester,
  PmNotesScreen(
    repo: _NotesRepo(_processor(queue, transport)),
    strings: _notesStrings,
    i18n: _i18n,
    workOrderId: workOrderId,
  ),
);

Future<void> _mountChecklist(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  String workOrderId = 'wo-1',
}) => _mount(
  tester,
  PmChecklistScreen(
    repo: _ChecklistRepo(_processor(queue, transport)),
    strings: _checklistStrings,
    i18n: _i18n,
    workOrderId: workOrderId,
  ),
);

Future<void> _mountProgress(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport,
) => _mount(
  tester,
  FieldProgressScreen(
    repo: _ProgressRepo(_processor(queue, transport)),
    strings: _progressStrings,
    i18n: _i18n,
    contractId: 'c1',
  ),
);

const String _confirmRecv = 'ยืนยัน';
const String _checkinBtn = 'Check-in หน้างาน';
const String _saveNotes = 'บันทึก';
const String _saveChecklist = 'บันทึกผล + ต่อไป';
const String _deliver = 'ส่งมอบงาน';

void main() {
  // =========================================================================
  // 1. RESTART — the defect itself, on each screen independently.
  //    Each of these five must go RED on its own when the rehydration is
  //    removed from ITS screen: one red does not cover the other four.
  // =========================================================================
  group('a restart while a write is queued adopts the SAME key', () {
    testWidgets(
      'st-receive (MONEY — a second key is a second GR + a second JV)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;

        await _kill(tester);
        await _mountRecv(tester, queue, transport);

        // The relaunched screen already knows a receipt is outstanding — it did not
        // present a clean slate.
        expect(find.text(_queuedCard), findsOneWidget);

        // The storekeeper, still seeing no confirmation, taps confirm again.
        await _tap(tester, _confirmRecv);

        expect(
          await _queuedIds(queue),
          <String>[k1],
          reason: 'a second key would sit here as a second queued receipt',
        );

        // And when the signal returns, the server is hit exactly ONCE.
        transport.offline = false;
        await _processor(queue, transport).drain();
        expect(transport.accepted.length, 1);
        expect(transport.accepted.single.endpoint, '/gr');
        expect(transport.accepted.single.payload['idempotency_key'], k1);
        expect(await queue.length(), 0);
      },
    );

    testWidgets('pm-checkin', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountCheckin(tester, queue, transport);
      await _tap(tester, _checkinBtn);
      final String k1 = (await _queued(queue)).single.id;

      await _kill(tester);
      await _mountCheckin(tester, queue, transport);
      expect(find.text(_queuedCard), findsOneWidget);
      await _tap(tester, _checkinBtn);

      expect(await _queuedIds(queue), <String>[k1]);
    });

    testWidgets('pm-notes', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountNotes(tester, queue, transport);
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      final String k1 = (await _queued(queue)).single.id;

      await _kill(tester);
      await _mountNotes(tester, queue, transport);
      // The seeding of the three controllers must NOT be mistaken for an edit —
      // an edit legitimately drops the op id, and doing that here would silently
      // undo the adoption.
      expect(find.text(_queuedCard), findsOneWidget);
      await _tap(tester, _saveNotes);

      expect(await _queuedIds(queue), <String>[k1]);
    });

    testWidgets('pm-checklist', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist);
      final String k1 = (await _queued(queue)).single.id;

      await _kill(tester);
      await _mountChecklist(tester, queue, transport);
      expect(find.text(_queuedCard), findsOneWidget);
      await _tap(tester, _saveChecklist);

      expect(await _queuedIds(queue), <String>[k1]);
    });

    testWidgets('field-progress', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountProgress(tester, queue, transport);
      await _tap(tester, _deliver); // period p1 (the first card)
      final String k1 = (await _queued(queue)).single.id;
      expect((await _queued(queue)).single.endpoint, '/periods/p1/deliver');

      await _kill(tester);
      await _mountProgress(tester, queue, transport);
      expect(find.text(_queuedCard), findsOneWidget);
      await _tap(tester, _deliver);

      expect(await _queuedIds(queue), <String>[k1]);
    });
  });

  // =========================================================================
  // 2. A screen adopts ONLY ITS OWN op.
  //    The queue is one global FIFO with no notion of ownership, so this is the
  //    half that decides whether the fix is safe rather than merely present.
  // =========================================================================
  group('ownership: never another record\'s op', () {
    testWidgets(
      'st-receive: PO-A and PO-B share entityType AND endpoint (/gr) — only the '
      'payload anchor separates them, and B must NOT adopt A\'s key',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        // A receipt is captured for PO-A and left queued.
        await _mountRecv(tester, queue, transport, poId: 'po-A');
        await _tap(tester, _confirmRecv);
        final String kA = (await _queued(queue)).single.id;

        // The storekeeper moves to a DIFFERENT PO (and the app restarts).
        await _kill(tester);
        await _mountRecv(tester, queue, transport, poId: 'po-B');

        // Nothing of PO-B's is queued, so no status card is claimed for it.
        expect(find.text(_queuedCard), findsNothing);
        await _tap(tester, _confirmRecv);

        final List<SyncOperation> ops = await _queued(queue);
        expect(ops.length, 2, reason: 'PO-B\'s receipt must be its OWN write');
        final SyncOperation opB = ops.firstWhere(
          (SyncOperation o) => o.id != kA,
        );
        expect(opB.payload[grPoIdField], 'po-B');
        expect(opB.payload['idempotency_key'], opB.id);
        // Had PO-B adopted PO-A's key, PO-B's goods would simply never have been
        // received: one op, one row, the second receipt silently gone.
        expect(opB.id, isNot(kA));
      },
    );

    testWidgets(
      'three screens queued at once: each takes its own, and a screen with none '
      'of its own mints instead of stealing',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        // wo-1's checklist and wo-2's log are queued; wo-1's LOG is not.
        await _mountChecklist(tester, queue, transport);
        await _tap(tester, _saveChecklist);
        await _kill(tester);
        await _mountNotes(tester, queue, transport, workOrderId: 'wo-2');
        await tester.enterText(find.byType(TextField).first, 'wo-2');
        await _flush(tester);
        await _tap(tester, _saveNotes);
        await _kill(tester);

        final List<String> seeded = await _queuedIds(queue);
        expect(seeded.length, 2);

        // pm-notes for wo-1 has NOTHING of its own queued. Two ops are sitting
        // there — one from another screen on the same work order, one from the
        // same screen on another work order — and it must adopt neither.
        await _mountNotes(tester, queue, transport);
        expect(find.text(_queuedCard), findsNothing);
        await tester.enterText(find.byType(TextField).first, 'wo-1');
        await _flush(tester);
        await _tap(tester, _saveNotes);

        final List<SyncOperation> ops = await _queued(queue);
        expect(ops.length, 3, reason: 'wo-1\'s log is a genuinely new write');
        final SyncOperation own = ops.firstWhere(
          (SyncOperation o) => !seeded.contains(o.id),
        );
        expect(own.entityType, 'pm_notes');
        expect(own.endpoint, '/pm/workorders/wo-1/close');

        // Now that all three exist, each screen takes back exactly its own.
        for (final ({Future<void> Function() mount, String tap}) screen
            in <({Future<void> Function() mount, String tap})>[
              (
                mount: () => _mountNotes(tester, queue, transport),
                tap: _saveNotes,
              ),
              (
                mount: () => _mountChecklist(tester, queue, transport),
                tap: _saveChecklist,
              ),
              (
                mount: () =>
                    _mountNotes(tester, queue, transport, workOrderId: 'wo-2'),
                tap: _saveNotes,
              ),
            ]) {
          await _kill(tester);
          await screen.mount();
          expect(find.text(_queuedCard), findsOneWidget);
          await _tap(tester, screen.tap);
          expect(
            (await _queued(queue)).length,
            3,
            reason: 'adoption, not a fourth op',
          );
        }
      },
    );

    testWidgets(
      'field-progress: delivering period B leaves period A\'s op in the QUEUE but '
      'not in the screen\'s single slot — A must still not be re-minted',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountProgress(tester, queue, transport);
        // Deliver p1, then p2 — the one op slot now tracks p2 and has forgotten p1.
        await _tap(tester, _deliver);
        await tester.tap(find.text(_deliver).at(1));
        await _flush(tester);

        final List<String> two = await _queuedIds(queue);
        expect(two.length, 2);

        // Back to p1. No restart is even needed: the slot alone cannot answer
        // whether p1 already has a write waiting, so the queue has to be asked.
        await _tap(tester, _deliver);

        expect(
          await _queuedIds(queue),
          two,
          reason: 'p1 already had a queued delivery — no third op, no new key',
        );
      },
    );
  });

  // =========================================================================
  // 3. The two boundaries: mint when there is nothing to adopt, and RELEASE on
  //    success. An id held too long is the opposite defect — a second, genuinely
  //    new write silently deduped into the first.
  // =========================================================================
  group('boundaries', () {
    testWidgets('no pending op: a fresh key is minted, exactly as before', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountRecv(tester, queue, transport);
      expect(find.text(_queuedCard), findsNothing); // nothing was adopted
      await _tap(tester, _confirmRecv);

      final SyncOperation op = (await _queued(queue)).single;
      expect(op.id, startsWith('st-receive-'));
      expect(op.payload['idempotency_key'], op.id);
    });

    testWidgets(
      'st-receive: once the receipt SYNCS the key is released, so a later, '
      'legitimately-separate receipt for the same PO gets its OWN key',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(offline: false);

        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        expect(await queue.length(), 0); // 2xx removed it
        final String k1 =
            transport.accepted.single.payload['idempotency_key']! as String;

        // A later visit to the same PO — a second, real receipt.
        await _kill(tester);
        await _mountRecv(tester, queue, transport);
        expect(find.text(_queuedCard), findsNothing);
        await _tap(tester, _confirmRecv);

        expect(transport.accepted.length, 2);
        final String k2 =
            transport.accepted.last.payload['idempotency_key']! as String;
        expect(
          k2,
          isNot(k1),
          reason:
              'reusing k1 here would make the server dedup a genuinely new '
              'receipt into the first one — the mirror-image money defect',
        );
      },
    );

    testWidgets(
      'a 4xx dead-letter is NOT adopted: the drain will never send it again, so '
      'the next attempt must be a new write rather than a stranded one',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(offline: false, status: 400);

        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        final SyncOperation dead = (await _queued(queue)).single;
        expect(
          dead.status,
          SyncOpStatus.failed,
        ); // kept + visible, never replayed

        await _kill(tester);
        transport.status = 201;
        await _mountRecv(tester, queue, transport);
        // No queued card: there is nothing replayable to be waiting for.
        expect(find.text(_queuedCard), findsNothing);
        await _tap(tester, _confirmRecv);

        // Two requests total: the original (which the server REJECTED, so no row
        // exists) and the retry, which carries a NEW key and is therefore a real
        // second attempt rather than a replay the server would resolve back to the
        // rejected one.
        expect(transport.accepted.length, 2);
        expect(transport.accepted.first.payload['idempotency_key'], dead.id);
        expect(
          transport.accepted.last.payload['idempotency_key'],
          isNot(dead.id),
        );
        // The dead-letter is still parked, never replayed; the new write synced.
        final List<SyncOperation> left = await _queued(queue);
        expect(left.single.id, dead.id);
        expect(left.single.status, SyncOpStatus.failed);
      },
    );
  });
}
