/*
 * ARInvoice — the AR Invoice / Billing screen, ported from pototype/ar.jsx ARInvoice
 * (L16-108) + ARInvoiceForm (L110-147). Route ar.invoice (docs/extract/NAV-ROUTES.md L74,
 * registry section "acct"). First Phase-3 AR screen; mirrors the SAME-MODULE finance
 * precedent gl/gl-inbox.tsx (list + KPI strip + TabBar + table, inlined th/td/MiniKpi/
 * TabBar/StatusBadge, generated client + unwrap) and po-wo/wo-list.tsx.
 *
 * Design fidelity (§0 rule 1): the three-part breadcrumb (finance section · AR module ·
 * invoice/billing screen), the title/subtitle, the two header actions (Sync REM /
 * create-invoice), the 4-card MiniKpi strip, the TabBar (all · open · due · overdue ·
 * paid), and the 7-column table (no · customer/unit · period · value · VAT · due ·
 * status) are the prototype's.
 *
 * Data (§0 rule 3): GET /ar/invoices (use-ar-invoice.ts) via the generated client — the
 * prototype's local AR_INV becomes the real server catalogue. The wire row is
 * { id, no, customer_id, project_id, amount, vat, currency_code, credit_term, due_date,
 *   status, etax_status, doc_date, created_at, outstanding } (apps/api/src/routes/ar.ts).
 * Pure narrowing / tab-filter / KPI / status / due-date logic lives in ar-invoice-rows.ts
 * (unit-tested, G3).
 *
 * REAL vs em-dash (honest, never fabricated) — see ar-invoice-rows.ts:
 *   - no        -> REAL invoice number (ar_invoice.no).
 *   - customer  -> REAL name resolved from customer_id via GET /customers; the prototype's
 *                  per-row `unit` (B-12) has NO wire column -> the sub-line em-dashes.
 *   - period    -> the prototype's phase (nguad) column has NO wire column -> em-dash.
 *   - value     -> REAL amount (server = Σ line qty × price).
 *   - VAT       -> REAL vat (7% server output tax); em-dash when 0.
 *   - due       -> REAL due_date ('YYYY-MM-DD', nullable -> em-dash); the days-remaining
 *                  sub-line is derived and shown only for OPEN invoices (a PAID invoice is
 *                  settled -> no overdue warning, matching the prototype's closed row).
 *   - status    -> REAL wire state open|paid. The prototype colour-coded its mock rows as
 *                  "approved" (a state the AR invoice does not have) -> we render open|paid
 *                  honestly (paid = the prototype's green paid tag; open = a green badge).
 *   KPIs (all REAL, derived from the wire): open count (+ overdue sub), due-7 count (+ Σ
 *   amount M), overdue count (+ Σ amount M), and total-AR = Σ outstanding over open rows
 *   (the true receivable; the prototype summed amount+vat, equal pre-receipt). The
 *   prototype's Sync REM header action is PRESENTATIONAL (no REM-sync wire) -> a toast only.
 *
 * Create (rule 8): the "create invoice" button opens ARInvoiceForm -> POST /ar/invoices.
 * MONEY AUTHORITY (B-107a · Wei C-176): the client sends ONLY the line items; the SERVER
 * computes amount + vat. See ar-invoice-form.tsx for the forced line-editor divergence.
 *
 * i18n (rule 2): every string resolves via t() from the DICT layer (i18n-full.json) — the
 * ar.invoice.* keys (i18n Wave-B, consume-only) plus reused existing keys
 * (fin.breadcrumbFinance, ar.fldCustomer, pm.tabOverdue, subcon.col*, common.*). Tokens
 * back every colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Avatar } from "../../ui/avatar";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toInvoiceRow,
  toCustomerRef,
  customerById,
  statusView,
  daysUntil,
  isOpen,
  isOverdue,
  filterByTab,
  tabCount,
  openInvoices,
  overdueInvoices,
  dueSoonInvoices,
  distinctCustomerCount,
  sumAmount,
  sumOutstanding,
  formatMoney,
  millionsValue,
  type InvoiceRow,
  type InvoiceTab,
} from "./ar-invoice-rows";
import { useArInvoiceList, useCustomerList } from "./use-ar-invoice";
import { ARInvoiceForm } from "./ar-invoice-form";

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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the optional unit span). */
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
  sub?: string;
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

/** TabBar, inlined from ds.jsx TabBar (functional, as in gl-inbox / wo-list). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: InvoiceTab; label: string; count: number }[];
  active: InvoiceTab;
  onChange: (id: InvoiceTab) => void;
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
          </button>
        );
      })}
    </div>
  );
}

/**
 * Open-invoice badge (ds.jsx StatusBadge size sm). Green ok tone with a dot — the
 * prototype's non-closed rows painted the status green; the honest label is "open".
 */
function OpenBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: "var(--ok-soft)",
        color: "var(--ok)",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      {/* ds.jsx STATUS.approved dot #16A34A (prototype-verbatim hex, B-037(a)). */}
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "#16A34A" }} />
      {label}
    </span>
  );
}

/** Paid tag — the prototype's custom green pill for a settled row (ar.jsx L99), no dot. */
function PaidTag({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: "var(--ok-soft)",
        color: "var(--ok)",
      }}
    >
      {label}
    </span>
  );
}

