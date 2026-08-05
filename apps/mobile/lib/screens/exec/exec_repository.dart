// Data access for the mobile executive dashboard (route `exec`). READ-ONLY —
// this screen performs no write at all, so it never touches the offline queue.
//
// THREE reads, each verified live against the registering route this round:
//
//   GET /dashboard/summary          apps/api/src/routes/dashboard.ts L860
//     Read for ONE field: `project_id`, the caller's primary project (the handler
//     resolves it when no ?project_id is passed). It scopes the EVM read below —
//     see exec_agg.parseSummaryProjectId for why none of its budget figures may
//     be displayed on a screen whose slots are all sales/cash figures.
//
//   GET /boq/reports/evm            apps/api/src/routes/boq-reports.ts L519
//     The S-curve. Returns a BARE object `{ series, spi, cpi, currency_code }` —
//     NOT a B-014 list envelope — so the array is read from `series`, not `data`.
//     Requested with ?project_id so the series belongs to one project: without it
//     loadEvmSeries returns every owned project's snapshots merged (evm-series.ts
//     L49), which would interleave two projects under one period key.
//
//   GET /dashboard/approvals-inbox  dashboard.ts L862
//     The approvals section. The rows are parsed by the merged inbox screen's own
//     `approvals_inbox_agg.parseInbox` — one payload, ONE parser, so the two
//     screens can never drift on what a row means.
//
//     The GET itself is local rather than delegated to
//     DioApprovalsInboxRepository.list(), for one reason: this screen renders the
//     envelope's `total` in its section title, and `list()` returns only the
//     `data` array — the total is discarded before it can be read. Widening that
//     merged repository was rejected as a MERGE hazard: feature/mobile-inbox-detail
//     is editing approvals_inbox_repository.dart concurrently this round. So the
//     transport read (unwrap `data` + `total` from the B-014 envelope) is
//     duplicated here; the PARSING — the part that could drift semantically — is
//     not.
//
// Why raw Dio rather than the generated typed client (the merged-screen rule):
// the contract models these payloads as the OPAQUE `Entity`
// (lib/api/generated/models/entity.dart), which declares NO fields and therefore
// DISCARDS every real column on deserialisation. Inventing contract fields is
// forbidden (PLAN.md §0), so the raw JSON is read off the shared Dio — which is
// the generated client's own transport, so these reads still inherit the auth
// interceptor and tenant scope.
import 'package:dio/dio.dart';

import '../approvals_inbox/approvals_inbox_agg.dart';
import 'exec_agg.dart';

/// Read access to the three executive-dashboard feeds.
abstract class ExecRepository {
  /// `GET /dashboard/summary` as an opaque object, or null when unreadable.
  Future<ExecEnt?> summary();

  /// The `series` array of `GET /boq/reports/evm`, scoped to [projectId] when one
  /// is known. Opaque rows; the agg parses them.
  Future<List<ExecEnt>> evmSeries(String? projectId);

  /// The caller's pending-and-actionable approval docs: the envelope's rows AND
  /// its own `total`, which is the count the section title publishes.
  Future<ExecApprovals> approvals();
}

/// [ExecRepository] over the app's shared Dio.
class DioExecRepository implements ExecRepository {
  const DioExecRepository(this._dio);

  final Dio _dio;

  @override
  Future<ExecEnt?> summary() async {
    final Response<Object?> res = await _dio.get<Object?>('/dashboard/summary');
    final Object? body = res.data;
    if (body is! Map) return null;
    return body.map<String, Object?>(
      (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
    );
  }

  @override
  Future<List<ExecEnt>> evmSeries(String? projectId) async {
    final Response<Object?> res = await _dio.get<Object?>(
      '/boq/reports/evm',
      // Omitted entirely when unknown — an empty/blank project_id would be parsed
      // by the handler as "no filter" anyway, but sending nothing is the honest
      // request (parseUuid treats a blank string as absent, boq-reports.ts).
      queryParameters: projectId == null
          ? null
          : <String, Object?>{'project_id': projectId},
    );
    final Object? body = res.data;
    if (body is! Map) return const <ExecEnt>[];
    // This endpoint answers with a bare object keyed `series` (no B-014 envelope).
    final Object? series = body['series'];
    if (series is! List) return const <ExecEnt>[];
    return <ExecEnt>[
      for (final Object? row in series)
        if (row is Map)
          row.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<ExecApprovals> approvals() async {
    final Response<Object?> res = await _dio.get<Object?>(
      '/dashboard/approvals-inbox',
    );
    final Object? body = res.data;
    // An unexpected shape yields honest-empty with an UNKNOWN total — never a
    // zero, which would read as a real "nothing is awaiting you".
    if (body is! Map) return kEmptyExecApprovals;
    final ExecEnt env = body.map<String, Object?>(
      (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
    );
    final Object? data = env['data'];
    return ExecApprovals(
      rows: <InboxEnt>[
        if (data is List)
          for (final Object? item in data)
            if (item is Map)
              item.map<String, Object?>(
                (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
              ),
      ],
      // The SERVER's own count, read straight off the envelope.
      total: parseEnvelopeTotal(env),
    );
  }
}
