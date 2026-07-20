/*
 * Unit tests for wo-rows.ts (pm.wo, gate G3) — the pure derivation helpers behind
 * PMWorkOrders (list) + PMWorkOrderDetail. Covers the opaque-row narrowing, the
 * asset/contract JOIN (with honest "" fallbacks -> em-dash), the four-way STATUS
 * derivation (every signal: signature/checkin/result/next_due, + precedence), the
 * five tabs + their counts, the checklist result cycle (full wrap), and the
 * done/total counters.
 */
import { describe, it, expect } from "vitest";
import {
  toWoRaw,
  toWoAssetRef,
  toWoContractRef,
  buildAssetMap,
  buildContractMap,
  deriveStatus,
  resolveWoRow,
  resolveWoRows,
  filterWoByTab,
  woTabCount,
  statusToneKind,
  cycleResult,
  doneCount,
  allChecked,
  todayISO,
  type WoRaw,
  type WoAssetRef,
  type WoContractRef,
  type ChecklistItem,
} from "./wo-rows";

/** Fixed "today" for deterministic status math (matches the current loop date). */
const TODAY = "2026-07-20";

const raw = (over: Partial<WoRaw> = {}): WoRaw => ({
  id: "w1",
  assetId: "a1",
  templateId: "",
  tech: "Tech A",
  checkinGps: "",
  items: [],
  cause: "",
  fix: "",
  advice: "",
  customerSign: "",
  ...over,
});

const item = (result: ChecklistItem["result"], label = "check"): ChecklistItem => ({
  label,
  result,
});

describe("toWoRaw", () => {
  it("narrows the snake_case wire (items -> {label,result}, gaps -> '')", () => {
    expect(
      toWoRaw({
        id: "u1",
        asset_id: "as1",
        template_id: "t1",
        tech: "Somchai",
        checkin_gps: "13.8,100.5",
        items: [
          { label: "brake", result: "normal" },
          { label: "cable", result: "repair" },
        ],
        cause: "door sensor",
        fix: "replaced",
        advice: "",
        customer_sign: "signed",
      }),
    ).toEqual({
      id: "u1",
      assetId: "as1",
      templateId: "t1",
      tech: "Somchai",
      checkinGps: "13.8,100.5",
      items: [
        { label: "brake", result: "normal" },
        { label: "cable", result: "repair" },
      ],
      cause: "door sensor",
      fix: "replaced",
      advice: "",
      customerSign: "signed",
    });
  });

  it("accepts camelCase + coerces an unknown/absent item result to ''", () => {
    expect(
      toWoRaw({
        id: "u2",
        assetId: "as2",
        items: [{ label: "x", result: "bogus" }, { label: "y" }],
      }),
    ).toEqual({
      id: "u2",
      assetId: "as2",
      templateId: "",
      tech: "",
      checkinGps: "",
      items: [
        { label: "x", result: "" },
        { label: "y", result: "" },
      ],
      cause: "",
      fix: "",
      advice: "",
      customerSign: "",
    });
  });

  it("defaults a non-array items field to []", () => {
    expect(toWoRaw({ id: "u3", items: "nope" }).items).toEqual([]);
  });
});

describe("toWoAssetRef / toWoContractRef narrowing", () => {
  it("reads name/code/site/next_due/contract_id (migration 0034)", () => {
    expect(
      toWoAssetRef({
        id: "a1",
        name: "Lift MX-1000",
        code: "LIFT-A01",
        site: "Tower A",
        next_due: "2026-08-01",
        contract_id: "c1",
      }),
    ).toEqual({
      id: "a1",
      name: "Lift MX-1000",
      code: "LIFT-A01",
      site: "Tower A",
      nextDue: "2026-08-01",
      contractId: "c1",
    });
    expect(toWoContractRef({ id: "c1", sla: "4h" })).toEqual({ id: "c1", sla: "4h" });
  });
});

describe("deriveStatus (each signal + precedence)", () => {
  it("done wins whenever a customer signature exists (even with everything else)", () => {
    expect(
      deriveStatus(
        { customerSign: "sig", checkinGps: "13,100", items: [item("repair")] },
        "2026-01-01",
        TODAY,
      ),
    ).toBe("done");
  });

  it("inprogress from a checkin GPS alone", () => {
    expect(
      deriveStatus({ customerSign: "", checkinGps: "13,100", items: [] }, "2026-08-01", TODAY),
    ).toBe("inprogress");
  });

  it("inprogress from any filled checklist result alone (no checkin yet)", () => {
    expect(
      deriveStatus({ customerSign: "", checkinGps: "", items: [item("normal")] }, "2026-08-01", TODAY),
    ).toBe("inprogress");
  });

  it("overdue only when untouched and the asset next_due is strictly past", () => {
    expect(
      deriveStatus({ customerSign: "", checkinGps: "", items: [item("")] }, "2026-07-19", TODAY),
    ).toBe("overdue");
  });

  it("open when untouched and next_due is today/future or missing", () => {
    expect(deriveStatus({ customerSign: "", checkinGps: "", items: [] }, TODAY, TODAY)).toBe("open");
    expect(deriveStatus({ customerSign: "", checkinGps: "", items: [] }, "2026-09-01", TODAY)).toBe("open");
    // no joined asset -> next_due "" -> overdue undecidable -> open (honest)
    expect(deriveStatus({ customerSign: "", checkinGps: "", items: [] }, "", TODAY)).toBe("open");
  });
});

