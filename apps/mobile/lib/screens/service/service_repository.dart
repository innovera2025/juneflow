// Data access shared by the four mobile after-sales SERVICE screens
// (`srv-track` / `tech-jobs` / `srv-new` / `tech-close`). money = NONE.
//
// The endpoints are the SAME seven the merged web port reads/writes
// (apps/web/src/screens/sales/sales-service.tsx), all registered in
// apps/api/src/routes/sales-service.ts registerSalesServiceRoute L312-368:
//   GET  /sales/service                → the tenant's ticket register, newest-first,
//                                        inside the B-014 envelope `{ data, ... }`
//                                        (L314-318).
//   GET  /sales/service/:id            → one ticket, 404 outside the tenant (L320-324).
//   POST /sales/service                → create; `title` required, the server
//                                        allocates `no` and stamps opened_date
//                                        (L327-331).
//   POST /sales/service/:id/schedule   → received  → scheduled (L334-344).
//   POST /sales/service/:id/start      → scheduled → fixing    (L346-350).
//   POST /sales/service/:id/fix        → fixing    → fixed     (L352-356).
//   POST /sales/service/:id/close      → fixed     → closed    (L360-364).
//   GET  /me                           → the signed-in profile; `user.id` is what
//                                        scopes tech-jobs to MY tickets
//                                        (apps/api/src/routes/me.ts L46-51,
//                                        profile-data.ts serializeUser L25-33).
// The base URL already carries the /api/v1 prefix (AppEnv.apiBaseUrl), so the paths
// here are prefix-relative.
//
// Why raw Dio, not the generated typed client: the contract models a ticket as the
// OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO fields and
// therefore DISCARDS every real column on deserialisation — inventing contract fields
// is forbidden (PLAN.md §0). So, exactly as the merged web port reads
// Record<string, unknown> and every merged mobile screen reads raw maps, this reads
// the raw JSON off the shared Dio and lets service_agg.dart derive the display.
//
// WHY NOT THE OFFLINE QUEUE (a deliberate difference from pm_checkin / pm_checklist /
// pm_notes, stated up front). Those screens queue a last-write-wins SET of text
// columns, which replays safely. These writes do not:
//   * POST /sales/service is a CREATE with no client idempotency key — a replay
//     raises a SECOND ticket (the B-261 key contract exists for money writes and is
//     not declared on this route);
//   * the four transitions are one-shot flips whose predecessor is folded into the
//     UPDATE WHERE (sales-service.ts L282-288), so a replay of a move that ALREADY
//     succeeded answers 409 — which the level-(a) processor classifies as a permanent
//     failure and would report as a dead-lettered write even though the ticket did
//     advance. Reporting a successful move as failed is exactly the kind of dishonest
//     state BLOCKERS.md B-268 option (a) rules against.
// So these are online one-shot calls, and the screens show `failed` — never a
// "captured, will retry" promise the transport cannot keep.
import 'package:dio/dio.dart';

import 'service_agg.dart';

/// Read + write access to the tenant's service-ticket register.
abstract class ServiceRepository {
  /// The register as opaque wire rows (GET /sales/service), server order preserved.
  Future<List<ServiceEnt>> listTickets();

  /// One ticket as an opaque wire row, or null when it is not in this tenant (404).
  Future<ServiceEnt?> getTicket(String id);

  /// Create a ticket — POST /sales/service. [body] comes from
  /// service_agg.newTicketBody (real create keys only). Returns the CREATED row, so
  /// the screen can show the server-allocated `no` instead of inventing one. Throws
  /// on a non-2xx (400 blank title, 401 no tenant).
  Future<ServiceEnt?> createTicket(Map<String, Object?> body);

  /// Run one status action — POST /sales/service/:id/{op}. NO body: the schedule op
  /// accepts an optional assignee/date but neither screen has a picker, so nothing
  /// is originated here (BLOCKERS.md B-294). Throws on a non-2xx (404 gone, 409 the
  /// ticket already moved).
  Future<void> runTransition(String id, ServiceOp op);

  /// The signed-in profile (GET /me → `user.id` + `user.name`), or empty fields when
  /// it cannot be read. An empty id makes tech-jobs honest-empty rather than showing
  /// the whole tenant register under a "my jobs" title.
  Future<ServiceUser> currentUser();
}

/// [ServiceRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioServiceRepository implements ServiceRepository {
  const DioServiceRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<ServiceEnt>> listTickets() async {
    final Response<Object?> res = await _dio.get<Object?>('/sales/service');
    final Object? body = res.data;
    if (body is! Map) return const <ServiceEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <ServiceEnt>[];
    return <ServiceEnt>[
      for (final Object? item in data)
        if (item is Map) _asEnt(item),
    ];
  }

  @override
  Future<ServiceEnt?> getTicket(String id) async {
    try {
      final Response<Object?> res = await _dio.get<Object?>(
        '/sales/service/$id',
      );
      final Object? body = res.data;
      return body is Map ? _asEnt(body) : null;
    } on DioException catch (e) {
      // A missing ticket is an honest "no ticket" state, not a crash; anything else
      // propagates so it is not silently swallowed (the pr_action precedent).
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  @override
  Future<ServiceEnt?> createTicket(Map<String, Object?> body) async {
    final Response<Object?> res = await _dio.post<Object?>(
      '/sales/service',
      data: body,
    );
    final Object? created = res.data;
    return created is Map ? _asEnt(created) : null;
  }

  @override
  Future<void> runTransition(String id, ServiceOp op) async {
    await _dio.post<Object?>('/sales/service/$id/${serviceOpPath(op)}');
  }

  @override
  Future<ServiceUser> currentUser() async {
    try {
      final Response<Object?> res = await _dio.get<Object?>('/me');
      final Object? body = res.data;
      if (body is! Map) return const ServiceUser(id: '', name: '');
      return parseMeUser(_asEnt(body));
    } on Object {
      // No identity => tech-jobs renders honest-empty (assignedTo('') is empty)
      // and em-dashes the header, rather than claiming somebody else's jobs.
      return const ServiceUser(id: '', name: '');
    }
  }

  /// Re-key an untyped JSON map to the opaque-Entity shape the aggs consume.
  ServiceEnt _asEnt(Map<Object?, Object?> m) => m.map<String, Object?>(
    (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
  );
}
