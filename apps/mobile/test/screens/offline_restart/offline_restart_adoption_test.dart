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
import 'package:juneflow_mobile/screens/field_stock/field_stock_agg.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_repository.dart';
import 'package:juneflow_mobile/screens/field_stock/field_stock_screen.dart';
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
import 'package:juneflow_mobile/theme/juneflow_theme.dart';

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

/// field-stock's reads, stubbed. The write half — the real `SyncOperation`, the real
/// `fieldStockOpIdentity`, the real payload — is inherited untouched.
///
/// TWO warehouses, because this screen's ownership anchor is a PAYLOAD field
/// (`from_warehouse_id`) rather than a path segment: `POST /inventory/issues` is one
/// endpoint for every shelf in the tenant, exactly as `POST /gr` is one endpoint for
/// every PO. A fixture with a single warehouse could not tell a working anchor from
/// no anchor at all.
///
/// TWO projects, because the anchor deliberately EXCLUDES `project_id` — the screen
/// re-defaults that to the primary on every load, so a basket issued against the
/// SECOND project must still be recognised by the mount that comes back. One project
/// would make that test vacuous.
class _StockRepo extends DioFieldStockRepository {
  _StockRepo(QueueDrainProcessor p) : super(_unusedDio, p);

  @override
  Future<List<FieldStockEnt>> listWarehouses() async => <FieldStockEnt>[
    <String, Object?>{
      'id': 'w-A',
      'name': 'คลัง Block A',
      'created_at': '2026-01-01T00:00:00Z',
    },
    <String, Object?>{
      'id': 'w-B',
      'name': 'คลัง Block B',
      'created_at': '2026-01-02T00:00:00Z',
    },
  ];

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) async =>
      <FieldStockEnt>[
        <String, Object?>{
          'item_id': 'i1',
          'warehouse_id': warehouseId,
          'item_code': 'MAT-CEM-001',
          'item_name': 'ปูนซีเมนต์ตราเสือ',
          'unit': 'ถุง',
          'on_hand': 1240,
        },
      ];

  @override
  Future<List<FieldStockEnt>> listProjects() async => <FieldStockEnt>[
    <String, Object?>{'id': 'p1', 'name': 'juneflow พาร์ค ราชพฤกษ์'},
    <String, Object?>{'id': 'p2', 'name': 'juneflow เพลส บางนา'},
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

class _SlowDueStockRepo extends _StockRepo {
  _SlowDueStockRepo(super.p, {required this.delay});

  final Duration delay;

  @override
  Future<List<SyncOperation>> due() => _slowDue(super.due(), delay);
}

/// A QUEUE READ THAT FAILS — the local store is unreadable (B-341).
///
/// The screens release the quiet CTA in a `finally`, so this must open the button
/// rather than park it: a question that cannot be answered is not a reason to disable
/// the only control on the screen forever. What then stops a duplicate is the pre-mint
/// check, which asks again at the mint site — so [throwing] is flipped off before the
/// user's tap, exactly as a transient store failure would clear.
Future<List<SyncOperation>> _throwingDue(
  bool throwing,
  Future<List<SyncOperation>> rows,
) {
  if (throwing) {
    return Future<List<SyncOperation>>.error(
      StateError('the local queue could not be read'),
    );
  }
  return rows;
}

class _ThrowingDueRecvRepo extends _RecvRepo {
  _ThrowingDueRecvRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
}

class _ThrowingDueCheckinRepo extends _CheckinRepo {
  _ThrowingDueCheckinRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
}

class _ThrowingDueNotesRepo extends _StoredNotesRepo {
  _ThrowingDueNotesRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
}

class _ThrowingDueChecklistRepo extends _ChecklistRepo {
  _ThrowingDueChecklistRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
}

class _ThrowingDueProgressRepo extends _ProgressRepo {
  _ThrowingDueProgressRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
}

class _ThrowingDueStockRepo extends _StockRepo {
  _ThrowingDueStockRepo(super.p);

  bool throwing = true;

  @override
  Future<List<SyncOperation>> due() => _throwingDue(throwing, super.due());
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
    "boq.edEmptyRowsFilter": {"th":"ไม่พบรายการที่ตรงกับตัวกรอง"},
    "inv.issueAdd.title": {"th":"เบิกวัสดุออก (Material Issue)"},
    "inv.issueAdd.itemsTitle": {"th":"รายการที่เบิก"},
    "inv.issueAdd.colStock": {"th":"สต็อก"},
    "inv.issue.colUsedFor": {"th":"ใช้กับ"}
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

final ScreenStrings _stockStrings = ScreenStrings.fromJsonString('''
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

/// How long a slow queue read is held open. Any real duration works — the point is
/// that it is not a microtask, so `_flush`'s zero-duration pumps leave the test INSIDE
/// the window until it deliberately advances the clock.
const Duration _slow = Duration(milliseconds: 120);

/// Tap the CTA on the four screens that render it as a SPINNER while quiet.
///
/// Their label is gone in that state (that is the visible refusal), so it cannot be
/// used as a handle. The spinner sits inside the CTA's own `GestureDetector`, which is
/// `HitTestBehavior.opaque` and therefore takes the tap whether or not it has a
/// callback — so this really does deliver a tap AT the button, rather than proving the
/// button is merely un-findable.
Future<void> _tapCtaSpinner(WidgetTester tester) async {
  final Finder spinner = find.byType(CircularProgressIndicator);
  expect(
    spinner,
    findsOneWidget,
    reason:
        'the quiet CTA must be showing the spinner it already uses for a '
        'submit — if it is not, this tap is landing on nothing and the test '
        'would pass for the wrong reason',
  );
  await tester.tap(spinner);
  await _flush(tester);
}

/// Let every outstanding `_slow` queue read finish.
///
/// A `_SlowDue*Repo` turns each `due()` into a real timer, and the screens call
/// `due()` again from `_resolve` and `_reconcile`. `_flush` pumps ZERO-duration
/// frames, so it can never retire one; leaving them pending trips the binding's
/// "a Timer is still pending" invariant at teardown.
Future<void> _drainSlowTimers(WidgetTester tester) async {
  for (int i = 0; i < 4; i++) {
    await tester.pump(_slow * 2);
    await _flush(tester);
  }
}

/// Assert the CTA under [label] is painted in the disabled fill — the visible refusal
/// on the two screens that grey their button rather than spin it (field-progress
/// renders one button per row, and field-stock's bar has no spinner at all; both
/// already use this exact muted fill for "not actionable").
void _expectMutedCta(WidgetTester tester, Finder label) {
  final Container box = tester.widget<Container>(
    find.ancestor(of: label, matching: find.byType(Container)).first,
  );
  expect(
    (box.decoration! as BoxDecoration).color,
    JuneflowTokens.surfaceMuted,
    reason: 'a live CTA is brandPrimary; this one must read as refused',
  );
}

/// A brand-new processor over the surviving queue — what `AppServices.bootstrap`
/// builds on every launch.
QueueDrainProcessor _processor(InMemorySyncQueue queue, _Transport transport) =>
    QueueDrainProcessor(queue, transport);

Future<List<SyncOperation>> _queued(InMemorySyncQueue queue) => queue.pending();

Future<List<String>> _queuedIds(InMemorySyncQueue queue) async =>
    (await queue.pending()).map((SyncOperation o) => o.id).toList();

/// How many permanent 4xx dead-letters the queue is holding — ops the drain will
/// skip forever, so they have written nothing and never will.
Future<int> _deadLetters(InMemorySyncQueue queue) async => (await queue.pending())
    .where((SyncOperation o) => o.status == SyncOpStatus.failed)
    .length;

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

/// field-stock's mount. [warehouseId] null is the REAL router path — the tab route
/// carries no parameter, so the screen follows the register's newest warehouse (w-B
/// here, by `created_at`). An explicit id is the push seam, and is what lets one test
/// put two DIFFERENT warehouses over ONE queue.
Future<void> _mountStock(
  WidgetTester tester,
  InMemorySyncQueue queue,
  _Transport transport, {
  String? warehouseId,
  FieldStockRepository? repo,
}) => _mount(
  tester,
  FieldStockScreen(
    repo: repo ?? _StockRepo(_processor(queue, transport)),
    strings: _stockStrings,
    i18n: _i18n,
    warehouseId: warehouseId,
  ),
);

/// Stage one bag of cement, so the CTA has a basket to submit. An empty basket makes
/// `canSubmitIssue` false and the confirm button inert, which would make every
/// assertion below pass for the wrong reason.
Future<void> _stageOne(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.add).first);
  await _flush(tester);
}

const String _projectPrimary = 'juneflow พาร์ค ราชพฤกษ์';
const String _projectSecond = 'juneflow เพลส บางนา';

/// Re-attribute the basket to the SECOND project via the real picker sheet.
///
/// `_flush` is useless around a modal route: it pumps zero-duration frames, so the
/// clock never advances and the sheet neither finishes opening nor finishes
/// dismissing — the still-live barrier then swallows the confirm tap that follows,
/// and the test fails with an empty queue for a reason that has nothing to do with
/// what it is testing. Real durations are required on both transitions.
Future<void> _pickSecondProject(WidgetTester tester) async {
  await tester.tap(find.text(_projectPrimary));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.tap(find.text(_projectSecond).last);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await _flush(tester);
}

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

    testWidgets('field-stock (MONEY — a second key is a second stock cut + a second JV), '
        'and the "restart" here is only switching tabs', (WidgetTester tester) async {
      // THE DIFFERENCE FROM THE FIVE ABOVE: this screen does not need an app kill
      // to lose its State. mobile_shell.dart renders `MobileScreenRouter(route:
      // _route)` as the TAB BODY — swapped, not an IndexedStack — so leaving the
      // tab and coming back destroys this State outright. `_kill` models the tab
      // swap exactly (the tree goes, the queue stays), and that is an ordinary
      // gesture rather than a rare crash.
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountStock(tester, queue, transport);
      await _stageOne(tester);
      await _tap(tester, _confirmRecv);
      final String k1 = (await _queued(queue)).single.id;
      expect((await _queued(queue)).single.endpoint, '/inventory/issues');
      expect(find.text(_queuedCard), findsOneWidget);

      await _kill(tester);
      await _mountStock(tester, queue, transport);

      // The returning screen already knows an issue is outstanding — it did not
      // present a clean, editable basket.
      expect(find.text(_queuedCard), findsOneWidget);

      // The storekeeper, still seeing no confirmation, stages and confirms again.
      // The stepper REFUSES the tap, because the adopted op owns the basket: the
      // queue replays its stored payload verbatim, so a quantity accepted here
      // would be shown and never sent.
      await _stageOne(tester);
      expect(
        find.text('1'),
        findsNothing,
        reason: 'the + stepper must be frozen behind the adopted op',
      );
      await _tap(tester, _confirmRecv);

      expect(
        await _queuedIds(queue),
        <String>[k1],
        reason:
            'a second key here is a second POST /inventory/issues: one '
            'transaction that inserts a second material_issue, a second '
            'stock_ledger row at -qty AND a second Dr 1140 / Cr 5020 JV. '
            'material_issue_idempotency_uq cannot stop it — the two keys '
            'differ, so they are legitimately two issues',
      );

      // And when the signal returns, the server is hit exactly ONCE.
      transport.offline = false;
      await _processor(queue, transport).drain();
      expect(transport.accepted.length, 1);
      expect(transport.accepted.single.endpoint, '/inventory/issues');
      expect(transport.accepted.single.payload['idempotency_key'], k1);
      expect(await queue.length(), 0);
    });
  });

  // =========================================================================
  // 1b. THE WINDOW, AND THE CTA THAT IS QUIET FOR IT — BLOCKERS.md B-341.
  //
  //     `_resumeQueued` is fired `unawaited` from initState, so for a stretch
  //     after the first frame the screen is fully rendered while `_opId` is still
  //     null and no queued card is up: a CLEAN SLATE over a queue that is not.
  //     A tap in there is a lose-lose. Minting is the duplicate this whole file
  //     exists to prevent; adopting — what the pre-mint check does — sends the
  //     PREVIOUS op and never sends the basket the user just staged, while the
  //     screen reports the previous write's outcome as if it were this one's.
  //
  //     Wei ruled the third way (B-341): the CTA is QUIET until the queue read
  //     completes, so no tap is possible in the window at all. Two consequences
  //     the tests below pin down:
  //
  //       * THE READ RUNS FIRST, BEFORE THE DRAIN. A drain can only shrink what
  //         is adoptable, so reading first cannot miss anything — and it takes
  //         the one unbounded call (Dio sets no `connectTimeout`) out of the
  //         window. What the user waits on is local storage, nothing else. That
  //         is the bound, and group 1b-b holds the drain open FOREVER to prove
  //         it: a CTA quiet forever would be worse than the defect it fixes.
  //       * The window is therefore the QUEUE READ, and every fixture here holds
  //         `due()` open rather than the transport.
  //
  //     Each test must go RED on its own when `_settling` is dropped from ITS
  //     screen's CTA: six screens, six independent reds.
  // =========================================================================
  group('the CTA is quiet until the queue read completes (B-341)', () {
    testWidgets(
      'st-receive (MONEY — the basket that would be silently dropped is a GR)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        // The receipt is captured while offline and stays queued.
        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        // Relaunch with the signal BACK, over a queue read that takes real time.
        // The replay is HELD open so k1 is still pending for the whole window —
        // otherwise the drain resolves it and there is no window to test.
        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountRecv(
          tester,
          queue,
          transport,
          repo: _SlowDueRecvRepo(_processor(queue, transport), delay: _slow),
        );

        // INSIDE the window. The confirm bar has replaced its label with the
        // spinner it already uses for a submit: visibly refusing, not silently
        // swallowing.
        expect(
          find.text(_confirmRecv),
          findsNothing,
          reason: 'the CTA must not be presenting itself as tappable',
        );
        await _tapCtaSpinner(tester);
        expect(
          await _queuedIds(queue),
          <String>[k1],
          reason: 'a tap inside the window must enqueue nothing at all',
        );

        // The read lands: the window closes and the screen states the truth.
        await tester.pump(_slow * 2);
        await _flush(tester);
        expect(find.text(_queuedCard), findsOneWidget);
        expect(find.text(_confirmRecv), findsOneWidget);

        // The held replay finally lands. The server received exactly the one key,
        // and the card that described it comes back down.
        gate.complete();
        await _flush(tester, 20);
        await _drainSlowTimers(tester);
        expect(transport.acceptedKeys, <String>[k1]);
        expect(await queue.length(), 0);
        expect(find.text(_queuedCard), findsNothing);
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
      await _mountCheckin(
        tester,
        queue,
        transport,
        repo: _SlowDueCheckinRepo(_processor(queue, transport), delay: _slow),
      );

      expect(find.text(_checkinBtn), findsNothing);
      await _tapCtaSpinner(tester);
      expect(await _queuedIds(queue), <String>[k1]);

      await tester.pump(_slow * 2);
      await _flush(tester);
      expect(find.text(_queuedCard), findsOneWidget);
      expect(find.text(_checkinBtn), findsOneWidget);

      gate.complete();
      await _flush(tester, 20);
      await _drainSlowTimers(tester);
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
      expect(find.text(_queuedCard), findsNothing);
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
      await _mountNotes(
        tester,
        queue,
        transport,
        repo: _SlowDueNotesRepo(_processor(queue, transport), delay: _slow),
      );

      expect(find.text(_saveNotes), findsNothing);
      await _tapCtaSpinner(tester);
      expect(await _queuedIds(queue), <String>[k1]);

      await tester.pump(_slow * 2);
      await _flush(tester);
      expect(find.text(_queuedCard), findsOneWidget);
      expect(find.text(_saveNotes), findsOneWidget);

      gate.complete();
      await _flush(tester, 20);
      await _drainSlowTimers(tester);
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
      expect(find.text(_queuedCard), findsNothing);
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
      await _mountChecklist(
        tester,
        queue,
        transport,
        repo: _SlowDueChecklistRepo(_processor(queue, transport), delay: _slow),
      );

      expect(find.text(_saveChecklist), findsNothing);
      await _tapCtaSpinner(tester);
      expect(await _queuedIds(queue), <String>[k1]);

      await tester.pump(_slow * 2);
      await _flush(tester);
      expect(find.text(_queuedCard), findsOneWidget);
      expect(find.text(_saveChecklist), findsOneWidget);

      gate.complete();
      await _flush(tester, 20);
      await _drainSlowTimers(tester);
      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
      expect(find.text(_queuedCard), findsNothing);
    });

    testWidgets(
      'field-progress: N anchors on view, and every deliver button is quiet '
      'until the read that covers ALL of them has answered',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountProgress(tester, queue, transport);
        await _tap(tester, _deliver);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountProgress(
          tester,
          queue,
          transport,
          repo: _SlowDueProgressRepo(
            _processor(queue, transport),
            delay: _slow,
          ),
        );

        // This screen renders a button PER PERIOD and greys rather than spins
        // (one spinner per row would be noise), so the refusal is the muted fill
        // it already uses while another row is sending. Both rows are quiet: the
        // one read answers for every anchor on view.
        expect(find.text(_deliver), findsNWidgets(2));
        _expectMutedCta(tester, find.text(_deliver).first);
        _expectMutedCta(tester, find.text(_deliver).last);
        await _tap(tester, _deliver);
        expect(await _queuedIds(queue), <String>[k1]);

        await tester.pump(_slow * 2);
        await _flush(tester);
        expect(find.text(_queuedCard), findsOneWidget);

        gate.complete();
        await _flush(tester, 20);
        await _drainSlowTimers(tester);
        expect(transport.accepted.length, 1);
        expect(transport.accepted.single.endpoint, '/periods/p1/deliver');
        expect(await queue.length(), 0);
      },
    );

    testWidgets(
      'field-stock (MONEY — the basket that would be silently dropped is a '
      'stock cut + a JV)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        await _mountStock(tester, queue, transport);
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountStock(
          tester,
          queue,
          transport,
          repo: _SlowDueStockRepo(_processor(queue, transport), delay: _slow),
        );

        // The shelf has landed — this screen's read chain never sat behind the
        // drain — so the storekeeper can stage a basket, which is exactly the
        // input B-341 refuses to let him confirm into someone else's op.
        await _stageOne(tester);
        _expectMutedCta(tester, find.text(_confirmRecv));
        await _tap(tester, _confirmRecv);
        expect(await _queuedIds(queue), <String>[k1]);

        await tester.pump(_slow * 2);
        await _flush(tester);
        expect(find.text(_queuedCard), findsOneWidget);

        gate.complete();
        await _flush(tester, 20);
        await _drainSlowTimers(tester);
        expect(transport.acceptedKeys, <String>[k1]);
        expect(await queue.length(), 0);
      },
    );
  });

  group('the card comes back down when the drain resolves what it described', () {
    testWidgets(
      'field-stock: and the charged project goes with it, so the NEXT basket '
      'is not silently pre-addressed to the last one',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(); // offline

        // Session 1: an issue against the SECOND project, captured offline.
        await _mountStock(tester, queue, transport);
        await _stageOne(tester);
        await _pickSecondProject(tester);
        await _tap(tester, _confirmRecv);
        expect(
          (await _queued(queue)).single.payload['project_id'],
          'p2',
          reason: 'the fixture must really charge the second project',
        );
        await _kill(tester);

        // Session 2: adopted before the drain (that is what bounds the window),
        // so the frozen picker must show what the OP charges, not the default the
        // fresh load just picked.
        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountStock(tester, queue, transport);
        expect(find.text(_queuedCard), findsOneWidget);
        expect(find.text(_projectSecond), findsOneWidget);
        expect(find.text(_projectPrimary), findsNothing);

        // The held replay lands: the op is gone, so nothing outstanding is left
        // to describe.
        gate.complete();
        await _flush(tester, 20);

        expect(await queue.length(), 0);
        expect(
          find.text(_queuedCard),
          findsNothing,
          reason:
              'the card outlived its subject by exactly one round trip, which '
              'is the price of asking the queue before the drain',
        );
        expect(
          find.text(_projectPrimary),
          findsOneWidget,
          reason:
              'the basket is editable again and unattributed; leaving p2 in an '
              'editable slot would address the next issue to it in silence',
        );
        expect(find.text(_projectSecond), findsNothing);
      },
    );
  });

  // =========================================================================
  // 1b-b. THE BOUND — what "until the queue settles" is allowed to wait on.
  //
  //       A CTA quiet forever is worse than the defect it fixes, and the drain
  //       is genuinely unbounded: `AppServices` builds Dio with NO
  //       `connectTimeout`, so a half-open link holds a replay for as long as the
  //       OS allows. The bound is therefore structural rather than a chosen
  //       duration — the window contains no network call at all, only
  //       `SyncQueue.pending()`, whose two implementations are an in-memory list
  //       and the local drift/SQLite store.
  //
  //       Each test below holds the replay open and NEVER completes it, then
  //       drives the screen to a real outcome anyway. They go red the moment the
  //       drain is moved back in front of the queue read.
  // =========================================================================
  group('a drain that never returns does not hold the CTA (B-341)', () {
    testWidgets('st-receive', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountRecv(tester, queue, transport);
      await _tap(tester, _confirmRecv);
      final String k1 = (await _queued(queue)).single.id;
      await _kill(tester);

      // The signal is "back", but the replay never lands. The gate is never
      // completed by this test — that is the point.
      transport
        ..offline = false
        ..gate = Completer<void>();
      await _mountRecv(tester, queue, transport);

      expect(
        find.text(_confirmRecv),
        findsOneWidget,
        reason: 'the CTA is live: it waited on the queue read, not the drain',
      );
      expect(
        find.text(_queuedCard),
        findsOneWidget,
        reason: 'and it says what is outstanding, without the drain answering',
      );
      expect(await _queuedIds(queue), <String>[k1]);
    });

    testWidgets('pm-checkin', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountCheckin(tester, queue, transport);
      await _tap(tester, _checkinBtn);
      await _kill(tester);

      transport
        ..offline = false
        ..gate = Completer<void>();
      await _mountCheckin(tester, queue, transport);

      expect(find.text(_checkinBtn), findsOneWidget);
      expect(find.text(_queuedCard), findsOneWidget);
    });

    testWidgets('pm-notes', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountNotes(tester, queue, transport);
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      await _kill(tester);

      transport
        ..offline = false
        ..gate = Completer<void>();
      await _mountNotes(tester, queue, transport);

      expect(find.text(_saveNotes), findsOneWidget);
      expect(find.text(_queuedCard), findsOneWidget);
    });

    testWidgets('pm-checklist', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist);
      await _kill(tester);

      transport
        ..offline = false
        ..gate = Completer<void>();
      await _mountChecklist(tester, queue, transport);

      expect(find.text(_saveChecklist), findsOneWidget);
      expect(find.text(_queuedCard), findsOneWidget);
    });

    testWidgets(
      'field-progress: the period list itself used to sit behind the drain, so '
      'a held replay blanked the whole screen',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountProgress(tester, queue, transport);
        await _tap(tester, _deliver);
        await _kill(tester);

        transport
          ..offline = false
          ..gate = Completer<void>();
        await _mountProgress(tester, queue, transport);

        expect(
          find.text(_deliver),
          findsWidgets,
          reason:
              'the rows no longer wait on the drain — `_resumeQueued` starts it '
              'and awaits it LAST',
        );
        expect(find.text(_queuedCard), findsOneWidget);
      },
    );

    testWidgets('field-stock', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountStock(tester, queue, transport);
      await _stageOne(tester);
      await _tap(tester, _confirmRecv);
      await _kill(tester);

      transport
        ..offline = false
        ..gate = Completer<void>();
      await _mountStock(tester, queue, transport);

      expect(find.text(_confirmRecv), findsOneWidget);
      expect(find.text(_queuedCard), findsOneWidget);
    });
  });

  // =========================================================================
  // 1b-c. THE QUEUE READ ITSELF FAILING — the CTA still opens, and the PRE-MINT
  //        check is what holds.
  //
  //        B-341 releases the button in a `finally`, so a read that THROWS opens
  //        it rather than parking it forever: an unanswerable question must not
  //        become a dead end. That is precisely the state the pre-mint check was
  //        written for — `_opId` null, the CTA live, an op still in the queue —
  //        and after B-341 it is the main way to reach it, so these tests are
  //        the surviving red-on-removal probe for that check on five of the six
  //        screens. Each asserts what the SERVER received.
  // =========================================================================
  group('a queue read that throws opens the CTA, and the mint site holds', () {
    testWidgets(
      'st-receive (MONEY — a second key is a second GR + a second JV)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountRecv(tester, queue, transport);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        final _ThrowingDueRecvRepo repo = _ThrowingDueRecvRepo(
          _processor(queue, transport),
        );
        await _mountRecv(tester, queue, transport, repo: repo);

        // The read failed, so nothing could be adopted — and the button is open
        // rather than parked on a question that cannot be answered.
        expect(find.text(_queuedCard), findsNothing);
        expect(find.text(_confirmRecv), findsOneWidget);

        // The storekeeper confirms again. The mint site's own read succeeds.
        repo.throwing = false;
        await _tap(tester, _confirmRecv);

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
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      final _ThrowingDueCheckinRepo repo = _ThrowingDueCheckinRepo(
        _processor(queue, transport),
      );
      await _mountCheckin(tester, queue, transport, repo: repo);

      expect(find.text(_checkinBtn), findsOneWidget);
      repo.throwing = false;
      await _tap(tester, _checkinBtn);

      gate.complete();
      await _flush(tester, 20);

      expect(
        transport.accepted.length,
        1,
        reason: 'a second op here is a second check-in on the same work order',
      );
      expect(await queue.length(), 0);
    });

    testWidgets('pm-notes', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();
      PmNotesRepository stored() =>
          _StoredNotesRepo(_processor(queue, transport));

      await _mountNotes(tester, queue, transport, repo: stored());
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      final _ThrowingDueNotesRepo repo = _ThrowingDueNotesRepo(
        _processor(queue, transport),
      );
      await _mountNotes(tester, queue, transport, repo: repo);

      expect(find.text(_saveNotes), findsOneWidget);
      // Nothing is TYPED — the seed is what fills the form — so `_edited` stays
      // false and the save really does reach the pre-mint check.
      repo.throwing = false;
      await _tap(tester, _saveNotes);

      gate.complete();
      await _flush(tester, 20);

      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
    });

    testWidgets('pm-checklist', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist);
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      final _ThrowingDueChecklistRepo repo = _ThrowingDueChecklistRepo(
        _processor(queue, transport),
      );
      await _mountChecklist(tester, queue, transport, repo: repo);

      expect(find.text(_saveChecklist), findsOneWidget);
      repo.throwing = false;
      await _tap(tester, _saveChecklist);

      gate.complete();
      await _flush(tester, 20);

      expect(transport.accepted.length, 1);
      expect(await queue.length(), 0);
    });

    testWidgets('field-progress', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport();

      await _mountProgress(tester, queue, transport);
      await _tap(tester, _deliver);
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      final _ThrowingDueProgressRepo repo = _ThrowingDueProgressRepo(
        _processor(queue, transport),
      );
      await _mountProgress(tester, queue, transport, repo: repo);

      expect(find.text(_deliver), findsWidgets);
      repo.throwing = false;
      await _tap(tester, _deliver);

      gate.complete();
      await _flush(tester, 20);

      expect(transport.accepted.length, 1);
      expect(transport.accepted.single.endpoint, '/periods/p1/deliver');
      expect(await queue.length(), 0);
    });

    testWidgets(
      'field-stock (MONEY — a second key is a second stock cut + a second JV)',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountStock(tester, queue, transport);
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        final _ThrowingDueStockRepo repo = _ThrowingDueStockRepo(
          _processor(queue, transport),
        );
        await _mountStock(tester, queue, transport, repo: repo);

        expect(find.text(_queuedCard), findsNothing);
        await _stageOne(tester);
        repo.throwing = false;
        await _tap(tester, _confirmRecv);

        gate.complete();
        await _flush(tester, 20);

        expect(
          transport.acceptedKeys,
          <String>[k1],
          reason:
              'two distinct keys = two material issues = two stock_ledger '
              'decrements and two JVs',
        );
        expect(await queue.length(), 0);
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
  // 1c-a. B-330 F1 CASE A — an edit typed INSIDE the window and saved AFTER it
  //       closes.
  //
  //       B-341 quietens the CTA, so there is no save inside the window. But the
  //       FORM is not quiet — nothing stops the technician typing — and the
  //       adoption lands after he does. If the adoption simply overwrites, the
  //       save that follows takes the `tracked != null` branch, re-drains the OLD
  //       op, and the body he typed never leaves the device while the screen
  //       reports the write as handled. That is case A, and quietening the button
  //       does NOT by itself close it: the save is after the window, not in it.
  //
  //       What closes it is the rule the mint site already applies, applied at
  //       the OTHER place that adopts: `_edited` means the body on screen is no
  //       longer the body the queued op carries, so that op is not this write and
  //       must not be adopted. Both tests below go red the moment `_edited` is
  //       dropped from ITS screen's adoption guard.
  // =========================================================================
  group('B-330 F1 case A: typed inside the window, saved after it closed', () {
    testWidgets('pm-notes: the server receives the body that is ON SCREEN', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      // Session 1: the log is captured offline and stays queued.
      await _mountNotes(
        tester,
        queue,
        transport,
        repo: _StoredNotesRepo(_processor(queue, transport)),
      );
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      final String k1 = (await _queued(queue)).single.id;
      await _kill(tester);

      // Session 2: the signal is back but the replay is HELD, so k1 is still
      // pending when the queue read snapshots it — and that read takes real time.
      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      await _mountNotes(
        tester,
        queue,
        transport,
        repo: _SlowDueNotesRepo(_processor(queue, transport), delay: _slow),
      );

      // INSIDE the window the CTA is quiet — and the form is not. He types what
      // he actually found.
      expect(find.text(_saveNotes), findsNothing);
      await tester.enterText(find.byType(TextField).first, 'มอเตอร์ไหม้');
      await _flush(tester);

      // The window closes, the CTA comes back, and only NOW does he save.
      await tester.pump(_slow * 2);
      await _flush(tester);
      expect(find.text(_saveNotes), findsOneWidget);
      await _tap(tester, _saveNotes);

      gate.complete();
      await _flush(tester, 30);
      await _drainSlowTimers(tester);

      expect(
        find.text('มอเตอร์ไหม้'),
        findsOneWidget,
        reason: 'the screen is showing the body he typed',
      );
      expect(
        transport.accepted
            .map(
              (({String endpoint, Map<String, Object?> payload}) r) =>
                  r.payload['cause'],
            )
            .toList(),
        <String>['สายพานขาด', 'มอเตอร์ไหม้'],
        reason:
            'FIFO replays the queued body then his, so the column ends up '
            'holding what is on screen. Adopting over his edit sends the OLD '
            'body ONLY — the screen reports a handled write and his text never '
            'left the device (B-330 F1 case A).',
      );
      expect(k1, isNotEmpty);
    });

    testWidgets('pm-checklist: the server receives the results that are ON '
        'SCREEN', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist); // every line still unchecked
      final String k1 = (await _queued(queue)).single.id;
      await _kill(tester);

      transport.offline = false;
      final Completer<void> gate = Completer<void>();
      transport.gate = gate;
      await _mountChecklist(
        tester,
        queue,
        transport,
        repo: _SlowDueChecklistRepo(_processor(queue, transport), delay: _slow),
      );

      // Inside the window the save button is quiet; the checklist rows are not.
      expect(find.text(_saveChecklist), findsNothing);
      await _tap(tester, _resultNormal);

      await tester.pump(_slow * 2);
      await _flush(tester);
      expect(find.text(_saveChecklist), findsOneWidget);
      await _tap(tester, _saveChecklist);

      gate.complete();
      await _flush(tester, 30);
      await _drainSlowTimers(tester);

      expect(
        transport.accepted
            .map(
              (({String endpoint, Map<String, Object?> payload}) r) =>
                  (r.payload['items']! as List<Object?>).first,
            )
            .toList(),
        <Object?>[isNot(contains('result')), containsPair('result', 'normal')],
        reason:
            'adopting over the result he just set re-sends the UNCHECKED list '
            'and drops it (B-330 F1 case A)',
      );
      expect(k1, isNotEmpty);
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

        // Session 2: the signal is back but the replay is held open, so k1 is
        // still pending. The read is NOT held — it still returns the OLD stored
        // log, because the queued write never reached the server — so the form
        // re-seeds it.
        transport.offline = false;
        final Completer<void> gate = Completer<void>();
        transport.gate = gate;
        await _mountNotes(tester, queue, transport, repo: stored());

        expect(
          find.text(_StoredNotesRepo.storedCause),
          findsOneWidget,
          reason:
              'the seed fired for real — the listener DID run, which is the '
              'whole condition `_seeding` exists to classify',
        );
        expect(
          find.text(_queuedCard),
          findsOneWidget,
          reason:
              'the queue read has answered (B-341) and NOTHING was typed, so '
              'the adoption stands. Counting the seed as an edit would set '
              '`_edited`, the adoption would refuse it, and this card would be '
              'absent — which is the same defect one step earlier.',
        );

        // He taps save. He has typed nothing: the only thing that touched the
        // controllers is the read.
        await _tap(tester, _saveNotes);

        expect(
          await _queuedIds(queue),
          <String>[k1],
          reason:
              'counting the seed as an edit skips both the adoption and the '
              'pre-mint check, and the second key sits right here as a second '
              'close-out',
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
        final _Transport transport = _Transport(); // offline throughout

        await _mountNotes(tester, queue, transport);
        await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
        await _flush(tester);
        await _tap(tester, _saveNotes);
        final String k1 = (await _queued(queue)).single.id;
        await _kill(tester);

        // Inside the window — which after B-341 is the QUEUE READ, so that is
        // what this fixture holds open. Nothing has been adopted yet and the
        // screen looks exactly as it does when nothing was ever submitted, which
        // is the whole reason the listener cannot infer "seeding" from the state
        // and needs `_seeding` to be told.
        await _mountNotes(
          tester,
          queue,
          transport,
          repo: _SlowDueNotesRepo(_processor(queue, transport), delay: _slow),
        );
        expect(find.text(_queuedCard), findsNothing);

        // The CTA is quiet in here (B-341) — the FORM is not.
        await tester.enterText(find.byType(TextField).first, 'มอเตอร์ไหม้');
        await _flush(tester);

        // The window closes. The adoption must REFUSE the queued op, because the
        // body on screen is no longer the body it carries.
        await tester.pump(_slow * 2);
        await _flush(tester);
        expect(
          find.text(_queuedCard),
          findsNothing,
          reason:
              'adopting here would send the OLD body at the next save and drop '
              'what he just typed (B-330 F1 case A)',
        );

        await _tap(tester, _saveNotes);
        await _drainSlowTimers(tester);

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

    testWidgets('field-stock (MONEY — two ops are two stock cuts + two JV): two taps on '
        'confirm enqueue ONE issue', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(); // offline

      await _mountStock(
        tester,
        queue,
        transport,
        repo: _SlowDueStockRepo(
          _processor(queue, transport),
          delay: const Duration(milliseconds: 120),
        ),
      );
      // Let the on-mount adoption finish first (it reads the queue too), so the
      // only read in flight below is the one the tap opens.
      await tester.pump(const Duration(milliseconds: 200));
      await _flush(tester);
      expect(find.text(_queuedCard), findsNothing); // nothing was queued yet

      await _stageOne(tester);

      // The storekeeper taps confirm twice — the first tap has not repainted yet,
      // which is exactly why he taps again. Both land on the tree built while the
      // screen was idle, so both reach `_onConfirm`; only the SYNCHRONOUS busy
      // flip stops the second one before the queue read.
      await tester.tap(find.text(_confirmRecv).first);
      await tester.tap(find.text(_confirmRecv).first);
      await tester.pump(const Duration(milliseconds: 300));
      await _flush(tester, 20);

      final List<SyncOperation> ops = await _queued(queue);
      expect(
        ops.length,
        1,
        reason:
            'without the flip both taps read the queue BEFORE either enqueues, '
            'both find nothing of their own, and both mint — a second POST '
            '/inventory/issues under a second key, which is a second stock '
            'decrement and a second Dr 1140 / Cr 5020 JV',
      );
      expect(ops.single.endpoint, '/inventory/issues');

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

    testWidgets(
      'field-stock: warehouse A and warehouse B share entityType AND endpoint '
      '(/inventory/issues) — B must NOT adopt A\'s key',
      (WidgetTester tester) async {
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        // An issue is captured against warehouse A and left queued.
        await _mountStock(tester, queue, transport, warehouseId: 'w-A');
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);
        final String kA = (await _queued(queue)).single.id;

        // The storekeeper moves to a DIFFERENT warehouse.
        await _kill(tester);
        await _mountStock(tester, queue, transport, warehouseId: 'w-B');

        // Nothing of warehouse B's is queued, so no status card is claimed for it
        // and the basket is editable.
        expect(find.text(_queuedCard), findsNothing);
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);

        final List<SyncOperation> ops = await _queued(queue);
        expect(
          ops.length,
          2,
          reason: 'warehouse B\'s issue must be its OWN write',
        );
        final SyncOperation opB = ops.firstWhere(
          (SyncOperation o) => o.id != kA,
        );
        expect(opB.payload[kIssueFromWarehouseField], 'w-B');
        expect(opB.payload['idempotency_key'], opB.id);
        // Had B adopted A's key, B's basket would simply never have been issued —
        // and the screen would have shown A's outstanding write as B's. That is a
        // WRONG write, which is worse than the duplicate the anchor exists to stop.
        expect(opB.id, isNot(kA));
      },
    );

    testWidgets(
      'field-stock: a basket issued against the NON-default project is still '
      'adopted after a remount — the anchor must not include project_id',
      (WidgetTester tester) async {
        // THE ANCHOR-WIDTH TEST. `project_id` is in the payload and looks like a
        // second, free precision win. It is not: the screen re-defaults the project
        // to the tenant's PRIMARY on every load, so an anchor carrying it would fail
        // to match the screen's own queued op the moment the storekeeper had picked
        // anything else — and mint a second key. That is the whole defect, wearing a
        // narrower anchor. This test is the thing that goes red if anyone widens it.
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport();

        await _mountStock(tester, queue, transport);
        await _stageOne(tester);

        // Pick the SECOND project — not the primary the load defaulted to.
        await _pickSecondProject(tester);

        await _tap(tester, _confirmRecv);
        final SyncOperation queued = (await _queued(queue)).single;
        expect(
          queued.payload['project_id'],
          'p2',
          reason:
              'the pick must have reached the payload, or this proves nothing',
        );

        await _kill(tester);
        await _mountStock(tester, queue, transport);

        expect(
          find.text(_queuedCard),
          findsOneWidget,
          reason:
              'the fresh mount defaulted the picker back to p1; if p2 were part '
              'of the identity it would not recognise its own op',
        );
        // And the frozen picker shows what the op actually CHARGES, not the
        // default the load just applied — the screen is about to refuse edits on
        // the strength of that op, so it must not misstate it.
        expect(find.text(_projectSecond), findsOneWidget);

        await _tap(tester, _confirmRecv);
        expect(await _queuedIds(queue), <String>[queued.id]);
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

    testWidgets(
      'field-stock: once the issue SYNCS the key is released, so the NEXT basket '
      'from the SAME warehouse gets its OWN key',
      (WidgetTester tester) async {
        // The mirror-image defect matters more here than anywhere else in this
        // file, because the anchor is a WAREHOUSE rather than a document: a
        // storekeeper works the same shelf all day, and every issue after the first
        // would be swallowed into the first one if the key were held.
        final InMemorySyncQueue queue = InMemorySyncQueue();
        final _Transport transport = _Transport(offline: false);

        await _mountStock(tester, queue, transport);
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);
        expect(await queue.length(), 0); // 2xx removed it
        final String k1 =
            transport.accepted.single.payload['idempotency_key']! as String;

        // The SAME mount, staging the next issue — the ordinary case this screen
        // is built around (it does not pop, it re-arms).
        await _stageOne(tester);
        await _tap(tester, _confirmRecv);

        expect(transport.accepted.length, 2);
        final String k2 =
            transport.accepted.last.payload['idempotency_key']! as String;
        expect(
          k2,
          isNot(k1),
          reason:
              'reusing k1 would make the server resolve a genuinely new issue '
              'back to the first one: material leaves the warehouse and no '
              'ledger row records it',
        );
        // Both issues came off the SAME shelf — which is exactly why an anchor
        // that is only a warehouse must be released the instant the op is gone.
        expect(
          transport.accepted
              .map(
                (({String endpoint, Map<String, Object?> payload}) r) =>
                    r.payload[kIssueFromWarehouseField],
              )
              .toList(),
          <String>['w-B', 'w-B'],
        );
      },
    );
  });

  // =========================================================================
  // 4. B-330 F2 — THE IN-SESSION DEAD-LETTER, MEASURED RATHER THAN ASSUMED.
  //
  //    A 4xx is permanent: `QueueDrainProcessor` marks the op `failed` and every
  //    later drain SKIPS it, so the write will never be sent. Whether the user
  //    can make a new one without leaving the screen depends on one line —
  //    whether `_resolve` releases `_opId` on the failed outcome — and on whether
  //    the screen has an edit that releases it instead.
  //
  //    B-341 QUIETENS THE CTA FOR THE ON-MOUNT QUEUE READ, AND THIS IS NOT THAT.
  //    `_settling` is long false by the time a write can fail, and the failed
  //    branch never consults it, so the matrix below is exactly what it was
  //    before the ruling. These tests exist to SAY that with measurements rather
  //    than to claim it: they were run against dev's `lib/` and against this
  //    branch's, and they answer identically. What is recorded here is therefore
  //    the state of F2, not a fix for it.
  // =========================================================================
  group('B-330 F2: what a 4xx dead-letter leaves the user able to do', () {
    testWidgets('st-receive: STRANDED — a re-tap re-drains an op the drain will '
        'never send again', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountRecv(tester, queue, transport);
      await _tap(tester, _confirmRecv);
      expect(await _deadLetters(queue), 1);
      expect(transport.accepted.length, 1);

      // He taps again. There is no edit on this screen that could release the id.
      await _tap(tester, _confirmRecv);

      expect(
        await queue.length(),
        1,
        reason: 'no new write was made: `_opId` survives the failed outcome',
      );
      expect(
        transport.accepted.length,
        1,
        reason: 'and the drain skips the dead-letter, so nothing was re-sent',
      );
    });

    testWidgets('pm-checkin: STRANDED', (WidgetTester tester) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountCheckin(tester, queue, transport);
      await _tap(tester, _checkinBtn);
      expect(await _deadLetters(queue), 1);

      await _tap(tester, _checkinBtn);
      expect(await queue.length(), 1);
      expect(transport.accepted.length, 1);
    });

    testWidgets('field-progress: STRANDED — the third screen, and the '
        'correction that made F2 three rather than two', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountProgress(tester, queue, transport);
      await _tap(tester, _deliver);
      expect(await _deadLetters(queue), 1);

      // `_resolve` releases `_opId` only on `sent`, and `_pendingPeriodId` still
      // names this period — so the next tap takes the re-drain branch and never
      // reaches the queue check.
      await _tap(tester, _deliver);
      expect(await queue.length(), 1);
      expect(transport.accepted.length, 1);
    });

    testWidgets('pm-notes: ESCAPES, but only through an EDIT', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountNotes(tester, queue, transport);
      await tester.enterText(find.byType(TextField).first, 'สายพานขาด');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      expect(await _deadLetters(queue), 1);

      // A plain re-tap is the same dead end as st-receive's.
      await _tap(tester, _saveNotes);
      expect(await queue.length(), 1);

      // Typing is what releases the id here — `_onEdited` — so the technician
      // gets out by changing what he is sending.
      await tester.enterText(find.byType(TextField).first, 'มอเตอร์ไหม้');
      await _flush(tester);
      await _tap(tester, _saveNotes);
      expect(
        await queue.length(),
        2,
        reason: 'the edit minted a fresh key, which the drain WILL send',
      );
    });

    testWidgets('pm-checklist: ESCAPES, but only through an EDIT', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountChecklist(tester, queue, transport);
      await _tap(tester, _saveChecklist);
      expect(await _deadLetters(queue), 1);

      await _tap(tester, _saveChecklist);
      expect(await queue.length(), 1);

      await _tap(tester, _resultNormal); // `_setResult` releases the id
      await _tap(tester, _saveChecklist);
      expect(await queue.length(), 2);
    });

    testWidgets('field-stock: ESCAPES on a plain re-tap — its `_resolve` '
        'releases the id on BOTH terminal outcomes', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _Transport transport = _Transport(offline: false, status: 400);

      await _mountStock(tester, queue, transport);
      await _stageOne(tester);
      await _tap(tester, _confirmRecv);
      expect(await _deadLetters(queue), 1);

      // The basket is NOT cleared on a failure (only on a confirmed issue), and
      // the id is released, so the storekeeper simply confirms again.
      await _tap(tester, _confirmRecv);
      expect(
        await queue.length(),
        2,
        reason: 'a 4xx wrote nothing, so the retry must be a FRESH key',
      );
    });
  });
}
