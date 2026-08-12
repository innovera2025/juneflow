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
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  subconContracts,
  workPeriods,
  acceptances,
  defects,
  projects,
  vendors,
  apBillings,
  retentionLedgers,
  grs,
  pmWorkOrders,
  pmAssets,
  pmContracts,
  pos,
  wos,
  prs,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { loadCaller, permAllowed, type CallerAuthz } from "./authz.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { byIdAsc, newestFirst } from "./list-order.js";
// The open-PM work-order query is owned by counts.ts (the pm.wo badge source);
// the acceptance-center PM feed reuses it so the two can never drift (see the
// pm slice below).
import { selectOpenPmWorkOrders } from "./counts.js";

type SubconContractRow = typeof subconContracts.$inferSelect;
type WorkPeriodRow = typeof workPeriods.$inferSelect;
type AcceptanceRow = typeof acceptances.$inferSelect;
type DefectRow = typeof defects.$inferSelect;
type ApBillingRow = typeof apBillings.$inferSelect;
type GrRow = typeof grs.$inferSelect;
type PmWorkOrderRow = typeof pmWorkOrders.$inferSelect;
type PmAssetRow = typeof pmAssets.$inferSelect;

// ---------------------------------------------------------------------------
// B-380 — FUNCTION-LEVEL AUTHORIZATION FOR THE SUBCON WRITE DOORS
// ---------------------------------------------------------------------------
// Until this round this file read NO permission at all: `grep -c
// "loadCaller\|permAllowed\|requireFinance" subcon.ts` was 0, on a file that mints
// an ap_billing and a retention_ledger row.
//
// PROVEN LIVE on the seeded stack at 2245b73, before this gate: a bearer for the
// `wh` Warehouse role — whose stored subcon perms row is
// {view:false, create:false, edit:false, approve:false, cancel:false}, i.e. NO
// right of any kind on this module — drove the entire money path end to end.
// POST /subcon-contracts 201 (value 1,000,000), POST /periods/{id}/deliver 200,
// POST /periods/{id}/inspect{result:pass} 200, POST /periods/{id}/approve-payment
// 200. Read back out of Postgres: ap_billing.amount 9,999,990.00 and
// retention_ledger.withheld 99,999,800.00, status `held`, against a contract worth
// 1,000,000.00. Four doors onto a payable, and not one of them looked at a perm.
//
// THE MODULE IS `subcon`, and it is not a choice this round made. The perms matrix
// (packages/db seed MODULE_IDS, transcribed from master.jsx's MODULES_LBL) is
// [dashboard, boq, pr, po, wo, gr, subcon, inventory, petty, finance, master] —
// `subcon` is its own column at index 6. B-377 set the precedent on the same class
// one round earlier: use the module the matrix already has rather than invent one,
// and never widen a role or touch the seed to make a gate fit. Every seeded role's
// subcon grant, read out of the running DB:
//   dir  Director        view create edit approve cancel   ← the only approve/cancel
//   site Site Engineer   view create edit                  ← the on-site role
//   pm   Project Manager view
//   proc Procurement Mgr view
//   acc  Accounting      view
//   finmgr Finance Mgr   view          (migration 0026, clones `acc`)
//   exec ผู้บริหาร        view          (read-only by design)
//   wh   Warehouse       —             ← the exploit identity above
//   sale Sales / REM     —
//
// THE RIGHT PER DOOR:
//   POST /subcon-contracts    → subcon.create (site, dir). Creating a contract sets
//     `value` and `retention_pct`, which are the two operands every later payment is
//     computed from — it is the origin of the commitment, not a note about one.
//   POST /periods/:id/deliver → subcon.edit (site, dir). It records the
//     contractor's submission against an existing period (flows.html L46
//     "ผู้รับเหมาส่งมอบ + เอกสาร/รูป"); its live caller is the mobile field-progress
//     screen, which is the site engineer's phone.
//   POST /periods/:id/inspect → subcon.edit (site, dir). flows.html MATRIX row
//     "รับงวดงาน (ตรวจรับ)" col 1 is โฟร์แมน (ตรวจหน้างาน) and FUNCTIONS.md:108
//     puts the same act on the foreman's mobile — the on-site role, which in the
//     seed is Site Engineer. NOT subcon.approve: the MATRIX puts the inspection and
//     the payment approval in two different columns held by two different people.
//   POST /defects/:id/fix     → subcon.edit (site, dir). flows.html L47
//     "ผู้รับเหมาแก้ไข (กำหนดเวลา)" — recorded on site against an open defect.
//   POST /defects/:id/recheck → subcon.edit (site, dir). L47 "ตรวจซ้ำ" — the same
//     foreman act as inspect, one level down the tree.
//   POST /periods/:id/approve-payment → subcon.approve (dir ONLY). This is the
//     money: it writes the ap_billing, the retention hold and the `paid` flip. The
//     seed gives `approve` on subcon to the Director alone, and B-377 took exactly
//     this reading for `cancel` — honour the matrix's own consistent intent rather
//     than invent a policy.
//
// AND THE ONE CONFLICT THIS DOES NOT GET TO SETTLE, stated rather than papered
// over: flows.html MATRIX row "รับงวดงาน (ตรวจรับ)" col 2 names ผจก.โครงการ as the
// payment approver ("อนุมัติจ่าย"), while the seeded matrix gives Project Manager
// only `view` on subcon. Two spec sources, opposite answers, and PLAN.md §0 says a
// conflict is Wei's. The gate above takes the FAIL-CLOSED side of it — dir-only —
// because an over-tight door is a 403 somebody reports while an open one mints
// payables. The consequence is real and is reported, not hidden: apps/web
// login-screen.tsx prefills somchai@rungrueang.co.th (the PM), so a browser signed
// in as the default identity now gets 403 on create / inspect / accept, and only
// `dir` completes the AcceptForm chain. If Wei rules for the MATRIX, the change is
// one line — `callerApprovalLevel(request) >= 3` (the ผจก.โครงการ tier, the
// mechanism boq.ts/pr.ts/po.ts already use for a MATRIX-named tier) in place of the
// permAllowed call — and it needs no other edit.
//
// READS ARE NOT GATED, deliberately and for the same reason B-377 gated only the
// write doors: GET /acceptance-center is a FOUR-feed screen (period / pm / house /
// gr), so a subcon.view gate on it would also take the GR feed away from the
// warehouse — a strictly wider change than the hole being closed, on a door that
// mints nothing.
//
// Resolution is fail-closed exactly like ownerOnly/requireFinance/requireGr: an
// unattributable caller (no session, no dictionary row, no role) has no perms and
// is denied.

