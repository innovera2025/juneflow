/*
 * sales-service-rows unit tests (gate G3) — the pure After-Sales Service ticket-register
 * logic ported from pototype/sales-service.jsx AfterSalesService (toTicketRow /
 * isServiceStatus / isPriority / nextTransition / filterByTab / tabCount / countByStatus /
 * toRef / nameById). Guards the opaque-row narrowing (snake_case + camelCase, the boolean
 * warranty flag, the nullable warranty months), the SV-3 status machine (the ONE valid
 * next op per status, terminal/unknown -> null), the tab filters, the real per-status /
 * per-tab counts (C10), and the id -> name resolution. ASCII-only data (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toTicketRow,
  isServiceStatus,
  isPriority,
  nextTransition,
  filterByTab,
  tabCount,
  countByStatus,
  toRef,
  nameById,
  SERVICE_STATUSES,
  PRIORITIES,
  type TicketRow,
} from "./sales-service-rows";

const ticket = (p: Partial<TicketRow> = {}): TicketRow => ({
  id: "t-1",
  no: "SR-2026-0001",
  unitId: "unit-1",
  customerId: "cust-1",
  channel: "LINE",
  category: "plumbing",
  title: "Leaking tap",
  priority: "normal",
  status: "received",
  assigneeUserId: "u-1",
  openedDate: "2026-05-24",
  scheduledDate: "",
  warranty: true,
  warrantyMonthsRemaining: 11,
  createdAt: "2026-05-24T00:00:00Z",
  ...p,
});

describe("toTicketRow", () => {
  it("maps the snake_case wire fields (incl the derived warranty months)", () => {
    expect(
      toTicketRow({
        id: "t-9",
        no: "SR-2026-0048",
        unit_id: "node-8",
        customer_id: "c-8",
        channel: "App",
        category: "electrical",
        title: "Breaker trips",
        priority: "high",
        status: "fixing",
        assignee_user_id: "u-9",
        opened_date: "2026-05-24",
        scheduled_date: "2026-05-25",
        warranty: true,
        warranty_months_remaining: 8,
        created_at: "2026-05-01T00:00:00Z",
      }),
    ).toEqual({
      id: "t-9",
      no: "SR-2026-0048",
      unitId: "node-8",
      customerId: "c-8",
      channel: "App",
      category: "electrical",
      title: "Breaker trips",
      priority: "high",
      status: "fixing",
      assigneeUserId: "u-9",
      openedDate: "2026-05-24",
      scheduledDate: "2026-05-25",
      warranty: true,
      warrantyMonthsRemaining: 8,
      createdAt: "2026-05-01T00:00:00Z",
    });
  });

  it("accepts camelCase aliases for the multi-word fields", () => {
    const r = toTicketRow({
      unitId: "node-2",
      customerId: "c-2",
      assigneeUserId: "u-2",
      openedDate: "2026-06-01",
      scheduledDate: "2026-06-03",
      warrantyMonthsRemaining: 4,
    });
    expect(r.unitId).toBe("node-2");
    expect(r.customerId).toBe("c-2");
    expect(r.assigneeUserId).toBe("u-2");
    expect(r.openedDate).toBe("2026-06-01");
    expect(r.scheduledDate).toBe("2026-06-03");
    expect(r.warrantyMonthsRemaining).toBe(4);
  });

  it("narrows warranty to a strict boolean (true / \"true\" / 1 => true; else false)", () => {
    expect(toTicketRow({ warranty: true }).warranty).toBe(true);
    expect(toTicketRow({ warranty: "true" }).warranty).toBe(true);
    expect(toTicketRow({ warranty: 1 }).warranty).toBe(true);
    expect(toTicketRow({ warranty: false }).warranty).toBe(false);
    expect(toTicketRow({}).warranty).toBe(false);
  });

  it("parses warranty months to an int or null (never NaN)", () => {
    expect(toTicketRow({ warranty_months_remaining: 12 }).warrantyMonthsRemaining).toBe(12);
    expect(toTicketRow({ warranty_months_remaining: "6" }).warrantyMonthsRemaining).toBe(6);
    expect(toTicketRow({ warranty_months_remaining: 0 }).warrantyMonthsRemaining).toBe(0);
    expect(toTicketRow({ warranty_months_remaining: null }).warrantyMonthsRemaining).toBeNull();
    expect(toTicketRow({}).warrantyMonthsRemaining).toBeNull();
  });

  it("defaults missing string fields to empty strings (never undefined)", () => {
    expect(toTicketRow({})).toEqual({
      id: "",
      no: "",
      unitId: "",
      customerId: "",
      channel: "",
      category: "",
      title: "",
      priority: "",
      status: "",
      assigneeUserId: "",
      openedDate: "",
      scheduledDate: "",
      warranty: false,
      warrantyMonthsRemaining: null,
      createdAt: "",
    });
  });
});

describe("isServiceStatus / isPriority", () => {
  it("accepts every known status", () => {
    for (const s of SERVICE_STATUSES) expect(isServiceStatus(s)).toBe(true);
  });
  it("rejects an unknown status", () => {
    expect(isServiceStatus("cancelled")).toBe(false);
    expect(isServiceStatus("")).toBe(false);
  });
  it("accepts every known priority, rejects the unknown", () => {
    for (const p of PRIORITIES) expect(isPriority(p)).toBe(true);
    expect(isPriority("urgent")).toBe(false);
  });
});

describe("nextTransition (SV-3 linear machine)", () => {
  it("returns the ONE valid next op per status", () => {
    expect(nextTransition("received")).toEqual({ op: "schedule", next: "scheduled" });
    expect(nextTransition("scheduled")).toEqual({ op: "start", next: "fixing" });
    expect(nextTransition("fixing")).toEqual({ op: "fix", next: "fixed" });
    expect(nextTransition("fixed")).toEqual({ op: "close", next: "closed" });
  });

  it("returns null for the terminal `closed` and any unknown status (no illegal jump)", () => {
    expect(nextTransition("closed")).toBeNull();
    expect(nextTransition("bogus")).toBeNull();
    expect(nextTransition("")).toBeNull();
  });
});

describe("filterByTab / tabCount", () => {
  const rows = [
    ticket({ id: "a", status: "received", priority: "high" }),
    ticket({ id: "b", status: "fixing", priority: "normal" }),
    ticket({ id: "c", status: "closed", priority: "high" }),
    ticket({ id: "d", status: "fixed", priority: "low" }),
  ];

  it("active drops only the closed tickets", () => {
    expect(filterByTab(rows, "active").map((r) => r.id)).toEqual(["a", "b", "d"]);
  });
  it("all keeps everything", () => {
    expect(filterByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("high keeps only priority==='high'", () => {
    expect(filterByTab(rows, "high").map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("closed keeps only status==='closed'", () => {
    expect(filterByTab(rows, "closed").map((r) => r.id)).toEqual(["c"]);
  });
  it("tabCount matches the filtered length", () => {
    expect(tabCount(rows, "active")).toBe(3);
    expect(tabCount(rows, "all")).toBe(4);
    expect(tabCount(rows, "high")).toBe(2);
    expect(tabCount(rows, "closed")).toBe(1);
  });
});

describe("countByStatus", () => {
  it("counts only the tickets in the given status (the real KPI value, C10)", () => {
    const rows = [
      ticket({ status: "received" }),
      ticket({ status: "received" }),
      ticket({ status: "fixing" }),
      ticket({ status: "closed" }),
    ];
    expect(countByStatus(rows, "received")).toBe(2);
    expect(countByStatus(rows, "fixing")).toBe(1);
    expect(countByStatus(rows, "scheduled")).toBe(0);
    expect(countByStatus([], "received")).toBe(0);
  });
});

describe("toRef + nameById", () => {
  it("narrows an opaque /customers or /users row to { id, name }", () => {
    expect(toRef({ id: "c-1", name: "Rujira", email: "r@x.co" })).toEqual({ id: "c-1", name: "Rujira" });
  });
  it("maps id -> name, skipping blank ids", () => {
    const map = nameById([toRef({ id: "u-1", name: "Wichai" }), toRef({ id: "", name: "Ghost" })]);
    expect(map.get("u-1")).toBe("Wichai");
    expect(map.size).toBe(1);
  });
  it("returns an empty map for undefined input", () => {
    expect(nameById(undefined).size).toBe(0);
  });
});
