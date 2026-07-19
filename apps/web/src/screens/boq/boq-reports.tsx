/*
 * BOQReports — the BOQ Reports screen, ported 1:1 from pototype/boq.jsx BOQReports
 * (L1637-1852) + boq-extra.jsx BOQReportsExtra (RPT-003/004/005, L322-479). Route
 * boq.reports (docs/extract/NAV-ROUTES.md L28), visual-gate reference
 * tests/visual/reference/gallery/g1/14. B-070 ruling: reports = read-view, match-prototype.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout is the prototype's, verbatim — the
 * two-crumb breadcrumb, the title/subtitle, the three header actions (filter / print /
 * export-Excel), the scope-conditions strip, and the FIVE report cards:
 *   RPT-001 BOQ vs Non-BOQ Summary (stacked bar + category table)   — WIRED
 *   RPT-002 BOQ Revise Report (before/after)                        — group-A scope (shell)
 *   RPT-003 Material / Subcon / Labor Breakdown                     — WIRED
 *   RPT-004 Variance Report (Plan vs Actual)                        — WIRED
 *   RPT-005 EVM (PV/EV/AC chart + SPI/CPI)                          — WIRED
 * Each card keeps its RPT badge + title + description header, its table column headers, and
 * its chart legend/frame — the report's structural skeleton.
 *
 * Data (group-C W2b/W3b, gate G3 · C10 honesty): four of the five cards now read the REAL
 * aggregate handlers (GET /boq/reports/{boq-vs-nonboq,cost-type,variance,evm}, B-101) through
 * the generated typed client + TanStack Query (use-boq-reports.ts); the opaque Entity bodies
 * are parsed to typed rows by boq-reports-agg.ts. NONE of the prototype's mock numbers (the
 * +880,000 / +7.1% over, the M/S/L literals, the PV/EV/AC series) are reproduced. Where the
 * schema genuinely has no source — Non-BOQ over-plan spend is unpriceable (pr_item carries no
 * price → backend returns an honest 0), and the variance / EVM stores may be empty on the seed
 * — the card renders the honest em-dash / empty-state under its real headers, never a
 * fabricated figure. RPT-002 (revise before/after) has no version-log source and stays the
 * honest empty shell (group-A owns it). When a report has no rows, the original EmptyBody /
 * EmptyTable shell is kept verbatim.
 *
 * The scope strip's project pill is the active-project name (GET /projects) and its id scopes
 * every report query. The other scope pills (phase / period) have no source (em-dash); block /
 * category show their "all" default (no filter applied). The header filter/print/export
 * buttons have no backend, so they are deferred no-op stubs (boq-overview export precedent).
 *
 * i18n (rule 2): every string is a boq.rep* / nav. dict key (t) or a boq-reports-strings.json
 * phrases key (tp). Tokens back every colour (rule 6); the #1D4ED8 / #B45309 MSL hexes are
 * prototype-verbatim literals with no @juneflow/tokens value (B-037(a)). Comments are
 * English-only (Juneflow CLAUDE.md language rule); Thai copy lives only in the i18n keys/json.
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import {
  DASH,
  formatMoney,
  millions1,
  millions2,
  formatPct1,
  buildBoqBars,
  buildMslBar,
  buildEvmChart,
  classifyVarianceRow,
  pctOverBadge,
  varianceDevBadge,
  varianceColor,
  spiGood,
  type BadgeTone,
  type CostTypeReport,
} from "./boq-reports-agg";
import {
  useBoqVsNonboq,
  useBoqCostType,
  useBoqVariance,
  useBoqEvm,
} from "./use-boq-reports";
import repStrings from "./boq-reports-strings.json" with { type: "json" };

const R = (k: keyof typeof repStrings) => repStrings[k] as PhraseKey;

/** Table header cell style (boq.jsx th, used across the report tables). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "10px 12px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-3)",
    whiteSpace: "nowrap",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (boq-overview.tsx td convention). */
const td: CSSProperties = { padding: "10px 12px", verticalAlign: "middle" };

/** Threshold-badge span style (boq.jsx:1762 / boq-extra.jsx:406). */
function badgeStyle(tone: BadgeTone): CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 4,
    background: tone.bg,
    color: tone.fg,
  };
}

/**
 * Scope-conditions pill (boq.jsx ScopePill) — hint label + value. `muted` dims the value
 * (the prototype's greyed "all" pills). Display-only: no report-filter state is persisted.
 */
