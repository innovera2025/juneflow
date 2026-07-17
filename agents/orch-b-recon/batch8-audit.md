# Batch-8 Pre-Promote Audit (orch-B) — 2026-07-17

**Range audited:** `1b7fbca` (main / batch-7) → `fbbca18` (stated dev) → **`c7e18969`** (actual dev HEAD)
**Scope:** Phase-2 Wave-1 web + Wave-2 GL/AP/bank backend+web + BE-17..19 + security/perf + i18n round.

---

## VERDICT: **GO-WITH-NOTES**

The batch is gate-green and safe to promote. **One material correction to the plan:** pin **`c7e18969`, not `fbbca18`.**
`fbbca18` predates the Wei-approved Wave-2 i18n sacred round (B-091). At `fbbca18` the gl/ap/bank UI phrases live only in local `*-strings.json._missing` and are **absent from the sacred `i18n-full.json`** — a partial violation of the "UI copy via i18n key from i18n-full.json only" rule, and it would drop already-merged, approved work. `c7e18969` is the "WAVE-2 COMPLETE" commit that folds those 145 phrases into both sacred copies (byte-identical) and is strictly cleaner. All gate evidence below was re-verified at `c7e18969` (= current dev HEAD, = current working tree).

---

## Per-Dimension Results

| # | Dimension | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Sacred-file integrity | **PASS** | Only `openapi.yaml` (+128) and `i18n-full.json` (both copies) touched among sacred files — both authorized: **B-089** (Wave-2 greenlight + fork rulings, Wei 2026-07-17), **B-091/B-092** (i18n round + F-BANK forks, Wei-approved). No `CLAUDE.md`, `.github/`, `docs/extract/*` (other than the sanctioned i18n copy), or existing migration rewritten. openapi: 6 new operationIds added, **zero deletions** of existing paths/ops. |
| 2 | i18n 2-copy parity | **PASS** | At `c7e18969`: `cmp packages/i18n/src/i18n-full.json docs/extract/i18n-full.json` → **IDENTICAL**. Both valid JSON. `.dict` = **1059** (stable). `.phrases` 762 → **907** (+145 gl/ap/bank, verbatim th-echo). Sacred i18n test **19/19 PASS**. (At `fbbca18`: parity also clean but phrases still 762 — round not yet applied → see pin note.) |
| 3 | Migration integrity | **PASS** | Two NEW files only: `0026_ap_pv_finance.sql`, `0027_bank_statement_line.sql`. `_journal.json` **append-only** (idx 26, 27). Sequence 0000–0027 contiguous, no gap/dupe. No existing `.sql` modified. Both migrations **additive-only** (CREATE TYPE / ALTER ADD COLUMN / ADD CONSTRAINT / CREATE INDEX; the only "DROP" hits are FK `ON DELETE set null` clauses). `bank_statement_line.amount` carries `currency_code` (money-column rule respected). Latest migration = **0027**. |
| 4 | Contract drift | **PASS** | `contract/drift.spec.ts` **3/3 PASS** — mounted-but-undeclared set is EMPTY (mounted ⊆ contract). New routes (gl/ap/bank via app.ts) all declared. New endpoints: listApBilling, listApPv, listBankStatements, listBankStatementLines, matchBankLine, listBankCheque (gl/coa, gl/jv, gl/posting-inbox, bank/export-batch pre-declared). generated `types.ts` regenerated in-lockstep. |
| 5 | Test coverage of logic | **PASS** | Every changed route file has a paired test: `gl.ts↔gl.test.ts` (17), `ap.ts↔ap.test.ts` (25), `bank.ts↔bank.test.ts` (18). Web rows-logic all paired (coa/jv/billing/pv/cheque/export/recon-rows.test.ts). `gl-posting.ts` = shared helper mounted via gl.ts, exercised by gl.test.ts. **api 527/527 green** (34 files), **web 485/485 green** (36 files). Only untested logic = thin React-Query hooks (use-gl/ap/bank.ts) — screen-tested, acceptable. |
| 6 | Zone boundaries | **PASS** | Touched: apps/api, apps/web, packages/{db,contracts,i18n}, tests/e2e, board files (BLOCKERS/TASKS/REVIEW-QUEUE), agents/ bookkeeping. **No `.claude/`, `infra/`, `.github/` changes.** Lone oddity: `promote-batch7.sh` committed at repo root (leftover batch-7 helper — harmless, cleanup-optional). |
| 7 | Design-fidelity spot-checks | **PASS** | **Zero Thai chars and zero ฿ in any changed `.tsx`** (i18n-guard intent held). Honest em-dash (U+2014) present in all 7 Wave-2 screens for un-backed fields (coa group/balance, jv status/KPI, ap no#/aging/GL-preview, bank book-balance/diff/no-doc#) — no fabricated data (decision C10). `gl-posting.ts` documents honest PENDING-only gap (seed lacks `table:uuid` source_doc) rather than faking posted status. |
| 8 | Open-blocker cross-check | **PASS (no hard blocker)** | See list below. |

---

## Open-Blocker Cross-Check (B-066/072/073/074/075/083/087)

**None is a hard promote-blocker.** All are deferred follow-ups or already-fixed:

- **B-066** — docnum POST/PUT write-path stub (defer, B-050/B-065 pattern). Screen already on main; not batch-8 core. *Deferred.*
- **B-072** — gr Return-form modal strings missing from i18n (Wave-1 modal). *Deferred i18n.*
- **B-073** — i18n-guard hook doesn't fire in worktree lanes (harness gap). **Risk did NOT materialize this batch** — independently verified 0 Thai/฿ in all changed `.tsx`. *Process note, not a defect.*
- **B-074** — gr.list live-G5 data-wire gap (thin `GET /gr` payload). Structural-G5 PASS + honest em-dash. *Deferred data-completeness.*
- **B-075** — pr.list mock fields lack wire source. Same honest-em-dash class. *Deferred.*
- **B-083** — boq.archive seed approver ≠ prototype name. *Deferred seed cosmetic.*
- **B-087** — overnight bug-hunt: web-crash guards **FIXED** (1065d2b), authz cluster **FIXED** via B-084. Residual MEDIUM items deferred. *Partially fixed, no residual break.*

---

## Notes / Operational Cautions

1. **Pin = `c7e18969` (dev HEAD), not `fbbca18`.** `fbbca18` omits the merged, Wei-approved Wave-2 i18n round (B-091). `fbbca18→c7e18969` delta = i18n-full.json ×2 (byte-identical, +725 lines each ≈ 145 phrases), `export-strings.json` (_missing→resolved), `bank-export.tsx` curly→ASCII glyph fix (0 Thai), + BLOCKERS/TASKS bookkeeping. Nothing risky.
2. **Working tree is dirty** (2 uncommitted tracked files: `.gitignore`, `agents/journal/web.md`) — these are NOT in `c7e18969` and will be excluded from a pinned-SHA promote, but `git checkout main` in the promote script would carry them across. **Commit or stash them on dev before promoting.**
3. `promote-batch7.sh` leftover at repo root — optional cleanup, not blocking.

---

## Recommended Promote (run in Wei's own terminal — main is Wei-only)

```bash
cd ~/Documents/juneflow
# 0) ensure working tree clean first (commit/stash .gitignore + agents/journal/web.md on dev)
PIN=c7e18969
git merge-base --is-ancestor $PIN dev || { echo "ABORT: $PIN not on dev"; exit 1; }
git checkout main
git merge --squash -X theirs $PIN
git commit -m 'promote: batch 8 to main — Wave-1 web + Wave-2 GL/AP/bank (BE-17..19 + web) + i18n round (762→907) + migrations 0026/0027 · audited 8-dim GO · api 527 · web 485 · drift 3/3 · i18n 19/19'
git checkout dev
# verify tree identical (batch-2/3/4 pattern):
git diff --stat $PIN main   # expect EMPTY
```

**Gates green at pin `c7e18969`:** api 527/527 · web 485/485 · contract-drift 3/3 · i18n sacred 19/19 · migrations 0000–0027 additive · i18n 2-copy byte-identical · 0 Thai/฿ in changed .tsx.
