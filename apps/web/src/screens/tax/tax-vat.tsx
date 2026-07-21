/*
 * TaxVAT — the PP30 VAT report screen, ported from pototype/tax.jsx TaxVAT (L3-110) + the PP30
 * form from tax-forms.jsx PND30Form/FormPage/TaxIdBoxes/AddrCell. Route tax.vat (NAV L82). Mirrors
 * the just-merged gl-inbox.tsx (t() DICT keys, honest em-dash, generated client + unwrap, inlined
 * th/td/Kpi). CONSUME-ONLY i18n (Wave-B tax.* keys); ZERO Thai/baht in this .tsx (B-073) — every
 * glyph lives only in i18n-full.json.
 *
 * Data (rule 3): GET /tax/reports/vat (use-tax.ts) via the generated client — the prototype's mock
 * output/input invoice arrays become the real server report. The wire is AGGREGATE only
 * { output_vat, output_base, input_vat, input_base, net_vat, period, currency_code } (apps/api/src/
 * routes/tax.ts vatReport); the pure narrowing/box-mapping/format logic lives in tax-rows.ts (G3).
 *
 * REAL vs em-dash (honest, never fabricated) — B-124:
 *   - KPIs (VAT sales / VAT purchases / VAT net payable) -> REAL Σ figures from the wire.
 *   - Status KPI -> presentational (there is NO filing-workflow wire) -> value em-dash + static
 *     descriptor sub (the same honest treatment gl-inbox gives its non-wire KPIs). The
 *     tax.vat.statusReady label is intentionally NOT shown (no filing-status wire to justify it).
 *   - Output/input summary cards -> the section title + REAL base + REAL signed VAT total. The
 *     per-invoice DETAIL TABLE has NO wire (the report is aggregate only) -> it renders honest-empty
 *     (an em-dash body); the prototype's mock invoice rows + per-invoice count captions are dropped.
 *   - Net-payable card -> the REAL net_vat figure; the prototype's mock due-date is dropped (no wire).
 *   - Period chip -> the wire's report.period (or common.all when the report spans all periods); the
 *     screen has no wire-backed period picker, so the chip is presentational (drop-not-collect).
 *
 * PP30 form (B-124, client-render): the Print/Submit actions open the RD PP30 layout in a
 * fullbleed modal. Its 16 numbered boxes (v1-v16) are populated from the REAL report figures
 * (tax-rows.ts vatBoxes); boxes with no wire (v2/v3 zero-rated/exempt, v10 carried credit, v13/v14
 * surcharge/penalty) are HONEST-ZERO and the row() helper renders a zero box as an em-dash. The
 * payer identity block (company name / tax id / address / branch) has NO wire -> it renders blank/
 * em-dash (a printable form to be completed), never fabricated. Submit is presentational (there is
 * NO e-filing endpoint) -> it opens the same preview, matching the prototype (openPND30). Export
 * Excel is a presentational toast (no export endpoint · flag).
 */
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx, type ShellCtx } from "../../shell/shell-context";
import {
  toVatReport,
  vatBoxes,
  formatMoney,
  formatMoney2,
  EMPTY_VAT_REPORT,
  type VatReport,
  type VatBoxes,
} from "./tax-rows";
import { useVatReport } from "./use-tax";

const DASH = "—";

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

/** The 12 PP30 month keys (literal, so the typed t() accepts the index lookup). */
const MONTH_KEYS = [
  "tax.form.month1",
  "tax.form.month2",
  "tax.form.month3",
  "tax.form.month4",
  "tax.form.month5",
  "tax.form.month6",
  "tax.form.month7",
  "tax.form.month8",
  "tax.form.month9",
  "tax.form.month10",
  "tax.form.month11",
  "tax.form.month12",
] as const;

/** KPI card, inlined from dashboard.jsx Kpi (label + value + optional sub + accent). */
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
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

