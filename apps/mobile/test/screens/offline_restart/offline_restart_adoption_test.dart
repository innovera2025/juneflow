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
import 'dart:async';

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

  /// When non-null every replay BLOCKS on it before doing anything, which is how the
  /// window tests hold a drain IN FLIGHT while the user taps. It needs no faking to
  /// be realistic: `AppServices` builds Dio with no `connectTimeout`, so on a slow or
  /// half-open link a real replay waits exactly like this, bounded only by the OS.
  Completer<void>? gate;

  final List<({String endpoint, Map<String, Object?> payload})> accepted =
      <({String endpoint, Map<String, Object?> payload})>[];

  /// The idempotency keys the SERVER actually received, in order. Two entries for one
  /// user action is the duplicate write, whatever the client believes.
  List<Object?> get acceptedKeys => accepted
      .map(
        (({String endpoint, Map<String, Object?> payload}) r) =>
            r.payload['idempotency_key'],
      )
      .toList();

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    final Completer<void>? held = gate;
    if (held != null) await held.future;
    if (offline) throw Exception('no route to host');
    accepted.add((
      endpoint: endpoint,
      payload: Map<String, Object?>.of(payload),
    ));
    return SyncApiResponse(statusCode: status);
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

/// pm-notes' read for a work order that ALREADY CARRIES a stored log — the ORDINARY
/// production case (any work order closed out once before), and the only fixture
/// shape in which seeding the form does anything observable at all.
///
/// [_NotesRepo] above returns bare `{'id': 'wo-1'}`, so `_seed` writes `''` into three
/// already-empty controllers: `TextEditingController.text = ''` assigns an EQUAL
/// `TextEditingValue` and notifies NOBODY. A test built on that fixture cannot fire
/// the edit listener from a seed, and therefore cannot exercise — in either direction
/// — any guard that lives inside the listener (`_seeding`) or any ordering rule about
/// when the seed lands (`await loading`). Stored text is what makes the seed NOISY.
class _StoredNotesRepo extends _NotesRepo {
  _StoredNotesRepo(super.p);

  /// The log this work order was closed out with before — what the read returns and
  /// what a seed therefore puts back on screen.
  static const String storedCause = 'บันทึกเดิม';

  @override
  Future<List<PmNotesEnt>> listWorkOrders() async => <PmNotesEnt>[
    <String, Object?>{'id': 'wo-1', 'cause': storedCause},
  ];
}

