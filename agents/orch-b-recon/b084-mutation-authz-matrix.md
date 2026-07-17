# B-084 — FLOW-A Per-Mutation Authorization Matrix

**Scope:** every mutation endpoint (POST/PUT/PATCH/DELETE) in
`apps/api/src/routes/{pr,po,wo,gr,boq,cost-centers,models,users,roles}.ts`,
plus the shared `procurement.ts` helpers and the `tenant-scope` / `audit-log` /
`subscription-quota` plugins for context.
**Type:** read-only recon. NO code touched. Fixes = backend/Wei zone.
**Deepens:** B-082 (STRIDE/OWASP audit — F1 already FIXED by orch-A) →
carry-forward **B-084 = FLOW-A-mutation authz** (BLOCKERS.md:103).
**Date:** 2026-07-17 · **Author:** orch-B recon.

> **F-numbering note.** This report uses the **TASK / BLOCKERS.md** mapping:
> **F2 = AuditLog non-null actor · F3 = prod quota caps · F4 = login throttle.**
> (`security-audit.md` internally swaps its own F2/F3 — quota vs audit — ignore
> that local numbering; all three items are the same three fixes and are all
> confirmed landed in the code read for this audit.)

---

## 0. The authz primitives that exist today

Two independent gate mechanisms are wired; a third (per-action perms) is absent
on FLOW-A docs.

| Primitive | Where | What it proves | Used by |
|---|---|---|---|
| **Tenant scope** (`company_id`) | `tenant-scope.ts:93-117` → `TenantDb` `select/selectThrough/insertThrough/updateThrough` | caller is an authenticated member of the tenant; a foreign `:id` resolves to nothing → 404 (no IDOR) | EVERY handler |
| **Approval ladder** (`role.approvalLevel` ≥ tier) | `procurement.ts:37-66` (`requiredApprovalLevel` + `callerApprovalLevel`); `pr.ts:559-566`; `boq.ts:809-815` | caller's role tier reaches the baht tier the amount demands | the 4 **approve** handlers only |
| **Perms matrix** (`role.perms[module][right]`) | `authz.ts` (`loadCaller`, `permAllowed`, `grantsBeyond`) | caller's role carries a specific right in the 11×5 matrix | **only** `/users` POST, `/roles` POST, `/roles/:id` PUT (the B-082 **F1** fix) |

**The gap class (B-084):** the perms matrix — the tenant's real 11×5 RBAC
contract (modules `dashboard,boq,pr,po,wo,gr,subcon,inventory,petty,finance,master`
× rights `view,create,edit,approve,cancel`) — is read by **no FLOW-A handler**.
Every money/state mutation on pr/po/wo/gr/boq that is **not** the terminal
`approve` is gated by **doc-status only** (or nothing). Any authenticated tenant
member — even a zero-perms role — can drive the procurement pipeline.

---

## 1. Full mutation-authz matrix (all 27 mutation endpoints)

Legend — **Gate verdict:**
`GATED-OK` (approvalLevel or perms check) ·
`STATUS-ONLY` (checks a doc status but no caller authz) ·
`UNGATED` (no caller authz at all; tenant-scope + business-rule only) ·
`N/A` (tenant-scope sufficient).

