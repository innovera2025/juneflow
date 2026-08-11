// Data access for the mobile quick-PR screen (route `field-pr`). money = SERVER.
//
// READ — raw Dio, like pm_jobs / pm_notes / st_grlist:
//   GET /boq             (boq.ts L315-359)
//   GET /boq/{id}/items  (boq.ts L466-489)
//   Both answer the B-014 paginated envelope `{ data, … }`.
//
//   Why raw Dio, not the generated typed client: the contract models both rows as the
//   OPAQUE `Entity` (lib/api/generated/models/entity.dart), which declares NO fields
//   and therefore DISCARDS `no` / `project_id` / `name` / `unit` / `remain_qty` on
//   deserialisation. Inventing contract fields is forbidden (PLAN.md §0).
//
// WRITE — ONLINE ONLY. NOT enrolled in the offline queue, and this is the whole
// reason the decision is documented here rather than assumed:
//   POST /pr             (pr.ts L355-467)  — creates the PR + its line
//   POST /pr/{id}/submit (pr.ts L506-540)  — draft → pending
//
//   `pr.no` is `text().notNull()` with NO unique index (packages/db/src/schema/boq.ts
//   prs.no). The duplicate-number check inside POST /pr is a read of the tenant's
//   existing PRs followed by an insert (pr.ts L399-405) — a race, not a constraint.
//   So a queued create replayed after a lost response would not be rejected by the
//   database; it would create a SECOND purchase requisition for the same site
//   request. That is a real duplicate-document defect, not a cosmetic one, and no
//   client-side dedup can close it: the fix is the B-261 client-idempotency-key
//   contract applied to POST /pr (orch-A + Wei work — BLOCKERS.md B-295). Until then
//   this screen submits online and surfaces a real failure honestly.
//
//   The SUBMIT step is separately safe to retry: it is a guarded transition that only
//   a `draft` PR passes (pr.ts L518-523), so a repeat answers 409 rather than
//   advancing anything twice. That is why the draft-only retry path exists on the
//   screen — it re-submits the EXISTING id and never re-creates.
//
//   No JV is posted by either call: the GL entry for a PR happens at approve, not at
//   create (pr.ts header). The `amount` on the 201 body is the SERVER's own sum over
//   the created lines (pr.ts sumLines) — the only monetary figure this screen shows.
import 'package:dio/dio.dart';

import 'field_pr_agg.dart';

/// The outcome of `POST /pr`: the created PR row, or null when the create did not
/// succeed. Never a synthesised row.
typedef FieldPrCreateResult = FieldPrEnt?;

/// Read the BOQ catalogue and create + submit the PR.
abstract class FieldPrRepository {
  /// The tenant's BOQ documents as opaque wire rows.
  Future<List<FieldPrEnt>> listBoqDocs();

  /// One BOQ document's priced lines as opaque wire rows.
  Future<List<FieldPrEnt>> listBoqItems(String boqId);

  /// Create the PR. Returns the created row (which carries the server-computed
  /// `amount`), or null when the server did not accept it.
  Future<FieldPrCreateResult> createPr(Map<String, Object?> body);

  /// Move an existing draft PR into the approval chain. True on a durable 2xx.
  Future<bool> submitPr(String prId);
}

/// [FieldPrRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioFieldPrRepository implements FieldPrRepository {
  const DioFieldPrRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<FieldPrEnt>> listBoqDocs() => _envelopeData('/boq');

  @override
  Future<List<FieldPrEnt>> listBoqItems(String boqId) =>
      _envelopeData('/boq/$boqId/items');

  @override
  Future<FieldPrCreateResult> createPr(Map<String, Object?> body) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>('/pr', data: body);
      final int? code = res.statusCode;
      if (code == null || code < 200 || code >= 300) return null;
      final Object? data = res.data;
      if (data is! Map) return null;
      return data.map<String, Object?>(
        (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
      );
    } on Object {
      // Includes the 409 DUPLICATE_CODE a colliding `no` raises — honestly a
      // failure of THIS create, with nothing created.
      return null;
    }
  }

  @override
  Future<bool> submitPr(String prId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/pr/$prId/submit',
      );
      final int? code = res.statusCode;
      return code != null && code >= 200 && code < 300;
    } on Object {
      return false;
    }
  }

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows.
  Future<List<FieldPrEnt>> _envelopeData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <FieldPrEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <FieldPrEnt>[];
    return <FieldPrEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
