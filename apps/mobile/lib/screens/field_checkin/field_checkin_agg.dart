// Pure derivation for the mobile labour check-in (route `field-checkin`).
//
// Ported from pototype/mobile-screens.jsx MFieldCheckin (L534-578). The prototype is
// 100% INERT — no state, no handler, a hardcoded name, a hardcoded "· 08:00" on the
// button and a literal geofence readout — so nothing here transcribes its numbers.
// Every value comes from the wire:
//   GET /me               -> the caller's user id
//   GET /labor/workers    -> the worker row whose user_id IS that caller (labor.ts
//                            findWorkerByUserId is the same match the server's
//                            self-service door makes, so the screen shows exactly
//                            what the server will accept)
//   GET /labor/attendance -> the caller's row for TODAY, which decides whether the
//                            next action is a check-in or a check-out
//
// WHAT IS NOT HERE, by Wei's ruling on B-437 (option ก): the geofence chip (no site
// coordinate exists to measure a distance from) and the "today's assigned work"
// section (no endpoint carries that subject). Neither is approximated.
//
// ASCII-only, no Thai (i18n-guard) — every string the screen shows is a sidecar key.

/// One opaque wire row, as the repositories hand it over.
typedef WireRow = Map<String, Object?>;

/// Read a string field off an opaque row; null when absent/blank.
String? _str(Object? v) {
  if (v is String) {
    final String t = v.trim();
    return t.isEmpty ? null : t;
  }
  return v?.toString();
}

/// The worker the caller IS, as the profile card shows them.
class CheckinWorker {
  const CheckinWorker({
    required this.id,
    required this.name,
    this.skill,
    this.team,
    required this.active,
  });

  final String id;
  final String? name;

  /// worker.skill — the closest real column to the prototype's hardcoded
  /// "Site Engineer" role line. Null renders as an em-dash, never as that literal.
  final String? skill;

  /// worker.team — the second half of the role line. Null renders as an em-dash.
  final String? team;

  /// worker.active. The server refuses a self-service check-in off the roster
  /// (labor.ts: "this worker record is not active"), so the screen must not offer
  /// a button that is guaranteed to 403.
  final bool active;
}

/// Today's attendance row for that worker, narrowed to what the screen needs.
class CheckinDay {
  const CheckinDay({
    required this.id,
    required this.day,
    this.checkedInAt,
    this.checkedOutAt,
  });

  final String id;
  final String day;
  final String? checkedInAt;
  final String? checkedOutAt;
}

/// What the two buttons should do right now.
enum CheckinAction {
  /// No worker row is linked to this account — the server's self-service door
  /// cannot open, so neither button is offered (B-438).
  noWorker,

  /// Linked but off the roster; the server refuses either way.
  inactive,

  /// Nothing recorded today: check-in is the only action.
  checkIn,

  /// Checked in and not yet out: check-out is the only action.
  checkOut,

  /// The day is closed. Both buttons are inert and the times are shown.
  done,
}

/// Find the worker row that belongs to [userId], the way the server's self-service
/// door does (labor.ts findWorkerByUserId). Returns null when no row is linked —
/// which is EVERY row in the current seed (B-438), so this path is the common one.
CheckinWorker? findSelfWorker(List<WireRow> workers, String? userId) {
  if (userId == null || userId.isEmpty) return null;
  for (final WireRow w in workers) {
    if (_str(w['user_id'] ?? w['userId']) != userId) continue;
    final String? id = _str(w['id']);
    if (id == null) continue;
    return CheckinWorker(
      id: id,
      name: _str(w['name']),
      skill: _str(w['skill']),
      team: _str(w['team']),
      active: w['active'] != false,
    );
  }
  return null;
}

/// The caller's user id out of GET /me. The payload nests it under `user`.
String? callerUserId(WireRow? me) {
  if (me == null) return null;
  final Object? user = me['user'];
  if (user is Map) {
    final Object? id = user['id'];
    if (id != null) return _str(id);
  }
  return _str(me['user_id'] ?? me['id']);
}

/// The attendance row for [workerId] on [day], or null when the worker has none.
///
/// The list endpoint ignores the `filter` parameter the contract declares (B-435),
/// so the whole tenant register arrives and the match happens here. That is a
/// measured server gap, not a client shortcut.
CheckinDay? findToday(List<WireRow> attendance, String workerId, String day) {
  for (final WireRow a in attendance) {
    if (_str(a['worker_id'] ?? a['workerId']) != workerId) continue;
    if (_str(a['day']) != day) continue;
    final String? id = _str(a['id']);
    if (id == null) continue;
    return CheckinDay(
      id: id,
      day: day,
      checkedInAt: _str(a['checked_in_at'] ?? a['checkedInAt']),
      checkedOutAt: _str(a['checked_out_at'] ?? a['checkedOutAt']),
    );
  }
  return null;
}

/// Which action the screen offers, given who the caller is and what today holds.
CheckinAction nextAction(CheckinWorker? worker, CheckinDay? today) {
  if (worker == null) return CheckinAction.noWorker;
  if (!worker.active) return CheckinAction.inactive;
  if (today == null || today.checkedInAt == null) return CheckinAction.checkIn;
  if (today.checkedOutAt == null) return CheckinAction.checkOut;
  return CheckinAction.done;
}

/// The client idempotency key for a worker's day.
///
/// DETERMINISTIC on purpose. The checkout endpoint finds the row by
/// (worker_id, day, idempotency_key) and the key is NOT on the attendance wire
/// (labor.ts attendanceWire), so a random key would have to be persisted or the
/// day could never be closed after an app restart. Deriving it from the worker and
/// the day makes it recoverable with no storage, and its uniqueness is exactly the
/// granularity the server's partial unique index already enforces: at most one
/// uncosted row per worker per day.
String checkinKey(String workerId, String day) => 'checkin:$workerId:$day';

/// Split a GpsSource fix ("<lat>, <long>") into the two numbers the endpoint takes.
///
/// Returns null when the fix is absent or does not parse. The endpoint requires
/// checkin_lat and checkin_lng TOGETHER (labor.ts optCoordPair) and 400s a present
/// but unparseable one, so a half-read fix must become "no coordinate", never a
/// single field.
({double lat, double lng})? splitFix(String? fix) {
  if (fix == null) return null;
  final List<String> parts = fix.split(',');
  if (parts.length != 2) return null;
  final double? lat = double.tryParse(parts[0].trim());
  final double? lng = double.tryParse(parts[1].trim());
  if (lat == null || lng == null) return null;
  return (lat: lat, lng: lng);
}

/// The clock time of an ISO instant as HH:mm in the device's own zone, or null.
///
/// The prototype printed a hardcoded "08:00"; this prints the stored instant or
/// nothing at all.
String? clockOf(String? iso) {
  if (iso == null) return null;
  final DateTime? t = DateTime.tryParse(iso);
  if (t == null) return null;
  final DateTime local = t.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}';
}

/// The calendar day the writes are stamped with, as the endpoint's 'YYYY-MM-DD'.
String dayOf(DateTime now) {
  final DateTime d = now.toLocal();
  return '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
