// Pure parse + honest derivations shared by the four mobile AFTER-SALES SERVICE
// screens (routes `srv-track` / `tech-jobs` / `srv-new` / `tech-close`;
// pototype/mobile-screens.jsx MSrvTrack L125-192, MTechJobs L198-257,
// MSrvNewReport L61-121, MTechClose L263-311).
//
// money = NONE — and that is not an assumption: apps/api/src/routes/sales-service.ts
// L16-19 states it ("a service ticket posts no money — service_ticket has no money
// column"), and none of the four screens reads, derives or sends an amount. There is
// no currency_code anywhere in this group.
//
// ONE module for four screens because they share ONE endpoint family and ONE state
// machine. The pm_checkin / pm_checklist / pm_notes precedent (a self-contained agg
// per screen) applies to screens that only share a THEME; these four share the
// machine itself, and duplicating it four times is exactly the drift the round was
// told to avoid. The multi-screen-group precedent is lib/screens/pr_action (approve
// + reject over one shared agg + repository + chrome).
//
// The real wire is the opaque Entity GET /sales/service returns
// (sales-service.ts ticketWire L146-165):
//   { id, no, unit_id, customer_id, channel, category, title, priority, status,
//     assignee_user_id, opened_date, scheduled_date, warranty,
//     warranty_months_remaining, created_at }
// server-ordered newest-first (byCreatedDesc L169-173).
//
// WHAT THE PROTOTYPE FAKES AND THIS MODULE DOES NOT REPRODUCE (§0 rule 3):
//   - MSrvTrack's timeline carries a human time on every step (L141-145): two dates,
//     a technician name on the schedule step, a "today HH:MM", and two pending
//     markers. service_ticket stores only opened_date + scheduled_date — there is NO
//     fixing/fixed/closed timestamp column at all, so steps 3-5 carry no date, ever
//     (see [timelineFor]).
//   - MSrvTrack's history rows carry a star rating (L163-165 `rating: 5`). There is
//     NO rating column: the close handler's own comment says so and says that round
//     did not invent one (sales-service.ts L354-356). The rating is DROPPED, never
//     derived, never defaulted.
//   - MTechJobs' third stat tile is a star rating (L216) — the same absent column.
//     Dropped; the two derivable tiles (today's schedule count, urgent count) are
//     real counts off real columns.
//   - MTechJobs' per-status button list (L242-250) is hardcoded there and includes
//     a reschedule button (L244) and a fix-AND-close-in-one-tap button (L247).
//     Neither exists: the machine has no reschedule op, and no op moves `fixing` to
//     `closed`. [nextServiceTransition] derives the ONE legal op from the status, so
//     the buttons cannot drift from the server's machine (BLOCKERS.md B-294).
//   - MSrvNewReport's form has a description textarea (L89), a required photo strip
//     (L94) and a preferred-slot field (L106). service_ticket has NO description
//     column, NO photo column, and no column meaning "the resident's preferred slot"
//     (packages/db/src/schema/extensions.ts L344-373 — the whole column list).
//     [newTicketBody] therefore sends the real create keys only (BLOCKERS.md B-293).
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.
import '../pr_detail/pr_detail_agg.dart' show formatWireDate;

/// An opaque contract Entity — GET /sales/service rows are `{ [k]: unknown }` (the
/// wire models an opaque Entity; the generated client declares no fields, so the
/// screens read raw maps exactly as the merged web port reads Record<string,unknown>).
typedef ServiceEnt = Map<String, Object?>;

/// Honest placeholder for any value the wire does not carry (never invented).
const String kServiceDash = '—'; // em dash

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

/// String at [key] of an opaque row; "" when absent/null (never "null").
String svcStr(ServiceEnt e, String key) {
  final Object? v = e[key];
  if (v == null) return '';
  return v is String ? v : '$v';
}

/// First non-empty of [keys] (server snake_case first, camelCase fallback), else "".
String svcStrAny(ServiceEnt e, List<String> keys) {
  for (final String k in keys) {
    final String v = svcStr(e, k);
    if (v.isNotEmpty) return v;
  }
  return '';
}

/// Truthy wire value as a bool (accepts true / "true" / 1 / "1"), mirroring the
/// merged web port's `bool()` (sales-service-rows.ts).
bool svcBool(Object? v) => v == true || v == 'true' || v == 1 || v == '1';