/** The perms-matrix module (seed MODULE_IDS index 6) that governs subcon work. */
const SUBCON_MODULE = "subcon";

/** Flat 403 FORBIDDEN error — the same shape gr.ts / inventory.ts / ar.ts send. */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
}

/**
 * Fail-closed gate: the caller must be attributable AND carry the given `subcon`
 * right. Returns the resolved caller, or null after sending the 403 — so a handler
 * bails with `if (!(await requireSubcon(...))) return reply;` (the gr.ts shape).
 *
 * 403 and NOT 5xx deliberately: apps/mobile/lib/offline/sync_processor.dart
 * dead-letters a 4xx but DEFERS a 5xx and stops the whole offline drain, so a
 * denied delivery must be a terminal client answer rather than something that
 * wedges a foreman's queue behind it.
 */
async function requireSubcon(
  request: FastifyRequest,
  reply: FastifyReply,
  right: "create" | "edit" | "approve",
): Promise<CallerAuthz | null> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return null;
  }
  if (!permAllowed(caller.perms, SUBCON_MODULE, right)) {
    forbidden(reply, `this action requires the subcon ${right} permission`);
    return null;
  }
  return caller;
}

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

// Wave-3 acceptance-center fan-in scope chains (B-107e). The gr feed lives in a
// sibling group that carries NO company_id of its own, so it anchors on the
// company_id-scoped project root exactly like the subcon chains above.
//   gr → po → pr → project    |    gr → wo → pr → project   (mirror gr.ts dual path)
// The pm feed reuses counts.selectOpenPmWorkOrders (pm_workorder → pm_asset →
// pm_contract → project) — ONE source of truth for the open-PM query, shared with
// the pm.wo badge (countPmOpen) so the feed and the badge can never drift.
const GR_PO_HOPS = [
  { fk: grs.poId, parent: pos },
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const GR_WO_HOPS = [
  { fk: grs.woId, parent: wos },
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];

// META-1 (P2-BE-43) display-enrichment scope chains. Each acceptance-center row
// carries only its own FK ids; the prototype (company-accept.jsx ACCEPT_ITEMS)
// also shows the owning project name + a composed title, so we resolve those
// THROUGH tenant-scoped joins that anchor on the company_id project root — never
// a bare cross-tenant lookup. A hop that does not resolve yields an HONEST null
// (C10 — no fabricated value).
//   pm_asset    → pm_contract → project   (pm slice: project_name + title source)
//   pm_contract → project                 (pm slice: contract → project id)
//   po → pr → project | wo → pr → project | pr → project   (gr slice: project_name)
const PM_ASSET_HOPS = [
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
];
const PM_CONTRACT_HOPS = [{ fk: pmContracts.projectId, parent: projects }];
const PO_PR_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const WO_PR_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * B-149 optimistic-lock miss: a guarded status flip matched 0 rows because a
 * concurrent inspect/approve-payment already moved the period out of its expected
 * pre-state. Thrown inside the transaction so the whole write rolls back → 409.
 */
class StaleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleStateError";
  }
}

