# B-323 · handover to the sacred re-baseline round

**Read this before touching `tests/visual/reference/**` or `screens.manifest.json`.**
Neither was modified by this round — `git diff --stat a6cd14f HEAD -- tests/visual/` is EMPTY.

---

## 1 · The measured moved list (STOP-line deliverable)

Real visual gate, fixed stack, against the CURRENTLY committed references.

**RE-MEASURED at rounds 3 and 4** — the table below is the round-2 run; the re-runs are
in §6 and §7. The ten FAILING rows are **pixel-identical across all three**, so neither
round 3 nor round 4 moved a baseline. Only the sub-threshold noise band changed
membership, exactly as this document already warned it does.

    round 2: rows compared: 99 · byte-identical: 85 · MOVED: 14 · FAILING the gate: 10
    round 3: rows compared: 99 · byte-identical: 86 · MOVED: 13 · FAILING the gate: 10
    round 4: rows compared: 99 · byte-identical: 86 · MOVED: 13 · FAILING the gate: 10

| screen | diffPx | ratio | verdict | why it moved |
|---|---:|---:|:--|---|
| pm-assets | 18,115 | 1.132% | FAIL | **new in round 2** — `/pm/assets` sorted (16-row scramble under merge join) |
| pm-schedule | 13,555 | 0.847% | FAIL | **new in round 2** — same read |
| pm-wo | 5,292 | 0.331% | FAIL | **new in round 2** — `/pm/workorders` sorted |
| pm-dashboard | 4,401 | 0.275% | FAIL | **new in round 2** — pm reads sorted |
| petty | 1,997 | 0.125% | FAIL | seed stamps (round 1) |
| dms | 1,286 | 0.080% | FAIL | seed stamps (round 1) |
| notifications | 1,195 | 0.075% | FAIL | seed stamps (round 1) |
| gr-list | 888 | 0.056% | FAIL | seed stamps + GR line order |
| gl-inbox | 800 | 0.050% | FAIL | seed stamps (round 1) |
| po-list | 188 | 0.012% | FAIL | seed stamps; the `/po` sort itself moved 0 further px |
| boq-editor | 13 | — | PASS | sub-threshold |
| boq-reports | 4 | — | PASS | sub-threshold, **flickers run to run** |
| line | 4 | — | PASS | sub-threshold, **flickers run to run** |
| sub-mine | 2 | — | PASS | sub-threshold |

Round 1 moved 9; round 2 moves 14. The four `pm-*` screens are the entire real delta,
and they are exactly where the negative control proved a live plan flip. Rows at ≤4 px
(boq-reports, line, gl-coa, sub-mine) are antialiasing noise and appear/disappear
between identical runs — do not read them as signal.

## 2 · Ten more screens changed ONLY inside Wei-approved masks

0 unmasked px each, so all ten PASS and none appear in the moved list. Stated here so
the sacred round is not surprised to see their pixels differ:

    admin-invoices 1295 · gl-jv 1281 · tax-etax 1094 · ar-tax 912 · ar-cn 561
    sub-billing 561 · ap-pv 552 · ap-retention 477 · app-shell 192
    (gl-coa 4 in the previous run; below noise, not always present)

## 3 · What the evidence does and does not cover

**Proven.** The seed is byte-reproducible across two fresh stacks over a 129 s wall-clock
gap, on EVERY `.defaultNow()` column (not just created_at/updated_at). Row order is
identical across three forced join plans on 26 endpoints, 20 of them joined lists — and
the same experiment with the sorts removed flips 8 of them, so it discriminates.

**Not proven.** 12 of the 20 joined endpoints did not flip in the reverted arm either.
Their sorts rest on the same mechanism and reasoning, but this run does not demonstrate
a flip for them. Unproven-but-defensible, not proven.

