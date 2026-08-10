/*
 * Screen -> write-wire binding tests (gate G3, B-291 source-reading precedent).
 *
 * WHY THIS FILE EXISTS: the request-shape tests next door (use-admin.test.ts,
 * use-land-bank.test.ts) prove the hooks call the right endpoint with the right params and
 * nothing else. They do NOT prove any screen calls them. That gap is exactly the defect
 * this round closed: admin.subs had a fully-correct, fully-mounted reset-password endpoint,
 * a generated client for it, and a confirm dialog that fired the success toast and called
 * NOTHING. Every gate was green.
 *
 * The screens are .tsx and pull in the shell/router, so they cannot be imported in this
 * node/no-DOM vitest env — router-wiring.test.ts hit the same wall and reads router.tsx
 * from source. Same technique here, scoped to the two controls this round turned on, the
 * one display guard it changed, and ALL SEVEN retired false claims.
 *
 * SEVEN — and the count is now given WITH THE LIST, because stating it as a bare number has
 * been wrong twice. The first version pinned three while its own two comments disagreed
 * about how many there were; the second pinned six and mis-sorted one of them (below); this
 * one pins seven. Under-covering here is not cosmetic: a rebase or a partial revert restores
 * one unpinned comment, the suite stays green, and that screen reads as backend-blocked to
 * every subsequent audit — the exact regression this file exists to prevent.
 *
 * The seven split into two shapes, which need different assertions:
 *   - THREE are deleted outright, so an absence check is the right tripwire: land-pipeline's
 *     dropped-mock-advance claim, land-pipeline's "Export has no endpoint" HEADER claim
 *     (retired 2026-08-10 — the correction had reached the button comment and NOT the file
 *     header, which is where a ported screen declares its write posture, so the screen
 *     contradicted itself 400 lines apart), and admin-subs'.
 *   - FOUR survive as a QUOTATION inside the correction that retired them ("X" was FALSE).
 *     An absence check is wrong for those — it would fail on the correction itself — so they
 *     assert instead that every occurrence of the claim is inside quotes, plus that the
 *     replacement FACT is stated.
 *
 * master-project MOVED from the first bucket to the second on 2026-08-10, and why it had to
 * is the whole argument for this file. Its claim was NEVER deleted: it survives verbatim at
 * master-project.tsx as a quotation, and the absence check "passed" ONLY because the claim
 * wraps across a line break. Proven by mutation, both directions:
 *   - revert to dev's exact one-line wording  -> RED, dies correctly;
 *   - restate the claim as unquoted FACT, wrapped across two lines -> GREEN, SURVIVED.
 * These comments are hand-wrapped at ~95 columns, so a restored claim wrapping is the likely
 * case, not the exotic one. The mirror failure is as bad: reflow the correction so the
 * quotation lands on one line and the suite goes red with no defect present, which trains the
 * next reader to delete the probe.
 *
 * EVERY comparison in this file therefore runs over FLATTENED text, never raw source, and
 * which flattener matters. A star-gutter block header takes `prose` (strip the gutter, then
 * collapse). master-project's JSX brace-comments carry no gutter, so they take the plain
 * `collapse` — running `prose` over them would be a guess about a file it does not describe.
 *
 * These are deliberately narrow string assertions. They are not a substitute for a DOM
 * test; they are a tripwire on the one edit that would silently un-wire a control again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/**
 * All whitespace collapsed to single spaces, so a sentence that wraps across two lines
 * matches as one. Without this a claim only has to WRAP to escape the tripwire — which is
 * not a property anybody chose, it is an accident of reflow at ~95 columns.
 *
 * This is the right flattener for JSX brace-comments, which carry no gutter to strip.
 */
function collapse(src: string): string {
  return src.replace(/\s+/g, " ");
}

/**
 * `collapse`, plus the leading `*` gutter of a star-style block comment. Only for files
 * whose comments carry that gutter; a file without one takes `collapse` directly.
 */
function prose(src: string): string {
  // `[ \t]` not `\s` on purpose: a `\s*` would swallow the NEXT line's newline as well and
  // leave that line's `*` gutter behind, which is exactly the kind of almost-right that
  // makes a tripwire report the wrong thing.
  return collapse(src.replace(/\n[ \t]*\*[ \t]?/g, " "));
}