/**
 * The work_period states POST /periods/{id}/deliver accepts as a SOURCE.
 *
 * `rejected` joined `pending` in B-371 — see the long note on the handler for
 * why this door rather than a new /reinspect one. Everything else is 409:
 * `delivered` / `inspecting` are already with the foreman, and `passed` / `paid`
 * are past the point of delivery.
 *
 * ---------------------------------------------------------------------------
 * THE REST OF THIS STATE MACHINE, honestly (B-371 recon; named, not fixed)
 * ---------------------------------------------------------------------------
 * The enum is pending|delivered|inspecting|passed|rejected|paid (schema/subcon.ts).
 *
 *  · `inspecting` — a valid enum value that NO handler ever writes. It is accepted
 *    as an inspect SOURCE and queued by counts.ts, and the file header already
 *    admits "Wave-0 never auto-produces it". Not stuck; permanently EMPTY, and
 *    every guard in this file pays for it.
 *
 *  · `defect.recheck` — the exact mirror one level down. It is accepted as a `fix`
 *    source, but the only writer of a non-closed recheck outcome writes `open`
 *    (RECHECK_PASS_LIKE ? "closed" : "open"), so the dictionary's
 *    open→fixing→recheck→closed is really open⇄fixing→closed. An enum value no
 *    code path can produce.
 *
 *  · `passed` — A GENUINE SECOND DEAD END OF THE SAME SHAPE AS THE ONE THIS ROUND
 *    CLOSES. approve-payment requires `passed`; there is no un-pass and no
 *    re-inspect, so a mistaken pass strands the period at `passed` forever. It is
 *    NOT opened here: `paid` writes an AP billing row AND a retention HELD row, so
 *    reversing a pass is money-adjacent and needs its own ruling (filed, B-371).
 *
 *  · `paid` — terminal by design, with money behind it. Correct as-is.
 *
 *  · OPEN DEFECT ROWS ON A PASSED PERIOD — B-364, DECIDED (see the inspect(pass)
 *    handler for the full reasoning). Re-opening `rejected` made a `passed`/`paid`
 *    period with `open` defect rows reachable for the first time. The decision is
 *    ACCEPT: the pass neither closes nor requires the closure of defect rows, they
 *    keep their own open→fixing→closed loop, and the money that follows withholds
 *    retention precisely for outstanding work.
 */
const DELIVERABLE_FROM: readonly WorkPeriodRow["status"][] = ["pending", "rejected"];

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
 * The acceptance-center wire for a PM work order awaiting close (Wave-3 pm slice
 * — company-accept.jsx ACCEPT_TYPES.pm "ใบงาน PM"). Real pm_workorder columns
 * only (C10 — nothing fabricated); `type` tags the feed the fan-in came from.
 */
function pmAcceptWire(w: PmWorkOrderRow): Record<string, unknown> {
  return {
    id: w.id,
    type: "pm",
    asset_id: w.assetId,
    tech: w.tech,
    template_id: w.templateId,
    checkin_gps: w.checkinGps,
  };
}

/**
 * The acceptance-center wire for a goods receipt in the return/defect queue
 * (Wave-3 gr slice — company-accept.jsx ACCEPT_TYPES.gr "รับของเข้าคลัง (GR)").
 * Real gr columns only; received/rejected are the receipt totals (gr.ts GAP-1).
 */
