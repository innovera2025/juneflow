// GET + POST /vendors + GET + PUT /vendors/{id} — the tenant's supplier / subcon
// master (P2-BE-01, B-070; master-party.jsx PartyVendors/VendorAddForm L55-183,
// data-dictionary "master แยกชัด: vendor(ผู้ขาย|ผู้รับเหมา flag)").
//
// Contract (openapi.yaml /vendors, /vendors/{id}): GET → the B-014 list envelope
// {data, page, page_size, total} of opaque Entity rows (kind filter, below);
// POST → 201 EntityCreated; GET /{id} → 200 EntityOk / 404; PUT /{id} → 200
// EntityOk / 404. Every body is the opaque Entity — the web maps its screen
// fields to these columns. No DELETE (the contract exposes none). Field
// semantics follow the DB schema `vendor` (project.ts). /vendors is Entity-opaque
// so the B-071 (P2-BE-08) superset columns need NO contract change. The wire row is
//   {id, name, code, tax_id, kind, credit_term, addr, bank, status}
// where
//   code        = the "V-00xx" display code (B-071 column). Nullable free text —
//                 the mock generates it (VendorForm:138) with no format rule.
//   kind        = supplier | subcon (vendor_kind enum). The DB is 2-way; the
//                 mock's 4-way type badge (วัสดุ / บริการ / ที่ดิน → supplier,
//                 รับเหมา → subcon, B-070) is a WEB display concern only — this
//                 handler neither stores nor derives it. On POST/PUT the web has
//                 already mapped its 4-way type to `kind` before calling, so the
//                 handler simply persists the `kind` it receives.
//   credit_term = payment credit term in DAYS (erd.html Vendor.credit_term),
//                 nullable. The mock's Thai term labels ("30 วัน" / "เงินสด" /
//                 "ตามงวดงาน") are mapped to an integer (or omitted) by the web;
//                 a non-numeric value the backend cannot honestly interpret is
//                 stored as null (never invented — PLAN.md §0 rule 4).
//   tax_id      = tax id, nullable free text (no format rule: the mock party
//                 form does not validate it, unlike org_unit / B-052).
//   addr / bank = registered-address + bank-account display strings (B-071
//                 columns), nullable free text (VendorForm:172/174, no format rule).
//   status      = active | inactive (B-071 column, VendorForm:175). Plain-text
//                 column; the closed set is enforced by this handler (POST/PUT
//                 400 an out-of-set value). A new vendor defaults to active.
//
// Deliberately NOT on the wire (the DB is a real subset of the mock, not a bug):
//   - spend : the mock's per-vendor purchase total has NO source yet — AP/PO
//             aggregation is out of this task's scope — so it is OMITTED rather
//             than fabricated (a made-up 0 would still be a value the API did not
//             compute). Flagged to WEB/QA: the party KPI "ยอดซื้อรวม" has no
//             backing until AP lands.
//   - type  : the mock's 4-way type badge is display-derived from `kind` on the
//             web (B-070) — never a stored column, so never on the wire.
//
// `vendor` carries its OWN company_id column (project.ts, index vendor_company_idx),
// so it is read/written through the scoped TenantDb.select()/insert()/update()
// door (auto-injects / force-sets WHERE|SET company_id = <this tenant>) — a bare
// read is impossible and a foreign tenant's id never matches (→ 404), exactly
// like GET /models and /org-units. Every successful POST/PUT is audited by the
// global audit-log middleware (onResponse on every mutating method). Without a
// resolved tenant, request.db is absent and the handler answers 401.
//
// The `filter`/`page` query params are accepted per the contract but not
// interpreted (their semantics are undefined — inventing behaviour would violate
// PLAN.md §0 rule 4); the full tenant-scoped list is returned as one page. The
// `kind` param IS defined (contract enum [supplier, subcon]) and honoured: the
// full tenant set is fetched through the scoped select, then narrowed to the
// requested kind (same "fetch full set, shape in JS" posture as models.ts). An
// out-of-enum kind is ignored (→ full list) rather than 400'd — listVendors
// defines no 400 response.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { vendors } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import { loadCaller, MANAGEMENT_MODULE, permAllowed } from "./authz.js";

