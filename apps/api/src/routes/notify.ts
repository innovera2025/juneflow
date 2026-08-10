// The notification EMITTER — the only place in apps/api that writes a
// `notification` row (B-347).
//
// ---------------------------------------------------------------------------
// WHAT WAS MISSING, and what was NOT
// ---------------------------------------------------------------------------
// The table has existed since migration 0002; GET /notifications and
// POST /notifications/{id}/read have existed since the FLOW-A data-completeness
// wave; the seed writes 22 rows. `insert(notifications` resolved to exactly ONE
// production site — packages/db/src/seed/index.ts:1844 — plus two stamp tests.
// Nothing in apps/api had ever written one, so the bell only ever showed seed
// data and no real event could reach it.
//
// The hard part was never the INSERT. It is deciding WHO RECEIVES WHAT, and
// `notification.user_id` is NOT NULL (packages/db/src/schema/misc.ts) — every
// row needs one concrete user, so a "role broadcast" has to be MATERIALISED as
// N rows against real user ids. An event whose recipient cannot be resolved from
// the schema therefore cannot be emitted at all, and the answer to that is to
// emit nothing and say so, not to invent an addressee.
//
// ---------------------------------------------------------------------------
// WHAT THIS EMITS — two events, both PR, both spec-backed
// ---------------------------------------------------------------------------
//  1. pr.submitted  → every user whose role.approval_level reaches the tier the
//                     PR's amount demands.  type "approval", ref "pr:<uuid>".
//     Backed by: flows.html MATRIX (the PR approval ladder), the prototype bell
//     (chrome.jsx NOTIFS[0] "PR-2026-0418 รออนุมัติชั้น 2") and the notification
//     centre (extra-screens.jsx NOTIFS[1] "PR-2026-0418 รออนุมัติ (1.84 ลบ.)").
//     The recipient set is derived by the SAME rule dashboard.ts approvalsInbox
//     uses to decide whether a doc appears in a caller's pull inbox
//     (level >= requiredApprovalLevel(amount)), so the push and the pull can
//     never disagree about who an approver is.
//
//  2. pr.approved / pr.rejected → pr.requester_id.  type "info", ref "pr:<uuid>".
//     `pr.requester_id` is a real FK to `user` (packages/db/src/schema/boq.ts).
//     It is NULLABLE and the seed leaves it null, so a PR with no recorded
//     requester emits NOTHING rather than guessing (the creator is not recorded
//     anywhere else — there is no created_by column).
//
// HONEST NOTE ON WHAT (1) BUYS. The approvals PULL inbox already works and is
// the approver's own query, so this push adds a BADGE, not a capability. It
// ships because the bell is specified, not because it unlocks an action.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY EMITS NOTHING FOR — recipient unresolvable
// ---------------------------------------------------------------------------
// Checked against the schema, not assumed. Each of these is a real prototype /
// flows.html notification with NO addressable user behind it:
//
//  · GR ตีกลับ → the VENDOR.  `vendor` (packages/db/src/schema/project.ts) has
//    name/code/tax_id/kind/credit_term/addr/bank/status and NO user FK, no
//    email, no contact — there is no vendor portal login anywhere in the repo.
//    AND flows.html does not actually ask for it: FLOW-A routes a rejection into
//    "DMS + ศูนย์ตรวจรับ → ผู้ขายส่งใหม่", with no notification specified. So
//    there is neither a recipient nor a requirement.
//
//  · subcon reject → the FOREMAN / the EXECUTIVE (flows.html FLOW-B, the ONE
//    place the doc names notification recipients: "ศูนย์แจ้งเตือน + Mobile
//    โฟร์แมน + Dashboard ผู้บริหาร + Audit Log").  Seeded roles are
//    pm/dir/proc/site/acc/sale/wh/exec + finmgr and `user.department` is
//    CONS|PROC|FIN|SLS|ADM|WH — there is NO foreman in either. A role NAMED
//    "ผู้บริหาร / ดูได้อย่างเดียว" does exist, but role names are tenant-editable
//    through POST/PUT /roles and its approval_level is 0, so neither its name nor
//    its tier is a stable identity to fan out on.
//
//  · PM contract near-expiry · PM work-order overdue · acceptance SLA breach ·
//    dunning · BOQ over-budget · land DD passed · sales close · AP raised from a
//    PM contract · SAP sync.  These are the remaining prototype centre/bell rows
//    (extra-screens.jsx NOTIFS, chrome.jsx NOTIFS) and NO recipient is named for
//    any of them anywhere.
//
//    A SECOND, INDEPENDENT blocker applies to every TIME-BASED one of those
//    (expiry / due / SLA / dunning): they need a scheduler, and
//    apps/api/src/worker.ts throws NOT_IMPLEMENTED for all four queues including
//    `notification`. Even with a resolvable recipient none of them could fire
//    today. Recorded here so the recipient question is not re-litigated as if it
//    were the only obstacle.
//
//  · the four CUSTOMER events (certificate issued, quotation approve/reject,
//    after-sales repair) — flows.html routes all of them over LINE, not this
//    table, and `customer` carries no user link either.
//
// ---------------------------------------------------------------------------
// CONSTRAINTS ON WHAT MAY BE WRITTEN — the readers are already shipped
// ---------------------------------------------------------------------------
//  · `type` must stay inside approval|alert|info or the row degrades to a
//    neutral bell (apps/web notifications-agg.ts notifIconTone; mobile
//    notif_agg.dart NotifKind.other). Both events here do.
//  · `ref` is "<module>:<uuid>"; only pr|po|wo|gr|boq|ap are clickable in the web
//    (notifications-agg.ts REF_ROUTE). Both events here use `pr:`.
//  · ORDER. GET /notifications had NO ordering at all before this round; see the
//    note in notifications.ts. That fix is a PRECONDITION of this file, not a
//    follow-up — the first real writer is what makes the absence observable.
//
// FLAGGED, NOT FIXED: `notification` is indexed on company_id only (misc.ts), so
// the user_id filter in GET /notifications is an in-tenant scan, and the bell
// fetches the whole unpaginated list on every shell load. A user_id index is a
// migration → SACRED → out of scope for this round.
import { eq } from "drizzle-orm";
import { notifications, roles, users } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

