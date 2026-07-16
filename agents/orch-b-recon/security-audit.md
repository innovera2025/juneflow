# Juneflow Backend — Security Audit (STRIDE + OWASP)

**Scope:** `apps/api/**` (Fastify + better-auth + Drizzle, multi-tenant).
**Type:** read-only recon (orch-B verify). No code changed. Fixes are backend/devops/Wei zone.
**Date:** 2026-07-16 · **Auditor:** orch-B recon

> Legend — CONFIRMED = verified at file:line in this pass · THEORETICAL = plausible but not exercised.
> Owner-zone — **backend** (`apps/api`) · **devops** (infra/compose) · **Wei** (sacred: contract/migrations/secrets).

---

## 0. Executive summary

The **tenant-isolation layer is genuinely solid and fail-closed** (TenantDb choke point, verified below) and **object-level access control (IDOR) is clean** — every `:id` handler resolves through the tenant-scoped handle, so a foreign id is invisible (→404). Approval **action** endpoints correctly enforce `role.approvalLevel`.

The gap is **function-level access control**: the stored 11×5 `role.perms` matrix is **never read to gate any CRUD**. Combined with an **unwired audit actor** and a **stubbed prod quota resolver**, the RBAC/accountability model that the schema promises is not actually enforced at runtime.

**1 Critical · 4 High · 4 Med · 2 Low/Info.**

Single most urgent: **F1 — `role.perms` not enforced on CRUD.** Any authenticated tenant member can `PUT /roles/:id` to rewrite their own role's perms + set `approvalLevel = 4`, then self-approve unlimited-value PR/PO/WO — an in-tenant privilege-escalation → financial-authorization bypass.

---

## 1. STRIDE analysis

### Spoofing — LOW residual risk (mostly solid)
- Auth is a better-auth bearer session over our Postgres; `companyId` is an `input: false` additional field (`auth.ts:97`) so a client **cannot claim another tenant** at sign-up/session. CONFIRMED-GOOD.
- Prod refuses to run on the committed dev fallback secret — `resolveAuthSecret()` throws under `NODE_ENV=production` when `BETTER_AUTH_SECRET` is unset (`auth.ts:59-70`), called at boot (`index.ts:41`). Fail-fast, no silent weak-key signing. CONFIRMED-GOOD.
- **Gap (F4):** `POST /api/v1/auth/login` is public (`tenant-scope.ts:69-73`) and has **no rate limiting** — no `@fastify/rate-limit`/throttle is registered anywhere (`grep` empty). Credential brute-force / password spraying is unthrottled. CONFIRMED.

### Tampering — LOW residual risk (solid)
- `TenantDb` (`db/tenant-db.ts`) is the single write choke point and is fail-closed:
  - `insert()` force-sets `companyId = this.companyId`, ignoring any client value (`tenant-db.ts:102-105`).
  - `update()` **strips** a smuggled `companyId` from the set and scopes the WHERE (`tenant-db.ts:108-118`) — a row can never be moved to another tenant.
  - `selectThrough/insertThrough/updateThrough/updateThroughChain` verify parent/root ownership before writing (`tenant-db.ts:198-326`).
- No route touches the raw/base db — the only `options.db` use is `auth.ts:65`, which builds a `TenantDb` from the *already-verified* `companyId`. CONFIRMED-GOOD.

### Repudiation — HIGH (confirmed gap)
- **F3:** every audit row is written with `user_id = null`. `registerAuditLog` is called with **only `{ sink }`** and no `resolveUserId` (`app.ts:121-123`); the plugin then defaults `resolveUserId = () => null` (`audit-log.ts:85`) and writes that into every record (`audit-log.ts:101`). The session actor **is available** (`request.authUser`, set at `tenant-scope.ts:113-115`) but is never passed. Result: the audit trail cannot answer "who did this." CONFIRMED.
- **F7:** the audit write is best-effort inside an `onResponse` hook (`audit-log.ts:87-109`) — it runs **after** the mutation committed and the reply was sent, and is not transactional with the mutation. A sink/DB failure loses the audit row while the mutation persists (silent forensic hole). CONFIRMED (design).
- Compounding: `before` is always `undefined` and `after` is only the request body (`audit-log.ts:99-107`) — no value diff. DELETEs record essentially nothing but the path.

