# B-084 (extension) — Fix-spec: gate bank import + reconcile mutations

> **From:** orch-B · **For:** orch-A (backend) · **2026-07-17** · found during P2-BE-20 verify (C-098)
> **Class:** B-084 within-tenant authz. Two new mutations (`POST /bank/statements/import`, `POST /bank/reconcile`) are **ungated** — any authenticated tenant member can import statements / **lock (close) a bank-reconciliation period** with no finance-role check.
> **Pattern:** copy-paste-verbatim from the already-shipped **`ap.ts` PV-approve gate** (B-082 F1 / same authz module). This invents no new policy — it enforces the existing 11×5 perms matrix, same as `/pv/:id/approve`, `/users`, `/roles`.

## Why it matters (priority: reconcile > import)
- **`reconcile` = period LOCK.** Once locked, a back-dated match is rejected (409) — it closes the books. flows.html FLOW-F MATRIX: *"ปิดงวดบัญชี: สมุห์บัญชี → ผจก.การเงิน · เงื่อนไข: กระทบยอดธนาคารครบก่อน"* — reconciliation is the finance-controlled precursor to period close. A low-privilege member locking a period is an integrity concern. **Gate on finance `approve`.**
- **`import`** = load a bank statement + lines + auto-match. Lower risk (no money moved; fail-closed scope; conservative no-guess match) but still finance-staff work → **gate on finance `create`.**
- Neither is a cross-tenant or payment-approval bypass (tenant scope stays fail-closed) — this is defense-in-depth hardening, consistent with the B-084 carry-forward, not a critical bypass like the original F1.

## Fix — `apps/api/src/routes/bank.ts` (routes-only, no sacred, no schema)

### 1. Add the imports + module constant (mirror `ap.ts:64,78`)
Near the top of `bank.ts` (with the other route imports):
```ts
import { loadCaller, permAllowed } from "./authz.js";

/** The perms-matrix module (seed MODULE_IDS) that governs finance actions — same as ap.ts. */
const FINANCE_MODULE = "finance";
```

### 2. Gate `POST /bank/reconcile` (finance `approve`) — the priority gate
Current (bank.ts:924-928):
```ts
  app.post("/bank/reconcile", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reconcileBank(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
```
Replace the body with (gate inserted after the `db` check — the route wrapper already has `request`, so the named handler stays unchanged):
```ts
  app.post("/bank/reconcile", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const caller = await loadCaller(request);
    if (!caller) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank reconciliation lock requires the finance approve permission",
      });
    }
    return reconcileBank(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
```

### 3. Gate `POST /bank/statements/import` (finance `create`)
Current (bank.ts:918-922):
```ts
  app.post("/bank/statements/import", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return importStatement(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
```
Replace with:
```ts
  app.post("/bank/statements/import", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const caller = await loadCaller(request);
    if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank statement import requires the finance create permission",
      });
    }
    return importStatement(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
```

## Tests — `apps/api/src/routes/bank.test.ts` (mirror ap.ts PV-approve authz tests)
Add per mutation:
- a caller **without** the finance perm (or unattributable) → **403 FORBIDDEN**, and the side effect did NOT happen (no statement imported / period not locked);
- a finance caller **with** the perm → succeeds (existing happy-path tests already cover success once the seeded caller carries finance `approve`/`create` — confirm the seed user used by these tests holds them, or use a seed finance role e.g. `finmgr`).
The seed finance identities are known (`suda@rungrueang.co.th` = Finance-Manager tier-2 · `wipha@` = MD/L4) — reuse them the way ap.test.ts does.

## Notes / pre-checked
- **No sacred change.** Route-only. The named handlers (`reconcileBank`, `importStatement`) are untouched — the gate lives in the route wrapper, which already has `request`.
- **Contract:** `importBankStatements` + `reconcileBank` are already declared (mounted ⊆ contract holds). A `403` is the standard bearerAuth/Error envelope already used by `/pv/:id/approve` (which returns the same shape) — **verify the ops reference the shared Error response; if a op lacks the 403/error response, that is a 1-line sacred contract add** (same as pv approve). Most likely already covered.
- **Scope of "approve" for reconcile:** reconcile is amount-independent, so it needs only the finance `approve` perm (no `approvalLevel` $-tier like PV). The full **period-close ladder** (สมุห์บัญชี → ผจก.การเงิน) belongs to the not-yet-built `gl.close` endpoint; reconcile is its precursor and this gate is sufficient for it.
- **Fold target:** this rides the same B-084 remaining-mutation hardening Wei is scoping (dev `be74b40` "MVP-B harden"). `b084-mutation-authz-matrix.md` (updated 2026-07-17) lists these two rows.

## Verification (orch-A applies → orch-B re-verifies)
1. `pnpm --filter @juneflow/api test` → green (existing 539 + new authz tests).
2. Adversarial: a non-finance seed caller `POST /bank/reconcile` → **403**, period stays open (a subsequent back-dated match still succeeds = not locked by the denied call).
3. orch-B can fold these two cases into `tests/e2e/finance-flow.spec.ts` (compose) alongside the existing bank match suggest/confirm coverage.
