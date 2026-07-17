# live-G5 finance round — readiness (fire after B-095)

> **orch-B QA lane** · staged 2026-07-17 · runnable: `agents/orch-b-recon/live-g5-finance.sh <fixed-dev-SHA>`
> **Precondition (only one):** B-095 packaging fix merged to dev → the api boots in the prod image. The script's `docker compose up --wait` (step 4) **is** the B-095 gate: if api never turns healthy, B-095 isn't fixed on that SHA.

Everything else is resolved and staged below — after the fix lands, this is a single command.

---

## Target screens (7 Wave-2 finance) — all references present, **0 NEW-REF needed**

| Screen | route | reference | ref exists |
|---|---|---|---|
| GL · COA | `gl.coa` | `gallery/g5/08-s.jpg` | ✅ |
| GL · JV | `gl.jv` | `gallery/g2/02-s.jpg` | ✅ |
| AP · Billing | `ap.billing` | `gallery/g2/07-s.jpg` | ✅ |
| AP · PV | `ap.pv` | `gallery/g2/08-s.jpg` | ✅ |
| Bank · Cheque | `bank.cheque` | `gallery/g2/14-s.jpg` | ✅ |
| Bank · Recon | `bank.recon` | `gallery/g2/15-s.jpg` | ✅ |
| Bank · Export | `bank.export` | `gallery/g2/16-s.jpg` | ✅ |

Mapping is authoritative in `tests/visual/reference-index.md`. Because all 7 refs already exist, there is **no prototype-capture / NEW-REF / Wei-approval step** — the round is pure compare.