### Information disclosure — LOW (solid, minor surface)
- 5xx collapses to `{code:"INTERNAL_ERROR", message:"Internal server error"}`; details only to the log (`app.ts:98-103`). Not-found is the flat contract shape (`app.ts:78-83`). CONFIRMED-GOOD.
- Hidden modules answer **404 not 403** (`feature-flags.ts:170-176`) → no module enumeration. No `GET /feature-flags` exposed. CONFIRMED-GOOD.
- **F10 (Low):** 4xx passes `err.message` through verbatim (`app.ts:104-107`); if a downstream ever throws a 4xx with a sensitive message it would surface to the client. Low — current messages are controlled literals.
- No hardcoded credentials found. The only committed secret literal is the clearly-labelled dev-only fallback (`auth.ts:44`), inert in prod by F-fast. CONFIRMED-GOOD.

### Denial of service — HIGH (confirmed gap)
- **F2:** production wires `unlimitedQuotaResolver` (`index.ts:49-50`), which always returns `{limit:-1, used:0}` (`quota.ts:95-99`) → `isWithinQuota` always true (`quota.ts:48-50`). So project/seat/storage/AI quotas are **unbounded in prod** — no resource cap, no billing enforcement. The 402 mechanism itself is correct and wired (files/ai-qto/projects), only the resolver is a stub. CONFIRMED.
- **F4** (also DoS): unthrottled public login (above).
- Body size uses Fastify's 1MB default (acceptable). AI QTO endpoint is quota-gated on `ai_per_month` (`ai-qto.ts:150-152`).

### Elevation of privilege — CRITICAL (confirmed gap)
- **F1:** No route reads `role.perms[module][right]` to authorize an action. `perms` appears only in projection/serialization (`roles.ts:61-104`, `profile-data.ts:38`, `me.ts:49`) — never in a guard. Consequently, **any** authenticated tenant member (even a zero-perms role) can:
  - `POST /users` — invite/create users and assign any role (`users.ts:87-162`) → create a backdoor admin.
  - `POST /roles` + `PUT /roles/:id` — create or **rewrite the 11×5 perms matrix and `approvalLevel`** (`roles.ts:198-265`), including their own role.
  - Escalation chain: low-priv member → `PUT /roles/:id` sets own `approvalLevel=4` → self-approve unlimited-value PR/PO/WO (approval endpoints only check the *level*, not *who set it*). Financial authorization bypass. CONFIRMED.
- Scope note: this is **in-tenant** escalation (cross-tenant isolation still holds), but it defeats the entire RBAC + approval-ladder design.

---

## 2. OWASP mapping

