// Pure parse + honest derivations for the mobile "my PM jobs" screen (route
// `pm-jobs`, pototype/mobile-pm.jsx MPMJobs L7-49). money = NONE (read-only list).
//
// The prototype is a MOCK: its local `jobs` array (L9-14) denormalises every work
// order into rich display fields — a human WO number (`no`), a PM/CM `type`, a
// stored `status`, a scheduled `time`, a device-GPS `dist`, an `urgent` flag, and
// a full asset `name` + `site`. Per §0 rule 3 (strip mock mechanics) NONE of that
// denormalised display is reproduced. This module parses the OPAQUE Entity rows
// the real GET /pm/workorders handler returns (apps/api/src/routes/pm.ts
// workOrderWire) into typed rows and derives ONLY what the real wire columns
// support. No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
//
// This mirrors apps/web/src/screens/pm/wo-rows.ts, the already-merged web port of
// the same endpoint (same wire, same joins, same status derivation). The real WO
// wire row is { id, asset_id, template_id, tech, checkin_gps, items[{label,
// result}], cause, fix, advice, customer_sign }; it carries NO human number, NO
// PM/CM type, NO stored status, NO scheduled time, NO distance, and NO asset name/
// site. So:
//   - the asset NAME + SITE are JOINED from the real GET /pm/assets catalogue
//     (assetWire { id, name, site, next_due, ... }) by asset_id; a missing hop
//     stays "" so the view renders an honest em-dash (never a raw uuid, never a
//     fabricated string).
//   - the lifecycle STATUS is DERIVED from real columns only (deriveStatus), the
//     same real-column interpretation the merged web port uses (FLAG for Wei).
//   - the human WO number, PM/CM type, scheduled time and GPS distance have NO
//     honest wire → the view em-dashes / omits them (never invented).
//   - order preserves the server order (the wire has no sort key of its own).
//
// GET /pm/workorders returns EVERY tenant WO (no per-user filter exists on the
// endpoint). The prototype header names a single technician; that per-user scope
// has no honest wire, so this shows the list the endpoint returns (honest), never
// a fabricated "mine" subset. A `done` WO is not part of this active worklist:
// the prototype's status vocabulary (stMeta L16) has only open/inprogress/overdue
// and its mock data demonstrates no closed job, so parseJobs EXCLUDES done rows —
// honouring the prototype's demonstrated scope rather than inventing a done badge.

/// An opaque contract Entity — GET /pm/workorders and /pm/assets rows are
/// `{ [k]: unknown }` (the wire models opaque Entity; no typed client fields).
typedef PmEnt = Map<String, Object?>;

/// Non-empty string at [key] (accepts snake_case or camelCase), else "".
String pmStr(PmEnt e, String key) {
  final Object? v = e[key];
  return v is String
      ? v
      : v == null
      ? ''
      : '$v';
}

/// First non-empty of [keys] (server snake_case first, camelCase fallback), else "".
String pmStrAny(PmEnt e, List<String> keys) {
  for (final String k in keys) {
    final String v = pmStr(e, k);
    if (v.isNotEmpty) return v;
  }
  return '';
}

/// The derived WO lifecycle (mock `status`, re-derived from real columns — FLAG,
/// mirrors web wo-rows.WoStatus). `done` is derivable but excluded from this list.
enum PmJobStatus { open, inProgress, overdue, done }

/// A PM asset as the WO join reads it (GET /pm/assets row — real columns only).
class PmAssetRef {
  const PmAssetRef({
    required this.id,
    required this.name,
    required this.site,
    required this.nextDue,
  });

  final String id;

  /// Asset display name (assetWire.name) — the card's primary line.
  final String name;

  /// Asset site (assetWire.site) — the card's location line.
  final String site;

  /// Next-due date, ISO "YYYY-MM-DD" (or "") — the WO's overdue signal.
  final String nextDue;
}

/// Parse one opaque /pm/assets Entity row into a typed [PmAssetRef].
PmAssetRef parseAsset(PmEnt e) => PmAssetRef(
  id: pmStr(e, 'id'),
  name: pmStr(e, 'name'),
  site: pmStr(e, 'site'),
  nextDue: pmStrAny(e, <String>['next_due', 'nextDue']),
);

