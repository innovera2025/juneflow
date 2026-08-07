// GL posting inbox — the SINGLE source of truth for "which source money docs
// are (un)posted to the GL", shared by GET /gl/posting-inbox (the row list,
// gl.ts) and GET /counts?keys=gl.inbox (the badge count, counts.ts) so the two
// can NEVER drift (the same non-drift principle dashboard.ts follows by reusing
// the approve-handler's tier gate for its approvals-inbox).
//
// Posted-ness CONVENTION (finance.ts JV model header + the original counts.ts
// countGlInbox): a posting JV records the document it posted via
//   jv.source_doc = "<table>:<uuid>"   e.g. "pv:2f...c9"
// A source doc is POSTED iff some JV's source_doc references it by that
// convention; otherwise it is PENDING (still awaiting posting in the inbox).
//
// HONEST DATA GAP (Wave-2 recon, P2-BE-17): the SEED never writes a
// "table:uuid" source_doc — every seeded jv.source_doc is FREE TEXT ("REM" /
// "GR auto" / "Petty" / "Manual" / "Allocate" / "FA auto"), a source-KIND
// label, not a document ref. So on the current seed NO doc resolves as posted
// and every source money doc surfaces as PENDING. This is the honest
// current-data answer (it exactly matches the gl.inbox badge), NOT a fabricated
// pending/posted status (decision C10). To surface POSTED docs with their JV
// number, the GL posting flow / seed must populate source_doc = "pv:<uuid>"
// etc. — the mechanism exists; only the linking data is absent.
//
// Source-doc universe = the five tables the posting inbox draws from that have
// a real backing table (pv, rv, gr, payroll, petty — B-233 claim-MVP). The
// prototype's other sources (FA depreciation, Allocate) have no per-document
// table in the schema/seed and are therefore not enumerable — omitted rather
// than fabricated.
import { eq } from "drizzle-orm";
import {
  grs,
  jvs,
  payrolls,
  pettyCashTxns,
  pos,
  pvs,
  rvs,
  vendors,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { bySourceThenNewest } from "./list-order.js";

/**
 * jv.source_doc "<table>:<uuid>" polymorphic ref (finance.ts GLPosting model).
 * ADDITIVE (Phase-3 finance): fa (depreciation) and cn (credit-note) post
 * DIRECTLY from their own handlers (fa.ts / ar.ts) — they are NOT inbox rows —
 * but their JVs record this SAME source_doc convention, so the shared ref must
 * recognise `fa:` / `cn:` refs too. This only widens what the ref PARSES; the
 * inbox enumeration in listGlPostingDocs below is unchanged (still the four
 * kinds with a real backing table: pv/rv/gr/payroll).
 */
// The optional `:YYYY-MM` tail is the FA-depreciation period discriminator
// (P2-BE-52): a depreciation post's source_doc is `fa:<assetId>:<period>` so it is
// unique per (asset, period) under the jv.source_doc UNIQUE index, while the other
// kinds stay `<kind>:<uuid>` (one post per document).
export const SOURCE_DOC_REF = /^(pv|rv|gr|payroll|fa|cn|ret|dep|petty):([0-9a-fA-F-]{36})(:\d{4}-\d{2}|:\d+)?$/;

/**
 * Every source-doc kind the shared source_doc convention can reference. The
 * posting INBOX enumerates the FIVE that have a real backing table here
 * (pv/rv/gr/payroll/petty); fa/cn are valid refs written by their own
 * direct-posting handlers and are never surfaced as inbox rows. petty (B-233) is
 * a real inbox row: a pending petty-cash CLAIM surfaces here and posts through
 * the shared /gl/post path (Dr 5100 / Cr 1010, Wei C-177).
 */
export type GlSourceKind = "pv" | "rv" | "gr" | "payroll" | "fa" | "cn" | "petty";

/** The order listGlPostingDocs() appends its source blocks in — the shipped screen
 *  order, pinned here so a determinism sort cannot silently regroup the inbox. */
const GL_SOURCE_ORDER: readonly GlSourceKind[] = [
  "pv",
  "rv",
  "gr",
  "payroll",
  "petty",
  "fa",
  "cn",
];

/**
 * One posting-inbox row: a source money doc + its resolved posting state. The
 * opaque Entity wire shape (snake_case) for GET /gl/posting-inbox.
 */
export interface GlPostingDoc {
  source: GlSourceKind;
  id: string;
  /** Real doc number where the source table carries one (gr.no); null otherwise. */
  doc_no: string | null;
  /** Real money amount where the source table carries one; null otherwise (gap). */
  amount: number | null;
  currency_code: string | null;
  /** true iff a JV posted this doc via the source_doc "<table>:<uuid>" ref. */
  posted: boolean;
  /** The posting JV's number when posted; null when pending. */
  jv_no: string | null;
  created_at: unknown;
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else null. */
function money(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read every source money doc (tenant-scoped) and resolve each doc's posting
 * state from the JV source_doc refs. Returns ALL docs (pending + posted); the
 * badge count is `docs.filter((d) => !d.posted).length` and the inbox endpoint
 * returns the full list. Fail-closed: every read runs through a scoped TenantDb
 * door (company_id-bound select, or, for gr which carries no company_id, the
 * selectThrough door anchored po → vendor — IDENTICAL to the original
 * countGlInbox scope, so the count and the list read the same set).
 */
export async function listGlPostingDocs(db: TenantDb): Promise<GlPostingDoc[]> {
  const [pvRows, rvRows, payrollRows, grRows, pettyRows, jvRows] = await Promise.all([
    db.select(pvs),
    db.select(rvs),
    db.select(payrolls),
    // gr carries no company_id — scoped po → vendor (its tenant root), the same
    // chain counts.ts uses. NOTE (carried limitation): this covers PO-anchored
    // GRs only; WO-anchored GRs (grs.wo_id) are not enumerated here, exactly as
    // in the original badge query — kept identical so the two never diverge.
    db.selectThrough(grs, [
      { fk: grs.poId, parent: pos },
      { fk: pos.vendorId, parent: vendors },
    ]),
    // petty (B-233): only CLAIM rows enter the posting inbox (a claim-MVP —
    // clear/topup are out of scope). petty_cash_txn carries company_id → the
    // scoped select() door. Posted-ness derives from the jv source_doc
    // "petty:<id>" ref exactly like pv/rv/gr (NOT from petty.status), so the inbox
    // and the badge can never drift.
    db.select(pettyCashTxns, eq(pettyCashTxns.type, "claim")),
    db.select(jvs),
  ]);

  // Resolve the posted set + the posting JV number, keyed "<table>:<uuid>".
  const postedJvNo = new Map<string, string | null>();
  for (const jv of jvRows) {
    const ref = jv.sourceDoc ? SOURCE_DOC_REF.exec(jv.sourceDoc) : null;
    if (ref) postedJvNo.set(`${ref[1]}:${ref[2]!.toLowerCase()}`, jv.no ?? null);
  }
  const resolvePosting = (
    source: GlSourceKind,
    id: string,
  ): { posted: boolean; jvNo: string | null } => {
    const key = `${source}:${id.toLowerCase()}`;
    if (!postedJvNo.has(key)) return { posted: false, jvNo: null };
    return { posted: true, jvNo: postedJvNo.get(key) ?? null };
  };

  const docs: GlPostingDoc[] = [];

  for (const r of pvRows) {
    const { posted, jvNo } = resolvePosting("pv", r.id);
    docs.push({
      source: "pv",
      id: r.id,
      doc_no: null, // GAP: pv has no doc-number column (net-only settlement doc).
      amount: money(r.net),
      currency_code: r.currencyCode ?? null,
      posted,
      jv_no: jvNo,
      created_at: r.createdAt ?? null,
    });
  }

  for (const r of rvRows) {
    const { posted, jvNo } = resolvePosting("rv", r.id);
    docs.push({
      source: "rv",
      id: r.id,
      doc_no: null, // GAP: rv has no doc-number column.
      amount: money(r.amount),
      currency_code: r.currencyCode ?? null,
      posted,
      jv_no: jvNo,
      created_at: r.createdAt ?? null,
    });
  }

  for (const r of grRows) {
    const { posted, jvNo } = resolvePosting("gr", r.id);
    docs.push({
      source: "gr",
      id: r.id,
      doc_no: r.no ?? null, // gr.no is a real (nullable) column.
      amount: null, // GAP: gr carries received/rejected QUANTITY, not a money value.
      currency_code: null,
      posted,
      jv_no: jvNo,
      created_at: r.createdAt ?? null,
    });
  }

  for (const r of payrollRows) {
    const { posted, jvNo } = resolvePosting("payroll", r.id);
    docs.push({
      source: "payroll",
      id: r.id,
      doc_no: null, // GAP: payroll keys on (worker, period) — no doc-number column.
      amount: money(r.amount),
      currency_code: r.currencyCode ?? null,
      posted,
      jv_no: jvNo,
      created_at: r.createdAt ?? null,
    });
  }

  for (const r of pettyRows) {
    const { posted, jvNo } = resolvePosting("petty", r.id);
    docs.push({
      source: "petty",
      id: r.id,
      doc_no: r.no ?? null, // petty.no is a real server-generated PT-YYYY-NNNN.
      amount: money(r.value), // the claim magnitude (stored > 0) — the JV basis.
      currency_code: r.currencyCode ?? null,
      posted,
      jv_no: jvNo,
      created_at: r.createdAt ?? null,
    });
  }

  // B-323: the feed is assembled source-block by source-block, and within each block
  // the rows arrive in whatever order the scoped read produced — five of the six reads
  // are joined chains, whose row order is a join-plan artefact. Pin the order WITHIN
  // each block and leave the block sequence exactly as it ships (see bySourceThenNewest:
  // sorting across sources would interleave them and change the screen, which is a
  // product decision, not a determinism one).
  const rank = (d: GlPostingDoc): number => GL_SOURCE_ORDER.indexOf(d.source);
  return bySourceThenNewest(docs, rank);
}

/**
 * The gl.inbox badge count: source money docs NOT yet posted to a JV. Derived
 * from the same listGlPostingDocs() the inbox endpoint returns, so the count and
 * the list can never drift.
 */
export async function countGlInbox(db: TenantDb): Promise<number> {
  const docs = await listGlPostingDocs(db);
  return docs.filter((d) => !d.posted).length;
}
