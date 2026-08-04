/*
 * OpexBudget — the corporate OPEX budget console, ported from pototype/opex-budget.jsx
 * OpexBudget (L44-183). Route `opex` (docs/extract/NAV-ROUTES.md L58, file opex-budget.jsx).
 * THIN-HONEST read + create (Wei B-246, option thin-honest): the live opex_budget store
 * holds ONLY { dept, year, months[12], currency_code } (a planning INPUT), so the screen
 * renders that backed shape and honest-em-dashes / disables every richer prototype element
 * that has no wire — never a fabricated number (§0 rule 3, mirrors subcon-progress B-229).
 *
 * BACKED (real):
 *   - Page shell (breadcrumb / title / subtitle) is the prototype's;
 *   - the primary create-budget action is WIRED to the add-budget form -> POST /opex/budgets
 *     (money = SERVER: the client sends only { dept, year, months[12] }; the server forces
 *     currency THB and 409s a duplicate dept+year, use-opex.ts);
 *   - KPI-1 (whole-year OPEX budget) = Σ of every dept's 12 months + the dept count;
 *   - the per-dept table's annual-total column + the tfoot total = annualTotal / totalBudget
 *     (a display roll-up of the SERVER-owned month figures — never a JV/compute);
 *   - row-click opens a detail modal that renders the REAL 12-month breakdown (bars scale
 *     off the month figures — a pure display derivation of real numbers);
 *   - loading = token skeleton; an empty register = the table's empty state.
 *
 * HONEST EM-DASH / DISABLED (no wire — never fabricated):
 *   - Export + the budget-transfer header actions: mocks with no endpoint -> disabled;
 *   - the multi-year tab (4-year CAGR/YoY/over-budget streak): no multi-year wire -> disabled;
 *   - KPI-2 used-YTD / KPI-3 committed / KPI-4 over-budget depts: no used/committed store -> em-dash;
 *   - the per-dept used+committed / remaining / %-used columns (+ the progress bar): em-dash /
 *     honest-empty 0-fill track — only the annual-total column is real;
 *   - the monthly plan-vs-ACTUAL chart: no per-month actuals wire -> honest-empty card body
 *     (header + the prototype's GL-5100 info line kept for structure);
 *   - the detail modal's cat breakdown (opex_budget has no cats[]) is REPLACED by the real
 *     12-month figures; its budget-transfer action stays disabled.
 *
 * i18n (§0 rule 2): every string is an opex-strings.json phrase (tp — EXISTING keys, plus NEW
 * ones staged for the B-248 i18n round) or an existing DICT key (t: org.unitDept / common.*).
 * NO Thai/baht literal sits in this .tsx (B-073); tokens back every colour (§0 rule 6); numeric
 * cells carry class `num` (§0 rule 7); "—" (em-dash) / "%" are language-invariant symbols.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toOpexRow,
  sortRows,
  annualTotal,
  totalBudget,
  deptCount,
  maxMonth,
  latestYear,
  formatMoney,
  buildOpexBody,
  MONTHS_IN_YEAR,
  type OpexRow,
} from "./opex-rows";
import { useOpexBudgets, useCreateOpexBudget } from "./use-opex";
import { OpexBudgetForm } from "./opex-budget-form";
import opexStrings from "./opex-strings.json" with { type: "json" };

/** Opaque POST /opex/budgets body (the contract types budgets as Entity). */
type Entity = components["schemas"]["Entity"];

/** The literal em-dash the screen renders for every un-backed field (never fabricated). */
const DASH = "—";
const PERCENT_SIGN = "%";

/** Map an opex-strings.json id to its PhraseKey (the verbatim Thai value). */
const P = (k: keyof typeof opexStrings): PhraseKey => opexStrings[k] as PhraseKey;

/** The 12 month-header phrase ids, Jan..Dec. */
const MONTH_KEYS = Array.from(
  { length: MONTHS_IN_YEAR },
  (_, i) => `m${i + 1}` as keyof typeof opexStrings,
);

