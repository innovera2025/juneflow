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
import { and, eq, inArray } from "drizzle-orm";
import {
  grItems,
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
import { round2 } from "./money.js";

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
 * The chain the posting inbox reaches a goods receipt through: gr → po → vendor.
 * `gr` carries no company_id, and this is the ONE definition of its inbox scope —
 * the enumeration, the per-line money read and the B-361 posting lock all use it,
 * so the three can never drift on which receipts this tenant may post.
 * (Carried limitation, unchanged: PO-anchored receipts only — see the enumeration.)
 */
const GR_INBOX_HOPS = [
  { fk: grs.poId, parent: pos },
  { fk: pos.vendorId, parent: vendors },
];

/**
 * B-361 — the posting transaction found the receipt no longer postable: a
 * concurrent return/cancel got the row first. Thrown from INSIDE the posting
 * transaction so the whole post rolls back; the caller answers an honest per-doc
 * skip — never a 500, and never a JV against returned goods.
 */
export class GrNoLongerPostableError extends Error {
  constructor() {
    super("the receipt left the received state before its JV committed");
    this.name = "GrNoLongerPostableError";
  }
}

/**
 * B-361 — TAKE THE RECEIPT'S ROW LOCK, THEN RE-DECIDE. Called FIRST inside the
 * posting transaction, before the JV insert.
 *
 * WHAT WAS BROKEN. B-348 froze a POSTED receipt against return/cancel with two
 * plain SELECTs on `jv` (one before the flip, one inside the transaction), while
 * the poster read `gr.status` with a plain SELECT of its own — in
 * listGlPostingDocs, OUTSIDE any transaction, once per batch. Under READ COMMITTED
 * none of those conflict, so both writers could commit. gr.ts filed it as a
 * one-statement residual between "humans at operating pace"; measured with two OS
 * PROCESSES on a 700 ms barrier and a fresh postable receipt each round, it was the
 * DEFAULT outcome — 5 of 6 rounds committed the post AND the return, leaving a
 * `returned` receipt with a live Dr 5020 / Cr 2010 standing against it.
 *
 * THAT IS NOT A STRAY RACE: this freeze is the ENTIRE mitigation for the
 * deliberately-deferred reversing-JV ruling. While it leaks, that deferral is not
 * safe.
 *
 * HOW THIS CLOSES IT WITHOUT A NEW LOCK DOOR. `gr` carries no company_id, so
 * TenantDb.selectForUpdate (company_id-scoped by construction) cannot reach it —
 * but a guarded UPDATE takes the SAME row-level exclusive lock, and now both
 * writers take it on the same row:
 *   · gr.ts return/cancel already flips `gr` with a guarded updateThroughChain,
 *     which holds that row for the rest of its transaction;
 *   · this issues the same UPDATE, re-asserting `status = 'received'` on the FINAL
 *     update's WHERE (the B-149 rule — a guard on the resolve SELECT is a TOCTOU).
 * Whoever takes the lock decides. Return first → this update re-matches
 * `id = … AND status = 'received'` against the NEW row version, matches 0 rows, and
 * the post is refused. Post first → the return's own in-transaction JV re-check
 * sees the committed JV and rolls back → 409. Every interleaving ends with exactly
 * one of the two, which is why the in-transaction re-check on the other side stays.
 *
 * THE WRITE IS THE LOCK, and `updated_at` is the only column it touches: honest
 * (the post did touch this receipt) and it invents no state — posted-ness still
 * derives ONLY from the jv.source_doc ref, so nothing else has to learn a column.
 *
 * THE HAZARD, written down because it is invisible at the call site: this is
 * correct BECAUSE READ COMMITTED re-evaluates a blocked UPDATE's WHERE against the
 * winner's committed row (EPQ). Under REPEATABLE READ the blocked writer aborts
 * with a serialization failure instead — safe, but a 500 rather than a skip — so
 * anyone raising the isolation level must revisit BOTH sides of this pair. The same
 * warning tenant-db.ts carries over selectForUpdate, for the same reason.
 */
export async function lockPostableGr(tx: TenantDb, grId: string): Promise<void> {
  const [held] = await tx.updateThroughChain(
    grs,
    GR_INBOX_HOPS,
    { updatedAt: new Date() },
    eq(grs.id, grId),
    eq(grs.status, "received"),
  );
  if (!held) throw new GrNoLongerPostableError();
}

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
    // B-348: `status = 'received'` ONLY. Before this round every gr row was
    // enumerated regardless of status, which was invisible because every gr row
    // carried `amount: null` and was therefore unpostable anyway. The moment a
    // receipt has a money value that stops being harmless in BOTH directions: a
    // RETURNED or CANCELLED receipt would become postable and book a cost plus an
    // AP liability for goods that went back to the vendor. Filtering here also
    // takes them off the gl.inbox badge, which is correct — a receipt that will
    // never post is not "awaiting posting" — and countGlInbox derives from this
    // same function by design, so the list and the badge move together.
    // (The mirror case, POST-then-return, is closed in gr.ts: a posted receipt
    // can no longer be returned or cancelled. See the notes there.)
    db.selectThrough(grs, GR_INBOX_HOPS, eq(grs.status, "received")),
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

  // -------------------------------------------------------------------------
  // B-348 — THE RECEIPT'S MONEY VALUE. One extra read, not N+1.
  // -------------------------------------------------------------------------
  // listGlPostingDocs runs on EVERY shell load (counts.ts asks it for the
  // gl.inbox badge), so the line values are fetched with a single
  // `inArray(gr_item.gr_id, …)` over the receipts already enumerated above rather
  // than a read per receipt. gr_item is indexed on gr_id.
  //
  // The scope chain is gr_item → gr → po → vendor, i.e. the gr chain above with
  // one hop in front — the same root, so a line can never be read for a receipt
  // this tenant could not read. (Deliberately NOT gr.ts's gr_item → gr → po → pr →
  // project chain: this function's gr enumeration anchors on vendor, and reading
  // the lines through a DIFFERENT root than their own receipt is how a list and
  // its totals drift apart.)
  const grIds = grRows.map((g) => g.id);
  const linesByGr = new Map<string, (typeof grItems.$inferSelect)[]>();
  if (grIds.length > 0) {
    const lines = await db.selectThrough(
      grItems,
      [{ fk: grItems.grId, parent: grs }, ...GR_INBOX_HOPS],
      and(inArray(grItems.grId, grIds), eq(grs.status, "received")),
    );
    for (const line of lines) {
      const bucket = linesByGr.get(line.grId);
      if (bucket) bucket.push(line);
      else linesByGr.set(line.grId, [line]);
    }
  }

  /**
   * A receipt's postable value, or null when it has none.
   *
   * Σ(received_qty × price) over the receipt's gr_item rows, 2-dp rounded — the
   * SAME expression gr.ts's `grWire` already puts on the list wire as `money`, so
   * the GL inbox and the GR screen cannot quote different figures for one receipt.
   * Every input is a stored server-owned column: `price` is derived from
   * `boq_item.price` at create (B-348, gr.ts) and is never client-supplied.
   *
   * NULL — i.e. "no postable money amount", the honest gap — in three cases, each
   * a real receipt shape rather than a defensive hypothetical:
   *
   *  1. NO gr_item ROWS AT ALL. This is the mobile shape: st_receive posts bare
   *     `{qty_ok}` lines with no `name`, so no per-line detail is written. Σ over
   *     an empty list is 0, and 0 here would mean "this delivery was worth nothing"
   *     — it means "nobody recorded what it was worth". apps/web already refuses to
   *     render that 0 (gr-rows.ts hasLineDetail, whose header reads "Those zeroes
   *     mean 'unknown', not 'zero baht'"); the GL must refuse to POST it.
   *
   *  2. Σ <= 0. Reachable with lines present: a named line carrying no
   *     `boq_item_id` has no server price source and stores 0.00. A zero-amount JV
   *     is two zero legs — balanced, meaningless, and it marks the document posted
   *     forever, which is strictly worse than leaving it pending.
   *
   *  3. MORE THAN ONE CURRENCY across the lines. POST /gr enforces one currency per
   *     receipt (B-085 fix 4), but as a create-time check rather than a constraint,
   *     so rows written before that guard can still be mixed. Σ across currencies
   *     under a single label is a fabricated number, and gl.ts would otherwise
   *     default the label to "THB".
   */
  const grValue = (grId: string): { amount: number | null; currency: string | null } => {
    const lines = linesByGr.get(grId) ?? [];
    if (lines.length === 0) return { amount: null, currency: null };
    const currencies = new Set(lines.map((l) => l.currencyCode));
    if (currencies.size > 1) return { amount: null, currency: null };
    const total = round2(
      lines.reduce((sum, l) => sum + Number(l.receivedQty) * Number(l.price), 0),
    );
    if (!Number.isFinite(total) || total <= 0) return { amount: null, currency: null };
    return { amount: total, currency: lines[0]!.currencyCode ?? null };
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
    // B-348 — the former GAP ("gr carries received/rejected QUANTITY, not a money
    // value") is CLOSED. The value was always there: gr_item carries `price` +
    // `currency_code` as real columns and gr.ts already derives Σ(received × price)
    // for the list wire. Lifting that same derivation here is what turns FLOW-A
    // from a document chain into a COST chain — a receipt now posts Dr 5020 /
    // Cr 2010 (gl-post.ts POSTING_MAP.gr) for what actually arrived.
    const { amount, currency } = grValue(r.id);
    docs.push({
      source: "gr",
      id: r.id,
      doc_no: r.no ?? null, // gr.no is a real (nullable) column.
      amount,
      currency_code: currency,
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
