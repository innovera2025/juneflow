// GET /counts — tenant-scoped nav badge counts (P1-BE-02, B-040(ก)).
//
// Contract (openapi.yaml /counts → Counts): ?keys=<comma-separated nav badge
// ids> → { counts: { key: number } }. The 9 keys are the NAV badge sources in
// pototype chrome.jsx; decision C10 forbids hardcoded badge numbers, so every
// value is a live query over the module's pending-state rows per the
// docs/handoff/flows.html state machines. Every query runs through TenantDb
// (company_id-scoped select / selectThrough) — counts can never escape tenant
// scope.
//
// Pending semantics per key (source: flows.html + schema enums — the exact
// rulings are journaled in agents/journal/backend.md for this round):
//   boq.approval   boq_doc.status = 'pending' (dictionary: draft | pending |
//                  approved | revise — only 'pending' awaits approval).
//   boq            parent badge mirrors its child boq.approval
//                  (chrome.jsx NAV: both badge 4).
//   pr.list        pr.status = 'pending' (FLOW-A: draft → pending(ขั้น 1..n) →
//                  approved | rejected — 'pending' is the awaiting state).
//   accept         work_period.status ∈ {delivered, inspecting, rejected}
//                  (FLOW-B/C3: delivered รอตรวจ · inspecting กำลังตรวจ ·
//                  rejected รอแก้+ตรวจซ้ำ — all live in ศูนย์ตรวจรับ).
//   pm.wo          pm_workorder with customer_sign IS NULL. flows FLOW-C names
//                  open → inprogress → done | overdue but the schema carries no
//                  status column; closing = customer signature (ปิดงาน +
//                  ลายเซ็นลูกค้า), so unsigned = not yet closed.
//   gl.inbox       source money docs not yet posted to a JV (FLOW-F: เอกสาร
//                  ต้นทาง → GL Posting Inbox → gen JV). Docs with real tables:
//                  pv, rv, gr, payroll. Posted-ness = a jv.source_doc
//                  "table:uuid" ref (finance.ts convention). ค่าเสื่อม/ปันส่วน
//                  sources have no backing table (seed REPORT_DERIVED) and are
//                  not countable.
//   sales.crm      all lead rows — the 5-stage funnel (lead → visit → quote →
//                  booking → contract) has no closed state; the whole pipeline
//                  is open CRM work.
//   sales.service  service_ticket.status != 'closed' (received / scheduled /
//                  fixing / fixed are all still open after-sales work).
//   sales          parent badge mirrors its child sales.service
//                  (chrome.jsx NAV: both badge 5).
import type { FastifyInstance } from "fastify";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  boqDocs,
  grs,
  jvs,
  leads,
  payrolls,
  pmAssets,
  pmContracts,
  pmWorkOrders,
  pos,
  projects,
  prs,
  pvs,
  rvs,
  serviceTickets,
  subconContracts,
  vendors,
  workPeriods,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

/** The 9 nav badge ids (chrome.jsx NAV badge sources — contract enum). */
export const COUNT_KEYS = [
  "boq",
  "boq.approval",
  "pr.list",
  "accept",
  "pm.wo",
  "gl.inbox",
  "sales",
  "sales.crm",
  "sales.service",
] as const;

export type CountKey = (typeof COUNT_KEYS)[number];

const COUNT_KEY_SET: ReadonlySet<string> = new Set(COUNT_KEYS);

/** jv.source_doc "table:uuid" polymorphic ref (finance.ts GLPosting model). */
const SOURCE_DOC_REF = /^(pv|rv|gr|payroll):([0-9a-fA-F-]{36})$/;

/** boq_doc rows awaiting approval (status = pending), project-scoped. */
async function countBoqApproval(db: TenantDb): Promise<number> {
  const rows = await db.selectThrough(
    boqDocs,
    [{ fk: boqDocs.projectId, parent: projects }],
    eq(boqDocs.status, "pending"),
  );
  return rows.length;
}

/** pr rows awaiting approval (FLOW-A pending state). */
async function countPrPending(db: TenantDb): Promise<number> {
  const rows = await db.selectThrough(
    prs,
    [{ fk: prs.projectId, parent: projects }],
    eq(prs.status, "pending"),
  );
  return rows.length;
}

/** work periods in the acceptance-center queue (FLOW-B / C3). */
async function countAcceptQueue(db: TenantDb): Promise<number> {
  const rows = await db.selectThrough(
    workPeriods,
    [
      { fk: workPeriods.contractId, parent: subconContracts },
      { fk: subconContracts.projectId, parent: projects },
    ],
    inArray(workPeriods.status, ["delivered", "inspecting", "rejected"]),
  );
  return rows.length;
}

