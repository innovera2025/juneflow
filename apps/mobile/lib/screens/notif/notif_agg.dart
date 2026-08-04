// Pure parse + honest derivations for the mobile Notifications screen (route
// `notif`, pototype/mobile.jsx MobileNotifications L543-609). money = NONE.
//
// The prototype is a MOCK: its `NOTIFS` array (L544-552) denormalises every
// notification into rich display fields — a full Thai sentence title, a `by`
// sender line, a `body` detail line, a relative-time string (`t`), a per-item
// icon (`ic`), a tone colour, and a `kind` that gates approve/view buttons.
// Per §0 rule 3 (strip mock mechanics) NONE of that denormalised display is
// reproduced. This module parses the OPAQUE Entity rows the real GET
// /notifications handler returns (apps/api/src/routes/notifications.ts) into
// typed rows, then derives ONLY what the real wire columns support. No Flutter,
// no i18n, no Dio here — every derivation stays unit-testable.
//
// This mirrors apps/web/src/screens/notifications/notifications-agg.ts, the
// already-merged web port of the same endpoint (same B-039 contract gap). The
// real wire row is { id, type, ref, read, created_at } (schema/misc.ts
// `notifications`); it carries NO stored message/title text, no icon, no tone,
// no sender and no detail line. So:
//   - kind (→ icon + tone in the view) is DERIVED from the real `type` enum.
//   - the display title is a best-effort stored title/message/text IF a future
//     schema adds one (contract gap B-039), else the real `ref` deep link, else
//     null (the view renders an honest em-dash). No sentence is ever invented.
//   - order comes from the real `created_at`, newest first.
//   - `by` (sender) and `body` (detail) are NOT on the wire → the view omits
//     them (B-039). The prototype's approve/view per-card actions act on the
//     referenced document, which has no honest mark-read-scope wire → omitted.

/// An opaque contract Entity — GET /notifications rows are `{ [k]: unknown }`.
typedef NotifEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? notifStr(NotifEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// Boolean at [key] (JSON serialises the `read` column as a real boolean).
bool notifBool(NotifEnt e, String key) => e[key] == true;

/// The notification kind, derived from the real `type` enum. `other` is the
/// honest fallback for any unknown/empty type — never a guessed content kind.
enum NotifKind { approval, alert, info, other }

/// type → kind. approval reads as a brand action, alert as danger, info as
/// info; anything else falls back to the neutral bell kind.
NotifKind notifKind(String type) {
  switch (type) {
    case 'approval':
      return NotifKind.approval;
    case 'alert':
      return NotifKind.alert;
    case 'info':
      return NotifKind.info;
    default:
      return NotifKind.other;
  }
}

/// One parsed notification (typed projection of the opaque wire row).
class NotifRow {
  const NotifRow({
    required this.id,
    required this.type,
    required this.ref,
    required this.read,
    required this.createdAt,
    required this.title,
  });

  final String id;

  /// The real `type` enum — approval | alert | info (text column, defensive).
  final String type;

  /// Polymorphic "module:uuid" deep link, or null.
  final String? ref;

  /// true when the user has read it (wire `read`).
  final bool read;

  /// Parsed `created_at` timestamp, or null when absent/unparsable.
  final DateTime? createdAt;

  /// Best-effort stored title IF a future schema adds one (B-039), else null.
  final String? title;

  /// The kind this row's `type` maps to (drives the view's icon + tone).
  NotifKind get kind => notifKind(type);

  /// The display line — best-effort title, else the real ref, else null (the
  /// view renders an honest em-dash). No sentence is ever invented (§0 rule 3).
  String? get displayTitle => title ?? ref;
}

/// Parse one opaque Entity row into a typed [NotifRow].
NotifRow parseNotif(NotifEnt e) {
  final String? createdRaw = notifStr(e, 'created_at');
  return NotifRow(
    id: notifStr(e, 'id') ?? '',
    type: notifStr(e, 'type') ?? '',
    ref: notifStr(e, 'ref'),
    read: notifBool(e, 'read'),
    createdAt: createdRaw == null ? null : DateTime.tryParse(createdRaw),
    // Best-effort — the current wire carries none of these (B-039), so null today.
    title:
        notifStr(e, 'title') ?? notifStr(e, 'message') ?? notifStr(e, 'text'),
  );
}

/// Parse the GET /notifications page rows, ordered newest-first by the real
/// `created_at` (rows with no timestamp sort last). The prototype's mock list is
/// already time-ordered; this is the honest analog over real timestamps.
List<NotifRow> parseNotifs(List<NotifEnt> rows) {
  final List<NotifRow> out = rows.map(parseNotif).toList();
  out.sort((NotifRow a, NotifRow b) {
    final DateTime? ad = a.createdAt;
    final DateTime? bd = b.createdAt;
    if (ad == null && bd == null) return 0;
    if (ad == null) return 1;
    if (bd == null) return -1;
    return bd.compareTo(ad);
  });
  return out;
}

/// Count of unread rows (drives the "mark all read" fan-out).
int unreadCount(List<NotifRow> rows) =>
    rows.where((NotifRow r) => !r.read).length;

/// Ids of the unread rows that can be marked read (non-empty id).
List<String> unreadIds(List<NotifRow> rows) => rows
    .where((NotifRow r) => !r.read && r.id.isNotEmpty)
    .map((NotifRow r) => r.id)
    .toList();
