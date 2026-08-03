/*
 * NotificationsCenter — the Notifications Center screen, ported from
 * pototype/extra-screens.jsx NotificationsCenter (L171-208). Route `notifications`
 * (docs/extract/NAV-ROUTES.md L132, top-level extra route, component NotificationsCenter,
 * file extra-screens.jsx). money = NONE.
 *
 * §0 fidelity (rule 1): the layout is the prototype's, verbatim — the two-crumb page
 * header (title + unread-count subtitle + a "mark all read" outline action), the filter
 * tab bar (all / unread / accept, each with a live count), the day-grouped list, and each
 * row (a tone-tinted icon box + a title/time stack + an unread dot + a chevron). The
 * verbatim literals `#fff` (active tab text) and `color-mix(in srgb, <tone> 14%, white)`
 * (icon-box tint) are copied from the prototype and have no @juneflow/tokens equivalent
 * (B-037 exception); every other colour/space is a token.
 *
 * Data (§0 rule 3 + C10): the prototype's hardcoded `NOTIFS` array (L159-170) is a mock
 * mechanic and is DROPPED. The list is the REAL GET /notifications read (reused from the
 * shell bell, use-notifications-center → use-shell-data useNotifications, so the center and
 * the bell dot share one cache), and the row click + "mark all read" drive the REAL
 * POST /notifications/{id}/read action. Pure parse/derive logic lives in
 * notifications-agg.ts (gate G3).
 *
 * WIRE SOURCING (honest, never fabricated) — the real wire row is
 * { id, type, ref, read, created_at } (apps/api/src/routes/notifications.ts):
 *  - the per-row icon + tone are DERIVED from the real `type` enum (notifIconTone); the
 *    prototype's per-notification ic/tone is denormalised mock display that needs the
 *    typed Notification schema (contract gap B-039, already tracked by the bell popover).
 *  - the title line is the best-effort stored title/message/text IF a future schema adds
 *    one, else the real `ref` deep-link (the "use the real *_id" mock-strip rule), else an
 *    honest em-dash — no sentence is invented (B-039 · §0 rule 3).
 *  - the time line is the real `created_at` rendered at runtime by Intl in the active
 *    locale; the prototype's relative "N minutes ago" wording is a dynamic number-bearing
 *    Thai phrase deferred by B-017, so the honest analog is the actual timestamp.
 *  - the day header + row order come from the real `created_at` (dayBucket/groupByDay).
 *  - the row click routes via the `ref` module prefix, but only to a ported route; an
 *    unknown prefix marks-read without navigating to a guessed destination.
 *  - the "accept" tab filters rows whose ref routes to `accept`; no seed ref does, so its
 *    count is honestly 0 until B-039 lands (never a fabricated number).
 *
 * i18n (§0 rule 2): every visible label is a notifications-strings.json phrase key (tp).
 * Six keys are already in packages/i18n/src/i18n-full.json; the five net-new keys are
 * collected for a Wei sacred round (agents/orch-b-recon/notifications-i18n.apply.json) and
 * already resolve in Thai today (tp returns the key for lang th). No raw Thai byte lives
 * in this source (B-073); server data + Intl output are runtime values, never literals.
 */
import { useMemo, useState, type CSSProperties } from "react";
import type { PhraseKey, LangCode } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "./use-notifications-center";
import {
  parseNotifs,
  notifIconTone,
  routeFromRef,
  displayTitle,
  groupByDay,
  unreadCount,
  acceptCount,
  type DayBucket,
  type FilterId,
  type NotifRow,
} from "./notifications-agg";
import strings from "./notifications-strings.json" with { type: "json" };

/** Phrase-key accessor for notifications-strings.json (the Thai phrase IS the key -> tp). */
const P = (k: keyof typeof strings) => strings[k] as PhraseKey;
/** Honest placeholder for any value the wire does not carry (never invented). */
const DASH = "—";

