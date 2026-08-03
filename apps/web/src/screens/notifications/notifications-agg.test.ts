/*
 * Unit tests for notifications-agg.ts (route `notifications`, gate G3) — the pure logic
 * behind the Notifications Center: the opaque-Entity readers, the row parser (incl. the
 * honest B-039 title gap), the type→icon/tone map, the ref→route map, the created_at day
 * bucketing, the filter/count derivations, and the order-preserving day grouping.
 *
 * The wire row shape asserted here is the REAL one (apps/api/src/routes/notifications.ts
 * notificationWire): { id, type, ref, read, created_at }.
 */
import { describe, it, expect } from "vitest";
import {
  estr,
  ebool,
  parseNotif,
  parseNotifs,
  notifIconTone,
  routeFromRef,
  displayTitle,
  dayBucket,
  dayKey,
  filterNotifs,
  unreadCount,
  acceptCount,
  groupByDay,
  type Ent,
  type NotifRow,
} from "./notifications-agg";

/** A representative real GET /notifications row (opaque Entity). */
const ROW: Ent = {
  id: "n1",
  type: "approval",
  ref: "pr:abc",
  read: false,
  created_at: "2026-08-04T03:00:00.000Z",
};

describe("field readers", () => {
  it("estr returns the string or null", () => {
    expect(estr(ROW, "type")).toBe("approval");
    expect(estr(ROW, "missing")).toBeNull();
    expect(estr({ x: "" }, "x")).toBeNull(); // empty string is treated as absent
    expect(estr(undefined, "x")).toBeNull();
  });
  it("ebool is true only for a real boolean true", () => {
    expect(ebool({ read: true }, "read")).toBe(true);
    expect(ebool({ read: false }, "read")).toBe(false);
    expect(ebool({ read: "true" }, "read")).toBe(false);
    expect(ebool({}, "read")).toBe(false);
  });
});

describe("parseNotif", () => {
  it("projects the real wire columns", () => {
    expect(parseNotif(ROW)).toEqual<NotifRow>({
      id: "n1",
      type: "approval",
      ref: "pr:abc",
      read: false,
      createdAt: "2026-08-04T03:00:00.000Z",
      title: null, // B-039: no stored message/title/text on the current wire
    });
  });
  it("surfaces a best-effort title/message/text when a future schema adds one", () => {
    expect(parseNotif({ ...ROW, title: "T" }).title).toBe("T");
    expect(parseNotif({ ...ROW, message: "M" }).title).toBe("M");
    expect(parseNotif({ ...ROW, text: "X" }).title).toBe("X");
  });
  it("parseNotifs maps a page of rows", () => {
    expect(parseNotifs([ROW, { ...ROW, id: "n2" }]).map((r) => r.id)).toEqual(["n1", "n2"]);
  });
});

describe("notifIconTone", () => {
  it("maps the type enum, brand/danger/info", () => {
    expect(notifIconTone("approval")).toEqual({ icon: "check", tone: "var(--brand)" });
    expect(notifIconTone("alert")).toEqual({ icon: "warn", tone: "var(--danger)" });
    expect(notifIconTone("info")).toEqual({ icon: "info", tone: "var(--info)" });
  });
  it("falls back to the neutral bell for an unknown/empty type", () => {
    expect(notifIconTone("weird")).toEqual({ icon: "bell", tone: "var(--text-3)" });
    expect(notifIconTone("")).toEqual({ icon: "bell", tone: "var(--text-3)" });
  });
});

describe("routeFromRef", () => {
  it("maps ported module prefixes", () => {
    expect(routeFromRef("pr:abc")).toBe("pr.list");
    expect(routeFromRef("po:1")).toBe("po.list");
    expect(routeFromRef("ap:9")).toBe("ap.billing");
  });
  it("returns null for an unknown prefix or a null ref (no guessed destination)", () => {
    expect(routeFromRef("mystery:1")).toBeNull();
    expect(routeFromRef(null)).toBeNull();
    expect(routeFromRef("")).toBeNull();
  });
});