function ScopePill({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "6px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface)",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: muted ? "var(--text-3)" : "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Report card shell (boq-extra.jsx ReportCard) — RPT badge + title + description + body. */
function ReportCard({
  code,
  title,
  desc,
  right,
  children,
}: {
  code: string;
  title: string;
  desc: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card pad={0} style={{ marginBottom: 16 }}>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 4,
                background: "var(--brand-soft)",
                color: "var(--brand)",
              }}
            >
              {code}
            </span>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{desc}</div>
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

/**
 * Honest empty-state body for a report whose DATA has no backend source: a centered em-dash
 * (the no-source marker) — never fabricated numbers. Used as the single body cell of every
 * report table + the chart frames.
 */
function EmptyBody({ minHeight = 120 }: { minHeight?: number }) {
  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-3)",
        fontSize: 20,
        fontWeight: 600,
      }}
    >
      {DASH}
    </div>
  );
}

/** A report table shell: the real column headers (thead) over the caller's body. */
function ReportTable({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
          {headers.map((h, i) => (
            <th key={i} style={th(undefined, i > 0)}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  );
}

/** A report table with real headers over an honest single em-dash empty row. */
function EmptyTable({ headers }: { headers: ReactNode[] }) {
  return (
    <ReportTable headers={headers}>
      <tbody>
        <tr style={{ borderTop: "1px solid var(--border)" }}>
          <td
            colSpan={headers.length}
            style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 18, fontWeight: 600 }}
          >
            {DASH}
          </td>
        </tr>
      </tbody>
    </ReportTable>
  );
}

/** A totals-row footer cell (right-aligned, bold; optional colour). */
function totalCell(value: ReactNode, color?: string): ReactNode {
  return (
    <td style={{ ...td, textAlign: "right", fontWeight: 700, ...(color ? { color } : {}) }} className="num">
      {value}
    </td>
  );
}

/** Chart legend swatch + label (boq.jsx / boq-extra.jsx legend rows). */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
      <span style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

/** RPT-003 Material/Subcon/Labor breakdown table (boq-extra.jsx:340-368). */
function MslTable({
  report,
  totalLabel,
  headers,
}: {
  report: CostTypeReport;
  totalLabel: string;
  headers: ReactNode[];
}) {
  return (
    <ReportTable headers={headers}>
      <tbody>
        {report.rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ ...td, fontWeight: 500 }}>{r.categoryLabel ?? DASH}</td>
            <td style={{ ...td, textAlign: "right" }} className="num">
              {formatMoney(r.material)}
            </td>
            <td style={{ ...td, textAlign: "right" }} className="num">
              {formatMoney(r.subcon)}
            </td>
            <td style={{ ...td, textAlign: "right" }} className="num">
              {formatMoney(r.labor)}
            </td>
            <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
              {formatMoney(r.total)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
        <tr>
          <td style={{ ...td, fontWeight: 700 }}>{totalLabel}</td>
          {totalCell(formatMoney(report.totals.material), "var(--brand)")}
          {totalCell(formatMoney(report.totals.subcon), "#1D4ED8")}
          {totalCell(formatMoney(report.totals.labor), "#B45309")}
          {totalCell(formatMoney(report.totals.grand), "var(--brand)")}
        </tr>
      </tfoot>
    </ReportTable>
  );
}

export function BOQReports() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const projectsQ = useProjects();

  // Resolve the active project (scope strip pill + the id every report query scopes to),
  // following the ProjectSwitcher exactly like the other BOQ screens (use-boq-overview).
  const projectTweak = ctx.tweaks.project;
  const activeProject = useMemo(
    () => resolveActiveProject(projectsQ.data, projectTweak),
    [projectsQ.data, projectTweak],
  );
  const activeProjectId = activeProject?.id;
  const activeProjectName = activeProject?.name ?? DASH;

  // The four REAL aggregate reads (B-101), scoped to the active project.
  const boqVsNonboqQ = useBoqVsNonboq(activeProjectId);
  const costTypeQ = useBoqCostType(activeProjectId);
  const varianceQ = useBoqVariance(activeProjectId);
  const evmQ = useBoqEvm(activeProjectId);

  const bvn = boqVsNonboqQ.data ?? null;
  const bvnRows = bvn?.rows ?? [];
  const bvnBars = useMemo(() => buildBoqBars(bvnRows), [bvnRows]);

  const costType = costTypeQ.data ?? null;
  const costRows = costType?.rows ?? [];
  const msl = useMemo(() => (costType ? buildMslBar(costType) : null), [costType]);

  const variance = varianceQ.data ?? null;
  const varRows = variance?.rows ?? [];

  const evm = evmQ.data ?? null;
  const evmChart = useMemo(() => buildEvmChart(evm?.series ?? []), [evm?.series]);

  // Column headers, shared between each card's empty shell and its populated table.
  const rpt001Headers = [
    tp(R("thWorkGroup")),
    t("boq.repThBoq"),
    t("boq.ovTabNon" as DictKey),
    t("boq.repThActualUsed"),
    t("boq.repThPctOver"),
  ];
  const rpt003Headers = [
    tp(R("thWorkGroup")),
    t("boq.edCatMaterial" as DictKey),
    t("boq.repThSubcon"),
    t("boq.edCatLabor" as DictKey),
    tp(R("thTotal")),
  ];
  const rpt004Headers = [
    tp(R("thWorkPeriod")),
    t("boq.repThPlanBoq"),
    t("boq.repThActual"),
    t("boq.repThVariance"),
    t("boq.repThPctDev"),
    t("common.status"),
  ];

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), t("nav.boq.reports")]}
      title={t("nav.boq.reports")}
      subtitle={t("boq.repSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Filter / print / export: no filter-persist / print / export endpoint yet ->
              deferred no-op stubs (boq-overview export precedent). */}
          <Btn kind="outline" size="md" icon="filter">
            {t("common.filter")}
          </Btn>
          <Btn kind="outline" size="md" icon="print">
            {t("common.print")}
          </Btn>
          <Btn kind="primary" size="md" icon="download">
            {t("boq.repExportBtn")}
          </Btn>
        </div>
      }
    >
      {/* Scope-conditions strip */}
      <Card pad={14} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{t("boq.repScopeConditions")}</span>
          <ScopePill label={tp(R("scopeProject"))} value={activeProjectName} />
          {/* Phase / period have no wire source -> em-dash. Block / category show the "all"
              default (no filter applied). */}
          <ScopePill label={tp(R("scopePhase"))} value={DASH} muted />
          <ScopePill label={t("boq.repScopeBlock")} value={tp(R("allLabel"))} muted />
          <ScopePill label={tp(R("scopePeriod"))} value={DASH} muted />
          <ScopePill label={tp(R("scopeCategory"))} value={tp(R("allCategory"))} muted />
        </div>
      </Card>

      {/* RPT-001 — BOQ vs Non-BOQ Summary (stacked bar + category table) */}
      <ReportCard
        code={t("boq.repRpt001")}
        title={t("boq.repSummaryTitle")}
        desc={t("boq.repSummaryDesc")}
        right={
          // Issued-at meta (boq.repIssuedAt, "issued at {datetime}") — the report-generation
          // timestamp has no source, so the datetime is an em-dash, never a mock time.
          <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>
            {t("boq.repIssuedAt").replace("{datetime}", DASH)}
          </span>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 0 }}>
          <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 12 }}>
              {t("boq.repValueByCat")}
            </div>
            {bvnBars.length === 0 ? (
              <EmptyBody minHeight={160} />
            ) : (
              // Stacked BOQ (plan) + Non-BOQ (over-plan) bar per work category (boq.jsx:1711).
              bvnBars.map((bar, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 500 }}>{bar.label ?? DASH}</span>
                    <span className="num" style={{ color: "var(--text-3)" }}>
                      {millions2(bar.boq)}M <span style={{ color: "var(--danger)" }}>+{millions2(bar.nonBoq)}M</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", height: 18, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${bar.boqPct}%`, background: "var(--brand)" }} />
                    <div
                      style={{
                        width: `${bar.nonPct}%`,
                        background: "var(--danger)",
                        backgroundImage:
                          "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.3) 4px, rgba(255,255,255,0.3) 8px)",
                      }}
                    />
                  </div>
                </div>
              ))
            )}
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <Legend color="var(--brand)" label={t("boq.repLegendBoqPlan")} />
              <Legend color="var(--danger)" label={t("boq.repLegendNonBoqOver")} />
            </div>
          </div>
          <div style={{ overflow: "auto" }}>
            {bvnRows.length === 0 || !bvn ? (
              <EmptyTable headers={rpt001Headers} />
            ) : (
              <ReportTable headers={rpt001Headers}>
                <tbody>
                  {bvnRows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 500 }}>{r.categoryLabel ?? DASH}</td>
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        {formatMoney(r.boq)}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: "var(--danger)", fontWeight: 600 }} className="num">
                        +{formatMoney(r.nonBoq)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.totalActual)}
                      </td>
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        {r.pctOver == null ? (
                          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                        ) : (
                          <span style={badgeStyle(pctOverBadge(r.pctOver))}>+{formatPct1(r.pctOver)}%</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }}>{tp(R("thTotal"))}</td>
                    {totalCell(formatMoney(bvn.totals.boq))}
                    {totalCell(`+${formatMoney(bvn.totals.nonBoq)}`, "var(--danger)")}
                    {totalCell(formatMoney(bvn.totals.totalActual), "var(--brand)")}
                    {totalCell(
                      bvn.totals.pctOver == null ? DASH : `+${formatPct1(bvn.totals.pctOver)}%`,
                    )}
                  </tr>
                </tfoot>
              </ReportTable>
            )}
          </div>
        </div>
      </ReportCard>

      {/* RPT-002 — BOQ Revise Report (before/after) */}
      <ReportCard
        code={t("boq.repRpt002")}
        title={t("boq.repReviseTitle")}
        desc={t("boq.repReviseDesc")}
      >
        <EmptyTable
          headers={[
            t("boq.repThBoq"),
            t("boq.arcThVersion"),
            tp(R("thReason")),
            t("boq.repThBefore"),
            t("boq.repThAfter"),
            t("boq.repThDiff"),
            tp(R("thApprover")),
            tp(R("thDate")),
          ]}
        />
      </ReportCard>

      {/* RPT-003 — Material / Subcon / Labor Breakdown */}
      <ReportCard
        code={t("boq.repRpt003")}
        title={t("boq.repMslTitle")}
        desc={t("boq.repMslDesc")}
      >
        <div style={{ padding: 20 }}>
          {msl?.hasData ? (
            // Real M/S/L share bar (boq-extra.jsx:335-339): segment width = share of
            // grand total, inline label = the server's integer ratio %.
            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden" }}>
              {(
                [
                  { seg: msl.material, code: "M", bg: "var(--brand)" },
                  { seg: msl.subcon, code: "S", bg: "#1D4ED8" },
                  { seg: msl.labor, code: "L", bg: "#B45309" },
                ] as const
              ).map((s) => (
                <div
                  key={s.code}
                  style={{
                    width: `${s.seg.widthPct}%`,
                    background: s.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    overflow: "hidden",
                  }}
                >
                  {s.code} {s.seg.labelPct ?? 0}%
                </div>
              ))}
            </div>
          ) : (
            // No spend yet → keep the honest empty frame + the structural legend.
            <>
              <EmptyBody minHeight={26} />
              <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                <Legend color="var(--brand)" label={t("boq.edCatMaterial" as DictKey)} />
                <Legend color="#1D4ED8" label={t("boq.repThSubcon")} />
                <Legend color="#B45309" label={t("boq.edCatLabor" as DictKey)} />
              </div>
            </>
          )}
        </div>
        {costRows.length === 0 || !costType ? (
          <EmptyTable headers={rpt003Headers} />
        ) : (
          <MslTable report={costType} totalLabel={tp(R("thTotal"))} headers={rpt003Headers} />
        )}
      </ReportCard>

      {/* RPT-004 — Variance Report (Plan vs Actual) */}
      <ReportCard
        code={t("boq.repRpt004")}
        title={t("boq.repVarTitle")}
        desc={t("boq.repVarDesc")}
      >
        {varRows.length === 0 || !variance ? (
          <EmptyTable headers={rpt004Headers} />
        ) : (
          <ReportTable headers={rpt004Headers}>
            <tbody>
              {varRows.map((r, i) => {
                const view = classifyVarianceRow(r);
                const noActual = view.pending || r.actual == null;
                const noVar = view.pending || r.variance == null;
                const noDev = view.pending || r.pctDev == null;
                return (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.periodLabel ?? DASH}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {formatMoney(r.plan)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {noActual ? DASH : formatMoney(r.actual as number)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 600,
                        color: noVar ? "var(--text-3)" : varianceColor(r.variance as number),
                      }}
                      className="num"
                    >
                      {noVar
                        ? DASH
                        : ((r.variance as number) > 0 ? "+" : "") + formatMoney(r.variance as number)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {noDev ? (
                        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                      ) : (
                        <span style={badgeStyle(varianceDevBadge(r.pctDev as number))}>
                          {(r.pctDev as number) > 0 ? "+" : ""}
                          {formatPct1(r.pctDev as number)}%
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      {view.statusKey ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: view.statusKey === "boq.repStatusPending" ? "var(--text-3)" : "var(--ok)",
                          }}
                        >
                          {t(view.statusKey)}
                        </span>
                      ) : view.rawStatus ? (
                        // Unknown server status code → shown raw, never invented Thai (§0 rule 4).
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{view.rawStatus}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{DASH}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ReportTable>
        )}
      </ReportCard>

      {/* RPT-005 — EVM (PV/EV/AC chart + SPI/CPI) */}
      <ReportCard code={t("boq.repRpt005")} title={t("boq.repEvmTitle")} desc={t("boq.repEvmDesc")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 0 }}>
          <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
            {evmChart ? (
              // Real PV/EV/AC S-curve (boq-extra.jsx:438-450), geometry from buildEvmChart.
              <svg viewBox={`0 0 ${evmChart.width} ${evmChart.height}`} style={{ width: "100%", height: "auto" }}>
                {evmChart.gridLines.map((g, i) => (
                  <g key={i}>
                    <line
                      x1={evmChart.pad}
                      y1={g.y}
                      x2={evmChart.width - evmChart.pad}
                      y2={g.y}
                      stroke="var(--border)"
                      strokeWidth="1"
                    />
                    <text x={evmChart.pad - 6} y={g.y + 3} textAnchor="end" fontSize="9" fill="var(--text-3)">
                      {g.label}
                    </text>
                  </g>
                ))}
                {evmChart.xLabels.map((xl, i) => (
                  <text
                    key={i}
                    x={xl.x}
                    y={evmChart.height - evmChart.pad + 14}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="var(--text-3)"
                  >
                    {xl.label ?? DASH}
                  </text>
                ))}
                <path d={evmChart.pvPath} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="4 3" />
                <path d={evmChart.acPath} fill="none" stroke="var(--danger)" strokeWidth="2" />
                <path d={evmChart.evPath} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
                {evmChart.evPoints.map((pt, i) => (
                  <circle key={i} cx={pt.cx} cy={pt.cy} r="3" fill="var(--brand)" />
                ))}
              </svg>
            ) : (
              <EmptyBody minHeight={180} />
            )}
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <Legend color="var(--text-3)" label={t("boq.repEvmLegPv")} />
              <Legend color="var(--brand)" label={t("boq.repEvmLegEv")} />
              <Legend color="var(--danger)" label={t("boq.repEvmLegAc")} />
            </div>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { k: t("boq.repEvmSpi"), hint: t("boq.repEvmSpiHint"), value: evm?.spi ?? null },
              { k: t("boq.repEvmCpi"), hint: t("boq.repEvmCpiHint"), value: evm?.cpi ?? null },
            ].map((m) => {
              const good = m.value != null && spiGood(m.value);
              return (
                <div key={m.k} style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                    {m.k} · {m.hint}
                  </div>
                  {/* Real index when the EVM store carries one; honest em-dash otherwise. */}
                  <div
                    className="num"
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: m.value == null ? "var(--text-3)" : good ? "var(--ok)" : "var(--danger)",
                      marginTop: 2,
                    }}
                  >
                    {m.value == null ? DASH : m.value.toFixed(2)}
                  </div>
                  {m.value != null && (
                    <div style={{ fontSize: 10.5, color: good ? "var(--ok)" : "var(--danger)", fontWeight: 600 }}>
                      {good ? t("boq.repEvmGood") : t("boq.repEvmBad")}
                    </div>
                  )}
                </div>
              );
            })}
            {evm && evm.series.length > 0 && (
              // As-of footer for the last period (boq-extra.jsx:468-470).
              <div style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.5 }}>
                {t("boq.repEvmFooter")
                  .replace("{month}", evm.series[evm.series.length - 1].periodLabel ?? DASH)
                  .replace("{ev}", millions1(evm.series[evm.series.length - 1].ev))
                  .replace("{pv}", millions1(evm.series[evm.series.length - 1].pv))
                  .replace("{ac}", millions1(evm.series[evm.series.length - 1].ac))}
              </div>
            )}
          </div>
        </div>
      </ReportCard>
    </Page>
  );
}