function grAcceptWire(g: GrRow): Record<string, unknown> {
  return {
    id: g.id,
    type: "gr",
    no: g.no,
    po_id: g.poId,
    wo_id: g.woId,
    received: Number(g.received),
    rejected: Number(g.rejected),
    status: g.status,
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

// ---------------------------------------------------------------------------
// META-1 (P2-BE-43) display-enrichment loaders — every read is tenant-scoped
// (db.select on projects, which carries company_id; db.selectThrough for the
// parent-FK-scoped tables). Each returns a plain id→value Map the pure enrich*
// composers below spread onto a wire. A row absent from a map resolves to an
// HONEST null (C10 — never fabricated).
// ---------------------------------------------------------------------------

/** project id → display name. projects carries company_id → plain scoped read. */
async function loadProjectNames(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.select(projects);
  return new Map(rows.map((p) => [p.id, p.name]));
}

/** subcon contract id → the row (source of `no` + `project_id` for period/house). */
async function loadContractsById(db: TenantDb): Promise<Map<string, SubconContractRow>> {
  const rows = await db.selectThrough(subconContracts, CONTRACT_HOPS);
  return new Map(rows.map((c) => [c.id, c]));
}

/**
 * period id → the defect item strings recorded on that period's acceptance. Two
 * scoped reads: acceptances (period link) then defects (item text), joined in
 * JS via acceptance_id → period_id. Only periods that actually carry a defect
 * appear; every other period resolves to an HONEST null at the call site.
 */
async function loadDefectsByPeriod(db: TenantDb): Promise<Map<string, string[]>> {
  const accs = await db.selectThrough(acceptances, ACCEPTANCE_HOPS);
  const periodByAcceptance = new Map(accs.map((a) => [a.id, a.periodId]));
  const defs = await db.selectThrough(defects, DEFECT_HOPS);
  const byPeriod = new Map<string, string[]>();
  for (const d of defs) {
    const periodId = periodByAcceptance.get(d.acceptanceId);
    if (!periodId) continue; // acceptance not in this tenant's set → skip honestly
    const list = byPeriod.get(periodId) ?? [];
    list.push(d.item);
    byPeriod.set(periodId, list);
  }
  return byPeriod;
}

/** pm_asset id → the row (source of name/kind for title + contract_id for project). */
async function loadPmAssetsById(db: TenantDb): Promise<Map<string, PmAssetRow>> {
  const rows = await db.selectThrough(pmAssets, PM_ASSET_HOPS);
  return new Map(rows.map((a) => [a.id, a]));
}

/** pm_contract id → its project id (the pm slice's project_name anchor). */
async function loadPmContractProjects(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.selectThrough(pmContracts, PM_CONTRACT_HOPS);
  return new Map(rows.map((c) => [c.id, c.projectId]));
}

/** po id → its pr id (nullable pr link dropped honestly). */
async function loadPoPr(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.selectThrough(pos, PO_PR_HOPS);
  const m = new Map<string, string>();
  for (const p of rows) if (p.prId) m.set(p.id, p.prId);
  return m;
}

/** wo id → its pr id (nullable pr link dropped honestly). */
async function loadWoPr(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.selectThrough(wos, WO_PR_HOPS);
  const m = new Map<string, string>();
  for (const w of rows) if (w.prId) m.set(w.id, w.prId);
  return m;
}

/** pr id → its project id (the gr slice's project_name anchor). */
async function loadPrProjects(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.selectThrough(prs, PR_HOPS);
  return new Map(rows.map((r) => [r.id, r.projectId]));
}

/**
 * Enrich a period wire (period slice + periods list) with the prototype display
 * columns that have a REAL source: project_name (contract → project), a composed
 * title (`${contract.no} · งวดที่ ${seq}`), and the rejected-period defect items.
 * owner is honest-null — a work period has no owner column. overdue/wait_days/
 * due_text are intentionally ABSENT (no honest server source — Wei · C10). A hop
 * that does not resolve yields null; the wire never crashes on a missing parent.
 */
function enrichPeriodRow(
  p: WorkPeriodRow,
  contract: SubconContractRow | undefined,
  projName: Map<string, string>,
  defectsByPeriod: Map<string, string[]>,
): Record<string, unknown> {
  return {
    ...periodWire(p),
    project_name: contract ? projName.get(contract.projectId) ?? null : null,
    // title = the contract's DOC NUMBER only (data, like the gr slice) — NOT a
    // composed UI string. The prototype shows "<no> · งวดที่ <seq>", but "งวดที่"
    // is UI copy with no i18n key, so it is NOT invented on the server (§0 rule 2 /
    // B-116). The wire already carries `seq`, so the FE composes the localized
    // ordinal ("งวดที่ {n}") client-side around this doc number.
    title: contract?.no ?? null,
    owner: null,
    defect: defectsByPeriod.get(p.id) ?? null,
  };
}

/** Enrich a handover (house) wire — the same period sources as enrichPeriodRow
 *  minus defect (a handover carries no defect column), keeping the type tag. */
function enrichHouseRow(
  p: WorkPeriodRow,
  contract: SubconContractRow | undefined,
  projName: Map<string, string>,
): Record<string, unknown> {
  return {
    ...periodWire(p),
    type: "house",
    project_name: contract ? projName.get(contract.projectId) ?? null : null,
    // Doc-number only (data) — the "งวดที่" ordinal has no i18n key, composed FE-side
    // from the wire's `seq` (§0 rule 2 / B-116). Same rule as enrichPeriodRow.
    title: contract?.no ?? null,
    owner: null,
  };
}

/** Enrich a pm work-order wire: project_name (asset → contract → project), a
 *  composed title (`${asset.name ?? asset.kind} · ${asset.kind}`), and owner =
 *  the REAL pm_workorder.tech. */
function enrichPmRow(
  w: PmWorkOrderRow,
  asset: PmAssetRow | undefined,
  pmContractProjects: Map<string, string>,
  projName: Map<string, string>,
): Record<string, unknown> {
  const projectId = asset ? pmContractProjects.get(asset.contractId) : undefined;
  return {
    ...pmAcceptWire(w),
    project_name: projectId ? projName.get(projectId) ?? null : null,
    title: asset ? `${asset.name ?? asset.kind} · ${asset.kind}` : null,
    owner: w.tech,
  };
}

/** Enrich a gr wire: project_name via whichever of po/wo resolves to a pr →
 *  project, title = the real gr `no` (null when unset), owner honest-null. */
function enrichGrRow(
  g: GrRow,
  poPr: Map<string, string>,
  woPr: Map<string, string>,
  prProjects: Map<string, string>,
  projName: Map<string, string>,
): Record<string, unknown> {
  const prId = (g.poId ? poPr.get(g.poId) : undefined) ?? (g.woId ? woPr.get(g.woId) : undefined);
  const projectId = prId ? prProjects.get(prId) : undefined;
  return {
    ...grAcceptWire(g),
    project_name: projectId ? projName.get(projectId) ?? null : null,
    title: g.no,
    owner: null,
  };
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
    // B-323: selectThrough = INNER JOIN with no ORDER BY — total-order the list.
    const rows = await db.selectThrough(subconContracts, CONTRACT_HOPS);
    return reply.code(200).send(listEnvelope(newestFirst(rows).map(contractWire)));
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
    // B-380: creating a contract fixes `value` and `retention_pct` — the two
    // operands every later payment is computed from. FIRST statement after the
    // tenant check, ahead of every parse and read, so an unauthorized caller
    // cannot probe this door.
    if (!(await requireSubcon(request, reply, "create"))) return reply;

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
    // B-323: same work_period.seq as wo.ts — no unique constraint, and `NOT NULL
    // DEFAULT 0`, so periods written without an explicit seq all tie at 0.
    const sorted = [...rows].sort((a, b) => a.seq - b.seq || byIdAsc(a, b));
    // META-1 enrichment: project_name (this contract → project) + composed title +
    // the rejected-period defect items. The defect reads run only when a period is
    // actually rejected (otherwise there is nothing honest to surface).
    const projName = await loadProjectNames(db);
    const defectsByPeriod = sorted.some((p) => p.status === "rejected")
      ? await loadDefectsByPeriod(db)
      : new Map<string, string[]>();
    const enriched = sorted.map((p) => enrichPeriodRow(p, contract, projName, defectsByPeriod));
    return reply.code(200).send(listEnvelope(enriched));
  });

  // POST /periods/:id/deliver — the contractor delivers a period + its docs/photos
  // (flows.html L46 "ผู้รับเหมาส่งมอบ + เอกสาร/รูป (เข้า DMS)"). pending → delivered;
  // upsert the period's single acceptance with {docs, photos}. Both writes are
  // one transaction (the acceptance write must land with the status flip).
  //
  // ---------------------------------------------------------------------------
  // B-371 — `rejected` IS NOW A SOURCE HERE, and that is the whole fix
  // ---------------------------------------------------------------------------
  // Every work_period.status write in this file is at :deliver / :inspect(pass) /
  // :inspect(reject) / :approve-payment. Exactly one of them wrote `rejected` and
  // NOTHING left it: a period the foreman turned back could never be re-inspected,
  // so its money never reached AP and the contractor's fixed work had no door back
  // in. That is a dead end, not a terminal state.
  //
  // WHY THIS DOOR RATHER THAN A NEW `POST /periods/{id}/reinspect`:
  //   · the PROTOTYPE says the target is the awaiting-inspection state, literally.
  //     pototype/subcon-accept2.jsx:106 — the rejected row's button sets
  //     `{state: "requested", inspectCount: +1}` — and `requested` is the display
  //     state that maps to wire `delivered|inspecting`
  //     (apps/web subcon-accept-rows.ts). flows.html FLOW-B is the same loop:
  //     ตีกลับ + Defect List → ผู้รับเหมาแก้ไข → ตรวจซ้ำ → ผ่าน.
  //   · deliver's own meaning ALREADY covers it — "the contractor delivers a
  //     period + its docs/photos" is exactly what a post-fix resubmission is, and
  //     its acceptance UPSERT branch below was written for "a row already exists",
  //     which is precisely the rejected case (a reject always ensures one).
  //   · it needs NO contract change (`grep reinspect packages/contracts` = 0 hits;
  //     the only three declared period ops are deliver / inspect / approve-payment)
  //     and NO new enum value, i.e. no SACRED edit in either file. Minting
  //     `/reinspect` would need both a new operationId and Wei.
  //
  // THE TRADE, stated: `deliver` now carries two meanings on one door, and the
  // response cannot distinguish a first delivery from a re-delivery. If a screen
  // needs that distinction it is a WIRE FIELD, not a second endpoint.
  //
  // NOT DELIVERABLE, and not faked: the prototype's "ขอตรวจซ้ำ · ครั้งที่ N"
  // counter (subcon-accept2.jsx:98). `work_period` has no such column, `acceptance`
  // is one row per period, and defect rows do not correspond 1:1 to inspection
  // rounds. A column is a migration → SACRED. It is NOT derived from audit_log.
  //
  // TWO LANES INHERIT THIS and are untouchable from here:
  //   · apps/web subcon-accept.tsx:618 — the "ขอตรวจซ้ำ" button already exists and
  //     is `disabled` with a FLAG naming this exact gap. It stays dark until the
  //     web lane un-disables it; the backend lands alone.
  //   · apps/mobile fm_accept_agg.dart hard-codes the terminality as a PREMISE
  //     ("`rejected` is a TERMINAL state … there is no transition OUT of
  //     `rejected`") and withholds an affordance because of it. That reasoning is
  //     now outlived and must be REVISED, not silently left standing.
  app.post("/periods/:id/deliver", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    // B-380: records the contractor's submission against an existing period
    // (flows.html L46). Its live caller is the mobile field-progress screen.
    if (!(await requireSubcon(request, reply, "edit"))) return reply;

    const { id } = request.params as { id: string };
    const resolved = await resolvePeriod(db, id);
    if (!resolved) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `work period ${id} not found` });
    }
    // C3 guard: a not-yet-delivered (pending) period, or — B-371 — one the foreman
    // turned back (rejected), which is the contractor re-submitting after the fix.
    // Everything else is still 409: a delivered/inspecting period is already with
    // the foreman, and passed/paid are past the point of delivery.
    if (!DELIVERABLE_FROM.includes(resolved.period.status)) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending or rejected work period can be delivered",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const docs = strArray(pick(body, "docs"));
    const photos = strArray(pick(body, "photos"));
    const projectId = resolved.contract.projectId;
    const existing = await findAcceptance(db, id);

    let result: { acc: AcceptanceRow; period: WorkPeriodRow };
    try {
      result = await db.transaction(async (tx) => {
        // Upsert the acceptance (one per period): update the existing row's
        // docs/photos, else create it — both scoped through the period chain.
        // B-371: the UPDATE branch is the one a re-delivery takes — a rejected
        // period always has an acceptance (the reject handler ensures one so its
        // Defect List has something to hang off), so a resubmission refreshes the
        // docs/photos it already had rather than creating a second row.
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
        // B-371 + B-149: the deliverable pre-state is folded into the FINAL UPDATE
        // (5th arg), not left in the JS pre-check above. updateThroughChain resolves
        // then updates in two round-trips, so a guard only in the resolve `where`
        // is a TOCTOU. It matters more now than it did: before this round the only
        // source was `pending`, which nothing else raced; `rejected` is produced by
        // the inspect handler, so a re-delivery and a concurrent inspect can now
        // both be in flight over one period. The loser matches 0 rows → the whole
        // transaction (acceptance write included) rolls back → 409.
        const [period] = await tx.updateThroughChain(
          workPeriods,
          PERIOD_HOPS,
          { status: "delivered" },
          and(eq(workPeriods.id, id), inArray(workPeriods.status, DELIVERABLE_FROM)),
          inArray(workPeriods.status, DELIVERABLE_FROM),
        );
        if (!period) {
          throw new StaleStateError(
            "only a pending or rejected work period can be delivered",
          );
        }
        return { acc, period };
      });
    } catch (err) {
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
      }
      throw err;
    }

    return reply
      .code(200)
      .send({ ...periodWire(result.period), acceptance: acceptanceWire(result.acc) });
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
    // B-380: the on-site inspection — flows.html MATRIX "รับงวดงาน (ตรวจรับ)" col 1
    // โฟร์แมน, FUNCTIONS.md:108 the foreman's mobile. NOT `approve`: the MATRIX
    // holds the inspection and the payment approval in two different columns.
    if (!(await requireSubcon(request, reply, "edit"))) return reply;

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
    //
    // -----------------------------------------------------------------------
    // B-364 — A PASS WITH OPEN DEFECT ROWS. DECIDED: ACCEPT, and here is why.
    // -----------------------------------------------------------------------
    // B-371 made this state reachable for the first time. Before it, `rejected` was
    // a dead end, so the only way to a `passed` period was a first inspection that
    // never recorded a defect. Now: reject a period with 2 defects (both `open`) →
    // re-deliver → inspect(pass) → the period is `passed` with `open,open` still
    // hanging off its acceptance, and approve-payment will write AP billing plus a
    // retention HELD row off exactly that period. Verified live on the seeded stack,
    // not reasoned about.
    //
    // THE THREE COHERENT ANSWERS WERE: require closure (409 until every defect is
    // closed), reset them on re-delivery, or accept. ACCEPT, because:
    //
    //  1. THE PROTOTYPE DOES THIS, literally. subcon-accept2.jsx:106 — the rejected
    //     row's "ขอตรวจซ้ำ" button sets `{state: "requested", inspectCount: +1}` and
    //     TOUCHES NOTHING ELSE; the period keeps its `defect` text. AcceptForm's
    //     accept is gated on `failN === 0` over THAT round's checklist (in-form
    //     state), never on stored defect rows. A pass with recorded defects is what
    //     the mock does, and pototype is law (PLAN.md §0).
    //  2. THE DEFECT LOOP HAS ITS OWN DOOR. flows.html FLOW-B closes a defect on ITS
    //     OWN recheck — "ตรวจซ้ำ → ผ่าน (Defect ปิด)" = POST /defects/{id}/recheck —
    //     not on the period's pass. Two loops by design, at different granularities
    //     (defect rows are not 1:1 with inspection rounds).
    //  3. RESETTING OR AUTO-CLOSING THEM WOULD DESTROY THE RECORD. The Defect List is
    //     what was wrong, with before/after photos; rewriting it as a side effect of
    //     an unrelated pass is a data write nothing asked for (C10).
    //  4. REQUIRING CLOSURE WOULD BE A NEW REFUSAL, i.e. a spec decision. It would
    //     strand every period whose defects were fixed in the field without anyone
    //     driving the per-defect recheck endpoint — and that endpoint is reachable
    //     from no shipped screen today.
    //  5. THE DOMAIN ALREADY CARRIES THE MONEY ANSWER. approve-payment withholds
    //     `contract.retention_pct` as a retention HELD row (เงินประกันผลงาน) — money
    //     kept back precisely to cover outstanding work. Accepting the pass does not
    //     pay out the defect risk; it holds it.
    //
    // WHAT IS THEREFORE TRUE AND IS NOT HIDDEN: a `passed` (and later `paid`) period
    // can carry `open` defect rows, and once it leaves `delivered|inspecting|rejected`
    // it also leaves the acceptance-centre queue, so those defects are visible only
    // through the defect list itself. That is the accepted cost of this decision, not
    // an oversight, and reversing it is a ruling (B-364) rather than an
    // implementer's call. The behaviour is pinned by a test so it cannot drift
    // silently in either direction.
    if (result === "pass") {
      const siblings = await db.selectThrough(
        workPeriods,
        PERIOD_HOPS,
        eq(workPeriods.contractId, resolved.contract.id),
      );
      const warning = progressWarning(resolved.period, siblings);
      // B-149 optimistic guard: the inspectable pre-state re-applied to the FINAL
      // UPDATE (5th arg) — updateThroughChain resolves then updates in two round-
      // trips, so a guard only in the resolve `where` (4th arg) would NOT be atomic.
      // A concurrent pass/reject that already moved this period re-matches 0 rows → 409.
      const [period] = await db.updateThroughChain(
        workPeriods,
        PERIOD_HOPS,
        { status: "passed" },
        and(eq(workPeriods.id, id), inArray(workPeriods.status, ["delivered", "inspecting"])),
        inArray(workPeriods.status, ["delivered", "inspecting"]),
      );
      if (!period) {
        return reply.code(409).send({
          code: "INVALID_STATE",
          message: "only a delivered work period can be inspected",
        });
      }
      return reply.code(200).send({ ...periodWire(period), warning });
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
    try {
      const { period, createdDefects } = await db.transaction(async (tx) => {
        // B-149 optimistic guard: the inspectable pre-state re-applied to the FINAL
        // UPDATE (5th arg, not just the resolve `where`) so it is atomic. A concurrent
        // pass/reject that already moved this period re-matches 0 rows → throw (roll
        // back the reject + its defects) → 409.
        const [period] = await tx.updateThroughChain(
          workPeriods,
          PERIOD_HOPS,
          { status: "rejected" },
          and(eq(workPeriods.id, id), inArray(workPeriods.status, ["delivered", "inspecting"])),
          inArray(workPeriods.status, ["delivered", "inspecting"]),
        );
        if (!period) {
          throw new StaleStateError("only a delivered work period can be inspected");
        }
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
        return { period, createdDefects };
      });

      // A reject is not an acceptance, so the out-of-sequence advisory does not
      // apply — warning is honestly null (the reject always proceeds regardless).
      return reply.code(200).send({
        ...periodWire(period),
        defects: createdDefects.map(defectWire),
        warning: null,
      });
    } catch (err) {
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
      }
      throw err;
    }
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
    // B-380: THE MONEY DOOR — it writes the ap_billing, the retention hold and the
    // `paid` flip. `approve` on subcon is the Director's alone in the seeded
    // matrix. See the conflict noted above requireSubcon: flows.html names
    // ผจก.โครงการ here and the matrix does not give the PM the right; this takes
    // the fail-closed side and reports it.
    if (!(await requireSubcon(request, reply, "approve"))) return reply;

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
    try {
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
        // B-149 optimistic guard — the passed pre-state re-applied to the FINAL
        // UPDATE (5th arg). CRITICAL: updateThroughChain resolves (SELECT) then updates
        // in two round-trips, so the guard MUST be on the UPDATE itself, not only the
        // resolve `where` — otherwise under READ COMMITTED the loser's UPDATE re-checks
        // only `id IN (ids)` (EPQ), still matches the now-`paid` row, and commits a
        // SECOND ap_billing (double payment). With the guard on the UPDATE the loser
        // re-matches `id AND status='passed'` → 0 rows → throw → rolls back this call's
        // AP billing + retention. No unique index covers this post; THIS is the sole
        // race backstop.
        const [advanced] = await tx.updateThroughChain(
          workPeriods,
          PERIOD_HOPS,
          { status: "paid" },
          and(eq(workPeriods.id, id), eq(workPeriods.status, "passed")),
          eq(workPeriods.status, "passed"),
        );
        if (!advanced) {
          throw new StaleStateError(
            "only a passed (inspected) work period can be approved for payment",
          );
        }
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
    } catch (err) {
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
      }
      throw err;
    }
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
    // B-380: flows.html L47 "ผู้รับเหมาแก้ไข" — recorded on site against a defect.
    if (!(await requireSubcon(request, reply, "edit"))) return reply;

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
    // B-380: flows.html L47 "ตรวจซ้ำ" — the foreman act, one level down the tree.
    if (!(await requireSubcon(request, reply, "edit"))) return reply;

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

  // GET /acceptance-center — the acceptance center (ศูนย์ตรวจรับ; company-accept.jsx
  // AcceptanceCenter, the 4 feeds ACCEPT_TYPES subcon/gr/pm/handover). The ?type
  // selects the feed → the tenant-scoped slice; every slice returns the B-014
  // list envelope and is honest-empty when its feed has no rows (C10 — never
  // fabricated). Wave-3 (B-107e) adds the pm / house / gr slices to the Wave-0
  // period queue:
  //   period (default) — the C3 work_period queue reused from counts.ts
  //                      (delivered | inspecting | rejected), narrowed by ?status.
  //   pm               — pm_workorder awaiting close (customer_sign IS NULL),
  //                      mirroring counts.ts countPmOpen.
  //   house            — the HANDOVER slice: the FINAL (max-seq) work period of
  //                      each contract, still awaiting (status != paid).
  //   gr               — goods receipts that need a return/defect decision
  //                      (rejected > 0). An unknown type falls through to period.
  app.get("/acceptance-center", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const type = str(pick(query, "type")).trim() || "period";

    // PM slice — pm_workorder awaiting close = unsigned (customer_sign IS NULL).
    // The open-PM query is imported from counts.selectOpenPmWorkOrders (the ONE
    // source of truth, shared with the pm.wo badge countPmOpen), so this feed and
    // the badge can never drift on what an open PM work order is. honest-empty when
    // every PM work order is already signed/closed.
    if (type === "pm") {
      const rows = await selectOpenPmWorkOrders(db);
      // META-1 enrichment: project_name (asset → contract → project), a composed
      // title (asset name/kind), owner = the REAL tech. Every read is scoped.
      const [assetById, pmContractProjects, projName] = await Promise.all([
        loadPmAssetsById(db),
        loadPmContractProjects(db),
        loadProjectNames(db),
      ]);
      return reply
        .code(200)
        .send(
          listEnvelope(
            rows.map((w) => enrichPmRow(w, assetById.get(w.assetId), pmContractProjects, projName)),
          ),
        );
    }

    // HOUSE slice — the handover queue. Wei C-150e: "house = handover = งวดสุดท้าย",
    // so a handover is the FINAL work period of a contract = the highest-`seq`
    // period per contract. Read the tenant's periods scoped through the period
    // hop chain, group by contract in JS, keep each contract's max-seq row, and
    // surface only those still AWAITING (status != paid — a handed-over-and-paid
    // period is done). honest-empty when no contract has an awaiting final period.
    if (type === "house") {
      const all = await db.selectThrough(workPeriods, PERIOD_HOPS);
      const finalByContract = new Map<string, WorkPeriodRow>();
      for (const p of all) {
        const current = finalByContract.get(p.contractId);
        if (!current || p.seq > current.seq) finalByContract.set(p.contractId, p);
      }
      // B-323: `finalByContract` is a Map whose INSERTION order is the join plan's
      // (first-seen contract wins the slot), so the values() sequence inherits it.
      // Total-order the surviving queue instead of trusting that traversal.
      const awaiting = newestFirst(
        [...finalByContract.values()].filter((p) => p.status !== "paid"),
      );
      // META-1 enrichment: project_name (contract → project) + composed title.
      // A handover carries no owner/defect column → owner honest-null, no defect key.
      const [contractById, projName] = await Promise.all([
        loadContractsById(db),
        loadProjectNames(db),
      ]);
      const handovers = awaiting.map((p) => enrichHouseRow(p, contractById.get(p.contractId), projName));
      return reply.code(200).send(listEnvelope(handovers));
    }

    // GR slice — the goods-receipt acceptance queue. GR inspection happens AT
    // RECEIPT (qty_ok / qty_rejected are recorded on create — gr.ts), so there
    // is NO "pending-inspection" gr status; the honest "needs an acceptance /
    // return decision" slice = receipts carrying a rejected quantity (rejected >
    // 0 = a return/defect situation, the prototype's rejected gr items
    // "ของเสียหายเกินเกณฑ์"). A gr anchors on EITHER a po or a wo, so the two
    // scoped chains (gr.ts GR_PO_HOPS / GR_WO_HOPS) are UNIONed and deduped by id.
    // The "awaiting" semantics collapse to rejected>0 here — flagged for Wei
    // confirm in B-113. honest-empty when no receipt carries a rejected quantity.
    if (type === "gr") {
      const [poGrs, woGrs] = await Promise.all([
        db.selectThrough(grs, GR_PO_HOPS),
        db.selectThrough(grs, GR_WO_HOPS),
      ]);
      const byId = new Map<string, GrRow>();
      for (const g of [...poGrs, ...woGrs]) byId.set(g.id, g);
      // B-323: same Map-insertion-order dependency as the house slice, doubled — the
      // two GR chains are separate INNER-JOIN reads concatenated before de-duping.
      const rejects = newestFirst([...byId.values()].filter((g) => Number(g.rejected) > 0));
      // META-1 enrichment: project_name via whichever of po/wo resolves to a pr →
      // project, title = the real gr `no`. Every resolve read is tenant-scoped.
      const [poPr, woPr, prProjects, projName] = await Promise.all([
        loadPoPr(db),
        loadWoPr(db),
        loadPrProjects(db),
        loadProjectNames(db),
      ]);
      return reply
        .code(200)
        .send(listEnvelope(rejects.map((g) => enrichGrRow(g, poPr, woPr, prProjects, projName))));
    }

    // PERIOD slice (default; an unknown type also lands here — matching the
    // Wave-0 handler shape).
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
    // META-1 enrichment: project_name (contract → project) + composed title +
    // the rejected-period defect items (defect reads only when a period rejects).
    const [contractById, projName] = await Promise.all([
      loadContractsById(db),
      loadProjectNames(db),
    ]);
    const defectsByPeriod = rows.some((p) => p.status === "rejected")
      ? await loadDefectsByPeriod(db)
      : new Map<string, string[]>();
    // B-323: `rows` is a selectThrough (INNER JOIN, no ORDER BY) — total-order it.
    const enriched = newestFirst(rows).map((p) =>
      enrichPeriodRow(p, contractById.get(p.contractId), projName, defectsByPeriod),
    );
    return reply.code(200).send(listEnvelope(enriched));
  });
}
