# Authz re-audit — main 2051e40 (post batch-8/9)

> orch-B · 2026-07-17 · method: 3 domain finders enumerate every mutation → adversarial verify each flagged gap (default REFUTE). Workflow `authz-reaudit-main`.
> **53 mutations audited** (procurement 27 · finance 8 · master-crosscut 18). **3 flagged → 2 CONFIRMED · 1 REFUTED.**

## Overall posture — strong
- **Tenant-scope is fail-closed by construction.** Every write flows through a `TenantDb` door (insert/update/insertThrough/updateThrough/updateThroughChain[Many]); `registerTenantScope` + `registerAuditLog` are on the root instance BEFORE the `/api/v1` child (app.ts:116/131 → 152), so every mutation is tenant-isolated (401 no tenant) AND audit-logged on 2xx/3xx. **0 UNSCOPED-RISK found.**
- All POST; no PUT/DELETE status writes (state changes only via action endpoints, per apps/api CLAUDE.md).
- Known gates all confirmed present: variation-order + generate-pr (perms/approval authority), pv approve (finance perm + tier ladder + SoD), reject pr/po/wo (approval-authority ladder), bank reconcile (finance approve) + import (finance create), gl.jv locked-period (409), PV SoD (created_by 403), users/roles (B-082 F1).

## 🔴 CONFIRMED GAP 1 — `POST /boq/:id/revise` un-locks an approved budget (boq.ts:892)
**The approve/revise asymmetry.** `approve` LOCKS the BOQ and is gated at `callerApprovalLevel >= BOQ_APPROVAL_MIN_LEVEL` (4 = MD, boq.ts:838). `revise` does the exact inverse — `approved`(LOCKED) → `revise`, editable again, version+1 — with **ZERO caller authz** (only a status precondition). Any authenticated tenant member, including an approvalLevel-0 / view-only role, can un-lock an approved budget baseline. `POST /boq/:id/items` then edits it (its guard rejects only status `approved`, boq.ts:496 — NOT `revise`), so approved line prices/qtys become mutable.
- **Impact:** within-tenant tamper/rework of an approved budget. Capped (not full self-approval) because re-approval still needs MD and `generate-PR` requires status `approved`. **Med.**
- **Fix (mirror the approve gate):** in `reviseBoq` (boq.ts:892), before the state write, add the same ladder as approve:
  ```ts
  const level = await callerApprovalLevel(request);
  if (level < BOQ_APPROVAL_MIN_LEVEL) {
    return reply.code(403).send({ code: "FORBIDDEN", message: "revising an approved BOQ requires approval authority" });
  }
  ```
  (flows.html FLOW-A: "MD approves EVERY revise" — so the revise-authority == approve-authority is the spec, not a new policy.)

## 🔴 CONFIRMED GAP 2 — `POST /bank/lines/:id/match` reconciliation confirm is ungated (bank.ts:1034)
`matchLine` (bank.ts:460) links a pv/cheque/rv to a bank line and sets `matched=true` (updateThrough). The route wrapper (bank.ts:1034-1039) checks only `request.db` (tenant scope) — **no `loadCaller`/`permAllowed`** — while its siblings `import` (finance `create`) and `reconcile` (finance `approve`) ARE gated (P2-BE-22). A non-finance member (e.g. master.view, approvalLevel 0) can confirm bank matches.
- **Impact:** within-tenant reconciliation-integrity — a low-privilege member marks bank lines matched/reconciled, feeding the period lock. Consistency gap vs its own gated siblings. **Med.**
- **Fix (mirror import, bank.ts:918):** in the `POST /bank/lines/:id/match` route wrapper, after the `db` check:
  ```ts
  const caller = await loadCaller(request);
  if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, "create")) {
    return reply.code(403).send({ code: "FORBIDDEN", message: "confirming a bank match requires the finance create permission" });
  }
  ```
  (`FINANCE_MODULE` + imports already in bank.ts from P2-BE-22.)

## ✓ REFUTED (adversarial verify dropped) — `POST /bank/export-batch`
Flagged as ungated, but refuted: (1) no incremental data disclosure — vendor.bank + PV net/status are already fully readable via the GET endpoints; (2) it does not move money — it generates a bank FILE for PVs already `approved`+`transfer`. Not a real incremental integrity gap. (Still, gating it on finance `approve` for defense-in-depth is a low-priority nicety, not a required fix.)

## Recommendation
Both confirmed gaps are **med, within-tenant, B-084-class** (tenant-scope + audit hold; no cross-tenant or payment-approval bypass). Clean fixes that mirror existing patterns (approve ladder / import gate). Fold into the next B-084 hardening pass. Priority: GAP 2 (bank match — trivial 4-line mirror + closes a sibling inconsistency) ≈ GAP 1 (boq revise — spec-backed "MD approves every revise").
