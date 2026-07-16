# FLOW-A Data-Completeness — Recon Findings (evidence-based)

> orch-A recon · 2026-07-16 · read-only · all claims file+line cited in the source recon
> Feeds the PLAN/execute pass for the group-A+D backend wave (Wei approved direction C-068)

## 🔑 Load-bearing discovery: the contract is OPAQUE for reads
`openapi.yaml` `Entity` = `additionalProperties: true`; every GET/list/detail (`/gr /pr /po /wo /boq /boq/{id}/items`) returns opaque `Entity`/`EntityList`/`EntityOk`. **→ Adding NEW fields to a handler's read response needs NO contract change** (the generated FE client already types these open-ended). Sacred openapi edits are needed ONLY for: a brand-new operation, or widening a *typed request body*.

## Tier 1 — FREE / near-free wins (no design decision · additive precedent 0012-0017)
| Gap | What's needed | Migration? | Contract? |
|---|---|---|---|
| **5 · boq.editor detail** | 1 nullable `boq_item.detail` column + seed from boq.jsx L328-358 + handler | 0018 (tiny) | none (opaque) |
| **6 · boq.bom** | **BOM line seed ALREADY in DB** (boms.items B-1, 17 rows) — only need a read endpoint | **none** | new `GET /models/{id}/bom` op (SACRED) |
| **8 · notifications** | table exists (since 0002) + contract exists — only a missing **route file + registration** | **none** | **none** |
| **9 · create-boq (B-077)** | handler already reads project_id — pure contract body fix | none | widen `createBoqFromAiQto` body (SACRED) |
| **1 · gr (partial)** | vendor(FK join)/date/ordered-qty — GET already computes ordered in POST, just not returned | **none** (read-path fix) | none |
| **3 · po (partial)** | `ap_billing`/`pv` tables exist AND seeded per-PO → aggregate "paid" via join + doc_date | **none** | none |
| **2 · pr fields** | title/vendor/requester/phase/timestamps — genuinely absent → additive columns + seed | 0019 (columns) | none (opaque) |

## Tier 2 — genuine DESIGN FORKS (need Wei ruling before schema shape is final)
| # | Gap | Fork |
|---|---|---|
| F1 | **GR money + per-line detail** | moneyless / prorate from PO·WO / new `gr_item` table |
| F2 | **PO deposit vs paid** | `ap_billing.kind` enum / `po.deposit_*` cols / presentational-only |
| F3 | **WO installments** | FK wo→subcon_contract + reuse `work_period` / new `wo_installment` / WO-native progress only |
| F4 | **BOQ archive approver/date/history** | `boq_doc` cols + new version-history table / extend audit-log middleware / minimal cols only |

## orch-A decides (minor, no Wei needed)
- F5 models/bom: **new `GET /models/{id}/bom` path** (RESTful · not embed in /models)
- F6 bom↔model: keep `unitType`↔`code` string-match (add FK later · robustness note, not blocking)

## Sequencing mechanics (from recon)
- migration → seed → handler order (drizzle standard, as 0012-0017)
- any openapi edit → `pnpm --filter @juneflow/contracts generate` (FE client regen) · Dart mobile regen = separate manual step (gen:dart stub)
- migration numbering 0018+ drifts if another branch lands one first — pin fresh
- **audit_log CANNOT source archive approver** — its `entity` = route template string (`/boq/:id/approve`), not the resolved id (audit-log.ts L69-107) → F4 can't reuse it without a middleware change

## New BLOCKERS drafts (beyond B-076/B-077) = the 4 forks F1-F4 → Wei
*(recon made NO decision — options only)*
