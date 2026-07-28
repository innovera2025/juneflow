/*
 * solar.permit list-row helpers (read-only) — pure, i18n-free, ASCII-only logic narrowed
 * from pototype/solar.jsx SolarPermit (L223-265). The prototype held the permit steps in a
 * local array (L224-231); §0 rule 3 drops that mock — the real server rows are
 *   /solar/permit-steps : { id, project_id, name, org, status, step_date, created_at }
 * (apps/api/src/routes/solar.ts). The "all steps" + "pending" KPIs are DERIVED from the
 * returned steps; the COD-status KPI is a fixed illustrative figure (i18n value-key).
 *
 * STATUS is code-based (never a Thai-literal compare, B-073): isPermitApproved maps both
 * the seed code ("done") and the prototype code ("approved") to the approved timeline node
 * (ok + check) vs the pending node (warn + clock); the screen picks the solar.permit.status*
 * label + the node colour/icon from that boolean, and the null step_date falls back to the
 * pending label (solar.permit.statusPending), matching the prototype's pending-row date.
 */
import { str } from "./solar-shared";

/** A permit/approval step as the timeline consumes it (GET /solar/permit-steps row). */
export interface PermitStep {
  id: string;
  /** Permit/step name (free text). */
  name: string;
  /** Issuing authority / organisation (free text; "" when absent). */
  org: string;
  /** Status code (done|approved|pending|..., not enumerated). */
  status: string;
  /** Step date (free text; "" when absent -> the screen falls back to the pending label). */
  stepDate: string;
}

/** Narrow an opaque /solar/permit-steps row to PermitStep (snake_case wire / camelCase fallback). */
export function toPermitStep(e: Record<string, unknown>): PermitStep {
  return {
    id: str(e.id),
    name: str(e.name),
    org: str(e.org),
    status: str(e.status),
    stepDate: str(e.step_date ?? e.stepDate),
  };
}

/**
 * True when a step is approved (solar.jsx L250/L259): both the seed code ("done") and the
 * prototype code ("approved") count. Drives the node colour/icon, the badge kind + label.
 */
export function isPermitApproved(status: string): boolean {
  return status === "approved" || status === "done";
}

/** Total step count (KPI "all permits" value = steps.length, solar.jsx L240). */
export function stepCount(rows: readonly PermitStep[]): number {
  return rows.length;
}

/** Pending-step count (KPI "in progress" value, solar.jsx L242) — non-approved steps. */
export function pendingCount(rows: readonly PermitStep[]): number {
  return rows.reduce((n, s) => n + (isPermitApproved(s.status) ? 0 : 1), 0);
}
