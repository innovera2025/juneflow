// AI Quantity Take-Off — FAKE STUB (P2-BE-03, B-070 / PLAN.md §12).
//
// HONEST STUB — there is NO real IFC/RVT/DWG/CAD parse and NO quantity engine
// here (PLAN.md §12 defers the element registry + real take-off). Every response
// is marked `stub: true` with a `note` saying so, and the take-off is canned,
// deterministic sample DATA (not extracted from any uploaded model). The upload
// mints a job handle and "completes" immediately; the job status GET returns the
// same canned result; create-BOQ turns the reviewed mappings (or, absent them,
// the canned take-off) into a REAL draft BOQ doc + groups + items.
//
// Contract (openapi.yaml): uploadAiQto (POST /ai-qto/upload, multipart file →
// 202 Job, 402 QuotaExceeded), getAiQtoJob (GET /ai-qto/{job} → 200 Entity),
// createBoqFromAiQto (POST /ai-qto/{job}/create-boq {mappings[]} → 201 Entity).
//
// AI credit: the wizard "deducts AI credit" (ai-qto.jsx consumeAiCredit); the
// contract models 402 on upload. That maps 1:1 to the `ai_per_month` quota
// dimension (plugins/quota.ts QUOTA_KEYS) — wired exactly like files.ts wires
// storage_gb, so an over-quota tenant gets the canonical 402 QUOTA_EXCEEDED.
//
// Tenant scope: create-BOQ writes the doc/groups/items through insertThrough()
// anchored on the tenant-owned project (same door + posture as boq.ts
// POST /boq + POST /boq/:id/items) — a foreign project resolves to nothing (400
// "project not found") and can never be written under. Without a resolved
// tenant, request.db is absent → 401.
//
// Stub take-off item `name`/`group` values are DATA (BOQ line names — free text
// even in production, entered by users), NOT translatable UI copy, so they are
// not i18n keys (that rule governs web chrome, not API payload data).
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { boqDocs, boqGroups, boqItems, projects } from "@juneflow/db/schema";
import { QuotaGuard, sendQuotaExceeded } from "../plugins/quota.js";
import { stampEntryOrder } from "./list-order.js";

// boq_doc is scoped through its project (boq.ts DOC_HOPS).
const DOC_HOPS = [{ fk: boqDocs.projectId, parent: projects }];

/** The stub take-off handle prefix — GET /ai-qto/{job} only recognizes these. */
const STUB_JOB_PREFIX = "aiqto-stub-";

/** Human-readable disclaimer stamped on every AI-QTO response. */
const STUB_NOTE =
  "AI-QTO is a STUB (B-070 / PLAN.md §12): no real IFC/CAD parse or quantity " +
  "engine. This take-off is canned, deterministic sample data — NOT extracted " +
  "from any uploaded model.";

/**
 * Canned take-off result (a plausible-but-fake structure). `cat` is already the
 * boq_item_cat enum (M material · L labor · S lump-sum) so create-BOQ can turn a
 * mapping straight into a real boq_item. These are stub DATA values, not UI copy.
 */
const STUB_TAKEOFF = {
  stub: true as const,
  note: STUB_NOTE,
  lod: "LOD 300",
  elements: [
    { kind: "Wall", count: 86, confidence: 96 },
    { kind: "Column", count: 48, confidence: 98 },
    { kind: "Beam", count: 124, confidence: 94 },
    { kind: "Slab", count: 32, confidence: 97 },
    { kind: "Opening", count: 156, confidence: 88 },
    { kind: "MEP", count: 64, confidence: 72 },
  ],
  items: [
    { group: "02 งานโครงสร้าง", code: "02-C01", name: "คอนกรีตเสา ค.ส.ล. f'c 240", unit: "ลบ.ม.", qty: 86, price: 2850, cat: "M", confidence: 98 },
    { group: "02 งานโครงสร้าง", code: "02-B01", name: "คอนกรีตคาน ค.ส.ล. f'c 240", unit: "ลบ.ม.", qty: 64, price: 2850, cat: "M", confidence: 94 },
    { group: "02 งานโครงสร้าง", code: "02-S01", name: "คอนกรีตพื้น ค.ส.ล. หนา 0.12", unit: "ลบ.ม.", qty: 320, price: 2780, cat: "M", confidence: 97 },
    { group: "03-04 งานสถาปัตยกรรม", code: "03-W01", name: "งานก่ออิฐมอญ ครึ่งแผ่น", unit: "ตร.ม.", qty: 1240, price: 285, cat: "S", confidence: 96 },
    { group: "05 งานระบบ", code: "05-E01", name: "งานเดินท่อ-ร้อยสายไฟ (rough-in)", unit: "จุด", qty: 420, price: 320, cat: "L", confidence: 74 },
  ],
};