/// Integer field, or null when absent / non-numeric. Used ONLY for the SERVER-derived
/// `warranty_months_remaining`; nothing here computes a warranty from a date.
int? svcIntOrNull(Object? v) {
  if (v == null || v == '') return null;
  if (v is int) return v;
  if (v is double) return v.isFinite ? v.truncate() : null;
  final num? n = num.tryParse('$v');
  return n == null || !n.isFinite ? null : n.truncate();
}

/// A wire date column rendered for a human, or [kServiceDash].
///
/// Reuses the MERGED house formatter, [formatWireDate] (pr_detail_agg.dart L203):
/// locale-neutral numeric `d/m/yyyy` — no fabricated Thai month/era text, the same
/// numeric philosophy the notif and pr-detail ports already ship, so a date in this
/// group reads identically to one on pr-detail. Nothing is re-implemented here.
///
/// The prototype prints a Thai abbreviated month plus a clock time
/// (mobile-screens.jsx L141). That form needs a Thai month table this repo may not
/// invent AND a time the wire does not carry (`opened_date` / `scheduled_date` are
/// DATE columns), so it is not reproduced — §0 rule 3.
///
/// Anything that is not a date at all — "", a null-shaped value, a free-text string —
/// em-dashes rather than leaking the raw wire string to the screen.
String serviceDateText(String raw) => formatWireDate(raw) ?? kServiceDash;

// ---------------------------------------------------------------------------
// The SV-3 status machine (received → scheduled → fixing → fixed → closed)
// ---------------------------------------------------------------------------

/// The 5 statuses in machine order (sales-service.ts L58-62 RECEIVED..CLOSED, and
/// the merged web port's SERVICE_STATUSES).
const List<String> kServiceStatuses = <String>[
  'received',
  'scheduled',
  'fixing',
  'fixed',
  'closed',
];

/// The 1-based timeline step of [status], or null when the value is not one of the
/// five (an unknown status is honest-unknown, never coerced to step 1).
int? serviceStep(String status) {
  final int i = kServiceStatuses.indexOf(status);
  return i < 0 ? null : i + 1;
}

/// The four status action-ops. Each is valid from exactly ONE predecessor
/// (sales-service.ts L293-311).
enum ServiceOp { schedule, start, fix, close }

/// The URL segment of [op] — `POST /sales/service/:id/{segment}`.
String serviceOpPath(ServiceOp op) => switch (op) {
  ServiceOp.schedule => 'schedule',
  ServiceOp.start => 'start',
  ServiceOp.fix => 'fix',
  ServiceOp.close => 'close',
};

/// One legal move of the machine: the op to POST and the status it lands on.
class ServiceTransition {
  const ServiceTransition(this.op, this.next);

  final ServiceOp op;

  /// The status the server will store — used ONLY to label the button; the screen
  /// never writes it locally (the server is the authority on status).
  final String next;
}

/// The single legal next transition for [status], or null when there is none.
///
/// This is the ONE place the machine lives on the client. `closed` is terminal and
/// an unknown status yields null, so no screen can offer an illegal jump. The server
/// still folds the predecessor into the UPDATE WHERE (sales-service.ts L282-288), so
/// a stale tap 409s — this is only the affordance gate, never the guarantee.
ServiceTransition? nextServiceTransition(String status) => switch (status) {
  'received' => const ServiceTransition(ServiceOp.schedule, 'scheduled'),
  'scheduled' => const ServiceTransition(ServiceOp.start, 'fixing'),
  'fixing' => const ServiceTransition(ServiceOp.fix, 'fixed'),
  'fixed' => const ServiceTransition(ServiceOp.close, 'closed'),
  _ => null,
};

// ---------------------------------------------------------------------------
// The ticket
// ---------------------------------------------------------------------------

/// One service ticket, narrowed from its opaque wire row. Every field is a REAL
/// column of `service_ticket` (or, for [warrantyMonthsRemaining], the server's own
/// read-time derivation) — nothing here is invented.
class ServiceTicket {
  const ServiceTicket({
    required this.id,
    required this.no,
    required this.unitId,
    required this.customerId,
    required this.channel,
    required this.category,
    required this.title,
    required this.priority,
    required this.status,
    required this.assigneeUserId,
    required this.openedDate,
    required this.scheduledDate,
    required this.warranty,
    required this.warrantyMonthsRemaining,
  });