**Not covered by unit tests.** Order tests exist for po, wo, pm/assets,
dashboard/phase-progress, boq/:id/items, projects and gr lines. The other sorts
(pr, boq list, models, cost-centers, subcon ×4, pm ×3, bank ×2, dashboard ×2) have no
unit test — removing them leaves the suite green. The live order proof is their only
guard. **Round 3 narrowed this**: bank ×2 and ten previously-unguarded comparators now
have tie tests (§6). **Round 4 closes it differently** (§7): rather than another list of
hand-written tie tests, every `.sort` comparator under `apps/api/src` is now enumerated
and probed mechanically, so "has no unit test" is no longer the same as "unguarded" —
but read §7's blind spots, because the enumeration's reach is not the whole repo.

**Detail-endpoint LINE reads.** Round 2's scope statement covered the 20 unsorted
joined *listEnvelope* sites; a document's `lines[]` array is a different surface and
was silently outside it. Round 3 closes the two that were open — `transfer_line` and
`issue_line` (§6) — so the scope now reads: every no-`seq` line collection that ships
on a wire is ordered, and every writer of one stamps.

## 4 · Re-running the evidence

    bash agents/orch-b-recon/b323-two-seed-proof.sh fixed     # VALUES  (~6 min, 2 stacks)
    bash agents/orch-b-recon/b323-order-proof.sh    fixed     # ORDER   (~4 min, 1 stack)
    bash agents/orch-b-recon/b323-planflip-probe.sh           # mechanism (stack must be up)
    bash agents/orch-b-recon/b323-baseline-impact.sh          # moved list (stack must be up)

Every one of them refuses to report a pass it cannot justify: the values proof aborts if
the two seeds ran under 60 s apart, if the dump is under 700 rows, or if the widening
regressed to created_at/updated_at; the order proof aborts if fewer than 8 joined
endpoints carry ≥3 rows; the plan-flip probe aborts on a zero-row query.

---

## 5 · Round 3 · the reader/writer audit

Round 2's gate found `boq_item` was finding 4 committed a second time: the reader used
`entryOrder` and the writer did not stamp. `git grep stampEntryOrder` returned ONE call
site while `entryOrder` had four readers — a reader/writer pair that can drift is how
the defect got committed twice, so every pair was enumerated rather than spot-checked.

| table | `seq`? | reader | writer(s) | before r3 |
|---|:--:|---|---|---|
| `gr_item` | no | gr.ts:228, :425 | gr.ts:684 | STAMPED |
| `boq_item` | no | boq.ts:494 | boq.ts:605 · **ai-qto.ts:281** | **both unstamped** |
| `project_node` | no | dashboard.ts:590 | projects.ts:328 · project-nodes.ts:198 | **both unstamped** |
| `project` | n/a | projects.ts:163 | single-row create only | n/a (cannot tie) |
| `transfer_line` | no | inventory.ts:565 *(unordered)* | inventory.ts:823 | **both halves open** |
| `issue_line` | no | inventory.ts:607 *(unordered)* | inventory.ts:1257 | **both halves open** |

So a **third and a fourth pair existed**. `ai-qto.ts` writes into the same table `boq.ts`
does, and the `project_node` phase→unit ladder is written in one insert and read
top-down by the dashboard. Both are stamped now, along with the two inventory line
tables from finding 3 (ordered *and* stamped — same class, so ordering them was
preferred over declaring them out of scope).

`project-nodes.ts` reads the same table through `bySibling`, which tiebreaks on name and
would have survived the tie — which is exactly why the fix belongs on the WRITE side:
one reader was safe and the other was not, off one shared unstamped write.

**Still open (same class, no reader ordering them yet — not fixed, flagged):** `pr_item`,
`jv_line`, `ar_invoice_line`. All three are no-`seq` line tables written by a batch
`insertThrough` (e.g. inventory.ts:1276 `jvLines`), but nothing currently reads them with
`entryOrder`, so no wire order depends on them today. They become defects the moment a
reader orders them — which is precisely how `boq_item` happened.

## 6 · The tie-blind comparators — and why this section no longer publishes a count