export function ARInvoice() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const invoiceQ = useArInvoiceList();
  const customerQ = useCustomerList();

  const [tab, setTab] = useState<InvoiceTab>("all");
  // Stable "now" per mount so the due-date arithmetic is consistent across renders.
  const nowMs = useMemo(() => Date.now(), []);

  const rows = useMemo<InvoiceRow[]>(() => (invoiceQ.data ?? []).map(toInvoiceRow), [invoiceQ.data]);
  const customerMap = useMemo(
    () => customerById((customerQ.data ?? []).map(toCustomerRef)),
    [customerQ.data],
  );

  const visible = useMemo(() => filterByTab(rows, tab, nowMs), [rows, tab, nowMs]);

  // KPI aggregates (all REAL — derived from the wire).
  const open = useMemo(() => openInvoices(rows), [rows]);
  const overdue = useMemo(() => overdueInvoices(rows, nowMs), [rows, nowMs]);
  const dueSoon = useMemo(() => dueSoonInvoices(rows, nowMs), [rows, nowMs]);

  const customerName = (id: string): string => customerMap.get(id)?.name ?? "";

  const openCreate = () => {
    ctx.openModal({
      title: t("ar.invoice.modalTitle"),
      subtitle: t("ar.invoice.modalSubtitle"),
      icon: "ledger",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <ARInvoiceForm onClose={close} />,
    });
  };

  const TABS: readonly { id: InvoiceTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: rows.length },
    { id: "open", label: t("ar.invoice.tabOpen"), count: tabCount(rows, "open", nowMs) },
    { id: "due", label: t("ar.invoice.tabDue"), count: tabCount(rows, "due", nowMs) },
    { id: "over", label: t("pm.tabOverdue"), count: tabCount(rows, "over", nowMs) },
    { id: "paid", label: t("ar.invoice.tabPaid"), count: tabCount(rows, "paid", nowMs) },
  ];

  const mBaht = t("subcon.unitMBaht");

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "AR", t("ar.invoice.breadcrumb")]}
      title={t("ar.invoice.title")}
      subtitle={t("ar.invoice.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Sync REM: no REM-sync wire -> presentational toast only. */}
          <Btn kind="outline" size="md" icon="sync" onClick={() => ctx.notify(t("ar.invoice.toastSyncRem"))}>
            {t("ar.invoice.btnSyncRem")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("ar.invoice.btnNew")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — all real, derived from the invoice list. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("ar.invoice.kpiOpen")}
          value={String(open.length)}
          sub={t("ar.invoice.kpiOpenSub").replace("{count}", String(overdue.length))}
          tone="var(--brand)"
          icon="ledger"
        />
        <MiniKpi
          label={t("ar.invoice.kpiDue7")}
          value={String(dueSoon.length)}
          sub={`${millionsValue(sumAmount(dueSoon))} ${mBaht}`}
          tone="var(--accent)"
          icon="clock"
        />
        <MiniKpi
          label={t("pm.tabOverdue")}
          value={String(overdue.length)}
          sub={`${millionsValue(sumAmount(overdue))} ${mBaht}`}
          tone="var(--danger)"
          icon="warn"
        />
        <MiniKpi
          label={t("ar.invoice.kpiTotalAr")}
          value={millionsValue(sumOutstanding(open))}
          unit={mBaht}
          sub={t("ar.invoice.kpiTotalArSub")
            .replace("{customerCount}", String(distinctCustomerCount(rows)))
            .replace("{invoiceCount}", String(rows.length))}
          tone="var(--info)"
          icon="users"
        />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {invoiceQ.isLoading ? (
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
                <th style={th(140)}>{t("subcon.colNo")}</th>
                <th style={th()}>{t("ar.invoice.thCustomerUnit")}</th>
                <th style={th(150)}>{t("subcon.colPeriod")}</th>
                <th style={th(130, true)}>{t("subcon.colValueBaht")}</th>
                <th style={th(90, true)}>{t("ar.invoice.thVat")}</th>
                <th style={th(120)}>{t("ar.invoice.thDue")}</th>
                <th style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  {/* No dedicated empty-state i18n key exists (no minting) -> honest em-dash. */}
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const days = daysUntil(r.dueDate, nowMs);
                  const showDays = isOpen(r) && days != null && days !== 0;
                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: "1px solid var(--border)",
                        background: isOverdue(r, nowMs) ? "var(--danger-soft)" : "transparent",
                      }}
                    >
                      {/* no — real invoice number */}
                      <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                        {r.no}
                      </td>
                      {/* customer — real name from GET /customers; unit sub-line has no wire -> em-dash */}
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Avatar name={customerName(r.customerId) || "?"} size={22} color="#0F766E" />
                          <div>
                            <div style={{ fontWeight: 500 }}>{customerName(r.customerId) || DASH}</div>
                            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{DASH}</div>
                          </div>
                        </div>
                      </td>
                      {/* period — no wire column -> em-dash */}
                      <td style={td}>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</div>
                      </td>
                      {/* value — real amount */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(r.amount)}
                      </td>
                      {/* VAT — real; em-dash when 0 */}
                      <td
                        style={{ ...td, textAlign: "right", color: r.vat ? "var(--text-2)" : "var(--text-3)" }}
                        className="num"
                      >
                        {r.vat ? formatMoney(r.vat) : DASH}
                      </td>
                      {/* due — real date (em-dash when null); days sub-line only for OPEN rows */}
                      <td style={td}>
                        <div style={{ fontSize: 11.5 }} className="num">{r.dueDate || DASH}</div>
                        {showDays && (
                          <div
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: days! < 0 ? "var(--danger)" : days! < 7 ? "var(--warn)" : "var(--text-3)",
                            }}
                          >
                            {days! < 0
                              ? t("ar.invoice.daysOver").replace("{days}", String(-days!))
                              : t("ar.invoice.daysLeft").replace("{days}", String(days!))}
                          </div>
                        )}
                      </td>
                      {/* status — real open|paid */}
                      <td style={td}>
                        {statusView(r.status) === "paid" ? (
                          <PaidTag label={t("ar.invoice.tabPaid")} />
                        ) : (
                          <OpenBadge label={t("ar.invoice.tabOpen")} />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
