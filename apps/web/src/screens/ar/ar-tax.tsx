/*
 * ARTaxInvoice — the AR Tax Invoice / Receipt screen, ported from pototype/ar.jsx ARTaxInvoice
 * (L153-224). Route ar.tax (docs/extract/NAV-ROUTES.md L75, component ARTaxInvoice, section
 * "acct"). Mirrors gl-inbox.tsx (t() DICT keys, inlined th/td/MiniKpi/TabBar/StatusBadge,
 * generated client + unwrap) and the AP peer ap-billing.tsx (KPI unit prop, presentational
 * TabBar, StatusBadge tone helper).
 *
 * Design fidelity (Juneflow §0 rule 1): the three-part breadcrumb (finance section, AR module,
 * tax-invoice screen), the title/subtitle, the Export PP30 + issue-new header actions, the
 * 4-card MiniKpi strip, the TabBar (all · tax · receipt · cancel), and the 8-column table
 * (type · no · date · customer/item · value · VAT 7% · net · status) are the prototype's.
 *
 * Data (rule 3): GET /ar/tax-register (use-ar-tax.ts) via the generated client — the prototype's
 * local TX/RC/CX literal (ar.jsx L195-200) becomes the real DERIVED server register (Wei B-121
 * Q6: one row per ar_invoice = one tax invoice, no new table). The wire row is
 * { id, no, customer_id, amount, vat, total, etax_status, status, doc_date } (ar.ts
 * taxRegisterWire); pure narrowing / KPI sums / kind + status derive / money format live in
 * ar-tax-rows.ts (unit-tested, G3).
 *
 * REAL vs em-dash (honest, never fabricated) — see ar-tax-rows.ts:
 *   - type    -> DERIVED kind: etax_status 'void' -> cancel; else tax. RECEIPT is not a wire
 *                signal (the derive is "one row = one tax invoice") -> the receipt tab is an
 *                honest-empty 0, never fabricated (the gl-inbox scheduled/error precedent).
 *   - no      -> REAL wire `no` (ar_invoice.no NOT NULL).
 *   - date    -> REAL doc_date (invoice createdAt, formatted YYYY-MM-DD UTC).
 *   - customer/item -> the derive carries only an opaque customer_id (NO name / NO line item)
 *                -> em-dash (the same honest treatment as gl-inbox's creator column).
 *   - value / VAT / net -> REAL amount / vat / total; the prototype's value-driven predicate
 *                (`> 0 ? show : em-dash`) is preserved verbatim.
 *   - status  -> void -> cancelled badge; else approved badge (issued).
 *   KPIs: issued count + Σ total, Σ VAT (voided excluded), cancelled count are REAL derivations
 *   over the loaded rows; the "ready to submit to RD" KPI has NO wire signal (no e-filing
 *   readiness endpoint) -> value em-dash + the mock RD-filing deadline caption is dropped
 *   (the honest Sync-SAP precedent; never a fabricated all-clear).
 *
 * Actions:
 *   - Export PP30 is PRESENTATIONAL (the prototype fires a toast; no export endpoint is wired
 *     — the /tax/reports/vat report is out of this screen's scope) -> ctx.notify(toastExport).
 *   - Issue-new (btnNew): the prototype opens the shared ARInvoiceForm (openInvoiceForm ->
 *     POST /ar/invoices). That create form is OUT OF THIS LIST-PORT'S SCOPE (no form file), so
 *     the button is rendered for visual fidelity (enabled, no disabled dimming so the visual
 *     gate matches) but its create flow is deferred — no onClick here. Flagged in the report.
 *   - The tax-register CANCEL op (POST /ar/tax-register/{id}/cancel) EXISTS and is wired+typed
 *     in use-ar-tax.ts (useCancelTaxRegister) but is NOT surfaced: the prototype list has no
 *     per-row cancel affordance (design fidelity, the ap.pv/useApprovePv precedent).
 *
 * i18n (rule 2): every string resolves via t() from the DICT (i18n-full.json) — the
 * ar.taxInvoice.* keys (Wave-B) plus reused existing keys for shared values (fin.breadcrumbFinance,
 * subcon.colType/colNo/colDate/colValue, subcon.unitMBaht, common.all/cancel/status,
 * fin.statusApproved). CONSUME-ONLY: no key minted. Tokens back every colour (rule 6); the
 * StatusBadge dot hexes are ds.jsx STATUS-verbatim (B-037(a)). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toTaxRow,
  kindTag,
  statusTone,
  tabCount,
  issuedCount,
  issuedTotal,
  vatTotal,
  cancelledCount,
  formatMoney,
  formatDec,
  formatMillions,
  formatDate,
  type TaxRow,
  type TaxKind,
  type TaxTab,
  type TaxDisplayStatus,
} from "./ar-tax-rows";
import { useArTaxRegister } from "./use-ar-tax";

const DASH = "—";

/** Table header cell style (ds.jsx th()). */
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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the unit slot, same as ap-billing). */
function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
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
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/**
 * TabBar (ds.jsx TabBar). PRESENTATIONAL: `active` is fixed to "all" and the tabs do not
 * partition the list (the prototype's own onChange is a no-op, ar.jsx L179), but every tab
 * carries its real count. Kept for structural fidelity with the reference.
 */
