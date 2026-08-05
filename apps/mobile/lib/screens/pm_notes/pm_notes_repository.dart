// Data access for the mobile PM maintenance log (route `pm-notes`). money = NONE.
//
// This screen both READS and WRITES, so it combines the two merged lane patterns
// exactly as pm_checklist does:
//
// READ — raw Dio, like pm_jobs / pm_checklist / st_grlist:
//   GET /pm/workorders → the tenant's PM work orders (B-014 paginated envelope
//                        `{ data, ... }`, apps/api/src/routes/pm.ts). The work
//                        order row itself carries `cause` / `fix` / `advice`, so
//                        this one read is the whole data source.
//   The PM routes expose no `GET /pm/workorders/:id`, so the list is the honest
//   read and pm_notes_agg.findWorkOrder picks the row.
//
//   Why raw Dio, not the generated typed client: the contract models a work order
//   as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO
//   fields and therefore DISCARDS cause/fix/advice on deserialisation — inventing
//   contract fields is forbidden (PLAN.md §0). So this reads the raw JSON maps off
//   the shared Dio, as the web ports read `Record<string, unknown>`.
//
//   NOT read: `GET /pm/quotes`. Spare parts (the prototype's parts row, L161-165)
//   live on pmQuotes.parts and carry MONEY (label/qty/price + currency_code). No
//   column on the work order, this screen has no quote-raising affordance in the
//   prototype, and surfacing priced parts is a money-bearing read that belongs to its
//   own slice — so the slot is left valueless (see the screen) rather than guessed at.
//
// WRITE — the offline queue, exactly like pm_checkin / pm_checklist (BLOCKERS.md
// B-242 level (a) queue-and-replay):
//   POST /pm/workorders/{id}/close { cause, fix, advice }   (pm.ts L761-811)
//   The technician stands on site, so the write is captured as a durable
//   SyncOperation and replayed through the level-(a) QueueDrainProcessor rather than
//   assuming connectivity.
//
//   ⚠️ ENDPOINT-NAME CAVEAT (BLOCKERS.md B-281). `…/close` is the ONLY route that
//   writes cause/fix/advice — there is no notes-only endpoint. Today that handler is
//   exactly "set the close columns the body carries": pm_workorder has NO status and
//   NO certificate column, and the handler's own comment says close never invents one
//   (pm.ts L754-758). Its only side effect is `lineNotifyStub("pm.workorder.close")`,
//   a verified NO-OP (pm.ts L218-220). So calling it here writes three text columns
//   and nothing else — which is precisely this screen's write. The RISK is future:
//   once B-108b implements that stub as a real customer LINE push, saving notes at
//   step 2 would notify the customer early AND pm-close (step 3) would notify a
//   second time. B-281 files that for a ruling; nothing about the CURRENT behaviour
//   is guessed at.
//
//   Replay safety: the body is a last-write-wins SET of three text columns — no
//   counter, no sequence, no JV, money = NONE — so re-sending the SAME payload
//   converges on the same row. The B-261 client-idempotency-key contract guards money
//   writes and is not required here.
import 'package:dio/dio.dart';

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'pm_notes_agg.dart';

/// Read the work orders and queue the maintenance-log write.
abstract class PmNotesRepository {
  /// The tenant's PM work orders as opaque wire rows (GET /pm/workorders).
  Future<List<PmNotesEnt>> listWorkOrders();

  /// Enqueue the maintenance-log save for [workOrderId] under the stable client
  /// idempotency key [opId] (reused across manual retries so a re-tap never enqueues
  /// a second op), stamped [now], then drain. Returns the drain report.
  ///
  /// [body] is the WHOLE form (all three keys) — the server keys off key PRESENCE,
  /// so an omitted key would leave a cleared field stored (see
  /// pm_notes_agg.notesPayload).
  Future<DrainReport> saveNotes({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  });

  /// Re-drain the queue without enqueuing anything — the manual "retry" trigger and
  /// the on-mount trigger of the (a) policy.
  Future<DrainReport> drain();

  /// The ops still in the queue (pending + failed), so the screen can resolve the
  /// state of its own op after a drain.
  Future<List<SyncOperation>> due();
}

/// [PmNotesRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope) for the read, and
/// the shared offline queue + its (a) processor for the write.
class DioPmNotesRepository implements PmNotesRepository {
  const DioPmNotesRepository(this._dio, this._processor);

  final Dio _dio;
  final QueueDrainProcessor _processor;

  @override
  Future<List<PmNotesEnt>> listWorkOrders() async {
    final Response<Object?> res = await _dio.get<Object?>('/pm/workorders');
    final Object? body = res.data;
    if (body is! Map) return const <PmNotesEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <PmNotesEnt>[];
    return <PmNotesEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<DrainReport> saveNotes({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  }) async {
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: 'pm_notes',
      kind: SyncOpKind.update,
      endpoint: '/pm/workorders/$workOrderId/close',
      method: 'POST',
      payload: body,
      createdAt: now,
    );
    await _processor.queue.enqueue(op);
    return _processor.drain();
  }

  @override
  Future<DrainReport> drain() => _processor.drain();

  @override
  Future<List<SyncOperation>> due() => _processor.queue.pending();
}
