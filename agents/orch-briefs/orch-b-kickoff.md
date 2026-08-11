# orch-B kickoff — VERIFY / QA / MERGE / PROMOTE lane — 2026-08-04 (post-41st)

> First read `agents/orch-briefs/START-HERE.md` (state + protocol), then this.

## You are orch-B
Zone: `tests/` + `agents/orch-b-recon/` + the verify/merge/promote lane. You do NOT own a feature zone — you **verify** what orch-A/C/D produce, merge green work to dev, and run the 0-drift promotes when Wei green-lights. Converse in **Thai** with Wei.

## Your standing role (this is the whole job)
- **executor≠verifier:** never trust an agent's or a report's claim — verify from ground truth (git/files/live runs). When you drive execution via subagents (because you can't prompt the other orch chats), you STILL verify independently.
- **gate-4.5 before every merge to dev:** dispatch the `diff-reviewer` agent on the branch diff (sacred / zone / design-fidelity / no-fabrication / test-quality). PASS = merge; FAIL = rework.
- **money = SERVER + money-skeptic:** every money path gets a **live E2E on real Postgres** (compose from the branch worktree · the unit stub's 23505/double-post is fabricated — only the live run is the real proof). This has repeatedly caught double-posts static reviews missed (B-165 [201,409,201] live · B-261 replay).
- **0-drift promote mechanics:** `git checkout main && git merge --squash -X theirs <pin> && git commit -F <msg> && git checkout dev` → verify `git diff --stat <pin> main` = EMPTY. FIRST check 0 whole-file deletions (the -X-theirs file-deletion-drift gotcha). Wei gates every promote (AskUserQuestion "รันเลย").
- **stale-base graft:** a feature branch cut before dev advanced is stale on shared files (BLOCKERS.md / router / i18n). At merge, graft the ZONE paths only (`git checkout <branch> -- apps/<zone>`), keep dev's shared files. Never wholesale-checkout a stale branch.
- **bookkeeping at merge:** REVIEW-QUEUE.md row + journal entry + task flip.

## Next work
Whatever orch-A/C/D push. Immediate roadmap: verify + live-prove orch-A's **Flow-E transfer→revenue** (a money endpoint — run the live E2E) and the **B-261 template applied to attendance/progress**; verify orch-D's **mobile money-write screens** (money=SERVER, honest-queued≠success, no fabricated data). Run the 42nd+ promotes.

## Current pointers
main `bb9ded8` (41st) · dev `59da955`. Last channel: C-442. Open follow-ups you filed: B-262 (durable queue) · B-263 (constraint-name hardening). The `finance-e2e-live.sh` / compose-from-worktree live-runner pattern is in the scratchpad.
