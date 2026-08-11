// Data access for the mobile foreman acceptance queue (route `fm-accept`).
// money = NONE.
//
// READ — raw Dio, like pm_jobs / pm_checklist / st_grlist:
//   GET /acceptance-center            → the work-period queue (default ?type=period)
//   GET /acceptance-center?type=gr    → the goods-receipt (rejected-qty) queue
//   Both answer the B-014 paginated envelope `{ data, … }`
//   (apps/api/src/routes/subcon.ts L1125-1250).
//
//   Why raw Dio, not the generated typed client: the contract models every one of
//   these rows as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
//   declares NO fields and therefore DISCARDS `status` / `project_name` / `defect`
//   on deserialisation. Inventing contract fields is forbidden (PLAN.md §0), so this
//   reads the raw JSON maps off the shared Dio — the merged-screen precedent.
//
// WRITE — ONLINE, not queued, and PASS-ONLY. `POST /periods/{id}/inspect`
// (subcon.ts L798-925). The endpoint's reject half is withheld by this port
// (BLOCKERS.md B-297 item 1; the argument lives on [kInspectPassPayload]), so this
// interface has no way to express one.
//   This is the one place this slice differs from the pm_checkin / pm_checklist /
//   pm_notes offline-write precedent, and the reason is the SCREEN SHAPE, so it is
//   stated here rather than left implicit:
//
//   Those screens own ONE subject and show its own save state. This one is a LIST
//   whose rows are, by definition, the periods the server currently considers
//   un-inspected. The truth about a row after an action is the server's — a passed
//   period LEAVES the queue, a rejected one MOVES to the rejected tab — so the honest
//   confirmation is a re-read, which a queued (offline) write cannot produce. Worse,
//   the queue's replay-after-a-lost-response would meet the endpoint's own C3 guard
//   (subcon.ts L819-826: only delivered|inspecting is inspectable) and come back
//   409, which resolves to `permanentlyFailed` — i.e. an inspection that DID land
//   would be reported to the foreman as failed. Online + re-read cannot do that.
//
//   Replay safety of the door itself: the write is a guarded status flip re-applied
//   to the FINAL UPDATE's WHERE (subcon.ts L843-852 / L890-900, the B-149 optimistic
//   guard), so a duplicate self-rejects with 409 instead of double-inspecting.
//   money = NONE — no JV, no AP billing, no amount is read or sent. The payment of
//   an inspected period is `POST /periods/{id}/approve-payment` (subcon.ts L927+),
//   which this file does not reference.
import 'package:dio/dio.dart';

import 'fm_accept_agg.dart';

/// The honest outcome of one inspect POST.
enum FmInspectOutcome {
  /// The server durably accepted the inspection (2xx).
  ok,

  /// It did not. Network failure, or a rejection (incl. the 409 raised when another
  /// inspector already moved this period). Never reported as a success; the caller
  /// re-reads the queue so the row's TRUE status is what the foreman ends up seeing.
  failed,
}

/// Read the acceptance queue and post an inspection.
abstract class FmAcceptRepository {
  /// The work-period acceptance queue (delivered | inspecting | rejected).
  Future<List<FmAcceptEnt>> listPeriodQueue();

  /// The goods-receipt queue (receipts carrying a rejected quantity). Read-only —
  /// this screen has no endpoint that inspects a receipt (see [FmAcceptRow.actionable]).
  Future<List<FmAcceptEnt>> listGrQueue();

  /// PASS the work period [periodId].
  ///
  /// There is deliberately no reject counterpart on this interface: the reject half
  /// of the endpoint is withheld by this port ([kInspectPassPayload] carries the
  /// whole argument — `rejected` is terminal and there is no defect form to record
  /// WHY). Keeping the parameter would leave the irreversible door one argument
  /// away; removing it means no caller, present or future, can open it by accident.
  Future<FmInspectOutcome> inspectPass({required String periodId});
}

/// [FmAcceptRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioFmAcceptRepository implements FmAcceptRepository {
  const DioFmAcceptRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<FmAcceptEnt>> listPeriodQueue() =>
      _envelopeData('/acceptance-center');

  @override
  Future<List<FmAcceptEnt>> listGrQueue() => _envelopeData(
    '/acceptance-center',
    query: const <String, Object?>{'type': 'gr'},
  );

  @override
  Future<FmInspectOutcome> inspectPass({required String periodId}) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/periods/$periodId/inspect',
        // The one body this port can send. Never `reject` — see kInspectPassPayload.
        data: kInspectPassPayload,
      );
      final int? code = res.statusCode;
      // Only a real 2xx is a success. Anything else — including the 409 the C3
      // guard raises when the period already moved — is honestly a failure here.
      return code != null && code >= 200 && code < 300
          ? FmInspectOutcome.ok
          : FmInspectOutcome.failed;
    } on Object {
      return FmInspectOutcome.failed;
    }
  }

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows.
  Future<List<FmAcceptEnt>> _envelopeData(
    String path, {
    Map<String, Object?>? query,
  }) async {
    final Response<Object?> res = await _dio.get<Object?>(
      path,
      queryParameters: query,
    );
    final Object? body = res.data;
    if (body is! Map) return const <FmAcceptEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <FmAcceptEnt>[];
    return <FmAcceptEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