/// The same noisy read, deliberately SLOWER than the drain.
///
/// `_resumeQueued` starts the read and the drain together but AWAITS the read before
/// adopting, because seeding the three controllers fires the edit listener and an
/// edit legitimately drops `_opId`. Every other test in this file stubs a read that
/// resolves first anyway, so the ordering is never exercised by them.
class _SlowNotesRepo extends _StoredNotesRepo {
  _SlowNotesRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<PmNotesEnt>> listWorkOrders() async {
    await Future<void>.delayed(delay);
    return super.listWorkOrders();
  }
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

/// [_ProgressRepo] whose QUEUE READ takes real time.
///
/// `due()` is `SyncQueue.pending()`, and in the app that is drift/SQLite — disk I/O,
/// not a synchronous getter. Every other repository in this file resolves it in a
/// microtask, which collapses the gap the pre-mint queue read opens and makes any
/// second tap land either wholly before or wholly after it.
///
/// THE ROWS ARE SNAPSHOTTED AT THE CALL AND HANDED BACK AFTER THE DELAY, and that
/// order is the whole fixture. Delaying FIRST and reading after would let the second
/// tap's read observe the FIRST tap's enqueue, and the pre-mint check would then
/// dedupe the pair by itself — which is not what a real queue does and would make a
/// double-tap test pass with or without the busy guard. It measured exactly that:
/// the delay-then-read version left the suite GREEN under the revert probe.
///
/// Snapshot-then-delay is the faithful ordering, not a convenience. On one drift
/// connection the second tap's SELECT is queued behind the first tap's SELECT but
/// AHEAD of the INSERT, because the first tap cannot issue that INSERT until its own
/// SELECT has returned. So both reads necessarily see the pre-insert state.
class _SlowDueProgressRepo extends _ProgressRepo {
  _SlowDueProgressRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() async {
    final List<SyncOperation> rows = await super.due();
    await Future<void>.delayed(delay);
    return rows;
  }
}

/// The same slow queue read for the OTHER FOUR screens, which flip their busy state
/// synchronously and — until this round — had nothing but a reading of the source to
/// say so.
///
/// One rule, stated once: SNAPSHOT AT THE CALL, hand the rows back after [delay]. The
/// long form of why is on [_SlowDueProgressRepo] above; the short form is that delaying
/// FIRST and reading after lets the second tap's read observe the first tap's enqueue,
/// so the pre-mint check dedupes the pair by itself and the revert probe comes back
/// GREEN with the flip gone. That is not what a real queue does — on one drift
/// connection the second tap's SELECT is queued behind the first tap's SELECT but AHEAD
/// of its INSERT — and it has already been measured on this branch once.
///
/// Four classes rather than one, because the four repositories share no supertype and
/// each test has to be able to go red ALONE.
Future<List<SyncOperation>> _slowDue(
  Future<List<SyncOperation>> rows,
  Duration delay,
) async {
  final List<SyncOperation> snapshot = await rows;
  await Future<void>.delayed(delay);
  return snapshot;
}

class _SlowDueRecvRepo extends _RecvRepo {
  _SlowDueRecvRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() => _slowDue(super.due(), delay);
}

class _SlowDueCheckinRepo extends _CheckinRepo {
  _SlowDueCheckinRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() => _slowDue(super.due(), delay);
}

class _SlowDueChecklistRepo extends _ChecklistRepo {
  _SlowDueChecklistRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() => _slowDue(super.due(), delay);
}

/// pm-notes' slow read is parented on [_StoredNotesRepo], not [_NotesRepo], for a
/// reason the double-tap test depends on: the pre-mint queue check is SKIPPED once
/// `_edited` is set, and on a blank work order the only way to get a realistic body
/// into the form is to type one — which sets `_edited`, takes the handler down the
/// straight-to-mint path where no await sits between the guard and `_newOpId()`, and
/// leaves a test that passes with the flip removed. A work order that already CARRIES
/// a log gives the save a real body via the seed, which `_seeding` correctly does not
/// count as typing, so the tap goes through the queue read this test is about.
class _SlowDueNotesRepo extends _StoredNotesRepo {
  _SlowDueNotesRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() => _slowDue(super.due(), delay);
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
  StReceiveRepository? repo,
}) => _mount(
  tester,
  StReceiveScreen(
    repo: repo ?? _RecvRepo(_processor(queue, transport)),
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
  PmCheckinRepository? repo,
}) => _mount(
  tester,
  PmCheckinScreen(
    repo: repo ?? _CheckinRepo(_processor(queue, transport)),
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
  PmNotesRepository? repo,
}) => _mount(
  tester,
  PmNotesScreen(
    repo: repo ?? _NotesRepo(_processor(queue, transport)),
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
  PmChecklistRepository? repo,
}) => _mount(
  tester,
  PmChecklistScreen(
    repo: repo ?? _ChecklistRepo(_processor(queue, transport)),
    strings: _checklistStrings,
    i18n: _i18n,
    workOrderId: workOrderId,
  ),
);

Future<void> _mountProgress(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  FieldProgressRepository? repo,
}) => _mount(
  tester,
  FieldProgressScreen(
    repo: repo ?? _ProgressRepo(_processor(queue, transport)),
    strings: _progressStrings,
    i18n: _i18n,
    contractId: 'c1',
  ),
);