  final String id;

  /// The server-allocated document number, `SR-<year>-<NNNN>` (allocServiceNo,
  /// sales-service.ts L176-190). REAL — the screens print it, never a uuid.
  final String no;

  /// The sold unit's project_node uuid. There is NO endpoint that turns it into a
  /// unit CODE (no /sales/units; the hierarchy read needs a project id), so every
  /// screen em-dashes it — exactly as the merged web port does
  /// (apps/web/src/screens/sales/sales-service-rows.ts header). Kept here because
  /// it is the real key the unit-scoped history and the create both need.
  final String unitId;

  final String customerId;
  final String channel;

  /// Free-text category as STORED (the seed vocabulary is the same one the merged web
  /// port renders, packages/db/src/seed/index.ts L727-735). Verbatim, never re-worded.
  final String category;

  /// The problem line. The only free-text column on the table, and what
  /// `POST /sales/service` requires (sales-service.ts L228-229).
  final String title;

  /// Raw priority (`high` / `normal` / `low` in the seed); kept as a string.
  final String priority;

  /// Raw status; normally one of [kServiceStatuses].
  final String status;

  final String assigneeUserId;

  /// Intake date `YYYY-MM-DD`, or "" when null.
  final String openedDate;

  /// Scheduled visit date `YYYY-MM-DD`, or "" when not scheduled.
  final String scheduledDate;

  /// The covered/expired flag column, serialized as-is.
  final bool warranty;

  /// SERVER-derived remaining warranty months (sales-service.ts warrantyRemaining
  /// L98-110). NEVER recomputed here from a date — the screens print this number or
  /// an em-dash when it is null.
  final int? warrantyMonthsRemaining;
}

/// Narrow one opaque `/sales/service` row into a [ServiceTicket]. Accepts snake_case
/// (the server convention) or camelCase, mirroring the merged web `toTicketRow`.
ServiceTicket parseTicket(ServiceEnt e) => ServiceTicket(
  id: svcStr(e, 'id'),
  no: svcStr(e, 'no'),
  unitId: svcStrAny(e, <String>['unit_id', 'unitId']),
  customerId: svcStrAny(e, <String>['customer_id', 'customerId']),
  channel: svcStr(e, 'channel'),
  category: svcStr(e, 'category'),
  title: svcStr(e, 'title'),
  priority: svcStr(e, 'priority'),
  status: svcStr(e, 'status'),
  assigneeUserId: svcStrAny(e, <String>['assignee_user_id', 'assigneeUserId']),
  openedDate: svcStrAny(e, <String>['opened_date', 'openedDate']),
  scheduledDate: svcStrAny(e, <String>['scheduled_date', 'scheduledDate']),
  warranty: svcBool(e['warranty']),
  warrantyMonthsRemaining: svcIntOrNull(
    e['warranty_months_remaining'] ?? e['warrantyMonthsRemaining'],
  ),
);

/// Narrow a whole page. Server order (newest-first) is preserved — the wire carries
/// no sort key the client could re-derive.
List<ServiceTicket> parseTickets(List<ServiceEnt> rows) => <ServiceTicket>[
  for (final ServiceEnt e in rows) parseTicket(e),
];

/// The ticket with [id], or null. An empty [id] yields null (honest "no selection").
ServiceTicket? findTicket(List<ServiceTicket> rows, String id) {
  if (id.isEmpty) return null;
  for (final ServiceTicket t in rows) {
    if (t.id == id) return t;
  }
  return null;
}

/// The ticket `srv-track` follows: the one with [id] when the flow supplied one,
/// otherwise the FIRST row — which is the newest, because the server orders the
/// register created_at desc (sales-service.ts byCreatedDesc). Null when the register
/// is empty, or when [id] names a ticket this tenant cannot see (honest-empty, never
/// a silent fall-through to somebody else's ticket).
ServiceTicket? trackedTicket(List<ServiceTicket> rows, String? id) {
  if (id != null && id.isNotEmpty) return findTicket(rows, id);
  return rows.isEmpty ? null : rows.first;
}

