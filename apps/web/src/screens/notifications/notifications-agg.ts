/*
 * Pure aggregation + transform logic for the Notifications Center screen
 * (route `notifications`, pototype/extra-screens.jsx NotificationsCenter L171-208), gate G3.
 *
 * The prototype is a MOCK: its `NOTIFS` array (L159-170) denormalises every notification
 * into rich display fields — a hardcoded icon (`ic`), tone colour (`tone`), a full Thai
 * sentence title (`t`), a relative-time string (`time`), a day bucket (`d`), an `unread`
 * flag and a per-item route (`r`). Per §0 rule 3 (strip mock mechanics) NONE of that
 * denormalised display is reproduced. This module instead parses the OPAQUE Entity rows
 * returned by the real GET /notifications handler (apps/api/src/routes/notifications.ts)
 * into typed rows, then derives the presentational bits the view needs from the REAL
 * wire columns only. No React, no i18n, no fetch here — every derivation stays
 * unit-testable (G3).
 *
 * WIRE REALITY (honest, never fabricated). The notification row the contract/handler
 * carries is `{ id, type, ref, read, created_at }` (schema/misc.ts `notifications`;
 * data-dictionary "user_id, type, ref, read"). It has NO stored message/title text, no
 * icon and no tone — the prototype's rich per-notification title/icon/tone/route mapping
 * needs a typed Notification schema that does not exist yet (contract gap, BLOCKERS
 * B-039, already tracked by the shell bell popover). So:
 *   - icon + tone are DERIVED from the real `type` enum (approval/alert/info), documented
 *     below — a presentational map, not invented content.
 *   - the display title is the best-effort title/message/text field IF a future schema
 *     adds one (mirrors the bell popover, use-shell-data entityStr), else the real `ref`
 *     deep-link (the "use the real *_id, not the denormalised name" mock-strip rule),
 *     else an honest em-dash. No sentence is invented.
 *   - the day bucket + relative order come from the real `created_at`, not a stored label.
 *   - the click route is derived from the `ref` module prefix, but only for modules whose
 *     web route is actually ported; an unknown prefix yields null (mark-read, no navigate)
 *     rather than a guessed destination.
 *
 * No raw Thai byte lives in this source (B-073): every label is an i18n phrase key applied
 * by the view (notifications-strings.json → tp); day-of-week/date text is produced at
 * runtime by Intl in the view, never as a source literal.
 */

/** An opaque contract Entity — GET /notifications rows are `{ [k]: unknown }`. */
export type Ent = Record<string, unknown>;

/** Non-empty string at `key`, else null. */
export function estr(e: Ent | undefined, key: string): string | null {
  const v = e?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Boolean at `key` (JSON serialises the `read` column as a real boolean). */
export function ebool(e: Ent | undefined, key: string): boolean {
  return e?.[key] === true;
}

/* ── Parsed row type ──────────────────────────────────────────────────────────── */

/** One parsed notification (typed projection of the opaque wire row). */
export interface NotifRow {
  id: string;
  /** The real `type` enum — approval | alert | info (text column, defensive). */
  type: string;
  /** Polymorphic "module:uuid" deep link, or null. */
  ref: string | null;
  /** true when the user has read it (wire `read`). */
  read: boolean;
  /** ISO timestamp string (wire `created_at`), or null. */
  createdAt: string | null;
  /** Best-effort stored title/message/text if a future schema adds one (B-039), else null. */
  title: string | null;
}

/** Parse one opaque Entity row into a typed NotifRow. */
export function parseNotif(e: Ent): NotifRow {
  return {
    id: estr(e, "id") ?? "",
    type: estr(e, "type") ?? "",
    ref: estr(e, "ref"),
    read: ebool(e, "read"),
    createdAt: estr(e, "created_at"),
    // Best-effort — the current wire carries none of these (B-039), so this is null today.
    title: estr(e, "title") ?? estr(e, "message") ?? estr(e, "text"),
  };
}

/** Parse the GET /notifications page rows. */
export function parseNotifs(rows: Ent[]): NotifRow[] {
  return rows.map(parseNotif);
}

/* ── Derivations from the real wire ───────────────────────────────────────────── */

/** Icon + tone token derived from the notification `type` (see header WIRE REALITY). */
export interface IconTone {
  /** A subset of ui/icon IconName (assignable to it). */
  icon: "check" | "warn" | "info" | "bell";
  /** A @juneflow/tokens colour var — the icon colour + (mixed) chip background. */
  tone: string;
}

/**
 * type → { icon, tone } presentational map. approval reads as a brand action, alert as
 * danger, info as info; any other/empty type falls back to the neutral bell + muted tone
 * (honest — the real per-notification icon/tone needs the B-039 typed schema).
 */
export function notifIconTone(type: string): IconTone {
  switch (type) {
    case "approval":
      return { icon: "check", tone: "var(--brand)" };
    case "alert":
      return { icon: "warn", tone: "var(--danger)" };
    case "info":
      return { icon: "info", tone: "var(--info)" };
    default:
      return { icon: "bell", tone: "var(--text-3)" };
  }
}

/**
 * Web route for a notification `ref` ("module:uuid"), for the click-through. Only modules
 * whose web route is actually ported are mapped; an unknown/empty prefix yields null so
 * the row marks-read without navigating to a guessed destination (never fabricated).
 */
const REF_ROUTE: Readonly<Record<string, string>> = {
  pr: "pr.list",
  po: "po.list",
  wo: "wo.list",
  gr: "gr.list",
  boq: "boq.list",
  ap: "ap.billing",
};

export function routeFromRef(ref: string | null): string | null {
  if (!ref) return null;
  const mod = ref.split(":")[0] ?? "";
  return REF_ROUTE[mod] ?? null;
}

/** The display line for a row — best-effort title, else the real ref, else null (view → em-dash). */
export function displayTitle(row: NotifRow): string | null {
  return row.title ?? row.ref;
}

/* ── Day bucketing (from the real created_at) ─────────────────────────────────── */

/**
 * A calendar-day bucket for the day-group header. today/yesterday map to the prototype's
 * dayToday/dayYesterday phrase keys in the view; an older/undated row carries its ISO date
 * (view formats it with Intl — no source Thai). iso is "" when created_at is absent.
 */
export type DayBucket =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "date"; iso: string };