function TabBar({ tabs }: { tabs: readonly { id: string; label: string; count: number }[] }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = tab.id === "all";
        return (
          <div
            key={tab.id}
            style={{
              padding: "15px 14px",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {tab.label}
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
          </div>
        );
      })}
    </div>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened/verbatim bg-fg + verbatim dot. */
function StatusBadge({ status, label }: { status: TaxDisplayStatus; label: string }) {
  const s = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

export function ARTaxInvoice() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const registerQ = useArTaxRegister();
  const rows = useMemo<TaxRow[]>(() => (registerQ.data ?? []).map(toTaxRow), [registerQ.data]);

  const kpiIssuedCount = useMemo(() => issuedCount(rows), [rows]);
  const kpiIssuedTotal = useMemo(() => issuedTotal(rows), [rows]);
  const kpiVatTotal = useMemo(() => vatTotal(rows), [rows]);
  const kpiCancelled = useMemo(() => cancelledCount(rows), [rows]);

  /** Type-badge label (the DICT copy for each derived kind; tone comes from kindTag). */
  const kindLabel = (kind: TaxKind): string =>
    kind === "tax"
      ? t("ar.taxInvoice.badgeTax")
      : kind === "receipt"
        ? t("ar.taxInvoice.tabReceipt")
        : t("common.cancel");

  /** Status-badge label — cancelled reuses common.cancel; approved reuses fin.statusApproved. */
  const statusLabel = (status: TaxDisplayStatus): string =>
    status === "cancelled" ? t("common.cancel") : t("fin.statusApproved");

  const TABS: readonly { id: TaxTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: rows.length },
    { id: "tax", label: t("ar.taxInvoice.tabTax"), count: tabCount(rows, "tax") },
    { id: "receipt", label: t("ar.taxInvoice.tabReceipt"), count: tabCount(rows, "receipt") },
    { id: "cancel", label: t("common.cancel"), count: tabCount(rows, "cancel") },
  ];

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "AR", t("ar.taxInvoice.breadcrumb")]}
      title={t("ar.taxInvoice.title")}
      subtitle={t("ar.taxInvoice.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Export PP30: presentational (no export endpoint wired) -> the prototype's toast. */}
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("ar.taxInvoice.toastExport"))}>
            {t("ar.taxInvoice.btnExportPp30")}
          </Btn>
          {/* Issue new: the create-invoice flow (openInvoiceForm -> POST /ar/invoices) is out of
              this list-port's scope; rendered for visual fidelity, create flow deferred. */}
          <Btn kind="primary" size="md" icon="plus">
            {t("ar.taxInvoice.btnNew")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): issued count + Σ total, Σ VAT, cancelled count are REAL derivations;
          the "ready to submit to RD" KPI has no wire -> value em-dash (Sync-SAP precedent). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("ar.taxInvoice.kpiIssued")}
          value={String(kpiIssuedCount)}
          sub={`${formatMillions(kpiIssuedTotal)} ${t("subcon.unitMBaht")}`}
          tone="var(--brand)"
          icon="paperclip"
        />
        <MiniKpi
          label={t("ar.taxInvoice.kpiVat")}
          value={formatMillions(kpiVatTotal)}
          unit={t("subcon.unitMBaht")}
          sub={t("ar.taxInvoice.kpiVatSub")}
          tone="var(--info)"
          icon="ledger"
        />
        <MiniKpi
          label={t("ar.taxInvoice.kpiCancelled")}
          value={String(kpiCancelled)}
          sub={t("ar.taxInvoice.kpiCancelledSub")}
          tone="var(--warn)"
          icon="x"
        />
        {/* Ready to submit to RD: no e-filing readiness endpoint -> value em-dash, mock deadline dropped. */}
        <MiniKpi label={t("ar.taxInvoice.kpiReady")} value={DASH} tone="var(--ok)" icon="check" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} />

        {registerQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th(80)}>{t("subcon.colType")}</th>
                <th style={th(150)}>{t("subcon.colNo")}</th>
                <th style={th(110)}>{t("subcon.colDate")}</th>
                <th style={th()}>{t("ar.taxInvoice.thCustomerItem")}</th>
                <th style={th(120, true)}>{t("subcon.colValue")}</th>
                <th style={th(90, true)}>{t("ar.taxInvoice.thVat7")}</th>
                <th style={th(120, true)}>{t("ar.taxInvoice.thNet")}</th>
                <th style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = kindTag(r.kind);
                const date = formatDate(r.docDate);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: tag.bg,
                          color: tag.fg,
                        }}
                      >
                        {kindLabel(r.kind)}
                      </span>
                    </td>
                    {/* no: REAL wire value (ar_invoice.no NOT NULL). */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    {/* date: REAL doc_date (invoice createdAt, UTC), em-dash on missing/invalid. */}
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                      {date || DASH}
                    </td>
                    {/* customer/item: the derive carries only an opaque customer_id -> em-dash. */}
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                    {/* value: REAL amount; value-driven predicate (> 0 ? show : em-dash). */}
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {r.amount > 0 ? formatDec(r.amount) : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                    </td>
                    {/* VAT 7%: REAL vat; em-dash on 0 (a deposit / voided row). */}
                    <td style={{ ...td, textAlign: "right", color: "var(--info)", fontWeight: 600 }} className="num">
                      {r.vat > 0 ? formatDec(r.vat) : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                    </td>
                    {/* net: REAL total; em-dash on 0. */}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {r.total > 0 ? formatMoney(r.total) : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.displayStatus} label={statusLabel(r.displayStatus)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