/**
 * BOQItem.cat mapping for a mapping row's `cat`: accepts the enum codes (M/L/S),
 * the prototype's Thai labels (วัสดุ/ค่าแรง/เหมา), and the English words. Unknown
 * → M (a stub default, never a hard failure).
 */
const CAT_MAP: Record<string, "M" | "L" | "S"> = {
  M: "M", L: "L", S: "S",
  วัสดุ: "M", ค่าแรง: "L", เหมา: "S",
  material: "M", labor: "L", subcon: "S",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Parse a non-negative number (number | numeric string) from opaque JSON, else null. */
function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A valid uuid → itself, else null (the mock's textual eid is NOT a uuid). */
function uuidOrNull(value: unknown): string | null {
  const s = str(value).trim();
  return UUID_RE.test(s) ? s : null;
}

/**
 * Next running AI-sourced BOQ no for the tenant (BOQ-{year}-AI-{n}), derived
 * from existing BOQ nos — never hardcoded (mirrors boq generate-PR numbering).
 */
function nextAiBoqNo(existingNos: string[], year: number): string {
  const re = new RegExp(`^BOQ-${year}-AI-(\\d+)$`);
  let max = 0;
  for (const no of existingNos) {
    const m = re.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BOQ-${year}-AI-${String(max + 1).padStart(4, "0")}`;
}

export interface AiQtoRouteOptions {
  quota: QuotaGuard;
}

/** Register the AI-QTO stub routes on the given (already /api/v1-prefixed) scope. */
export function registerAiQtoRoute(
  app: FastifyInstance,
  options: AiQtoRouteOptions,
): void {
  // POST /ai-qto/upload — mint a stub job handle (deducts an AI credit). No real
  // parse: the job is "done" immediately with the canned take-off available via
  // GET below. The `ai_per_month` quota gates it → 402 QUOTA_EXCEEDED when over.
  app.post("/ai-qto/upload", async (request, reply) => {
    const companyId = request.tenant?.companyId;
    if (!companyId) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // "deducts AI credit" → the ai_per_month quota gates the upload (contract 402).
    const status = await options.quota.check(companyId, "ai_per_month");
    if (!status.ok) {
      return sendQuotaExceeded(reply, "ai_per_month", options.quota.upgradeUrl);
    }

    const jobId = `${STUB_JOB_PREFIX}${randomUUID()}`;
    return reply.code(202).send({
      job_id: jobId,
      id: jobId,
      status: "done", // stub: no async work — completes immediately
      stub: true,
      note: STUB_NOTE,
    });
  });

  // GET /ai-qto/{job} — the stub job's status + canned take-off result. Stateless:
  // there is no job table (B-070 / §12), so any handle minted by upload resolves
  // to the SAME canned, done take-off; an unrecognized handle → 404.
  app.get("/ai-qto/:job", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { job } = request.params as { job: string };
    if (!job.startsWith(STUB_JOB_PREFIX)) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `AI-QTO job ${job} not found` });
    }

    return reply.code(200).send({
      job_id: job,
      id: job,
      status: "done",
      ...STUB_TAKEOFF,
    });
  });

  // POST /ai-qto/{job}/create-boq — turn the reviewed mappings (or, absent them,
  // the canned take-off) into a REAL draft BOQ doc + groups + items. project_id
  // comes from the body (the wizard's active project). Element traceability
  // (element_id) is set only when a mapping carries a real uuid — the mock's
  // textual eid ("IFC#W-1001..") is NOT one, and the element registry is deferred
  // (§12), so those land null (flagged, never invented).
  app.post("/ai-qto/:job/create-boq", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const projectId = str(pick(body, "project_id", "projectId")).trim();
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

    // Reviewed mappings from the wizard, else fall back to the canned take-off so
    // the stub still produces a doc without an explicit mapping payload.
    const rawMappings =
      Array.isArray(body.mappings) && body.mappings.length > 0
        ? (body.mappings as unknown[])
        : STUB_TAKEOFF.items;
    const mappings = rawMappings.map((m) => (m ?? {}) as Record<string, unknown>);

    // Create the draft doc (server owns status=draft + version=1), no derived
    // from the tenant's existing BOQ nos (never hardcoded).
    const existingNos = (await db.selectThrough(boqDocs, DOC_HOPS)).map(
      (d) => d.no,
    );
    const year = new Date().getUTCFullYear();
    const no = str(pick(body, "no")).trim() || nextAiBoqNo(existingNos, year);
    const name = str(pick(body, "name")).trim() || "AI Take-off";
    const [doc] = await db.insertThrough(boqDocs, projects, projectId, [
      {
        projectId,
        no,
        name,
        scope: `AI Take-off · ${mappings.length} รายการ`,
        version: 1,
        status: "draft",
      },
    ]);

    // One group per distinct `group` label across the mappings.
    const groupNames = [
      ...new Set(
        mappings.map((m) => str(pick(m, "group")).trim() || "AI Take-off"),
      ),
    ];
    const createdGroups = await db.insertThrough(
      boqGroups,
      projects,
      projectId,
      groupNames.map((gname, i) => ({ boqId: doc!.id, name: gname, seq: i + 1 })),
    );
    const groupIdByName = new Map(createdGroups.map((g) => [g.name, g.id]));

    // Turn each mapping into a real boq_item (fresh line → remain = qty).
    const itemRows = mappings.map((m) => {
      const gname = str(pick(m, "group")).trim() || "AI Take-off";
      const qty = toNum(pick(m, "qty")) ?? 0;
      const price = toNum(pick(m, "price")) ?? 0;
      const cat = CAT_MAP[str(pick(m, "cat")).trim()] ?? "M";
      return {
        groupId: groupIdByName.get(gname)!,
        code: str(pick(m, "code")).trim() || "AI",
        name: str(pick(m, "name")).trim() || "AI item",
        cat,
        qty: String(qty),
        unit: str(pick(m, "unit")).trim() || null,
        price: price.toFixed(2),
        currencyCode: str(pick(m, "currency_code", "currencyCode")).trim() || "THB",
        remainQty: String(qty),
        elementId: uuidOrNull(pick(m, "element_id", "elementId")),
      };
    });
    // B-323: the SECOND writer of boq_item, and it has the same obligation as the
    // first (boq.ts POST /boq/:id/items) — GET /boq/:id/items reads these lines with
    // entryOrder (created_at ASC) and boq_item has no `seq`. One insertThrough is one
    // statement and one now(), so without the stamp every take-off line ties and the
    // AI's mapping order is replaced by `defaultRandom()` uuid order on the wire.
    const createdItems = await db.insertThrough(
      boqItems,
      projects,
      projectId,
      stampEntryOrder(itemRows),
    );

    // total = Σ qty×price over the created items (C10 — derived, not hardcoded).
    const total = itemRows.reduce(
      (s, r) => s + Number(r.qty) * Number(r.price),
      0,
    );

    return reply.code(201).send({
      id: doc!.id,
      no: doc!.no,
      name: doc!.name,
      scope: doc!.scope,
      project_id: doc!.projectId,
      version: doc!.version,
      status: doc!.status,
      currency_code: itemRows[0]?.currencyCode ?? "THB",
      total,
      groups: createdGroups.length,
      items: createdItems.length,
      stub: true,
      note: STUB_NOTE,
    });
  });
}
