// Pure parse + honest derivations for the mobile work-period delivery screen
// (route `field-progress`, pototype/mobile-screens.jsx MFieldProgress L316-358).
// money = NONE — no amount is read, derived, or sent by this screen.
//
// The prototype is a MOCK (§0 rule 3 — none of this is reproduced):
//   - the contractor name and the work description (L323-324) are hardcoded strings;
//   - the progress bar is a hardcoded `width: "78%"` next to a hardcoded "78%"
//     (L328-331), with two hardcoded delta lines beneath it (L334 — a "previously
//     65%" and a "+13 ppt today");
//   - the photo grid is five CSS gradients (L339-343);
//   - the note box holds one hardcoded sentence (L348);
//   - the CTA prints a hardcoded money amount and is wired to nothing (L352-354).
//
// ⚠ THE PERCENTAGE HAS NO WIRE, AND MUST NOT BE SYNTHESISED. This is the trap this
// screen exists to avoid, so it is stated as a rule and not just as a comment on one
// widget:
//   * `work_period` carries a STATUS, not a completion percentage
//     (packages/db/src/schema/subcon.ts workPeriods — id, contract_id, seq, basis,
//     target, pct, amount, currency_code, total_qty, per_period_qty, rate_per_unit,
//     unit, status). Its `pct` column is the period's TARGET share of the contract
//     under the `percent` basis (subcon.ts computeGross: gross = pct/100 ×
//     contract.value), i.e. how much of the contract this period IS — not how much
//     of it is DONE. Rendering it as progress would relabel a target as an
//     achievement.
//   * Nor may a percentage be derived from the periods themselves. #delivered /
//     #periods is NOT the fraction of work complete: periods are not equal in size
//     (that is the entire point of the four bases — percent / distance / unit /
//     milestone), so the numerator and the denominator do not measure the same
//     quantity. That shape — summing over a population and then asserting a ratio
//     whose elements do not satisfy the ratio's precondition — is the error that
//     cost this project three review rounds on another screen. If a ratio cannot be
//     formed from ONE population whose every element satisfies the precondition, it
//     is withheld.
//   So the screen renders the period's REAL `status` where the prototype renders a
//   percentage, and an em-dash where the number itself would go. BLOCKERS.md B-297.
//   That status is a WIRE value — `pending|delivered|inspecting|passed|rejected|paid`
//   are English machine codes — and it is NEVER printed raw: [statusLabelField] maps
//   it to an EXISTING dict key (the merged web port's own 6→4 collapse), or to null,
//   which the view renders as an em-dash. An untranslated enum in a Thai-only field
//   app is not a port (§0 rule 2).
//
// The real wires:
//   GET /subcon-contracts                (subcon.ts L584-593) → contractWire
//     { id, no, vendor_id, project_id, value, currency_code, retention_pct,
//       start, end }
//   GET /vendors                         → { id, name, … } (the st_grlist join)
//   GET /subcon-contracts/{id}/periods   (subcon.ts L709-735) → enrichPeriodRow
//     { …periodWire, project_name, title, owner, defect }
//   POST /periods/{id}/deliver { docs, photos }  (subcon.ts L741-790)
//     pending → delivered, upserting the period's single acceptance.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable. (The
// write-state resolution imports the queue model only, exactly like pm_notes_agg.)

import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';

/// An opaque contract Entity — every row above is `{ [k]: unknown }`.
typedef FieldProgressEnt = Map<String, Object?>;

