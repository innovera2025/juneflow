// Data access for the mobile approvals inbox (route `inbox`). money = NONE.
//
// The endpoint is the same the web dashboard reads:
//   GET /dashboard/approvals-inbox → the caller's pending-and-actionable PR+PO+WO
//   docs (B-070 tiered), a B-014 list envelope `{ data, page, page_size, total }`
//   (apps/api/src/routes/dashboard.ts approvalsInbox). READ-ONLY. The base URL
//   already carries the /api/v1 prefix (AppEnv.apiBaseUrl), so the path here is
//   prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract models an inbox row as
// the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO
// fields and DISCARDS every real column on deserialisation — inventing contract
// fields is forbidden (PLAN.md §0). So, as the web port reads Record<string,
// unknown> and the pm_jobs / notif repos read raw maps, this reads the raw JSON off
// the shared Dio and lets approvals_inbox_agg.dart derive the display.
import 'package:dio/dio.dart';

import 'approvals_inbox_agg.dart';

/// Read access to the current caller's pending approvals inbox.
abstract class ApprovalsInboxRepository {
  /// The pending-and-actionable docs as opaque wire rows.
  Future<List<InboxEnt>> list();
}

/// [ApprovalsInboxRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioApprovalsInboxRepository implements ApprovalsInboxRepository {
  const DioApprovalsInboxRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<InboxEnt>> list() async {
    final Response<Object?> res = await _dio.get<Object?>(
      '/dashboard/approvals-inbox',
    );
    final Object? body = res.data;
    // The B-014 envelope's `data` array carries the rows; an unexpected shape
    // yields an empty list (honest — the view renders honest-empty, never crashes).
    if (body is! Map) return const <InboxEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <InboxEnt>[];
    return <InboxEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
