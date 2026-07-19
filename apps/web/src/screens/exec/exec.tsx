/*
 * ExecDashboard — the Executive Dashboard screen, ported from pototype/exec-audit.jsx
 * ExecDashboard (L7-159). Route `exec` (docs/extract/NAV-ROUTES.md L15, top-level,
 * mod null). Only the ExecDashboard component is in scope — the AuditLog component in
 * the same file is a separate route (`audit`), out of scope here.
 *
 * section-0 fidelity (rule 1): the layout is the prototype's, verbatim — the single-crumb
 * page header (title + subtitle + export action), the 5-KPI portfolio row, the
 * accept-center strip, and the 1.7fr/1fr grid of the per-project rollup table + the
 * right column (budget-by-type mix + executive-decisions card).
 *
 * Data (section-0 rule 3 + C10): the prototype's window.PROJECTS / per-project `roll`
 * mock (budget/actual/progress/sold/health literals) and window.ACCEPT_ITEMS are
 * DROPPED. The KPIs, the per-project table, and the type-mix read the REAL
 * GET /analytics/portfolio rollup (use-exec.ts) — a tenant-wide cross-project
 * aggregate over the seed business tables (apps/api/src/routes/analytics.ts, B-101).
 * Pure parse/format/tone/rule logic lives in exec-agg.ts (gate G3).
 *
 * WIRE SOURCING (honest, never fabricated):
 *  - project short + colour are NOT in the portfolio response → they are joined from
 *    GET /projects rows (the same source the ProjectSwitcher uses: Project.short /
 *    Project.color, migration 0009). A project absent from that roster falls back to
 *    the neutral brand colour + an em-dash badge (never an invented short).
 *  - type meta (icon/colour/name) for the type badge + the mix card comes from the
 *    project-types map (project-types.json, the TypeBadge source), keyed by type_key.
 *  - health is the STORED curated label surfaced verbatim (B-102); a null (uncurated)
 *    health renders an honest em-dash, not a chip.
 *  - the accept-center strip has NO endpoint (window.ACCEPT_ITEMS is a forbidden mock
 *    global) → its three counts + the pending value render honest em-dashes, and the
 *    "open acceptance center" button navigates to the real `accept` route.
 *  - the executive-decisions rows are hardcoded mock content with no source → the card
 *    keeps its header over an honest empty state, never the fabricated 3 rows.
 *
 * i18n (section-0 rule 2): every visible string is an exec-strings.json phrase key (tp),
 * verified present in packages/i18n/src/i18n-full.json (the 22 net-new landed in B-103).
 * The Bar's `color` prop and the Btn's `iconRight` are NOT ported: the prototype's
 * shared ds.jsx Bar/Btn silently ignore them (they are not declared props), so the
 * faithful render matches the reference. No raw Thai byte lives in this source (B-073);
 * server data (project/health labels) is a runtime value, never a source literal.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { TypeBadge } from "../../shell/type-badge";
import { projectTypeMeta } from "../../shell/project-types";
import { useAnalyticsPortfolio } from "./use-exec";
import {
  fmtMillions,
  healthTone,
  overSpend,
  actualPctOfBudget,
  distinctTypeCount,
} from "./exec-agg";
import strings from "./exec-strings.json" with { type: "json" };

type Project = components["schemas"]["Project"];

/** Phrase-key accessor for exec-strings.json (the Thai phrase IS the key -> tp). */
const P = (k: keyof typeof strings) => strings[k] as PhraseKey;
/** Honest placeholder for any figure the wire does not carry (never invented). */
const DASH = "—";

/** Fill "{token}" placeholders in a phrase value (i18n has no interpolation, B-017). */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/* ── Presentational primitives (view-only, inlined like the other ported screens) ─ */

/**
 * Bar — ported from pototype/ds.jsx Bar (168-188). The prototype's shared Bar has NO
 * `color` prop (colour is internal: over/danger → danger, >85% → warn, else brand), so
 * the exec mock's `color={...}` is silently ignored — this port matches that behaviour
 * (identical to the Dashboard port's Bar).
 */
