// Data access for the mobile PR approve / reject action sheets (routes
// `approve`, `reject`). authority = SERVER.
//
// The endpoints are the SAME the merged web pr.form uses
// (apps/web/src/screens/pr/use-pr-form.ts):
//   GET  /pr/{id}          → the PR detail (opaque Entity + priced lines).
//   POST /pr/{id}/approve  → pending → approved. PATH ID ONLY — no body. The
//                            tiered approval (B-070) + any money is the SERVER's;
//                            the app never sends a decision, amount or tier.
//   POST /pr/{id}/reject   → pending → rejected. Body { reason } — reason REQUIRED
//                            (pr.ts 400 when blank). The app sends ONLY the reason.
// (apps/api/src/routes/pr.ts). The base URL already carries the /api/v1 prefix
// (AppEnv.apiBaseUrl), so the paths here are prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract types /pr/{id} as the
// OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO fields
// and DISCARDS no/amount/status on deserialisation — inventing contract fields is
// forbidden (PLAN.md §0). So, exactly as the web port reads Record<string,unknown>
// and the mobile notif repo reads raw maps, this reads the raw JSON off the shared
// Dio and lets pr_action_agg.dart derive the display from the real columns.
import 'package:dio/dio.dart';

import 'pr_action_agg.dart';

/// Read + act access to a single PR from the approver's sheets.
abstract class PrActionRepository {
  /// The PR detail as an opaque wire row, or null when it does not exist (404).
  Future<PrEnt?> getPr(String id);

  /// Approve the PR — POST /pr/{id}/approve (path id only, no body). Throws on a
  /// non-2xx (403 under-tier, 409 not-pending, 404 gone) so the sheet can react.
  Future<void> approve(String id);

  /// Reject the PR — POST /pr/{id}/reject { reason } (reason REQUIRED). Throws on
  /// a non-2xx (400 blank reason, 403 under-tier, 409 not-pending, 404 gone).
  Future<void> reject(String id, String reason);
}

/// [PrActionRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioPrActionRepository implements PrActionRepository {
  const DioPrActionRepository(this._dio);

  final Dio _dio;

  @override
  Future<PrEnt?> getPr(String id) async {
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
  Future<void> approve(String id) async {
    // No body: the approval decision, amount and tier are the SERVER's (B-070).
    await _dio.post<Object?>('/pr/$id/approve');
  }

  @override
  Future<void> reject(String id, String reason) async {
    await _dio.post<Object?>(
      '/pr/$id/reject',
      data: <String, Object?>{'reason': reason},
    );
  }
}
