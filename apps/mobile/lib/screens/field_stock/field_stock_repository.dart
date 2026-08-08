// Data access for the mobile on-site material-issue screen (route `field-stock`).
// money = SERVER — the write sends no monetary value at all (see
// field_stock_agg.buildIssuePayload, which is the whole money surface).
//
// READ — raw Dio, like field_gr / st_grlist / pm_close. All three answer the B-014
// paginated envelope `{ data, … }`:
//   GET /inventory/warehouses  (inventory.ts listWarehouses) — the eyebrow subject
//                               and the write's `from_warehouse_id`.
//   GET /inventory/stock?warehouse_id=…  (listStock) — the issuable balances:
//                               item_code / item_name / unit / on_hand, filtered
//                               SERVER-side to the chosen warehouse.
//   GET /projects              (projects.ts) — the used-with subject and the
//                               write's REQUIRED `project_id`.
//
// Why raw Dio, not the generated typed client: the contract models all three as the
// OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO fields
// and therefore DISCARDS item_name / on_hand / name on deserialisation. Inventing
// contract fields is forbidden (PLAN.md §0).
//
// Why the warehouse filter is a SERVER query parameter and not a client-side
// `where`: listStock takes `?warehouse_id` and applies it inside the tenant-scoped
// ledger read. Fetching every warehouse's balances and filtering here would pull
// the whole tenant's stock over a site connection to display one shelf.
//
// ---------------------------------------------------------------------------
// WRITE — OFFLINE-ENROLLED, and the safety is a property of the CURRENT server
// ---------------------------------------------------------------------------
//   POST /inventory/issues  (inventory.ts createIssue L1105-1348)
//
// This is a HEAVIER write than st-receive's. In ONE transaction it inserts the
// `material_issue` header, its `issue_line` children, ONE `stock_ledger` row per
// line at −qty, AND posts a balanced JV (Dr 1140 WIP / Cr 5020 materials-cost) for
// the server-computed value. So a duplicate is not a duplicate record — it is
// material that never left the warehouse plus a second JV.
//
// A replay is safe because of B-312, verified against source rather than taken on
// trust:
//   * the key is parsed FIRST, before any validation/read/write, by the parser
//     shared with POST /gr and POST /labor/attendance (readIdempotencyKey);
//   * `material_issue_idempotency_uq` is a REAL partial unique index — confirmed in
//     packages/db/drizzle/0059_material_issue_idempotency_key.sql, not merely
//     asserted in a blocker row;
//   * the 23505 is caught and gated on the CONSTRAINT NAME (B-263), not on the
//     error class, so an unrelated unique violation cannot be swallowed as a replay;
//   * the original is returned WITHOUT a second write (sendExistingIssue re-reads
//     the lines and the ORIGINAL jv number).
//
// And the load-bearing extra this endpoint has that /gr does not: the pre-check is
// HOISTED ABOVE the transaction, because the in-tx negative-stock guard would
// otherwise run FIRST on a replay and 409 for material that really did leave —
// "on-hand 0, issue 800" — which sync_processor dead-letters PERMANENTLY as a 4xx.
// That ordering is precisely what makes this screen safe to enqueue. The CLIENT
// half of that contract — that a replay re-posts the byte-identical body under the
// same key, and that a dead-letter is never replayed — is asserted against the REAL
// queue in field_stock_screen_test.dart, group "repository over the REAL queue +
// processor".
//
// The queue replays `op.payload` VERBATIM and does not inject anything, so the
// `idempotency_key` must be inside the body — it is written there by
// buildIssuePayload from the SAME string as the SyncOperation id, threaded through
// one parameter so the two cannot drift.
//
// Contrast field-pr, which is deliberately ONLINE-ONLY: `pr.no` has no unique index
// and POST /pr dedups with a read-then-insert race (B-295). The same reasoning
// lands the other way here, because the index is real.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'field_stock_agg.dart';

