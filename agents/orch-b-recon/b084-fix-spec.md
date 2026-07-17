# B-084 — Ready-to-Apply Fix Spec (FLOW-A per-mutation authz gap)

**For:** orch-A (backend zone), to execute in **one pass** the instant Wei picks an option.
**From:** orch-B recon. **Date:** 2026-07-17. **Read-only spec — no code touched here.**
**Deepens:** `b084-mutation-authz-matrix.md` (27 mutations · 8 UNGATED · 12 STATUS-ONLY · worst = `POST /po/:id/variation-order`).

Wei picks ONE of: **A** (full per-action perms) · **B** (money-only) · **C** (variation-order-specific).
Option **C hardening is baked into A and B** (the VO handler is the worst gap regardless), and is
also offered standalone. Every proposed edit cites `file:line` against the code as read today.

> **Sacred-file note:** ALL edits are inside `apps/api/src/routes/*.ts` (backend zone). **No
> `openapi.yaml`, no migration, no schema change** — the `role.perms` 11×5 matrix and
> `role.approvalLevel` ladder already exist. 403 on a gated mutation is an undocumented status the
> same way the existing 403/409s already are (flat `{code,message}` Error envelope) — consistent
> with the header GAPs each route already flags.

---

## §0 · The shared gate primitives (add ONCE, then reuse)

Two mechanisms already exist and are the ONLY things these gates reuse (invent no new policy — the
same principle the B-082 **F1** fix used):

1. **Perms matrix** — `apps/api/src/routes/authz.ts`
   - `loadCaller(request)` → `{ userId, roleId, approvalLevel, perms }` or `null` (fail-closed:
     no session / no dictionary row / no role → `null`).
   - `permAllowed(perms, module, right)` → `perms?.[module]?.[right] === true` (fail-closed false).
   - The working F1 call site (verbatim, `users.ts:101-107`):
     ```ts
     const caller = await loadCaller(request);
     if (!permAllowed(caller?.perms, MANAGEMENT_MODULE, "create")) {
       return reply.code(403).send({
         code: "FORBIDDEN",
         message: `requires ${MANAGEMENT_MODULE}.create permission`,
       });
     }
     ```
2. **Approval ladder** — `apps/api/src/routes/procurement.ts:37-66` (`requiredApprovalLevel(amount)`,
   `requiredTierCount(amount)`, `callerApprovalLevel(request)`); PR keeps its own copy at
   `pr.ts:201-303`; BOQ its own at `boq.ts:285-295`. The 4 approve handlers already use it
   (`pr.ts:559-566`, `po.ts:351-357`, `wo.ts:361-367`, `boq.ts:819-825`).

### §0.1 · Add a `requirePerm` helper to `authz.ts` (one small addition — cuts per-handler boilerplate)

Append to `apps/api/src/routes/authz.ts` (after `grantsBeyond`, line 98). This is the ONLY new
primitive; every handler edit below is then a single 3-line call. (orch-A MAY instead inline the
F1 pattern per handler — functionally identical — but the helper keeps the diff one-line-per-route.)

```ts
import type { FastifyReply } from "fastify";

/**
 * Fail-closed per-action gate (B-084): resolve the caller's role.perms and require
 * perms[module][right]. On deny it sends the flat 403 and returns false, so a caller
 * writes `if (!(await requirePerm(request, reply, "po", "create"))) return reply;`.
 * Mirrors the B-082 F1 gate on /users + /roles — reuses the EXISTING 11×5 RBAC contract.
 */
export async function requirePerm(
  request: FastifyRequest,
  reply: FastifyReply,
  module: string,
  right: PermRight,
): Promise<boolean> {
  const caller = await loadCaller(request);
  if (!permAllowed(caller?.perms, module, right)) {
    reply.code(403).send({ code: "FORBIDDEN", message: `requires ${module}.${right} permission` });
    return false;
  }
  return true;
}
```

