// /doc-numbering — the tenant's running-number counters per document type
// (P1-BE-08 + P1-BE-11, master.jsx DOCNUM_SEED / docs/extract/MOCK-DATA.md:54).
//
// FOUR OPS, not one. The contract has declared list + create + get-by-id + update
// since the beginning (openapi.yaml:913-970); only the list was ever mounted, so
// master.docnum's add and edit controls had nothing to call and were left with no
// onClick at all. The three writes are added here — no contract change, because
// the contract already describes them.
//
// Contract (openapi.yaml /doc-numbering GET, ~L736): the B-014 paginated list
// envelope {data, page, page_size, total} (EntityList) where each `data` row is
// an opaque Entity. doc_numbering is NOT in the data dictionary
// (docs/extract/MOCK-DATA.md:66) so the schema is authoritative: the row shape
// follows the real schema columns (schema doc_numbering, extensions.ts Item 8 /
// seed DOCNUM_SEED) — {id, type, prefix, running, reset_rule, locked}.
//   type       = document type (e.g. "Purchase Order", "Work Order").
//   prefix     = the running-number prefix (e.g. "PO"); nullable.
//   running    = the LAST-used running number as a STRING, verbatim from the
//                mock incl. leading zeros ("0291") and non-numeric values (BOQ
//                row "B-02 v3") — B-060(ก), P1-BE-11 (was integer). The FE pads
//                / +1s all-digit values only (master.jsx:874); issuing-time
//                semantics land with the Phase-2 numbering service.
//   reset_rule = the reset cadence (mock `reset` — yearly/monthly/never per
//                RESET_OPTS); nullable.
//   locked     = the lock-mode CODE (mock `lock`, LOCK_OPTS): all | dept |
//                warehouse | none — B-067(ข), P1-BE-12 (was boolean; a boolean
//                dropped the dept/warehouse modes and failed the G5 g2/35 cell).
//                Passed through as the stored text; the FE resolves each code to
//                its i18n label (all→docnum.lockAll · dept→docnum.lockDept ·
//                warehouse→docnum.lockWarehouse · none→literal "—").
// Timestamps are dropped and company_id is NOT echoed on the wire: it is the
// tenant's own scope (implied by the authenticated request, not a per-row datum
// the mock ever showed), so echoing it would add an un-approved field — exactly
// like GET /cost-centers omits its scope columns. Inventing/echoing fields with
// no mock home would violate PLAN.md §0 rule 4.
//
// doc_numbering carries its OWN company_id column (NOT NULL FK → company,
// extensions.ts:574, unique(company_id, type) per P0-FIX-02), so it is a
// first-class tenant-owned table — read through the scoped TenantDb.select()
// door, which AND-injects `WHERE company_id = <this tenant>` on every query:
//
//   SELECT doc_numbering.* FROM doc_numbering WHERE company_id = <this tenant>
//
// This is the same door GET /projects uses (db.select(projects)); a bare read is
// impossible (the un-scoped handle is private to TenantDb), so another tenant's
// counters can never leak. Without a resolved tenant, request.db is absent and
// the handler answers 401 (same posture as GET /projects, /companies,
// /cost-centers).
//
// filter/page query params are accepted per the contract but not interpreted
// (their semantics are undefined — inventing filter behavior would violate
// PLAN.md §0 rule 4); the full tenant-scoped list is returned as one page.
import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { docNumberings } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import { isUniqueViolation, violatedConstraint } from "./gl-post.js";

/** The unique index a duplicate document type trips (extensions.ts:749). */
const TYPE_UNIQUE = "doc_numbering_company_type_uq";

/**
 * The lock-mode CODES the FE can resolve to a label (B-067, P1-BE-12):
 * all -> docnum.lockAll · dept -> docnum.lockDept · warehouse ->
 * docnum.lockWarehouse · none -> the literal em-dash.
 *
 * VALIDATED ON WRITE, not just documented. The column is free text with a
 * default, so an unknown code stores happily and then renders as NOTHING on the
 * master.docnum grid — a silently blank security column on a screen about
 * locking document numbers. The read side has no way to tell "not set" from
 * "set to something I cannot name".
 */
const LOCK_CODES = new Set(["all", "dept", "warehouse", "none"]);

/** One doc_numbering row on the wire — the same shape the list has always sent. */
function toWire(d: typeof docNumberings.$inferSelect): Record<string, unknown> {
  return {
    id: d.id,
    type: d.type,
    prefix: d.prefix,
    running: d.running,
    reset_rule: d.resetRule,
    locked: d.locked,
  };
}

