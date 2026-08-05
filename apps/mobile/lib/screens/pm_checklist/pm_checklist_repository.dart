// Data access for the mobile PM checklist (route `pm-checklist`). money = NONE.
//
// This screen both READS and WRITES, so it combines the two merged lane patterns:
//
// READ — raw Dio, exactly like pm_jobs / st_grlist:
//   GET /pm/workorders → the tenant's PM work orders (B-014 paginated envelope
//                        `{ data, ... }`, apps/api/src/routes/pm.ts). The work
//                        order's own `items[]` snapshot IS the checklist, so this
//                        one read is the whole data source.
//   The PM routes expose no `GET /pm/workorders/:id`, so the list is the honest
//   read and pm_checklist_agg.findWorkOrder picks the row.
//
//   Why raw Dio, not the generated typed client: the contract models a work order
//   as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares
//   NO fields and therefore DISCARDS items/label/result/before/after on
//   deserialisation — inventing contract fields is forbidden (PLAN.md §0). So this
//   reads the raw JSON maps off the shared Dio, as the web ports read
//   `Record<string, unknown>`.
//
//   NOT read: `GET /pm/checklist-templates`. A template is the reusable LABEL set
//   the web authoring screen (pm-checklist.jsx ChecklistManager) maintains, and the
//   work order already carries its own snapshot of those labels, copied at create
//   time (pm.ts POST /pm/workorders). The mobile prototype has no template picker
//   (that is the web's `pm.pickChecklistBtn` flow), so pulling templates here would
//   either be dead weight or invent a screen the prototype does not have. A work
//   order with an empty `items[]` therefore renders honest-empty — it genuinely has
//   no checklist yet.
//
// WRITE — the offline queue, exactly like pm_checkin (the lane's write precedent,
// BLOCKERS.md B-242 level (a) queue-and-replay):
//   PUT /pm/workorders/{id}/checklist { items }   (pm.ts → the updated work order)
//   The technician stands on site, so the write is captured as a durable
//   SyncOperation and replayed through the level-(a) QueueDrainProcessor rather
//   than assuming connectivity. Replay safety: the handler merges the body's
//   items[] POSITIONALLY onto the stored snapshot and stores no counter, so
//   re-sending the SAME payload converges on the same row — the write is naturally
//   idempotent and money = NONE, so the B-261 idempotency-key contract (which
//   guards money writes) is not required here.
import 'package:dio/dio.dart';

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'pm_checklist_agg.dart';

/// Read the work orders and queue the checklist write.
abstract class PmChecklistRepository {
  /// The tenant's PM work orders as opaque wire rows (GET /pm/workorders).
  Future<List<PmChecklistEnt>> listWorkOrders();

  /// Enqueue the checklist save for [workOrderId] under the stable client
  /// idempotency key [opId] (reused across manual retries so a re-tap never
  /// enqueues a second op), stamped [now], then drain. Returns the drain report.
  ///
  /// [items] is the WHOLE array in wire order — the server merges positionally and
  /// drops omitted fields, so a partial body would erase stored photo references
  /// (see pm_checklist_agg.checklistPayload).
  Future<DrainReport> saveChecklist({
    required String workOrderId,
    required String opId,
    required List<Map<String, Object?>> items,
    required DateTime now,
  });

  /// Re-drain the queue without enqueuing anything — the manual "retry" trigger
  /// and the on-mount trigger of the (a) policy.
  Future<DrainReport> drain();

  /// The ops still in the queue (pending + failed), so the screen can resolve the
  /// state of its own op after a drain.
  Future<List<SyncOperation>> due();
}

/// [PmChecklistRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope) for the read,
/// and the shared offline queue + its (a) processor for the write.
class DioPmChecklistRepository implements PmChecklistRepository {
  const DioPmChecklistRepository(this._dio, this._processor);

  final Dio _dio;
  final QueueDrainProcessor _processor;

  @override
  Future<List<PmChecklistEnt>> listWorkOrders() async {
    final Response<Object?> res = await _dio.get<Object?>('/pm/workorders');
    final Object? body = res.data;
    if (body is! Map) return const <PmChecklistEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <PmChecklistEnt>[];
    return <PmChecklistEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<DrainReport> saveChecklist({
    required String workOrderId,
    required String opId,
    required List<Map<String, Object?>> items,
    required DateTime now,
  }) async {
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: 'pm_checklist',
      kind: SyncOpKind.update,
      endpoint: '/pm/workorders/$workOrderId/checklist',
      method: 'PUT',
      payload: <String, Object?>{'items': items},
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
