// Data access for the mobile Notifications screen (route `notif`). money = NONE.
//
// The endpoints are the same the web notifications center + shell bell use:
//   GET  /notifications           → the session user's notifications (B-014
//                                    paginated envelope `{ data, page, ... }`).
//   POST /notifications/{id}/read → mark one read (ActionOk / 404).
// (apps/api/src/routes/notifications.ts). The base URL already carries the
// /api/v1 prefix (AppEnv.apiBaseUrl), so the paths here are prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract models a
// notification as the OPAQUE `Entity` (lib/api/generated/models/entity.dart),
// which declares NO fields and therefore DISCARDS id/type/ref/read/created_at on
// deserialisation — inventing contract fields is forbidden (PLAN.md §0). So, as
// the web port reads `Record<string, unknown>`, this reads the raw JSON maps off
// the shared Dio and lets notif_agg.dart derive display from the real columns.
import 'package:dio/dio.dart';

import 'notif_agg.dart';

/// Read + mark-read access to the current user's notifications.
abstract class NotificationsRepository {
  /// The session user's notifications as opaque wire rows.
  Future<List<NotifEnt>> list();

  /// Mark one notification read.
  Future<void> markRead(String id);
}

/// [NotificationsRepository] over the app's shared Dio (the generated client's
/// own transport, so it inherits the auth interceptor + tenant scope).
class DioNotificationsRepository implements NotificationsRepository {
  const DioNotificationsRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<NotifEnt>> list() async {
    final Response<Object?> res = await _dio.get<Object?>('/notifications');
    final Object? body = res.data;
    if (body is! Map) return const <NotifEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <NotifEnt>[];
    return <NotifEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<void> markRead(String id) async {
    await _dio.post<Object?>('/notifications/$id/read');
  }
}