**Placement rule for every perms gate:** insert immediately **after** the handler's existing
`if (!db) { …401… }` guard and **before** the resource is loaded (exactly where F1 sits in
`users.ts` / `roles.ts`). Each route file that gains a gate must add `requirePerm` (and, for the
`master.*` ones, `MANAGEMENT_MODULE`) to its existing `import { … } from "./authz.js"` line — only
`users.ts` and `roles.ts` import from `authz.js` today.

---

## §1 · Module → action → required-perm mapping (the reference — orch-A does NOT re-derive)

Matrix = `role.perms[module][right]`, modules `dashboard,boq,pr,po,wo,gr,subcon,inventory,petty,finance,master`
× rights `view,create,edit,approve,cancel` (`platform.ts:69-76`; `roles.ts:49-62`).

| # | Endpoint | file:line (handler) | module.right | Verdict today | In A | In B |
|---|---|---|---|---|---|---|
| 1 | `POST /pr` | pr.ts:355 | `pr.create` | UNGATED | ✅ | ✅ |
| 2 | `POST /pr/:id/submit` | pr.ts:506 | `pr.create` | STATUS-ONLY | ✅ | — |
| 3 | `POST /pr/:id/reject` | pr.ts:593 | `pr.approve` | STATUS-ONLY | ✅ | — |
| 4 | `POST /pr/:id/approve` | pr.ts:542 | `pr.approve` (+ keep approvalLevel) | GATED-OK | ✅ (depth) | — |
| 5 | `POST /po` | po.ts:189 | `po.create` | UNGATED | ✅ | ✅ |
| 6 | `POST /po/:id/variation-order` | po.ts:419 | `po.edit` **+ §C hardening** | UNGATED ⚠️ worst | ✅ | ✅ |
| 7 | `POST /po/:id/submit` | po.ts:303 | `po.create` | STATUS-ONLY | ✅ | — |
| 8 | `POST /po/:id/reject` | po.ts:378 | `po.approve` | STATUS-ONLY | ✅ | — |
| 9 | `POST /po/:id/approve` | po.ts:335 | `po.approve` (+ keep approvalLevel) | GATED-OK | ✅ (depth) | — |
| 10 | `POST /wo` | wo.ts:195 | `wo.create` | UNGATED | ✅ | ✅ |
| 11 | `POST /wo/:id/submit` | wo.ts:314 | `wo.create` | STATUS-ONLY | ✅ | — |
| 12 | `POST /wo/:id/reject` | wo.ts:387 | `wo.approve` | STATUS-ONLY | ✅ | — |
| 13 | `POST /wo/:id/approve` | wo.ts:346 | `wo.approve` (+ keep approvalLevel) | GATED-OK | ✅ (depth) | — |
| 14 | `POST /gr` | gr.ts:267 | `gr.create` | UNGATED | ✅ | ✅ |
| 15 | `POST /gr/:id/return` | gr.ts:479 | `gr.edit` | STATUS-ONLY | ✅ | — |
| 16 | `POST /gr/:id/cancel` | gr.ts:515 | `gr.cancel` | STATUS-ONLY | ✅ | — |
| 17 | `POST /boq` | boq.ts:347 | `boq.create` | UNGATED | ✅ | ✅ |
| 18 | `POST /boq/:id/items` | boq.ts:480 | `boq.edit` | STATUS-ONLY ⚠️ | ✅ | ✅ |
| 19 | `POST /boq/:id/generate-pr` | boq.ts:609 | `pr.create` (it mints PRs) | STATUS-ONLY ⚠️ | ✅ | ✅ |
| 20 | `POST /boq/:id/submit` | boq.ts:770 | `boq.edit` | STATUS-ONLY | ✅ | — |
| 21 | `POST /boq/:id/approve` | boq.ts:803 | `boq.approve` (+ keep MD approvalLevel) | GATED-OK | ✅ (depth) | — |
| 22 | `POST /boq/:id/revise` | boq.ts:873 | `boq.edit` | STATUS-ONLY | ✅ | — |
| 23 | `POST /cost-centers` | cost-centers.ts:121 | `master.create` | UNGATED | ✅ | ✅ |
| 24 | `POST /models` | models.ts:133 | `master.create` | UNGATED | ✅ | ✅ |
| 25 | `POST /users` | users.ts:88 | `master.create` | **GATED-OK (F1)** | already | already |
| 26 | `POST /roles` | roles.ts:204 | `master.create` | **GATED-OK (F1)** | already | already |
| 27 | `PUT /roles/:id` | roles.ts:242 | `master.edit` + self-elev block | **GATED-OK (F1)** | already | already |

