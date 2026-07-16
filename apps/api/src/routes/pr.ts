// PR (purchase requisition) handlers — list/create/detail, and the submit→
// approve→reject state machine with TIERED approval authority (P2-BE-04, B-070;
// pototype/pr-list.jsx PRList + pr-form.jsx PRForm, docs/handoff/flows.html
// FLOW-A + MATRIX row "PR ใบขอซื้อ", data-dictionary "PR -> N รายการ (จาก BOQ)").
//
// Contract (openapi.yaml /pr …): listPr → EntityList; createPr → 201
// EntityCreated; submitPr/approvePr (POST /pr/{id}/{submit|approve}) → ActionOk;
// rejectPr (POST /pr/{id}/reject {reason}) → ActionOk. Every body is the opaque
// Entity (additionalProperties) — wire fields below are REAL DB columns + the
// derived `amount` (Σ qty×price over real pr_item lines, priced from the BOQ
// item each line references — C10, from a real query, never the mock's
// hardcoded 842,500 etc; no invented columns — PLAN.md §0 rule 4).
//
// GAPs flagged to Wei (do NOT change the contract/schema from this task):
//   1) GET /pr/{id} (single-doc detail with its lines) is implemented because
//      the form needs it (pr-form.jsx items table + totals), but the contract
//      declares no such operation yet — the generated FE client will not include
//      it until the contract adds it (same shape as the earlier BOQ getBoq gap).
//   2) The action endpoints declare only 200/401/404, so the 409 (invalid state
//      transition) and 403 (insufficient approval authority) this handler must
//      return are undocumented statuses — both still use the flat Error envelope.
//   3) pr_type ENUM has 4 values (material|subcon|expense|advance) but the
//      prototype offers 5 (…+ `clear` = เคลียร์เงินทดรอง, settling an advance).
//      `clear` is MAPPED to `advance` on write (closest existing value — both are
//      the advance-money lifecycle; `clear` reconciles an advance). NO enum
//      value / migration is added here — see PR_TYPE_MAP.
//   4) reject {reason} is REQUIRED by the contract and validated here, but pr has
//      no reason/reject_reason column, so the reason is NOT persisted on the row
//      (the AuditLog middleware still records the mutation). Flagged, not worked
//      around with an invented column.
//   5) The B-070 approval thresholds (500,000 / 2,000,000 THB) are the flows.html
//      MATRIX values used as constants below. The seeded role.approvalLimits
//      jsonb does NOT carry a per-doc-type "pr" tier matrix — the seed stores
//      `{ default: <the role's single blanket ceiling> }` (index.ts:819, a mirror
//      of role.approvalLimit), so per-doc PR thresholds cannot be sourced from it
//      cleanly. Per the task ruling, flows.html is authoritative and the seed-
//      shape gap is flagged (NOT a schema change).
//
// Tenant scope: pr / pr_item carry NO company_id of their own — the whole PR tree
// is scoped through project_id on the pr doc (boq.ts schema group header: "Company
// scope flows through project_id on documents"). Reads go through the scoped
// selectThrough() door anchored on the company_id-scoped project root; doc + line
// creation go through insertThrough() (re-verifies project ownership, fail-closed);
// the state machine mutates pr through updateThrough(). A foreign tenant's id
// resolves to nothing (→ 404) and can never be written. Without a resolved tenant,
// request.db is absent → 401.
//
// State machine (flows.html "สถานะ PR/PO/PV: draft → pending → approved | rejected"):
//   draft --submit--> pending --approve--> approved
//                     pending --reject({reason})--> rejected
// Out-of-order transitions → 409 INVALID_STATE (mirrors the boq.ts guards).
//
// Approval authority (flows.html MATRIX row "PR ใบขอซื้อ", B-070 authoritative):
//   หน.จัดซื้อ (Procurement head) approves EVERY PR              → approvalLevel 2
//   ผจก.โครงการ (Project Manager) required WHEN amount > 500,000 → approvalLevel 3
//   MD required WHEN amount > 2,000,000 (THB, strict >)          → approvalLevel 4
// The single durable `approve` here is the terminal approval, so the caller's
// role.approvalLevel must reach the tier the PR's amount demands (the highest
// triggered tier); a lower tier — or an unattributable caller — gets 403.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  boqDocs,
  boqGroups,
  boqItems,
  projects,
  prItems,
  prs,
  vendors,
  users,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { loadRole, loadUserByEmail } from "./profile-data.js";