const String _confirmRecv = 'ยืนยัน';
const String _checkinBtn = 'Check-in หน้างาน';
const String _saveNotes = 'บันทึก';
const String _saveChecklist = 'บันทึกผล + ต่อไป';
const String _resultNormal = 'ปกติ';
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
  // 1b. THE ADOPTION WINDOW — the same duplicate, with the network HEALTHY.
  //
  //     `_resumeQueued` is fired `unawaited` from initState and the adoption
  //     lands only AFTER `await repo.drain()` — one real HTTP round trip, and
  //     `AppServices` builds Dio with no `connectTimeout`, so nothing bounds it
  //     but the OS. Throughout that window the screen is fully rendered, its CTA
  //     is live, `_opId` is null and no queued card is shown.
  //
  //     A tap in there used to take the mint branch and produce a SECOND key.
  //     The nested drain hits the processor's re-entrancy guard and returns an
  //     EMPTY report, so the screen even showed a reassuring `queued` — while the
  //     outer drain walked the FIFO and sent BOTH ops.
  //
  //     Each test below must go RED on its own when the pre-mint queue check is
  //     removed from ITS screen: the assertion is on what the SERVER received,
  //     not on what the screen believes.
  // =========================================================================
  group('a tap while the on-mount drain is still in flight', () {
    testWidgets(
      'st-receive (MONEY — a second key is a second GR + a second JV)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        // The receipt is captured while offline and stays queued.
        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        // Relaunch with the signal BACK — but hold the replay open.
        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountRecv(tester, queue, transport);

        // Inside the window: the drain has not come back, so nothing has been
        // adopted and the confirm bar is live.
        expect(find.text(_queuedCard), findsNothing);
        expect(find.text(_confirmRecv), findsOneWidget);

        // The storekeeper, seeing no confirmation, confirms again.
        await _tap(tester, _confirmRecv);

        // The held replay lands and the drain walks the rest of the FIFO.
        gate.complete();
        await _flush(tester, 20);

        expect(
          transport.acceptedKeys,
          <String>[k1],
          reason:
              'two distinct keys = two goods receipts = two journal vouchers; '
              'gr_idempotency_uq is a partial unique index on the key ALONE and '
              'correctly lets them both through',
        );
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

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      await _mountCheckin(tester, queue, transport);

      expect(find.text(_queuedCard), findsNothing);
      await _tap(tester, _checkinBtn);

      gate.complete();
      await _flush(tester, 20);

      expect(
        transport.accepted.length,
        1,
        reason: 'a second op here is a second check-in on the same work order',
      );
      expect(transport.accepted.single.endpoint, '/pm/workorders/wo-1/checkin');
      expect(await queue.length(), 0);
      expect(k1, isNotEmpty);
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

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      await _mountNotes(tester, queue, transport);

      expect(find.text(_queuedCard), findsNothing);
      await _tap(tester, _saveNotes);

      gate.complete();
      await _flush(tester, 20);

      expect(transport.accepted.length, 1);
      expect(await _queuedIds(queue), <String>[]);
      expect(k1, isNotEmpty);
    });

    testWidgets('pm-checklist', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist);
      final String k1 = (await _queued(queue)).single.id;
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      await _mountChecklist(tester, queue, transport);

      expect(find.text(_queuedCard), findsNothing);
      await _tap(tester, _saveChecklist);

      gate.complete();
      await _flush(tester, 20);

      expect(transport.accepted.length, 1);
      expect(await _queuedIds(queue), <String>[]);
      expect(k1, isNotEmpty);
    });

    testWidgets(
      'field-progress has no such window to test — its READS are serialized '
      'behind the drain, so there is nothing tappable until the drain returns',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountProgress(tester, queue, transport);
        await _tap(tester, _deliver);
        await _kill(tester);

        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountProgress(tester, queue, transport);

        // `_resumeQueued` there is `await drain(); await _loadThenAdopt();`, so a
        // held replay also holds the period list. That is a LIVENESS cost, not a
        // money one — this screen already asks the queue before minting (the
        // `delivering period B` test below) — but it is why the window above has no
        // field-progress case. If the reads are ever moved off the drain's critical
        // path, this expectation flips and that case has to be written.
        expect(find.text(_deliver), findsNothing);

        gate.complete();
        await _flush(tester, 20);

        // The replay landed and the screen came back to life.
        expect(transport.accepted.length, 1);
        expect(transport.accepted.single.endpoint, '/periods/p1/deliver');
        expect(find.text(_deliver), findsWidgets);
      },
    );
  });

  // =========================================================================
  // 1c. ORDERING — pm-notes only.
  //
  //     `_resumeQueued` there awaits the READ as well as the drain, because
  //     seeding the three controllers fires the edit listener and a real edit
  //     legitimately drops `_opId`. Every other test stubs a read that happens
  //     to resolve first, so none of them can fail when that `await` is removed.
  // =========================================================================
  group('pm-notes: a read that lands after the drain', () {
    testWidgets('must not undo the adoption (seeding the form is not an edit)', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountNotes(tester, queue, transport);
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      final String k1 = (await _queued(queue)).single.id;
      await _kill(tester);

      // Relaunch with the work-order read 120ms behind the (offline, immediate)
      // drain. Without `await loading` the adoption lands first, `_seed` then
      // fires `_onEdited` from a non-idle state, and the adopted id is dropped.
      await _mountNotes(
        tester,
        queue,
        transport,
        repo: _SlowNotesRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);

      expect(
        find.text(_queuedCard),
        findsOneWidget,
        reason: 'the write is still outstanding after the read landed',
      );

      await _tap(tester, _saveNotes);
      expect(
        await _queuedIds(queue),
        <String>[k1],
        reason: 'an id dropped by the seeding mints a second key here',
      );
    });
  });

  // =========================================================================
  // 1c-b. SEEDING IS NOT TYPING — the `_seeding` flag, on the ordinary work
  //       order: one that already HAS a stored log.
  //
  //       `_onEdited` cannot tell a seed from a keystroke, and inside the
  //       adoption window it cannot infer it from the state either (`_state` is
  //       idle and `_opId` null for both). If a seed is counted as an edit,
  //       `_edited` is set before the technician has touched anything, the
  //       pre-mint check in `_onSave` is skipped, and the save mints a second key
  //       whose body is THE TEXT THE READ JUST PUT THERE.
  //
  //       That is not a plain duplicate: FIFO replays the queued op first and the
  //       minted one last, so the STALE stored log lands on top of the real one.
  // =========================================================================
  group('pm-notes: seeding a stored log is not an edit', () {
    testWidgets(
      'saving inside the window without typing ADOPTS — a work order that '
      'already carries a log must not re-submit that log as a new close-out',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline
        PmNotesRepository stored() =>
            _StoredNotesRepo(_processor(queue, transport));

        // Session 1, offline. The work order already carries a log, so the form
        // opens with it; the technician replaces it with what he actually found.
        await _mountNotes(tester, queue, transport, repo: stored());
        expect(
          find.text(_StoredNotesRepo.storedCause),
          findsOneWidget,
          reason: 'the fixture must really seed, or this test proves nothing',
        );
        await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
        await _flush(tester);
        await _tap(tester, _saveNotes);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        // Session 2, INSIDE the adoption window: the signal is back but the replay
        // is held open, so `_opId` is still null and the CTA is live. The read is
        // NOT held — it still returns the OLD stored log, because the queued write
        // never reached the server — so the form re-seeds it.
        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountNotes(tester, queue, transport, repo: stored());

        expect(find.text(_queuedCard), findsNothing); // nothing adopted yet
        expect(
          find.text(_StoredNotesRepo.storedCause),
          findsOneWidget,
          reason:
              'the seed fired for real — the listener DID run, which is the '
              'whole condition `_seeding` exists to classify',
        );

        // He taps save. He has typed nothing: the only thing that touched the
        // controllers is the read.
        await _tap(tester, _saveNotes);

        expect(
          await _queuedIds(queue),
          <String>[k1],
          reason:
              'counting the seed as an edit skips the pre-mint check, and the '
              'second key sits right here as a second close-out',
        );

        gate.complete();
        await _flush(tester, 20);

        expect(transport.accepted.length, 1);
        expect(
          transport.accepted.single.payload['cause'],
          'สายพานขาด',
          reason:
              'and FIFO lands the SECOND body last, so the stale stored log '
              'would overwrite the real one — input loss, not a duplicate. '
              '(pm-notes carries no `idempotency_key` in its body — B-261 is a '
              'money contract — so the op id in the QUEUE is the whole key.)',
        );
        expect(await queue.length(), 0);
      },
    );
  });

  // =========================================================================
  // 1d. AN EDIT IS A NEW WRITE — the boundary the pre-mint check must not cross.
  //
  //     `_opId` is null in two situations that mean opposite things: nothing of
  //     mine has ever been submitted (adopt whatever is queued) and the user has
  //     just EDITED (the body on screen is no longer the body the queued op
  //     carries, so that op is not this write). Handing the queued op back in the
  //     second case would re-drain the OLD content and silently discard the edit —
  //     input loss, which is worse than the duplicate the check exists to prevent.
  //     `_edited` is what tells the two apart; each test below goes red when it is
  //     dropped from ITS screen.
  // =========================================================================
  group('an edit mints instead of adopting', () {
    testWidgets(
      'pm-notes: a body typed INSIDE the window is its own write — the check '
      'must not swallow it into the queued op',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountNotes(tester, queue, transport);
        await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
        await _flush(tester);
        await _tap(tester, _saveNotes);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        // Inside the window: the replay is held, so nothing has been adopted and
        // the screen looks exactly as it does when nothing was ever submitted —
        // which is the whole reason the listener cannot infer "seeding" from the
        // state and needs `_seeding` to be told.
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountNotes(tester, queue, transport);
        expect(find.text(_queuedCard), findsNothing);

        await tester.enterText(find.byType(TextField).first, 'มอเตอร์ไหม้');
        await _flush(tester);
        await _tap(tester, _saveNotes); // saved while still inside the window

        gate.complete();
        await _flush(tester, 20);

        final List<SyncOperation> ops = await _queued(queue);
        expect(
          ops.length,
          2,
          reason: 'the typed body is a genuinely new write',
        );
        expect(ops.first.id, k1);
        expect(
          ops.map((SyncOperation o) => o.payload['cause']).toList(),
          <String>['สายพานขาด', 'มอเตอร์ไหม้'],
          reason:
              'FIFO replays the old body then the new one, so the column ends '
              'up holding what the technician actually typed; adopting k1 here '
              'would send the OLD body ONLY and lose this text entirely',
        );
      },
    );

    testWidgets('pm-notes: the typed body is not replaced by the queued one', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountNotes(tester, queue, transport);
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      final String k1 = (await _queued(queue)).single.id;

      await _kill(tester);
      await _mountNotes(tester, queue, transport);
      expect(find.text(_queuedCard), findsOneWidget); // k1 adopted

      // A REAL edit — the technician found something else.
      await tester.enterText(find.byType(TextField).first, 'มอเตอร์ไหม้');
      await _flush(tester);
      expect(
        find.text(_queuedCard),
        findsNothing,
        reason: 'the queued write no longer describes what is on screen',
      );

      await _tap(tester, _saveNotes);

      final List<SyncOperation> ops = await _queued(queue);
      expect(ops.length, 2, reason: 'the new body is its OWN write');
      expect(
        ops.firstWhere((SyncOperation o) => o.id == k1).payload['cause'],
        'สายพานขาด',
      );
      expect(
        ops.firstWhere((SyncOperation o) => o.id != k1).payload['cause'],
        'มอเตอร์ไหม้',
        reason: 'adopting k1 here would re-send the OLD text and lose this one',
      );
    });

    testWidgets('pm-checklist: the changed result is not replaced by the '
        'queued one', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist); // every line still unchecked
      final String k1 = (await _queued(queue)).single.id;

      await _kill(tester);
      await _mountChecklist(tester, queue, transport);
      expect(find.text(_queuedCard), findsOneWidget); // k1 adopted

      await _tap(tester, _resultNormal); // a REAL edit
      expect(find.text(_queuedCard), findsNothing);
      await _tap(tester, _saveChecklist);

      final List<SyncOperation> ops = await _queued(queue);
      expect(ops.length, 2, reason: 'the new result set is its OWN write');
      expect(
        (ops.firstWhere((SyncOperation o) => o.id == k1).payload['items']!
                as List<Object?>)
            .first,
        isNot(contains('result')),
      );
      expect(
        (ops.firstWhere((SyncOperation o) => o.id != k1).payload['items']!
                as List<Object?>)
            .first,
        containsPair('result', 'normal'),
        reason: 'adopting k1 here would re-send the UNCHECKED list',
      );
    });
  });

  // =========================================================================
  // 1e. A SECOND TAP INSIDE THE PRE-MINT QUEUE READ.
  //
  //     The pre-mint check is itself an `await`, and it was put in FRONT of the
  //     handler's own double-tap guard. On dev the mint path held no await at all
  //     (guard -> mint -> setState), so the guard was sufficient; adding the queue
  //     read opened a gap the guard no longer covers unless the busy state is
  //     flipped SYNCHRONOUSLY first.
  //
  //     ALL FIVE SCREENS ARE COVERED HERE. `field-progress` was the one handler
  //     that did not flip synchronously (round 3); the other four were given the
  //     flip in round 2 and then asserted only by READING them, which is one tidy-up
  //     away from gone — move the flip below the `due()` await, exactly the shape
  //     field-progress had on dev, and nothing in the suite notices. Each screen
  //     drives its OWN slow-`due()` fixture so each goes red ALONE.
  // =========================================================================
  group('a second tap while the pre-mint queue read is still in flight', () {
    testWidgets('field-progress: two taps on ONE period enqueue ONE delivery', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountProgress(
        tester,
        queue,
        transport,
        repo: _SlowDueProgressRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      // Let the on-mount adoption finish first (it reads the queue too), so the
      // only read in flight below is the one the tap opens.
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);
      expect(find.text(_queuedCard), findsNothing); // nothing was queued yet

      // The foreman taps the period's CTA twice — the first tap has not repainted
      // yet, which is exactly why he taps again.
      await tester.tap(find.text(_deliver).first);
      await tester.tap(find.text(_deliver).first);
      await tester.pump(const Duration(milliseconds: 300));
      await _flush(tester, 20);

      final List<SyncOperation> ops = await _queued(queue);
      expect(
        ops.length,
        1,
        reason:
            'a second op here is a second POST /periods/p1/deliver; the C3 '
            'guard (subcon.ts:758) takes the first and 409s the replay, which '
            'parks a permanent dead-letter (B-330 F2) and paints the failed '
            'bar over a delivery that SUCCEEDED',
      );
      expect(ops.single.endpoint, '/periods/p1/deliver');

      // And when the signal returns the server is hit exactly once.
      transport.offline = false;
      await _processor(queue, transport).drain();
      expect(transport.accepted.length, 1);
      expect(transport.accepted.single.endpoint, '/periods/p1/deliver');
      expect(await queue.length(), 0);
    });

    testWidgets(
      'field-progress: two taps on DIFFERENT periods are still two deliveries — '
      'the flip must not swallow a genuinely separate write',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountProgress(
          tester,
          queue,
          transport,
          repo: _SlowDueProgressRepo(
            _processor(queue, transport),
            delay: const Duration(milliseconds: 120),
          ),
        );
        await tester.pump(const Duration(milliseconds: 200));
        await _flush(tester);

        await _tap(tester, _deliver); // p1
        await tester.pump(const Duration(milliseconds: 300));
        await _flush(tester);
        await tester.tap(find.text(_deliver).at(1)); // p2
        await tester.pump(const Duration(milliseconds: 300));
        await _flush(tester, 20);

        final List<SyncOperation> ops = await _queued(queue);
        expect(ops.length, 2);
        expect(ops.map((SyncOperation o) => o.endpoint).toList(), <String>[
          '/periods/p1/deliver',
          '/periods/p2/deliver',
        ]);
      },
    );

    testWidgets(
      'st-receive (MONEY — two ops are two GR + two JV): two taps on confirm '
      'enqueue ONE receipt',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        await _mountRecv(
          tester,
          queue,
          transport,
          repo: _SlowDueRecvRepo(
            _processor(queue, transport),
            delay: const Duration(milliseconds: 120),
          ),
        );
        // Let the on-mount adoption finish first (it reads the queue too), so the
        // only read in flight below is the one the tap opens.
        await tester.pump(const Duration(milliseconds: 200));
        await _flush(tester);
        expect(find.text(_queuedCard), findsNothing); // nothing was queued yet

        // The storekeeper taps confirm twice — the first tap has not repainted yet,
        // which is exactly why he taps again.
        await tester.tap(find.text(_confirmRecv).first);
        await tester.tap(find.text(_confirmRecv).first);
        await tester.pump(const Duration(milliseconds: 300));
        await _flush(tester, 20);

        final List<SyncOperation> ops = await _queued(queue);
        expect(
          ops.length,
          1,
          reason:
              'a second op here is a second POST /gr under a SECOND key, and '
              '`gr_idempotency_uq` is a partial unique index on the key ALONE — '
              'it correctly admits both, as two goods receipts and two journal '
              'vouchers',
        );
        expect(ops.single.endpoint, '/gr');
        expect(ops.single.payload[grPoIdField], 'po-A');

        // And when the signal returns the server is hit exactly once.
        transport.offline = false;
        await _processor(queue, transport).drain();
        expect(transport.acceptedKeys, <String>[ops.single.id]);
        expect(await queue.length(), 0);
      },
    );

    testWidgets('pm-checkin: two taps enqueue ONE check-in', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountCheckin(
        tester,
        queue,
        transport,
        repo: _SlowDueCheckinRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);
      expect(find.text(_queuedCard), findsNothing);

      await tester.tap(find.text(_checkinBtn).first);
      await tester.tap(find.text(_checkinBtn).first);
      await tester.pump(const Duration(milliseconds: 300));
      await _flush(tester, 20);

      final List<SyncOperation> ops = await _queued(queue);
      expect(
        ops.length,
        1,
        reason: 'a second op here is a second check-in on the same work order',
      );
      expect(ops.single.endpoint, '/pm/workorders/wo-1/checkin');

      transport.offline = false;
      await _processor(queue, transport).drain();
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
    });

    testWidgets('pm-checklist: two taps enqueue ONE checklist write', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountChecklist(
        tester,
        queue,
        transport,
        repo: _SlowDueChecklistRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);
      expect(find.text(_queuedCard), findsNothing);
      // Nothing has been toggled, so `_edited` is false and the tap goes through
      // the pre-mint queue read — which is the await this test is about.
      await tester.tap(find.text(_saveChecklist).first);
      await tester.tap(find.text(_saveChecklist).first);
      await tester.pump(const Duration(milliseconds: 300));
      await _flush(tester, 20);

      final List<SyncOperation> ops = await _queued(queue);
      expect(
        ops.length,
        1,
        reason: 'the second op would overwrite the first with the same results',
      );
      expect(ops.single.endpoint, '/pm/workorders/wo-1/checklist');

      transport.offline = false;
      await _processor(queue, transport).drain();
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
    });

    testWidgets('pm-notes: two taps enqueue ONE close-out', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountNotes(
        tester,
        queue,
        transport,
        repo: _SlowDueNotesRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);
      expect(find.text(_queuedCard), findsNothing);
      expect(
        find.text(_StoredNotesRepo.storedCause),
        findsOneWidget,
        reason:
            'the seeded body is what makes this save a REAL write without an '
            'edit — and `_seeding` is what keeps the seed from setting '
            '`_edited`, which would route the tap past the queue read entirely',
      );

      await tester.tap(find.text(_saveNotes).first);
      await tester.tap(find.text(_saveNotes).first);
      await tester.pump(const Duration(milliseconds: 300));
      await _flush(tester, 20);

      final List<SyncOperation> ops = await _queued(queue);
      expect(
        ops.length,
        1,
        reason: 'the second op would re-close the same work order',
      );
      expect(ops.single.endpoint, '/pm/workorders/wo-1/close');

      transport.offline = false;
      await _processor(queue, transport).drain();
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
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
