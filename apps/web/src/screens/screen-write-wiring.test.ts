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
 * the three retired false claims.
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

describe("retired false claims stay retired", () => {
  // Each of these sentences asserted a gap that had already closed. They are the reason
  // five flows read as unbuilt to every later audit. Re-introducing one is a regression.
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
