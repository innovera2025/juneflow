// Data access for the mobile store count-and-receive screen (route `st-receive`).
// money = SERVER (the write sends no monetary value at all — st_receive_agg.dart
// "THE WRITE").
//
// READ — raw Dio, like pm_jobs / st_grlist / field_pr:
//   GET /po/{id}  (po.ts L270-300) — header-only; read ONLY for its `pr_id` hop
//   GET /pr/{id}  (pr.ts L473-503) — the priced lines; the per-line ORDERED qty
//
//   Both answer a BARE object (not the B-014 `{ data, … }` envelope — that shape
//   belongs to the list endpoints), so neither is unwrapped here.
//
//   Why raw Dio, not the generated typed client: the contract models a PO and a
//   PR as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
//   declares NO fields and therefore DISCARDS `pr_id` / `items` / `qty` on
//   deserialisation. Inventing contract fields is forbidden (PLAN.md §0).
//
// WRITE — OFFLINE-ENROLLED, and the safety is a property of the CURRENT server
// rather than an assumption:
//   POST /gr  (gr.ts L541+) — records the receipt against the PO
//
//   The receipt is captured as a durable SyncOperation and replayed by the
//   level-(a) QueueDrainProcessor. A replay is safe because gr.ts resolves the
//   client's own receipt by idempotency key + anchor BEFORE the anchor status
//   gate (B-264) and catches the `gr_idempotency_uq` 23505 by constraint NAME as
//   the concurrency backstop (B-263); both return the ORIGINAL 201. That
//   pre-check ordering is what this screen specifically needs: its prototype
//   default is `recv = ordered`, i.e. a FULL receipt, which closes the PO inside
//   the very same handler — before B-264 the replay of a successful full receipt
//   was answered 409 INVALID_STATE and dead-lettered by sync_processor, so the
//   storekeeper saw FAILED for goods that had actually been received.
//
//   This is the FIRST mobile screen to put an `idempotency_key` in a payload
//   (nothing else in apps/mobile/lib sends one today). The queue replays
//   `op.payload` verbatim and does NOT inject the key, so the key is written
//   into the body here, from the SAME string as the SyncOperation id — the two
//   cannot drift because there is one parameter.
//
//   Contrast with field-pr, which is deliberately online-only: `pr.no` has no
//   unique index and POST /pr dedups with a read-then-insert race (B-295). POST
//   /gr has a real partial unique index, so the same reasoning lands the other
//   way here.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'st_receive_agg.dart';

/// What ONE PO's queued receipt looks like in the shared queue.
///
/// The ONE definition of this write's identity: the enqueue below builds its
/// [SyncOperation] from it, and the screen matches its own still-pending receipt
/// with it after a restart (B-330), so the matcher cannot drift from the builder.
///
/// This is the only one of the five offline writes whose ENDPOINT does not pin the
/// record — `POST /gr` is the same path for every PO — so the anchor is the body's
/// [grPoIdField], read back from the queued payload. Matching on the endpoint alone
/// here would let a receipt queued for one PO be adopted by the screen of another,
/// which on a money path means the second PO's receipt is silently never sent.
SyncOpIdentity stReceiveOpIdentity(String poId) => SyncOpIdentity(
  entityType: 'gr',
  endpoint: '/gr',
  payloadAnchor: <String, Object?>{grPoIdField: poId},
);

/// Read the receipt's subject + lines, and enqueue/drain the receipt write.
abstract class StReceiveRepository {
  /// One PO as an opaque wire row (GET /po/{id}), or null when it does not
  /// resolve. Read for its `pr_id`; never for money.
  Future<StRecvEnt?> loadPo(String poId);

  /// One PR as an opaque wire row including `items[]` (GET /pr/{id}), or null.
  Future<StRecvEnt?> loadPr(String prId);

  /// Enqueue the receipt for [poId] with the counted quantities [counts], under
  /// the stable client idempotency key [opId] (reused across manual retries so a
  /// re-tap never enqueues a second receipt), stamped [now], then drain.
  Future<DrainReport> submitReceipt({
    required String poId,
    required List<double> counts,
    required String opId,
    required DateTime now,
  });

  /// Re-drain the queue without enqueuing anything — the manual retry trigger and
  /// the on-mount trigger of the (a) policy.
  Future<DrainReport> drain();

  /// The ops still due (pending + failed), so the screen can resolve its own op.
  Future<List<SyncOperation>> due();
}

/// [StReceiveRepository] over the app's shared Dio (auth + tenant scope) for the
/// reads and the app's shared offline queue + drain processor for the write.
///
/// Taking the SHARED processor rather than building one here is what lets a
/// queued receipt drain on app resume, not only while this screen is mounted.
class DioStReceiveRepository implements StReceiveRepository {
  const DioStReceiveRepository(this._dio, this.processor);

  final Dio _dio;

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262).
  /// Public so the host wiring stays assertable.
  final QueueDrainProcessor processor;

  @override
  Future<StRecvEnt?> loadPo(String poId) => _object('/po/$poId');

  @override
  Future<StRecvEnt?> loadPr(String prId) => _object('/pr/$prId');

  /// GET [path] and read the bare object body as an opaque row.
  Future<StRecvEnt?> _object(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return null;
    return body.map<String, Object?>(
      (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
    );
  }

  @override
  Future<DrainReport> submitReceipt({
    required String poId,
    required List<double> counts,
    required String opId,
    required DateTime now,
  }) async {
    final SyncOpIdentity identity = stReceiveOpIdentity(poId);
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: identity.entityType,
      kind: SyncOpKind.create,
      endpoint: identity.endpoint,
      method: 'POST',
      // The B-261 contract: the body's `idempotency_key` IS the op id, so a
      // replay of this exact payload resolves to the original receipt instead of
      // creating a second one.
      payload: buildReceiptPayload(
        poId: poId,
        counts: counts,
        idempotencyKey: opId,
      ),
      createdAt: now,
    );
    await processor.queue.enqueue(op);
    return processor.drain();
  }

  @override
  Future<DrainReport> drain() => processor.drain();

  @override
  Future<List<SyncOperation>> due() => processor.queue.pending();
}