/** PM work orders not yet closed (no customer signature — FLOW-C ปิดงาน). */
async function countPmOpen(db: TenantDb): Promise<number> {
  const rows = await db.selectThrough(
    pmWorkOrders,
    [
      { fk: pmWorkOrders.assetId, parent: pmAssets },
      { fk: pmAssets.contractId, parent: pmContracts },
      { fk: pmContracts.projectId, parent: projects },
    ],
    isNull(pmWorkOrders.customerSign),
  );
  return rows.length;
}

/** Source money docs not yet posted to a JV (FLOW-F posting inbox). */
async function countGlInbox(db: TenantDb): Promise<number> {
  const [pvRows, rvRows, payrollRows, grRows, jvRows] = await Promise.all([
    db.select(pvs),
    db.select(rvs),
    db.select(payrolls),
    db.selectThrough(grs, [
      { fk: grs.poId, parent: pos },
      { fk: pos.vendorId, parent: vendors },
    ]),
    db.select(jvs),
  ]);

  const posted = new Set<string>();
  for (const jv of jvRows) {
    const ref = jv.sourceDoc ? SOURCE_DOC_REF.exec(jv.sourceDoc) : null;
    if (ref) posted.add(`${ref[1]}:${ref[2]?.toLowerCase()}`);
  }
  const pending = (table: string, ids: { id: string }[]): number =>
    ids.filter((row) => !posted.has(`${table}:${row.id.toLowerCase()}`)).length;

  return (
    pending("pv", pvRows) +
    pending("rv", rvRows) +
    pending("payroll", payrollRows) +
    pending("gr", grRows)
  );
}

/** Open CRM pipeline — every lead in the 5-stage funnel. */
async function countLeads(db: TenantDb): Promise<number> {
  const rows = await db.select(leads);
  return rows.length;
}

/** After-sales tickets still open (status != closed; NULL status = open). */
async function countOpenTickets(db: TenantDb): Promise<number> {
  const rows = await db.select(serviceTickets);
  return rows.filter((t) => t.status !== "closed").length;
}

/**
 * Resolve the requested keys with parent-mirror sharing: `boq` mirrors
 * `boq.approval` and `sales` mirrors `sales.service` (chrome.jsx NAV), so each
 * underlying query runs at most once per request.
 */
export async function resolveCounts(
  db: TenantDb,
  keys: readonly CountKey[],
): Promise<Record<string, number>> {
  const memo = new Map<string, Promise<number>>();
  const once = (key: string, run: () => Promise<number>): Promise<number> => {
    let hit = memo.get(key);
    if (!hit) {
      hit = run();
      memo.set(key, hit);
    }
    return hit;
  };

  const resolveKey = (key: CountKey): Promise<number> => {
    switch (key) {
      case "boq":
      case "boq.approval":
        return once("boq.approval", () => countBoqApproval(db));
      case "pr.list":
        return once("pr.list", () => countPrPending(db));
      case "accept":
        return once("accept", () => countAcceptQueue(db));
      case "pm.wo":
        return once("pm.wo", () => countPmOpen(db));
      case "gl.inbox":
        return once("gl.inbox", () => countGlInbox(db));
      case "sales":
      case "sales.crm":
      case "sales.service":
        return key === "sales.crm"
          ? once("sales.crm", () => countLeads(db))
          : once("sales.service", () => countOpenTickets(db));
    }
  };

  const counts: Record<string, number> = {};
  await Promise.all(
    keys.map(async (key) => {
      counts[key] = await resolveKey(key);
    }),
  );
  return counts;
}

/** Parse ?keys= (comma-separated; Fastify may also give a repeated array). */
function parseKeys(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
  return parts
    .flatMap((p) => p.split(","))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Register GET /counts on the given (already /api/v1-prefixed) scope. */
export function registerCountsRoute(app: FastifyInstance): void {
  app.get("/counts", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const { keys: rawKeys } = request.query as { keys?: unknown };
    const requested = parseKeys(rawKeys);
    if (requested.length === 0) {
      return reply.code(400).send({
        code: "MISSING_COUNT_KEYS",
        message: "keys query parameter is required (comma-separated nav ids)",
      });
    }
    const unknown = requested.find((k) => !COUNT_KEY_SET.has(k));
    if (unknown !== undefined) {
      return reply.code(400).send({
        code: "INVALID_COUNT_KEY",
        message: `Unknown count key: ${unknown}`,
      });
    }

    const counts = await resolveCounts(db, requested as CountKey[]);
    return reply.code(200).send({ counts });
  });
}
