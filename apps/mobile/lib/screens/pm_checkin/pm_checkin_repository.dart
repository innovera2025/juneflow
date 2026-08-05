// Write access for the mobile PM check-in (route `pm-checkin`). money = NONE.
//
// This is the FIRST offline-WRITE screen, so — unlike the read screens that hit Dio
// directly — the check-in is captured as a durable SyncOperation and replayed
// through the level-(a) QueueDrainProcessor (BLOCKERS.md B-242). The server stays
// the sole authority: the replay POSTs the SAME payload to the SAME endpoint
//   POST /pm/workorders/{id}/checkin { gps }   (pm.ts checkinPmWorkorder → ActionOk)
// and the client never computes anything. There is no read here: the WO wire carries
// no service-info (zone/SLA/contract), so nothing is fetched — the view em-dashes
// those (pm_checkin_agg.deriveServiceInfo).
//
// GPS honesty (F-1 resolved — geolocator is now wired, Wei-approved): the screen
// obtains a REAL device coordinate via GpsSource BEFORE calling submitCheckin, so
// the payload's `gps` is always a genuine "<lat>, <long>" — never null, never
// fabricated. When no fix can be obtained (permission denied / location off) the
// screen renders an honest error and NEVER enqueues (so no gps-blank 400 dead-letter
// is ever created).
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// Enqueue a check-in write and drive the (a) drain; expose the queue state so the
/// screen can resolve its op's honest outcome.
abstract class PmCheckinRepository {
  /// Enqueue a check-in for [workOrderId] with the REAL device coordinate [gps]
  /// ("<lat>, <long>", obtained by the screen before calling this — never null,
  /// never fabricated), under the stable client idempotency key [opId] (reused
  /// across manual retries so a re-tap never duplicates the write), stamped [now],
  /// then drain. Returns the drain report.
  Future<DrainReport> submitCheckin({
    required String workOrderId,
    required String opId,
    required String gps,
    required DateTime now,
  });

  /// Re-drain the queue without enqueuing anything — the manual "retry" trigger and
  /// the on-mount trigger of the (a) policy.
  Future<DrainReport> drain();

  /// The ops still in the queue (pending + failed), so the screen can resolve the
  /// state of its own op after a drain.
  Future<List<SyncOperation>> due();
}

/// [PmCheckinRepository] over the shared offline queue + its (a) processor. The
/// processor owns the queue; both the enqueue and the state read go through it so
/// they operate on the one shared queue instance.
class QueueBackedPmCheckinRepository implements PmCheckinRepository {
  const QueueBackedPmCheckinRepository(this.processor);

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262). Public
  /// so the host wiring is assertable: a repository handed a screen-local processor
  /// instead of the shared one is the regression this slice removed.
  final QueueDrainProcessor processor;

  @override
  Future<DrainReport> submitCheckin({
    required String workOrderId,
    required String opId,
    required String gps,
    required DateTime now,
  }) async {
    final SyncOperation op = SyncOperation(
      id: opId,
      entityType: 'pm_checkin',
      kind: SyncOpKind.create,
      endpoint: '/pm/workorders/$workOrderId/checkin',
      method: 'POST',
      // The REAL device coordinate the screen just obtained. The server owns
      // everything; the client sends only the true fix.
      payload: <String, Object?>{'gps': gps},
      createdAt: now,
    );
    await processor.queue.enqueue(op);
    return processor.drain();
  }

  @override
  Future<DrainReport> drain() => processor.drain();

  @override
  Future<List<SyncOperation>> due() => processor.queue.pending();
}