/// Build an asset-id -> [PmAssetRef] map (the join source). Empty ids are skipped.
Map<String, PmAssetRef> buildAssetMap(Iterable<PmAssetRef> assets) {
  final Map<String, PmAssetRef> map = <String, PmAssetRef>{};
  for (final PmAssetRef a in assets) {
    if (a.id.isNotEmpty) map[a.id] = a;
  }
  return map;
}

/// True when any checklist line carries a filled result (an in-progress signal).
/// The WO wire `items` is a list of `{ label, result }`; an unchecked row omits or
/// blanks `result` (pm.ts CHECKLIST_RESULTS), so "" is not-yet-checked.
bool anyItemResult(Object? items) {
  if (items is! List) return false;
  for (final Object? it in items) {
    if (it is Map) {
      final Object? result = it['result'];
      if (result is String && result.isNotEmpty) return true;
    }
  }
  return false;
}

/// Derive the WO lifecycle from REAL columns only (FLAG, Wei override — mirrors
/// web wo-rows.deriveStatus). [nextDue] is the JOINED asset next-due ("" when the
/// asset is absent — then overdue cannot be decided and the WO is "open", honest).
/// [today] is ISO "YYYY-MM-DD"; the ISO lexicographic compare is chronological for
/// that fixed shape.
PmJobStatus deriveStatus({
  required String customerSign,
  required String checkinGps,
  required Object? items,
  required String nextDue,
  required String today,
}) {
  if (customerSign.isNotEmpty) return PmJobStatus.done;
  if (checkinGps.isNotEmpty || anyItemResult(items)) {
    return PmJobStatus.inProgress;
  }
  if (nextDue.isNotEmpty && nextDue.compareTo(today) < 0) {
    return PmJobStatus.overdue;
  }
  return PmJobStatus.open;
}

/// One resolved PM job row the list consumes (WO wire + asset join + status). The
/// human number / type / time / distance are omitted (no honest wire).
class PmJobRow {
  const PmJobRow({
    required this.id,
    required this.assetId,
    required this.name,
    required this.site,
    required this.status,
  });

  /// The WO id (uuid). Not shown raw — the view em-dashes the human number slot.
  final String id;

  /// The WO's asset_id (the join key).
  final String assetId;

  /// Joined asset name ("" when the asset is absent → the view em-dashes it).
  final String name;

  /// Joined asset site ("" when absent → the view em-dashes it).
  final String site;

  /// Derived lifecycle status (drives the status badge tone + label).
  final PmJobStatus status;
}

/// Resolve one opaque /pm/workorders row into a [PmJobRow]: join the asset
/// (name/site/next_due) then derive the status. Every missing join hop stays ""
/// so the view em-dashes it (never a fabricated value / raw uuid).
PmJobRow resolveJob(PmEnt wo, Map<String, PmAssetRef> assetMap, String today) {
  final String assetId = pmStrAny(wo, <String>['asset_id', 'assetId']);
  final PmAssetRef? asset = assetMap[assetId];
  return PmJobRow(
    id: pmStr(wo, 'id'),
    assetId: assetId,
    name: asset?.name ?? '',
    site: asset?.site ?? '',
    status: deriveStatus(
      customerSign: pmStrAny(wo, <String>['customer_sign', 'customerSign']),
      checkinGps: pmStrAny(wo, <String>['checkin_gps', 'checkinGps']),
      items: wo['items'],
      nextDue: asset?.nextDue ?? '',
      today: today,
    ),
  );
}

/// Resolve a whole page of WOs against the asset catalogue, then DROP the `done`
/// rows (this screen is the active worklist — see the file header). Server order
/// is preserved (the wire carries no sort key of its own).
List<PmJobRow> parseJobs(
  List<PmEnt> workOrders,
  List<PmEnt> assets,
  String today,
) {
  final Map<String, PmAssetRef> assetMap = buildAssetMap(
    assets.map(parseAsset),
  );
  return <PmJobRow>[
    for (final PmEnt wo in workOrders)
      if (resolveJob(wo, assetMap, today) case final PmJobRow r
          when r.status != PmJobStatus.done)
        r,
  ];
}

/// Today as ISO "YYYY-MM-DD" in local time (mirrors web wo-rows.todayISO but
/// local, matching the device the technician stands on).
String todayIso([DateTime? now]) {
  final DateTime d = now ?? DateTime.now();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}