/// The repair history of [current]'s UNIT — every OTHER ticket on the same unit_id,
/// server order preserved (prototype L161-178 — the register's own per-unit history).
///
/// A ticket with no unit_id yields an EMPTY history rather than "every other ticket":
/// a unit-scoped history cannot be built without a unit, and widening it to the whole
/// tenant would show the resident other people's repairs. Honest-empty, not guessed.
List<ServiceTicket> unitHistory(
  List<ServiceTicket> rows,
  ServiceTicket current,
) {
  if (current.unitId.isEmpty) return const <ServiceTicket>[];
  return <ServiceTicket>[
    for (final ServiceTicket t in rows)
      if (t.id != current.id && t.unitId == current.unitId) t,
  ];
}

// ---------------------------------------------------------------------------
// srv-track — the 5-step timeline
// ---------------------------------------------------------------------------

/// One rendered timeline step (prototype L140-158).
class ServiceTimelineStep {
  const ServiceTimelineStep({
    required this.status,
    required this.date,
    required this.done,
    required this.current,
  });

  /// The machine status this step stands for — the label key is looked up from it.
  final String status;

  /// The REAL date column behind this step, or "" when none exists. Only `received`
  /// (opened_date) and `scheduled` (scheduled_date) have one; `fixing` / `fixed` /
  /// `closed` have NO timestamp column on service_ticket, so they are always "" and
  /// the view em-dashes them. The prototype's pending marker (L144-145) is mock chrome
  /// for a step not yet reached; an em-dash covers both cases truthfully.
  final String date;

  /// True when the ticket has reached this step (step index <= the ticket's step).
  final bool done;

  /// True for the ticket's CURRENT step (the prototype's accent-coloured row).
  final bool current;
}

/// The 5 timeline steps for [t]. An unrecognised status marks nothing done — the
/// ticket's progress is then unknown, and pretending it is at step 1 would be a
/// fabrication.
List<ServiceTimelineStep> timelineFor(ServiceTicket t) {
  final int? at = serviceStep(t.status);
  return <ServiceTimelineStep>[
    for (int i = 0; i < kServiceStatuses.length; i++)
      ServiceTimelineStep(
        status: kServiceStatuses[i],
        date: switch (kServiceStatuses[i]) {
          'received' => t.openedDate,
          'scheduled' => t.scheduledDate,
          // No fixing/fixed/closed timestamp column exists on service_ticket.
          _ => '',
        },
        done: at != null && i + 1 <= at,
        current: at != null && i + 1 == at,
      ),
  ];
}

// ---------------------------------------------------------------------------
// tech-jobs — honest scoping + the two derivable stat tiles
// ---------------------------------------------------------------------------

/// The signed-in profile, narrowed to the two fields tech-jobs needs.
///
/// `GET /me` answers `{ user: { id, email, name, role_id, status }, role, ... }`
/// (apps/api/src/routes/me.ts L46-51 + profile-data.ts serializeUser L25-33). Both
/// fields are "" when the profile could not be read — an empty [id] makes the job
/// list honest-empty, and an empty [name] em-dashes the header.
class ServiceUser {
  const ServiceUser({required this.id, required this.name});

  /// `user.id` — matched against each ticket's REAL assignee_user_id column.
  final String id;

  /// `user.name` — the header eyebrow. The prototype pairs it with a trade
  /// (L207); `user` has no trade/skill column, so only the name is printed and the
  /// trade half is dropped rather than invented.
  final String name;
}

/// Parse the `GET /me` body. Anything unexpected yields empty fields (honest-unknown
/// rather than a crash or a fabricated identity).
ServiceUser parseMeUser(Map<String, Object?> body) {
  final Object? user = body['user'];
  if (user is! Map) return const ServiceUser(id: '', name: '');
  final Object? id = user['id'];
  final Object? name = user['name'];
  return ServiceUser(
    id: id is String ? id : '',
    name: name is String ? name : '',
  );
}