/** Local calendar-day index (days since epoch in the runtime's local zone). */
function localDayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}

/** "YYYY-MM-DD" (local) for a timestamp — the stable date-bucket key. */
function localIso(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Bucket a created_at (ISO) relative to `nowMs` into today | yesterday | its date. */
export function dayBucket(createdAtIso: string | null, nowMs: number): DayBucket {
  if (!createdAtIso) return { kind: "date", iso: "" };
  const ms = Date.parse(createdAtIso);
  if (!Number.isFinite(ms)) return { kind: "date", iso: "" };
  const diff = localDayIndex(nowMs) - localDayIndex(ms);
  if (diff <= 0) return { kind: "today" };
  if (diff === 1) return { kind: "yesterday" };
  return { kind: "date", iso: localIso(ms) };
}

/** Stable grouping key for a DayBucket (identical buckets group together, order-preserving). */
export function dayKey(b: DayBucket): string {
  return b.kind === "date" ? `date:${b.iso}` : b.kind;
}

/* ── Filtering + counts ───────────────────────────────────────────────────────── */

export type FilterId = "all" | "unread" | "accept";

/** Rows for the active filter tab (prototype L174: all | unread | route==="accept"). */
export function filterNotifs(rows: NotifRow[], filter: FilterId): NotifRow[] {
  if (filter === "unread") return rows.filter((n) => !n.read);
  if (filter === "accept") return rows.filter((n) => routeFromRef(n.ref) === "accept");
  return rows;
}

/** Count of unread rows (subtitle + the "unread" tab + the per-row dot). */
export function unreadCount(rows: NotifRow[]): number {
  return rows.filter((n) => !n.read).length;
}

/** Count of acceptance-routed rows (the "accept" tab; 0 until B-039 adds accept refs). */
export function acceptCount(rows: NotifRow[]): number {
  return rows.filter((n) => routeFromRef(n.ref) === "accept").length;
}

/* ── Day grouping ─────────────────────────────────────────────────────────────── */

/** One day section: its bucket (→ header label) + the rows in it, input order preserved. */
export interface DaySection {
  key: string;
  bucket: DayBucket;
  items: NotifRow[];
}

/**
 * Group rows into ordered day sections (prototype L175: iterate in order, push into
 * byDay[n.d]; Object.entries keeps first-seen order). Sections appear in the order their
 * first row appears; rows keep their order within a section.
 */
export function groupByDay(rows: NotifRow[], nowMs: number): DaySection[] {
  const sections: DaySection[] = [];
  const index = new Map<string, DaySection>();
  for (const row of rows) {
    const bucket = dayBucket(row.createdAt, nowMs);
    const key = dayKey(bucket);
    let section = index.get(key);
    if (!section) {
      section = { key, bucket, items: [] };
      index.set(key, section);
      sections.push(section);
    }
    section.items.push(row);
  }
  return sections;
}
