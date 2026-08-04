# orch-B Overnight Verify Protocol — 2026-08-03 night → 2026-08-04 morning

**Posture:** event-driven autonomous verify lane. Wei is asleep, reviews in the morning.
Persistent monitor `b8wh9kfhz` watches `agents/channel.md` + feature branches → wakes me on
each hand-off. I verify against ground truth ALWAYS (never trust an orch's report).

## Per hand-off gauntlet (by lane)

**BACKEND (orch-A):** slice PER-COMMIT (never merge feature/backend tip — far-drift carries
already-merged commits; use two-dot `git diff main dev` to find real net-new) → gate-4.5
money-skeptic → `b223-api-suite.sh` (db+api typecheck + full api vitest) → **live E2E money-proof**
on real PG (`finance-e2e-live.sh <sha> <filter>`) for ANY money path (balanced JV + directions +
live double-post rejection on the source_doc partial-unique index). Money is never "done" on a
unit stub — the 23505 must be live-proven (B-217/B-165 lesson).

**WEB (orch-C):** staleness-check → `cherry-pick -n` graft (router.tsx + i18n ADDITIVELY, never
wholesale `git checkout branch -- <shared>` — drops merged screens) → zero-Thai grep on the
screen .tsx/.ts → i18n keys resolve (dict+nav+phrases, 0-mint) → `phase6-gates.sh` (web tsc +
vitest + check:routes) → gate-4.5 → G5 (first-capture; a detail-via-internal-nav form with no
first-doc fallback is G5-EXEMPT per the gr-create-form precedent — document, don't fabricate an
empty-state baseline).

**MOBILE (orch-D):** independent gate-4.5 on the TIP (orch-D self-reports; re-verify the tip, not
an older reviewed commit) → `flutter analyze` + `flutter test` (run the toolchain, don't trust the
count) → i18n-guard zero-Thai-in-lib → **asset-drift test green** (regen `tool/gen_i18n_asset.sh`
against dev's CURRENT sacred if the branch built at an older merge-base; fix any stale sha in the
REVIEW-QUEUE row) → mobile-G5 vs the MOB-REF-01 Fiori reference.

## Sacred discipline overnight (the load-bearing rule)

- **PRE-AUTHORIZED (verify + apply autonomously):**
  - Mobile i18n apply.json under **B-240 approval-group** (Wei ruled the flow: orch-D drafts →
    orch-B verifies byte-exact 0-existing-value-change → applies via `SACRED_OVERRIDE=wei-approved:B-240`
    to BOTH i18n-full.json copies → regen mobile asset → flutter test). Apply, then merge.
  - Web ports that CONSUME existing i18n/contract (no mint, no new openapi) — merge to dev.
- **HOLD for Wei's morning ruling (verify fully, stage, do NOT merge the sacred part):**
  - Any NEW `openapi.yaml` path or NEW migration (backend endpoints) — the petty precedent needs a
    per-change Wei go. Verify + gate-4.5 + live-proof, then park as "verified · awaiting sacred-go".
  - Any i18n MINT beyond the B-240 approval-group batch (new web keys, mobile batch-2) — verify the
    draft apply.json byte-exact, but HOLD the apply for Wei.
  - `B-168` allocJvNo SACRED migration (uniqueIndex + retry) — needs Wei approve.

## Promote discipline overnight

**Do NOT promote.** Wei reviews in the morning. Accumulate verified work on dev; keep the running
ledger below. Propose the promote(s) in the morning with the full picture (0-drift dry-check first).

## Running ledger (append as I verify)

| time | lane | item | verdict | action |
|------|------|------|---------|--------|
| (start) | — | verify lane CLEAR post-34th-promote | — | waiting for hand-offs |

## Morning report to Wei (assemble at wake)

1. Everything verified overnight (per lane) + merged-to-dev vs held-for-sacred-go.
2. Proposed promote (35th) delta + 0-drift dry-check.
3. Wei-decision queue: sacred-gos (openapi/migration/i18n-mint) + B-243/B-244 + any new BLOCKERS filed.
4. Anything an orch got stuck on (BLOCKERS.md new rows) + the cross-lane deps.

## LEDGER (overnight actual)
| time | lane | item | verdict | action |
|------|------|------|---------|--------|
| n1 | web | subcon.handover | gate-4.5 FAIL→rework(fieldMethod→colMethod)→PASS + phase6 green | MERGED dev 95733a6 (G5 batch-AM) |
| n2 | web | ap.deposit | gate-4.5 PASS code (money=SERVER confirmed) · 19-key i18n mint needed | HELD for Wei AM mint (riders: mint + router-graft-additive + bookkeeping) |
| n3 | web | notifications·po.form·wo.form | Wave-2 executing (a057b1f5·a67ecddb·a20141bc) | porting |

## HELD-for-Wei queue (assemble into AM report)
- **ap.deposit i18n mint** — 19 new phrase keys (verbatim Thai from ap.jsx · apply.json = handoff manifest at agents/orch-b-recon/ap-deposit-i18n.apply.json). Needs: real B-id + re-key by Thai value + th-fallback {th,en,zh,ar}=th (B-035 precedent). Then orch-B applies sacred → ap.deposit merges (router graft additive onto current dev, NOT wholesale — preserves subcon.handover).

## LEDGER update (n4-n6)
| n4 | web | wo.form | gate-4.5 code-PASS · FAIL-router-only → orch-B re-grafted router additive · phase6 green | MERGED dev 01b38c2 (G5 batch-AM) |
| n5 | web | notifications | gate-4.5 code-PASS · 5-key mint needed (B-257 unratified) · apply.json ready | HELD for Wei AM mint |
| n6 | web | po.form | gate-4.5 FAIL (back-button common.back "ย้อนกลับ" vs prototype "กลับ" → pr.form.back) + 2 notes | reworking (agent) |

## MINT BATCH for Wei AM (assemble into one sacred round)
- **ap.deposit**: 19 phrase keys (apply.json agents/orch-b-recon/ap-deposit-i18n.apply.json · override placeholder B-XXX)
- **notifications**: 5 phrase keys (apply.json agents/orch-b-recon/notifications-i18n.apply.json · B-257 unratified)
- → assign clean sequential B-ids, expand each phrases entry en=zh=ar=th fallback, apply to BOTH copies on CURRENT dev, then graft the held screens (router additive) + merge.

## LESSON (overnight): worktree-isolation assigns a STALE base (fed4117)
Execute-agents get a worktree at an old HEAD, not current dev. Some rebase (po.form did); some don't (wo.form/subcon router stale). At merge orch-B ALWAYS re-grafts router.tsx/i18n additively onto CURRENT dev (never wholesale-checkout a stale shared file — would drop 60 routes). Future waves: instruct agents to `git rebase dev` or base explicitly on current dev tip before committing.

## LEDGER FINAL (n7-n10)
| n7 | web | wo.form | (see n4) MERGED 01b38c2 | ✅ |
| n8 | web | po.form | gate-4.5 FAIL→rework(back-btn/bold/save-stay)→PASS · router conflict-vs-wo.form resolved additive · phase6 green | MERGED cf03498 (B-245 double-PO filed) |
| n9 | web | petty | gate-4.5 code-PASS (money=SERVER · no-fabrication 9-gaps · PettyCash-only) · 35-key mint (apply.json N1 drop-15-dups + N2 real-id) | HELD for Wei AM mint |
| n10 | web | opex | BLOCKED §0 (prototype richer than backend · used/committed/actual/4-year absent) — agent escalated correctly, no fabrication | B-246 filed · Wei ruling (thin-honest ข recommended) |

## MINT BATCH FINAL for Wei AM (one sacred round · 59 keys)
- ap.deposit: 19 keys · notifications: 5 keys · petty: **35** keys (petty.apply.json has 50, DROP 15 already-present, mint 35)
- assign clean B-ids (real max=B-246 → B-247 ap.deposit · B-248 notif · B-249 petty, OR one combined mint-round id); expand each phrases entry en=zh=ar=th; apply BOTH copies on CURRENT dev; then graft each held screen (router additive) + phase6 + merge.
