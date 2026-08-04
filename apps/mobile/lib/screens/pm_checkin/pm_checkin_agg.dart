// Pure parse + honest derivations for the mobile PM check-in (route `pm-checkin`,
// pototype/mobile-pm.jsx MPMCheckin L51-89). money = NONE — a GPS arrival event; an
// at-least-once replay just re-sets checkin_gps (no JV, no double-post).
//
// The prototype is a MOCK: a single `checkedIn` boolean flips to an optimistic
// "check-in success · 09:14" state — there is NO offline / queued / failure state,
// and the map's lat/long + distance + the zone/SLA/contract values are hardcoded.
// Per §0 rule 3 (strip mock mechanics) none of that fabricated data is reproduced.
// This module derives ONLY:
//   - the honest write STATE from the offline queue's drain outcome (the three
//     states the spec requires: online-confirmed / offline-queued / permanently
//     failed), never a fake success;
//   - the service-info fields, which the real WO wire (pm.ts workOrderWire =
//     { id, asset_id, template_id, tech, checkin_gps, items, cause, fix, advice,
//     customer_sign }) does NOT carry — so zone/SLA/contract em-dash today, and are
//     parsed defensively so they light up honestly IF the wire ever grows them.
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// The honest lifecycle of a check-in write, as the screen renders it.
///
/// [idle] / [acquiringGps] / [submitting] are UI-transient (before / during the GPS
/// fix / during a submit). [gpsUnavailable] and the three post-drain states are
/// terminal honest outcomes:
///   * [acquiringGps]   — requesting a real device coordinate (no write yet).
///   * [gpsUnavailable] — no fix (permission denied / location off): the honest
///                        "can't check in" state — NOTHING is enqueued, no
///                        coordinate is fabricated.
///   * [confirmed]      — the server durably accepted the write (2xx).
///   * [queued]         — offline / transient failure: saved to the queue, will
///                        retry (NEVER shown as a success).
///   * [failed]         — a permanent (4xx) rejection: kept + surfaced, no retry.
enum PmCheckinState {
  idle,
  acquiringGps,
  submitting,
  gpsUnavailable,
  confirmed,
  queued,
  failed,
}

/// Resolve the honest post-drain state of the op [opId] from the drain [report]
/// and the ops still [due] in the queue (pending + failed).
///
/// The report is authoritative when it touched the op this pass. When it did not
/// (e.g. a re-entrant drain was guarded out, or an earlier pass already handled it),
/// the queue is the source of truth: an op that is gone was synced; a `failed` op is
/// a permanent dead-letter; a `pending` op is still queued.
PmCheckinState resolveCheckinState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return PmCheckinState.confirmed;
      case SyncOutcome.permanentlyFailed:
        return PmCheckinState.failed;
      case SyncOutcome.deferred:
        return PmCheckinState.queued;
    }
  }
  SyncOperation? mine;
  for (final SyncOperation op in due) {
    if (op.id == opId) {
      mine = op;
      break;
    }
  }
  if (mine == null) return PmCheckinState.confirmed; // removed = synced
  return mine.status == SyncOpStatus.failed
      ? PmCheckinState.failed
      : PmCheckinState.queued;
}

/// Format a check-in time as a locale-neutral 24h "HH:mm" (no fabricated Thai era /
/// time suffix — the numeric philosophy the notif/pr-detail ports use). The value is
/// the honest client submit time: the real POST /pm/workorders/{id}/checkin response
/// (pm.ts workOrderWire) carries no timestamp, so there is nothing server-side to
/// prefer here.
String formatCheckinTime(DateTime dt) {
  String two(int n) => n.toString().padLeft(2, '0');
  final DateTime local = dt.toLocal();
  return '${two(local.hour)}:${two(local.minute)}';
}

/// The work-order service-info the screen shows beside the map (zone / SLA /
/// contract). Every field is `null` → the view em-dashes it (never fabricated).
class PmServiceInfo {
  const PmServiceInfo({this.zone, this.sla, this.contract});

  /// Service zone (the prototype's service-zone label) — no wire → null → em-dash.
  final String? zone;

  /// SLA response window (prototype "SLA") — no wire today → null → em-dash.
  final String? sla;

  /// Contract reference (the prototype's contract label) — no wire → null → em-dash.
  final String? contract;
}

/// Derive [PmServiceInfo] from an optional opaque WO wire row.
///
/// The real WO wire carries none of zone/SLA/contract, so all three em-dash today.
/// The lookup is defensive (snake_case first, camelCase fallback) so a future wire
/// that grows the columns lights them up without a code change — and never invents a
/// value the wire does not have.
PmServiceInfo deriveServiceInfo(Map<String, Object?>? wo) {
  if (wo == null) return const PmServiceInfo();
  return PmServiceInfo(
    zone: _wireStr(wo, const <String>['service_zone', 'serviceZone']),
    sla: _wireStr(wo, const <String>['sla', 'sla_response', 'slaResponse']),
    contract: _wireStr(wo, const <String>[
      'contract_no',
      'contractNo',
      'contract',
    ]),
  );
}

/// First non-empty string among [keys], else null.
String? _wireStr(Map<String, Object?> e, List<String> keys) {
  for (final String k in keys) {
    final Object? v = e[k];
    if (v is String && v.isNotEmpty) return v;
  }
  return null;
}