/** The notification kinds the shipped readers render (web notifIconTone / mobile NotifKind). */
export type NotificationType = "approval" | "alert" | "info";

/**
 * Users of this tenant whose role.approval_level reaches `level`, i.e. the people
 * who could actually give the approval — the SAME predicate dashboard.ts
 * approvalsInbox applies to decide whether a pending doc shows up in a caller's
 * inbox, so the push notification and the pull inbox address the same set.
 *
 * `blocked` users are excluded: a blocked account cannot log in, so it cannot
 * approve, so it is not an approver. Nothing is lost by the exclusion — the pull
 * inbox still carries the doc the moment the account is unblocked. `invited`
 * users are INCLUDED (they hold the seat and will see the row when they redeem
 * the invite).
 *
 * Both `user` and `role` carry their own company_id, so both reads go through the
 * scoped select() door — a fan-out can never reach another tenant.
 */
async function approverIdsAtLevel(db: TenantDb, level: number): Promise<string[]> {
  const [roleRows, userRows] = await Promise.all([
    db.select(roles),
    db.select(users),
  ]);
  const qualified = new Set(
    roleRows.filter((r) => (r.approvalLevel ?? 0) >= level).map((r) => r.id),
  );
  return userRows
    .filter((u) => u.status !== "blocked" && u.roleId != null && qualified.has(u.roleId))
    .map((u) => u.id);
}

/**
 * Write one notification per recipient (de-duplicated, tenant-scoped).
 *
 * `notification` carries company_id, so insert() force-sets it to this tenant;
 * user ids are only ever supplied by the resolvers above, which read through the
 * same scoped door. There is no bulk door on TenantDb, so this is a loop — the
 * same shape gr.ts / inventory.ts use for their scoped child inserts.
 */
async function emit(
  db: TenantDb,
  recipients: readonly string[],
  type: NotificationType,
  ref: string,
): Promise<number> {
  const unique = [...new Set(recipients)];
  for (const userId of unique) {
    await db.insert(notifications, { userId, type, ref }).returning();
  }
  return unique.length;
}

/**
 * A PR entered the approval queue → tell the tier that must sign it off.
 *
 * `requiredLevel` is passed in rather than computed here so the caller uses its
 * OWN tier function (pr.ts's 500K/2M matrix), which is the one its approve
 * handler enforces. A single source of truth per doc kind; this module never
 * decides a threshold.
 *
 * Returns the number of rows written (0 when the tenant has no qualifying,
 * non-blocked user — an honest empty fan-out, not an error).
 */
export async function notifyPrSubmitted(
  db: TenantDb,
  prId: string,
  requiredLevel: number,
): Promise<number> {
  const recipients = await approverIdsAtLevel(db, requiredLevel);
  return emit(db, recipients, "approval", `pr:${prId}`);
}

/**
 * A PR was approved or rejected → tell the requester, and ONLY the requester.
 *
 * `requesterId` is `pr.requester_id`, a nullable FK. Null → nothing is emitted
 * and 0 is returned: there is no other column recording who raised the PR, so
 * the alternative would be inventing one.
 *
 * NOT extended to PO/WO: neither table has a requester column
 * (packages/db/src/schema/boq.ts), so the same event there has no addressee.
 */
export async function notifyPrDecided(
  db: TenantDb,
  prId: string,
  requesterId: string | null,
): Promise<number> {
  if (!requesterId) return 0;
  return emit(db, [requesterId], "info", `pr:${prId}`);
}

/**
 * Run an emission BEST-EFFORT: never throw, never change the caller's answer.
 *
 * WHY THE BELL IS NOT IN THE TRANSACTION. The event these accompany is a
 * workflow state flip that has already committed. If a notification insert
 * failed and that failure propagated, the client would see a 500 for a submit /
 * approval that really happened, and sync_processor.dart DEFERS a 5xx and stops
 * the drain — so a failed bell would wedge a phone's whole offline queue over a
 * badge. Retrying would then hit the state guard and answer 409 for work that
 * was done.
 *
 * The cost is stated plainly: a notification can be LOST while the state change
 * stands. That is the right way round, because the pull inbox
 * (GET /dashboard/approvals-inbox) is the authority on what awaits approval and
 * is unaffected — this table is a badge over it, not the record.
 *
 * The failure is LOGGED, never swallowed silently.
 */
export async function bestEffortNotify(
  log: { error: (obj: unknown, msg?: string) => void },
  what: string,
  run: () => Promise<number>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.error({ err, event: what }, "notification emit failed (state change stands)");
  }
}
