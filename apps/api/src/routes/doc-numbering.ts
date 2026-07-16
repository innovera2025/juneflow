// GET /doc-numbering — the tenant's running-number counters per document type
// (P1-BE-08 + P1-BE-11, master.jsx DOCNUM_SEED / docs/extract/MOCK-DATA.md:54).
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
import type { FastifyInstance } from "fastify";
import { docNumberings } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

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
      listEnvelope(
        rows.map((d) => ({
          id: d.id,
          type: d.type,
          prefix: d.prefix,
          running: d.running,
          reset_rule: d.resetRule,
          locked: d.locked,
        })),
      ),
    );
  });
}
