// Data access for the mobile PM close summary (route `pm-close`). money = NONE.
//
// READ-ONLY — and that is the whole point of this file, so it is stated up front
// rather than inferred from the absence of a method:
//
//   GET /pm/workorders → the tenant's PM work orders (B-014 paginated envelope
//                        `{ data, ... }`, apps/api/src/routes/pm.ts L575). Carries
//                        `items` (the checklist tally) and `customer_sign` (the
//                        signature state).
//   GET /pm/assets     → the tenant's PM assets (same envelope, pm.ts L457) — the
//                        join source for the summary's asset name + code.
//
// These are exactly the two reads pm-jobs makes (pm_jobs_repository.dart), for the
// same join, so this screen adds no new endpoint to the app's surface.
//
// THE WRITE — `POST /pm/workorders/:id/close` { signature } — through the offline
// queue, exactly like pm-checkin / pm-checklist / pm-notes (BLOCKERS.md B-242 level
// (a) queue-and-replay). The technician is standing next to the customer in a
// machine room; a captured signature must not be lost to a signal drop.
//
// THIS METHOD EXISTS NOW, AND DID NOT BEFORE (B-288 → B-331). The close used to be
// withheld because the body would have been EMPTY: cause/fix/advice belong to
// pm-notes (step 2) and were already saved there, leaving only the signature — which
// could not be captured, because `customer_sign`'s ENCODING was undefined and
// inventing one for a column two platforms share is a contract decision, not a
// screen decision. Wei ruled that encoding on 2026-08-07 (B-331: STROKE JSON), so
// the one missing field is now capturable with no package at all
// (signature_pad.dart), the body is no longer empty, and the close is a real write.
//
// WHAT THE BODY CARRIES, AND WHAT IT MUST NOT. `{ signature }` and nothing else. The
// handler keys off KEY PRESENCE (pm.ts `has(body, …)`), so omitting cause/fix/advice
// leaves pm-notes' maintenance log untouched; INCLUDING them here — with this screen
// having no form for them — would blank all three. See [pmClosePayload].
//
// Replay safety: one text column, last-write-wins, no counter, no sequence, no JV,
// money = NONE. Re-sending the same payload converges on the same row, so the B-261
// client-idempotency-key contract (which guards money writes) is not required. A
// duplicate op is therefore harmless rather than a double-post.
//
// Why raw Dio, not the generated typed client: the contract models a work order and
// an asset as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and therefore DISCARDS every real column on deserialisation —
// inventing contract fields is forbidden (PLAN.md §0). So this reads the raw JSON
// maps off the shared Dio, as the web ports read `Record<string, unknown>`.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'pm_close_agg.dart';

/// What one work order's queued close looks like in the shared queue.
///
/// The ONE definition of this write's entity type + endpoint, so the enqueue below
/// cannot drift from anything that later has to recognise the op.
SyncOpIdentity pmCloseOpIdentity(String workOrderId) => SyncOpIdentity(
  entityType: 'pm_close',
  endpoint: '/pm/workorders/$workOrderId/close',
);

/// Read the work orders + assets, and queue the close.
abstract class PmCloseRepository {
  /// The tenant's PM work orders as opaque wire rows (GET /pm/workorders).
  Future<List<PmCloseEnt>> listWorkOrders();

  /// The tenant's PM assets as opaque wire rows (GET /pm/assets) — the summary's
  /// asset name/code join source.
  Future<List<PmCloseEnt>> listAssets();

  /// Enqueue the close of [workOrderId] under the stable client id [opId] (reused
  /// across manual retries so a re-tap never enqueues a second op), stamped [now],
  /// then drain. Returns the drain report.
  ///
  /// [body] must be built by [pmClosePayload] — it is `{ signature }` alone, and the
  /// reason it must not carry more is in the file header.
  Future<DrainReport> submitClose({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  });

  /// Re-drain without enqueuing — the manual retry trigger.
  Future<DrainReport> drain();

  /// The ops still due (pending + failed), so the screen can resolve the state of
  /// its own op after a drain.
  Future<List<SyncOperation>> due();
}

/// [PmCloseRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioPmCloseRepository implements PmCloseRepository {
  const DioPmCloseRepository(this._dio, this.processor);

  final Dio _dio;

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262). Public so
  /// the host wiring is assertable: a repository handed a screen-local processor
  /// instead of the shared one would drain into a queue nothing else replays.
  final QueueDrainProcessor processor;

  @override
  Future<List<PmCloseEnt>> listWorkOrders() => _listData('/pm/workorders');

  @override
  Future<List<PmCloseEnt>> listAssets() => _listData('/pm/assets');

  @override
  Future<DrainReport> submitClose({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  }) async {
    final SyncOpIdentity identity = pmCloseOpIdentity(workOrderId);
    await processor.queue.enqueue(
      SyncOperation(
        id: opId,
        entityType: identity.entityType,
        kind: SyncOpKind.update,
        endpoint: identity.endpoint,
        method: 'POST',
        payload: body,
        createdAt: now,
      ),
    );
    return processor.drain();
  }

  @override
  Future<DrainReport> drain() => processor.drain();

  @override
  Future<List<SyncOperation>> due() => processor.queue.pending();

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows. A body
  /// that is not the expected `{ data: [...] }` shape yields an empty list (honest —
  /// the view renders honest-empty rather than crashing on an unexpected shape).
  Future<List<PmCloseEnt>> _listData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <PmCloseEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <PmCloseEnt>[];
    return <PmCloseEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
