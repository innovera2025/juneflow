/*
 * TaxWHT — the PND3/PND53 withholding-tax report screen, ported from pototype/tax.jsx TaxWHT
 * (L112-end) + the attachment listing form from tax-forms.jsx PND53Form/FormPage/TaxIdBoxes. Route tax.wht
 * (NAV L83). Mirrors gl-inbox.tsx (t() DICT keys, honest em-dash, generated client + unwrap, inlined
 * th/td/MiniKpi/TabBar). CONSUME-ONLY i18n (Wave-B tax.* keys); ZERO Thai/baht in this .tsx (B-073).
 *
 * Data (rule 3): GET /tax/reports/wht (use-tax.ts) via the generated client — the prototype's mock
 * payee array becomes the real server report. The wire is AGGREGATE only { pnd3, pnd53, total_wht,
 * period, currency_code } (each group = { count, wht, base }; apps/api/src/routes/tax.ts whtReport);
 * the pure narrowing/heuristic/format logic lives in tax-rows.ts (G3).
 *
 * REAL vs em-dash (honest, never fabricated) — B-124:
 *   - KPIs (PND3 count + Σwht / PND53 count + Σwht / total wht) -> REAL group figures. The
 *     PND3-vs-PND53 split is the SERVER's tax_id-length heuristic (documented, not authoritative).
 *   - Due-date KPI -> presentational (NO filing-deadline wire) -> value em-dash; the prototype's mock
 *     "the mock June due-date" is dropped.
 *   - The payee DETAIL TABLE has NO wire (the report is aggregate only) -> it renders honest-empty (an
 *     em-dash body). The prototype's mock payee rows (+ their per-row 50-bis print buttons) are
 *     dropped; the 50-bis certificate is therefore unreachable on this wire (documented gap).
 *   - TabBar counts (all / PND3 / PND53) are REAL group counts; the "issued 50-bis" tab has no
 *     issuance wire -> its count is omitted (honest, not fabricated as 0-of-N).
 *   - Period chip -> the wire's report.period (or common.all); presentational (drop-not-collect).
 *
 * attachment listing form (B-124, client-render): the "Print attachment listing PND53 / 3" actions open the RD listing in a
 * fullbleed modal. Its footer/summary totals (count / Σ paid / Σ wht) are the REAL group figures for
 * the chosen kind (tax-rows.ts whtGroupFor); the per-payee rows render blank (honest-empty — no wire)
 * and the payer identity block is em-dash. Submit is a presentational toast (no e-filing endpoint).
 */
import { useState } from "react";
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx, type ShellCtx } from "../../shell/shell-context";
import {
  toWhtReport,
  whtGroupFor,
  whtAllCount,
  formatMoney,
  formatMoney2,
  EMPTY_WHT_REPORT,
  type WhtReport,
  type WhtGroup,
  type WhtForm,
} from "./tax-rows";
import { useWhtReport } from "./use-tax";

const DASH = "—";

/** The four prototype tabs. None filter visible rows (the payee table is honest-empty on this wire). */
type WhtTab = "all" | "pnd3" | "pnd53" | "issued";