**Wei sub-choices baked into the table above (call out or override in the ruling):**
- **submit** = `x.create` (the requester who can create a doc can submit it). Alt: `x.edit`.
- **reject** = `x.approve` (reject is the approver's counterpart — a member should not be able to
  kill a pending doc). Alt: `x.cancel`.
- **generate-pr** = `pr.create` (it literally mints PR docs). Alt: `boq.approve`.
- **revise** = `boq.edit` (it unlocks a locked budget). Alt (stricter): `boq.approve`.

---

## §2 · OPTION A — full per-action perms (gate every mutation)

**Touches 7 handler files · 21 handlers get a new/added gate** (rows 1-24 minus the 3 already-gated
F1 handlers; the 4 approve handlers get a *defense-in-depth* perm ADDED alongside the existing
approvalLevel check).

### A.1 — the 17 plain create/workflow gates (insert the F1-pattern call after each `if(!db)` guard)

For each row below, add to the file's `./authz.js` import, then insert right after the 401 guard:

```ts
if (!(await requirePerm(request, reply, "<module>", "<right>"))) return reply;
```

| File | Handlers to gate (line · perm) |
|---|---|
| `pr.ts` | `355 pr.create` · `506 pr.create` · `593 pr.approve` |
| `po.ts` | `189 po.create` · `303 po.create` · `378 po.approve` |
| `wo.ts` | `195 wo.create` · `314 wo.create` · `387 wo.approve` |
| `gr.ts` | `267 gr.create` · `479 gr.edit` · `515 gr.cancel` |
| `boq.ts` | `347 boq.create` · `480 boq.edit` · `609 pr.create` · `770 boq.edit` · `873 boq.edit` |

**What it blocks:** a zero-perms / low-privilege tenant member can no longer create PRs/POs/WOs/GRs/
BOQs, add priced BOQ lines, mint PRs off a BOQ (GAP-2 budget-exhaustion), submit docs into the
pipeline, reject a rival's pending doc (GAP-7 denial), or reverse a receipt.

### A.2 — the 4 approve handlers: ADD the module perm, KEEP the approvalLevel ladder (defense in depth)

Insert after each approve handler's `if(!db)` guard (the existing `requiredApprovalLevel`/
`callerApprovalLevel` block at `pr.ts:559`, `po.ts:351`, `wo.ts:361`, `boq.ts:819` stays untouched):

| File:line | Add |
|---|---|
| `pr.ts:542` | `if (!(await requirePerm(request, reply, "pr", "approve"))) return reply;` |
| `po.ts:335` | `if (!(await requirePerm(request, reply, "po", "approve"))) return reply;` |
| `wo.ts:346` | `if (!(await requirePerm(request, reply, "wo", "approve"))) return reply;` |
| `boq.ts:803` | `if (!(await requirePerm(request, reply, "boq", "approve"))) return reply;` |

**What it blocks:** a caller with a high `approvalLevel` but no `x.approve` perm (a misconfigured
role) can no longer approve — the two independent signals must both pass.

### A.3 — the money-touching UNGATED (rows 6, 23, 24) — see §4 (VO) and §5 (master.* consistency), included in A.

### A.4 — variation-order (row 6): full §C hardening (perm + status + re-approval + floor). **See §4.**

---

## §3 · OPTION B — money-only (gate only the direct money/state writes; leave submit/reject/return/cancel open)

If Wei wants the workflow verbs (`submit`/`reject`/`return`/`cancel`) to stay open to every member,
gate ONLY the mutations that directly write money or budget state.

