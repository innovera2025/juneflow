// Offline-first sync — the queued-mutation model (P0-MOB-05).
//
// The Juneflow mobile app is offline-first (PLAN.md Appendix A: "drift/SQLite +
// sync queue"). Writes made while the device may be offline are captured as
// [SyncOperation]s, appended to a durable [SyncQueue], and later replayed against
// the generated API client (lib/api/generated/**) when connectivity returns.
//
// This model and the [SyncQueue] contract are the LEVEL-AGNOSTIC core: they are
// identical for both offline levels (a)/(b) of Open Question #5 (PLAN.md §11).
// The *policy* that decides WHEN the queue is drained, how conflicts resolve, and
// whether reads are served from a local cache is level-DEPENDENT and is therefore
// deferred until Wei answers Open Q #5 (see sync_processor.dart). Nothing here
// commits to a level.

import 'dart:convert';

/// The kind of mutation a queued write represents. Maps to the HTTP verb the
/// replay will use, but is stored explicitly so the queue never has to parse it
/// back out of [SyncOperation.method].
enum SyncOpKind { create, update, delete }

/// Lifecycle of a queued write inside the [SyncQueue].
///
/// A write starts [pending]. A processor marks it [inFlight] while it attempts
/// the replay, then either removes it (success) or marks it [failed] (to be
/// retried later). Both [pending] and [failed] are "due" — see [SyncQueue.pending].
enum SyncOpStatus { pending, inFlight, failed }

/// One durable, replayable write captured by the offline queue.
///
/// Instances are immutable; [copyWith] produces the next state. [id] is a
/// client-generated idempotency key supplied by the caller (the queue never
/// invents one) so a replay that the server already applied can be de-duplicated.
class SyncOperation {
  SyncOperation({
    required this.id,
    required this.entityType,
    required this.kind,
    required this.endpoint,
    required this.method,
    required this.payload,
    required DateTime createdAt,
    this.status = SyncOpStatus.pending,
    this.attemptCount = 0,
    this.lastError,
  }) : createdAt = createdAt.toUtc();

  /// Client-generated idempotency key (e.g. a uuid). Primary key in the queue.
  final String id;

  /// Domain entity the write targets, e.g. `'defect'` or `'period_inspection'`.
  final String entityType;

  final SyncOpKind kind;

  /// API path to replay against, e.g. `'/defects/123/fix'` (no host, no base).
  final String endpoint;

  /// Uppercase HTTP verb, e.g. `'POST'`.
  final String method;

  /// Request body to replay, as a JSON-encodable map.
  final Map<String, Object?> payload;

  /// When the write was captured. Always stored in UTC (root CLAUDE.md: time is
  /// stored UTC everywhere); the constructor normalises any input to UTC.
  final DateTime createdAt;

  final SyncOpStatus status;

  /// How many replay attempts have been made. Incremented on each failure so a
  /// level-dependent processor can back off or give up (policy deferred, Open Q #5).
  final int attemptCount;

  /// Last replay error, when [status] is [SyncOpStatus.failed]; otherwise null.
  final String? lastError;

  SyncOperation copyWith({
    SyncOpStatus? status,
    int? attemptCount,
    String? lastError,
    bool clearLastError = false,
  }) {
    return SyncOperation(
      id: id,
      entityType: entityType,
      kind: kind,
      endpoint: endpoint,
      method: method,
      payload: payload,
      createdAt: createdAt,
      status: status ?? this.status,
      attemptCount: attemptCount ?? this.attemptCount,
      lastError: clearLastError ? null : (lastError ?? this.lastError),
    );
  }

  /// Serialise for durable storage. The payload is JSON-encoded into a string so
  /// a single text column can hold it (see the drift `SyncQueueItems` table).
  Map<String, Object?> toRow() {
    return {
      'id': id,
      'entity_type': entityType,
      'kind': kind.name,
      'endpoint': endpoint,
      'method': method,
      'payload': jsonEncode(payload),
      'created_at': createdAt.toIso8601String(),
      'status': status.name,
      'attempt_count': attemptCount,
      'last_error': lastError,
    };
  }

  factory SyncOperation.fromRow(Map<String, Object?> row) {
    return SyncOperation(
      id: row['id'] as String,
      entityType: row['entity_type'] as String,
      kind: SyncOpKind.values.byName(row['kind'] as String),
      endpoint: row['endpoint'] as String,
      method: row['method'] as String,
      payload: (jsonDecode(row['payload'] as String) as Map)
          .cast<String, Object?>(),
      createdAt: DateTime.parse(row['created_at'] as String),
      status: SyncOpStatus.values.byName(row['status'] as String),
      attemptCount: (row['attempt_count'] as num).toInt(),
      lastError: row['last_error'] as String?,
    );
  }
}