function Bar({ value, max, danger, height = 6 }: { value: number; max: number; danger?: boolean; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max;
  const color = over || danger ? "var(--danger)" : pct > 85 ? "var(--warn)" : "var(--brand)";
  return (
    <div style={{ width: "100%", height, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width .3s" }} />
    </div>
  );
}

type DeltaTone = "danger" | "ok" | "neutral";
interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  accent?: string;
  foot?: ReactNode;
}

/** Kpi card — ported from pototype/dashboard.jsx Kpi (93-114), the ExecDashboard KPI. */
function Kpi({ label, value, unit, sub, delta, deltaTone = "neutral", accent, foot }: KpiProps) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
        {delta != null && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: deltaTone === "danger" ? "var(--danger)" : deltaTone === "ok" ? "var(--ok)" : "var(--text-3)",
              background: deltaTone === "danger" ? "var(--danger-soft)" : deltaTone === "ok" ? "var(--ok-soft)" : "var(--surface-3)",
              padding: "2px 7px",
              borderRadius: 999,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub != null && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
      {foot}
    </Card>
  );
}

/** Centered honest em-dash empty state (used where a card's source is empty/unwired). */
function EmptyState({ height = 60 }: { height?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height, color: "var(--text-3)", fontSize: 13 }}>
      {DASH}
    </div>
  );
}

/** Table header cell (pototype/ds.jsx th, 214-219). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell (pototype/ds.jsx td, 220). */
function td(): CSSProperties {
  return { padding: "14px", verticalAlign: "middle" };
}

/* ── Screen ───────────────────────────────────────────────────────────────────── */

