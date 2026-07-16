/*
 * BOQReports — the BOQ Reports screen, ported 1:1 from pototype/boq.jsx BOQReports
 * (L1637-1852) + boq-extra.jsx BOQReportsExtra (RPT-003/004/005, L322-479). Route
 * boq.reports (docs/extract/NAV-ROUTES.md L28), visual-gate reference
 * tests/visual/reference/gallery/g1/14. B-070 ruling: reports = read-view, match-prototype.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout is the prototype's, verbatim — the
 * two-crumb breadcrumb, the title/subtitle, the three header actions (filter / print /
 * export-Excel), the scope-conditions strip, and the FIVE report cards:
 *   RPT-001 BOQ vs Non-BOQ Summary (stacked bar + category table)
 *   RPT-002 BOQ Revise Report (before/after)
 *   RPT-003 Material / Subcon / Labor Breakdown
 *   RPT-004 Variance Report (Plan vs Actual)
 *   RPT-005 EVM (PV/EV/AC chart + SPI/CPI)
 * Each card keeps its RPT badge + title + description header, its table column headers, and
 * its chart legend/frame — the report's structural skeleton.
 *
 * Data (rule 8, C10 — the load-bearing honesty of this screen): the report DATA has NO
 * backend source. There is no /reports (or any aggregate) endpoint (apps/api/src/routes/
 * boq.ts exposes only /boq, /boq/{id}, /boq/{id}/items, generate-pr and the state machine),
 * and — more fundamentally — there is NO source for the figures these reports need:
 *   - Non-BOQ (over-plan) spend            — no actuals ledger
 *   - per-installment Actual cost          — no progress-cost source
 *   - EVM PV/EV/AC time-series             — no earned-value source
 *   - BOQ revise before/after snapshots    — boq_doc keeps only the current version, no log
 * The prototype hard-codes every one of these (its ARCHIVE-style mock arrays), and the i18n
 * pass deliberately left the mock ROW labels (revise reasons / installment descriptions)
 * un-keyed. So per the task rule ("if a report needs data with no backend source, render the
 * honest em-dash / empty-state and FLAG it — do NOT fabricate report numbers"), every report
 * BODY renders an honest empty-state em-dash under its real structural headers, and NO figure
 * is invented. This is a documented divergence from the fully-populated reference image (the
 * numbers there are the prototype's mock); it is flagged, not a defect. When a reports/
 * analytics endpoint lands, the empty bodies wire to it.
 *
 * The only REAL datum on this screen is the scope strip's project pill (the active-project
 * name from GET /projects). The other scope pills (phase / period) have no source (em-dash);
 * block / category show their "all" default (no filter applied). The header filter/print/
 * export buttons have no backend (no filter-persist / print / export endpoint), so they are
 * deferred no-op stubs (boq-overview export precedent).
 *
 * i18n (rule 2): every string is a boq.rep* / nav. dict key (t) or a boq-reports-strings.json
 * phrases key (tp). Tokens back every colour (rule 6); the #1D4ED8 / #B45309 MSL legend hexes
 * are prototype-verbatim literals with no @juneflow/tokens value (B-037(a)). Comments are
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
import repStrings from "./boq-reports-strings.json" with { type: "json" };

const R = (k: keyof typeof repStrings) => repStrings[k] as PhraseKey;

/** The honest em-dash marker used for every un-sourced value (C10). */
const DASH = "—";

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

/** A report table: real column headers (thead) over an honest single em-dash empty row. */
function EmptyTable({ headers }: { headers: ReactNode[] }) {
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
    </table>
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

export function BOQReports() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const projectsQ = useProjects();

  // The one real datum on the screen: the active project's name (scope strip). Everything
  // else on this screen is an un-sourced report aggregate (em-dash).
  const projectTweak = ctx.tweaks.project;
  const activeProjectName = useMemo(() => {
    const p = resolveActiveProject(projectsQ.data, projectTweak);
    return p?.name ?? DASH;
  }, [projectsQ.data, projectTweak]);

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
            <EmptyBody minHeight={160} />
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <Legend color="var(--brand)" label={t("boq.repLegendBoqPlan")} />
              <Legend color="var(--danger)" label={t("boq.repLegendNonBoqOver")} />
            </div>
          </div>
          <div style={{ overflow: "auto" }}>
            <EmptyTable
              headers={[
                tp(R("thWorkGroup")),
                t("boq.repThBoq"),
                t("boq.ovTabNon" as DictKey),
                t("boq.repThActualUsed"),
                t("boq.repThPctOver"),
              ]}
            />
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
          {/* Stacked M/S/L bar — no source, empty frame (legend below keeps the structure). */}
          <EmptyBody minHeight={26} />
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <Legend color="var(--brand)" label={t("boq.edCatMaterial" as DictKey)} />
            <Legend color="#1D4ED8" label={t("boq.repThSubcon")} />
            <Legend color="#B45309" label={t("boq.edCatLabor" as DictKey)} />
          </div>
        </div>
        <EmptyTable
          headers={[
            tp(R("thWorkGroup")),
            t("boq.edCatMaterial" as DictKey),
            t("boq.repThSubcon"),
            t("boq.edCatLabor" as DictKey),
            tp(R("thTotal")),
          ]}
        />
      </ReportCard>

      {/* RPT-004 — Variance Report (Plan vs Actual) */}
      <ReportCard
        code={t("boq.repRpt004")}
        title={t("boq.repVarTitle")}
        desc={t("boq.repVarDesc")}
      >
        <EmptyTable
          headers={[
            tp(R("thWorkPeriod")),
            t("boq.repThPlanBoq"),
            t("boq.repThActual"),
            t("boq.repThVariance"),
            t("boq.repThPctDev"),
            t("common.status"),
          ]}
        />
      </ReportCard>

      {/* RPT-005 — EVM (PV/EV/AC chart + SPI/CPI) */}
      <ReportCard code={t("boq.repRpt005")} title={t("boq.repEvmTitle")} desc={t("boq.repEvmDesc")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 0 }}>
          <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
            <EmptyBody minHeight={180} />
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <Legend color="var(--text-3)" label={t("boq.repEvmLegPv")} />
              <Legend color="var(--brand)" label={t("boq.repEvmLegEv")} />
              <Legend color="var(--danger)" label={t("boq.repEvmLegAc")} />
            </div>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { k: t("boq.repEvmSpi"), hint: t("boq.repEvmSpiHint") },
              { k: t("boq.repEvmCpi"), hint: t("boq.repEvmCpiHint") },
            ].map((m) => (
              <div key={m.k} style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                  {m.k} · {m.hint}
                </div>
                {/* SPI / CPI have no earned-value source -> em-dash, never a fabricated index. */}
                <div className="num" style={{ fontSize: 26, fontWeight: 700, color: "var(--text-3)", marginTop: 2 }}>
                  {DASH}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ReportCard>
    </Page>
  );
}