| # | Endpoint | file:line | Action | Touches money / fin-authz state? | Authz gate present today | Verdict |
|---|---|---|---|---|---|---|
| 1 | `POST /pr` | pr.ts:355 | create | Yes — new PR, `amount` derived from BOQ-priced lines | tenant-scope; project must be tenant's | **UNGATED** |
| 2 | `POST /pr/:id/submit` | pr.ts:506 | submit (draft→pending) | moves a money doc into the approval pipeline | `status==='draft'` only (pr.ts:519) | **STATUS-ONLY** |
| 3 | `POST /pr/:id/approve` | pr.ts:542 | approve (pending→approved) | Yes — terminal financial approval | **approvalLevel ≥ tier** (pr.ts:559-566) | **GATED-OK** |
| 4 | `POST /pr/:id/reject` | pr.ts:593 | reject (pending→rejected) | kills a pending money doc | `status==='pending'` + reason (pr.ts:614) | **STATUS-ONLY** |
| 5 | `POST /po` | po.ts:186 | create (from approved PR) | Yes — PO `total` seeded from PR lines | tenant-scope; source PR must be `approved`; vendor tenant's | **UNGATED** |
| 6 | `POST /po/:id/submit` | po.ts:300 | submit | pipeline move | `status==='draft'` only (po.ts:313) | **STATUS-ONLY** |
| 7 | `POST /po/:id/approve` | po.ts:332 | approve | Yes — terminal | **approvalLevel ≥ tier** (po.ts:348-355) | **GATED-OK** |
| 8 | `POST /po/:id/reject` | po.ts:375 | reject | kills doc | `status==='pending'` + reason (po.ts:396) | **STATUS-ONLY** |
| 9 | **`POST /po/:id/variation-order`** | **po.ts:416** | **variation-order (amend total ±amount)** | **Yes — rewrites PO stored `total` directly (po.ts:466-473)** | **NONE — not even a status check** | **UNGATED** ⚠️ worst |
| 10 | `POST /wo` | wo.ts:192 | create (from approved PR) | Yes — WO `value` + `retention_pct` from body | tenant-scope; source PR `approved`; vendor tenant's | **UNGATED** |
| 11 | `POST /wo/:id/submit` | wo.ts:311 | submit | pipeline move | `status==='draft'` only (wo.ts:324) | **STATUS-ONLY** |
| 12 | `POST /wo/:id/approve` | wo.ts:343 | approve | Yes — terminal | **approvalLevel ≥ tier** (wo.ts:357-365) | **GATED-OK** |
| 13 | `POST /wo/:id/reject` | wo.ts:384 | reject | kills doc | `status==='pending'` + reason (wo.ts:405) | **STATUS-ONLY** |
| 14 | `POST /gr` | gr.ts:265 | create (receipt vs PO/WO) | State — sets received/rejected, **closes PO/WO** (gr.ts:435-451), spawns defect_report | tenant-scope; PO/WO must be `approved` | **UNGATED** |
| 15 | `POST /gr/:id/return` | gr.ts:464 | return (received→returned) | reverses a receipt state | `status==='received'` only (gr.ts:477) | **STATUS-ONLY** |
| 16 | `POST /gr/:id/cancel` | gr.ts:500 | cancel (received→cancelled) | reverses a receipt state | `status==='received'` only (gr.ts:513) | **STATUS-ONLY** |
| 17 | `POST /boq` | boq.ts:341 | create | new BOQ (total 0 at birth) | tenant-scope; project tenant's | **UNGATED** |
| 18 | `POST /boq/:id/items` | boq.ts:474 | add priced lines | Yes — sets the **budget baseline** PR/PO derive from | `status!=='approved'` only (boq.ts:489) | **STATUS-ONLY** |
| 19 | **`POST /boq/:id/generate-pr`** | **boq.ts:603** | **generate-PR (create PR[s] + cut remain_qty)** | **Yes — creates draft PR docs (boq.ts:686) + permanently decrements `remain_qty` (boq.ts:746-753)** | **`status==='approved'` only (boq.ts:618)** | **STATUS-ONLY** ⚠️ high |
| 20 | `POST /boq/:id/submit` | boq.ts:760 | submit (draft\|revise→pending) | pipeline move | `status in (draft,revise)` only (boq.ts:773) | **STATUS-ONLY** |
| 21 | `POST /boq/:id/approve` | boq.ts:793 | approve (LOCK) | Yes — terminal budget lock | **approvalLevel ≥ 4 (MD)** (boq.ts:809-815) | **GATED-OK** |
| 22 | `POST /boq/:id/revise` | boq.ts:863 | revise (approved→revise, v+1) | **unlocks a locked/approved budget** | `status==='approved'` only (boq.ts:876) | **STATUS-ONLY** |
| 23 | `POST /cost-centers` | cost-centers.ts:121 | create | Yes — sets a `budget` figure (draft) | tenant-scope; project tenant's | **UNGATED** |
| 24 | `POST /models` | models.ts:133 | create | master-data `price` | tenant-scope (own company_id) | **UNGATED** |
| 25 | `POST /users` | users.ts:88 | create/invite | assigns role → effective authority | **perms `master.create`** (users.ts:101-107) | **GATED-OK** |
| 26 | `POST /roles` | roles.ts:204 | create | defines perms/approvalLevel | **perms `master.create`** (roles.ts:216-222) | **GATED-OK** |
| 27 | `PUT /roles/:id` | roles.ts:242 | update | rewrites perms/approvalLevel | **perms `master.edit` + self-elevation block** (roles.ts:254-284) | **GATED-OK** |