describe("displayTitle", () => {
  it("prefers a stored title, then the real ref, else null", () => {
    expect(displayTitle(parseNotif({ ...ROW, title: "T" }))).toBe("T");
    expect(displayTitle(parseNotif(ROW))).toBe("pr:abc");
    expect(displayTitle(parseNotif({ ...ROW, ref: undefined }))).toBeNull();
  });
});

// Bucketing is by LOCAL calendar day (correct UX: a Thai user sees local today/yesterday).
// Fixtures are anchored at local noon so they never straddle a midnight boundary in any
// runtime timezone — the test is deterministic regardless of TZ.
const atLocalNoon = (y: number, m0: number, d: number, h = 12): Date => new Date(y, m0, d, h, 0, 0);

describe("dayBucket", () => {
  const now = atLocalNoon(2026, 7, 4).getTime(); // local noon, Aug 4 2026 (month index 7)
  it("buckets today / yesterday / older", () => {
    expect(dayBucket(atLocalNoon(2026, 7, 4, 8).toISOString(), now)).toEqual({ kind: "today" });
    expect(dayBucket(atLocalNoon(2026, 7, 3).toISOString(), now)).toEqual({ kind: "yesterday" });
    expect(dayBucket(atLocalNoon(2026, 6, 30).toISOString(), now)).toEqual({ kind: "date", iso: "2026-07-30" });
  });
  it("treats a future/absent/invalid timestamp defensively", () => {
    expect(dayBucket(atLocalNoon(2026, 7, 5).toISOString(), now)).toEqual({ kind: "today" }); // diff<=0
    expect(dayBucket(null, now)).toEqual({ kind: "date", iso: "" });
    expect(dayBucket("not-a-date", now)).toEqual({ kind: "date", iso: "" });
  });
  it("dayKey is stable per bucket", () => {
    expect(dayKey({ kind: "today" })).toBe("today");
    expect(dayKey({ kind: "yesterday" })).toBe("yesterday");
    expect(dayKey({ kind: "date", iso: "2026-07-30" })).toBe("date:2026-07-30");
  });
});

describe("filtering + counts", () => {
  const rows = parseNotifs([
    { ...ROW, id: "a", read: false, ref: "pr:1" },
    { ...ROW, id: "b", read: true, ref: "po:2" },
    { ...ROW, id: "c", read: false, ref: "accept:3" }, // accept-routed only if such a ref exists
  ]);
  it("all returns every row", () => {
    expect(filterNotifs(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("unread returns only unread", () => {
    expect(filterNotifs(rows, "unread").map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("accept returns rows whose ref routes to accept (none on the seed wire)", () => {
    // No ported module maps to "accept", so accept is empty even for an accept:* ref.
    expect(filterNotifs(rows, "accept")).toEqual([]);
    expect(acceptCount(rows)).toBe(0);
  });
  it("unreadCount counts unread rows", () => {
    expect(unreadCount(rows)).toBe(2);
  });
});

describe("groupByDay", () => {
  const now = atLocalNoon(2026, 7, 4).getTime();
  it("groups in first-seen order, preserving row order within a section", () => {
    const rows = parseNotifs([
      { ...ROW, id: "t1", created_at: atLocalNoon(2026, 7, 4, 8).toISOString() },
      { ...ROW, id: "y1", created_at: atLocalNoon(2026, 7, 3).toISOString() },
      { ...ROW, id: "t2", created_at: atLocalNoon(2026, 7, 4, 15).toISOString() },
    ]);
    const sections = groupByDay(rows, now);
    expect(sections.map((s) => s.key)).toEqual(["today", "yesterday"]);
    expect(sections[0]!.items.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(sections[1]!.items.map((r) => r.id)).toEqual(["y1"]);
  });
  it("returns no sections for an empty list", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
