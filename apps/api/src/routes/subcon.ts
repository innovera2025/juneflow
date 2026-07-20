// Subcon / Acceptance handlers — Phase-4 FLOW-B Wave-0 (P4-BE, contract FROZEN;
// pototype/subcon-accept.jsx SubconContracts + subcon-accept2.jsx SubconAccept /
// AcceptForm, docs/handoff/flows.html FLOW-B "งวดงานผู้รับเหมา + ศูนย์ตรวจรับ
// (Acceptance & Defect Loop)", MATRIX row "รับงวดงาน (ตรวจรับ)").
//
// Contract (openapi.yaml /subcon-contracts … — opaque Entity bodies): the wire
// fields below are REAL DB columns only (C10 — no fabricated fields; money
// carries currency_code; DB camelCase serialized to response snake_case like the
// sibling routes). Ops implemented here:
//   listSubconContracts   GET  /subcon-contracts                → EntityList
//   createSubconContract  POST /subcon-contracts                → 201 EntityCreated
//   listSubconContractPeriods GET /subcon-contracts/{id}/periods → EntityList (404)
//   deliverPeriod         POST /periods/{id}/deliver            → ActionOk
//   inspectPeriod         POST /periods/{id}/inspect            → ActionOk
//   approvePeriodPayment  POST /periods/{id}/approve-payment    → ActionOk (Wave-2)
//   fixDefect             POST /defects/{id}/fix                → ActionOk
//   recheckDefect         POST /defects/{id}/recheck            → ActionOk
//   listAcceptanceCenter  GET  /acceptance-center               → EntityList
//
// approvePeriodPayment (Wave-2, B-107a/c) — the payment approval of an inspected-
// PASS period: the money is SERVER-COMPUTED (no client amount is read), gross by
// basis, retention held back, AP billing + retention-ledger HELD row + the period
// → `paid` flip written in ONE transaction (MATRIX "อนุมัติจ่ายงวด"). Still GATED
// (Wave-2, left as a follow-up): createSubconContract does NOT autosplit periods
// from a distance/unit basis (subcon-accept.jsx SubcContractForm "→ ระบบจะแบ่งเป็น
// N งวด").
//
// State machines (decision C3 — packages/db/src/schema/subcon.ts enum comments +
// flows.html FLOW-B):
//   work_period.status: pending → delivered → inspecting → passed | rejected → paid
//     · deliver  (flows.html L46 "ผู้รับเหมาส่งมอบ + เอกสาร/รูป"): pending → delivered
//     · inspect  (flows.html L46-47 "นัดตรวจ (โฟร์แมน mobile) → ผ่าน | ↘ ตีกลับ"):
//                delivered|inspecting → passed (result=pass) | rejected (result=reject)
//     `paid` is Wave-2 (approve-payment). `inspecting` is accepted as an inspect
//     source (a foreman mid-inspection — counts.ts:98-106 queues it) but Wave-0
//     never auto-produces it; deliver goes straight to `delivered`. `paid` is
//     reached by approvePeriodPayment (Wave-2) — only from `passed`.
//   defect.status: open → fixing → recheck → closed (data-dictionary)
//     · fix     (flows.html L47 "ผู้รับเหมาแก้ไข (กำหนดเวลา)"): open|recheck → fixing
//               (store {photo_after} → after_photo)
//     · recheck (flows.html L47 "ตรวจซ้ำ → ผ่าน (Defect ปิด)"): fixing → closed
//               (result pass-like) | open (otherwise)
//     Wave-0 runs the open ⇄ fixing → closed loop; the dictionary's intermediate
//     `recheck` status is accepted as a fix source but not auto-produced here.
//
// Tenant scope (CRITICAL — subcon tree carries NO company_id): every table is
// parent-FK-scoped and anchors on the company_id-scoped project root via a hop
// chain (subcon.ts schema header: "Company scope flows through project_id /
// vendor_id"):
//   subcon_contract → project                                     (1 hop)
//   work_period     → subcon_contract → project                   (2 hops)
//   acceptance      → work_period → subcon_contract → project     (3 hops)
//   defect → acceptance → work_period → subcon_contract → project (4 hops)
// Reads go through selectThrough(); creates through insertThrough(projects,
// projectId) (re-verifies project ownership fail-closed); state mutations through
// updateThroughChain() (resolves the target THROUGH the chain to the tenant root,
// then updates only the resolved ids — a foreign id resolves to nothing → 404 and
// is never written). Without a resolved tenant, request.db is absent → 401.
import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import {
  subconContracts,
  workPeriods,
  acceptances,
  defects,
  projects,
  vendors,
  apBillings,
  retentionLedgers,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";

type SubconContractRow = typeof subconContracts.$inferSelect;
type WorkPeriodRow = typeof workPeriods.$inferSelect;
type AcceptanceRow = typeof acceptances.$inferSelect;
type DefectRow = typeof defects.$inferSelect;
type ApBillingRow = typeof apBillings.$inferSelect;

/** work_period_basis enum (schema C2): percent | distance(m) | milestone | unit. */
const PERIOD_BASES = new Set(["percent", "distance", "milestone", "unit"]);

/**
 * The C3 acceptance-center period queue (counts.ts:98-106): a work period is
 * "in the acceptance center" while delivered (รอตรวจ) / inspecting (กำลังตรวจ) /
 * rejected (รอแก้+ตรวจซ้ำ). Reused verbatim so the badge count and this list can
 * never drift.
 */
const ACCEPT_QUEUE_STATUSES = ["delivered", "inspecting", "rejected"] as const;

/**
 * recheck result vocabulary (task decision + flows.html L47 "ตรวจซ้ำ → ผ่าน
 * (Defect ปิด)"): {result} is a free string, so a pass-like value closes the
 * defect; anything else re-opens it for another fix cycle.
 */
const RECHECK_PASS_LIKE = new Set(["pass", "passed", "closed", "ok", "true"]);

/**
 * The single stable %-gate advisory code (Wei B-107c). It is a machine-readable
 * FLAG, never rendered UI copy — the FE maps it to the prototype's Thai banner /
 * modal (subcon-accept2.jsx) from its own i18n, so no UI string is invented on
 * the server (Design-Fidelity §0 — every UI word is an i18n key). It NEVER
 * changes a status code: a pass / approve always proceeds (B-107c "warn, never
 * block"). See progressWarning() for the honest, period-derived semantics.
 */
const PROGRESS_AHEAD_WARNING = "accepted_ahead_of_progress";

// Scope hop chains anchoring each parent-FK-scoped subcon table on the
// company_id-scoped project root (the final hop's parent MUST be `projects`).
const CONTRACT_HOPS = [{ fk: subconContracts.projectId, parent: projects }];
const PERIOD_HOPS = [
  { fk: workPeriods.contractId, parent: subconContracts },
  { fk: subconContracts.projectId, parent: projects },
];
const ACCEPTANCE_HOPS = [
  { fk: acceptances.periodId, parent: workPeriods },
  { fk: workPeriods.contractId, parent: subconContracts },
  { fk: subconContracts.projectId, parent: projects },
];
const DEFECT_HOPS = [
  { fk: defects.acceptanceId, parent: acceptances },
  { fk: acceptances.periodId, parent: workPeriods },
  { fk: workPeriods.contractId, parent: subconContracts },
  { fk: subconContracts.projectId, parent: projects },
];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** First present value among the given opaque field aliases. */
function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

/** Parse a finite number (number | numeric string) from opaque JSON, else null. */
function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A string[] from an opaque field (non-string entries dropped), else []. */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A computed 2-dp money magnitude as the numeric-column string ("430000.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/**
 * Server-computed GROSS payment for a PASSED work period (B-107a — the money
 * authority is the SERVER; no client-supplied amount is ever read). By basis
 * (schema C2), all numeric columns arrive as strings → coerced via toNum:
 *   percent   → (pct / 100) × contract.value
 *   distance  → perPeriodQty × ratePerUnit   (migration 0033 cols)
 *   unit      → perPeriodQty × ratePerUnit
 *   milestone → the period's stored fixed `amount`
 * Rounded to 2 dp (the currency minor unit).
 */
function computeGross(period: WorkPeriodRow, contract: SubconContractRow): number {
  switch (period.basis) {
    case "percent":
      return round2(((toNum(period.pct) ?? 0) / 100) * (toNum(contract.value) ?? 0));
    case "distance":
    case "unit":
      return round2((toNum(period.perPeriodQty) ?? 0) * (toNum(period.ratePerUnit) ?? 0));
    case "milestone":
      return round2(toNum(period.amount) ?? 0);
    default:
      return 0;
  }
}

/**
 * The %-gate ADVISORY (Wei B-107c; subcon-accept2.jsx openAccept L23-26 + the
 * AcceptForm banner L171-174). The prototype's HARD gate compares each period's
 * cumulative target (cumMap, L17-18) against an EXTERNAL real project-progress
 * feed (PROJECT_PROGRESS, L14-15 — "รออัปเดต % งานจากหน้างาน/Timeline") and BLOCKS
 * the click in the FE (openModal, L24-26). That external progress feed is NOT a
 * server column (C10 — never fabricated) and the gate is purely PRESENTATIONAL,
 * so the server keeps only an HONEST advisory, derived STRICTLY from the
 * contract's own period rows, that NEVER changes the status code.
 *
 * Honest real-progress proxy = the periods actually recorded done (passed/paid),
 * with the period being accepted NOW counted as realized:
 *   - percent basis (cumMap): cumTarget = Σ pct of periods with seq ≤ this seq;
 *     realized = Σ pct of the passed/paid periods (this one counted). A warning
 *     fires when cumTarget > realized — an EARLIER period (lower seq) is still not
 *     accepted, so this acceptance runs AHEAD of the recorded progress.
 *   - distance | unit | milestone: the same out-of-sequence signal by COUNT —
 *     targetPos = #periods with seq ≤ this seq; realizedCount = #passed/paid
 *     periods (this one counted); warning when targetPos > realizedCount.
 * Returns null (honestly not computable) when there is no sibling to compare
 * (a single period), or — percent basis — when no period carries a pct target.
 */
function progressWarning(target: WorkPeriodRow, siblings: WorkPeriodRow[]): string | null {
  if (siblings.length <= 1) return null; // nothing to compare against
  const realized = (p: WorkPeriodRow): boolean =>
    p.id === target.id || p.status === "passed" || p.status === "paid";
  if (target.basis === "percent") {
    const totalPct = siblings.reduce((s, p) => s + (toNum(p.pct) ?? 0), 0);
    if (totalPct <= 0) return null; // no percent target data → not honestly computable
    const cumTarget = siblings
      .filter((p) => p.seq <= target.seq)
      .reduce((s, p) => s + (toNum(p.pct) ?? 0), 0);
    const realizedPct = siblings
      .filter(realized)
      .reduce((s, p) => s + (toNum(p.pct) ?? 0), 0);
    return cumTarget > realizedPct ? PROGRESS_AHEAD_WARNING : null;
  }
  // distance | unit | milestone — the out-of-sequence signal by COUNT.
  const targetPos = siblings.filter((p) => p.seq <= target.seq).length;
  const realizedCount = siblings.filter(realized).length;
  return targetPos > realizedCount ? PROGRESS_AHEAD_WARNING : null;
}

/**
 * The opaque Entity wire shape for a subcon contract: real subcon_contract
 * columns only. `value` is money → carries currency_code; retention_pct is the
 * held-back percentage.
 */
function contractWire(c: SubconContractRow): Record<string, unknown> {
  return {
    id: c.id,
    no: c.no,
    vendor_id: c.vendorId,
    project_id: c.projectId,
    value: Number(c.value),
    currency_code: c.currencyCode,
    retention_pct: Number(c.retentionPct),
    start: c.start,
    end: c.end,
  };
}

/**
 * The opaque Entity wire shape for a work period: real work_period columns only.
 * `amount` is money → carries currency_code; target/pct are the basis-dependent
 * target + percent-complete.
 */
function periodWire(p: WorkPeriodRow): Record<string, unknown> {
  return {
    id: p.id,
    contract_id: p.contractId,
    seq: p.seq,
    basis: p.basis,
    target: Number(p.target),
    pct: Number(p.pct),
    amount: Number(p.amount),
    currency_code: p.currencyCode,
    status: p.status,
  };
}

/** The opaque Entity wire shape for an acceptance (real acceptance columns). */
function acceptanceWire(a: AcceptanceRow): Record<string, unknown> {
  return {
    id: a.id,
    period_id: a.periodId,
    inspector: a.inspector,
    photos: a.photos ?? [],
    docs: a.docs ?? [],
    signed_at: a.signedAt,
  };
}

/** The opaque Entity wire shape for a defect (real defect columns). */
function defectWire(d: DefectRow): Record<string, unknown> {
  return {
    id: d.id,
    acceptance_id: d.acceptanceId,
    item: d.item,
    severity: d.severity,
    before_photo: d.beforePhoto,
    after_photo: d.afterPhoto,
    due: d.due,
    status: d.status,
  };
}

/**
 * Resolve a work period + its owning contract within this tenant (the contract
 * read yields the project_id needed to anchor scoped writes). Both reads go
 * THROUGH the hop chain to the company_id root, so a foreign id resolves to
 * nothing → null (→ 404, never mutated).
 */
async function resolvePeriod(
  db: TenantDb,
  periodId: string,
): Promise<{ period: WorkPeriodRow; contract: SubconContractRow } | null> {
  const [period] = await db.selectThrough(workPeriods, PERIOD_HOPS, eq(workPeriods.id, periodId));
  if (!period) return null;
  const [contract] = await db.selectThrough(
    subconContracts,
    CONTRACT_HOPS,
    eq(subconContracts.id, period.contractId),
  );
  // The period resolved through this contract, so the contract necessarily
  // exists and is tenant-owned; the read simply surfaces its project_id.
  if (!contract) return null;
  return { period, contract };
}

/** The single acceptance of a period (one per period), tenant-scoped, or null. */
async function findAcceptance(db: TenantDb, periodId: string): Promise<AcceptanceRow | null> {
  const [acc] = await db.selectThrough(acceptances, ACCEPTANCE_HOPS, eq(acceptances.periodId, periodId));
  return acc ?? null;
}

/** Register the subcon routes on the given (already /api/v1-prefixed) scope. */
export function registerSubconRoute(app: FastifyInstance): void {
  // GET /subcon-contracts — the tenant's subcon contracts (subcon-accept.jsx
  // SubconContracts). Filter/Page are honored as one full page (list-envelope.ts).
  app.get("/subcon-contracts", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.selectThrough(subconContracts, CONTRACT_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(contractWire)));
  });

  // POST /subcon-contracts — create a subcon contract (CORE create, NO autosplit
  // — Wave-2). Server owns each embedded period's status (always `pending`). The
  // scope anchors on the tenant-owned project via insertThrough (fail-closed); an
  // optional periods[] is created atomically with the contract (db.transaction).
  app.post("/subcon-contracts", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const projectId = str(pick(body, "project_id", "projectId")).trim();
    const vendorId = str(pick(body, "vendor_id", "vendorId")).trim();
    const no = str(pick(body, "no")).trim();
    const value = toNum(pick(body, "value")) ?? 0;
    const retentionPct = toNum(pick(body, "retention_pct", "retentionPct")) ?? 0;
    const currencyCode = str(pick(body, "currency_code", "currencyCode")).trim() || "THB";
    const start = str(pick(body, "start")).trim() || null;
    const end = str(pick(body, "end")).trim() || null;

    if (!projectId) {
      return reply.code(400).send({ code: "VALIDATION", message: "project_id is required" });
    }
    if (!vendorId) {
      return reply.code(400).send({ code: "VALIDATION", message: "vendor_id is required" });
    }
    if (!no) {
      return reply.code(400).send({ code: "VALIDATION", message: "no is required" });
    }
    if (value < 0 || retentionPct < 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "value / retention_pct must be >= 0" });
    }

    // The target project must belong to this tenant (scoped select — a foreign id
    // resolves to nothing, so nothing leaks; insertThrough re-verifies below).
    const [project] = await db.select(projects, eq(projects.id, projectId));
    if (!project) {
      return reply.code(400).send({ code: "VALIDATION", message: "project not found" });
    }
    // The vendor is a tenant table (own company_id) — a subcon contract must never
    // anchor on another tenant's vendor. Scoped read → foreign id is invisible.
    const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
    if (!vendor) {
      return reply.code(400).send({ code: "VALIDATION", message: "vendor not found" });
    }

    // Parse the optional embedded periods (core only — no autosplit computation).
    // status is server-owned (`pending`); basis must be a valid C2 enum value.
    const rawPeriods = pick(body, "periods");
    const periodDrafts: Omit<typeof workPeriods.$inferInsert, "contractId">[] = [];
    if (Array.isArray(rawPeriods)) {
      for (const raw of rawPeriods) {
        const p = (raw ?? {}) as Record<string, unknown>;
        const basis = str(pick(p, "basis")).trim();
        if (!PERIOD_BASES.has(basis)) {
          return reply.code(400).send({
            code: "VALIDATION",
            message: "period basis must be one of percent, distance, milestone, unit",
          });
        }
        periodDrafts.push({
          seq: toNum(pick(p, "seq")) ?? 0,
          basis: basis as "percent" | "distance" | "milestone" | "unit",
          target: String(toNum(pick(p, "target")) ?? 0),
          pct: String(toNum(pick(p, "pct")) ?? 0),
          amount: String(toNum(pick(p, "amount")) ?? 0),
          currencyCode: str(pick(p, "currency_code", "currencyCode")).trim() || currencyCode,
          status: "pending",
        });
      }
    }

    // Contract + its periods are ONE creation — a single transaction (B-097 door)
    // so a contract can never persist with a half-written period set. Both writes
    // anchor on the tenant-owned project (insertThrough re-verifies each), so the
    // period insert is scoped, never bare.
    const created = await db.transaction(async (tx) => {
      const [contract] = await tx.insertThrough(subconContracts, projects, projectId, [
        {
          projectId,
          vendorId,
          no,
          value: String(value),
          currencyCode,
          retentionPct: String(retentionPct),
          start,
          end,
        },
      ]);
      let periods: WorkPeriodRow[] = [];
      if (periodDrafts.length) {
        periods = await tx.insertThrough(
          workPeriods,
          projects,
          projectId,
          periodDrafts.map((d) => ({ ...d, contractId: contract!.id })),
        );
      }
      return { contract: contract!, periods };
    });

    return reply.code(201).send({
      ...contractWire(created.contract),
      periods: created.periods.map(periodWire),
    });
  });

  // GET /subcon-contracts/:id/periods — a contract's work periods
  // (subcon-accept2.jsx SubconAccept period table). 404 if the contract is not
  // this tenant's (a foreign id resolves to nothing on the scoped read).
  app.get("/subcon-contracts/:id/periods", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [contract] = await db.selectThrough(subconContracts, CONTRACT_HOPS, eq(subconContracts.id, id));
    if (!contract) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `subcon contract ${id} not found` });
    }
    const rows = await db.selectThrough(workPeriods, PERIOD_HOPS, eq(workPeriods.contractId, id));
    return reply.code(200).send(listEnvelope([...rows].sort((a, b) => a.seq - b.seq).map(periodWire)));
  });

  // POST /periods/:id/deliver — the contractor delivers a period + its docs/photos
  // (flows.html L46 "ผู้รับเหมาส่งมอบ + เอกสาร/รูป (เข้า DMS)"). pending → delivered;
  // upsert the period's single acceptance with {docs, photos}. Both writes are
  // one transaction (the acceptance write must land with the status flip).
  app.post("/periods/:id/deliver", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const resolved = await resolvePeriod(db, id);
    if (!resolved) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `work period ${id} not found` });
    }
    // C3 guard: only a not-yet-delivered (pending) period can be delivered.
    if (resolved.period.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending work period can be delivered",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const docs = strArray(pick(body, "docs"));
    const photos = strArray(pick(body, "photos"));
    const projectId = resolved.contract.projectId;
    const existing = await findAcceptance(db, id);

    const { acc, period } = await db.transaction(async (tx) => {
      // Upsert the acceptance (one per period): update the existing row's
      // docs/photos, else create it — both scoped through the period chain.
      const acc = existing
        ? (
            await tx.updateThroughChain(
              acceptances,
              ACCEPTANCE_HOPS,
              { docs, photos },
              eq(acceptances.id, existing.id),
            )
          )[0]!
        : (await tx.insertThrough(acceptances, projects, projectId, [{ periodId: id, docs, photos }]))[0]!;
      const [period] = await tx.updateThroughChain(
        workPeriods,
        PERIOD_HOPS,
        { status: "delivered" },
        eq(workPeriods.id, id),
      );
      return { acc, period: period! };
    });

    return reply.code(200).send({ ...periodWire(period), acceptance: acceptanceWire(acc) });
  });

  // POST /periods/:id/inspect — the foreman inspects (subcon-accept2.jsx
  // AcceptForm; flows.html L46-47). delivered|inspecting → passed (result=pass) |
  // rejected (result=reject) + Defect List. NO %-gate here (Wave-2). A pass never
  // carries defects (AcceptForm accept fires only when failN===0) — any defects[]
  // on a pass are ignored.
  app.post("/periods/:id/inspect", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = str(pick(body, "result")).trim().toLowerCase();
    if (result !== "pass" && result !== "reject") {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "result must be pass or reject" });
    }

    const resolved = await resolvePeriod(db, id);
    if (!resolved) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `work period ${id} not found` });
    }
    // C3 guard: only a delivered (or in-flight inspecting) period can be inspected.
    if (resolved.period.status !== "delivered" && resolved.period.status !== "inspecting") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a delivered work period can be inspected",
      });
    }

    // PASS → passed (single scoped status flip; the payment approval that follows
    // in the prototype — "อนุมัติจ่ายงวด → AP" — is the Wave-2 approve-payment op).
    // The %-gate ADVISORY (B-107c) rides the response as an honest, never-blocking
    // flag derived from the contract's own periods (the hard gate is FE-only).
    if (result === "pass") {
      const siblings = await db.selectThrough(
        workPeriods,
        PERIOD_HOPS,
        eq(workPeriods.contractId, resolved.contract.id),
      );
      const warning = progressWarning(resolved.period, siblings);
      const [period] = await db.updateThroughChain(
        workPeriods,
        PERIOD_HOPS,
        { status: "passed" },
        eq(workPeriods.id, id),
      );
      return reply.code(200).send({ ...periodWire(period!), warning });
    }

    // REJECT → rejected + a Defect List (flows.html L47 "ตีกลับ + Defect List
    // (รายข้อ+รูปก่อน/หลัง)"). Parse the defects; each needs a non-empty `item`.
    const rawDefects = pick(body, "defects");
    const defectDrafts: Omit<typeof defects.$inferInsert, "acceptanceId">[] = [];
    if (Array.isArray(rawDefects)) {
      for (const raw of rawDefects) {
        const d = (raw ?? {}) as Record<string, unknown>;
        const item = str(pick(d, "item")).trim();
        if (!item) continue; // a defect with no described item carries no record
        defectDrafts.push({
          item,
          severity: str(pick(d, "severity")).trim() || null,
          beforePhoto: str(pick(d, "photo_before", "beforePhoto")).trim() || null,
          status: "open",
        });
      }
    }

    const projectId = resolved.contract.projectId;
    const existing = await findAcceptance(db, id);

    // The status flip + acceptance-ensure + defect inserts are ONE inspection —
    // a single transaction so a rejected period can never exist without its
    // Defect List (the defects hang off the acceptance).
    const { period, createdDefects } = await db.transaction(async (tx) => {
      const [period] = await tx.updateThroughChain(
        workPeriods,
        PERIOD_HOPS,
        { status: "rejected" },
        eq(workPeriods.id, id),
      );
      // Defects attach to the period's acceptance — ensure one exists (create an
      // empty acceptance if the contractor delivered without docs/photos).
      const acceptanceId = existing
        ? existing.id
        : (await tx.insertThrough(acceptances, projects, projectId, [{ periodId: id }]))[0]!.id;
      const createdDefects = defectDrafts.length
        ? await tx.insertThrough(
            defects,
            projects,
            projectId,
            defectDrafts.map((d) => ({ ...d, acceptanceId })),
          )
        : [];
      return { period: period!, createdDefects };
    });

    // A reject is not an acceptance, so the out-of-sequence advisory does not
    // apply — warning is honestly null (the reject always proceeds regardless).
    return reply.code(200).send({
      ...periodWire(period),
      defects: createdDefects.map(defectWire),
      warning: null,
    });
  });

  // POST /periods/:id/approve-payment — approve the payment of an inspected-PASS
  // period (subcon-accept2.jsx AcceptForm "รับงาน − ประกัน = จ่าย" → AP; MATRIX
  // "อนุมัติจ่ายงวด"). B-107a — the money authority is the SERVER: the request body
  // carries NO amount; the gross is computed from the stored period + contract
  // columns by basis (computeGross), the retention is held back, and the AP
  // billing + the retention-ledger HELD row + the period → `paid` flip are written
  // in ONE transaction (B-097 door — all-or-nothing).
  app.post("/periods/:id/approve-payment", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const resolved = await resolvePeriod(db, id);
    if (!resolved) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `work period ${id} not found` });
    }
    const { period, contract } = resolved;
    // C3 guard (fail-closed): only an inspected-PASS period is payable. pending /
    // delivered / inspecting / rejected / already-`paid` all 409 INVALID_STATE.
    if (period.status !== "passed") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a passed (inspected) work period can be approved for payment",
      });
    }

    // B-107a — the SERVER computes the money (a client-supplied amount is never
    // read). gross by basis; retention held back at the contract's retention_pct.
    const gross = computeGross(period, contract);
    const retentionAmount = round2((gross * (toNum(contract.retentionPct) ?? 0)) / 100);

    // %-gate ADVISORY (B-107c) — honest, never blocks. Computed from the real
    // period rows only; the hard gate is presentational (subcon-accept2.jsx).
    const siblings = await db.selectThrough(
      workPeriods,
      PERIOD_HOPS,
      eq(workPeriods.contractId, contract.id),
    );
    const warning = progressWarning(period, siblings);

    // ALL THREE writes are ONE unit (B-097 tx door): the AP billing (gross with
    // the retention hold-back recorded), the retention ledger HELD row, and the
    // period → `paid` flip. A throw anywhere rolls back every write — a period can
    // never be `paid` without its AP billing + retention record. ap_billing and
    // retention_ledger carry company_id → plain scoped tx.insert (force-set);
    // the period status flips through the scoped chain door (never a bare update).
    const { billing } = await db.transaction(async (tx) => {
      const [billing] = (await tx
        .insert(apBillings, {
          vendorId: contract.vendorId,
          poId: null,
          grId: null,
          woId: null,
          invoiceNo: null,
          dueDate: null,
          amount: moneyStr(gross),
          retention: moneyStr(retentionAmount),
          currencyCode: contract.currencyCode,
          status: "draft",
        })
        .returning()) as ApBillingRow[];
      await tx
        .insert(retentionLedgers, {
          contractId: contract.id,
          vendorId: contract.vendorId,
          woId: null,
          rate: contract.retentionPct,
          withheld: moneyStr(retentionAmount),
          returned: "0",
          status: "held",
          currencyCode: contract.currencyCode,
          scope: `งวด ${period.seq}`,
        })
        .returning();
      await tx.updateThroughChain(
        workPeriods,
        PERIOD_HOPS,
        { status: "paid" },
        eq(workPeriods.id, id),
      );
      return { billing: billing! };
    });

    // Frozen op (ActionOk) — an informative ok-shaped body. The 50/50 retention
    // release (handover + 12-mo warranty, B-107d) is a LATER accounting lane;
    // here the retention is only recorded HELD.
    return reply.code(200).send({
      ok: true,
      status: "paid",
      basis: period.basis,
      gross,
      retention: retentionAmount,
      net: round2(gross - retentionAmount),
      ap_billing_id: billing.id,
      currency_code: contract.currencyCode,
      warning,
    });
  });

  // POST /defects/:id/fix — the contractor fixes a defect + uploads the after
  // photo (flows.html L47 "ผู้รับเหมาแก้ไข (กำหนดเวลา)"). open|recheck → fixing.
  app.post("/defects/:id/fix", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [defect] = await db.selectThrough(defects, DEFECT_HOPS, eq(defects.id, id));
    if (!defect) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `defect ${id} not found` });
    }
    // Only an open / re-opened (recheck) defect can enter fixing — a closed (or
    // already-fixing) one is a no-op → 409.
    if (defect.status !== "open" && defect.status !== "recheck") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only an open or recheck defect can be fixed",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const afterPhoto = str(pick(body, "photo_after", "afterPhoto")).trim() || null;
    const [updated] = await db.updateThroughChain(
      defects,
      DEFECT_HOPS,
      { status: "fixing", afterPhoto },
      eq(defects.id, id),
    );
    return reply.code(200).send(defectWire(updated!));
  });

  // POST /defects/:id/recheck — the foreman re-inspects a fixed defect (flows.html
  // L47 "ตรวจซ้ำ → ผ่าน (Defect ปิด)"). fixing → closed (result pass-like) | open.
  app.post("/defects/:id/recheck", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [defect] = await db.selectThrough(defects, DEFECT_HOPS, eq(defects.id, id));
    if (!defect) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `defect ${id} not found` });
    }
    // Only a fixed (fixing) defect can be rechecked.
    if (defect.status !== "fixing") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a defect that is being fixed can be rechecked",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = str(pick(body, "result")).trim().toLowerCase();
    // Pass-like → closed (defect resolved); otherwise re-open for another fix cycle.
    const nextStatus = RECHECK_PASS_LIKE.has(result) ? "closed" : "open";
    const [updated] = await db.updateThroughChain(
      defects,
      DEFECT_HOPS,
      { status: nextStatus },
      eq(defects.id, id),
    );
    return reply.code(200).send(defectWire(updated!));
  });

  // GET /acceptance-center — the acceptance center (ศูนย์ตรวจรับ). Wave-0 serves
  // the PERIOD slice only (?type=period, the default): the C3 queue reused from
  // counts.ts (delivered | inspecting | rejected), optionally narrowed by ?status.
  // ?type=gr and ?type=house are the Wave-3 fan-in (GR rejects · house handover,
  // FLOW-E) — honestly EMPTY here, never fabricated.
  app.get("/acceptance-center", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const type = str(pick(query, "type")).trim() || "period";
    if (type === "gr" || type === "house") {
      // Wave-3 fan-in (GR tab / house-acceptance tab) — not sourced in Wave-0.
      return reply.code(200).send(listEnvelope([]));
    }

    const statusFilter = str(pick(query, "status")).trim();
    // Narrow to a single queue status when asked; a status outside the queue has
    // no acceptance-center rows (honest empty), never a bare all-tenant scan.
    const statuses = statusFilter
      ? ACCEPT_QUEUE_STATUSES.filter((s) => s === statusFilter)
      : [...ACCEPT_QUEUE_STATUSES];
    if (statuses.length === 0) {
      return reply.code(200).send(listEnvelope([]));
    }
    const rows = await db.selectThrough(
      workPeriods,
      PERIOD_HOPS,
      inArray(workPeriods.status, statuses),
    );
    return reply.code(200).send(listEnvelope(rows.map(periodWire)));
  });
}