/** Fill "{token}" placeholders in a phrase value (i18n has no interpolation, B-017). */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Real created_at → a locale timestamp (runtime Intl, no source Thai), else an em-dash. */
function timeLabel(iso: string | null, lang: LangCode): string {
  if (!iso) return DASH;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return DASH;
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/* ── Screen ───────────────────────────────────────────────────────────────────── */

export function NotificationsCenter() {
  const { tp, lang } = useI18n();
  const ctx = useShellCtx();

  const notifsQ = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const [filter, setFilter] = useState<FilterId>("all");

  const rows = useMemo(() => parseNotifs(notifsQ.data ?? []), [notifsQ.data]);
  const unread = unreadCount(rows);
  const acceptN = acceptCount(rows);

  // Filtered + day-grouped (order-preserving), recomputed against a single "now".
  const sections = useMemo(() => {
    const nowMs = Date.now();
    const list =
      filter === "unread"
        ? rows.filter((n) => !n.read)
        : filter === "accept"
          ? rows.filter((n) => routeFromRef(n.ref) === "accept")
          : rows;
    return groupByDay(list, nowMs);
  }, [rows, filter]);

  const dayHeader = (bucket: DayBucket): string => {
    if (bucket.kind === "today") return tp(P("dayToday"));
    if (bucket.kind === "yesterday") return tp(P("dayYesterday"));
    if (!bucket.iso) return DASH;
    const ms = Date.parse(bucket.iso);
    return Number.isFinite(ms)
      ? new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms))
      : DASH;
  };

  const onRowClick = (row: NotifRow) => {
    if (!row.read && row.id) markRead.mutate(row.id);
    const route = routeFromRef(row.ref);
    if (route) ctx.navigate(route);
  };

  const onMarkAll = () => {
    const ids = rows.filter((n) => !n.read).map((n) => n.id).filter(Boolean);
    if (ids.length > 0) {
      markAll.mutate(ids, { onSuccess: () => ctx.notify(tp(P("markAllToast"))) });
    } else {
      // Prototype toasts unconditionally even with nothing unread (extra-screens.jsx L180).
      ctx.notify(tp(P("markAllToast")));
    }
  };

  const tabs: { id: FilterId; label: string }[] = [
    { id: "all", label: `${tp(P("filterAll"))} (${rows.length})` },
    { id: "unread", label: `${tp(P("filterUnread"))} (${unread})` },
    { id: "accept", label: `${tp(P("filterAccept"))} (${acceptN})` },
  ];

  return (
    <Page
      breadcrumbs={[tp(P("crumbSystem")), tp(P("crumbNotif"))]}
      title={tp(P("title"))}
      subtitle={fill(tp(P("subtitle")), { n: unread })}
      actions={
        <Btn kind="outline" size="md" icon="check" onClick={onMarkAll}>
          {tp(P("markAll"))}
        </Btn>
      }
    >
      <Card pad={0}>
        {/* Filter tab bar (extra-screens.jsx L182-186). */}
        <div style={{ display: "flex", gap: 4, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              style={{
                padding: "7px 14px",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: 700,
                background: filter === t.id ? "var(--brand)" : "transparent",
                color: filter === t.id ? "#fff" : "var(--text-2)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: "6px 0" }}>
          {notifsQ.isLoading ? (
            // Loading skeleton — token blocks, no invented copy (mirror pr-list / boq-list).
            <div style={{ padding: "6px 12px" }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 54,
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          ) : sections.length === 0 ? (
            // Empty state — honest centered em-dash, no invented copy (exec precedent, B-045).
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "var(--text-3)", fontSize: 18, fontWeight: 600 }}>
              {DASH}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
                <div style={{ padding: "8px 18px 4px", fontSize: 11, fontWeight: 800, color: "var(--text-3)", textTransform: "uppercase" }}>
                  {dayHeader(section.bucket)}
                </div>
                {section.items.map((row, i) => {
                  const it = notifIconTone(row.type);
                  const rowTitle = displayTitle(row) ?? DASH;
                  const rowStyle: CSSProperties = {
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 18px",
                    borderTop: "1px solid var(--border)",
                    cursor: "pointer",
                    background: !row.read ? "var(--brand-soft)" : "transparent",
                  };
                  return (
                    <div key={row.id || i} onClick={() => onRowClick(row)} style={rowStyle}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          flexShrink: 0,
                          background: `color-mix(in srgb, ${it.tone} 14%, white)`,
                          color: it.tone,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name={it.icon} size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: !row.read ? 700 : 500 }}>{rowTitle}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{timeLabel(row.createdAt, lang)}</div>
                      </div>
                      {!row.read && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)", flexShrink: 0 }} />}
                      <Icon name="chevR" size={15} color="var(--text-3)" />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </Card>
    </Page>
  );
}
