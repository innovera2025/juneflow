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
 * from source. Same technique here, scoped to the two controls this round turned on plus
 * ALL SIX retired false claims.
 *
 * Six, not three — corrected 2026-08-10. The first version of this file pinned three and
 * its own two comments disagreed with each other about the number ("the three retired false
 * claims" against "five flows read as unbuilt"). Under-covering here is not cosmetic: a
 * rebase or a partial revert restores one unpinned comment, the suite stays green, and that
 * screen reads as backend-blocked to every subsequent audit — the exact regression this
 * file exists to prevent.
 *
 * The six split into two shapes, and they need different assertions:
 *   - THREE were deleted outright, so `not.toContain` is the right tripwire.
 *   - THREE survive as a QUOTATION inside the correction that retired them ("X" was FALSE).
 *     `not.toContain` is wrong for those — it would fail on the correction itself — so they
 *     assert instead that every occurrence of the claim is inside quotes, plus that the
 *     replacement FACT is stated. Matching runs over whitespace-collapsed prose so a claim
 *     that wraps across two comment lines still matches as one sentence; the first version
 *     of the land-dd and sales-crm claims only "passed" a naive not.toContain because the
 *     line wrap and an inserted "is" happened to break the literal.
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
 * Comment prose with the `*` gutters and line wrapping collapsed, so a sentence that spans
 * two comment lines matches as one. Without this, a claim only has to wrap to escape the
 * tripwire — which is not a property anybody chose, it is an accident of reflow.
 */
function prose(src: string): string {
  // `[ \t]` not `\s` on purpose: a `\s*` would swallow the NEXT line's newline as well and
  // leave that line's `*` gutter behind, which is exactly the kind of almost-right that
  // makes a tripwire report the wrong thing.
  return src.replace(/\n[ \t]*\*[ \t]?/g, " ").replace(/\s+/g, " ");
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

describe("retired false claims stay retired — deleted outright (3 of 6)", () => {
  // Each of these sentences asserted a gap that had already closed. They are the reason
  // six flows read as unbuilt to every later audit. Re-introducing one is a regression.
  const cases: readonly [string, string][] = [
    ["./land/land-pipeline.tsx", "the mock detail/advance actions are dropped"],
    ["./admin/admin-subs.tsx", "reset-password fire faithful ctx.notify"],
    ["./master/master-project.tsx", "the backend create-project route is unimplemented"],
  ];

  for (const [rel, claim] of cases) {
    it(`${rel} no longer claims: ${claim}`, () => {
      expect(read(rel)).not.toContain(claim);
    });
  }
});

describe("retired false claims stay retired — quoted in the correction (3 of 6)", () => {
  /*
   * These three were left unpinned by the first version of this file. Each survives only as
   * a QUOTATION inside the sentence that retires it, so the assertion is two-part: the claim
   * appears nowhere except inside quotes, and the fact that replaced it is stated. A revert
   * restores the claim UNQUOTED (and drops the fact), so both halves fail.
   *
   * `claim` is a regex, not a literal, because the reverted wording and the quoted wording
   * differ by a word — sales-crm's live comment said "create endpoint not filed" while the
   * correction quotes "the create endpoint is not filed". A literal for either one misses
   * the other, which is how a naive check would pass over a genuine revert. The optional
   * leading article matters too: the quotation opens BEFORE "the", so a regex starting at
   * "create" sees a letter where the quote is and reports its own quotation as a live claim.
   */
  const cases: readonly { rel: string; label: string; claim: RegExp; fact: string }[] = [
    {
      rel: "./master/master-project-type.tsx",
      label: "no backend route yet",
      claim: /no backend route yet/,
      fact: "project-types.ts:117 mounts POST",
    },
    {
      rel: "./sales/sales-crm.tsx",
      label: "the create endpoint is not filed",
      claim: /(?:the )?create endpoint (?:is )?not filed/,
      fact: "POST /sales/leads is mounted",
    },
    {
      rel: "./land/land-dd.tsx",
      label: "no DD-status endpoint is merged",
      claim: /no DD-status endpoint is merged/,
      fact: "PUT /land/plots/{id}/dd is mounted",
    },
  ];

  for (const { rel, label, claim, fact } of cases) {
    describe(`${rel} — "${label}"`, () => {
      const text = prose(read(rel));

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