type PrRow = typeof prs.$inferSelect;
type PrItemRow = typeof prItems.$inferSelect;
type BoqItemRow = typeof boqItems.$inferSelect;

/**
 * The pr_type ENUM (boq.ts): material | subcon | expense | advance. The
 * prototype (pr-list.jsx PR_TYPES / pr-form.jsx TYPE_TABS) offers a 5th input
 * `clear` (เคลียร์เงินทดรอง). It maps to `advance` — the closest existing enum
 * value: `clear` settles/reconciles an earlier advance, so both belong to the
 * advance-money lifecycle. NO enum value is added (GAP 3 above).
 */
const PR_TYPE_MAP: Record<string, "material" | "subcon" | "expense" | "advance"> = {
  material: "material",
  subcon: "subcon",
  expense: "expense",
  advance: "advance",
  clear: "advance",
};

/**
 * B-070 approval tier thresholds (THB, strict >), from flows.html MATRIX row
 * "PR ใบขอซื้อ". A PR's amount escalates which approval tier must sign the
 * terminal approval (see requiredApprovalLevel). Constants, NOT sourced from the
 * seed's role.approvalLimits (GAP 5 above).
 */
const PR_TIER_PM_THRESHOLD = 500_000; // amount > this → ผจก.โครงการ tier
const PR_TIER_MD_THRESHOLD = 2_000_000; // amount > this → MD tier

/** role.approvalLevel tiers (packages/db seed ROLE_DEFS `level`). */
const APPROVAL_LEVEL_PROC = 2; // หน.จัดซื้อ (Procurement Mgr)
const APPROVAL_LEVEL_PM = 3; // ผจก.โครงการ (Project Manager)
const APPROVAL_LEVEL_MD = 4; // MD (Director)

