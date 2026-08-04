/*
 * GLProjectPL — the per-project Profit & Loss report, ported from
 * pototype/accounting-extra2.jsx GLProjectPL (L343-494). Route gl.projectpl
 * (docs/extract/NAV-ROUTES.md L66, section "gl").
 *
 * Design fidelity (§0 rule 1): the three-part breadcrumb (finance section · GL · project-P&L
 * screen), the title/subtitle, the presentational Export header action, the 4 KPI cards (total
 * revenue / total net income / best margin / losing count), the Card(pad=0) with its 9-column
 * register (project · revenue · cogs · gross-profit · GP-margin bar · SG&A+interest · net-income ·
 * net-margin pill · chevron), the emphasized totals tfoot, and the info footnote are the
 * prototype's. Clicking a row opens the per-project detail modal (openDetail).
 *
 * Data (§0 rule 3): the prototype's local PROJPL_SEED (fixed Thai project names/types + hardcoded
 * revenue/cogs sub-lines + client-side plRev/plGP/plEBIT/plNP math) is dropped — every figure is the
 * REAL server aggregation from GET /gl/reports/project-pl (use-gl-projectpl.ts). The wire is the
 * opaque EntityOk OBJECT { projects, totals, currency_code }; the pure narrowing + selection +
 * millions/parens/margin formatting live in gl-projectpl-rows.ts (unit-tested, G3).
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md — money=NONE, the P&L is SERVER-computed): the server owns
 * 100% of the authoritative figures. Every result figure — gross_profit, pre_tax, tax, net_income,
 * and BOTH margins — is DISPLAYED straight off the wire; the web NEVER recomputes a P&L figure (a
 * client roll-up would be forbidden money-math that could diverge from the server). The only client
 * arithmetic anywhere is the presentational "SG&A + interest" column GROUPING (sgaInterest — a sum of
 * two already-authoritative server cost fields into one combined display column, prototype
 * `p.sga + p.interest`; not a P&L result the server owns, cannot diverge). The KPIs read server
 * totals (project_count / losing_count / net_margin); "best margin" is a SELECTION (pickBest) over
 * the loaded server figures, never a computed money value; millions scaling is display-only.
 *
 * HONEST DIVERGENCES (reported, never fabricated) — flagged here + in gl-projectpl-rows.ts:
 *   - project `type` sub-label (F-PL1): the prototype prints a per-project type label (project-type
 *     text) under the name; the /gl/reports/project-pl wire has project_name but NO type field -> the
 *     sub-label is omitted (never fabricated), the name stands alone.
 *   - detail-modal sub-lines + EBIT (F-PL2): the prototype modal renders indented per-line
 *     revenue/cogs breakdown + an EBIT (operating-profit) subtotal. The endpoint AGGREGATES to
 *     one figure per bucket, so the sub-lines have no wire source, and EBIT (= gp − sga) would be a
 *     forbidden client recompute -> both are dropped; the modal renders a flat income statement of
 *     SERVER fields only (revenue · cogs · gross_profit · sga · interest · tax · net_income +
 *     server margins).
 *   - central (unallocated) bucket (F-PL3): a jv_line with a NULL project_id yields a
 *     project_id/name-null row (real central activity) — its name shows an em-dash, never dropped.
 *   - losing-row tint (F-PL4): the prototype mixes danger-soft with hardcoded "white"; §0 rule 6
 *     tokens-only -> mixed with the --surface token instead.
 *   - Export / modal PDF actions: no ported export modal + no export/pdf dict key -> no-op stub
 *     buttons (gl-cashflow Export precedent), never a fabricated toast.
 *   - empty register (F-PL5): a fresh/empty seed -> the empty-state renders; a pending load shows
 *     the skeleton (apps/web/CLAUDE.md).
 *
 * i18n (§0 rule 2): every visible string is a gl-projectpl-strings.json phrase (tp) or an existing
 * DICT key (t: fin.breadcrumbFinance / common.export / common.close / pm.unitMillion). Pure-ASCII
 * prototype strings are inline literals (no Thai): "GL" crumb, "GP Margin"/"Net Margin", the
 * "P&L ·" modal-title prefix, "PDF". Tokens back every colour (§0 rule 6). NO Thai/baht in this
 * .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toProjectPl,
  pickBest,
  losingNames,
  sgaInterest,
  formatMoney,
  formatParen,
  formatMillions,
  formatMargin,
  marginBarPct,
  type ProjectPlRow,
} from "./gl-projectpl-rows";
import { useGlProjectPl } from "./use-gl-projectpl";
import projectplStrings from "./gl-projectpl-strings.json" with { type: "json" };

const DASH = "—";

/** Phrase-layer lookup for the (not-yet-minted) Thai strings — tp() returns the key itself for
 *  lang=th (honest Thai), the sidecar value IS the key. `as PhraseKey` is the ap-deposit precedent. */