**Read §7 first if you only read one thing.** This section is kept as the record of what
round 3 fixed; its headline claim was wrong and is corrected here.

Round 2 said "the 5 tie-blind helpers". The round-2 gate said 7, with 2 survivors. Round
3 re-derived by hand and published **"the real population is 10"** as the authoritative
number superseding both. It was wrong too — the round-4 gate found `labor.ts` attendance,
`dashboard.ts` cash-flow, `customers.ts` and `labor.ts` workers still tie-blind at HEAD,
and the mechanical scan round 4 then built found **13**, of which those four are a subset.

So the sequence of hand-counts reads 5 → 7 → 10 → 13, each published as complete, each
wrong. The lesson is not that the counters were careless — round 3's own reasoning about
WHY 5 and 7 were low (they enumerated named helpers; most of the population is inline
lambdas) was correct and still did not save it. **The lesson is that a number derived by
reading is not a property, and this class cannot be closed by looking harder.**

What follows is the round-3 table, left as-is. Take it as a record of ten sites that were
fixed, not as a census. §7 replaces the census with an enforced property.

| site | key | reported by gate? |
|---|---|:--:|
| `ap-cndn.ts:152` (local `newestFirst` shadow) | created_at | yes (survivor 1) |
| `ap-deposit.ts:183` (local `newestFirst` shadow) | created_at | yes (survivor 2) |
| `ap.ts:247` · `ap.ts:407` | created_at | no |
| `fa.ts:189` · `fa.ts:544` | created_at | no |
| `labor.ts:301` | created_at | no |
| `audit-log.ts:82` | `at` | no |
| `bank.ts:383` | `line_date` | no |
| `gl.ts:185` | created_at + `no` | no |

Three deserve calling out:

- **`audit-log` is the worst case.** Every mutation of ONE request is written under the
  same statement timestamp, so ties are the norm, not an edge — a single request's own
  entries could reorder between two reads of the same feed.
- **`bank` ordered on `line_date`**, a business DATE. A statement routinely carries
  several lines on one day, so this comparator returned 0 for most real input.
- **`gl` tiebroke on `no`, which is not a safe floor.** B-168 is an OPEN defect in which
  `allocJvNo` can mint a duplicate `jv.no`, so two distinct JVs can tie on both keys.

**The revert probe is why this section exists.** With all 10 restored to their tie-blind
form the full suite stayed **GREEN at 1492** — every one was an unguarded refactor, the
same trap round 2 hit with the `po.ts` sort. Ten tie tests were added, one per surface,
asserting both join-plan orders agree; re-probing now kills exactly 10.

### Re-measured evidence (round 3, `fc209af`)

    order proof      26/26 endpoints ORDER-STABLE across 3 forced join plans (20 joined)
    baseline impact  99 compared · 86 byte-identical · MOVED 13 · FAILING 10

The ten FAILING rows are **pixel-identical to round 2** (18115 / 13555 / 5292 / 4401 /
1997 / 1286 / 1195 / 888 / 800 / 188) — round 3 moved no baseline. The moved count fell
14 → 13 only in the sub-threshold noise band this document already flags as flickering
between identical runs: `boq-editor` 13, `boq-reports` 4 and `line` 4 dropped out;
`app-shell` 46 and `tax-etax` 4 came in. `app-shell` at 46 px is **the documented
expected value**, not a regression — screens.manifest.json's own B-160 note records
"with both rects every date shape measures 46 px = PASS".

---

## 7 · Round 4 · the enforcement that replaces the count

`apps/api/src/routes/list-order.enforce.test.ts`.

Four rounds of hand-counting produced four wrong numbers. Round 4 stops counting. The
test **enumerates** the `.sort(…)` / `.toSorted(…)` member calls in a non-test `.ts` file
under `apps/api/src` off the TypeScript AST, **materialises** each comparator (lifting it
to module scope, dragging in the module-level declarations it transitively needs, binding
`./list-order.js` imports to the real helpers), and **calls** it with two rows that are
identical on every property except one designated floor. A comparator that answers 0 for
that pair is tie-blind and fails the build, named with its file and line.

