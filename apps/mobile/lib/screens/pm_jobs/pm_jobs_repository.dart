// Data access for the mobile "my PM jobs" screen (route `pm-jobs`). money = NONE.
//
// The endpoints are the same the web PM screens read:
//   GET /pm/workorders → the tenant's PM work orders (B-014 paginated envelope
//                        `{ data, page, ... }`, apps/api/src/routes/pm.ts).
//   GET /pm/assets     → the tenant's PM assets (same envelope) — the join source
//                        for each WO's display name + site + next-due.
// Both are READ-ONLY (this screen never mutates). The base URL already carries the
// /api/v1 prefix (AppEnv.apiBaseUrl), so the paths here are prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract models a work order /
// asset as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and therefore DISCARDS every real column on deserialisation —
// inventing contract fields is forbidden (PLAN.md §0). So, as the web port reads
// `Record<string, unknown>`, this reads the raw JSON maps off the shared Dio and
// lets pm_jobs_agg.dart derive the display from the real columns.
import 'package:dio/dio.dart';

import 'pm_jobs_agg.dart';

/// Read access to the current tenant's PM work orders + assets.
abstract class PmJobsRepository {
  /// The tenant's PM work orders as opaque wire rows.
  Future<List<PmEnt>> listWorkOrders();

  /// The tenant's PM assets as opaque wire rows (the WO name/site/due join source).
  Future<List<PmEnt>> listAssets();
}

/// [PmJobsRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioPmJobsRepository implements PmJobsRepository {
  const DioPmJobsRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<PmEnt>> listWorkOrders() => _listData('/pm/workorders');

  @override
  Future<List<PmEnt>> listAssets() => _listData('/pm/assets');

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows. A body
  /// that is not the expected `{ data: [...] }` shape yields an empty list (honest
  /// — the view renders honest-empty rather than crashing on an unexpected shape).
  Future<List<PmEnt>> _listData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <PmEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <PmEnt>[];
    return <PmEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
