// Data access for the mobile PR detail (route `detail`). money = NONE to read.
//
// The endpoints are the same the merged web pr.form + the mobile approve/reject
// sheets read:
//   GET /pr/:id    → the PR detail (opaque Entity prWire + priced lines).
//   GET /projects  → the tenant's projects (B-014 envelope) — the id→name catalogue
//                    for the project-name join (the detail wire returns project_id
//                    only, a uuid; the web pr.form resolves it the same way).
//   (apps/api/src/routes/pr.ts + projects.ts). READ-ONLY. The base URL already
//   carries the /api/v1 prefix (AppEnv.apiBaseUrl), so the paths here are
//   prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract types /pr/:id and the
// project rows as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and DISCARDS the real columns on deserialisation — inventing
// contract fields is forbidden (PLAN.md §0). So, exactly as the web port reads
// Record<string, unknown> and the pr_action repo reads a raw map, this reads the raw
// JSON off the shared Dio and lets pr_detail_agg.dart derive the display.
import 'package:dio/dio.dart';

import 'pr_detail_agg.dart';

/// Read access to a single PR's detail plus the project catalogue for its name join.
abstract class PrDetailRepository {
  /// The PR detail as an opaque wire row, or null when it does not exist (404).
  Future<PrDetailEnt?> getPr(String id);

  /// The tenant's projects as opaque wire rows (the project_id → name source). This
  /// is BEST-EFFORT for the detail: a failure yields an empty list, so the project
  /// name simply em-dashes (never a raw uuid, never a crash of the whole detail).
  Future<List<PrDetailEnt>> listProjects();
}

/// [PrDetailRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioPrDetailRepository implements PrDetailRepository {
  const DioPrDetailRepository(this._dio);

  final Dio _dio;

  @override
  Future<PrDetailEnt?> getPr(String id) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('/pr/$id');
      final Object? body = res.data;
      if (body is! Map) return null;
      return body.map<String, Object?>(
        (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
      );
    } on DioException catch (e) {
      // A missing PR is an honest "no PR" state, not a crash; any other transport
      // error propagates so it is not silently swallowed.
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  @override
  Future<List<PrDetailEnt>> listProjects() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('/projects');
      final Object? body = res.data;
      if (body is! Map) return const <PrDetailEnt>[];
      final Object? data = body['data'];
      if (data is! List) return const <PrDetailEnt>[];
      return <PrDetailEnt>[
        for (final Object? item in data)
          if (item is Map)
            item.map<String, Object?>(
              (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
            ),
      ];
    } on DioException {
      // Best-effort name join — an unreachable /projects just em-dashes the name.
      return const <PrDetailEnt>[];
    }
  }
}