**Touches 6 handler files · 8 handlers gated** (rows 1, 5, 6, 10, 14, 17, 18, 19, 23, 24 — the
UNGATED creates + `boq/items` + `generate-pr` + the VO). Smallest blast radius; closes
GAP-1, GAP-2, GAP-3, GAP-5, GAP-6, GAP-8.

| File:line · perm | What it blocks |
|---|---|
| `pr.ts:355 pr.create` | unauthorized PR creation (GAP-8) |
| `po.ts:189 po.create` | unauthorized PO money-commitment (GAP-5) |
| `po.ts:419 po.edit` **+ §4 hardening** | the VO money rewrite + tier-downgrade bypass (GAP-1) |
| `wo.ts:195 wo.create` | unauthorized WO + arbitrary `retention_pct` (GAP-5) |
| `gr.ts:267 gr.create` | force-close a PO/WO + manufacture defect reports (GAP-6) |
| `boq.ts:347 boq.create` | unauthorized BOQ creation |
| `boq.ts:480 boq.edit` | poisoning the budget baseline (GAP-3) |
| `boq.ts:609 pr.create` | unauthorized PR mint + irreversible remain_qty cut (GAP-2) |
| `cost-centers.ts:121 master.create` | unauthorized cost-center budget (GAP-8) — see §5 |
| `models.ts:133 master.create` | unauthorized master-data price (GAP-8) — see §5 |

Same insertion rule as A.1 (F1 pattern after the `if(!db)` guard). B **excludes** rows 2,3,4,7,8,9,
11,12,13,15,16,20,21,22 — the submit/reject/return/cancel/revise workflow verbs and the approve
defense-in-depth stay as they are today.

---

## §4 · OPTION C — variation-order-specific hardening (baked into A & B; also standalone)

**Touches 1 handler: `POST /po/:id/variation-order` (po.ts:419-480).** This is the single most
important change in the whole spec — it converts the *working* approve-ladder (row 9, GATED-OK) back
into a real gate by killing the cut→approve-low→add-back bypass (matrix exploit-B).

Today the handler (po.ts:419-480): loads the PO, validates `dir∈{add,cut}` + `amount>=0`
(439-448), inserts the VO row (459-467), then **unconditionally** writes `total = total ± amount`
(469-476) — **no perms, no approvalLevel, no status check, and `cut` can drive the total negative**
(`requiredApprovalLevel(neg)` floors at PROC tier 2).

Three fixes, all inside this one handler. `requiredTierCount` is **already imported** (po.ts:73);
`po.approvalStep` is an existing column (surfaced as `approval_step`, po.ts:128).

### C-perm (Option A/B only) — require `po.edit`
Insert after the `if(!db)` guard (po.ts:425), add `requirePerm` to the `./authz.js` import (po.ts
imports nothing from authz today — add the import line):
```ts
if (!(await requirePerm(request, reply, "po", "edit"))) return reply;
```

### C1 — status gate (reject a VO on a doc that must not be amended)
Insert after the `amount` validation (po.ts:448), before the VO insert:
```ts
// C1: a VO is a change order against an ISSUED (approved) PO or a still-editable
// draft — never a pending (mid-approval), rejected, or closed doc.
if (po.status !== "approved" && po.status !== "draft") {
  return reply.code(409).send({
    code: "INVALID_STATE",
    message: "a variation order can only amend a draft or approved PO",
  });
}
```

### C3 — non-negative floor (reject `cut` past the current total)
Same block, right after C1 (replaces the implicit "cut can go negative"):
```ts
const currentTotal = Number(po.total);
// C3: a cut can never drive the committed total below 0 (kills the negative-total
// tier-downgrade floor).
if (dir === "cut" && amount > currentTotal) {
  return reply.code(400).send({
    code: "VALIDATION",
    message: "cut amount cannot exceed the current PO total",
  });
}
```

