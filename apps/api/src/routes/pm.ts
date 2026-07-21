// PM / CMMS handlers — Phase-4 FLOW-C PM Wave-0 (assets, checklist templates,
// work orders, check-in, checklist fill). Sources: pototype/pm.jsx (Asset
// Registry + PMAssetForm), pototype/pm-checklist.jsx (checklist templates +
// picker), pototype/pm3.jsx (Work Orders list/detail, PMWOForm, check-in +
// checklist fill), packages/db/src/schema/pm.ts (tables + PmChecklistRow),
// data-dictionary "PM (CMMS)".
//
// Contract (openapi.yaml /pm …, FROZEN — bodies are the opaque Entity):
//   listPmAssets (GET /pm/assets)                       → EntityList
//   createPmAsset (POST /pm/assets)                      → 201 EntityCreated
//   listPmChecklistTemplates (GET /pm/checklist-templates)  → EntityList
//   createPmChecklistTemplate (POST /pm/checklist-templates) → 201 EntityCreated
//   listPmWorkorders (GET /pm/workorders)                → EntityList
//   createPmWorkorder (POST /pm/workorders)              → 201 EntityCreated
//   checkinPmWorkorder (POST /pm/workorders/{id}/checkin {gps})    → ActionOk
//   updatePmWorkorderChecklist (PUT /pm/workorders/{id}/checklist) → EntityOk
// Wave-2 (B-108, this file) now registers the remaining PM ops:
//   listPmContracts  (GET  /pm/contracts)                → EntityList
//   createPmContract (POST /pm/contracts)                → 201 EntityCreated
//                     mode=per_visit AUTOGENS work orders (B-108a); mode=MA does not
//   listPmQuotes     (GET  /pm/quotes)                   → EntityList (B-108c gap)
//   createPmQuote    (POST /pm/quotes)                   → 201 EntityCreated
//   decidePmQuote    (POST /pm/quotes/{id}/decide)       → ActionOk (+ LINE stub)
//   closePmWorkorder (POST /pm/workorders/{id}/close)    → ActionOk (+ LINE stub)
//
// C10 (PLAN.md §0 rule 4): the wire carries REAL DB columns only. PMAsset now
// carries {name,code,kind,site,cycle,next_due} — the mock's asset name/code got
// real columns in migration 0034 (B-110), so they now ride the wire (Wave-0
// dropped them honestly while they had no backing column). The mock's last-PM/
// status are still NOT columns and are not fabricated. ChecklistTemplate now
// carries {name,kind,items[]} — its `name` also gained a column in 0034 (B-110).
// PMWorkOrder models {asset_id,template_id,tech,checkin_gps,items,cause,fix,advice,
// customer_sign} — the mock's type/site/zone/date/sla are derived/presentational
// and not stored; closing a WO writes the real close columns (cause/fix/advice/
// customer_sign) and there is NO cert/status column, so closePmWorkorder never
// invents one (B-108b). PMContract carries money (value) → currency_code rides its
// wire; PMQuote's parts carry money → currency_code rides the quote wire.
//
// Tenant scope (CRITICAL): three of the four tables have NO company_id column and
// are PARENT-FK-scoped through project_id → project.company_id (like boq_doc):
//   pm_contract → project                (1 hop)
//   pm_asset    → pm_contract → project  (2 hops)
//   pm_workorder→ pm_asset → pm_contract → project (3 hops)
// so their reads go through TenantDb.selectThrough() and their writes through
// insertThrough()/updateThroughChain(), each anchored on (and re-verifying) the
// company_id-scoped project root — a foreign id resolves to nothing (→ 404) and
// can never be written. checklist_template is the one company-scoped MASTER (it
// carries company_id directly), so it uses the plain select()/insert() doors like
// cost_center's sibling masters. Without a resolved tenant, request.db is absent →
// 401 (same posture as GET /projects & /cost-centers).
//
// AuditLog: every successful mutation is logged by the onResponse middleware
// (plugins/audit-log.ts) — never hand-written here. A failed guard (401/400/404)
// returns >= 400, so the hook does not log it (no false trail).
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  checklistTemplates,
  pmAssets,
  pmContracts,
  pmQuotes,
  pmWorkOrders,
  projects,
} from "@juneflow/db/schema";
import type { PmChecklistRow, PmQuotePartRow } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type PmAssetRow = typeof pmAssets.$inferSelect;
type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
type PmWorkOrderRow = typeof pmWorkOrders.$inferSelect;
type PmContractRow = typeof pmContracts.$inferSelect;
type PmQuoteRow = typeof pmQuotes.$inferSelect;