/// Non-empty string at [key], else null (never "" — the view treats a blank exactly
/// like an absent value).
String? fieldProgressStr(FieldProgressEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// Finite number at [key] (number or numeric string), else null. Never a fabricated 0.
num? fieldProgressNum(FieldProgressEnt e, String key) {
  final Object? v = e[key];
  if (v is num) return v.isFinite ? v : null;
  if (v is String && v.trim().isNotEmpty) {
    final num? n = num.tryParse(v.trim());
    return n != null && n.isFinite ? n : null;
  }
  return null;
}

/// One subcon contract (typed projection of the opaque contractWire row).
class FieldProgressContract {
  const FieldProgressContract({
    required this.id,
    required this.no,
    required this.vendorId,
    required this.vendorName,
  });

  /// Real contract id — the path id of the periods read.
  final String id;

  /// Real contract document number (`no`), or null → em-dash. Never the uuid.
  final String? no;

  /// Real `vendor_id` FK, or null.
  final String? vendorId;

  /// Vendor name resolved from GET /vendors (the documented FK-as-string join the
  /// merged st_grlist port uses). Null when the vendor is not in the fetched page →
  /// the view renders an em-dash, never an id dressed up as a company name.
  final String? vendorName;
}

/// Parse one contract row, joining its vendor name from [vendorNames].
FieldProgressContract parseContract(
  FieldProgressEnt e,
  Map<String, String> vendorNames,
) {
  final String? vendorId =
      fieldProgressStr(e, 'vendor_id') ?? fieldProgressStr(e, 'vendorId');
  return FieldProgressContract(
    id: fieldProgressStr(e, 'id') ?? '',
    no: fieldProgressStr(e, 'no'),
    vendorId: vendorId,
    vendorName: vendorId == null ? null : vendorNames[vendorId],
  );
}

/// Build an id → vendor-name map from the opaque GET /vendors rows. Rows missing
/// either half are skipped (nothing is invented to fill the gap).
Map<String, String> fieldProgressVendorNames(List<FieldProgressEnt> vendors) {
  final Map<String, String> out = <String, String>{};
  for (final FieldProgressEnt v in vendors) {
    final String? id = fieldProgressStr(v, 'id');
    final String? name = fieldProgressStr(v, 'name');
    if (id != null && name != null) out[id] = name;
  }
  return out;
}

/// The tenant's contracts, un-addressable rows dropped and ordered by document
/// number (a null/blank `no` sorts last) — a stable, honest presentation order; the
/// wire carries nothing else that would justify one.
List<FieldProgressContract> parseContracts(
  List<FieldProgressEnt> rows,
  List<FieldProgressEnt> vendors,
) {
  final Map<String, String> names = fieldProgressVendorNames(vendors);
  final List<FieldProgressContract> out = rows
      .map((FieldProgressEnt e) => parseContract(e, names))
      .where((FieldProgressContract c) => c.id.isNotEmpty)
      .toList();
  out.sort((FieldProgressContract a, FieldProgressContract b) {
    final String an = a.no ?? '';
    final String bn = b.no ?? '';
    if (an.isEmpty != bn.isEmpty) return an.isEmpty ? 1 : -1;
    return an.compareTo(bn);
  });
  return out;
}

/// The only status `POST /periods/{id}/deliver` accepts (subcon.ts L754-759: "only a
/// pending work period can be delivered"). Anything else 409s, so the screen offers
/// the action on `pending` periods ONLY — an affordance that cannot succeed is a
/// promise, not a control.
const String kDeliverableStatus = 'pending';

/// The sidecar field whose dict key labels a work-period status, or null when the
/// status has no label — the view then renders an em-dash.
///
/// `status` is a WIRE column: `pending | delivered | inspecting | passed | rejected
/// | paid` are English machine codes, and this app's only language is Thai. Printing
/// one raw would put an untranslated enum in front of a foreman, which §0 rule 2
/// forbids (every word of UI copy must be a key from i18n-full.json), so each is
/// mapped to an EXISTING dict key — nothing minted (B-296 mints no status label).
///
/// The 6 wire statuses collapse onto 4 labels, and the collapse is not invented
/// here: it is exactly the merged WEB port's `mapPeriodStatus`
/// (apps/web/src/screens/subcon/subcon-accept-rows.ts L196-217) with its own key map
/// (subcon-accept.tsx L108-113), so the two clients cannot describe the same period
/// differently:
///   pending              → subcon.statusNotReached
///   delivered|inspecting → subcon.statusRequested
///   passed|paid          → subcon.kpiAccepted
///   rejected             → subcon.rejectBtn
/// (the resolved Thai of each is asserted byte-exact against the sacred dict in
/// test/screens/field_progress/field_progress_sidecar_test.dart — this file states
/// only the key, never a translation.)
///
/// One deliberate departure from the web: the web's `default:` folds an UNKNOWN
/// status into `notReached`. Here an unknown status returns null → em-dash. "Not
/// reached yet" is a claim about the period, and a status this build does not know
/// is not evidence for it.
String? statusLabelField(String? status) => switch (status) {
  'pending' => 'statusNotReached',
  'delivered' || 'inspecting' => 'statusRequested',
  'passed' || 'paid' => 'statusAccepted',
  'rejected' => 'statusRejected',
  _ => null,
};

/// One work period (typed projection of the opaque enrichPeriodRow).
class FieldProgressPeriod {
  const FieldProgressPeriod({
    required this.id,
    required this.seq,
    required this.status,
    required this.projectName,
  });

  /// Real period id — the path id of the deliver POST.
  final String id;

  /// Real `seq` — the period ordinal the view composes its label around. Null when
  /// the column is absent → the view omits the ordinal rather than guessing one.
  final int? seq;

  /// Real `status` column: pending | delivered | inspecting | passed | rejected |
  /// paid. This is what the screen shows WHERE THE PROTOTYPE SHOWS A PERCENTAGE —
  /// see the file header. It is a WIRE value and is NEVER rendered raw: the view
  /// resolves it through [statusLabelField] to an existing dict key, or em-dashes
  /// it. Null → em-dash.
  final String? status;

  /// Real `project_name` resolved server-side, or null → em-dash.
  final String? projectName;

  /// True when this period can actually be delivered.
  bool get deliverable => status == kDeliverableStatus;

  /// NOT A FIELD — documentation of a deliberate withholding, kept next to the data
  /// it is about. See the file header: `pct` is a TARGET share under the percent
  /// basis, not completion, and no count-based ratio may stand in for it. The
  /// percentage slot renders an em-dash.
  static const String percentComplete = 'withheld — see the file header';
}

/// Parse one period row.
FieldProgressPeriod parsePeriod(FieldProgressEnt e) {
  final num? seq = fieldProgressNum(e, 'seq');
  return FieldProgressPeriod(
    id: fieldProgressStr(e, 'id') ?? '',
    seq: seq?.toInt(),
    status: fieldProgressStr(e, 'status'),
    projectName: fieldProgressStr(e, 'project_name'),
  );
}

/// The contract's periods in `seq` order (the server already sorts them that way —
/// subcon.ts L727 — and this keeps that true regardless of transport). Rows with no
/// id are dropped: they could never be delivered and carry nothing honest to show.
List<FieldProgressPeriod> parsePeriods(List<FieldProgressEnt> rows) {
  final List<FieldProgressPeriod> out = rows
      .map(parsePeriod)
      .where((FieldProgressPeriod p) => p.id.isNotEmpty)
      .toList();
  out.sort(
    (FieldProgressPeriod a, FieldProgressPeriod b) =>
        (a.seq ?? 0).compareTo(b.seq ?? 0),
  );
  return out;
}

/// Body for `POST /periods/{id}/deliver`.
///
/// Both arrays are EMPTY, and that is honest rather than lazy: the mobile app has no
/// image picker and no upload seam, and `GET /subcon-contracts/{id}/periods` does not
/// return the period's acceptance, so this screen can neither capture a photo/doc
/// reference nor read one that already exists. Sending a fabricated reference would
/// put a non-existent file id on the acceptance record.
///
/// Why the empty arrays cannot clear anything: the handler UPSERTS the acceptance
/// with the body's docs/photos (subcon.ts L768-780), but it only runs on a `pending`
/// period — and an acceptance is only ever created BY a deliver or an inspect, both
/// of which move the period past `pending`. So a period this screen can act on has no
/// acceptance to overwrite. BLOCKERS.md B-297 records the missing attachment seam.
Map<String, Object?> deliverPayload() => <String, Object?>{
  'docs': const <Object?>[],
  'photos': const <Object?>[],
};

/// The honest lifecycle of the delivery, as the screen renders it.
///
///   * [idle]    — nothing submitted yet.
///   * [sending] — UI-transient, a submit is in flight.
///   * [sent]    — the server durably accepted the delivery (2xx).
///   * [queued]  — offline / transient failure: kept in the queue, will retry.
///                 NEVER shown as a success (BLOCKERS.md B-268 option (a)).
///   * [failed]  — a permanent (4xx) rejection: kept + surfaced, no retry. A replay
///                 of an already-delivered period lands here by design: the endpoint
///                 409s on a non-pending period (subcon.ts L754-759), so a duplicate
///                 self-rejects instead of delivering twice.
enum FieldDeliverState { idle, sending, sent, queued, failed }

/// Resolve the honest post-drain state of the op [opId] from the drain [report] and
/// the ops still [due] in the queue (pending + failed).
///
/// Same resolution as pm_notes_agg.resolveNotesSaveState: the report is authoritative
/// when it touched the op this pass; otherwise the queue is the source of truth (gone
/// = synced, `failed` = dead-letter, `pending` = queued).
FieldDeliverState resolveDeliverState(
  String opId,
  DrainReport report,
  List<SyncOperation> due,
) {
  final SyncAttempt? attempt = report.attemptFor(opId);
  if (attempt != null) {
    switch (attempt.outcome) {
      case SyncOutcome.synced:
        return FieldDeliverState.sent;
      case SyncOutcome.permanentlyFailed:
        return FieldDeliverState.failed;
      case SyncOutcome.deferred:
        return FieldDeliverState.queued;
    }
  }
  for (final SyncOperation op in due) {
    if (op.id == opId) {
      return op.status == SyncOpStatus.failed
          ? FieldDeliverState.failed
          : FieldDeliverState.queued;
    }
  }
  return FieldDeliverState.sent; // removed from the queue = synced
}
