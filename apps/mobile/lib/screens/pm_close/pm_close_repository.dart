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
// WHY THERE IS NO WRITE METHOD HERE. `POST /pm/workorders/:id/close` exists and this
// is the screen named after it, so its absence is a decision, not an oversight:
//
//   * The endpoint writes only the close fields the BODY carries — cause/fix/advice
//     and signature → customer_sign (pm.ts L785-793). pm-notes (step 2 of this flow)
//     already saved cause/fix/advice through this same endpoint, and this screen has
//     no form for them.
//   * The one field left is the signature, and it cannot be captured: pubspec.yaml
//     carries no signature package, adding a native dependency is a Wei-level stack
//     decision, and the TEXT column's encoding is undefined — nothing in the repo
//     reads customer_sign's CONTENT, only whether it is empty (web wo-rows.ts L206,
//     pm_jobs_agg). Inventing an encoding for a column two platforms share is a
//     contract decision, not a screen decision. BLOCKERS.md B-288.
//   * So the body would be empty. The handler treats that as "a pure close": it
//     resolves the work order, writes NOTHING (`Object.keys(set).length > 0` is
//     false, pm.ts L796), fires the no-op `lineNotifyStub` (B-108b), and returns 200
//     with the row unchanged. The request would leave the database byte-identical.
//
// Queueing that through the offline sync queue — the way pm-checkin / pm-checklist /
// pm-notes queue their real writes — would manufacture a durable operation that
// changes nothing, and a "saved"/"queued" badge for it would report success for a
// write that never existed. So no SyncOperation is created and the sync queue is not
// imported: the screen's close affordance ships disabled instead (see the screen).
//
// Why raw Dio, not the generated typed client: the contract models a work order and
// an asset as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and therefore DISCARDS every real column on deserialisation —
// inventing contract fields is forbidden (PLAN.md §0). So this reads the raw JSON
// maps off the shared Dio, as the web ports read `Record<string, unknown>`.
import 'package:dio/dio.dart';

import 'pm_close_agg.dart';

/// Read access to the current tenant's PM work orders + assets.
///
/// Deliberately has no mutating method — see the file header (B-288).
abstract class PmCloseRepository {
  /// The tenant's PM work orders as opaque wire rows (GET /pm/workorders).
  Future<List<PmCloseEnt>> listWorkOrders();

  /// The tenant's PM assets as opaque wire rows (GET /pm/assets) — the summary's
  /// asset name/code join source.
  Future<List<PmCloseEnt>> listAssets();
}

/// [PmCloseRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioPmCloseRepository implements PmCloseRepository {
  const DioPmCloseRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<PmCloseEnt>> listWorkOrders() => _listData('/pm/workorders');

  @override
  Future<List<PmCloseEnt>> listAssets() => _listData('/pm/assets');

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