/** PmChecklistRow.result enum (schema pm.ts): the three real filled states.
 * The mock's "none" is the not-yet-checked UI state (pm3.jsx RESULT_OPTS) — it is
 * NOT a stored value, so an unchecked row simply omits `result` (honest). */
const CHECKLIST_RESULTS = new Set<PmChecklistRow["result"]>([
  "normal",
  "adjust",
  "repair",
]);

// Scope hop chains anchoring each parent-FK-scoped PM table on the company_id-
// scoped project root (the final hop's parent MUST be a tenant table — project).
const CONTRACT_HOPS = [{ fk: pmContracts.projectId, parent: projects }];
const ASSET_HOPS = [
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
];
const WO_HOPS = [
  { fk: pmWorkOrders.assetId, parent: pmAssets },
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
];
// pm_quote carries neither a company_id nor a project_id — it scopes 4 hops
// (quote → work order → asset → contract → project root), the deepest PM chain.
const QUOTE_HOPS = [
  { fk: pmQuotes.workOrderId, parent: pmWorkOrders },
  { fk: pmWorkOrders.assetId, parent: pmAssets },
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
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

/**
 * Normalize opaque checklist template items into stored PmChecklistRow[] — the
 * data-dictionary models template items as check LABELS (pm-checklist.jsx items
 * are plain strings). Accepts either bare label strings or {label} objects;
 * empty/blank labels are dropped. Templates store only labels (no result/photos
 * — those are filled per work order, not on the reusable template).
 */
function normalizeTemplateItems(raw: unknown): PmChecklistRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PmChecklistRow[] = [];
  for (const entry of raw) {
    const label =
      typeof entry === "string"
        ? entry.trim()
        : entry && typeof entry === "object"
          ? str((entry as Record<string, unknown>).label).trim()
          : "";
    if (label) out.push({ label });
  }
  return out;
}

/**
 * Normalize the opaque contract `mode` onto the pm_contract_mode DB enum
 * ("MA" | "per_visit"). The DB is the source of truth for stored values
 * (schema pm.ts pmContractMode + data-dictionary "mode: MA เงื่อนไข | per-visit
 * หารครั้งลงปฏิทิน"), while the OpenAPI request declares a looser [ma, visits]
 * alias — so both spellings map to the same stored enum (mock svcType
 * "ma"→MA on-call, "scheduled"/per-visit→per_visit calendar spread; pm2.jsx
 * SVC). An unrecognized value returns null (→ 400, never a bad enum write).
 */
function normalizeMode(raw: unknown): "MA" | "per_visit" | null {
  const v = str(raw).trim().toLowerCase();
  if (v === "ma") return "MA";
  if (v === "per_visit" || v === "per-visit" || v === "pervisit" || v === "visits") {
    return "per_visit";
  }
  return null;
}

/** Coerce an opaque integer-ish value to a whole number, else null (nullable col). */
function intOrNull(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/** Coerce an opaque money-ish value to a numeric string, else undefined (use default). */
function numStr(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return String(n);
  }
  return undefined;
}

/**
 * Normalize opaque quote parts into stored PmQuotePartRow[] (erd "parts[]";
 * data-dictionary "ใบเสนอราคาอะไหล่"). Each part is a labeled spare with an
 * optional qty + price (price is money and rides the quote's currency_code, not
 * a per-line one). Blank-label parts are dropped (never a nameless line).
 */