- **A01 Broken Access Control** — **F1** (function-level authz absent on CRUD; perms matrix editable by any member). Object-level (IDOR) is CLEAN (see §4). This is the headline finding.
- **A02 Cryptographic Failures** — No stored-crypto issues found. Passwords handled by better-auth; sessions signed with an env secret that fail-fasts in prod (`auth.ts:59-70`). No custom crypto, no committed prod key. GOOD.
- **A04 Insecure Design** — **F2** (quota mechanism shipped with a permanently-passing resolver in prod), **F6** (password-reset flow designed in the contract but never implemented — invited users have no activation path).
- **A05 Security Misconfiguration** — **F5** (B-055: prod compose passes `AUTH_SECRET`, code reads `BETTER_AUTH_SECRET` → `resolveAuthSecret()` throws → prod won't boot; devops fix), **F2** (unlimited resolver is a misconfig-by-default).
- **A07 Identification & Auth Failures** — **F4** (no brute-force throttling on public login). Session handling itself (better-auth) is standard.
- **A09 Security Logging & Monitoring Failures** — **F3** (audit `user_id` always null), **F7** (audit non-transactional / best-effort), plus no before-state diff. No alerting/monitoring on auth failures (ties to F4).

---

## 3. Ranked findings

| ID | Sev | Title | Evidence (file:line) | Impact | Remediation | Owner |
|----|-----|-------|----------------------|--------|-------------|-------|
| **F1** | **Critical** | `role.perms` 11×5 matrix not enforced on any CRUD; role/approvalLevel self-editable | `users.ts:87-162`; `roles.ts:198-265`; no `perms[...]` guard anywhere (grep); approval-only checks at `pr.ts:522-530`, `procurement.ts:51-65` | In-tenant privilege escalation → financial authz bypass (self-grant `approvalLevel=4`, self-approve unlimited PR/PO/WO; create backdoor admin) | Add a perms preHandler (caller role → `perms[module][right]`) on create/edit/cancel; forbid a member editing its own role's perms/`approvalLevel`; require `master.*` for `/users` & `/roles` | backend |
| **F2** | High | Prod quota wired to `unlimitedQuotaResolver` — all quotas unbounded | `index.ts:49-50`; `quota.ts:95-99`; `isWithinQuota` `quota.ts:48-50` | Seat/AI/storage/project abuse with no cap; subscription tiers unenforced (revenue + resource-exhaustion) | Implement a subscription-backed `QuotaResolver` (real limit+used per dimension); keep the 402 path as-is | backend |
| **F3** | High | Every AuditLog row has `user_id = null` (actor never wired) | `app.ts:121-123` (no `resolveUserId`); `audit-log.ts:85,101`; actor available at `tenant-scope.ts:113-115` | Repudiation — audit cannot attribute any mutation; forensics/compliance gap | Pass `resolveUserId: (r) => r.authUser?.id ?? null` (map auth_user→dictionary user id if needed) to `registerAuditLog` | backend |
| **F4** | High | No rate limiting on public `POST /auth/login` | public path `tenant-scope.ts:69-73`; no rate-limit plugin registered (grep empty) | Credential brute-force / password spraying unthrottled | Register `@fastify/rate-limit` (or better-auth throttling) on the auth surface; add lockout/backoff + failure logging | backend |
| **F5** | High | B-055: prod boots with `AUTH_SECRET` but code reads `BETTER_AUTH_SECRET` → fail-fast at boot | `auth.ts:48,59-70`; `index.ts:41`; prod compose env name mismatch | Production API will not start (availability). Code side is *correctly* fail-closed; defect is the env var name | Rename compose/secret to `BETTER_AUTH_SECRET` (or map it). Sacred/infra change | devops / Wei |
| **F6** | Med | Password-reset flow unimplemented (contract declares it) | contract `/auth/forgot` (`openapi.yaml:107`), `/auth/reset` (:123), `/admin/users/{id}/reset-password` (:394); no route implements them (grep empty) | Invited users (`status:"invited"`, set-password-later — `users.ts:17,156`) have no activation path; missing security-critical flow; contract drift → clients 404 | Implement forgot/reset + admin reset-password via better-auth verification tokens; or defer explicitly with a BLOCKER | backend (+ Wei for contract) |
| **F7** | Med | Audit write is best-effort in `onResponse`, not transactional with the mutation | `audit-log.ts:87-109` | A sink/DB failure drops the audit row while the mutation persists (silent forensic hole under load/failure) | Make audit write awaited within the mutation's transaction, or add a failure alarm / dead-letter | backend |
| **F8** | Med | Audit records carry no before-state and no diff (only request body as `after`) | `audit-log.ts:99-107` | Weak forensics: DELETE/approve rows record path only; can't reconstruct what changed | Capture before/after snapshots at the resource layer (already flagged as skeleton in the plugin header) | backend |
| **F9** | Low | Feature-flag control is unused by routes → `ai_qto:false` default is inert | `requireFeature` defined `feature-flags.ts:170` but referenced by **no** route (grep); `ai-qto.ts` gates only on quota (`:150-152`) | Dead defense-in-depth control; a module intended "hidden" is actually reachable (here: fake-result path, low impact) | Mount `requireFeature('ai_qto')` as preHandler on the real-engine route when it lands; or remove the inert flag | backend |
| **F10** | Low | 4xx `err.message` returned verbatim | `app.ts:104-107` | Minor info-disclosure surface if a downstream throws a sensitive 4xx message | Whitelist client-safe messages for 4xx as well | backend |

---

## 4. Per-route authz matrix

Columns — **Door:** tenant-scope door used · **:id anchored:** is `:id` bound to caller `company_id`? · **Authz:** function-level permission/approval check present?

| Route | Method | Door | :id anchored to company_id | Authz / perms check | Note |
|-------|--------|------|-----------------------------|---------------------|------|
| `/auth/login` | POST | n/a (public) | n/a | credential (better-auth) | no throttle (**F4**) |
| `/me` | GET | `select` scoped | n/a | session only | GOOD |
| `/users` | GET/POST | `select`/`insert` scoped | n/a | **NONE** (**F1**) | any member creates users |
| `/roles` | GET/POST | `select`/`insert` scoped | n/a | **NONE** (**F1**) | any member creates roles |
| `/roles/:id` | PUT | `update` scoped | ✅ (`eq(roles.id,id)` + company AND, `roles.ts:242-253`) | **NONE** (**F1**) | **perms matrix + approvalLevel editable by any member** |
| `/vendors`, `/vendors/:id` | POST/GET/PUT | `select`/`insert`/`update` scoped | ✅ (`vendors.ts:239,258`) | NONE | lower impact CRUD |
| `/projects` | POST | `insert` scoped + quota(projects) | n/a | quota only (unlimited, **F2**); no perms | |
| `/pr`, `/pr/:id`, `/pr/:id/submit` | POST | `selectThrough`/`updateThrough` | ✅ (`pr.ts:457,481,492`) | none on create/submit | |
| `/pr/:id/approve` | POST | `selectThrough`/`updateThrough` | ✅ (`pr.ts:515`) | ✅ `approvalLevel` tier (`pr.ts:522-530`) | GOOD (but see F1 chain) |
| `/po/:id/approve`, `/wo/:id/approve` | POST | through-doors | ✅ | ✅ `approvalLevel` (`procurement.ts:51-65`, `po.ts:271`, `wo.ts:237`) | GOOD |
| `/boq/:id/approve` | POST | through-doors | ✅ (`boq.ts:735`) | ✅ MD tier (`boq.ts:243-248,741`) | GOOD |
| `/gr/:id`, `/org-units/:id`, `/project-nodes/:id`, `/project-types/:id`, `/cost-centers`, `/doc-numbering`, `/models` | mixed | scoped doors | ✅ (all via `request.db`) | NONE (perms) | routine CRUD, no function-authz |
| `/files` | POST | tenant ctx + quota(storage_gb) | n/a | quota only (unlimited, **F2**) | |
| `/ai-qto/*` | POST/GET | tenant ctx + quota(ai_per_month) | ✅ (`ai-qto.ts:176`) | quota only; **no** `requireFeature` (**F9**) | |

**IDOR verdict: no IDOR found.** Every `:id` path resolves through the tenant-scoped `request.db` (`select`/`selectThrough` auto-inject `company_id`, or `updateThrough`/`insertThrough` verify parent ownership), so a foreign id yields 404. The exposure is **function-level** (F1), not object-level.

---

## 5. Positive confirmations (what IS solid)

1. **Tenant isolation is genuinely fail-closed.** `TenantDb` constructor throws on empty `companyId` (`tenant-db.ts:83-88`); `insert` force-sets and `update` strips `companyId` (`tenant-db.ts:102-118`); every read/write is `company_id`-scoped; parent-FK doors verify root ownership before writing (`tenant-db.ts:198-326`); `selectReference` is runtime-allowlisted to exactly `packages`+`companies` (`tenant-db.ts:59-62,338-349`); `selectGlobalOrOwned` unions global-OR-own only (`tenant-db.ts:364-373`).
2. **No unscoped query escapes.** Handlers only ever get the scoped `request.db` (`tenant-scope.ts:111-112`); the base db is never exposed. Only `auth.ts:65` builds a `TenantDb` — from the verified login `companyId`.
3. **Fail-closed request gate.** Non-public request without a resolved tenant → 401, chain stopped, no handler runs (`tenant-scope.ts:100-109`).
4. **No IDOR** (see §4) — object access is company-anchored everywhere.
5. **Approval ladder enforced** on pr/po/wo/boq approve via `role.approvalLevel` tiers (`pr.ts:522-530`, `procurement.ts:36-65`, `boq.ts:68-71,741`).
6. **Auth secret is fail-fast in prod** (`auth.ts:59-70`, `index.ts:41`); `companyId` is `input:false` (`auth.ts:97`) so tenant can't be spoofed.
7. **Audit registered globally on mutations**, logs only successful 2xx/3xx, and reads produce no rows (`audit-log.ts:87-97`) — the *mechanism* is correct; only the actor (F3) and durability (F7) are unwired.
8. **Quota 402 shape is correct and wired** on files, ai-qto, projects (`quota.ts:78-88`; `files.ts:84-88`; `ai-qto.ts:150-152`; `projects.ts:205-207`) — only the resolver is a stub (F2).
9. **Error handling doesn't leak internals** (5xx→generic, `app.ts:98-103`); hidden modules 404 not 403 (no enumeration).

---

## 6. Recommended fix order (backend zone)
1. **F1** (Critical) — add function-level perms guard + block self-role escalation. *Highest leverage; also neutralizes the F2 financial-abuse chain.*
2. **F3** (High) — one-line `resolveUserId` wire; trivial, restores accountability.
3. **F4** (High) — register rate-limit on the auth surface.
4. **F2** (High) — real quota resolver.
5. **F5** (High, devops/Wei) — fix the `BETTER_AUTH_SECRET` env-name mismatch so prod boots.
6. **F6/F7/F8** (Med) then **F9/F10** (Low).
</content>
</invoke>