/** Every index at which `re` matches `text` (global, non-overlapping). */
function matchIndexes(text: string, re: RegExp): number[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: number[] = [];
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    out.push(m.index);
    if (m[0].length === 0) g.lastIndex += 1;
  }
  return out;
}

/** The body of a named arrow-function const, up to the next top-level `const ` at that indent. */
function block(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("admin.subs — reset-password is bound to the real write", () => {
  const src = read("./admin/admin-subs.tsx");

  it("imports and instantiates the reset-password mutation", () => {
    expect(src).toContain("useResetUserPassword");
    expect(src).toMatch(/const reset = useResetUserPassword\(\)/);
  });

  it("the confirm dialog's Send button calls the mutation", () => {
    const resetPw = block(src, "const resetPw = (u: UserRow)", "const tabs");
    expect(resetPw).toContain("reset.mutateAsync(u.id)");
  });

  it("fires the success toast off the SETTLED promise, not on click", () => {
    const resetPw = block(src, "const resetPw = (u: UserRow)", "const tabs");
    // fireWithToast(run, onOk, onErr) — the toast cannot precede the server's answer, and
    // a rejection lands on the failure toast instead of the success one.
    expect(resetPw).toContain("fireWithToast(");
    expect(resetPw).toContain("admin.subs.resetPwToast");
    expect(resetPw).toContain("admin.common.actionFailedToast");
    // The pre-round shape was `close(); ctx.notify(resetPwToast)` with no call at all.
    expect(resetPw).not.toMatch(/close\(\);\s*ctx\.notify\(t\("admin\.subs\.resetPwToast"\)/);
  });
});

describe("land.pipeline — the card opens the detail and the detail advances the stage", () => {
  const src = read("./land/land-pipeline.tsx");

  it("imports and instantiates the advance-stage mutation", () => {
    expect(src).toContain("useAdvancePlotStage");
    expect(src).toMatch(/const advance = useAdvancePlotStage\(\)/);
  });

  it("the kanban card is clickable and opens the plot detail", () => {
    expect(src).toContain("onClick={() => openDetail(p)}");
  });

  it("the advance action calls the mutation with the plot id and no body", () => {
    expect(src).toContain("advance.mutateAsync(plot.id)");
  });

  it("labels the toast with the stage the SERVER returned, not a predicted next stage", () => {
    const advanceBlock = block(src, "const advancePlot = (plot: PipelinePlot)", "const openDetail");
    expect(advanceBlock).toContain("land.pipeline.toastAdvance");
    expect(advanceBlock).toContain("stageLabelKey(nextStage)");
    // A client-side "next stage" computation would mean the browser owned the pipeline order.
    expect(advanceBlock).not.toMatch(/LAND_STAGES\[[^\]]*\+\s*1\]/);
  });

  it("routes a rejection to the terminal toast or the server message — never to success", () => {
    const advanceBlock = block(src, "const advancePlot = (plot: PipelinePlot)", "const openDetail");
    expect(advanceBlock).toContain("advanceErrorKind(err)");
    expect(advanceBlock).toContain("land.pipeline.toastClosed");
    expect(advanceBlock).toContain("advanceErrorMessage(err)");
  });

  it("does not render the advance control at the terminal stage", () => {
    expect(src).toContain("canAdvance(plot.stage)");
  });

  it("keeps export and add-plot honest-disabled (no endpoint / unported form)", () => {
    expect(src).toMatch(/icon="download" disabled/);
    expect(src).toMatch(/icon="plus" disabled/);
  });
});

describe("retired false claims stay retired — deleted outright (3 of 7)", () => {
  /*
   * Each of these sentences asserted a gap that had already closed. They are the reason
   * seven flows read as unbuilt to every later audit. Re-introducing one is a regression.
   *
   * The claim is a RegExp and the check runs over FLATTENED text, not raw source. Both
   * matter: a literal `not.toContain` over raw source is defeated by a line wrap (that is
   * the master-project defect, which is why it is no longer in this bucket), and the export
   * claim shipped in two different wordings on two different lines of one file.
   *
   * `fact` is the sentence that REPLACED the claim. Without it an absence check also passes
   * when someone simply deletes the whole paragraph, which loses the correction.
   */
  const cases: readonly { rel: string; label: string; claim: RegExp; fact: string }[] = [
    {
      rel: "./land/land-pipeline.tsx",
      label: "the mock detail/advance actions are dropped",
      claim: /the mock detail\/advance actions are dropped/,
      fact: "POST /land/plots/{id}/advance-stage",
    },
    {
      // The 7th, added 2026-08-10. dev's header said "Export has no endpoint (dropped mock,
      // mirror land-bank)"; this branch's :36 said "Export (no endpoint anywhere)". One
      // regex covers both wordings, because a revert could restore either.
      rel: "./land/land-pipeline.tsx",
      label: "Export has no endpoint",
      claim: /Export (?:has )?\(?no endpoint/,
      fact: "mounted NOWHERE in apps/api (B-351)",
    },
    {
      rel: "./admin/admin-subs.tsx",
      label: "reset-password fire faithful ctx.notify",
      claim: /reset-password fire faithful ctx\.notify/,
      fact: "POST /admin/users/{id}/reset-password",
    },
  ];

  for (const { rel, label, claim, fact } of cases) {
    describe(`${rel} — "${label}"`, () => {
      it("no longer states the retired claim, however it is wrapped", () => {
        expect(prose(read(rel))).not.toMatch(claim);
      });

      it("states the fact that replaced it", () => {
        expect(prose(read(rel))).toContain(fact);
      });
    });
  }
});

describe("retired false claims stay retired — quoted in the correction (4 of 7)", () => {
  /*
   * Each of these survives only as a QUOTATION inside the sentence that retires it, so the
   * assertion is two-part: the claim appears nowhere except inside quotes, and the fact that
   * replaced it is stated. A revert restores the claim UNQUOTED (and drops the fact), so
   * both halves fail.
   *
   * `claim` is a regex, not a literal, because the reverted wording and the quoted wording
   * differ by a word — sales-crm's live comment said "create endpoint not filed" while the
   * correction quotes "the create endpoint is not filed". A literal for either one misses
   * the other, which is how a naive check would pass over a genuine revert. The optional
   * leading article matters too: the quotation opens BEFORE "the", so a regex starting at
   * "create" sees a letter where the quote is and reports its own quotation as a live claim.
   *
   * `flatten` is per-case and NOT a detail. Three of these are star-gutter block headers and
   * take `prose`; master-project's are JSX brace-comments with no gutter and take `collapse`.
   */
  const cases: readonly {
    rel: string;
    label: string;
    claim: RegExp;
    fact: string;
    flatten: (src: string) => string;
  }[] = [
    {
      rel: "./master/master-project-type.tsx",
      label: "no backend route yet",
      claim: /no backend route yet/,
      fact: "project-types.ts:117 mounts POST",
      flatten: prose,
    },
    {
      rel: "./sales/sales-crm.tsx",
      label: "the create endpoint is not filed",
      claim: /(?:the )?create endpoint (?:is )?not filed/,
      fact: "POST /sales/leads is mounted",
      flatten: prose,
    },
    {
      rel: "./land/land-dd.tsx",
      label: "no DD-status endpoint is merged",
      claim: /no DD-status endpoint is merged/,
      fact: "PUT /land/plots/{id}/dd is mounted",
      flatten: prose,
    },
    {
      // MOVED here from the deleted-outright bucket 2026-08-10 — it never belonged there.
      // The claim is alive at master-project.tsx as a quotation, and the absence check only
      // passed because it wraps. `collapse`, not `prose`: this file's comments are
      // `{` + block-comment JSX with no `*` gutter.
      rel: "./master/master-project.tsx",
      label: "the backend create-project route is unimplemented",
      claim: /the backend create-project route is unimplemented/,
      fact: "projects.ts:200 mounts POST /projects",
      flatten: collapse,
    },
  ];

  for (const { rel, label, claim, fact, flatten } of cases) {
    describe(`${rel} — "${label}"`, () => {
      const text = flatten(read(rel));

      it("still quotes the retired claim (the correction is present)", () => {
        expect(matchIndexes(text, claim).length).toBeGreaterThan(0);
      });

      it("never states the retired claim outside a quotation", () => {
        const unquoted = matchIndexes(text, claim).filter((i) => {
          const before = text[i - 1];
          const m = claim.exec(text.slice(i));
          const after = text[i + (m ? m[0].length : 0)];
          return before !== '"' || after !== '"';
        });
        expect(unquoted, `retired claim stated as fact in ${rel}`).toEqual([]);
      });

      it("states the fact that replaced it", () => {
        expect(text).toContain(fact);
      });
    });
  }
});

describe("load-bearing cache invalidation is pinned where the docstring claims it", () => {
  /*
   * use-land-bank.ts's own docstring calls this invalidation load-bearing — "a card that did
   * not move columns would leave the control claiming a change the screen never shows: the
   * same lie-shaped defect this round closes" — and nothing asserted it. A docstring is not a
   * test. The deliberate ABSENCE on reset-password is pinned for the same reason: it is a
   * decision (credential state invalidates no read), and an unpinned decision reads as an
   * oversight to the next person, who then "fixes" it.
   */
  it("useAdvancePlotStage invalidates the plot register on success", () => {
    const hook = block(
      read("./land/use-land-bank.ts"),
      "export function useAdvancePlotStage(",
      "\n}\n",
    );
    expect(hook).toContain("onSuccess:");
    expect(hook).toContain("qc.invalidateQueries({ queryKey: LAND_PLOTS_KEY })");
  });

  it("useResetUserPassword invalidates NOTHING (credential state, no read to refresh)", () => {
    const hook = block(
      read("./admin/use-admin.ts"),
      "export function useResetUserPassword(",
      "\n}\n",
    );
    expect(hook).not.toContain("invalidateQueries");
    expect(hook).not.toContain("onSuccess");
  });
});

describe("land.pipeline — an unpriced plot never renders a fabricated zero", () => {
  const src = read("./land/land-pipeline.tsx");

  /*
   * The one BEHAVIOURAL change this round shipped, and until now the only thing in it that
   * was unpinned. Mutation P13 — drop `&& plot.totalValue > 0` and the modal renders a
   * confident "0" again for a plot nobody has priced — left the suite GREEN, in the branch
   * whose headline artifact is a source-reading tripwire built precisely for .tsx logic the
   * node env cannot import.
   *
   * The card half of the same defect is a pure function and is pinned by value in
   * land-pipeline-rows.test.ts. What is pinned HERE is that the SCREEN calls it — a correct
   * helper that no screen calls is the admin-subs defect verbatim, and is why this file
   * exists at all.
   */
  it("the detail modal's total-value row guards on > 0, not merely on null", () => {
    const grid = block(src, "{/* 8 rows, two columns", "{/* actions (land.jsx");
    expect(collapse(grid)).toContain("plot.totalValue != null && plot.totalValue > 0");
    expect(collapse(grid)).toContain(": DASH");
  });

  it("the price/rai row directly above it uses the SAME guard (they must not disagree)", () => {
    // The two rows sit in one grid describing one plot. When only one of them guarded on
    // `> 0` the modal contradicted itself, which is the smaller version of the card-vs-modal
    // contradiction this round fixed.
    const grid = block(src, "{/* 8 rows, two columns", "{/* actions (land.jsx");
    expect(collapse(grid)).toContain("plot.pricePerRai > 0");
  });

  it("the kanban card's price cell reads the SERVER value through cardValueText", () => {
    expect(src).toContain("const cardValue = cardValueText(p);");
    expect(collapse(src)).toContain("{cardValue == null ? DASH :");
    // The pre-fix shape: a LOCAL areaRai x pricePerRai re-derivation rendered inline, which
    // printed "0.0M" for the same plot the modal em-dashed. The braces are what separate the
    // rendered expression from the prose mention of it in the comment beside it.
    expect(src).not.toContain("{millionsText(plotValue(p))}");
  });
});

describe("land.pipeline — the interactive card is reachable without a mouse (B-354)", () => {
  const src = read("./land/land-pipeline.tsx");

  it("the kanban card carries button semantics and a keyboard activation path", () => {
    // The card is the only route to the detail modal, and the modal is the only route to
    // the advance-stage write. A bare <div onClick> makes that whole path mouse-only.
    const card = block(src, "{col.map((p) => {", "boxShadow");
    expect(card).toContain('role="button"');
    expect(card).toContain("tabIndex={0}");
    expect(card).toContain("onKeyDown");
    expect(card).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    expect(card).toContain("openDetail(p)");
  });
});