describe("resolveWoRow (asset + contract join, honest '' fallbacks)", () => {
  const assets: WoAssetRef[] = [
    { id: "a1", name: "Lift MX-1000", code: "LIFT-A01", site: "Tower A", nextDue: "2026-07-19", contractId: "c1" },
  ];
  const contracts: WoContractRef[] = [{ id: "c1", sla: "4h" }];
  const assetMap = buildAssetMap(assets);
  const contractMap = buildContractMap(contracts);

  it("fills name/code/site/next_due from the asset + SLA from the contract", () => {
    const row = resolveWoRow(raw({ assetId: "a1" }), assetMap, contractMap, TODAY);
    expect(row.assetName).toBe("Lift MX-1000");
    expect(row.assetCode).toBe("LIFT-A01");
    expect(row.site).toBe("Tower A");
    expect(row.nextDue).toBe("2026-07-19");
    expect(row.sla).toBe("4h");
    // untouched WO with a past asset next_due -> overdue
    expect(row.status).toBe("overdue");
  });

  it("em-dashes (empty) every join field when the asset is absent", () => {
    const row = resolveWoRow(raw({ assetId: "ghost" }), assetMap, contractMap, TODAY);
    expect(row.assetName).toBe("");
    expect(row.assetCode).toBe("");
    expect(row.site).toBe("");
    expect(row.nextDue).toBe("");
    expect(row.sla).toBe("");
    expect(row.status).toBe("open"); // no next_due -> overdue undecidable
  });

  it("em-dashes SLA when the asset resolves but its contract is absent", () => {
    const orphan = buildAssetMap([
      { id: "a2", name: "Pump", code: "PUMP-01", site: "B1", nextDue: "2026-09-01", contractId: "missing" },
    ]);
    const row = resolveWoRow(raw({ assetId: "a2" }), orphan, contractMap, TODAY);
    expect(row.assetName).toBe("Pump");
    expect(row.sla).toBe("");
  });
});

describe("tabs (filter + counts over derived status)", () => {
  const assets: WoAssetRef[] = [
    { id: "a1", name: "A", code: "A01", site: "s", nextDue: "2026-07-19", contractId: "c1" }, // past
    { id: "a2", name: "B", code: "B01", site: "s", nextDue: "2026-09-01", contractId: "c1" }, // future
  ];
  const assetMap = buildAssetMap(assets);
  const contractMap = buildContractMap([{ id: "c1", sla: "4h" }]);
  const raws: WoRaw[] = [
    raw({ id: "open1", assetId: "a2" }), // future, untouched -> open
    raw({ id: "over1", assetId: "a1" }), // past, untouched -> overdue
    raw({ id: "prog1", assetId: "a2", checkinGps: "13,100" }), // checkin -> inprogress
    raw({ id: "done1", assetId: "a1", customerSign: "sig" }), // signed -> done
  ];
  const rows = resolveWoRows(raws, assetMap, contractMap, TODAY);

  it("partitions each tab by derived status", () => {
    expect(filterWoByTab(rows, "all").map((r) => r.id)).toEqual(["open1", "over1", "prog1", "done1"]);
    expect(filterWoByTab(rows, "open").map((r) => r.id)).toEqual(["open1"]);
    expect(filterWoByTab(rows, "inprogress").map((r) => r.id)).toEqual(["prog1"]);
    expect(filterWoByTab(rows, "overdue").map((r) => r.id)).toEqual(["over1"]);
    expect(filterWoByTab(rows, "done").map((r) => r.id)).toEqual(["done1"]);
  });

  it("counts each tab", () => {
    expect(woTabCount(rows, "all")).toBe(4);
    expect(woTabCount(rows, "open")).toBe(1);
    expect(woTabCount(rows, "inprogress")).toBe(1);
    expect(woTabCount(rows, "overdue")).toBe(1);
    expect(woTabCount(rows, "done")).toBe(1);
  });

  it("filterWoByTab('all') does not alias the input array", () => {
    const all = filterWoByTab(rows, "all");
    expect(all).not.toBe(rows);
    expect(all).toEqual(rows);
  });
});

describe("statusToneKind (PMWO_STATUS.s map)", () => {
  it("maps each derived status to its ds.jsx badge tone", () => {
    expect(statusToneKind("open")).toBe("draft");
    expect(statusToneKind("inprogress")).toBe("pending");
    expect(statusToneKind("overdue")).toBe("rejected");
    expect(statusToneKind("done")).toBe("approved");
  });
});

describe("cycleResult (full tap wrap, pm3.jsx RESULT_OPTS)", () => {
  it("cycles none -> normal -> adjust -> repair -> none", () => {
    expect(cycleResult("")).toBe("normal");
    expect(cycleResult("normal")).toBe("adjust");
    expect(cycleResult("adjust")).toBe("repair");
    expect(cycleResult("repair")).toBe("");
  });
});

describe("doneCount / allChecked", () => {
  it("counts filled lines and gates 'all done'", () => {
    const items = [item("normal"), item(""), item("repair")];
    expect(doneCount(items)).toBe(2);
    expect(allChecked(items)).toBe(false);
    expect(allChecked([item("normal"), item("adjust")])).toBe(true);
    expect(allChecked([])).toBe(false); // empty checklist is never "all done"
  });
});

describe("todayISO", () => {
  it("yields a YYYY-MM-DD slice", () => {
    expect(todayISO(new Date("2026-07-20T09:14:00Z"))).toBe("2026-07-20");
  });
});
