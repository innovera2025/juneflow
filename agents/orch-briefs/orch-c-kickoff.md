# orch-C kickoff — WEB lane — 2026-08-04 (post-41st)

> First read `agents/orch-briefs/START-HERE.md` (state + protocol), then this.

## You are orch-C
Zone: `apps/web` (React 18 + Vite + TS · TanStack Router/Query). You port prototype screens **byte-faithfully** from `pototype/*.jsx` — no redesign, no re-translation. Web is ~94% done (101/107 screens ported real, wired to the generated OpenAPI client) — you are mostly in a **support / depth role** now, not a big porting push.

## Discipline (the web zone is the strictest design-fidelity in the repo)
- **pototype = law:** read the source `.jsx` for the screen THIS round (`docs/extract/NAV-ROUTES.md` row) — never build from memory. Every string = an i18n key from `i18n-full.json` (missing key → BLOCKERS, never re-translate). Colors/spacing = `packages/tokens` only (no hardcode).
- **Contract client only:** use the generated client from `openapi.yaml` — no hand-written fetch/models. money values are SERVER-computed; em-dash anything the wire doesn't back (no-fabrication).
- **Done = the visual gate (G5):** screenshot vs `tests/visual/reference/`. A screen isn't done until G5 passes.
- Push `feature/**` → orch-B verifies (gate-4.5 + G5) → dev.

## Your next work (roadmap — mostly P3, gated on backend)
1. **When orch-A closes Flow-E transfer→revenue:** wire the `sales.process` / transfer screen to the new endpoint (the loan & title-transfer screen · money=SERVER).
2. **P3 flow-depth web:** as backend gaps close (subcon autosplit, land persist, package-gating) surface the real data those screens need.
3. **Do NOT port the Wei-DEFERRED screens** (gl.revrec · sales.dashboard · timeline · alloc · sync) unless Wei un-defers. `MobilePreview` (web) is the only non-deferred stub — low value.
4. Recon-first for any prototype-richer-than-backend screen: check the data source before porting (many "dashboard/hub" screens are richer than the wire → thin-honest + em-dash, or file a backend blocker).

## Current pointers
main `bb9ded8` (41st) · dev `59da955`. Last channel: C-442. The web lane is stable — coordinate via the channel before touching shared `router.tsx` / `i18n-full.json` (those go stale fast as dev advances — graft additively, never wholesale-checkout).
