// Data access for the mobile Sales CRM screen (route `sales-crm`). money = NONE.
//
// The endpoint is the same the web CRM kanban reads:
//   GET /sales/leads → the tenant's sales-lead register (B-014 paginated envelope
//                      `{ data, page, ... }`, ordered newest-first server-side).
// (apps/api/src/routes/land-sales.ts listLeads). The base URL already carries the
// /api/v1 prefix (AppEnv.apiBaseUrl), so the path here is prefix-relative. This is a
// READ-ONLY screen — no write endpoint is wired (the P3 add-lead / advance-stage
// writes are out of this read screen's scope).
//
// Why raw Dio, not the generated typed client: the contract models a lead as the
// OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO fields
// and therefore DISCARDS name/stage/warmth/… on deserialisation — inventing contract
// fields is forbidden (PLAN.md §0). So, exactly as the web port reads
// `Record<string, unknown>` and the mobile notif screen reads raw maps, this reads
// the raw JSON maps off the shared Dio and lets sales_crm_agg.dart derive display
// from the real columns.
import 'package:dio/dio.dart';

import 'sales_crm_agg.dart';

/// Read access to the tenant's sales-lead register.
abstract class SalesLeadsRepository {
  /// The tenant's CRM leads as opaque wire rows (newest-first, server-ordered).
  Future<List<LeadEnt>> list();
}

/// [SalesLeadsRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioSalesLeadsRepository implements SalesLeadsRepository {
  const DioSalesLeadsRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<LeadEnt>> list() async {
    final Response<Object?> res = await _dio.get<Object?>('/sales/leads');
    final Object? body = res.data;
    if (body is! Map) return const <LeadEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <LeadEnt>[];
    return <LeadEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