const P = (k: keyof typeof projectplStrings): PhraseKey =>
  projectplStrings[k] as PhraseKey;

/** Header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** KPI card, inlined from dashboard.jsx Kpi (the label/value/unit/sub/accent props this screen
 *  uses) — same shape as gl-cashflow's inlined Kpi. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** GP-margin progress bar, inlined from ds.jsx Bar (tokens only). `pct` is the SERVER gross margin;
 *  a null margin (0-revenue) shows an em-dash instead of the bar (honest-null). */
function MarginBar({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>{DASH}</span>;
  }
  const fill = marginBarPct(pct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ flex: 1 }}>
        <div style={{ width: "100%", height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${fill}%`, height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width .3s" }} />
        </div>
      </div>
      <span className="num" style={{ fontSize: 11, fontWeight: 700, width: 42 }}>{formatMargin(pct)}</span>
    </div>
  );
}

/**
 * The per-project detail modal body (prototype openDetail L378-414) — a flat income statement of
 * SERVER fields only. The prototype's indented revenue/cogs SUB-LINES + the EBIT subtotal are
 * dropped (F-PL2: aggregated wire / EBIT would be a client recompute); every line shown is read
 * straight off the row. Amounts are accounting-style (negatives in parentheses).
 */
function ProjectPlDetail({
  row,
  t,
  tp,
  onClose,
}: {
  row: ProjectPlRow;
  t: (k: "common.close") => string;
  tp: (k: PhraseKey) => string;
  onClose: () => void;
}) {
  const line = (
    label: string,
    value: number,
    opt: { bold?: boolean; color?: string } = {},
  ) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12.5, fontWeight: opt.bold ? 800 : 500, color: opt.color || (opt.bold ? "var(--text)" : "var(--text-2)") }}>{label}</span>
      <span className="num" style={{ fontSize: 12.5, fontWeight: opt.bold ? 800 : 600, color: opt.color || (value < 0 ? "var(--danger)" : "var(--text)") }}>{formatParen(value)}</span>
    </div>
  );
  return (
    <div>
      {line(tp(P("colRevenue")), row.revenue)}
      {line(tp(P("colCogs")), -row.cogs)}
      {line(tp(P("mGrossProfit")), row.grossProfit, { bold: true, color: row.grossProfit >= 0 ? "var(--ok)" : "var(--danger)" })}
      <div style={{ height: 10 }} />
      {line(tp(P("mSga")), -row.sga)}
      {line(tp(P("mInterest")), -row.interest)}
      {line(tp(P("mTax")), -row.tax)}
      {line(tp(P("mNetIncome")), row.netIncome, { bold: true, color: row.netIncome >= 0 ? "var(--brand)" : "var(--danger)" })}
      <div style={{ display: "flex", gap: 14, marginTop: 14, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 9, fontSize: 11.5 }}>
        <span>GP Margin <b className="num" style={{ color: "var(--ok)" }}>{formatMargin(row.grossMargin)}</b></span>
        <span>Net Margin <b className="num" style={{ color: row.netIncome >= 0 ? "var(--brand)" : "var(--danger)" }}>{formatMargin(row.netMargin)}</b></span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>{tp(P("mSgaNote"))}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        {/* PDF = no-op stub (no ported export/pdf dict key; gl-cashflow Export precedent). */}
        <Btn kind="outline" size="md" icon="download">PDF</Btn>
        <Btn kind="primary" size="md" onClick={onClose}>{t("common.close")}</Btn>
      </div>
    </div>
  );
}

export function GLProjectPL() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const q = useGlProjectPl();
  const vm = useMemo(() => toProjectPl(q.data), [q.data]);
  const best = useMemo(() => pickBest(vm.rows), [vm.rows]);
  const losing = useMemo(() => losingNames(vm.rows), [vm.rows]);

  const projectWord = tp(P("projectWord"));

  const openDetail = (row: ProjectPlRow) =>
    ctx.openModal({
      title: `P&L · ${row.projectName || DASH}`,
      subtitle: tp(P("modalSubtitle")),
      icon: "pie",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <ProjectPlDetail row={row} t={t} tp={tp} onClose={close} />
      ),
    });

  const skeleton = (
    <div style={{ padding: 20 }}>
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
      ))}
    </div>
  );

  const table = (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
            <th style={th()}>{tp(P("projectWord"))}</th>
            <th style={th(120, true)}>{tp(P("colRevenue"))}</th>
            <th style={th(120, true)}>{tp(P("colCogs"))}</th>
            <th style={th(120, true)}>{tp(P("colGrossProfit"))}</th>
            <th style={th(120)}>GP Margin</th>
            <th style={th(110, true)}>{tp(P("colSgaInterest"))}</th>
            <th style={th(120, true)}>{tp(P("colNetProfit"))}</th>
            <th style={th(120)}>Net Margin</th>
            <th style={th(70)} />
          </tr>
        </thead>
        <tbody>
          {/* Empty register (F-PL5): honest em-dash marker (ap-deposit precedent), never a
              fabricated Thai string; the header + zero-totals tfoot stay visible. */}
          {vm.rows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                <Icon name="pie" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                <div style={{ marginTop: 10, fontSize: 13 }}>{DASH}</div>
              </td>
            </tr>
          )}
          {vm.rows.map((p, i) => (
            <tr
              key={p.projectId ?? `central-${i}`}
              onClick={() => openDetail(p)}
              style={{
                borderTop: "1px solid var(--border)",
                cursor: "pointer",
                background: p.netIncome < 0 ? "color-mix(in srgb, var(--danger-soft) 45%, var(--surface))" : "transparent",
              }}
            >
              <td style={td}>
                <div style={{ fontWeight: 600 }}>{p.projectName || DASH}</div>
              </td>
              <td className="num" style={{ ...td, textAlign: "right", fontWeight: 600 }}>{formatMoney(p.revenue)}</td>
              <td className="num" style={{ ...td, textAlign: "right", color: "var(--text-2)" }}>{`(${formatMoney(p.cogs)})`}</td>
              <td className="num" style={{ ...td, textAlign: "right", fontWeight: 700, color: p.grossProfit >= 0 ? "var(--ok)" : "var(--danger)" }}>{formatMoney(p.grossProfit)}</td>
              <td style={td}><MarginBar pct={p.grossMargin} /></td>
              <td className="num" style={{ ...td, textAlign: "right", color: "var(--text-2)" }}>{`(${formatMoney(sgaInterest(p))})`}</td>
              <td className="num" style={{ ...td, textAlign: "right", fontWeight: 800, color: p.netIncome >= 0 ? "var(--brand)" : "var(--danger)" }}>{formatParen(p.netIncome)}</td>
              <td style={td}>
                <span className="num" style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: p.netIncome >= 0 ? "var(--ok-soft)" : "var(--danger-soft)", color: p.netIncome >= 0 ? "var(--ok)" : "var(--danger)" }}>{formatMargin(p.netMargin)}</span>
              </td>
              <td style={{ ...td, textAlign: "right" }}><Icon name="chevR" size={15} color="var(--text-3)" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
          <tr>
            <td style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>{tp(P("totalRowLabel")).replace("{count}", String(vm.totals.projectCount))}</td>
            <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 700 }}>{formatMoney(vm.totals.revenue)}</td>
            <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 700 }}>{`(${formatMoney(vm.totals.cogs)})`}</td>
            <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "var(--ok)" }}>{formatMoney(vm.totals.grossProfit)}</td>
            <td />
            <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 700 }}>{`(${formatMoney(sgaInterest(vm.totals))})`}</td>
            <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }}>{formatMoney(vm.totals.netIncome)}</td>
            <td style={{ padding: 12 }}><span className="num" style={{ fontSize: 11, fontWeight: 800 }}>{formatMargin(vm.totals.netMargin)}</span></td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)", display: "flex", gap: 6, alignItems: "center" }}>
        <Icon name="info" size={13} /> {tp(P("footNote"))}
      </div>
    </>
  );

  const netMarginLabel = "Net Margin ";

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        /* Export = no-op stub (no ported export modal + no export dict key; gl-cashflow precedent). */
        <Btn kind="outline" size="md" icon="download">{t("common.export")}</Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={tp(P("kpiRevLabel"))}
          value={formatMillions(vm.totals.revenue)}
          unit={t("pm.unitMillion")}
          sub={`${vm.totals.projectCount} ${projectWord}`}
          accent="var(--brand)"
        />
        <Kpi
          label={tp(P("kpiNetLabel"))}
          value={formatMillions(vm.totals.netIncome)}
          unit={t("pm.unitMillion")}
          sub={netMarginLabel + formatMargin(vm.totals.netMargin)}
          accent="var(--ok)"
        />
        <Kpi
          label={tp(P("kpiBestLabel"))}
          value={best ? formatMargin(best.netMargin) : DASH}
          sub={best ? best.projectName || DASH : DASH}
          accent="var(--ok)"
        />
        <Kpi
          label={tp(P("kpiLosingLabel"))}
          value={String(vm.totals.losingCount)}
          unit={projectWord}
          sub={losing.length ? losing.join(", ") : tp(P("none"))}
          accent={vm.totals.losingCount ? "var(--danger)" : "var(--ok)"}
        />
      </div>

      <Card pad={0}>{q.isLoading ? skeleton : table}</Card>
    </Page>
  );
}
