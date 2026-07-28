/*
 * solar-permit-rows unit tests (gate G3) — the pure SolarPermit display logic narrowed from
 * solar.jsx SolarPermit. Guards the opaque-row narrowing, the approved-status mapping (both
 * seed + prototype codes), and the step-count / pending-count KPI derivations.
 */
import { describe, it, expect } from "vitest";
import { toPermitStep, isPermitApproved, stepCount, pendingCount, type PermitStep } from "./solar-permit-rows";

function step(over: Partial<PermitStep> = {}): PermitStep {
  return { id: "permit-1", name: "EIA", org: "authority", status: "done", stepDate: "", ...over };
}

describe("toPermitStep", () => {
  it("narrows a snake_case wire row (step_date) to PermitStep", () => {
    expect(
      toPermitStep({ id: "p", project_id: "x", name: "COD", org: "authority", status: "pending", step_date: "2026-01-01", created_at: "z" }),
    ).toEqual({ id: "p", name: "COD", org: "authority", status: "pending", stepDate: "2026-01-01" });
  });

  it("defaults absent / null fields (never fabricates a date)", () => {
    expect(toPermitStep({ id: "y" })).toEqual({ id: "y", name: "", org: "", status: "", stepDate: "" });
    expect(toPermitStep({ id: "z", step_date: null }).stepDate).toBe("");
  });
});

describe("isPermitApproved", () => {
  it("treats both the seed code (done) and the prototype code (approved) as approved", () => {
    expect(isPermitApproved("done")).toBe(true);
    expect(isPermitApproved("approved")).toBe(true);
    expect(isPermitApproved("pending")).toBe(false);
    expect(isPermitApproved("")).toBe(false);
  });
});

describe("stepCount / pendingCount", () => {
  const rows = [step({ status: "done" }), step({ status: "done" }), step({ status: "done" }), step({ status: "pending" }), step({ status: "pending" }), step({ status: "pending" })];

  it("counts all steps + the non-approved ones", () => {
    expect(stepCount(rows)).toBe(6);
    expect(pendingCount(rows)).toBe(3);
  });

  it("is zero-safe for an empty register", () => {
    expect(stepCount([])).toBe(0);
    expect(pendingCount([])).toBe(0);
  });
});