function normalizeQuoteParts(raw: unknown): PmQuotePartRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PmQuotePartRow[] = [];
  for (const entry of raw) {
    const it = (entry ?? {}) as Record<string, unknown>;
    const label = str(pick(it, "label")).trim();
    if (!label) continue;
    const part: PmQuotePartRow = { label };
    const qty = intOrNull(pick(it, "qty"));
    if (qty !== null) part.qty = qty;
    const priceRaw = pick(it, "price");
    if (typeof priceRaw === "number" && Number.isFinite(priceRaw)) {
      part.price = priceRaw;
    } else if (typeof priceRaw === "string" && priceRaw.trim() !== "") {
      const n = Number(priceRaw.trim());
      if (Number.isFinite(n)) part.price = n;
    }
    out.push(part);
  }
  return out;
}

/**
 * LINE notify — OUT OF SCOPE for the backend (B-108b/B-108c). The prototype ends
 * the close + quote-decide flows by pushing to the customer's LINE (pm3.jsx
 * closeWO "ส่งรายงานให้ลูกค้าแล้ว"; data-dictionary "ปิดงาน → ใบรับรอง → LINE" and
 * "ใบเสนอราคาอะไหล่ → ลูกค้าอนุมัติ (LINE)"). There is no LINE integration — nor a
 * certificate-PDF renderer — in this system, so this is a deliberate NO-OP stub
 * that names the intent WITHOUT performing any external side effect (never a
 * fabricated call). When a real LINE channel lands, this is its single seam.
 */
function lineNotifyStub(_event: string, _ref: string): void {
  // no-op: external LINE push / cert-PDF is not implemented (B-108b/B-108c).
}

/**
 * Merge one filled checklist line from the PUT body onto its snapshot row (by
 * position) — the mock fills `result` + before/after photos against the labels
 * captured at create time (pm3.jsx: labels are fixed, the tech cycles result and
 * attaches photos). label comes from the body when the tech added a fresh line,
 * else from the existing snapshot row at the same index. Only real stored values
 * survive: "none"/absent result and blank photos are omitted (never fabricated).
 */
function mergeChecklistRow(
  raw: unknown,
  existing: PmChecklistRow | undefined,
): PmChecklistRow {
  const it = (raw ?? {}) as Record<string, unknown>;
  const label = str(pick(it, "label")).trim() || existing?.label || "";
  const row: PmChecklistRow = { label };
  const result = str(pick(it, "result")).trim() as PmChecklistRow["result"];
  if (CHECKLIST_RESULTS.has(result)) row.result = result;
  const before = str(pick(it, "before")).trim();
  if (before) row.before = before;
  const after = str(pick(it, "after")).trim();
  if (after) row.after = after;
  return row;
}

/** The opaque Entity wire shape for one PM asset (real pm_asset columns only).
 *  name/code gained real columns in migration 0034 (B-110) — the web asset card
 *  reads them, so they now ride the wire (Wave-0 dropped them while column-less). */
function assetWire(a: PmAssetRow): Record<string, unknown> {
  return {
    id: a.id,
    contract_id: a.contractId,
    name: a.name,
    code: a.code,
    kind: a.kind,
    site: a.site,
    cycle: a.cycle,
    next_due: a.nextDue,
  };
}

/** The opaque Entity wire shape for one checklist template (real columns only).
 *  `name` gained a real column in migration 0034 (B-110) — the checklist picker
 *  shows a name, so it now rides the wire. */
function templateWire(t: ChecklistTemplateRow): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    items: t.items,
  };
}

/** The opaque Entity wire shape for one PM contract (real columns; value is money
 *  → currency_code rides the row). */
function contractWire(c: PmContractRow): Record<string, unknown> {
  return {
    id: c.id,
    project_id: c.projectId,
    customer_id: c.customerId,
    mode: c.mode,
    visits_per_year: c.visitsPerYear,
    sla: c.sla,
    value: c.value,
    currency_code: c.currencyCode,
    end: c.end,
  };
}

/** The opaque Entity wire shape for one PM quote (real columns; parts carry money
 *  → currency_code rides the row). */
function quoteWire(q: PmQuoteRow): Record<string, unknown> {
  return {
    id: q.id,
    wo_id: q.workOrderId,
    parts: q.parts,
    decision: q.decision,
    currency_code: q.currencyCode,
  };
}