// Scope hop chains anchoring each parent-FK-scoped table on the company_id-
// scoped project root (the final hop's parent MUST be a tenant table — project).
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];
const PR_ITEM_HOPS = [
  { fk: prItems.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
// A PR line is priced from the BOQ item it references; the tenant's BOQ items
// are read through their own project-anchored chain to build the price map.
const BOQ_ITEM_HOPS = [
  { fk: boqItems.groupId, parent: boqGroups },
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Does the opaque body explicitly carry any of these keys? */
function has(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** First present value among the given opaque field aliases. */
function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

/** Parse a non-negative number (number | numeric string) from opaque JSON, else null. */
function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Per-BOQ-item unit price + its currency, keyed by boq_item id. */
interface Priced {
  price: number;
  currency: string;
}

/** Build a boq_item id → {price, currency} map from the tenant's BOQ items. */
function priceMap(items: BoqItemRow[]): Map<string, Priced> {
  return new Map(
    items.map((it) => [
      it.id,
      { price: Number(it.price), currency: it.currencyCode },
    ]),
  );
}

/**
 * A PR's amount = Σ over its lines of qty × the referenced BOQ item's unit price
 * (C10 — from real rows, never a hardcoded doc total). A line with no
 * boq_item_id (an expense/advance line with no BOQ source) has no priceable
 * origin in the schema, so it contributes 0 — pr_item carries no standalone
 * price column (flagged: pure non-BOQ PRs compute to 0 from real data until a
 * price surface exists). Currency = the currency of the first priced line, else
 * THB (every money field carries a currency_code — root CLAUDE.md กฎเหล็ก).
 */
function sumLines(
  lines: PrItemRow[],
  prices: Map<string, Priced>,
): { amount: number; currency: string } {
  let amount = 0;
  let currency = "THB";
  let currencySet = false;
  for (const ln of lines) {
    const priced = ln.boqItemId ? prices.get(ln.boqItemId) : undefined;
    if (!priced) continue;
    amount += Number(ln.qty) * priced.price;
    if (!currencySet) {
      currency = priced.currency;
      currencySet = true;
    }
  }
  return { amount, currency };
}

/**
 * The lowest role.approvalLevel that may give the PR's terminal approval.
 * Exported so the dashboard approvals-inbox (dashboard.ts, P2-BE-07) filters PRs
 * by the SAME tier authority the approve handler enforces — a single source of
 * truth for the PR thresholds, so the inbox and the approve gate can never drift.
 */
export function requiredApprovalLevel(amount: number): number {
  if (amount > PR_TIER_MD_THRESHOLD) return APPROVAL_LEVEL_MD;
  if (amount > PR_TIER_PM_THRESHOLD) return APPROVAL_LEVEL_PM;
  return APPROVAL_LEVEL_PROC;
}

/** How many approval tiers the amount engages (pr.approval_step on approval). */
function requiredTierCount(amount: number): number {
  if (amount > PR_TIER_MD_THRESHOLD) return 3; // หน.จัดซื้อ + ผจก.โครงการ + MD
  if (amount > PR_TIER_PM_THRESHOLD) return 2; // หน.จัดซื้อ + ผจก.โครงการ
  return 1; // หน.จัดซื้อ only
}

/**
 * The opaque Entity wire shape for a PR doc: real pr columns + the derived
 * `amount` (Σ qty×price over its lines) and its currency. The list-row display
 * fields — title / phase / vendor_id / requester_id + the submit/approve
 * timestamps (which the PR KPIs need: approved-this-month, avg-approval-time) —
 * are now REAL columns (migration 0022, B-075) and always returned. When the
 * vendor + requester name maps are resolved (list / detail), the display `vendor`
 * / `requester` names are added too; the state-machine echoes keep the ids and
 * omit the resolved names (the FE re-reads the list after an action).
 */
function prWire(
  pr: PrRow,
  amount: number,
  currency: string,
  names?: { vendor: string | null; requester: string | null },
): Record<string, unknown> {
  return {
    id: pr.id,
    no: pr.no,
    type: pr.type,
    project_id: pr.projectId,
    need_date: pr.needDate,
    status: pr.status,
    approval_step: pr.approvalStep,
    currency_code: currency,
    amount,
    title: pr.title,
    phase: pr.phase,
    vendor_id: pr.vendorId,
    requester_id: pr.requesterId,
    submitted_at: pr.submittedAt,
    approved_at: pr.approvedAt,
    ...(names
      ? { vendor: names.vendor, requester: names.requester }
      : {}),
  };
}

/** The opaque Entity wire shape for one PR line (real pr_item columns + price). */
function prItemWire(it: PrItemRow, price: number): Record<string, unknown> {
  const qty = Number(it.qty);
  return {
    id: it.id,
    pr_id: it.prId,
    boq_item_id: it.boqItemId,
    qty,
    price,
    amount: qty * price,
  };
}

/** Read a PR's lines + the tenant's BOQ prices, and derive its (amount, currency). */
async function prAmount(
  db: TenantDb,
  prId: string,
): Promise<{ amount: number; currency: string; lines: PrItemRow[]; prices: Map<string, Priced> }> {
  const [lines, boqItemRows] = await Promise.all([
    db.selectThrough(prItems, PR_ITEM_HOPS, eq(prs.id, prId)),
    db.selectThrough(boqItems, BOQ_ITEM_HOPS),
  ]);
  const prices = priceMap(boqItemRows);
  const { amount, currency } = sumLines(lines, prices);
  return { amount, currency, lines, prices };
}

/** Re-read a PR's lines to build its wire shape with a fresh derived amount. */
async function prWireWithAmount(
  db: TenantDb,
  pr: PrRow,
): Promise<Record<string, unknown>> {
  const { amount, currency } = await prAmount(db, pr.id);
  return prWire(pr, amount, currency);
}

/**
 * The caller's role.approvalLevel, or null when it cannot be attributed (no
 * session user / no dictionary row / no role). Resolved the same way as GET /me
 * (authUser.email → tenant user row → role), so it is tenant-scoped throughout.
 */
async function callerApprovalLevel(
  request: FastifyRequest,
): Promise<number | null> {
  const db = request.db;
  const authUser = request.authUser;
  if (!db || !authUser) return null;
  const user = await loadUserByEmail(db, authUser.email);
  if (!user) return null;
  const role = await loadRole(db, user.roleId);
  return role?.approvalLevel ?? null;
}

/** Register the PR routes on the given (already /api/v1-prefixed) scope. */
export function registerPrRoute(app: FastifyInstance): void {
  // GET /pr — the tenant's PRs (pr-list.jsx PRList). Each doc's `amount` is the
  // Σ of its lines priced from the BOQ item each references (real query).
  app.get("/pr", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const [docs, lines, boqItemRows, vendorRows, userRows] = await Promise.all([
      db.selectThrough(prs, PR_HOPS),
      db.selectThrough(prItems, PR_ITEM_HOPS),
      db.selectThrough(boqItems, BOQ_ITEM_HOPS),
      // vendor + user carry their own company_id (scoped select) — resolve the
      // display names for the PR list's vendor / requester columns.
      db.select(vendors),
      db.select(users),
    ]);

    const prices = priceMap(boqItemRows);
    const linesByPr = new Map<string, PrItemRow[]>();
    for (const ln of lines) {
      const list = linesByPr.get(ln.prId) ?? [];
      list.push(ln);
      linesByPr.set(ln.prId, list);
    }
    const vendorNameById = new Map(vendorRows.map((v) => [v.id, v.name]));
    const userNameById = new Map(userRows.map((u) => [u.id, u.name]));

    return reply.code(200).send(
      listEnvelope(
        docs.map((d) => {
          const { amount, currency } = sumLines(linesByPr.get(d.id) ?? [], prices);
          return prWire(d, amount, currency, {
            vendor: d.vendorId ? vendorNameById.get(d.vendorId) ?? null : null,
            requester: d.requesterId ? userNameById.get(d.requesterId) ?? null : null,
          });
        }),
      ),
    );
  });

  // POST /pr — create a PR (pr-form.jsx PRForm). Server owns status (always
  // starts `draft`) + approval_step (0). Optional `items[]` (each {boq_item_id?,
  // qty}) are the requested lines — created + priced from BOQ so `amount` is
  // real. The scope is anchored on the tenant-owned project via insertThrough
  // (fail-closed).
  app.post("/pr", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const no = str(pick(body, "no")).trim();
    const rawType = str(pick(body, "type")).trim().toLowerCase();
    const projectId = str(pick(body, "project_id", "projectId")).trim();
    const needDate = has(body, "need_date", "needDate")
      ? str(pick(body, "need_date", "needDate")).trim() || null
      : null;

    if (!no) {
      return reply.code(400).send({ code: "VALIDATION", message: "no is required" });
    }
    const mappedType = PR_TYPE_MAP[rawType];
    if (!mappedType) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "type must be one of material, subcon, expense, advance, clear",
      });
    }
    if (!projectId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "project_id is required" });
    }

    // The target project must belong to this tenant (scoped select — a foreign
    // id resolves to nothing, so nothing about it leaks).
    const [project] = await db.select(projects, eq(projects.id, projectId));
    if (!project) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "project not found" });
    }

    // Duplicate `no` across the tenant's PRs (pr numbers are unique per tenant).
    const existing = await db.selectThrough(prs, PR_HOPS);
    if (existing.some((d) => d.no === no)) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `PR no ${no} already exists`,
      });
    }

    // Optional requested lines. Each references a BOQ item of THIS tenant (or is
    // a non-BOQ line with no boq_item_id); qty must be a non-negative number.
    const rawItems = Array.isArray((body as Record<string, unknown>).items)
      ? ((body as Record<string, unknown>).items as unknown[])
      : [];
    const boqItemRows = rawItems.length
      ? await db.selectThrough(boqItems, BOQ_ITEM_HOPS)
      : [];
    const prices = priceMap(boqItemRows);
    const validBoqItemIds = new Set(boqItemRows.map((it) => it.id));

    const lineDrafts: { boqItemId: string | null; qty: number }[] = [];
    for (const raw of rawItems) {
      const it = (raw ?? {}) as Record<string, unknown>;
      const boqItemId = has(it, "boq_item_id", "boqItemId")
        ? str(pick(it, "boq_item_id", "boqItemId")).trim() || null
        : null;
      const qty = toNum(pick(it, "qty"));
      if (qty == null || qty < 0) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "line qty must be a number >= 0" });
      }
      if (boqItemId && !validBoqItemIds.has(boqItemId)) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "boq_item_id must be a BOQ item of this tenant",
        });
      }
      lineDrafts.push({ boqItemId, qty });
    }

    const [created] = await db.insertThrough(prs, projects, projectId, [
      {
        projectId,
        no,
        type: mappedType,
        needDate,
        status: "draft",
        approvalStep: 0,
      },
    ]);

    let createdLines: PrItemRow[] = [];
    if (lineDrafts.length) {
      createdLines = await db.insertThrough(
        prItems,
        projects,
        projectId,
        lineDrafts.map((l) => ({
          prId: created!.id,
          boqItemId: l.boqItemId,
          qty: String(l.qty),
        })),
      );
    }

    const { amount, currency } = sumLines(createdLines, prices);
    return reply.code(201).send({
      ...prWire(created!, amount, currency),
      items: createdLines.map((ln) =>
        prItemWire(ln, ln.boqItemId ? (prices.get(ln.boqItemId)?.price ?? 0) : 0),
      ),
    });
  });

  // GET /pr/:id — single-doc detail with its priced lines (pr-form.jsx items
  // table + totals). NOT a contract operation yet (see header GAP 1).
  app.get("/pr/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, id));
    if (!pr) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PR ${id} not found` });
    }

    const { amount, currency, lines, prices } = await prAmount(db, id);
    // Resolve the vendor + requester display names (scoped selects) for the detail.
    const [vendor, requester] = await Promise.all([
      pr.vendorId
        ? db.select(vendors, eq(vendors.id, pr.vendorId)).then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
      pr.requesterId
        ? db.select(users, eq(users.id, pr.requesterId)).then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
    ]);
    return reply.code(200).send({
      ...prWire(pr, amount, currency, { vendor, requester }),
      items: lines.map((ln) =>
        prItemWire(ln, ln.boqItemId ? (prices.get(ln.boqItemId)?.price ?? 0) : 0),
      ),
    });
  });

  // POST /pr/:id/submit — draft → pending (requester sends the PR to approval).
  app.post("/pr/:id/submit", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, id));
    if (!pr) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PR ${id} not found` });
    }
    if (pr.status !== "draft") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft PR can be submitted",
      });
    }

    const [updated] = await db.updateThrough(
      prs,
      projects,
      prs.projectId,
      pr.projectId,
      // Stamp submitted_at so the PR KPIs (approved-this-month, avg-approval-time)
      // have a real submit time going forward (migration 0022, B-075).
      { status: "pending", submittedAt: new Date() },
      eq(prs.id, id),
    );
    return reply.code(200).send(await prWireWithAmount(db, updated!));
  });

  // POST /pr/:id/approve — pending → approved (terminal). The caller's
  // role.approvalLevel must reach the tier the PR's amount demands (B-070:
  // หน.จัดซื้อ every PR; ผจก.โครงการ > 500,000; MD > 2,000,000, strict >).
  app.post("/pr/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, id));
    if (!pr) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PR ${id} not found` });
    }

    // The PR's amount fixes which approval tier must sign off. A caller below
    // that tier (or an unattributable caller) cannot approve.
    const { amount, currency } = await prAmount(db, id);
    const needed = requiredApprovalLevel(amount);
    const level = await callerApprovalLevel(request);
    if (level == null || level < needed) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `PR approval of ${amount} requires approval level ${needed}`,
      });
    }
    if (pr.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending PR can be approved",
      });
    }

    const [updated] = await db.updateThrough(
      prs,
      projects,
      prs.projectId,
      pr.projectId,
      // Stamp approved_at so the PR KPIs compute a real approval time going forward.
      {
        status: "approved",
        approvalStep: requiredTierCount(amount),
        approvedAt: new Date(),
      },
      eq(prs.id, id),
    );
    return reply.code(200).send(prWire(updated!, amount, currency));
  });

  // POST /pr/:id/reject — pending → rejected. reason is REQUIRED by the contract
  // (rejectPr {reason}); it is validated here but not persisted (GAP 4 — pr has
  // no reason column; the AuditLog middleware still records the mutation).
  app.post("/pr/:id/reject", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, id));
    if (!pr) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PR ${id} not found` });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = str(pick(body, "reason")).trim();
    if (!reason) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "reason is required" });
    }
    if (pr.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending PR can be rejected",
      });
    }

    const [updated] = await db.updateThrough(
      prs,
      projects,
      prs.projectId,
      pr.projectId,
      { status: "rejected" },
      eq(prs.id, id),
    );
    return reply.code(200).send(await prWireWithAmount(db, updated!));
  });
}
