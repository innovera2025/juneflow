// Data access for the mobile work-period delivery screen (route `field-progress`).
// money = NONE.
//
// READ — raw Dio, like pm_jobs / pm_notes / st_grlist:
//   GET /subcon-contracts                (subcon.ts L584-593)
//   GET /vendors                         (the vendor-name join, st_grlist precedent)
//   GET /subcon-contracts/{id}/periods   (subcon.ts L709-735)
//   All three answer the B-014 paginated envelope `{ data, … }`.
//
//   Why raw Dio, not the generated typed client: the contract models each of these
//   rows as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
//   declares NO fields and therefore DISCARDS `no` / `status` / `seq` /
//   `project_name` on deserialisation. Inventing contract fields is forbidden
//   (PLAN.md §0), so this reads the raw JSON maps off the shared Dio.
//
// WRITE — the offline queue, exactly like pm_checkin / pm_checklist / pm_notes
// (BLOCKERS.md B-242 level (a) queue-and-replay):
//   POST /periods/{id}/deliver { docs, photos }   (subcon.ts L741-790)
//   The foreman stands on site, so the write is captured as a durable SyncOperation
//   and replayed through the level-(a) QueueDrainProcessor rather than assuming
//   connectivity.
//
//   Replay safety WITHOUT an idempotency key, stated explicitly because that is the
//   usual reason to refuse the queue: the endpoint is a GUARDED state transition, not
//   an append. Its C3 guard admits only a `pending` period (subcon.ts L754-759), so
//   the first replay that lands after a success meets a `delivered` period and 409s —
//   the duplicate self-rejects. Nothing is created twice, no counter moves, no
//   sequence is allocated, and money = NONE (no JV, no AP billing — the payment of a
//   period is a different door entirely, POST /periods/{id}/approve-payment). The
//   B-261 client-idempotency-key contract guards money writes and is not required
//   here (the pm_checklist / pm_notes precedent).
//
//   ⚠ SCOPE OF THAT OFFLINE COVER (disclosed, not silent). The queue covers a signal
//   drop AFTER the screen loaded. It does not make the READ work offline: with the
//   contract's periods unknown the screen has no period id to address and no status
//   to gate on, so it withholds the action and renders the list as UNKNOWN.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'field_progress_agg.dart';

/// What ONE work period's queued delivery looks like in the shared queue.
///
/// The ONE definition of this write's entity type + endpoint: the enqueue below
/// builds its [SyncOperation] from it, and the screen matches its own still-pending
/// op with it after a restart (B-330), so the matcher cannot drift from the builder.
///
/// Unlike the pm-* screens, this one has MANY candidate anchors on view at once (a
/// contract's periods), so the screen builds one identity per listed period — see
/// `findAdoptableOpAmong`.
SyncOpIdentity fieldDeliverOpIdentity(String periodId) => SyncOpIdentity(
  entityType: 'work_period_deliver',
  endpoint: '/periods/$periodId/deliver',
);

/// Read the contracts + their periods, and queue the delivery write.
abstract class FieldProgressRepository {
  /// The tenant's subcon contracts as opaque wire rows.
  Future<List<FieldProgressEnt>> listContracts();

  /// The tenant's vendors (for the contract's vendor-name join).
  Future<List<FieldProgressEnt>> listVendors();

  /// One contract's work periods.
  Future<List<FieldProgressEnt>> listPeriods(String contractId);

  /// Enqueue the delivery of [periodId] under the stable client key [opId] (reused
  /// across manual retries so a re-tap never enqueues a second op), stamped [now],
  /// then drain. Returns the drain report.
  Future<DrainReport> deliver({
    required String periodId,
    required String opId,
    required DateTime now,
  });

  /// Re-drain the queue without enqueuing anything — the manual "retry" trigger and
  /// the on-mount trigger of the (a) policy.
  Future<DrainReport> drain();

  /// The ops still in the queue (pending + failed), so the screen can resolve the
  /// state of its own op after a drain.
  Future<List<SyncOperation>> due();
}

/// [FieldProgressRepository] over the app's shared Dio for the reads (so it inherits
/// the auth interceptor + tenant scope) and the shared offline queue + its (a)
/// processor for the write.
class DioFieldProgressRepository implements FieldProgressRepository {
  const DioFieldProgressRepository(this._dio, this._processor);

  final Dio _dio;
  final QueueDrainProcessor _processor;

  @override
  Future<List<FieldProgressEnt>> listContracts() =>
      _envelopeData('/subcon-contracts');

  @override
  Future<List<FieldProgressEnt>> listVendors() => _envelopeData('/vendors');

  @override
  Future<List<FieldProgressEnt>> listPeriods(String contractId) =>
      _envelopeData('/subcon-contracts/$contractId/periods');

  @override
  Future<DrainReport> deliver({
    required String periodId,
    required String opId,
    required DateTime now,
  }) async {
    final SyncOpIdentity identity = fieldDeliverOpIdentity(periodId);
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: identity.entityType,
      kind: SyncOpKind.update,
      endpoint: identity.endpoint,
      method: 'POST',
      payload: deliverPayload(),
      createdAt: now,
    );
    await _processor.queue.enqueue(op);
    return _processor.drain();
  }

  @override
  Future<DrainReport> drain() => _processor.drain();

  @override
  Future<List<SyncOperation>> due() => _processor.queue.pending();

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows.
  Future<List<FieldProgressEnt>> _envelopeData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <FieldProgressEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <FieldProgressEnt>[];
    return <FieldProgressEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