/** Table header cell style (ds.jsx th(), as ported in gl-inbox). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gl-inbox). */
function MiniKpi({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone: string; icon: IconName }) {
  return (
    <div style={{ padding: 18, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** TabBar, inlined from ds.jsx TabBar (functional). A tab with a null count shows no count pill. */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: WhtTab; label: string; count?: number }[];
  active: WhtTab;
  onChange: (id: WhtTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              background: "none",
              border: "none",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: on ? "var(--brand)" : "var(--surface-3)",
                  color: on ? "#fff" : "var(--text-2)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Presentational filter chip (ds.jsx Filter muted visual, as ported in gl-jv). */
function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        fontSize: 11.5,
        color: "var(--text)",
        height: 32,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/* ========================================================================== */
/* attachment listing PND3 / PND53 RD form (client-render, fullbleed modal)                 */
/* ========================================================================== */

/** The Sarabun paper + print CSS the RD forms rely on (tax-forms.jsx form-print-css). ASCII-only. */
const FORM_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .form-paper, .form-paper * { visibility: visible; }
  .form-paper { position: absolute; left: 0; top: 0; box-shadow: none; padding: 8mm 10mm !important; }
  .form-toolbar { display: none !important; }
  @page { size: A4; margin: 8mm; }
}
.tax-form { font-family: "Sarabun","TH Sarabun New","IBM Plex Sans Thai",serif; }
.tax-form .grid-tax-id { display: inline-flex; gap: 2px; vertical-align: middle; }
.tax-form .grid-tax-id span {
  display: inline-block; width: 18px; height: 22px; border: 1px solid #000;
  text-align: center; font-family: monospace; font-size: 12px; line-height: 22px;
}
.tax-form table { width: 100%; border-collapse: collapse; }
.tax-form table th, .tax-form table td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; vertical-align: top; }
.tax-form table th { background: #F0F0F0; font-weight: 700; text-align: center; }
.tax-form .ck { display: inline-block; width: 12px; height: 12px; border: 1.2px solid #000; vertical-align: middle; margin-right: 4px; position: relative; }
.tax-form .ck.on::after { content: "\\2713"; position: absolute; top: -6px; left: 0; color: #000; font-size: 13px; font-weight: 800; line-height: 1; }
.tax-form .box { border: 1px solid #000; padding: 6px 8px; }
.tax-form h2 { font-size: 17px; margin: 0; text-align: center; font-weight: 800; }
.tax-form .sub { text-align: center; font-size: 11px; }
.tax-form .row { display: flex; gap: 12px; }
.tax-form .field-line { border-bottom: 1px dotted #000; display: inline-block; min-width: 60px; padding: 0 4px; }
.tax-form .v-label {
  writing-mode: vertical-rl; transform: rotate(180deg);
  text-align: center; font-weight: 700; font-size: 11px; padding: 4px 2px;
  background: #E8EEF6; border: 1px solid #000;
}
`;

/** Ensure the shared form-print CSS is present once (tax-forms.jsx guarded head-inject). */
function useFormPrintCss(): void {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("form-print-css")) return;
    const s = document.createElement("style");
    s.id = "form-print-css";
    s.textContent = FORM_PRINT_CSS;
    document.head.appendChild(s);
  }, []);
}

/** A4 white-paper print modal with a dark toolbar (tax-forms.jsx FormPage). Owns its own backdrop. */
function FormPage({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useFormPrintCss();
  const btnDark: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(8,18,32,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 24px 60px",
        overflow: "auto",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 820, background: "#fff", color: "#000", boxShadow: "0 20px 60px -10px rgba(0,0,0,0.4)", position: "relative" }}>
        <div
          className="form-toolbar"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            padding: "10px 14px",
            background: "#0B2A4A",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700 }}>
            <Icon name="doc" size={16} color="#fff" />
            {title}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => window.print()} style={btnDark}>
              <Icon name="print" size={14} color="#fff" /> {t("tax.form.btnPrint")}
            </button>
            <button type="button" onClick={onClose} style={{ ...btnDark, background: "#B91C1C" }}>
              <Icon name="x" size={14} color="#fff" /> {t("subcon.closeBtn")}
            </button>
          </div>
        </div>
        <div className="form-paper" style={{ padding: "28px 32px", minHeight: 1100, fontFamily: '"Sarabun","TH Sarabun New","IBM Plex Sans Thai",serif', color: "#000", lineHeight: 1.4, fontSize: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Row of monospace boxes for a tax id / branch code (tax-forms.jsx TaxIdBoxes). Blank when no value. */
function TaxIdBoxes({ value = "", len = 13 }: { value?: string; len?: number }) {
  const digits = value.padEnd(len, " ").slice(0, len).split("");
  return (
    <span className="grid-tax-id">
      {digits.map((d, i) => (
        <span key={i}>{d.trim()}</span>
      ))}
    </span>
  );
}

/** The attachment listing PND3/PND53 form body (tax-forms.jsx PND53Form). The footer/summary totals are REAL group
 *  figures; the per-payee rows render blank (honest-empty — no per-payee wire). */
function PND53Form({ report, form, onClose }: { report: WhtReport; form: WhtForm; onClose: () => void }) {
  const { t } = useI18n();
  const isPersonal = form === "3";
  const group: WhtGroup = whtGroupFor(report, form);
  const partyType = isPersonal ? t("tax.form53.partyPersonal") : t("tax.form53.partyCorporate");
  const kindTitle = t("tax.form53.modalTitle").replace("{kind}", form).replace("{partyType}", partyType);
  // Honest-empty: no per-payee wire -> the RD listing shows 6 blank rows (the prototype's empty-row pad).
  const EMPTY_ROWS = 6;

  return (
    <FormPage title={kindTitle} onClose={onClose}>
      <div className="tax-form">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ width: 80, height: 80, border: "1px solid #000", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 9 }}>
            <div>
              {t("tax.form.garuda")}
              <br />
              <span style={{ fontSize: 7, color: "#444" }}>{t("tax.form.rd")}</span>
            </div>
          </div>
          <div style={{ flex: 1, textAlign: "center", paddingTop: 4 }}>
            <h2>{t("tax.form53.h2").replace("{kind}", form)}</h2>
            <div className="sub">{isPersonal ? t("tax.form53.subPersonal") : t("tax.form53.subCorporate")}</div>
          </div>
          <div style={{ width: 130, fontSize: 10, border: "1px solid #000", padding: 6 }}>
            <div>{t("tax.form53.pageNo").replace("{page}", "1")}</div>
            <div>{t("tax.form53.pageOf").replace("{total}", "1")}</div>
          </div>
        </div>

        {/* Payer block (no wire -> blank/em-dash) */}
        <div className="box" style={{ marginBottom: 8, fontSize: 11 }}>
          <div style={{ marginBottom: 4 }}>
            <b>{t("tax.form53.payerLabel")}</b> &nbsp; {DASH}
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div>
              <b>{t("tax.form.taxIdLabel")}</b> &nbsp; <TaxIdBoxes value="" />
            </div>
            <div>
              <b>{t("tax.form.branchNoLabel")}</b> &nbsp; <TaxIdBoxes value="" len={5} />
            </div>
          </div>
        </div>

        {/* Main table — RD column order */}
        <table>
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 28 }}>
                {t("tax.form53.colSeq1")}
                <br />
                {t("tax.form53.colSeq2")}
              </th>
              <th colSpan={2}>
                {t("tax.form.taxIdLabel")}
                <br />
                {t("tax.form53.colTaxIdGroup2")}
              </th>
              <th rowSpan={2}>{t("tax.form53.colNameAddr")}</th>
              <th rowSpan={2} style={{ width: 64 }}>
                {t("tax.form53.colPayDate1")}
                <br />
                {t("tax.form53.colPayDate2")}
              </th>
              <th rowSpan={2} style={{ width: 130 }}>
                {t("tax.form53.colIncomeType1")}
                <br />
                {t("tax.form53.colPayDate2")}
              </th>
              <th rowSpan={2} style={{ width: 50 }}>
                {t("tax.form53.colRate1")}
                <br />
                {t("tax.form53.colRate2")}
              </th>
              <th rowSpan={2} style={{ width: 90 }}>
                {t("tax.form53.colPaid1")}
                <br />
                {t("tax.form53.colPaid2")}
              </th>
              <th rowSpan={2} style={{ width: 90 }}>
                {t("tax.form53.colWht1")}
                <br />
                {t("tax.form53.colWht2")}
              </th>
              <th rowSpan={2} style={{ width: 48 }}>
                {t("tax.form53.colCond1")}
                <br />
                {t("tax.form53.colCond2")}
              </th>
            </tr>
            <tr>
              <th style={{ width: 100 }}>{t("vendor.thTaxId")}</th>
              <th style={{ width: 36 }}>{t("tax.form.branchUnit")}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: EMPTY_ROWS }).map((_, i) => (
              <tr key={`e-${i}`} style={{ height: 22 }}>
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#FAFAFA" }}>
              <td colSpan={7} style={{ textAlign: "right", fontWeight: 700 }}>
                {t("fin.aging.footTotal").replace("{count}", String(group.count))}
              </td>
              <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                {formatMoney2(group.base)}
              </td>
              <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                {formatMoney2(group.wht)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div style={{ fontSize: 10.5, marginTop: 6, fontStyle: "italic", color: "#444" }}>{t("tax.form53.carryNote").replace("{kind}", form)}</div>

        <div style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>
          <b>{t("tax.form53.noteLabel")}</b> {t("tax.form53.noteCond")} &nbsp; <b>(1)</b> {t("tax.form53.cond1")} &nbsp;&nbsp; <b>(2)</b> {t("tax.form53.cond2")}
        </div>

        {/* Signature + summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
          <div className="box" style={{ minHeight: 110, fontSize: 11 }}>
            <div>{t("tax.form53.certify")}</div>
            <div style={{ marginTop: 30, textAlign: "center", borderTop: "1px dotted #000", paddingTop: 4 }}>
              {t("tax.form.signPayer")}
              <br />
              {t("tax.form.signParen")}
              <br />
              {t("tax.form.position")}
              <br />
              {t("tax.form.fileDate")}
            </div>
          </div>
          <div className="box" style={{ minHeight: 110, fontSize: 11, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("tax.form53.summaryTitle")}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{t("tax.form53.summaryCount")}</span>
                <b className="num">{group.count}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{t("tax.form53.summaryPaid")}</span>
                <b className="num">{t("tax.form53.amountBaht").replace("{amount}", formatMoney2(group.base))}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{t("tax.form53.summaryWht")}</span>
                <b className="num">{t("tax.form53.amountBaht").replace("{amount}", formatMoney2(group.wht))}</b>
              </div>
            </div>
            <div style={{ marginTop: 24, textAlign: "center", border: "1.2px dashed #000", padding: 6, fontSize: 10, color: "#444" }}>{t("tax.form53.sealCorp")}</div>
          </div>
        </div>

        <div style={{ fontSize: 9.5, color: "#555", marginTop: 10, textAlign: "right" }}>{t("tax.form53.footer").replace("{kind}", form)}</div>
      </div>
    </FormPage>
  );
}

/** Open the attachment listing PND{form} form in a fullbleed modal (tax-forms.jsx openPND53). */
function openPND53(ctx: ShellCtx, report: WhtReport, form: WhtForm): void {
  ctx.openModal({
    kind: "fullbleed",
    body: ({ close }: { close: () => void }) => <PND53Form report={report} form={form} onClose={close} />,
  });
}

/* ========================================================================== */

export function TaxWHT() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const whtQ = useWhtReport();
  const report: WhtReport = whtQ.data ? toWhtReport(whtQ.data) : EMPTY_WHT_REPORT;
  const periodLabel = report.period || t("common.all");

  const [tab, setTab] = useState<WhtTab>("all");

  const TABS: readonly { id: WhtTab; label: string; count?: number }[] = [
    { id: "all", label: t("common.all"), count: whtAllCount(report) },
    { id: "pnd3", label: t("tax.wht.tabPnd3"), count: report.pnd3.count },
    { id: "pnd53", label: t("tax.wht.kpiPnd53"), count: report.pnd53.count },
    // issued: no 50-bis issuance wire -> count omitted (honest, not fabricated).
    { id: "issued", label: t("tax.wht.tabIssued") },
  ];

  // PND3/PND53 group WHT shown as the KPI sub ("WHT (baht) {amount}") — the real per-group withholding.
  const whtSub = (g: WhtGroup): string => `${t("tax.wht.colWht")} ${formatMoney(g.wht)}`;

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("tax.breadcrumbTax"), t("tax.wht.breadcrumb")]}
      title={t("tax.wht.title")}
      subtitle={t("tax.wht.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <FilterChip label={t("subcon.colPeriod")} value={periodLabel} />
          <Btn kind="outline" size="md" icon="paperclip" onClick={() => openPND53(ctx, report, "53")}>
            {t("tax.wht.btnPrint53")}
          </Btn>
          <Btn kind="outline" size="md" icon="paperclip" onClick={() => openPND53(ctx, report, "3")}>
            {t("tax.wht.btnPrint3")}
          </Btn>
          {/* Submit is presentational (no e-filing endpoint) -> honest toast (prototype). */}
          <Btn kind="primary" size="md" icon="download" onClick={() => ctx.notify(t("tax.wht.toastSubmit"))}>
            {t("tax.wht.btnSubmit")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): 3 real group figures + 1 presentational due-date (em-dash value). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={t("tax.wht.kpiPnd3")} value={String(report.pnd3.count)} sub={whtSub(report.pnd3)} tone="var(--info)" icon="user" />
        <MiniKpi label={t("tax.wht.kpiPnd53")} value={String(report.pnd53.count)} sub={whtSub(report.pnd53)} tone="var(--brand)" icon="users" />
        <MiniKpi label={t("tax.wht.kpiTotal")} value={formatMoney(report.totalWht)} sub={t("tax.wht.kpiTotalSub")} tone="var(--accent)" icon="ledger" />
        <MiniKpi label={t("tax.wht.kpiDue")} value={DASH} tone="var(--warn)" icon="calendar" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              <th style={th(80)}>{t("tax.wht.colForm")}</th>
              <th style={th(130)}>{t("tax.wht.colPvNo")}</th>
              <th style={th(140)}>{t("vendor.thTaxId")}</th>
              <th style={th()}>{t("tax.wht.colPayee")}</th>
              <th style={th(130)}>{t("tax.wht.colIncomeType")}</th>
              <th style={th(110, true)}>{t("tax.wht.colAmount")}</th>
              <th style={th(70, true)}>{t("tax.wht.colRate")}</th>
              <th style={th(110, true)}>{t("tax.wht.colWht")}</th>
              <th style={th(110)}>{t("tax.wht.colCert")}</th>
            </tr>
          </thead>
          <tbody>
            {/* honest-empty: the report is aggregate only, so there is no per-payee row to show. */}
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                {DASH}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
