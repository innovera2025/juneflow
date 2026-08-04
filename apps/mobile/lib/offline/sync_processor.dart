// Offline-first sync — the LEVEL-DEPENDENT drain seam, now filled for level (a).
//
// Everything else in this package (SyncOperation, SyncQueue + its in-memory and
// drift implementations) is level-agnostic: it stores and orders pending writes.
// What a SyncProcessor does — WHEN to drain the queue, HOW to treat a
// server/network failure, and how aggressively to retry — is the behaviour that
// differs between offline levels (a)/(b). That was Open Question #5 (PLAN.md §11).
//
// Wei answered it: BLOCKERS.md B-242 = level (a) "queue-and-replay" (2026-08-04).
// This file therefore implements the (a) drain POLICY. It stays deliberately
// dependency-free — NO connectivity package, NO timer, NO background isolate — so
// the trigger cadence is owned by the UI (see the trigger notes on [drain]).
//
// money = SERVER is preserved end-to-end: a replay re-POSTs the SAME payload to the
// SAME endpoint, so the server stays the sole authority. The client never computes
// money and never mutates a local source-of-truth (level a = network-first reads;
// there is no local read DB).

import 'package:dio/dio.dart';

import 'sync_operation.dart';
import 'sync_queue.dart';

/// Drains a [SyncQueue] by replaying its [SyncOperation]s against the API.
///
/// The level-agnostic seam. [QueueDrainProcessor] is the concrete level-(a)
/// implementation of it.
abstract interface class SyncProcessor {
  /// The queue this processor drains.
  SyncQueue get queue;

  /// Attempt to replay due writes once. See [QueueDrainProcessor.drain] for the
  /// concrete (a) policy (which returns a richer report).
  Future<void> drainOnce();
}

/// How the transport layer answers one replay. HTTP responses (any status) come
/// back as a [SyncApiResponse]; a true transport failure (no response reached —
/// offline, DNS, timeout) is signalled by THROWING, which the processor reads as a
/// transient "deferred" outcome. Fakeable in unit tests without a network.
abstract interface class SyncApiClient {
  /// Replay one write: `method endpoint` with [payload] as the JSON body. Returns
  /// the server's response (2xx/4xx/5xx alike); throws only on a transport failure
  /// (no HTTP response was received).
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  });
}

/// One HTTP response from a replay.
class SyncApiResponse {
  const SyncApiResponse({required this.statusCode, this.body});

  /// The HTTP status (e.g. 200, 400, 503).
  final int statusCode;

  /// The decoded JSON object body, when the response carried one; else null.
  final Map<String, Object?>? body;
}

/// What became of one op during a drain.
///
/// * [synced] — 2xx: the server durably accepted it; the op is removed.
/// * [permanentlyFailed] — 4xx: the payload is wrong, retrying can never help; the
///   op is kept as a visible dead-letter (never silently dropped) and skipped by
///   future drains.
/// * [deferred] — 5xx / transport failure: transient; the op stays pending with an
///   incremented attempt count and the drain STOPS (FIFO: a stuck op is not
///   skipped) — the next drain retries it from the front.
enum SyncOutcome { synced, permanentlyFailed, deferred }

/// The result of replaying one op in a drain pass.
class SyncAttempt {
  const SyncAttempt({
    required this.id,
    required this.outcome,
    this.statusCode,
    this.body,
    this.error,
  });

  /// The [SyncOperation.id] this attempt concerns.
  final String id;

  final SyncOutcome outcome;

  /// The HTTP status, when the server answered (null on a transport failure).
  final int? statusCode;

  /// The decoded response body, when the server answered with a JSON object.
  final Map<String, Object?>? body;

  /// The transport/HTTP error text, when [outcome] is not [SyncOutcome.synced].
  final String? error;
}

/// The per-op outcomes of one [QueueDrainProcessor.drain] pass, in process order.
class DrainReport {
  const DrainReport(this.attempts);

  /// The ops the drain touched, oldest-first. A drain that hit nothing due (empty
  /// queue, or only dead-letters remain) reports an empty list.
  final List<SyncAttempt> attempts;