/** One output/input VAT summary card: colored header (title + real base + real VAT total) over an
 *  honest-empty per-invoice table (no per-invoice wire -> em-dash body). */
function VatSummaryCard({
  title,
  bg,
  fg,
  base,
  vat,
  sign,
  columns,
  baseLabel,
}: {
  title: string;
  bg: string;
  fg: string;
  base: number;
  vat: number;
  sign: "+" | "-";
  columns: readonly string[];
  baseLabel: string;
}) {
  return (
    <Card pad={0}>
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: fg }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
            {baseLabel} <span className="num">{formatMoney(base)}</span>
          </div>
        </div>
        <span className="num" style={{ fontSize: 18, fontWeight: 800, color: fg }}>
          {sign}
          {formatMoney(vat)}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
            {columns.map((c, i) => (
              <th key={i} style={th(undefined, i >= 2)}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* honest-empty: the report is aggregate only, so there is no per-invoice row to show. */}
          <tr style={{ borderTop: "1px solid var(--border)" }}>
            <td colSpan={columns.length} style={{ padding: 24, textAlign: "center", color: "var(--text-3)" }}>
              {DASH}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

/* ========================================================================== */
/* PP30 RD form (client-render, fullbleed modal)                            */
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

/** A4 white-paper print modal with a dark toolbar (tax-forms.jsx FormPage). Owns its own backdrop
 *  (opened as a fullbleed modal). */
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

/** Row of monospace boxes for a tax id / branch code (tax-forms.jsx TaxIdBoxes). Renders blank cells
 *  when there is no value (honest — the payer identity has no wire). */
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

/** A dotted-underline address cell (tax-forms.jsx AddrCell); em-dashes an empty value. */
function AddrCell({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ borderBottom: "1px dotted #000", paddingBottom: 2, minHeight: 22 }}>
      <span style={{ fontSize: 9, color: "#444" }}>{l}</span>
      <div style={{ fontSize: 10.5 }}>{v || DASH}</div>
    </div>
  );
}

/** Parse an "YYYY-MM" report period into a month index (0-11) + Buddhist-era year; blank when absent. */
function parsePeriod(period: string): { monthIdx: number | null; beYear: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return { monthIdx: null, beYear: "" };
  const monthIdx = Number(m[2]) - 1;
  return {
    monthIdx: monthIdx >= 0 && monthIdx < 12 ? monthIdx : null,
    beYear: String(Number(m[1]) + 543),
  };
}

/** The PP30 form body (tax-forms.jsx PND30Form). v1-v16 REAL from the wire (honest-zero boxes);
 *  the payer identity block is blank/em-dash (no wire). */
function PND30Form({ report, onClose }: { report: VatReport; onClose: () => void }) {
  const { t } = useI18n();
  const b: VatBoxes = vatBoxes(report);
  const { monthIdx, beYear } = parsePeriod(report.period);

  // The prototype's row(no,label,val,{strong,tint,showZero}); a zero box renders an em-dash unless
  // showZero, which is the honest-zero surface (B-124).
  const row = (no: number, label: string, val: number, opts: { strong?: boolean; tint?: string; showZero?: boolean } = {}): ReactNode => (
    <tr key={no} style={opts.strong ? { background: opts.tint || "#F5F8FB", fontWeight: 700 } : {}}>
      <td style={{ width: 30, textAlign: "center" }}>{no}.</td>
      <td>{label}</td>
      <td className="num" style={{ width: 150, textAlign: "right", fontWeight: opts.strong ? 700 : 400 }}>
        {val === 0 && !opts.showZero ? DASH : formatMoney2(val)}
      </td>
    </tr>
  );

  return (
    <FormPage title={t("tax.form30.modalTitle")} onClose={onClose}>
      <div className="tax-form">
        {/* Top header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ width: 80, height: 80, border: "1px solid #000", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 9 }}>
            <div>
              {t("tax.form.garuda")}
              <br />
              <span style={{ fontSize: 7, color: "#444" }}>{t("tax.form.rd")}</span>
            </div>
          </div>
          <div style={{ flex: 1, textAlign: "center", paddingTop: 4 }}>
            <h2>{t("tax.form30.formNo")}</h2>
            <div className="sub" style={{ marginTop: 2 }}>
              {t("tax.form30.formName")}
            </div>
            <div className="sub">{t("tax.form30.formLaw")}</div>
          </div>
          <div style={{ width: 130, fontSize: 10, border: "1px solid #000", padding: 6 }}>
            <div style={{ fontWeight: 700 }}>{t("tax.form30.receiptNo")}</div>
            <div style={{ height: 14 }} />
            <div style={{ fontWeight: 700, marginTop: 4 }}>{t("subcon.colDate")}</div>
            <div style={{ height: 14 }} />
          </div>
        </div>

        {/* Filing type */}
        <div style={{ display: "flex", gap: 18, fontSize: 11, marginBottom: 6 }}>
          <span>
            <span className="ck" />
            {t("tax.form30.filing1")}
          </span>
          <span>
            <span className="ck" />
            {t("tax.form30.filing2")}
          </span>
        </div>

        {/* Taxpayer header */}
        <div className="box" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            <b>{t("tax.form30.operatorName")}</b> &nbsp; <span className="field-line" style={{ minWidth: 540 }}>{DASH}</span>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 11 }}>
              <b>{t("tax.form.taxIdLabel")}</b> &nbsp; <TaxIdBoxes value="" />
            </div>
            <div style={{ fontSize: 11 }}>
              <b>{t("tax.form.branchNoLabel")}</b> &nbsp; <TaxIdBoxes value="" len={5} />
            </div>
          </div>

          <div style={{ fontSize: 10.5, marginBottom: 4 }}>
            <b>{t("tax.form30.address")}</b>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 1fr", gap: 4, fontSize: 10.5, marginBottom: 4 }}>
            <AddrCell l={t("fa.catBuilding")} v="" />
            <AddrCell l={t("tax.form30.addrRoom")} v="" />
            <AddrCell l={t("tax.form30.addrFloor")} v="" />
            <AddrCell l={t("tax.form30.addrVillage")} v="" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "0.7fr 0.5fr 0.8fr 0.8fr 1.2fr", gap: 4, fontSize: 10.5, marginBottom: 4 }}>
            <AddrCell l={t("subcon.colNo")} v="" />
            <AddrCell l={t("tax.form30.addrMoo")} v="" />
            <AddrCell l={t("tax.form30.addrSoi")} v="" />
            <AddrCell l={t("tax.form30.addrJunction")} v="" />
            <AddrCell l={t("tax.form30.addrRoad")} v="" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.7fr 0.9fr", gap: 4, fontSize: 10.5 }}>
            <AddrCell l={t("tax.form30.addrTambon")} v="" />
            <AddrCell l={t("tax.form30.addrAmphoe")} v="" />
            <AddrCell l={t("tax.form30.addrProvince")} v="" />
            <AddrCell l={t("tax.form30.addrZip")} v="" />
            <AddrCell l={t("tax.form30.addrTel")} v="" />
          </div>
        </div>

        {/* Month checkboxes + year (from the wire period, blank when the report spans all periods) */}
        <div className="box" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            {t("tax.form30.taxMonth")}
            <span className="field-line" style={{ minWidth: 50, marginLeft: 8 }}>{beYear || DASH}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, fontSize: 10.5 }}>
            {MONTH_KEYS.map((mk, i) => (
              <span key={i}>
                <span className={`ck ${i === monthIdx ? "on" : ""}`} />
                {t(mk)}
              </span>
            ))}
          </div>
        </div>

        {/* Branch case (no wire -> unchecked) */}
        <div className="box" style={{ marginBottom: 6, fontSize: 11 }}>
          <b>{t("tax.form30.branchCase")}</b> &nbsp;
          <span>
            <span className="ck" />
            {t("tax.form30.branchJoint")}
          </span>{" "}
          &nbsp;
          <span>
            <span className="ck" />
            {t("tax.form30.branchSeparate")}
          </span>
          &nbsp;&nbsp;<b>{t("tax.form30.branchCount")}</b> <span className="field-line" style={{ minWidth: 40 }}>{DASH}</span> {t("tax.form.branchUnit")}
        </div>

        {/* 16-row VAT calculation table */}
        <div style={{ display: "flex", marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 28, flexShrink: 0 }}>
            <div className="v-label" style={{ flex: 2 }}>
              {t("tax.form30.sectionOutput")}
            </div>
            <div className="v-label" style={{ flex: 2 }}>
              {t("tax.form30.sectionInput")}
            </div>
            <div className="v-label" style={{ flex: 3 }}>
              {t("tax.form30.sectionVat")}
            </div>
            <div className="v-label" style={{ flex: 3 }}>
              {t("tax.form30.sectionNet")}
            </div>
          </div>
          <table style={{ flex: 1 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>{t("tax.form30.colNo")}</th>
                <th />
                <th style={{ width: 150 }}>{t("tax.form30.colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {row(1, t("tax.form30.line1"), b.v1)}
              {row(2, t("tax.form30.line2"), b.v2)}
              {row(3, t("tax.form30.line3"), b.v3)}
              {row(4, t("tax.form30.line4"), b.v4, { strong: true })}
              {row(5, t("tax.form30.line5"), b.v5, { strong: true, tint: "#E8F4F0" })}
              {row(6, t("tax.form30.line6"), b.v6)}
              {row(7, t("tax.form30.line7"), b.v7, { strong: true, tint: "#E8F4F0" })}
              {row(8, t("tax.form30.line8"), b.v8, { strong: b.v8 > 0 })}
              {row(9, t("tax.form30.line9"), b.v9, { strong: b.v9 > 0 })}
              {row(10, t("tax.form30.line10"), b.v10)}
              {row(11, t("tax.form30.line11"), b.v11, { strong: b.v11 > 0 })}
              {row(12, t("tax.form30.line12"), b.v12, { strong: b.v12 > 0 })}
              {row(13, t("tax.form30.line13"), b.v13)}
              {row(14, t("tax.form30.line14"), b.v14)}
              {row(15, t("tax.form30.line15"), b.v15, { strong: true, tint: "#E8EEF6" })}
              {row(16, t("tax.form30.line16"), b.v16, { strong: b.v16 > 0, tint: "#E8EEF6" })}
            </tbody>
          </table>
        </div>

        {/* Refund block (no wire -> unchecked) */}
        <div className="box" style={{ marginBottom: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("tax.form30.refundTitle")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>
              <span className="ck" />
              {t("tax.form30.refundCarry")}
            </span>
            <span>
              <span className="ck" />
              {t("tax.form30.refundCash")}
            </span>
            <span>
              <span className="ck" />
              {t("tax.form30.refundPromptpay")} &nbsp; <TaxIdBoxes value="" />
            </span>
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dotted #000", textAlign: "right" }}>{t("tax.form30.refundSign")}</div>
        </div>

        {/* Signature */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div className="box" style={{ minHeight: 110, fontSize: 11 }}>
            <div style={{ marginBottom: 24 }}>{t("tax.form30.warning")}</div>
            <div style={{ textAlign: "center", borderTop: "1px dotted #000", paddingTop: 4 }}>
              {t("tax.form30.signLine")}
              <br />
              {t("tax.form.signParen")}
              <br />
              {t("tax.form30.positionSeal")}
              <br />
              {t("tax.form.fileDate")}
            </div>
          </div>
          <div className="box" style={{ minHeight: 110, fontSize: 11 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("tax.form30.officialUse")}</div>
            <div style={{ marginBottom: 6 }}>{t("tax.form30.officialNo")}</div>
            <div style={{ marginTop: 24, textAlign: "center", borderTop: "1px dotted #000", paddingTop: 4 }}>
              {t("tax.form30.officialSign")}
              <br />
              {t("tax.form.signParen")}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 9.5, color: "#555", marginTop: 8, textAlign: "right" }}>{t("tax.form30.footer")}</div>
      </div>
    </FormPage>
  );
}

/** Open the PP30 form in a fullbleed modal (tax-forms.jsx openPND30 -> FormPage owns its backdrop). */
function openPND30(ctx: ShellCtx, report: VatReport): void {
  ctx.openModal({
    kind: "fullbleed",
    body: ({ close }: { close: () => void }) => <PND30Form report={report} onClose={close} />,
  });
}

/* ========================================================================== */

export function TaxVAT() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const vatQ = useVatReport();
  const report: VatReport = vatQ.data ? toVatReport(vatQ.data) : EMPTY_VAT_REPORT;
  const periodLabel = report.period || t("common.all");

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("tax.breadcrumbTax"), t("tax.vat.breadcrumb")]}
      title={t("tax.vat.title")}
      subtitle={t("tax.vat.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <FilterChip label={t("subcon.colPeriod")} value={periodLabel} />
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("gl.trial.exportToast"))}>
            {t("subcon.exportExcelBtn")}
          </Btn>
          <Btn kind="outline" size="md" icon="print" onClick={() => openPND30(ctx, report)}>
            {t("tax.vat.btnPrintForm")}
          </Btn>
          {/* Submit is presentational (no e-filing endpoint) -> opens the same PP30 preview (prototype). */}
          <Btn kind="primary" size="md" icon="paperclip" onClick={() => openPND30(ctx, report)}>
            {t("tax.vat.btnSubmit")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): 3 real Σ figures + 1 presentational status (em-dash value, static sub). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi label={t("tax.vat.kpiOutput")} value={formatMoney(report.outputVat)} accent="var(--ok)" />
        <Kpi label={t("tax.vat.kpiInput")} value={formatMoney(report.inputVat)} accent="var(--info)" />
        <Kpi label={t("tax.vat.kpiNet")} value={formatMoney(report.netVat)} sub={t("tax.vat.kpiNetSub")} accent="var(--danger)" />
        <Kpi label={t("common.status")} value={DASH} sub={t("tax.vat.kpiStatusSub")} accent="var(--brand)" />
      </div>

      {/* Output/input summary cards: real base + real VAT total; per-invoice tables honest-empty. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <VatSummaryCard
          title={t("tax.vat.outputHeader")}
          bg="var(--ok-soft)"
          fg="var(--ok)"
          base={report.outputBase}
          vat={report.outputVat}
          sign="+"
          baseLabel={t("tax.vat.colTaxBase")}
          columns={[t("subcon.colNo"), t("ar.fldCustomer"), t("tax.vat.colTaxBase"), t("ar.invoice.thVat")]}
        />
        <VatSummaryCard
          title={t("tax.vat.inputHeader")}
          bg="var(--info-soft)"
          fg="var(--info)"
          base={report.inputBase}
          vat={report.inputVat}
          sign="-"
          baseLabel={t("tax.vat.colTaxBase")}
          columns={[t("tax.vat.colInvoiceNo"), t("tax.vat.colVendor"), t("tax.vat.colTaxBase"), t("ar.invoice.thVat")]}
        />
      </div>

      {/* Net-payable card: the real net_vat figure (the prototype's mock due-date is dropped). */}
      <Card pad={20} style={{ marginTop: 16, background: "var(--danger-soft)", border: "1px solid var(--danger)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--danger)" }}>{t("tax.vat.kpiNet")}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>{t("tax.vat.kpiNetSub")}</div>
          </div>
          <span className="num" style={{ fontSize: 28, fontWeight: 800, color: "var(--danger)" }}>
            {formatMoney(report.netVat)}
          </span>
        </div>
      </Card>
    </Page>
  );
}