### C2 — re-approval reset on the amended total (THE exploit-B kill)
Replace the current `newTotal` + `updateThroughChain` block (po.ts:469-476) with:
```ts
const newTotal = dir === "add" ? currentTotal + amount : currentTotal - amount;

// C2: re-gate approval on the amended total. If the PO was already approved and the
// new total now engages MORE approval tiers than it was approved under, RESET it to
// pending so it must be re-approved at the correct (higher) tier. Kills exploit-B:
// create 6M (tier 4) → cut to 400K (tier 2) → approve at level 2 → add 5.6M back →
// now requiredTierCount(6M)=3 > approval_step(1) ⇒ status reset to pending, a real
// MD must re-approve.
const patch: Record<string, unknown> = { total: String(newTotal) };
if (po.status === "approved" && requiredTierCount(newTotal) > po.approvalStep) {
  patch.status = "pending";
  patch.approvalStep = 0;
}
const [updated] = await db.updateThroughChain(pos, PO_HOPS, patch, eq(pos.id, id));
```

> **Wei sub-choice on C2 strictness:** the rule above is *minimal-correct* — it resets only when the
> amendment pushes the PO into a **higher tier band** than it was approved under (which is exactly
> the exploit). A **stricter** variant resets on **any** `dir==="add"` to an `approved` PO
> (even 2M→3M within the same PM band). Recommend the tier-count rule (kills the exploit without
> re-approving trivial within-band top-ups); flag the stricter variant for Wei.

**What it blocks:** (a) direct money inflation of an approved PO with no approver; (b) exploit-B
tier-downgrade financial-authorization bypass; (c) amending a rejected/closed/pending doc;
(d) negative totals. Standalone C leaves rows 1-24 authz otherwise unchanged (does NOT close
GAP-2/3/5/6/8) — pick C alone only if Wei wants the narrowest possible patch.

---

## §5 · Consistency fix — `models` + `cost-centers` gated with `master.create` (GAP-8, part of A & B)

The F1 fix gated `/users` + `/roles` with `master.create` but left `/models` and `/cost-centers`
open, though both are `master`-module master-data (models = house-model `price`, cost-centers =
a `budget` figure). Align them:

| File:line | Insert after `if(!db)` guard · add to a NEW `./authz.js` import |
|---|---|
| `models.ts:133` (`POST /models`) | `if (!(await requirePerm(request, reply, MANAGEMENT_MODULE, "create"))) return reply;` |
| `cost-centers.ts:121` (`POST /cost-centers`) | `if (!(await requirePerm(request, reply, MANAGEMENT_MODULE, "create"))) return reply;` |

`import { requirePerm, MANAGEMENT_MODULE } from "./authz.js";` added to each. This is the exact
`master.create` gate `/users` (`users.ts:101-107`) and `/roles` (`roles.ts:216-222`) already carry.

> **Bonus (independent of authz — flag to Wei):** `cost-centers.ts:87-94` `toBudget` accepts a
> **negative** budget (no `>=0` floor). If Wei wants it closed, add after po.ts-style parse
> (`cost-centers.ts:159`): reject `budget < 0` with 400. Not part of the authz gap; note only.

---

## §6 · Regression tests to add (describe-only; `apps/api/src/routes/*.test.ts`)

Test harness is the existing `buildApp({db, resolveTenant, signIn, …})` + `stubDb([[table,rows]],
COMPANY, captured, mutated)` pattern (`po.test.ts:16-90`, `roles.test.ts:111-176`). A caller's
perms/level resolve via `resolveTenant → SESSION.user.email → users row → roles row` — so a test
seeds the caller's `role.perms` / `approvalLevel` exactly like the F1 tests
(`roles.test.ts:338-395`).

### T-VO (the headline — mirrors the F1 exploit-test that proved B-082 closure), `po.test.ts`
- **T-VO.1 exploit-B closed:** seed PO `{status:"approved", total:"400000", approvalStep:1}`; caller
  role `po.edit`, `approvalLevel:2`. `POST /po/:id/variation-order {dir:"add", amount:5600000}` →
  assert the captured `update.set` = `{ total:"6000000", status:"pending", approvalStep:0 }` (the
  reset fired). Then a level-2 approve → **403** (`requiredApprovalLevel(6M)=4`). **This is the
  single assertion that proves the bypass is dead.**