  /// The attempt for [id] in this pass, or null when the drain did not reach it
  /// (e.g. it was blocked behind a stuck op, or a re-entrant drain was skipped).
  SyncAttempt? attemptFor(String id) {
    for (final SyncAttempt a in attempts) {
      if (a.id == id) return a;
    }
    return null;
  }
}

/// The level-(a) "queue-and-replay" drain policy (BLOCKERS.md B-242).
///
/// Policy, per the answered Open Q #5:
///
/// * **FIFO.** Ops are replayed oldest-first by [SyncOperation.createdAt]. Order is
///   never rearranged.
/// * **2xx → done.** The op is marked synced and removed from the queue.
/// * **4xx → permanent dead-letter.** The op is marked `failed` (via
///   [SyncQueue.markFailed], which also increments its attempt count and records
///   the error) and is KEPT so the UI can surface it; it is never replayed again
///   (a `failed` op is skipped by every later drain). The drain then continues past
///   it — a dead op does not block the writes behind it.
/// * **5xx / transport failure → deferred.** The op is returned to `pending` with an
///   incremented attempt count, and the drain STOPS at that point. FIFO integrity:
///   a genuinely-stuck op is not skipped, and everything behind it waits its turn.
///   The next drain retries from the front.
///
/// Triggers (dependency-free): [drain] is called (a) right after an enqueue, so the
/// online happy-path replays immediately, (b) on screen-mount / app-resume, and (c)
/// from a manual "retry" affordance. A background connectivity listener is a
/// deferred enhancement that can be added WITHOUT changing this policy.
///
/// Retry/back-off is minimal and deterministic: only [SyncOperation.attemptCount]
/// is tracked (no wall-clock gating, no timer). Because a 5xx STOPS the drain and
/// the trigger cadence is external, a persistently-failing endpoint cannot hot-loop.
///
/// Concurrency: a plain re-entrancy guard makes overlapping [drain] calls safe (the
/// second returns immediately). The single-isolate (a) drain therefore never needs
/// [SyncQueue.markInFlight], which keeps the queue crash-consistent — no op is ever
/// stranded mid-flight.
///
/// Idempotency (honest scope): every op carries a client-generated idempotency [id]
/// ([SyncOperation.id]). This slice's first consumer (PM check-in) is money=NONE, so
/// at-least-once replay is safe WITHOUT server-side dedup. A money-write consumer
/// needs a server Idempotency-Key contract (a sacred openapi change) — that is a
/// forward dependency for those slices, NOT decided here.
class QueueDrainProcessor implements SyncProcessor {
  QueueDrainProcessor(this._queue, this._client);

  final SyncQueue _queue;
  final SyncApiClient _client;

  /// Re-entrancy guard — one drain at a time (see the class doc, "Concurrency").
  bool _draining = false;

  @override
  SyncQueue get queue => _queue;

  @override
  Future<void> drainOnce() => drain();