## Mask strategy
- masks = `["sidebar-logo-b044"]` (the standard logo-lockup mask every shell screen carries — B-044).
- **NOT** `content-area-b048`: these bodies **are** ported (they're not shell-only), so we compare the **full body** — that is exactly the "live-pixel" signal that's still pending. (The earlier structural-G5 pass masked the body; this round unmasks it.)

## What the round proves / catalogs
The bodies ship **honest em-dash** where Wave-2 data isn't wired/seeded yet. So a full-body compare on the live seeded stack yields, per screen:
- **Chrome + layout + token + KPI/tab positions** → must **PASS** (the real regression gate on the live stack).
- **Body diffs** → a **data-wire completeness catalog**: which fields now render real seed data vs which are still em-dash (known gaps like `gl.coa` group/balance/active). Allowed-to-differ = seed numbers only (PLAN.md §0). A body diff that is a *layout/label/token* change = a real bug to file; a body diff that is *em-dash vs data* = a tracked data-wire gap, not a regression.
- Diff PNGs land in `agents/orch-b-recon/live-g5-finance-results/` for eyeball adjudication.

Verdict per screen goes to `REVIEW-QUEUE.md` (orch-A owns the board write; orch-B supplies the shot↔ref↔verdict lines).

---

## How it runs (all staged in the script)

1. **Throwaway worktree** pinned to the fixed dev SHA — never touches the live dirty dev checkout or the 40-commit-stale feature/qa.
2. **Isolated compose** — `COMPOSE_PROJECT_NAME=juneflow-g5fin`, offset ports `POSTGRES_PORT=5434 · REDIS_PORT=6381 · API_PORT=3101 · WEB_PORT=5273`. Zero collision with orch-A or the E2E lane (5433).
3. **`up -d --build --wait`** — rebuilds images from the fixed tree; `--wait` blocks on healthchecks → the api `/health` gate = **B-095 proof-of-boot**.
4. **Auth injection** (capture mode has no login step): `POST /api/v1/auth/login` as seed user **`wipha@rungrueang.co.th` / `juneflow-dev`** (MD/Director L4 — sees every screen) → `{token}` → written into a Playwright `storageState` as localStorage key **`juneflow-token`** (from `apps/web/src/auth-token.ts`) for origin `http://localhost:5273`. Config is patched (throwaway only) to read `storageState` from `VISUAL_STORAGE_STATE`.
5. **Gate** — `VISUAL_BASE_URL=http://localhost:5273 pnpm --dir tests run test:visual` → capture mode navigates `/#/<route>`, full-page screenshot, jpg-aware diff vs reference (strict `VISUAL_MAX_DIFF_PIXEL_RATIO=0`).
6. **Collect + teardown** — copies `.results/` (diff PNGs + report) out, then `down -v` + removes the worktree (trap-guarded on any exit).

## Gotchas already handled
- **C-068 (VITE_API_BASE_URL empty→"/api/v1")** does **not** apply here — that was the `pnpm dev` path. The full compose stack self-wires web→api (nginx in apps/web image), the same path live-G5 rounds 1-4 used. We use the compose stack, not `pnpm dev`.
- **reference/ read-only** — the harness only reads it; the script never writes under `reference/`.
- **Shared image tags** (`juneflow-api:dev` etc.) get rebuilt/overwritten — benign when no other stack is running (E2E-lane precedent). If orch-A is running a stack, run this when they're idle or it will rebuild their tags.
- **Auth token expiry** — token is minted at run time, used immediately; no staleness.

## Not covered (by design)
- Only the 7 finance screens. The other ~18 batch-8 review screens (BOQ/PR/PO/WO/GR/master.vendor/dashboard) were live-G5'd in rounds 1-4 (0 regression). A wider re-run can reuse this script by adding their manifest rows.
- gl.inbox/trial/statements/etc. and bank are **screens** here but several finance bodies are stubs → expect body diffs (catalog, not gate-fail).

---

---

## FULL batch-8 sweep — `live-g5-batch8.sh` (~28 screens, superset of the finance 7)

For a comprehensive pre-promote regression sweep (not just finance), use `agents/orch-b-recon/live-g5-batch8.sh`. It builds the manifest at run time by parsing `PORTED_SCREENS` (router.tsx) × `reference-index.md` — **self-updating, no hand-transcribed refs** — and sweeps every ported screen + dashboard + users (login excluded: pre-auth screen redirects when a token is injected). Isolated on its own project/ports (`juneflow-g5b8` · 5435/6382/3102/5274) so it can even run after the finance one.

### Screen inventory (~28) and expected outcome
| Group | Screens (route → ref) | Expected |
|---|---|---|
| **Already on main** (regression re-check) | dashboard g1/01 · boq.list g1/08 · master.company g2/28 · master.ptype g2/29 · master.project g2/32 · master.model g2/33 · master.cc g2/34 · master.docnum g2/35 · users g2/36 | **full PASS** (chrome+body) — a FAIL = Wave-2 regressed a shipped screen (highest-priority signal) |
| **BOQ review** | boq.overview g1/07 · boq.editor g1/11 · boq.bom g1/10 · boq.approval g1/12 · boq.archive g1/13 · boq.reports g1/14 · boq.aiqto g1/09 | chrome PASS · body = data-wire catalog (some engines stubbed) |
| **Procurement review** | pr.list g1/15 · po.list g1/16 · wo.list g1/17 · gr.list g1/18 | chrome PASS · body catalog (known thin fields B-074/075) |
| **Master review** | master.vendor g2/30 | chrome PASS · body catalog |
| **Finance review** (Wave-2) | gl.coa g5/08 · gl.jv g2/02 · ap.billing g2/07 · ap.pv g2/08 · bank.cheque g2/14 · bank.recon g2/15 · bank.export g2/16 | chrome PASS · body catalog (honest em-dash) |

### Reading the result
- **A promoted screen that FAILs = a real regression** → file it, blocks promote.
- **A review screen chrome-region FAIL** (sidebar/topbar/layout/token) = a real bug → file it.
- **A review screen body diff** = em-dash-vs-data → tracked data-wire gap (not a regression); layout/label/token diff in the body = a bug.
- Per-screen diff PNGs + verdict report land in `agents/orch-b-recon/live-g5-batch8-results/`.

---

## Fire commands (post-B-095)
```
# finance-only (7 screens, fast):
bash agents/orch-b-recon/live-g5-finance.sh <fixed-dev-SHA>

# FULL batch-8 regression sweep (~28 screens):
bash agents/orch-b-recon/live-g5-batch8.sh <fixed-dev-SHA>
```
Then read the `*-results/` dir and post per-screen verdicts to the channel for orch-A to record in REVIEW-QUEUE.md. Recommended: run the **full sweep** for the promote gate; the finance-only script is the quick re-check if only finance changes.
