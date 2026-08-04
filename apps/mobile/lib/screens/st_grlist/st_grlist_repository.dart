// Data access for the mobile store "awaiting PO receipt" list (route
// `st-grlist`). money = NONE (read-only).
//
// The endpoints are the ones the merged web procurement port reads:
//   GET /po       → the tenant's POs (po-wo.jsx POList; B-014 paginated
//                   envelope `{ data, ... }`). The receivable (approved) ones
//                   are the awaiting-receipt list (st_grlist_agg.dart).
//   GET /vendors  → the tenant's vendors, to resolve each PO's `vendor_id` FK
//                   to a real vendor name (vendors.ts toWire `name`).
// (apps/api/src/routes/po.ts, vendors.ts). The base URL already carries the
// /api/v1 prefix (AppEnv.apiBaseUrl), so the paths here are prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract models both a PO and
// a vendor as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and therefore DISCARDS id/no/vendor_id/status on
// deserialisation — inventing contract fields is forbidden (PLAN.md §0). So, as
// the web port reads `Record<string, unknown>`, this reads the raw JSON maps off
// the shared Dio and lets st_grlist_agg.dart derive display from the real columns.
import 'package:dio/dio.dart';

import 'st_grlist_agg.dart';

/// Read access to the awaiting-receipt POs and the vendors that name them.
abstract class StGrListRepository {
  /// The tenant's POs as opaque wire rows (GET /po).
  Future<List<StGrEnt>> listPos();

  /// The tenant's vendors as opaque wire rows (GET /vendors).
  Future<List<StGrEnt>> listVendors();
}

/// [StGrListRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioStGrListRepository implements StGrListRepository {
  const DioStGrListRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<StGrEnt>> listPos() => _envelopeData('/po');

  @override
  Future<List<StGrEnt>> listVendors() => _envelopeData('/vendors');

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows.
  Future<List<StGrEnt>> _envelopeData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <StGrEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <StGrEnt>[];
    return <StGrEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