A new tie-blind `.sort()` written the ordinary way, anywhere under `apps/api/src`, fails
by default. Nobody has to remember to update a list, and no number is published. Three
unidiomatic spellings escape the matcher; they are blind spot 8 below, not a silent gap.

### The method, stated — with its blind spots

**It sees**

- every `.sort` / `.toSorted` call spelled as a plain member call (`xs.sort(…)`) in
  `apps/api/src/**/*.ts` (non-test): inline arrows, inline function expressions,
  identifier references to a module-level helper, and calls with no comparator at all
  (three other spellings are missed — blind spot 8);
- whether a comparator returns a finite, non-zero, antisymmetric result for rows that
  differ only in the floor (default `id`; an exemption may declare another);
- whether an exemption has gone **stale** — its comparator was edited or removed — which
  fails as loudly as a missing one, so a rewrite forces the reason to be re-read;
- whether a DB unique constraint an exemption leans on still exists in the drizzle
  schema (checked, not asserted in prose);
- whether a SQL `.orderBy(` has appeared — a second ordering surface this scan does not
  model, so it must break the build rather than pass unseen.

**It cannot see**

1. **Scope.** `apps/api/src` only. NOT `apps/web`, NOT `apps/mobile`, NOT `packages/db`
   (including the seed's own ordering), NOT tests.
2. **Non-`.sort` ordering.** `.reverse()`, manual insertion loops, `Object.keys()` and
   `Map` iteration order, SQL `ORDER BY`. (`.orderBy(` is separately asserted absent; the
   rest are genuinely invisible.)
3. **Indirection.** A comparator chosen at runtime, produced by a factory, or passed in
   as a parameter cannot be materialised → reported UNANALYSABLE → must be registered by
   hand, and that entry is then a human claim, not a proof.
4. **Closures.** A comparator reading a local of its enclosing FUNCTION cannot be lifted
   out and called. Also UNANALYSABLE. (One real case: the lambda inside
   `bySourceThenNewest`, which closes over its `sourceRank` parameter.)
5. **Uniqueness.** The probe proves a comparator DISCRIMINATES on the declared floor. It
   cannot prove that floor never repeats — that is a data fact. Where the claim rests on
   a DB constraint the registry names it and the test verifies it still exists; where it
   rests on construction (a Map key, an array index) the reason must be read and believed.
6. **Correctness.** Total ≠ right. Nothing here says a list is sorted the way the screen
   wants it, only that two runs agree.
7. **Its own deletion.** Measured, not assumed: delete the file and revert all 13 floors
   and the api suite drops just **3** tests. `list-order.test.ts` therefore carries a
   tripwire asserting the file exists and still parses/materialises/probes — so removing
   the mechanism fails somewhere else, but two deletions still remove the guard.
8. **Call shape and file extension.** The scan matches a CallExpression whose callee is a
   PROPERTY-ACCESS named `sort`/`toSorted`, in a file whose name ends `.ts`. Three shapes
   therefore pass unseen — each checked against that exact predicate, not assumed:
   computed-member access (`rows["sort"](cmp)` parses as an `ElementAccessExpression`, so
   `ts.isPropertyAccessExpression` is false), `Array.prototype.sort.call(rows, cmp)` (the
   callee's property name is `call`, not `sort`), and any `.mts` / `.cts` file
   (`"x.mts".endsWith(".ts")` is false, so the walker never opens it).
   **Deliberately not chased in code:** the repo has zero precedent (grep for computed
   sort access = 0 hits; `.mts`/`.cts` files tracked = 0) and all three need
   unidiomatic code to write, so this list is the fix — an honest blind spot beats a
   matcher grown for shapes nobody writes, and beats an "every `.sort`" claim that is
   false. Distinct from blind spot 2: that one is ordering achieved *without* `.sort`;
   these three ARE `.sort`, spelled so the matcher misses them.

### What it found

Run against the round-3 tree — the tree whose handover said the population was 10 — it
reported **13** tie-blind comparators. The gate's four (`labor.ts` attendance and workers,
`dashboard.ts` cash flow, `customers.ts`) are a subset; the other nine are
`opex.ts` budgets, `gl.ts` COA / periods / project-P&L, `boq.ts` groups / version history,
`wo.ts` and `subcon.ts` installment `seq`, and `evm-series.ts` periods.

Two deserve calling out, because both are worse than they look:

- **`labor.ts` attendance** ordered on `day`, a DATE, six lines above the payroll
  comparator round 3 fixed, in the adjacent function of the same file. An attendance
  register exists to record MANY workers on ONE date, so 0 was the normal answer. It
  survived three rounds because the **seed emits zero attendance rows** — no baseline
  moves, no live order proof reaches it, nothing fails. Its new test is a stubbed unit
  test for exactly that reason: a defect the seed hides cannot be caught by a seeded run.
- **`gl.ts` project P&L** ordered on `revenue` descending, and the comment three lines
  above it already said the seed has no non-zero revenue. Every project tied at 0, so the
  comparator returned 0 for the entire list, and the rows' Map came from a JOINED
  `jv_line` read — i.e. the fallback order was literally join-plan order.

### The fixes

Eleven end in `|| byIdAsc(a, b)` — a new one-line floor in `list-order.ts` that can only
decide pairs the business key already called equal, so no intended order changes. Two
have no id to fall back on: the cash-flow ladder tiebreaks on its own insertion index
(unique by construction, stripped before the wire, and reproducing exactly the permutation
a stable sort already produced), and the project P&L tiebreaks on `project_id`, its Map
key. Those two, plus `gl`'s two group-by comparators and the two bare `.sort()` calls over
Map keys in `feature-flags.ts`, are the six entries in the test's exemption registry —
each naming the key that closes the order and why it cannot repeat.

Note `opex.ts` and `gl.ts`'s COA/period reads could have been exempted on a real DB unique
constraint. They got the id floor instead: **a floor needs no argument, an exemption does.**

### Revert probes

Each of the 13 floors removed, one at a time — every one fails the enforcement test:

    customers name · labor workers · labor attendance · opex year+dept · gl coa ·
    gl periods · boq group seq · boq version · wo seq · subcon seq · evm period     1 each
    gl project P&L · dashboard cash-flow    2 each (tie-blind AND their exemption goes stale)

    labor.test.ts alone, attendance floor reverted        1 failed / 63 passed
    all 13 reverted, FULL api suite                       3 failed / 1503 passed*

And against the **mechanism itself** — if it cannot see a comparator deliberately broken,
it does not work:

    B1  a brand-new tie-blind .sort() planted in customers.ts   FAILS · named in the report
    B2  a comparator closing over a function local              FAILS · flagged UNANALYSABLE
    B3  a SQL .orderBy( planted                                 FAILS
    B4  the `ab === 0` check deleted, all 13 reverted           13 sites detected → 5
        (the other 8 are string comparators; the 5 that survive are numeric subtractions
        caught by the finiteness check instead — both assertions carry real weight)
        same edit against the FIXED tree                        0 failures (no false alarm)
    B5  the file walker blinded to routes/                      FAILS (count floor + stale)
    B6  a stale exemption planted                               FAILS
    B7  the unique constraint an exemption cites renamed        FAILS
    B8  byIdAsc neutered to return 0                            FAILS · all 11 delegating
                                                                sites reported tie-blind
    B9  the mechanism DELETED, all 13 reverted                  3 failed / 1502 passed
        (attendance test + both tripwires — this is blind spot 7, measured)

    * the revert-probe totals were taken before the four byIdAsc/tripwire tests landed,
      so they sum to 1506 rather than 1510. The FAILURE counts are the reading that
      matters and are unaffected: nothing added afterwards is sensitive to these reverts.

### Re-measured moved list (round 4)

Real gate, fresh stack built from THIS tree (`byIdAsc` verified present in the running
api image, not assumed), against the same committed references:

    round 2:  99 compared · 85 byte-identical · MOVED 14 · FAILING 10
    round 3:  99 compared · 86 byte-identical · MOVED 13 · FAILING 10
    round 4:  99 compared · 86 byte-identical · MOVED 13 · FAILING 10

The ten FAILING rows are **pixel-identical to rounds 2 and 3** —
18115 / 13555 / 5292 / 4401 / 1997 / 1286 / 1195 / 888 / 800 / 188. **Round 4 moved no
baseline.** That is the expected result and it was predicted: eleven of the thirteen
fixes are `|| byIdAsc`, which can only reorder a pair the business key already called
equal, and the other two reproduce the permutation a stable sort already produced.

The sub-threshold band changed membership again, in both directions, exactly as this
document has said it does between identical runs: round 3 had `app-shell` 46 and
`tax-etax` 4 in it; round 4 has `boq-editor` 13 and `line` 4 instead, with `sub-mine` 2
in both. `app-shell` and `tax-etax` did not improve or regress — they landed in the
mask-only bucket this run (175 and 1094 masked px, **0 unmasked**, PASS). Rows at ≤46 px
are antialiasing/date-shape noise; do not read them as signal in either direction.

**Gates (round 4):** api **1510** · db 19 · web 1765 · lint 12/12, all measured at the
committed SHA. (The two `fix(api)` / `test(api)` commit messages say 1506 — that was a
true reading taken before the four `byIdAsc` / tripwire tests were added to
`list-order.test.ts`, and it is stale rather than wrong. 1510 is the number at HEAD.
Left visible instead of quietly matched, because a round about unverified claims should
not carry one.)
`tests/visual/reference/**` and `screens.manifest.json` untouched — asserted by the
script's own scope check ("clean") and by `git status --porcelain -- tests/visual/`
returning empty after the run.

---

## 8 · Round 4 · the credential that was committed by accident

`agents/orch-b-recon/b323-proof/baseline-impact/state.json` was git-TRACKED and held a
live bearer token in a playwright `storageState`. Nobody chose to commit a credential —
`b323-baseline-impact.sh` wrote its auth state to `$OUT`, and `$OUT` happens to be the
tracked evidence directory.

- **Untracked and deleted** from the working tree.
- **The script no longer writes credentials into the repo at all**: the state file is a
  `mktemp` 0600 file removed by the exit trap.
- **The shape is gitignored** (`*state.json`, `*storage-state.json`, `*auth-state.json`),
  so the next script that forgets cannot commit one either. No tracked file matches these
  patterns, so nothing existing is shadowed.
- **Sweep — instance or pattern?** Pattern check first: every sibling live-gate script
  (`full-rebaseline.sh`, `live-g5-batch8.sh`, `live-g5-finance.sh`, `phase4-g5-*.sh`)
  already writes its state file to `/tmp` or a scratch dir. `b323-baseline-impact.sh` was
  the lone outlier. Then a value scan over **every tracked file in the repo** for bearer
  tokens, `"value": "<20+ chars>"`, `set-cookie` and private-key headers: the only hit
  carrying an actual secret VALUE was that one file. Every other hit is the *name*
  `juneflow-token` (the app's own localStorage key, in `apps/web/src/auth-token.ts` and
  the visual-gate config) or the dev seed password `juneflow-dev`, which is documented in
  three tracked files and is what mints the token in the first place.
- **Honest limit:** git history still contains the token — untracking does not rewrite it.
  It is a per-run login token against a disposable local compose stack that has since been
  `down -v`'d, minted by a password already in the repo, so it grants nothing that the
  seed password did not already grant. No rotation applies to a local dev stack. If that
  reasoning is not acceptable, the fix is history rewriting, which is a separate decision.