/// What ONE WAREHOUSE's queued material issue looks like in the shared queue.
///
/// The ONE definition of this write's identity: [DioFieldStockRepository.submitIssue]
/// builds its [SyncOperation] from it, and the screen matches its own still-pending
/// issue with it after a remount (B-330), so the matcher cannot drift from the
/// builder.
///
/// ---------------------------------------------------------------------------
/// WHY THE ANCHOR IS `from_warehouse_id` AND NOT `project_id`, AND NOT BOTH
/// ---------------------------------------------------------------------------
/// Like `POST /gr`, `POST /inventory/issues` is RECORD-AGNOSTIC — one path for every
/// warehouse and every project — so the endpoint pins nothing and the anchor has to
/// come out of the body. The body offers two candidates, and they are not
/// interchangeable:
///
///   * `from_warehouse_id` IS THE SCREEN'S SUBJECT. It comes from the route
///     (`FieldStockScreenHost.warehouseId`, or the register's newest warehouse when
///     the tab is entered bare), it is the header eyebrow, it decides which shelf's
///     balances are listed, and NOTHING in the mount can change it. It is therefore
///     the same value on the mount that queued the op and on the mount that comes
///     back to adopt it — which is the whole requirement of an anchor.
///
///   * `project_id` IS AN ATTRIBUTION, and it is NOT STABLE ACROSS A REMOUNT. The
///     screen defaults it to the tenant's PRIMARY project on every load
///     (`_apply` -> `selectProject`) and the storekeeper may re-pick it before
///     submitting. So a basket issued against a NON-default project would come back
///     from a remount carrying the primary project's id, the identity would not
///     match its own queued op, and the screen would mint a SECOND key — reopening
///     the exact double-post (double stock cut + double JV) this file exists to
///     close, on the very path that most looks fixed. Including it "for precision"
///     is not a tightening; it is the defect wearing a narrower anchor.
///
/// Matching on `entityType` + `endpoint` ALONE would be the mirror-image bug, and it
/// is the worse of the two: an op queued against warehouse A would be adopted by a
/// mount showing warehouse B, so B's basket is never sent and the user is shown A's
/// outstanding write as if it were their own. A duplicate is a duplicate; issuing
/// the wrong shelf's material is a wrong write. Hence exactly ONE anchor entry.
SyncOpIdentity fieldStockOpIdentity(String fromWarehouseId) => SyncOpIdentity(
  entityType: 'inventory_issue',
  endpoint: '/inventory/issues',
  payloadAnchor: <String, Object?>{kIssueFromWarehouseField: fromWarehouseId},
);

/// Read the warehouse / stock / project subjects, and enqueue + drain the issue.
abstract class FieldStockRepository {
  /// The tenant's warehouses as opaque wire rows (GET /inventory/warehouses).
  Future<List<FieldStockEnt>> listWarehouses();

  /// The issuable balances of [warehouseId] (GET /inventory/stock?warehouse_id=…).
  ///
  /// Honest-empty when the ledger holds nothing for that warehouse — the server
  /// synthesises no zero rows, and neither does this.
  Future<List<FieldStockEnt>> listStock(String warehouseId);

  /// The tenant's projects as opaque wire rows (GET /projects), in ENTRY order.
  Future<List<FieldStockEnt>> listProjects();

  /// Enqueue the material issue of [picks] from [warehouseId] against [projectId]
  /// under the stable client idempotency key [opId] (reused across manual retries
  /// so a re-tap never enqueues a second issue), stamped [now], then drain.
  Future<DrainReport> submitIssue({
    required String projectId,
    required String warehouseId,
    required List<FieldStockPick> picks,
    required String opId,
    required DateTime now,
  });

  /// Re-drain without enqueuing — the manual retry and the on-mount trigger.
  Future<DrainReport> drain();

  /// The ops still due (pending + failed), so the screen can resolve its own op.
  Future<List<SyncOperation>> due();
}

/// [FieldStockRepository] over the app's shared Dio (auth + tenant scope) for the
/// reads and the app's shared offline queue + drain processor for the write.
///
/// Taking the SHARED processor rather than building one here is what lets a queued
/// issue drain on app resume, not only while this screen is mounted.
class DioFieldStockRepository implements FieldStockRepository {
  const DioFieldStockRepository(this._dio, this.processor);

  final Dio _dio;

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262).
  /// Public so the host wiring stays assertable.
  final QueueDrainProcessor processor;

  @override
  Future<List<FieldStockEnt>> listWarehouses() =>
      _listData('/inventory/warehouses');

  @override
  Future<List<FieldStockEnt>> listStock(String warehouseId) => _listData(
    '/inventory/stock',
    query: <String, Object?>{'warehouse_id': warehouseId},
  );

  @override
  Future<List<FieldStockEnt>> listProjects() => _listData('/projects');

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows. A body
  /// that is not the expected `{ data: [...] }` shape yields an empty list, so the
  /// view renders honest-empty rather than crashing on an unexpected shape.
  Future<List<FieldStockEnt>> _listData(
    String path, {
    Map<String, Object?>? query,
  }) async {
    final Response<Object?> res = await _dio.get<Object?>(
      path,
      queryParameters: query,
    );
    final Object? body = res.data;
    if (body is! Map) return const <FieldStockEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <FieldStockEnt>[];
    return <FieldStockEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<DrainReport> submitIssue({
    required String projectId,
    required String warehouseId,
    required List<FieldStockPick> picks,
    required String opId,
    required DateTime now,
  }) async {
    // Built from the SAME identity the screen matches with, so the enqueue and the
    // adoption cannot drift apart (the st-receive / pm-* precedent).
    final SyncOpIdentity identity = fieldStockOpIdentity(warehouseId);
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: identity.entityType,
      kind: SyncOpKind.create,
      endpoint: identity.endpoint,
      method: 'POST',
      // The B-261 contract: the body's `idempotency_key` IS the op id, so a replay
      // of this exact payload resolves to the ORIGINAL issue instead of posting a
      // second JV and decrementing the ledger twice (B-312).
      payload: buildIssuePayload(
        projectId: projectId,
        fromWarehouseId: warehouseId,
        picks: picks,
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