/** Extract a server error message off an unknown mutation error (land-bank plotErr precedent). */
function opexErr(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** Table header cell style, ported from ds.jsx th(). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "start",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td(). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Kpi card, inlined from opex-budget.jsx Kpi usage (label + accent value + unit + sub). */
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
  accent: string;
}) {
  return (
    <Card pad={16}>
      <div style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 800, color: accent, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function OpexBudget() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const budgetsQ = useOpexBudgets();
  const createBudget = useCreateOpexBudget();

  const rows = useMemo(() => sortRows((budgetsQ.data ?? []).map(toOpexRow)), [budgetsQ.data]);
  const totalB = useMemo(() => totalBudget(rows), [rows]);
  const nDept = deptCount(rows);
  const yr = latestYear(rows);

  const deptUnit = t("org.unitDept");
  const unitMillion = tp(P("unitMillion"));
  const yearLabel = tp(P("yearLabel"));

  const subtitle =
    yr != null
      ? `${yearLabel} ${yr} ${DASH} ${tp(P("subtitleDesc"))}`
      : tp(P("subtitleDesc"));

  // Per-dept detail modal — the REAL 12-month breakdown (opex_budget has no cats[], so the
  // prototype's cat rows are honestly replaced by the backed month figures). money = NONE.
  const openDetail = (r: OpexRow) => {
    const maxM = maxMonth(r.months);
    ctx.openModal({
      title: r.dept,
      subtitle: `${yearLabel} ${r.year}`,
      icon: "pie",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <div>
          {Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
            const amt = r.months[i] ?? 0;
            const pct = maxM > 0 ? (amt / maxM) * 100 : 0;
            return (
              <div key={i} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{tp(P(MONTH_KEYS[i]!))}</span>
                  <span className="num" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                    {formatMoney(amt)}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: "var(--brand)" }} />
                </div>
              </div>
            );
          })}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
              paddingTop: 12,
              borderTop: "2px solid var(--border-strong)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t("common.total")}</span>
            <span className="num" style={{ fontSize: 14, fontWeight: 800, color: "var(--brand)" }}>
              {formatMoney(annualTotal(r.months))}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            {/* transfer has no endpoint -> honest-disabled. */}
            <Btn kind="outline" size="md" icon="pie" disabled>
              {tp(P("transferBtn"))}
            </Btn>
            <Btn kind="primary" size="md" onClick={close}>
              {t("common.close")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  // Add-budget (WIRED): open the form modal; on submit compose the { dept, year, months[12] }
  // body and fire POST /opex/budgets. money = SERVER — no currency_code is sent; a duplicate
  // (dept, year) is the server's 409, surfaced as a toast. The mutation observer lives on this
  // (mounted) screen, so its onError still fires after the modal body unmounts on close.
  const openCreate = () => {
    ctx.openModal({
      title: tp(P("createTitle")),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <OpexBudgetForm
          onClose={close}
          onSubmit={(draft) => {
            createBudget.mutate(buildOpexBody(draft) as Entity, {
              onError: (err) => ctx.notify(opexErr(err) || DASH, "danger"),
            });
            close();
          }}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[tp(P("bcRoot")), tp(P("bcScreen"))]}
      title={tp(P("title"))}
      subtitle={subtitle}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Export + transfer are mocks with no endpoint -> honest-disabled. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("common.export")}
          </Btn>
          <Btn kind="outline" size="md" icon="pie" disabled>
            {tp(P("transferBtn"))}
          </Btn>
          {/* WIRED: opens the add-budget form -> POST /opex/budgets. */}
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("createBtn"))}
          </Btn>
        </div>
      }
    >
      {/* View tabs — the year view is the real backed surface; the multi-year comparison has
          no wire (CAGR/YoY/over-budget streak) -> honest-disabled. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button
          type="button"
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            cursor: "default",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--brand)",
            color: "#fff",
          }}
        >
          {tp(P("tabYear"))}
        </button>
        <button
          type="button"
          disabled
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            cursor: "not-allowed",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--surface)",
            color: "var(--text-3)",
            boxShadow: "inset 0 0 0 1px var(--border)",
            opacity: 0.6,
          }}
        >
          {tp(P("tabMulti"))}
        </button>
      </div>

      {/* KPI strip (4): only KPI-1 (whole-year budget + dept count) is real; used / committed /
          over-budget have no store -> em-dash value, labels + units kept. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={tp(P("kpiBudgetLabel"))}
          value={(totalB / 1e6).toFixed(1)}
          unit={unitMillion}
          sub={`${nDept} ${deptUnit}`}
          accent="var(--brand)"
        />
        <Kpi label={tp(P("kpiUsedLabel"))} value={DASH} unit={unitMillion} sub={DASH} accent="var(--ok)" />
        <Kpi
          label={tp(P("kpiCommittedLabel"))}
          value={DASH}
          unit={unitMillion}
          sub={tp(P("kpiCommittedSub"))}
          accent="var(--warn)"
        />
        <Kpi label={tp(P("kpiOverLabel"))} value={DASH} unit={deptUnit} sub={DASH} accent="var(--text-3)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: the per-dept budget grid (GET /opex/budgets). */}
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
            {tp(P("tableTitle"))}
          </div>
          {budgetsQ.isLoading ? (
            // Loading skeleton — token blocks, no invented copy (mirror land-bank / master-customer).
            <div style={{ padding: 18 }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 44,
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                    <th scope="col" style={th()}>{deptUnit}</th>
                    <th scope="col" style={th(120, true)}>{tp(P("colBudget"))}</th>
                    <th scope="col" style={th(120, true)}>{tp(P("colUsed"))}</th>
                    <th scope="col" style={th(120, true)}>{tp(P("colRemain"))}</th>
                    <th scope="col" style={th(150)}>{tp(P("colPct"))}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                        <Icon name="pie" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                        <div style={{ marginTop: 10, fontSize: 12.5 }}>{DASH}</div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => openDetail(r)}
                        style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      >
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{r.dept || DASH}</div>
                          {/* the prototype cat-count sub is un-backed -> the REAL budget year. */}
                          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                            {yearLabel} <span className="num">{r.year}</span>
                          </div>
                        </td>
                        {/* annual total — REAL Σ of the 12 backed months. */}
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                          {formatMoney(annualTotal(r.months))}
                        </td>
                        {/* used + committed — no store -> em-dash. */}
                        <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
                          {DASH}
                        </td>
                        {/* remaining — needs used/committed -> em-dash. */}
                        <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
                          {DASH}
                        </td>
                        {/* %-used — no actuals -> honest-empty 0-fill track + em-dash pct. */}
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ flex: 1, height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                              <div style={{ width: "0%", height: "100%", background: "var(--brand)" }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, width: 38, color: "var(--text-3)" }}>
                              {DASH}
                              {PERCENT_SIGN}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                    <tr>
                      <td style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                        {t("common.total")} {nDept} {deptUnit}
                      </td>
                      {/* Σ budget is REAL; used / remaining / %used totals -> em-dash. */}
                      <td style={{ padding: 12, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(totalB)}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "var(--text-3)" }} className="num">
                        {DASH}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "var(--text-3)" }} className="num">
                        {DASH}
                      </td>
                      <td style={{ padding: 12 }}>
                        <span className="num" style={{ fontSize: 11, fontWeight: 800, color: "var(--text-3)" }}>
                          {DASH}
                          {PERCENT_SIGN}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>

        {/* Right: the monthly plan-vs-ACTUAL card. No per-month actuals wire -> honest-empty
            body (header + the prototype's GL-5100 info line kept for structure). */}
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
            {tp(P("monthlyTitle"))}
          </div>
          <div style={{ padding: "20px 18px" }}>
            <div
              style={{
                height: 170,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-3)",
                gap: 8,
              }}
            >
              <Icon name="pie" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
              <div style={{ fontSize: 12.5 }}>{DASH}</div>
            </div>
            <div
              style={{
                marginTop: 14,
                padding: "9px 12px",
                background: "var(--surface-2)",
                borderRadius: 8,
                fontSize: 11,
                color: "var(--text-3)",
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
              }}
            >
              <Icon name="info" size={13} />
              <span>{tp(P("glInfo"))}</span>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
}