type VendorRow = typeof vendors.$inferSelect;

/** vendor_kind enum values (project.ts) — also the contract's `kind` filter enum. */
const VENDOR_KINDS = new Set(["supplier", "subcon"]);

/** vendor.status closed set (VendorForm dropdown, master-party.jsx:175). The DB
 *  column is plain text (B-071); this app-layer set enforces active|inactive. */
const VENDOR_STATUSES = new Set(["active", "inactive"]);

/** The opaque Entity wire shape for one vendor (real DB columns only). */
function toWire(v: VendorRow): Record<string, unknown> {
  return {
    id: v.id,
    name: v.name,
    // code/addr/bank/status are the B-071 (P2-BE-08) superset columns the
    // master.vendor screen renders (was omitted before the columns existed).
    code: v.code,
    tax_id: v.taxId,
    kind: v.kind,
    credit_term: v.creditTerm,
    addr: v.addr,
    bank: v.bank,
    status: v.status,
    // `spend` is deliberately NOT on the wire — the per-vendor purchase total has
    // no AP source yet (honest gap), so it is omitted rather than fabricated as a
    // fake 0. Flagged to WEB/QA: the party KPI "ยอดซื้อรวม" has no backing until
    // AP lands. `type` is likewise absent — the web derives its 4-way type badge
    // from `kind` (B-070), never stored/returned here.
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Does the opaque body explicitly carry any of these keys (part of a merge)? */
function has(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** First present value among the given keys (opaque field aliases). */
function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

/**
 * credit_term → integer days, or null. Accepts a number or a numeric string;
 * a non-numeric value (e.g. an un-mapped Thai term label) yields null — the
 * backend does not guess a day count (that mapping is the web's job).
 */
function toCreditTerm(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize a client `kind`, or "" when absent/blank. */
function pickKind(value: unknown): string {
  return str(value).trim().toLowerCase();
}

/** Normalize a client `status`, or "" when absent/blank. */
function pickStatus(value: unknown): string {
  return str(value).trim().toLowerCase();
}

/** Trim a client free-text field to a value, or null when absent/blank. */
function pickText(body: Record<string, unknown>, ...keys: string[]): string | null {
  return has(body, ...keys) ? str(pick(body, ...keys)).trim() || null : null;
}

/** Register GET/POST /vendors + GET/PUT /vendors/:id on the /api/v1 scope. */
export function registerVendorsRoute(app: FastifyInstance): void {
  app.get("/vendors", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // vendor → own company_id (scoped select returns only this tenant's rows).
    const rows = await db.select(vendors);

    // Honour ?kind=supplier|subcon (contract enum). An out-of-enum kind is
    // ignored → the full tenant list (no 400 in listVendors).
    const kind = pickKind((request.query as Record<string, unknown>)?.kind);
    const filtered = VENDOR_KINDS.has(kind)
      ? rows.filter((v) => v.kind === kind)
      : rows;

    return reply.code(200).send(listEnvelope(filtered.map(toWire)));
  });

  app.post("/vendors", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // B-395 (audit H2): a vendor is `master`-module master-data of the same class
    // as /models + /cost-centers (B-084), so creating one is gated on the same
    // master.create right (reusing loadCaller/permAllowed — no new policy). This
    // is a MONEY gate, not master-data tidiness: `vendor.bank` is the
    // beneficiaryAccountNo the generated bank payment file pays to (bank.ts:684),
    // so minting a payee here mints a payment destination. Fail-closed: an
    // unattributable caller has no perms and is denied — before any body is read.
    const caller = await loadCaller(request);
    if (!permAllowed(caller?.perms, MANAGEMENT_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `requires ${MANAGEMENT_MODULE}.create permission`,
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(pick(body, "name")).trim();
    // The web has already mapped its 4-way type to a kind; default to the schema
    // default (supplier) when none is sent (mock add form opens on "วัสดุ").
    const kind = pickKind(pick(body, "kind")) || "supplier";
    const taxId = has(body, "tax_id", "taxId")
      ? str(pick(body, "tax_id", "taxId")).trim() || null
      : null;
    const creditTerm = has(body, "credit_term", "creditTerm")
      ? toCreditTerm(pick(body, "credit_term", "creditTerm"))
      : null;
    // B-071 superset fields: free-text display columns (null when blank/absent);
    // status defaults to the mock's "active" (VendorForm opens on ใช้งาน).
    const code = pickText(body, "code");
    const addr = pickText(body, "addr");
    const bank = pickText(body, "bank");
    const status = pickStatus(pick(body, "status")) || "active";

    // Validation mirrors VendorAddForm.save (master-party.jsx:145-149): name is
    // the only required field. No code / tax_id format rule (the mock has none).
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!VENDOR_KINDS.has(kind)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "kind must be one of supplier, subcon",
      });
    }
    // status is a plain-text column (B-071) — enforce the active|inactive closed
    // set here (the DB cannot). An out-of-set explicit value is rejected.
    if (!VENDOR_STATUSES.has(status)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "status must be one of active, inactive",
      });
    }

    // company_id is force-set by the scoped insert() door — a vendor can never
    // land under another tenant, and any client company_id is ignored.
    const [created] = await db
      .insert(vendors, {
        name,
        code,
        taxId,
        kind: kind as "supplier" | "subcon",
        creditTerm,
        addr,
        bank,
        status,
      })
      .returning();

    return reply.code(201).send(toWire(created!));
  });

  app.get("/vendors/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    // Scoped select: a foreign tenant's id simply resolves to nothing (→ 404).
    const [vendor] = await db.select(vendors, eq(vendors.id, id));
    if (!vendor) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `vendor ${id} not found` });
    }
    return reply.code(200).send(toWire(vendor));
  });

  app.put("/vendors/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // B-395 (audit H2): editing a vendor is master-data administration too, so
    // gate it on master.edit (same right /roles PUT uses). The money reason is
    // sharper here than on create: `bank` is the beneficiaryAccountNo the bank
    // payment file pays to (bank.ts:684), so an ungated PUT lets any tenant
    // member re-point an existing vendor's AP payout at their own account.
    // Fail-closed, and BEFORE the body is read — deny, then parse.
    const caller = await loadCaller(request);
    if (!permAllowed(caller?.perms, MANAGEMENT_MODULE, "edit")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `requires ${MANAGEMENT_MODULE}.edit permission`,
      });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    // 404 through the scoped select — a foreign id is invisible to this tenant.
    const [current] = await db.select(vendors, eq(vendors.id, id));
    if (!current) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `vendor ${id} not found` });
    }

    // PARTIAL merge — only keys present in the body are updated.
    const set: Record<string, unknown> = {};
    if (has(body, "name")) set.name = str(pick(body, "name")).trim();
    if (has(body, "code")) set.code = str(pick(body, "code")).trim() || null;
    if (has(body, "tax_id", "taxId")) {
      set.taxId = str(pick(body, "tax_id", "taxId")).trim() || null;
    }
    if (has(body, "credit_term", "creditTerm")) {
      set.creditTerm = toCreditTerm(pick(body, "credit_term", "creditTerm"));
    }
    if (has(body, "addr")) set.addr = str(pick(body, "addr")).trim() || null;
    if (has(body, "bank")) set.bank = str(pick(body, "bank")).trim() || null;
    if (has(body, "kind")) {
      const kind = pickKind(pick(body, "kind"));
      if (!VENDOR_KINDS.has(kind)) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "kind must be one of supplier, subcon",
        });
      }
      set.kind = kind;
    }
    if (has(body, "status")) {
      const status = pickStatus(pick(body, "status"));
      if (!VENDOR_STATUSES.has(status)) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "status must be one of active, inactive",
        });
      }
      set.status = status;
    }

    if (Object.keys(set).length === 0) {
      // Nothing to merge — echo the current row (partial-merge no-op).
      return reply.code(200).send(toWire(current));
    }

    // update() is scoped by company_id — it can only ever touch this tenant's row.
    const [updated] = await db.update(vendors, set, eq(vendors.id, id)).returning();
    if (!updated) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `vendor ${id} not found` });
    }
    return reply.code(200).send(toWire(updated));
  });
}