**Tally:** 7 `GATED-OK` · 12 `STATUS-ONLY` · 8 `UNGATED` · 0 `N/A`.
No PATCH/DELETE exist in these routes; no direct-`PUT`-status mutation exists
(the api-contract "status only via action endpoints" rule holds).

---

## 2. Ranked gap list (worst-first) — money/state mutations lacking caller authz

### GAP-1 · `POST /po/:id/variation-order` — UNGATED unconditional money rewrite — **CRITICAL** (po.ts:416-477)
- **Gate today:** loads the PO through tenant scope, validates `dir∈{add,cut}` and
  `amount>=0`, then **writes `po.total = total ± amount`** (po.ts:466-473). No
  perms check, no approvalLevel check, **and no status check whatsoever** — a
  `draft`, `pending`, `approved`, `rejected`, or even `closed` PO can be amended.
- **Exploit A (direct):** any authenticated member (zero-perms role) POSTs
  `{dir:"add", amount: 9000000}` to an approved PO → the PO's committed total
  silently jumps 9M with a real `variation_order` row attached, past the
  approve gate that already fired. Financial-commitment inflation with no
  approver in the loop.
- **Exploit B (tier-downgrade → approval bypass — the severe one):** the approve
  gate reads `Number(po.total)` live (po.ts:347). So:
  1. Create PO total **6,000,000** → `requiredApprovalLevel = 4 (MD)`.
  2. `variation-order {dir:"cut", amount: 5,600,000}` → total **400,000**
     (no floor — `cut` can even drive it negative; `requiredApprovalLevel(neg)`
     returns PROC tier 2).
  3. A **level-2 (หน.จัดซื้อ)** user now legitimately `approve`s (needs only tier 2).
  4. `variation-order {dir:"add", amount: 5,600,000}` → total back to **6,000,000**,
     but `status` is already `approved`.
  Net: a 6M PO approved by a tier-2 caller who could never have approved it
  directly. This turns the *working* approve-ladder (GATED-OK #7) into a bypass.
- **Impact:** in-tenant financial-authorization bypass (same class as B-082 F1,
  reached through a different door). **Severity: Critical.**

### GAP-2 · `POST /boq/:id/generate-pr` — creates PRs + consumes budget, no caller authz — **HIGH** (boq.ts:603-757)
- **Gate today:** `doc.status==='approved'` only (boq.ts:618). No perms/approvalLevel.
- **Exploit:** any member POSTs `{item_ids:[…]}` against an approved BOQ →
  server creates real draft PR / PR-Subcon docs (boq.ts:686-705) and
  **permanently decrements each item's `remain_qty`** (boq.ts:746-753). Two harms:
  (a) unauthorized procurement docs enter the pipeline (then flow through the
  STATUS-ONLY submit); (b) **budget-exhaustion denial** — a member can burn down
  `remain_qty` so legitimate future generate-PR calls 409 `QTY_EXCEEDS_REMAIN`.
  The cut is not reversible via any endpoint here.
- **Impact:** unauthorized spend initiation + irreversible budget consumption.
  **Severity: High.** (Confirms the survey finding.)

### GAP-3 · `POST /boq/:id/items` — sets the budget baseline, status-only — **HIGH/MED** (boq.ts:474-589)
- **Gate today:** blocks only when `status==='approved'` (boq.ts:489). Any member
  can add priced lines to any `draft`/`revise` BOQ, defining the `qty×price`
  budget that every downstream PR/PO price derives from (C10 chain). Poisoning
  the baseline pre-approval is a quieter version of GAP-1.
- **Severity: High if pre-approval tampering matters, else Medium.**

### GAP-4 · `POST /boq/:id/revise` — unlocks a locked budget, status-only — **MED** (boq.ts:863-892)
- **Gate today:** `status==='approved'` only (boq.ts:876). The BOQ lock is the
  whole point of `approve` (immutable budget); any member can `revise` an
  approved BOQ → `status='revise'`, `version+1`, budget editable again. Sabotage
  / lock-defeat vector; no caller authz. **Severity: Medium.**

### GAP-5 · `POST /po` & `POST /wo` create — money-commitment docs, no caller authz — **MED** (po.ts:186 / wo.ts:192)
- Both require a source PR that is `approved` (business rule) + a tenant vendor,
  but **no per-action authz**. Any member can raise a PO whose `total` mirrors an
  approved PR, or a WO with an arbitrary body `value` **and `retention_pct`
  (0–100, wo.ts:226-231)** — i.e. a member sets the retention hold-back with no
  authority. The doc still needs its own (gated) approve to bind, so the money
  bite is one approval away. **Severity: Medium.**

### GAP-6 · `POST /gr` create — closes PO/WO + spawns defect, no caller authz — **MED** (gr.ts:265-460)
- Requires an `approved` PO/WO, then aggregates receipt lines, can flip the PO/WO
  to `closed` on full receipt (gr.ts:435-451), and spawns a `defect_report` on
  any rejected qty. A member can force-close an open commitment or manufacture
  defect records against a vendor. No caller authz. **Severity: Medium.**

### GAP-7 · The STATUS-ONLY workflow verbs — submit / reject / return / cancel — **MED/LOW** (rows 2,4,6,8,11,13,15,16,20)
- **submit** (pr/po/wo/boq): any member pushes any `draft` doc into the approval
  pipeline. Low money impact alone, but it is the on-ramp for GAP-1/GAP-2 chains.
- **reject** (pr/po): any member can kill any `pending` doc → workflow-denial /
  sabotage (a rival can reject every PR awaiting approval). `reject` is
  semantically an **approver** action but is gated like a public verb.
- **return / cancel** (gr): any member reverses a receipt state.
- **Severity: Medium (reject = denial) to Low (submit).**

### GAP-8 · `POST /pr`, `POST /cost-centers`, `POST /models` create — no caller authz — **LOW / inconsistency** (pr.ts:355 / cost-centers.ts:121 / models.ts:133)
- Draft PR (amount derived, still needs approve), a `cost_center` `budget` figure
  (note: `toBudget` has **no `>=0` floor**, cost-centers.ts:87-94 — a negative
  budget is accepted), and a house-model `price`.
- **Inconsistency worth Wei's eye:** `models` and `cost-centers` are
  **`master`-module master-data**, yet the B-082 **F1** fix gated only `/users`
  and `/roles` with `master.create` — not these. If `master.*` governs
  master-data administration, `POST /models` and `POST /cost-centers` are
  arguably in the same class and were left open. **Severity: Low, but a
  policy-consistency call.**

### Checks the audit was asked to confirm
- **Non-approver self-progress?** Partially — a member **can** `submit` (STATUS-ONLY)
  but **cannot** `approve` (approvalLevel-gated). The real self-progress bypass is
  the GAP-1 tier-downgrade, not a direct approve.
- **Retention/deposit without authz?** `retention_pct` — **yes**, set freely on
  `POST /wo` (GAP-5). `deposit`/`paid` are derived read-only from `ap_billing`
  (po.ts:87-96) — not settable in these routes.
- **Double-submit?** No — `submit` guards `status==='draft'`; a second call 409s.
- **Negative amounts?** `variation-order amount<0` → 400, but `dir:"cut"` drives
  the **net total negative** (no floor, GAP-1 exploit B). `cost_center.budget`
  accepts negatives (GAP-8). PR line qty / BOQ qty+price enforce `>=0`.

---

## 3. Recommendation for the B-084 fix — options for Wei (authz model = a ruling)

**This is Wei-gated.** orch-B delivers the matrix + exploit repro above; the
authz *model* is a decision (some verbs — e.g. `submit` — may be intentionally
open to every member). Below are framed options + a ready backend task for
orch-A once Wei rules.

### Option A — Per-action required-perm from the 11×5 matrix (mirrors the approve-ladder pattern)
Add an `authz.ts`-style preHandler that resolves the caller's `role.perms`
(exactly as `loadCaller`/`permAllowed` already do for F1) and requires the
right below. This reuses the *existing* RBAC contract — invents no new policy —
the same principle the F1 fix used.

| Endpoint | Proposed required perm | Rationale |
|---|---|---|
| `POST /pr` | `pr.create` | create a PR |
| `POST /pr/:id/submit` | `pr.create` **or** `pr.edit` (Wei) | submit-own vs edit |
| `POST /pr/:id/reject` | `pr.approve` (or `pr.cancel`) | reject is the approver's counterpart |
| `POST /pr/:id/approve` | **keep approvalLevel** + add `pr.approve` | defense in depth |
| `POST /po` | `po.create` | |
| `POST /po/:id/variation-order` | **`po.edit` + re-gate approvalLevel on the new total** | see Option C |
| `POST /po/:id/submit`·`/reject` | `po.create`/`po.edit` · `po.approve` | |
| `POST /wo` (+`retention_pct`) | `wo.create` | |
| `POST /wo/:id/submit`·`/reject` | `wo.create`/`wo.edit` · `wo.approve` | |
| `POST /gr` | `gr.create` | |
| `POST /gr/:id/return`·`/cancel` | `gr.edit`/`gr.cancel` · `gr.cancel` | |
| `POST /boq` · `/items` | `boq.create` / `boq.edit` | |
| `POST /boq/:id/generate-pr` | `pr.create` (it mints PRs) — or `boq.approve` (Wei) | |
| `POST /boq/:id/submit`·`/revise` | `boq.edit` · `boq.edit` (or `boq.approve`) | revise unlocks the lock |
| `POST /cost-centers` · `POST /models` | `master.create` (Wei — resolve GAP-8 inconsistency) | align with /users,/roles |

### Option B — Minimal: gate only the money-touching NON-approve mutations
If Wei wants `submit`/`reject`/`return`/`cancel` to stay open to every member,
scope the fix to the direct money/state writes: **`variation-order`,
`generate-pr`, `boq/items`, PO/WO/PR create, GR create, cost-center create**.
Smallest blast radius; closes GAP-1..GAP-3, GAP-5, GAP-6, GAP-8.

### Option C — variation-order-specific hardening (do regardless of A/B)
1. **Add a status gate** — only amend a PO in a defined state (e.g. `draft` or
   `approved`, never `rejected`/`closed`).
2. **Re-gate approval on the amended total** — either forbid post-approval
   amendment, or re-run `requiredApprovalLevel(newTotal)` and require the caller
   (or a re-approval) to meet the *higher* of old/new tier. This directly kills
   the GAP-1 exploit-B tier-downgrade.
3. **Floor the total at 0** (or require `cut <= current total`).

### Suggested backend task for orch-A (post-ruling)
> **P?-BE-?? · B-084 FLOW-A per-action authz.** Add a perms preHandler
> (`authz.ts` — reuse `loadCaller`/`permAllowed`, fail-closed) applying Wei's
> ruled per-action rights table across pr/po/wo/gr/boq/cost-centers/models
> mutations; harden `variation-order` per Option C (status gate + re-approval on
> amended total + non-negative floor); align `models`/`cost-centers` with the
> `master.*` decision. Ship an exploit-regression test proving GAP-1 exploit-B is
> closed (mirrors the F1 exploit-test that proved B-082 closure). Backend zone;
> no contract/schema change required (perms matrix + approvalLevel already exist).

---

## 4. F2 / F3 / F4 regression-test SKETCHES (B-082 just-fixed items — future tests/ lane)

Describe-only. All three fixes are **confirmed present** in the code read here;
these sketches lock them against regression. (Do NOT write/run — future lane.)

### F2 — every successful mutation writes an AuditLog with a **non-null actor**
Fix location: `app.ts:130-142` wires `resolveUserId` → dictionary `user.id`
(via `loadUserByEmail(authUser.email)`); the hook only fires on 2xx/3xx
(`audit-log.ts:96-98`).
- **T-F2.1 happy path:** build app with a spy `auditSink` + a session whose email
  maps to a seeded dictionary user; `POST /pr` (or any mutation) → assert exactly
  one audit record, `record.userId === <dictionary user id>` (non-null), and
  `record.action` = the resolved verb (`create` for `POST /pr`, `approve` for
  `/pr/:id/approve` per `resolveAction` audit-log.ts:75-85).
- **T-F2.2 action-verb attribution:** `POST /po/:id/approve` → record `action==='approve'`,
  `entity` = route template `/api/v1/po/:id/approve`, `userId` non-null.
- **T-F2.3 no-row-on-failure:** a mutation that 4xx's (e.g. `POST /pr` missing `no`)
  → sink received **zero** records (only successful mutations log).
- **T-F2.4 degraded-but-recorded:** session email with **no** dictionary row →
  record still written with `userId === null` (never drop the row; app.ts:137-141
  catch → null). Documents the fail-open-on-actor / fail-closed-on-row contract.
- **T-F2.5 reads never log:** `GET /pr` → sink empty.

### F3 — prod quota resolver enforces real caps
Fix location: `index.ts:52-55` selects `SubscriptionQuotaResolver` when
`NODE_ENV==='production'`; resolver at `subscription-quota.ts:38-101`.
- **T-F3.1 at-cap → 402:** seed tenant with an active subscription → package
  `limits.projects = N` and N existing projects; `SubscriptionQuotaResolver.resolve(companyId,'projects')`
  → `{limit:N, used:N}` → `isWithinQuota` false → `POST /projects` returns
  **402 QUOTA_EXCEEDED + upgrade_url**.
- **T-F3.2 fail-closed no-subscription:** tenant with no active/trial sub →
  `resolve` returns `{limit:0, used:1}` (subscription-quota.ts:54) → 402 (deny),
  NOT the old unlimited pass.
- **T-F3.3 unlimited sentinel:** `limits[key] === -1` → `{limit:-1, used:0}` →
  within quota (short-circuit, subscription-quota.ts:57).
- **T-F3.4 wiring selection:** `NODE_ENV='production'` → `SubscriptionQuotaResolver`;
  non-prod → `unlimitedQuotaResolver` (index.ts:52-55). Guards the prod/dev split.
- **T-F3.5 per-dimension usage:** `users`/`ai_per_month` counted tenant-scoped
  (subscription-quota.ts:78-99); `storage_gb` still returns 0 (documented
  carry-forward — bytes column is sacred/out of zone).

### F4 — login throttle after N failures
Fix location: `auth.ts:42-89` — fixed-window per-IP limiter
(`LOGIN_WINDOW_MS=60_000`, `LOGIN_MAX_ATTEMPTS=10`).
- **T-F4.1 threshold:** from one IP, attempts 1–10 to `POST /auth/login` (bad
  creds → 401); the **11th** → **429 RATE_LIMITED** with a `retry-after` header
  (auth.ts:81-89).
- **T-F4.2 window reset:** advance a clock seam past `LOGIN_WINDOW_MS` → the
  counter resets, next attempt is 401 again not 429. (Needs `Date.now` injection
  or fake timers — current code calls `Date.now()` directly; note as a testability
  tweak.)
- **T-F4.3 per-IP isolation:** IP-A exhausts its window → IP-B's first attempt is
  unaffected (windows keyed by `request.ip`).
- **T-F4.4 throttle precedes credential check:** a rate-limited IP gets 429 even
  with *valid* creds (auth.ts:80-89 runs before `signIn`) — brute-force can't
  slip a lucky guess past the cap.
- **T-F4.5 map-bound cleanup:** >10_000 windows triggers expired-entry sweep
  (auth.ts:60-62) — memory stays bounded under IP-spray.
- **Carry-forward note:** the limiter is per-process in-memory (resets per app
  instance) — a multi-node prod needs a shared store (Redis); already tracked
  (channel.md:999 "F4 throttle in-mem").

---

## Summary line

**8 UNGATED** mutations (7 creates + the `variation-order` money rewrite) ·
**12 STATUS-ONLY** mutations (submit/reject/revise/return/cancel + `boq/items`
+ `generate-pr`) · **7 GATED-OK** (4 approvalLevel approves + 3 `master.*` perms
on users/roles). **Single worst gap: `POST /po/:id/variation-order` (po.ts:416)** —
zero authz and zero status check, rewrites the PO money total; exploit-B
(cut-below-tier → approve at a lower tier → add-back after approval) turns the
working approve-ladder into a full financial-authorization bypass.


---

## Update 2026-07-17 — P2-BE-20 bank handlers add 2 ungated mutations

Verified during the batch-9 candidate pass (P2-BE-20 bank import/reconcile). Two NEW within-tenant mutations, both **ungated** (no perms/role check), consistent with the existing B-084 carry-forward class:

| Mutation | Handler | Class | Note |
|---|---|---|---|
| `POST /bank/statements/import` | `importBankStatements` (bank.ts) | status/data create | imports a bank statement + lines + F-BANK1 auto-match. Any tenant member can import. Low risk (fail-closed scope; no money moved; conservative no-guess match). |
| `POST /bank/reconcile` | `reconcileBank` (bank.ts) | **accounting control** | **period LOCK** — once locked, back-dated match → 409 (books close for real). Any tenant member can lock/close a period. **Arguably should be Finance-Manager gated.** |

- **Not a security-critical bypass:** tenant-scope stays fail-closed (`insertThrough`/`selectThrough`, foreign statement absent), no cross-tenant leak, no payment-approval bypass (unlike the original B-084 F1 self-escalation).
- **Recommendation:** add `reconcile` (and optionally `import`) to the B-084 per-mutation authz fix — `reconcile` (period close) is the higher-priority one; a low-privilege user locking an accounting period is an integrity concern. Fold into whichever option Wei picks for the B-084 remaining-mutation gate.


---

## Update 2026-07-17 (2) — full authz re-audit of main 2051e40 (53 mutations · workflow)

Adversarial re-audit (3 domain finders + refute pass) of EVERY mutation on main 2051e40. 51/53 clean (tenant-scope fail-closed by construction · audit-logged global · known gates confirmed). **2 confirmed gaps · 1 refuted** — see `authz-reaudit-2051e40.md`.

| # | mutation | class | sev | fix |
|---|---|---|---|---|
| G1 | `POST /boq/:id/revise` (boq.ts:892) | approve/revise asymmetry — approve LOCK gated MD(≥4), revise UN-locks with 0 authz → tamper approved budget | med | mirror approve ladder (callerApprovalLevel ≥ BOQ_APPROVAL_MIN_LEVEL → 403) · flows.html "MD approves EVERY revise" |
| G2 | `POST /bank/lines/:id/match` (bank.ts:1034) | reconciliation confirm ungated — siblings import/reconcile gated, match not | med | mirror import gate (loadCaller + permAllowed finance create → 403) |
| — | `POST /bank/export-batch` | REFUTED — no incremental disclosure (GET-readable) · no money-move (file for approved+transfer PV) | — | none (low-pri defense-in-depth only) |
