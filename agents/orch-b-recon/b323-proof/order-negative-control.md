# B-323 · the ORDER experiment and its negative control

Round 1's headline experiment never discriminated ORDER (round-2 gate finding 2):
`order-*.txt` printed `id created_at`, so timestamp drift alone produced "DIFFERS",
and the id sequence alone was identical in both arms. It passed with the ordering fix
and would have passed without it.

`b323-order-proof.sh` replaces it. It compares the **id sequence alone**, timestamps
stripped, across three FORCED join plans on one stack — so the experiment can fail on
demand instead of waiting for a planner to change its mind.

## Corroborating mechanism (DB level, correct tenant)

    the raw PO chain — selectThrough's SQL, no ORDER BY
    default    PO-2026-0291 PO-2026-0290 PO-2026-0289 PO-2026-0288 PO-2026-0287 PO-2026-0286
    mergejoin  PO-2026-0287 PO-2026-0291 PO-2026-0286 PO-2026-0288 PO-2026-0290 PO-2026-0289

## FIXED arm — `order-fixed/`

    endpoints compared : 26  (joined controls: 20)
    SKIPPED as vacuous : 2      pm/quotes (0 rows) · notifications (2 rows)
    ORDER-STABLE — every one of 26 endpoints returned the IDENTICAL id sequence
    under all three join plans (20 of them joined lists).

## REVERTED arm (negative control) — `order-reverted/`

Ordering calls stripped from every handler; the seed-determinism half left fully
intact, so the artifact isolates the ordering fix and nothing else.

    ORDER-FLIPPED on 8 endpoint(s):
      po  wo  gr  acceptance-center?type=gr
      pm/contracts  pm/assets  pm/workorders  dashboard/phase-progress

    po   default    2f915e86 7e06db48 a20ebfcd 8f1f5524 b01173b6 667f71b0
         mergejoin  b01173b6 2f915e86 667f71b0 8f1f5524 7e06db48 a20ebfcd   <-- flipped
         nestloop   2f915e86 7e06db48 a20ebfcd 8f1f5524 b01173b6 667f71b0

    gr   default    d55d193c a34683bf 66a63ffb 279aaf23 dd4c1303
         mergejoin  d55d193c a34683bf 279aaf23 66a63ffb dd4c1303            <-- flipped
         nestloop   d55d193c a34683bf 66a63ffb 279aaf23 dd4c1303

`dashboard/phase-progress` flipping is the evidence for the derived-row decision: its
rows carry no id and no created_at, so ordering them after the fact is impossible and
the sort had to move onto the source read.

## What this experiment does NOT prove

12 of the 20 joined endpoints did not flip in the reverted arm either. Their sorts
rest on the same mechanism and the same reasoning, but THIS run does not demonstrate a
flip for them — the planner simply did not choose a different strategy for those query
shapes at this data size. Recorded as unproven-but-defensible, not as proven.