/** The opaque Entity wire shape for one PM work order (real columns only). */
function workOrderWire(w: PmWorkOrderRow): Record<string, unknown> {
  return {
    id: w.id,
    asset_id: w.assetId,
    template_id: w.templateId,
    tech: w.tech,
    checkin_gps: w.checkinGps,
    items: w.items,
    cause: w.cause,
    fix: w.fix,
    advice: w.advice,
    customer_sign: w.customerSign,
  };
}

/** Register the PM routes on the given (already /api/v1-prefixed) scope. */
export function registerPmRoute(app: FastifyInstance): void {
  // GET /pm/contracts — the tenant's PM contracts (pm2.jsx PMContracts). pm_contract
  // has no company_id → scope it 1 hop to the project root.
  app.get("/pm/contracts", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.selectThrough(pmContracts, CONTRACT_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(contractWire)));
  });

  // POST /pm/contracts — create a PM contract for a tenant-owned project
  // (pm2.jsx PMContractWizard/PMContractForm). Body: project_id (required),
  // customer_id?, mode (MA|per_visit), visits_per_year?, sla?, value?, end?.
  //
  // AUTOGEN (Wei B-108a; pm2.jsx PMContractForm.save L400-411): the "scheduled"
  // service type — DB mode `per_visit` ("รายครั้งตามกำหนด … สร้างงานลงปฏิทิน
  // อัตโนมัติ") — spreads `visits_per_year` service visits across the year and
  // auto-creates ONE work order per visit. The mock generates exactly nVisits
  // calendar jobs for the whole contract (`for i in 0..nVisits`), so we mirror
  // that COUNT: nVisits WO shells, round-robin across the contract's assets
  // (pm_workorder requires a real asset_id — the mock's contract-level plan item
  // does not, so we bind each visit to an asset). Each shell snapshots the
  // checklist template matched by the asset's kind (pm3.jsx picks the checklist by
  // asset kind). Per B-108a there is NO new table/column and NO scheduled-date
  // column, so the visit DATES are not stored — they derive at read time from
  // pm_asset.next_due/cycle exactly as the mock derives them. A freshly created
  // contract has no assets yet (assets are registered afterwards under the
  // contract), so in production autogen honestly creates 0 WOs; the count grows
  // only once assets exist. mode=MA is on-call (SLA) and NEVER autogens.
  //
  // The contract insert + any autogen WOs run in ONE transaction (all-or-nothing):
  // a failed WO insert rolls back the contract, so a per_visit contract never
  // half-exists with a partial schedule.
  app.post("/pm/contracts", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const projectId = str(pick(body, "project_id", "projectId")).trim();
    const mode = normalizeMode(pick(body, "mode"));
    if (!projectId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "project_id is required" });
    }
    if (!mode) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "mode must be MA or per_visit" });
    }

    const customerId = has(body, "customer_id", "customerId")
      ? str(pick(body, "customer_id", "customerId")).trim() || null
      : null;
    const visitsPerYear = has(body, "visits_per_year", "visitsPerYear")
      ? intOrNull(pick(body, "visits_per_year", "visitsPerYear"))
      : null;
    const sla = has(body, "sla") ? str(pick(body, "sla")).trim() || null : null;
    const value = has(body, "value") ? numStr(pick(body, "value")) : undefined;
    const end = has(body, "end") ? str(pick(body, "end")).trim() || null : null;
    const currencyCode = has(body, "currency_code", "currencyCode")
      ? str(pick(body, "currency_code", "currencyCode")).trim() || undefined
      : undefined;

    // Resolve the parent project THROUGH the scoped door (a foreign/absent project
    // resolves to nothing → 404). This DECIDES whether we write, so it stays
    // OUTSIDE the transaction (TenantDb.transaction guidance). insertThrough below
    // re-verifies ownership inside the tx (fail-closed).
    const [project] = await db.select(projects, eq(projects.id, projectId));
    if (!project) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `project ${projectId} not found` });
    }

    const contractRow: typeof pmContracts.$inferInsert = {
      projectId,
      customerId,
      mode,
      visitsPerYear,
      sla,
      end,
      ...(value !== undefined ? { value } : {}),
      ...(currencyCode !== undefined ? { currencyCode } : {}),
    };

    const contract = await db.transaction(async (tx) => {
      const [created] = await tx.insertThrough(pmContracts, projects, projectId, [
        contractRow,
      ]);

      // per_visit → spread visits_per_year WO shells across the contract's assets.
      if (mode === "per_visit" && (visitsPerYear ?? 0) > 0) {
        const assets = await tx.selectThrough(
          pmAssets,
          ASSET_HOPS,
          eq(pmAssets.contractId, created!.id),
        );
        // A brand-new contract has no assets yet → 0 WOs, honestly (see header).
        if (assets.length > 0) {
          // Match a checklist template per asset KIND (pm3.jsx checklist-by-kind).
          const templates = await tx.select(checklistTemplates);
          const byKind = new Map<string, ChecklistTemplateRow>();
          for (const t of templates) if (!byKind.has(t.kind)) byKind.set(t.kind, t);

          const woRows: (typeof pmWorkOrders.$inferInsert)[] = [];
          for (let i = 0; i < (visitsPerYear ?? 0); i++) {
            const asset = assets[i % assets.length]!;
            const template = byKind.get(asset.kind);
            // Snapshot the template's items (copy each row — independent of the
            // reusable template, exactly like createPmWorkorder's snapshot).
            const items = (template?.items ?? []).map((r) => ({ ...r }));
            woRows.push({
              assetId: asset.id,
              templateId: template?.id ?? null,
              items,
            });
          }
          await tx.insertThrough(pmWorkOrders, projects, created!.projectId, woRows);
        }
      }

      return created!;
    });

    return reply.code(201).send(contractWire(contract));
  });

  // GET /pm/assets — the tenant's maintained assets (pm.jsx PMAssets). pm_asset
  // has no company_id → scope it through pm_contract → project.
  app.get("/pm/assets", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    // filter/page accepted per the contract but not interpreted (their semantics
    // are undefined — inventing filter behavior would violate PLAN.md §0 rule 4);
    // the full tenant-scoped list is returned as one page (like cost-centers.ts).
    const rows = await db.selectThrough(pmAssets, ASSET_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(assetWire)));
  });

  // POST /pm/assets — register an asset under a PM contract (pm.jsx PMAssetForm).
  // The body carries contract_id; the asset scope is anchored on the contract's
  // (tenant-owned) project via insertThrough (fail-closed).
  app.post("/pm/assets", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const contractId = str(pick(body, "contract_id", "contractId")).trim();
    const kind = str(pick(body, "kind")).trim();
    // name + code gained real (nullable) columns in migration 0034 (B-110). The
    // asset card reads them, so persist them onto the row (Wave-0 dropped them
    // honestly while they had no backing column). Absent/blank → null.
    const name = str(pick(body, "name")).trim() || null;
    const code = str(pick(body, "code")).trim() || null;
    const site = has(body, "site") ? str(pick(body, "site")).trim() || null : null;
    const cycle = has(body, "cycle") ? str(pick(body, "cycle")).trim() || null : null;
    const nextDue = has(body, "next_due", "nextDue")
      ? str(pick(body, "next_due", "nextDue")).trim() || null
      : null;

    if (!contractId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "contract_id is required" });
    }
    if (!kind) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "kind is required" });
    }

    // Resolve the parent contract THROUGH its project root (scoped read) — a
    // foreign/absent contract id resolves to nothing → 404, so nothing leaks and
    // the asset can never be anchored under another tenant's contract.
    const [contract] = await db.selectThrough(
      pmContracts,
      CONTRACT_HOPS,
      eq(pmContracts.id, contractId),
    );
    if (!contract) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM contract ${contractId} not found` });
    }

    // insertThrough re-verifies tenant ownership of the anchoring project before
    // writing (fail-closed) — the asset can never land under a foreign project.
    const [created] = await db.insertThrough(pmAssets, projects, contract.projectId, [
      { contractId, kind, name, code, site, cycle, nextDue },
    ]);
    return reply.code(201).send(assetWire(created!));
  });

  // GET /pm/checklist-templates — the tenant's checklist templates
  // (pm-checklist.jsx ChecklistManager). checklist_template carries company_id
  // directly → the plain company-scoped select door.
  app.get("/pm/checklist-templates", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.select(checklistTemplates);
    return reply.code(200).send(listEnvelope(rows.map(templateWire)));
  });

  // POST /pm/checklist-templates — create a reusable checklist set
  // (pm-checklist.jsx ChecklistEditor). company-scoped write (insert force-sets
  // company_id). kind defaults to "ทั่วไป" exactly like the mock's
  // `kind.trim() || "ทั่วไป"`; at least one non-blank item is required (the mock
  // rejects an empty set). The mock's template `name` has no backing column
  // (data-dictionary ChecklistTemplate = kind + items[] only) — dropped, not
  // invented (flagged schema gap for a later wave).
  app.post("/pm/checklist-templates", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const kind = str(pick(body, "kind")).trim() || "ทั่วไป";
    const items = normalizeTemplateItems(pick(body, "items"));
    if (items.length === 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "at least one checklist item is required" });
    }

    const [created] = await db
      .insert(checklistTemplates, { kind, items })
      .returning();
    return reply.code(201).send(templateWire(created!));
  });

  // GET /pm/workorders — the tenant's work orders (pm3.jsx PMWorkOrders).
  // pm_workorder has no company_id → scope it 3 hops to the project root.
  app.get("/pm/workorders", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.selectThrough(pmWorkOrders, WO_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(workOrderWire)));
  });

  // POST /pm/workorders — open a work order on an asset (pm3.jsx PMWOForm). The
  // body carries asset_id (required) + an optional template_id + tech. The WO's
  // checklist items are a REAL SNAPSHOT of the chosen template's items at create
  // time: the labels are copied into the WO's own items column, so later
  // checklist edits (PUT) never mutate the reusable template. With no template_id,
  // items = [] (honest — the mock starts an `open` WO with an empty checklist and
  // the tech picks a set afterwards).
  app.post("/pm/workorders", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const assetId = str(pick(body, "asset_id", "assetId")).trim();
    const templateId = str(pick(body, "template_id", "templateId")).trim();
    const tech = has(body, "tech") ? str(pick(body, "tech")).trim() || null : null;

    if (!assetId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "asset_id is required" });
    }

    // Resolve the asset THROUGH its hop chain to the project root (scoped read) —
    // a foreign/absent asset id resolves to nothing → 404.
    const [asset] = await db.selectThrough(
      pmAssets,
      ASSET_HOPS,
      eq(pmAssets.id, assetId),
    );
    if (!asset) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM asset ${assetId} not found` });
    }
    // The asset's owning contract carries the anchoring project (scoped read).
    const [contract] = await db.selectThrough(
      pmContracts,
      CONTRACT_HOPS,
      eq(pmContracts.id, asset.contractId),
    );
    if (!contract) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `PM contract ${asset.contractId} not found`,
      });
    }

    // Snapshot the chosen template's items (company-scoped read — a foreign/absent
    // template id resolves to nothing → 404). Copy each row so the WO's checklist
    // is independent of the template row (a true snapshot). No template → items [].
    let items: PmChecklistRow[] = [];
    if (templateId) {
      const [template] = await db.select(
        checklistTemplates,
        eq(checklistTemplates.id, templateId),
      );
      if (!template) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: `checklist template ${templateId} not found`,
        });
      }
      items = (template.items ?? []).map((row) => ({ ...row }));
    }

    // insertThrough re-verifies tenant ownership of the anchoring project before
    // writing (fail-closed). template_id is stored so the WO records which set it
    // was seeded from; items is the snapshot (independent of that template).
    const [created] = await db.insertThrough(
      pmWorkOrders,
      projects,
      contract.projectId,
      [{ assetId, templateId: templateId || null, tech, items }],
    );
    return reply.code(201).send(workOrderWire(created!));
  });

  // POST /pm/workorders/:id/checkin — the tech checks in on site with a GPS fix
  // (pm3.jsx "Check-in หน้างาน"). Resolves the WO through its full 3-hop chain
  // (404 for a foreign id), then records checkin_gps. Returns the updated WO.
  app.post("/pm/workorders/:id/checkin", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const gps = str(pick(body, "gps")).trim();
    if (!gps) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "gps is required" });
    }

    // updateThroughChain resolves the WO's ownership THROUGH the hop chain
    // (company_id anchored on the project root) and updates strictly the resolved
    // id — a foreign id resolves to nothing and returns [] → 404 (never written).
    const [updated] = await db.updateThroughChain(
      pmWorkOrders,
      WO_HOPS,
      { checkinGps: gps },
      eq(pmWorkOrders.id, id),
    );
    if (!updated) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${id} not found` });
    }
    return reply.code(200).send(workOrderWire(updated));
  });

  // PUT /pm/workorders/:id/checklist — fill in the checklist results + photos
  // (pm3.jsx checklist: cycle result normal/adjust/repair, attach before/after).
  // The body's items[] are merged POSITIONALLY onto the WO's snapshot rows so the
  // labels captured at create time are preserved (the tech fills, does not
  // rename). Resolves the WO through its full 3-hop chain first (404 for a foreign
  // id). Returns the updated WO.
  app.put("/pm/workorders/:id/checklist", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawItems = pick(body, "items");
    if (!Array.isArray(rawItems)) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "items[] is required" });
    }

    // Resolve the WO through its hop chain (404 for a foreign id) so the snapshot
    // labels are available for the positional merge.
    const [wo] = await db.selectThrough(
      pmWorkOrders,
      WO_HOPS,
      eq(pmWorkOrders.id, id),
    );
    if (!wo) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${id} not found` });
    }

    const existing = wo.items ?? [];
    const items = rawItems.map((raw, i) => mergeChecklistRow(raw, existing[i]));

    const [updated] = await db.updateThroughChain(
      pmWorkOrders,
      WO_HOPS,
      { items },
      eq(pmWorkOrders.id, id),
    );
    // updated is present: the same scoped `where` just resolved `wo` above.
    return reply.code(200).send(workOrderWire(updated!));
  });

  // POST /pm/workorders/:id/close — close a work order (pm3.jsx closeWO: capture
  // cause/fix/advice + the customer's signature, then "ปิดงาน … ส่งรายงานให้ลูกค้า
  // แล้ว"). Resolves the WO through its 3-hop chain (404 for a foreign id), writes
  // the REAL close columns present in the body (cause/fix/advice + signature →
  // customer_sign), and fires the LINE cert notify STUB (B-108b: external LINE +
  // cert-PDF are out of scope — there is NO cert/status column, so close never
  // invents one). With no close fields the WO still resolves and the notify stub
  // fires (a pure close). Returns the (updated) WO as ActionOk.
  app.post("/pm/workorders/:id/close", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    // Resolve the WO through its hop chain first (404 for a foreign id) so a pure
    // notify-only close (no body fields) still fails closed for a foreign WO.
    const [wo] = await db.selectThrough(
      pmWorkOrders,
      WO_HOPS,
      eq(pmWorkOrders.id, id),
    );
    if (!wo) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${id} not found` });
    }

    // Only the REAL existing close columns — never a fabricated status/cert column.
    const set: Partial<typeof pmWorkOrders.$inferInsert> = {};
    if (has(body, "cause")) set.cause = str(pick(body, "cause")).trim() || null;
    if (has(body, "fix")) set.fix = str(pick(body, "fix")).trim() || null;
    if (has(body, "advice")) set.advice = str(pick(body, "advice")).trim() || null;
    if (has(body, "signature", "customer_sign", "customerSign")) {
      set.customerSign =
        str(pick(body, "signature", "customer_sign", "customerSign")).trim() || null;
    }

    let closed = wo;
    if (Object.keys(set).length > 0) {
      const [updated] = await db.updateThroughChain(
        pmWorkOrders,
        WO_HOPS,
        set,
        eq(pmWorkOrders.id, id),
      );
      // updated is present: the same scoped `where` just resolved `wo` above.
      closed = updated!;
    }

    // B-108b: push a completion certificate to the customer's LINE — a NO-OP stub.
    lineNotifyStub("pm.workorder.close", id);

    return reply.code(200).send(workOrderWire(closed));
  });

  // GET /pm/quotes — the tenant's spare-parts quotes (B-108c). pm_quote carries
  // no company_id → scope it 4 hops (quote → wo → asset → contract → project).
  app.get("/pm/quotes", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.selectThrough(pmQuotes, QUOTE_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(quoteWire)));
  });

  // POST /pm/quotes — raise a spare-parts quote off a work order (erd pmq; data-
  // dictionary "ใบเสนอราคาอะไหล่"). Body: wo_id (required), parts[{label,qty,price}],
  // currency_code?. Resolves the WO through its hop chain (404 for a foreign id),
  // then anchors the quote's insert on the WO's project root (fail-closed).
  app.post("/pm/quotes", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const woId = str(pick(body, "wo_id", "woId", "work_order_id")).trim();
    if (!woId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "wo_id is required" });
    }
    const parts = normalizeQuoteParts(pick(body, "parts"));
    const currencyCode = has(body, "currency_code", "currencyCode")
      ? str(pick(body, "currency_code", "currencyCode")).trim() || undefined
      : undefined;

    // Resolve the WO THROUGH its hop chain (404 for a foreign id).
    const [wo] = await db.selectThrough(
      pmWorkOrders,
      WO_HOPS,
      eq(pmWorkOrders.id, woId),
    );
    if (!wo) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${woId} not found` });
    }
    // Walk the WO → asset → contract to reach the project root the quote anchors on
    // (each read is scoped; a foreign hop resolves to nothing → 404).
    const [asset] = await db.selectThrough(
      pmAssets,
      ASSET_HOPS,
      eq(pmAssets.id, wo.assetId),
    );
    if (!asset) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM asset ${wo.assetId} not found` });
    }
    const [contract] = await db.selectThrough(
      pmContracts,
      CONTRACT_HOPS,
      eq(pmContracts.id, asset.contractId),
    );
    if (!contract) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `PM contract ${asset.contractId} not found`,
      });
    }

    // insertThrough re-verifies tenant ownership of the anchoring project before
    // writing (fail-closed) — the quote can never land under a foreign project.
    const [created] = await db.insertThrough(pmQuotes, projects, contract.projectId, [
      {
        workOrderId: woId,
        parts,
        ...(currencyCode !== undefined ? { currencyCode } : {}),
      },
    ]);
    return reply.code(201).send(quoteWire(created!));
  });

  // POST /pm/quotes/:id/decide — record the customer's decision on a quote (erd
  // pmq.decision; data-dictionary "ลูกค้าอนุมัติ (LINE)"). Body: decision (free
  // text) or approve (boolean → approve/reject). Resolves the quote through its
  // 4-hop chain (404 for a foreign id), records the decision, and fires the LINE
  // notify STUB (B-108c: the customer is notified over LINE — a NO-OP here).
  // Returns the updated quote as ActionOk.
  app.post("/pm/quotes/:id/decide", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    // Accept an explicit free-text decision, or the contract's boolean `approve`.
    let decision: string;
    const rawDecision = pick(body, "decision");
    if (typeof rawDecision === "string" && rawDecision.trim()) {
      decision = rawDecision.trim();
    } else if (has(body, "approve")) {
      decision = pick(body, "approve") ? "approve" : "reject";
    } else {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "decision (or approve) is required" });
    }

    // updateThroughChain resolves the quote's ownership THROUGH the 4-hop chain
    // (company_id anchored on the project root) and updates strictly the resolved
    // id — a foreign id resolves to nothing → 404 (never written).
    const [updated] = await db.updateThroughChain(
      pmQuotes,
      QUOTE_HOPS,
      { decision },
      eq(pmQuotes.id, id),
    );
    if (!updated) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM quote ${id} not found` });
    }

    // B-108c: notify the customer of the decision over LINE — a NO-OP stub.
    lineNotifyStub("pm.quote.decide", id);

    return reply.code(200).send(quoteWire(updated));
  });
}