- **T-VO.2 within-band top-up does NOT reset:** approved PO `{total:"2000000", approvalStep:2}`;
  `add 1000000` → `total:"3000000"`, status stays `approved` (tier-count 2 unchanged).
- **T-VO.3 negative floor:** approved PO `total:"400000"`; `cut 500000` → **400 VALIDATION**
  (`cut amount cannot exceed the current PO total`); no update captured.
- **T-VO.4 status gate:** PO `status:"closed"` (and `"rejected"`, `"pending"`) + `add 100` →
  **409 INVALID_STATE**; no VO insert, no update.
- **T-VO.5 perms gate (A/B):** caller lacks `po.edit` → **403 FORBIDDEN** before any DB write.

### T-authz (per-mutation gate — one small table-driven suite per route file)
- **T-authz.1 deny:** for each gated handler, a caller whose role LACKS the required perm →
  **403 `{code:"FORBIDDEN"}`**, and assert **no insert/update captured** (fail-closed, gate precedes
  the write). Cover rows 1-24 for Option A, or the §3 subset for Option B.
- **T-authz.2 allow:** the same handler with a caller that HOLDS the perm → 201/200 as today
  (regression guard that the gate doesn't over-block).
- **T-authz.3 fail-closed unattributable:** caller with a session email that maps to no dictionary
  row (or a user with `roleId:null`) → **403** on every gated handler (mirrors `loadCaller` → null).
- **T-authz.4 approve depth (A only):** a caller with `approvalLevel:4` but no `x.approve` perm →
  **403** on `POST /{pr,po,wo,boq}/:id/approve` (both signals required).
- **T-authz.5 reject is approver-only:** `POST /pr/:id/reject` by a caller with `pr.create` but not
  `pr.approve` → **403** (closes the GAP-7 rival-denial vector) [Option A].

### T-consistency (GAP-8), `models.test.ts` / `cost-centers.test.ts`
- **T-cons.1:** `POST /models` and `POST /cost-centers` by a caller without `master.create` →
  **403** (identical assertion to the existing `/users`+`/roles` F1 403 tests).

### F2/F3/F4 locks (carry-forward from B-082 — described in the matrix §4, not re-derived here)
Already sketched in `b084-mutation-authz-matrix.md:241-301` (AuditLog non-null actor · prod quota
caps · login throttle). Land in the same `tests/` lane; not part of this authz patch.

---

## §7 · Recommendation (framed as Wei's ruling, not a decision)

**Cleanest correct default: Option A-lite = Option B (money-only per-action perms) + full §C
variation-order hardening + the §5 `master.*` consistency fix**, deferring the workflow-verb gates
(submit/reject/return/cancel) to a follow-up only if Wei confirms those verbs should be
member-restricted.

One-line rationale: B+C+§5 closes every **money/budget-state** gap (GAP-1,2,3,5,6,8) and the
critical financial-authorization bypass with the **smallest blast radius**, reusing the exact F1
primitive already proven in production — while full A's extra value (gating submit/reject/return/
cancel) hinges on the open policy question "may any member move a doc through the pipeline?", which
is Wei's ruling, not a security necessity. If Wei rules the workflow verbs must also be restricted,
upgrade in place to full Option A (A.1 already lists those exact rows). **Whichever option Wei
picks, §C (variation-order re-approval) must ship** — it is the only fix that closes the
tier-downgrade bypass.

---

### Handler-count + single most important change

- **Option A:** 7 files · **21 handlers gated** (17 create/workflow + 4 approve-depth) + §C on the VO + §5 on 2 master-data creates.
- **Option B:** 6 files · **10 handlers gated** (8 money/budget creates + `boq/items` + `generate-pr`) + §C on the VO + §5 folded in.
- **Option C (standalone):** 1 file · **1 handler** (the VO).
- **Single most important change:** the **variation-order re-approval reset** (§4 C2, `po.ts:469-476`) — reset an approved PO to `pending` when the amended total engages a higher approval tier than it was approved under. It is the only change that closes the cut→approve-low→add-back financial-authorization bypass, and it ships under every option.
