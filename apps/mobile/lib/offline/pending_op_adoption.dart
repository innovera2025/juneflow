// Offline-first sync — REHYDRATING a screen's own queued write (BLOCKERS.md B-330).
//
// THE DEFECT THIS EXISTS TO CLOSE
// ------------------------------------------------------------------------------
// Every offline-write screen holds the client idempotency key of its outstanding
// write in a plain `String? _opId` field of its State. Within one session that is
// enough: a re-tap finds `_opId` non-null and only RE-DRAINS the op, so the same
// key is replayed and the server resolves it to the original row.
//
// It is NOT enough across a process restart, because State is not durable and the
// QUEUE is:
//
//   1. the user submits while offline  -> op `k1` is enqueued, the drain defers it,
//      the op stays `pending` in the durable (drift/SQLite) queue;
//   2. the app is killed;
//   3. the user reopens the screen, still offline -> the on-mount drain defers `k1`
//      again, and `_opId` is null because it is fresh State;
//   4. the user taps again -> a FRESH key `k2` is minted and a SECOND op enqueued.
//
// Both ops now sit in the queue carrying DIFFERENT idempotency keys, so when
// connectivity returns the server writes TWO rows. No server-side guard can help:
// a partial unique index on the key is doing its job — two distinct keys are
// legitimately two distinct records. The duplicate has to be prevented on the
// client, by not minting the second key in the first place.
//
// st-receive's write is POST /gr, which posts a GL journal voucher, so this is a
// MONEY path: the failure mode is a duplicated goods receipt and a duplicated JV.
//
// THE RULE
// ------------------------------------------------------------------------------
// On mount, after the (a) on-mount drain has had its chance to clear the queue, a
// screen ADOPTS the id of the op still queued for the record it is looking at,
// instead of minting a new one. Two properties make that safe, and both are
// enforced here rather than restated in five screens:
//
//   * ONLY `SyncOpStatus.pending` ops are adoptable. A `failed` op is a permanent
//     4xx dead-letter: `QueueDrainProcessor` skips it on every future drain, so the
//     server WILL NEVER receive it and it never wrote a row. Adopting one would
//     strand the user on a write that can no longer be sent and can no longer be
//     re-made — the mirror-image defect (an id held too long, so a second and
//     genuinely-new submission is silently swallowed). A dead-letter is therefore
//     left alone and the next submission correctly mints a new key.
//
//   * A screen adopts ONLY ITS OWN op. `SyncQueue.pending()` is a single global
//     FIFO across every screen — it has no notion of ownership — so identity has to
//     be reconstructed from what the op itself carries. [SyncOpIdentity] is that
//     reconstruction, and it is built by the SAME expression the repository uses to
//     construct the op, so the matcher cannot drift away from the builder. Matching
//     on entity type alone would be a bug, not a shortcut: two work orders both
//     produce `pm_notes` ops, and adopting the other one's id would make this
//     screen believe it had already submitted — silently dropping this record's
//     write entirely.
import 'sync_operation.dart';

/// What pins one queued write to ONE screen and ONE record.
///
/// Constructed by the repository that also builds the [SyncOperation], from the
/// same values, so the two can never disagree about what the op looks like.
class SyncOpIdentity {
  const SyncOpIdentity({
    required this.entityType,
    required this.endpoint,
    this.payloadAnchor = const <String, Object?>{},
  });

  /// [SyncOperation.entityType] — the screen's write kind (`gr`, `pm_notes`, …).
  final String entityType;

  /// [SyncOperation.endpoint]. For most writes the record id is IN the path
  /// (`/pm/workorders/{id}/checkin`), so this alone pins the record.
  final String endpoint;

  /// Payload entries that pin the record when the endpoint cannot, because it is
  /// record-agnostic — `POST /gr` is the same path for every PO, and the receipt's
  /// subject travels in the body as `po_id`. Every entry must match. Empty when the
  /// endpoint already carries the anchor.
  final Map<String, Object?> payloadAnchor;

  /// True when [op] is this screen's write against this record.
  bool matches(SyncOperation op) {
    if (op.entityType != entityType || op.endpoint != endpoint) return false;
    for (final MapEntry<String, Object?> anchor in payloadAnchor.entries) {
      if (op.payload[anchor.key] != anchor.value) return false;
    }
    return true;
  }
}

/// The op [identity] can adopt out of [due], or null when there is none.
///
/// [due] is a [SyncQueue.pending] result: pending + failed ops, oldest first.
SyncOperation? findAdoptableOp(
  List<SyncOperation> due,
  SyncOpIdentity identity,
) => findAdoptableOpAmong(due, <SyncOpIdentity>[identity])?.op;

/// The op adoptable by ANY of [identities], plus the index of the identity that
/// matched it — for a screen whose record is one of several on view at once
/// (field-progress lists a contract's work periods and each has its own write).
///
/// Returns the OLDEST adoptable op: [due] is FIFO by `createdAt`, so the first
/// match is also the op the next drain will reach first. Only a still-replayable
/// (`pending`) op is ever returned — see the file header for why a `failed`
/// dead-letter must NOT be adopted.
({SyncOperation op, int identityIndex})? findAdoptableOpAmong(
  List<SyncOperation> due,
  List<SyncOpIdentity> identities,
) {
  for (final SyncOperation op in due) {
    if (op.status != SyncOpStatus.pending) continue;
    for (int i = 0; i < identities.length; i++) {
      if (identities[i].matches(op)) {
        return (op: op, identityIndex: i);
      }
    }
  }
  return null;
}
