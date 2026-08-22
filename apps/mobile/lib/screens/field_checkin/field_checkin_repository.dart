// Data access for the mobile labour check-in (route `field-checkin`). money = NONE
// directly, but attendance is what payroll multiplies, so both writes go through the
// same offline queue + idempotency discipline the other write screens use.
//
// READS use raw Dio, like every other mobile repository: the contract types these
// rows as the opaque `Entity`, whose generated Dart model declares no fields and
// discards every real column on deserialisation, and inventing contract fields is
// forbidden (PLAN.md §0). See approvals_inbox_repository.dart for the same note.
//   GET /me               -> the caller (to find which worker they are)
//   GET /labor/workers    -> the roster; the row with user_id == caller is "me"
//   GET /labor/attendance -> the register; today's row decides the next action
//
// WRITES are enqueued as durable SyncOperations and replayed by the shared level-(a)
// QueueDrainProcessor, the pm_checkin precedent (B-242). The server stays the sole
// authority — the client sends what it observed and computes nothing:
//   POST /labor/attendance           { worker_id, day, idempotency_key,
//                                      checked_in_at, checkin_lat, checkin_lng }
//   POST /labor/attendance/checkout  { worker_id, day, check_in_key,
//                                      checked_out_at, checkout_lat, checkout_lng }
//
// The key is DETERMINISTIC (field_checkin_agg.checkinKey): the checkout has to find
// the check-in row by (worker_id, day, idempotency_key) and that key is not on the
// attendance wire, so a random one would be unrecoverable after a restart.
//
// GPS honesty: the screen obtains a REAL fix before calling either write. A denied /
// disabled / no-fix outcome sends NO coordinate at all — the endpoint takes lat and
// lng together or not at all (labor.ts optCoordPair) and a fabricated pair would be
// a lie about where somebody was standing.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'field_checkin_agg.dart';

/// Read access to everything the screen needs to know before it offers a button.
abstract class FieldCheckinReadRepository {
  /// GET /me — the caller, as an opaque wire object.
  Future<WireRow?> me();

  /// GET /labor/workers — the tenant roster as opaque wire rows.
  Future<List<WireRow>> workers();

  /// GET /labor/attendance — the tenant register as opaque wire rows.
  Future<List<WireRow>> attendance();
}

/// Write access: enqueue a check-in or a check-out and drive the drain.
abstract class FieldCheckinWriteRepository {
  /// Enqueue the check-in for [workerId] on [day], stamped [checkedInAt], with the
  /// REAL coordinate [fix] (null when no fix could be obtained — then no coordinate
  /// is sent at all). Returns the drain report.
  Future<DrainReport> submitCheckIn({
    required String workerId,
    required String day,
    required DateTime checkedInAt,
    ({double lat, double lng})? fix,
  });

  /// Enqueue the check-out that closes the SAME row (found by the deterministic
  /// check-in key), stamped [checkedOutAt].
  Future<DrainReport> submitCheckOut({
    required String workerId,
    required String day,
    required DateTime checkedOutAt,
    ({double lat, double lng})? fix,
  });

  /// Re-drain without enqueuing — the manual retry and the on-mount trigger.
  Future<DrainReport> drain();

  /// The ops still queued, so the screen can resolve its own op's outcome.
  Future<List<SyncOperation>> due();
}

/// The queue identity of a check-in write. One definition, used by the enqueue and
/// by the screen's own pending-op matcher, so the two cannot drift apart (B-330).
SyncOpIdentity fieldCheckinOpIdentity() => const SyncOpIdentity(
  entityType: 'labor_checkin',
  endpoint: '/labor/attendance',
);

/// The queue identity of a check-out write.
SyncOpIdentity fieldCheckoutOpIdentity() => const SyncOpIdentity(
  entityType: 'labor_checkout',
  endpoint: '/labor/attendance/checkout',
);

/// Reads over the app's shared Dio (so they inherit the auth interceptor + tenant
/// scope). An unexpected shape yields an empty result — the screen renders its
/// honest "nothing to act on" state and never crashes.
class DioFieldCheckinReadRepository implements FieldCheckinReadRepository {
  const DioFieldCheckinReadRepository(this._dio);

  final Dio _dio;

  Future<List<WireRow>> _list(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <WireRow>[];
    final Object? data = body['data'];
    if (data is! List) return const <WireRow>[];
    return <WireRow>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }

  @override
  Future<WireRow?> me() async {
    final Response<Object?> res = await _dio.get<Object?>('/me');
    final Object? body = res.data;
    if (body is! Map) return null;
    return body.map<String, Object?>(
      (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
    );
  }

  @override
  Future<List<WireRow>> workers() => _list('/labor/workers');

  @override
  Future<List<WireRow>> attendance() => _list('/labor/attendance');
}

/// Writes over the shared offline queue + its (a) processor.
class QueueBackedFieldCheckinRepository implements FieldCheckinWriteRepository {
  const QueueBackedFieldCheckinRepository(this.processor);

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262). Public
  /// so the host wiring stays assertable.
  final QueueDrainProcessor processor;

  @override
  Future<DrainReport> submitCheckIn({
    required String workerId,
    required String day,
    required DateTime checkedInAt,
    ({double lat, double lng})? fix,
  }) async {
    final String key = checkinKey(workerId, day);
    final SyncOpIdentity identity = fieldCheckinOpIdentity();
    await processor.queue.enqueue(
      SyncOperation(
        id: key,
        entityType: identity.entityType,
        kind: SyncOpKind.create,
        endpoint: identity.endpoint,
        method: 'POST',
        payload: <String, Object?>{
          'worker_id': workerId,
          'day': day,
          // The op id IS the server's idempotency key, so a replay of this exact
          // op returns the original row instead of opening a second day.
          'idempotency_key': key,
          'checked_in_at': checkedInAt.toUtc().toIso8601String(),
          // Sent together or not at all — a half pair is a 400 by design.
          if (fix != null) 'checkin_lat': fix.lat,
          if (fix != null) 'checkin_lng': fix.lng,
        },
        createdAt: checkedInAt,
      ),
    );
    return processor.drain();
  }

  @override
  Future<DrainReport> submitCheckOut({
    required String workerId,
    required String day,
    required DateTime checkedOutAt,
    ({double lat, double lng})? fix,
  }) async {
    final String key = checkinKey(workerId, day);
    final SyncOpIdentity identity = fieldCheckoutOpIdentity();
    await processor.queue.enqueue(
      SyncOperation(
        // A DIFFERENT op id from the check-in: they are two ops in one queue, and
        // sharing an id would make the second enqueue look like a replay of the
        // first. The server-side key stays the check-in's, in `check_in_key`.
        id: 'checkout:$workerId:$day',
        entityType: identity.entityType,
        kind: SyncOpKind.update,
        endpoint: identity.endpoint,
        method: 'POST',
        payload: <String, Object?>{
          'worker_id': workerId,
          'day': day,
          'check_in_key': key,
          'checked_out_at': checkedOutAt.toUtc().toIso8601String(),
          if (fix != null) 'checkout_lat': fix.lat,
          if (fix != null) 'checkout_lng': fix.lng,
        },
        createdAt: checkedOutAt,
      ),
    );
    return processor.drain();
  }

  @override
  Future<DrainReport> drain() => processor.drain();

  @override
  Future<List<SyncOperation>> due() => processor.queue.pending();
}