/** A body value as a trimmed string ("" when absent or not a string). */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 401 for a request with no resolved tenant (the posture every handler here shares). */
function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Register GET /doc-numbering on the given (already /api/v1-prefixed) scope. */
export function registerDocNumberingRoute(app: FastifyInstance): void {
  app.get("/doc-numbering", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // doc_numbering carries its own company_id — read it through the scoped
    // select() door (auto-injects WHERE company_id = <this tenant>).
    const rows = await db.select(docNumberings);

    return reply.code(200).send(
      // B-014: wrap the doc-numbering counters in the paginated list envelope
      // ({data, page, page_size, total}). The full tenant-scoped list is
      // returned as one page (filter/page/page_size accepted but not
      // interpreted) — see list-envelope.ts.
      listEnvelope(rows.map(toWire)),
    );
  });

  // GET /doc-numbering/{id} — one counter, tenant-scoped. The scoped select
  // AND-injects company_id, so another tenant's id matches zero rows and answers
  // 404 rather than 403: a 403 would confirm the id exists somewhere.
  app.get("/doc-numbering/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const { id } = request.params as { id: string };
    const [row] = await db.select(docNumberings, eq(docNumberings.id, id));
    if (!row) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "doc numbering rule not found" });
    }
    return reply.code(200).send(toWire(row));
  });

  // POST /doc-numbering — create a counter for a document type.
  //
  // `type` is the only required field: it is the NOT NULL column and half of
  // unique(company_id, type). `running` and `locked` fall back to the column
  // defaults ("1" / "none") rather than being invented here. `prefix` and
  // `reset_rule` are nullable and pass through as given.
  //
  // running is TEXT and stays text (B-060): the mock carries leading zeros
  // ("0418") and non-numeric values ("B-02 v3"), and parsing it to a number here
  // would silently rewrite both.
  app.post("/doc-numbering", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const type = str(body.type);
    if (!type) {
      return reply.code(400).send({ code: "VALIDATION", message: "type is required" });
    }
    const locked = str(body.locked) || "none";
    if (!LOCK_CODES.has(locked)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: `locked must be one of all | dept | warehouse | none (got "${locked}")`,
      });
    }

    const values = {
      type,
      prefix: str(body.prefix) || null,
      running: str(body.running) || "1",
      resetRule: str(body.reset_rule ?? body.resetRule) || null,
      locked,
    };

    // The unique index is the authority on duplicates, not a preceding SELECT: a
    // check-then-insert leaves a window in which a concurrent request inserts the
    // same type and one of the two 500s. The catch is keyed on the CONSTRAINT
    // NAME rather than on "some unique violation" (B-263) — a different index
    // tripping here is a different bug and must not be reported as a duplicate
    // document type.
    try {
      const [created] = await db.insert(docNumberings, values).returning();
      return reply.code(201).send(toWire(created!));
    } catch (err) {
      if (isUniqueViolation(err) && violatedConstraint(err) === TYPE_UNIQUE) {
        return reply.code(409).send({
          code: "DUPLICATE_TYPE",
          message: `doc numbering for type ${type} already exists`,
        });
      }
      throw err;
    }
  });

  // PUT /doc-numbering/{id} — update a counter.
  //
  // Scoped update: WHERE company_id = <this tenant> AND id = :id, so another
  // tenant's row matches zero rows -> 404 (the project-types precedent).
  // Renaming `type` can collide with the same unique index, so the same
  // constraint-named catch applies.
  app.put("/doc-numbering/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const type = str(body.type);
    if (!type) {
      return reply.code(400).send({ code: "VALIDATION", message: "type is required" });
    }
    const locked = str(body.locked) || "none";
    if (!LOCK_CODES.has(locked)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: `locked must be one of all | dept | warehouse | none (got "${locked}")`,
      });
    }

    const values = {
      type,
      prefix: str(body.prefix) || null,
      running: str(body.running) || "1",
      resetRule: str(body.reset_rule ?? body.resetRule) || null,
      locked,
    };

    try {
      const [updated] = await db
        .update(docNumberings, values, eq(docNumberings.id, id))
        .returning();
      if (!updated) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "doc numbering rule not found" });
      }
      return reply.code(200).send(toWire(updated));
    } catch (err) {
      if (isUniqueViolation(err) && violatedConstraint(err) === TYPE_UNIQUE) {
        return reply.code(409).send({
          code: "DUPLICATE_TYPE",
          message: `doc numbering for type ${type} already exists`,
        });
      }
      throw err;
    }
  });
}