export function ExecDashboard() {
  const { tp, lang } = useI18n();
  const ctx = useShellCtx();

  const portfolioQ = useAnalyticsPortfolio();
  const projectsQ = useProjects();

  const pf = portfolioQ.data ?? null;
  const projects = pf?.projects ?? [];
  const totals = pf?.totals ?? null;
  const typeMix = pf?.typeMix ?? [];

  // Join short/colour/phases from GET /projects (the ProjectSwitcher source) by id —
  // the portfolio rollup carries no short/colour (they are stamped master columns).
  const projMeta = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projectsQ.data ?? []) map.set(p.id, p);
    return map;
  }, [projectsQ.data]);

  const budgetTotal = totals?.budgetTotal ?? 0;
  const actualTotal = totals?.actualTotal ?? 0;
  const avgProgress = totals?.avgProgress ?? 0;
  const atRisk = totals?.atRiskCount ?? 0;
  const actualPct = actualPctOfBudget(actualTotal, budgetTotal);
  const typeCount = distinctTypeCount(projects);

  return (
    <Page
      breadcrumbs={[tp(P("breadcrumb"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        // Export: no report-export endpoint yet -> deferred no-op stub (boq-reports precedent).
        <Btn kind="outline" size="md" icon="download">
          {tp(P("exportBtn"))}
        </Btn>
      }
    >
      {/* Portfolio KPIs (5) — LIVE from /analytics/portfolio totals + projects. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 18 }}>
        <Kpi
          label={tp(P("kpiProjects"))}
          value={String(projects.length)}
          unit={tp(P("unitProject"))}
          sub={`${typeCount} ${tp(P("typeUnit"))}`}
          accent="var(--brand)"
        />
        <Kpi label={tp(P("kpiBudgetTotal"))} value={fmtMillions(budgetTotal)} unit={tp(P("unitMillion"))} sub={tp(P("allProjects"))} />
        <Kpi
          label={tp(P("kpiActual"))}
          value={fmtMillions(actualTotal)}
          unit={tp(P("unitMillion"))}
          // Mock passes a NUMBER delta (exec-audit.jsx:41) so a 0/NaN ratio hides the
          // pill (truthy render) — undefined here reproduces that (no pill at 0% spend).
          delta={actualPct ? String(actualPct) : undefined}
          deltaTone="neutral"
          sub={fill(tp(P("pctOfBudget")), { pct: actualPct })}
        />
        <Kpi
          label={tp(P("kpiAvgProgress"))}
          value={String(avgProgress)}
          unit="%"
          accent="var(--accent)"
          foot={<div style={{ marginTop: 10 }}><Bar value={avgProgress} max={100} /></div>}
        />
        <Kpi
          label={tp(P("kpiAtRisk"))}
          value={String(atRisk)}
          unit={tp(P("unitProject"))}
          sub={tp(P("atRiskSub"))}
          accent={atRisk ? "var(--warn)" : "var(--ok)"}
          // exec-audit.jsx:43 delta={atRisk ? -atRisk : 0}: the 0 is a falsy number so
          // no pill renders when nothing is at risk — undefined reproduces that.
          delta={atRisk ? String(-atRisk) : undefined}
          deltaTone={atRisk ? "danger" : "ok"}
        />
      </div>

      {/* Accept-center strip — NO endpoint (window.ACCEPT_ITEMS forbidden) -> honest em-dashes. */}
      <Card pad={0} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 18px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--brand-soft)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={17} />
            </span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{tp(P("acceptTitle"))}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{fill(tp(P("acceptSub")), { value: DASH })}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12 }}>
              {tp(P("acceptPending"))} <b className="num" style={{ fontSize: 15 }}>{DASH}</b>
            </span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              {tp(P("acceptOverSla"))} <b className="num" style={{ fontSize: 15 }}>{DASH}</b>
            </span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              {tp(P("acceptRejected"))} <b className="num" style={{ fontSize: 15 }}>{DASH}</b>
            </span>
            <Btn kind="primary" size="sm" onClick={() => ctx.navigate("accept")}>
              {tp(P("acceptOpenBtn"))}
            </Btn>
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16 }}>
        {/* Per-project rollup table — LIVE from projects[]. */}
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700 }}>{tp(P("tableTitle"))}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th style={th()}>{tp(P("thProject"))}</th>
                  <th style={{ ...th(110), textAlign: "right" }}>{tp(P("thBudget"))}</th>
                  <th style={{ ...th(110), textAlign: "right" }}>{tp(P("thActual"))}</th>
                  <th style={th(140)}>{tp(P("thProgress"))}</th>
                  <th style={th(110)}>{tp(P("thHealth"))}</th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 18, fontWeight: 600 }}>
                      {DASH}
                    </td>
                  </tr>
                ) : (
                  projects.map((proj) => {
                    const meta = projMeta.get(proj.projectId);
                    const color = meta?.color ?? "var(--brand)";
                    const short = meta?.short ?? DASH;
                    const over = overSpend(proj.actual, proj.budget);
                    const phaseId = meta?.phases?.[0]?.id;
                    return (
                      <tr
                        key={proj.projectId}
                        style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                        onClick={() => {
                          ctx.setTweak("project", phaseId ? `${proj.projectId}.${phaseId}` : proj.projectId);
                          ctx.navigate("dashboard");
                        }}
                      >
                        <td style={td()}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 7,
                                flexShrink: 0,
                                background: `color-mix(in srgb, ${color} 16%, white)`,
                                color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9,
                                fontWeight: 800,
                              }}
                            >
                              {short}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                                {proj.name ?? DASH}
                              </div>
                              {proj.typeKey && (
                                <div style={{ marginTop: 2 }}>
                                  <TypeBadge type={proj.typeKey} size="sm" />
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ ...td(), textAlign: "right" }} className="num">
                          {fmtMillions(proj.budget)}
                        </td>
                        <td style={{ ...td(), textAlign: "right", fontWeight: 600, color: over ? "var(--danger)" : "var(--text)" }} className="num">
                          {fmtMillions(proj.actual)}
                        </td>
                        <td style={td()}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <Bar value={proj.progressPct} max={100} />
                            </div>
                            <span className="num" style={{ fontSize: 11, width: 30, color: "var(--text-2)" }}>
                              {proj.progressPct}%
                            </span>
                          </div>
                        </td>
                        <td style={td()}>
                          {proj.health == null ? (
                            <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: healthTone(proj.health) }}>
                              <span style={{ width: 7, height: 7, borderRadius: 999, background: healthTone(proj.health) }} />
                              {proj.health}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right column: budget-by-type mix + executive decisions. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{tp(P("mixTitle"))}</div>
            {typeMix.length === 0 ? (
              <EmptyState />
            ) : (
              typeMix.map((m) => {
                const meta = projectTypeMeta(m.typeKey);
                return (
                  <div key={m.typeKey} style={{ marginBottom: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon name={meta.icon as IconName} size={13} color={meta.color} />
                        {lang === "en" ? meta.nameEn : meta.name}
                      </span>
                      <span className="num" style={{ fontWeight: 700 }}>
                        {fmtMillions(m.budgetSum)} {tp(P("unitMillion"))}
                      </span>
                    </div>
                    <Bar value={m.budgetSum} max={budgetTotal} />
                  </div>
                );
              })
            )}
          </Card>

          {/* Executive decisions — hardcoded mock content with no source -> honest empty. */}
          <Card pad={0}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>{tp(P("decisionsTitle"))}</div>
            <div style={{ padding: 8 }}>
              <EmptyState />
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
