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
// A screen ADOPTS the id of the op still queued for the record it is looking at,
// instead of minting a new one. That question is asked at TWO points, and both are
// needed:
//
//   1. ON MOUNT, after the (a) on-mount drain has had its chance to clear the queue
//      — this is what makes the relaunched screen SHOW that a write is outstanding.
//   2. IMMEDIATELY BEFORE MINTING A KEY — this is what makes it SAFE. The on-mount
//      drain is one real HTTP round trip (and the app's Dio sets no connectTimeout),
//      the screen is fully rendered with a live CTA throughout it, and the adoption
//      lands only after it. A tap inside that window sees a null `_opId` and, with
//      (1) alone, mints a SECOND key — the exact duplicate this file exists to
//      prevent, reachable on a healthy network with no app kill involved at all.
//      Asking the queue at the mint site closes it, because the queue is durable and
//      already holds the op the in-flight drain is replaying.
//
// Two properties make adoption safe, and both are enforced here rather than
// restated in five screens:
//
//   * ONLY `SyncOpStatus.pending` ops are adoptable. A `failed` op is a permanent
//     4xx dead-letter: `QueueDrainProcessor` skips it on every future drain, so the
//     server WILL NEVER receive it and it never wrote a row. Adopting one would
//     strand the user on a write that can no longer be sent and can no longer be
//     re-made — the mirror-image defect (an id held too long, so a second and
//     genuinely-new submission is silently swallowed). A dead-letter is therefore
//     left alone and the next submission correctly mints a new key.
//
//   * A future `markInFlight` caller would make an op INVISIBLE here. `SyncQueue`
//     excludes `inFlight` from `pending()` (sync_queue.dart), and only `pending`
//     ops are adoptable, so an op parked in that status is seen neither by the
//     drain nor by this adoption — and the next tap would mint a fresh key against
//     a write that is already on the wire. `markInFlight` has NO production caller
//     today (the level-(a) drain uses a plain re-entrancy guard instead, precisely
//     to stay crash-consistent), so this is unreachable rather than latent; a
//     processor that starts using it must also surface those ops to this matcher.
//
// WHEN THE ANSWER HAS TO ARRIVE — the quiet CTA (BLOCKERS.md B-341)
// ------------------------------------------------------------------------------
// Asking at the mint site stops the DUPLICATE, but it cannot stop the other half of
// the same window. Before the on-mount adoption lands, the screen is a CLEAN SLATE
// with a live CTA: no queued card, `_opId` null. A user who re-stages a basket there
// and confirms hits the pre-mint check, which adopts the PREVIOUS op — so the basket
// on screen is never sent, while the screen reports the previous write's success.
// Neither minting (a duplicate) nor adopting (a silent drop) is acceptable, so Wei
// ruled the third way: THE CTA IS QUIET UNTIL THE QUEUE READ COMPLETES, and no tap is
// possible inside the window at all. This deviates from the prototype, which has no
// offline state whatsoever — the ruling is recorded on B-341 rather than six times.
//
// Two properties make that window BOUNDED, which matters because a CTA quiet forever
// is worse than the defect it fixes:
//
//   * THE READ COMES FIRST, BEFORE THE DRAIN. A drain can only ever SHRINK the set of
//     ops adoptable by one identity: `markSynced` removes an op, `markFailed` makes it
//     non-adoptable (only `pending` is adoptable, above), and a deferral re-enqueues
//     the SAME id still `pending` (sync_processor.dart `_deferPending`). Nothing in a
//     drain ADDS one. So reading the queue BEFORE the drain returns a SUPERSET of
//     reading it after: adopt-first can never miss an op that adopt-after would find,
//     and waiting for the drain would only delay an answer the queue already has.
//
//   * WITH THE DRAIN OUT OF IT, THE WINDOW CONTAINS NO NETWORK CALL. `SyncQueue`'s two
//     implementations are both local — an in-memory list, and the drift/SQLite store —
//     while the drain goes out over a Dio built with NO `connectTimeout`
//     (app_services.dart), i.e. a genuinely unbounded wait. The bound is therefore
//     structural rather than a chosen duration, and a read that THROWS still opens the
//     CTA (each screen releases it in a `finally`), because an unanswerable question
//     must not park the button forever — the mint site asks again anyway.
//
// What the drain still owes the screen afterwards is only the DISPLAY: a card adopted
// before the drain describes a write the drain may have just resolved. Each screen
// therefore re-asks once the drain returns and takes the card back down if the write
// is no longer outstanding — which lands on exactly the state the drain-first ordering
// used to reach, one round trip later.
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
