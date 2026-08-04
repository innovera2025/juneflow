# START-HERE — read this FIRST when you open a new Juneflow chat (any orch, any model)

You are one of four coordinating orchestrator sessions on **Juneflow** (multi-tenant Construction ERP + Subscription SaaS · monorepo `apps/{api,web,mobile}` + `packages/*`). Wei owns rulings + the main-promote gate. This doc bootstraps a fresh chat — read it, then your per-lane kickoff, then the live state.

## 1. Read these to load context (in order)
1. Root `CLAUDE.md` + `apps/<your-zone>/CLAUDE.md` — the iron rules (pototype = law · sacred files · zones · Done = 5 gates).
2. `PLAN.md §0` (Design Fidelity Protocol) + the section for your phase.
3. **Your memory** — the auto-loaded `MEMORY.md` index → open `juneflow-bootstrap-state.md` and read the **LATEST-20** checkpoint (the current running state) + `juneflow-artifacts.md` (the 2 dashboards).
4. **`agents/channel.md`** — read the TAIL (latest = C-442 session-close handoff). This is the untracked, filesystem-shared coordination log between all 4 orchs.
5. **The board:** `REVIEW-QUEUE.md` (promote banners 1-41 + green-on-dev queue) · `BLOCKERS.md` (Wei rulings + open questions B-242..263) · `agents/journal/{backend,mobile,web}.md`.

## 2. Current state (2026-08-04, point-in-time)
- **main = `bb9ded8` (41st 0-drift promote)** · dev = `59da955` · verify lane clear · working tree clean.
- **Project ≈ 85% of a web-first MVP · 71% of the full vision** (measured from files, 6-agent workflow). Per-dim: backend 90 · web 94 · foundation 89 · flows-A-G 79 · **mobile 34** (the biggest runway).
- This past session (orch-B drove) landed **promotes 38-41**: MOBILE LANE → approval FLOW → offline-write foundation (SyncProcessor level-(ก)) → **B-261 money-write idempotency contract** (the canonical template for CREATE money-writes). All detail on the board.

## 3. The 4 lanes — identify yourself
| orch | zone | owns |
|---|---|---|
| **orch-A** | `apps/api` + `packages/db` + `packages/contracts` | backend, DB, OpenAPI contract, migrations, GL/JV money-posting |
| **orch-B** | `tests/` + `agents/orch-b-recon/` + verify | **verify/QA/merge/promote lane** — executor≠verifier · gate-4.5 · money-skeptic live-E2E · runs the 0-drift promotes (Wei-gated) |
| **orch-C** | `apps/web` | web screen ports (prototype-faithful · tokens · i18n · G5 visual gate) |
| **orch-D** | `apps/mobile` | Flutter mobile (screen ports · offline SyncProcessor · geolocator) |

Read your `orch-<x>-kickoff.md` for your specific next work.

## 4. Coordination protocol (all lanes)
- **Channel mutex:** before touching a shared file / claiming work, append a `CLAIM` to `agents/channel.md` (read the tail first). `RELEASE` when done. One agent = one zone = one worktree.
- **Merge flow:** `feature/** → dev` (orch-B verifies: gate-4.5 PASS + the zone's gates + money-skeptic live-E2E for money paths) `→ main` (Wei promotes; orch-B may run the mechanics when Wei green-lights). Every promote is **0-drift**: `git merge --squash -X theirs <pin>` then `git diff --stat <pin> main` must be EMPTY (check 0 whole-file deletions first).
- **Sacred files** (openapi.yaml · merged migrations · CLAUDE.md · CI · i18n-full.json · docs/extract/*): change ONLY with a Wei-ratified ruling → `SACRED_OVERRIDE=wei-approved:B-xxx`; the orchestrator applies sacred edits via Bash targeted-insert (the Edit tool is hook-blocked).
- **Never guess** a design/spec conflict → write a `BLOCKERS.md` entry + skip. **money = SERVER** always. **executor≠verifier** — whoever builds does not solely verify.
- **Path-scope every commit** on the shared dev checkout (`git commit -- <files>`, never bare/`-a`) — a bare commit sweeps another orch's staged files.

## 5. Roadmap — what's next (from `juneflow-roadmap` artifact)
- **P1 (close MVP):** Flow-E ownership-transfer→revenue-recognition endpoint (orch-A · the spine gap) · auth production flows (orch-A) · Wave-4-selective master-data (orch-A, only ops with a consumer — reports/hub is speculative, skip).
- **P2 (biggest runway — mobile money-write wave):** field-GR screen (orch-D · POST /gr is B-261-ready) → attendance/progress (orch-A applies the B-261 template to those endpoints, then orch-D builds) → durable queue B-262 → the 17 remaining mobile screens.
- **P3 (flow depth):** subcon autosplit periods · land persist · package-gating middleware · 4-project-type depth.
- **P4 (deferred, trigger-based):** i18n content · external integrations (LINE/e-tax/AI-QTO) · Wei-deferred web · DB RLS · CI/CD.

**KEY carry-forward: B-261 is the money-write idempotency TEMPLATE** — every mobile CREATE money-write needs a client `idempotency_key` column + PARTIAL unique index + 23505-catch-return-original (mirror B-167 / see `apps/api/src/routes/gr.ts` + migration 0056). The natural-key jv_source_doc guard only covers ACTION writes.