/// The tickets assigned to [userId] (the prototype's "my jobs" header, L207).
///
/// `GET /sales/service` returns the whole tenant register — there is no per-user
/// endpoint — so the "mine" scope is this client-side filter on the REAL
/// assignee_user_id column against the id `GET /me` reports. An EMPTY [userId] (the
/// profile could not be read) returns an EMPTY list: the screen claims to show *my*
/// jobs, and with no identity it cannot honestly claim any ticket is mine. Showing
/// the whole tenant register under that title would be the fabrication.
List<ServiceTicket> assignedTo(List<ServiceTicket> rows, String userId) {
  if (userId.isEmpty) return const <ServiceTicket>[];
  return <ServiceTicket>[
    for (final ServiceTicket t in rows)
      if (t.assigneeUserId == userId) t,
  ];
}

/// How many of [rows] are scheduled on [isoDate] — the real count behind the
/// prototype's first stat tile (L214, mock literal "4").
int countScheduledOn(List<ServiceTicket> rows, String isoDate) {
  if (isoDate.isEmpty) return 0;
  int n = 0;
  for (final ServiceTicket t in rows) {
    if (t.scheduledDate == isoDate) n++;
  }
  return n;
}

/// How many of [rows] carry priority `high` — the real count behind the urgent tile
/// (L215, mock literal "1"). The seed's vocabulary is high/normal/low.
int countHighPriority(List<ServiceTicket> rows) {
  int n = 0;
  for (final ServiceTicket t in rows) {
    if (t.priority == 'high') n++;
  }
  return n;
}

/// Today as ISO `YYYY-MM-DD` in LOCAL time — the device the technician stands on
/// (the pm_jobs precedent), compared against the `date` column scheduled_date.
String serviceTodayIso([DateTime? now]) {
  final DateTime d = now ?? DateTime.now();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

// ---------------------------------------------------------------------------
// srv-new — the create body
// ---------------------------------------------------------------------------

/// Build the body for `POST /sales/service`.
///
/// Sends the REAL create keys only. `title` is the one required field
/// (sales-service.ts L228-229) and carries what the resident typed into the
/// prototype's problem field (L89) — service_ticket has no `description` column, and
/// `title` is its only free-text column, the very one srv-track and tech-jobs render
/// as the problem line. BLOCKERS.md B-293 files that mapping for a ruling.
///
/// Deliberately NOT sent:
///   - photos (L94): no column, and no upload seam on this endpoint;
///   - the preferred slot (L106): `scheduled_date` means "the appointment that was
///     set", not "the slot the resident would like" — writing a wish into it would
///     make a `received` ticket look scheduled. Filed in B-293 rather than guessed;
///   - `channel`: the form does not ask for it, so nothing here originates it;
///   - `status` / `no` / `opened_date`: SERVER-owned (start state, allocator, stamp);
///   - `priority`: the mobile form has no priority control (the web one does).
///
/// [unitId] and [category] ride along only when the flow really has them (both are
/// nullable columns), so an absent value is stored as NULL — never a placeholder.
Map<String, Object?> newTicketBody({
  required String title,
  String unitId = '',
  String category = '',
}) {
  final Map<String, Object?> body = <String, Object?>{'title': title.trim()};
  if (unitId.trim().isNotEmpty) body['unit_id'] = unitId.trim();
  if (category.trim().isNotEmpty) body['category'] = category.trim();
  return body;
}

/// True when the create form may be submitted: `title` is the server's only required
/// field, so a blank problem line is the only thing that blocks it (the screen keeps
/// the button disabled rather than letting the server 400).
bool canSubmitNewTicket(String title) => title.trim().isNotEmpty;

// ---------------------------------------------------------------------------
// Write lifecycle (shared by the three writing screens)
// ---------------------------------------------------------------------------

/// The honest lifecycle of a service write, as the screens render it.
///
///   * [idle]    — nothing submitted yet.
///   * [sending] — a request is in flight.
///   * [done]    — the server durably accepted it (2xx).
///   * [failed]  — the server rejected it, or the request never landed.
///
/// There is deliberately NO `queued` state here, unlike the PM write screens: those
/// go through the level-(a) offline queue, which is safe for their last-write-wins
/// column SETs. These writes are a CREATE (a replay would raise a second ticket) and
/// four one-shot state flips (a replay 409s, which the queue would surface as a
/// permanent failure even though the move had actually succeeded). So they are online
/// one-shot calls and say so, rather than promising an offline capture that would
/// misreport itself. money = NONE either way.
enum ServiceWriteState { idle, sending, done, failed }
