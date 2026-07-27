/*
 * sales-crm-rows unit tests (gate G3) — the pure Sales-CRM lead-register logic ported
 * from pototype/sales-crm.jsx SalesCRM (toLeadRow / isLeadStage / groupByStage /
 * countHot / toUserRef / userNameById). Guards the opaque-row narrowing (snake_case +
 * camelCase, the boolean `hot`, the nullable `days`), the 5-stage bucketing (unknown
 * stages dropped), the hot count (the real KPI value, C10), and the owner id -> name
 * resolution. ASCII-only test data (B-073) — no Thai in source.
 */
import { describe, it, expect } from "vitest";
import {
  toLeadRow,
  isLeadStage,
  groupByStage,
  countHot,
  toUserRef,
  userNameById,
  LEAD_STAGES,
  type LeadRow,
} from "./sales-crm-rows";

const lead = (p: Partial<LeadRow> = {}): LeadRow => ({
  id: "L-1",
  name: "Lead One",
  phone: "081-000-0000",
  source: "Walk-in",
  interest: "Block B",
  stage: "lead",
  hot: false,
  lastContactAt: "2026-05-27",
  note: "note",
  ownerUserId: "u-1",
  days: 0,
  ...p,
});

describe("toLeadRow", () => {
  it("maps the snake_case wire fields", () => {
    expect(
      toLeadRow({
        id: "L-9",
        name: "Somchai",
        phone: "086-111-2222",
        source: "Line OA",
        interest: "B-15",
        stage: "quote",
        hot: true,
        last_contact_at: "2026-05-24",
        note: "compare price",
        owner_user_id: "u-9",
        days: 5,
        created_at: "2026-05-01T00:00:00Z",
      }),
    ).toEqual({
      id: "L-9",
      name: "Somchai",
      phone: "086-111-2222",
      source: "Line OA",
      interest: "B-15",
      stage: "quote",
      hot: true,
      lastContactAt: "2026-05-24",
      note: "compare price",
      ownerUserId: "u-9",
      days: 5,
    });
  });

  it("accepts camelCase aliases for the multi-word fields", () => {
    const r = toLeadRow({ id: "L-2", lastContactAt: "2026-06-01", ownerUserId: "u-2" });
    expect(r.lastContactAt).toBe("2026-06-01");
    expect(r.ownerUserId).toBe("u-2");
  });

  it("narrows hot to a strict boolean (true / \"true\" / 1 => true; else false)", () => {
    expect(toLeadRow({ hot: true }).hot).toBe(true);
    expect(toLeadRow({ hot: "true" }).hot).toBe(true);
    expect(toLeadRow({ hot: 1 }).hot).toBe(true);
    expect(toLeadRow({ hot: false }).hot).toBe(false);
    expect(toLeadRow({ hot: "false" }).hot).toBe(false);
    expect(toLeadRow({}).hot).toBe(false);
  });

  it("parses days to an int or null (never NaN)", () => {
    expect(toLeadRow({ days: 3 }).days).toBe(3);
    expect(toLeadRow({ days: "7" }).days).toBe(7);
    expect(toLeadRow({ days: null }).days).toBeNull();
    expect(toLeadRow({ days: "" }).days).toBeNull();
    expect(toLeadRow({}).days).toBeNull();
  });

  it("defaults missing string fields to empty strings (never undefined)", () => {
    expect(toLeadRow({})).toEqual({
      id: "",
      name: "",
      phone: "",
      source: "",
      interest: "",
      stage: "",
      hot: false,
      lastContactAt: "",
      note: "",
      ownerUserId: "",
      days: null,
    });
  });
});

describe("isLeadStage", () => {
  it("accepts every one of the 5 known funnel stages", () => {
    for (const s of LEAD_STAGES) expect(isLeadStage(s)).toBe(true);
  });

  it("rejects an unknown stage value", () => {
    expect(isLeadStage("closed")).toBe(false);
    expect(isLeadStage("")).toBe(false);
  });
});

describe("groupByStage", () => {
  it("buckets leads under the 5 stages, preserving input order", () => {
    const rows = [
      lead({ id: "a", stage: "lead" }),
      lead({ id: "b", stage: "visit" }),
      lead({ id: "c", stage: "lead" }),
      lead({ id: "d", stage: "contract" }),
    ];
    const g = groupByStage(rows);
    expect(g.lead.map((r) => r.id)).toEqual(["a", "c"]);
    expect(g.visit.map((r) => r.id)).toEqual(["b"]);
    expect(g.quote).toEqual([]);
    expect(g.booking).toEqual([]);
    expect(g.contract.map((r) => r.id)).toEqual(["d"]);
  });

  it("drops a row whose stage is not one of the 5 known stages", () => {
    const g = groupByStage([lead({ id: "x", stage: "closed" }), lead({ id: "y", stage: "quote" })]);
    expect(g.quote.map((r) => r.id)).toEqual(["y"]);
    const total = LEAD_STAGES.reduce((n, s) => n + g[s].length, 0);
    expect(total).toBe(1); // the "closed" row is dropped, never forced into a column
  });

  it("returns five empty buckets for an empty list", () => {
    const g = groupByStage([]);
    expect(LEAD_STAGES.every((s) => g[s].length === 0)).toBe(true);
  });
});

describe("countHot", () => {
  it("counts only the hot leads (the real KPI value, C10)", () => {
    const rows = [lead({ hot: true }), lead({ hot: false }), lead({ hot: true })];
    expect(countHot(rows)).toBe(2);
  });

  it("returns 0 when nothing is hot", () => {
    expect(countHot([lead({ hot: false })])).toBe(0);
    expect(countHot([])).toBe(0);
  });
});

describe("toUserRef + userNameById", () => {
  it("narrows an opaque /users row to { id, name }", () => {
    expect(toUserRef({ id: "u-1", name: "Rujira", email: "r@x.co" })).toEqual({
      id: "u-1",
      name: "Rujira",
    });
  });

  it("maps user id -> name, skipping blank ids", () => {
    const map = userNameById([toUserRef({ id: "u-1", name: "Rujira" }), toUserRef({ id: "", name: "Ghost" })]);
    expect(map.get("u-1")).toBe("Rujira");
    expect(map.size).toBe(1);
  });

  it("returns an empty map for undefined input", () => {
    expect(userNameById(undefined).size).toBe(0);
  });
});