  /// Replay due writes under the (a) policy and report each op's outcome.
  ///
  /// A no-op when a drain is already in progress (returns an empty report), when
  /// the queue is empty, and when only dead-letters remain.
  Future<DrainReport> drain() async {
    final List<SyncAttempt> attempts = <SyncAttempt>[];
    // Concurrent drain — skip safely (the re-entrancy guard, see class doc).
    if (_draining) {
      return DrainReport(attempts);
    }
    _draining = true;
    try {
      while (true) {
        // pending() returns pending + failed (both "due"), FIFO by createdAt. The
        // NEXT op to replay is the first PENDING one; a `failed` op is a permanent
        // 4xx dead-letter — kept + visible, never replayed — so it is skipped here.
        final List<SyncOperation> due = await _queue.pending();
        SyncOperation? op;
        for (final SyncOperation candidate in due) {
          if (candidate.status == SyncOpStatus.pending) {
            op = candidate;
            break;
          }
        }
        // Nothing replayable remains (empty queue, or only dead-letters).
        if (op == null) {
          break;
        }

        SyncApiResponse resp;
        try {
          resp = await _client.send(
            method: op.method,
            endpoint: op.endpoint,
            payload: op.payload,
          );
        } catch (e) {
          // No HTTP response reached us = transient transport failure. Keep the op
          // pending, bump attempts, and STOP (don't skip past a stuck op).
          await _deferPending(op, error: '$e');
          attempts.add(
            SyncAttempt(id: op.id, outcome: SyncOutcome.deferred, error: '$e'),
          );
          break;
        }

        final int code = resp.statusCode;
        if (code >= 200 && code < 300) {
          // Success — the server durably accepted it; drop it and move on.
          await _queue.markSynced(op.id);
          attempts.add(
            SyncAttempt(
              id: op.id,
              outcome: SyncOutcome.synced,
              statusCode: code,
              body: resp.body,
            ),
          );
          continue;
        } else if (code >= 400 && code < 500) {
          // Client error — permanent. Mark it failed (kept + visible, attempts++),
          // then CONTINUE: a dead op must not block the writes behind it.
          await _queue.markFailed(op.id, error: 'HTTP $code');
          attempts.add(
            SyncAttempt(
              id: op.id,
              outcome: SyncOutcome.permanentlyFailed,
              statusCode: code,
              body: resp.body,
              error: 'HTTP $code',
            ),
          );
          continue;
        } else {
          // 5xx (or any other non-2xx/4xx) — transient. Defer + STOP.
          await _deferPending(op, error: 'HTTP $code');
          attempts.add(
            SyncAttempt(
              id: op.id,
              outcome: SyncOutcome.deferred,
              statusCode: code,
              error: 'HTTP $code',
            ),
          );
          break;
        }
      }
    } finally {
      _draining = false;
    }
    return DrainReport(attempts);
  }

  /// Return [op] to a retryable `pending` state with an incremented attempt count.
  ///
  /// The level-agnostic queue's only attempt-incrementing transition ([markFailed])
  /// also flips status to `failed`, which the (a) drain reserves for permanent 4xx
  /// dead-letters. So a transient 5xx/transport failure is re-recorded via an
  /// idempotent [SyncQueue.enqueue] of the same id (createdAt unchanged → FIFO
  /// position preserved), keeping the op `pending` and therefore retried next drain.
  Future<void> _deferPending(SyncOperation op, {required String error}) {
    return _queue.enqueue(
      op.copyWith(
        status: SyncOpStatus.pending,
        attemptCount: op.attemptCount + 1,
        lastError: error,
      ),
    );
  }
}

/// [SyncApiClient] over the app's shared Dio (the generated client's transport, so
/// a replay inherits the auth interceptor + tenant scope, exactly like a live call).
///
/// `validateStatus: (_) => true` makes Dio hand back 4xx/5xx responses instead of
/// throwing, so the processor can branch on the real status. A throw therefore means
/// a genuine transport failure (no response), which the processor reads as deferred.
class DioSyncApiClient implements SyncApiClient {
  const DioSyncApiClient(this._dio);

  final Dio _dio;

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    try {
      final Response<Object?> res = await _dio.request<Object?>(
        endpoint,
        data: payload,
        options: Options(method: method, validateStatus: (int? _) => true),
      );
      return SyncApiResponse(
        statusCode: res.statusCode ?? 0,
        body: _asJsonObject(res.data),
      );
    } on DioException catch (e) {
      // With validateStatus always-true a DioException means no HTTP response was
      // received (connect/timeout/offline). If one somehow rode along, surface its
      // status; otherwise rethrow so the drain treats it as a transient deferral.
      final Response<Object?>? res = e.response;
      if (res != null) {
        return SyncApiResponse(
          statusCode: res.statusCode ?? 0,
          body: _asJsonObject(res.data),
        );
      }
      rethrow;
    }
  }

  static Map<String, Object?>? _asJsonObject(Object? data) {
    if (data is Map) {
      return data.map<String, Object?>(
        (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
      );
    }
    return null;
  }
}
