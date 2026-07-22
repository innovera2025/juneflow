/*
 * TaxETax — the e-Tax Invoice & e-Receipt register (route tax.etax), ported from
 * pototype/etax.jsx TaxETax (L18-128). Mirrors the SAME-PATTERN precedent gl-inbox.tsx (dict t()
 * keys, generated client + unwrap, inlined ds.jsx primitives, honest em-dash / drop-not-collect).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the three-part breadcrumb (finance section, Tax
 * module, e-Tax Invoice screen), the title/subtitle, the Export + Send-batch header actions, the
 * 4-card KPI strip, the register table (invoice-no / customer+taxId / description / value / VAT /
 * date / e-Tax status / action), the row-click detail modal, and the footer note are the
 * prototype's structure.
 *
 * Data (rule 3): GET /etax/status (honest per-status aggregate) + GET /ar/invoices (the register
 * rows) + GET /customers (customer name + tax id) via the generated client — the prototype's
 * local ETAX_SEED becomes the real server catalogue. Pure narrowing/derive/format logic lives in
 * tax-etax-rows.ts (unit-tested, G3).
 *
 * REAL vs HONEST-EMPTY (Wei B-124 — the crux of this port). The prototype renders a rich e-Tax
 * compliance THEATER that has NO real source; every fabricated artefact is em-dashed / omitted:
 *   REAL:
 *     - etax_status (queued|sent|rejected|void) -> the status badge + the KPI counts (GET
 *       /etax/status). queued<-"pending", sent<-"sent", rejected<-"error", void<-"void".
 *     - invoice no / amount (net) / vat (7% output) / total (= amount + vat) / created_at (UTC).
 *     - customer name + tax id (GET /customers, both REAL columns — joined rather than em-dashed).
 *     - Send action -> POST /etax/send flips queued/rejected -> sent (FakeTaxEngine); the real
 *       resulting status surfaces via query invalidation (the honest feedback).
 *   HONEST-EMPTY (fabricated theater — em-dashed / omitted / dropped):
 *     - the RD "accepted" acknowledgement text on every row -> the badge carries ONLY the real
 *       status; the fabricated ack sub-line is dropped. The "received RD acknowledgement" KPI sub
 *       is dropped. No send/retry success toast (both dict toasts assert a fabricated RD ack).
 *     - the "connection / Online / CA cert expiry" connection card -> value em-dash, CA-cert sub
 *       dropped (there is no real Service-Provider connection / CA certificate).
 *     - the detail modal's description + delivery channel -> em-dash (no wire); the digital-
 *       signature block (CA serial / SHA-256 / expiry), the sign/ack step timeline, and the
 *       PDF+XML / send-to-customer actions -> OMITTED entirely (pure fabrication).
 *     - the batch/retry confirm messages (CA signing, XML RD-standard, "pull latest tax id") ->
 *       dropped; the confirm keeps only its honest title + subtitle.
 *   PRESENTATIONAL: the Export button opens a format-picker modal with no export endpoint (the
 *   pm-dashboard precedent) — a standard affordance, not compliance fabrication.
 *
 * i18n (rule 2): every string resolves via t() from the DICT layer (i18n-full.json) — the
 * tax.etax.* keys (i18n Wave-B) plus value-exact reused keys for shared vocabulary
 * (fin.breadcrumbFinance, tax.vat.colInvoiceNo, pm.unitItems, subcon.colValueBaht/colDate,
 * ar.invoice.thVat, ar.taxInvoice.kpiIssued, ar.cn.kpiUnitDocs, perm.view, pm.btnClose,
 * common.cancel, pm.export*). Tokens back every colour (rule 6). ZERO Thai/baht in this .tsx
 * (B-073) — every glyph lives only in i18n-full.json.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  useCompanies,
  useProjects,
  resolveActiveProject,
  resolveActiveCompany,
} from "../../shell/use-shell-data";
import {
  toStatusCount,
  statusCountMap,
  totalCount,
  toEtaxInvoiceRow,
  toCustomerMap,
  statusBadgeKind,
  queuedInvoiceIds,
  sumGrossTotal,
  formatMoney,
  formatMillions,
  formatDate,
  type BadgeKind,
  type EtaxStatus,
  type EtaxInvoiceRow,
  type EtaxCustomer,
} from "./tax-etax-rows";
import { useEtaxStatus, useArInvoices, useCustomers, useSendEtax } from "./use-tax-etax";

/** Honest em-dash for a field that has no real wire value (never a fabricated placeholder). */
const DASH = "—";

/** The i18n label key for each real etax status (queued reuses statusPending; void reuses common.cancel). */
const STATUS_LABEL_KEY = {
  queued: "tax.etax.statusPending",
  sent: "tax.etax.statusSent",
  rejected: "tax.etax.statusError",
  void: "common.cancel",
} as const satisfies Record<EtaxStatus, string>;

/** StatusBadge styling per kind (ds.jsx STATUS map; dots are the prototype-verbatim hexes, B-037(a)). */
const BADGE_STYLE: Record<BadgeKind, { bg: string; fg: string; dot: string }> = {
  approved: { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" },
  pending: { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" },
  rejected: { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" },
  draft: { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" },
};

/** Table header cell style (ds.jsx th()). */
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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: 14, verticalAlign: "middle" };

/** Kpi card, inlined from dashboard.jsx Kpi (label / value / unit / sub / accent). */
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
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** StatusBadge, inlined from ds.jsx StatusBadge (size sm). */
function StatusBadge({ kind, label }: { kind: BadgeKind; label: string }) {
  const s = BADGE_STYLE[kind];
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

/** Extract an error message off an unknown mutation error (gl-inbox precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export function TaxETax() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const statusQ = useEtaxStatus();
  const invoicesQ = useArInvoices();
  const customersQ = useCustomers();
  const sendEtax = useSendEtax();

  // Active company name for the subtitle {company} slot (CompanySwitcher resolution).
  const companiesQ = useCompanies();
  const projectsQ = useProjects();
  const activeProject = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const activeCompany = resolveActiveCompany(companiesQ.data, ctx.tweaks.company, activeProject);
  const companyName = activeCompany?.name ?? "";

  // Real per-status aggregate (GET /etax/status) -> the KPI counts (B-124: real status only).
  const counts = useMemo(
    () => statusCountMap((statusQ.data ?? []).map(toStatusCount)),
    [statusQ.data],
  );
  const total = totalCount(counts);

  // The invoice register rows (GET /ar/invoices) -> table body + total amount + queued send set.
  const invoices = useMemo<EtaxInvoiceRow[]>(
    () => (invoicesQ.data ?? []).map(toEtaxInvoiceRow),
    [invoicesQ.data],
  );
  const grossTotal = useMemo(() => sumGrossTotal(invoices), [invoices]);
  const queuedIds = useMemo(() => queuedInvoiceIds(invoices), [invoices]);

  // customer_id -> { name, taxId } (GET /customers) — REAL columns, joined not em-dashed.
  const customerMap = useMemo(
    () => toCustomerMap(customersQ.data ?? []),
    [customersQ.data],
  );
  const customerOf = (id: string): EtaxCustomer | undefined => customerMap.get(id);

  const pendingCount = counts.queued; // prototype cnt("pending") — the batch-send count.

  // Send a set of queued/rejected ids -> POST /etax/send. On success the hook invalidates the
  // status + invoices queries so the badges/KPIs flip to their real state; on failure the real
  // error surfaces honestly (never a fabricated RD acknowledgement, B-124).
  const send = (invoiceIds: string[]) => {
    if (invoiceIds.length === 0) return; // defensive: nothing to send.
    sendEtax.mutate(
      { invoice_ids: invoiceIds },
      { onError: (err) => ctx.notify(errMessage(err) || DASH, "danger") },
    );
  };

  // Send-batch confirm (etax.jsx sendBatch). The prototype's CA-signing / XML RD-standard message
  // is fabricated theater (B-124) -> dropped; the confirm keeps only its honest title + subtitle.
  const sendBatch = () => {
    ctx.confirm({
      title: t("tax.etax.batchTitle"),
      subtitle: t("tax.etax.batchSubtitle").replace("{count}", String(pendingCount)),
      icon: "upload",
      iconTone: "var(--brand)",
      onConfirm: () => send(queuedIds),
    });
  };

  // Row retry for a rejected invoice (etax.jsx retry). The prototype's fabricated failure reason
  // + "pull latest tax id and re-sign" message are dropped (B-124); POST /etax/send re-sends the
  // rejected id (the handler flips rejected -> sent, C-180).
  const retry = (row: EtaxInvoiceRow) => {
    ctx.confirm({
      title: t("tax.etax.retryTitle"),
      subtitle: row.no,
      icon: "warn",
      iconTone: "var(--danger)",
      onConfirm: () => send([row.id]),
    });
  };

  // Presentational export modal (pm-dashboard precedent) — no export endpoint; the "what" is the
  // e-Tax register title. A standard affordance, not compliance fabrication.
  const openExport = () => {
    const what = t("tax.etax.exportTitle");
    const opts: { ic: IconName; l: string }[] = [
      { ic: "grid", l: t("pm.exportExcel") },
      { ic: "doc", l: t("pm.exportPdf") },
      { ic: "download", l: t("pm.exportCsv") },
    ];
    ctx.openModal({
      title: t("pm.exportModalTitle"),
      subtitle: what,
      icon: "download",
      iconTone: "var(--brand)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {opts.map((o) => (
            <button
              key={o.l}
              type="button"
              onClick={() => {
                close();
                ctx.notify(t("pm.toastDownloading").replace("{name}", what).replace("{fmt}", o.l));
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--surface)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <Icon name={o.ic} size={18} color="var(--brand)" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{o.l}</span>
              <Icon name="arrowR" size={15} color="var(--text-3)" />
            </button>
          ))}
        </div>
      ),
    });
  };

  // Row-click detail (etax.jsx openDetail) — REAL rows only. The digital-signature block, the
  // sign/ack step timeline, and the PDF+XML / send-to-customer actions are OMITTED (pure
  // fabrication, B-124); description + delivery channel em-dash (no wire); the RD-status row
  // shows the real etax_status label, never the fabricated RD acknowledgement.
  const openDetail = (row: EtaxInvoiceRow) => {
    const customer = customerOf(row.customerId);
    const date = formatDate(row.createdAt);
    const subtitle = [customer?.name ?? "", date].filter(Boolean).join(" · ");
    const rows: [string, string][] = [
      [t("pm.unitItems"), DASH], // description — no wire
      [t("tax.etax.detailBuyerTaxId"), customer?.taxId || DASH],
      [t("tax.etax.detailTotalVat"), formatMoney(row.total)],
      [t("tax.etax.detailVatIncl"), formatMoney(row.vat)],
      [t("tax.etax.detailChannel"), DASH], // delivery channel — no wire
      [t("tax.etax.detailRdStatus"), t(STATUS_LABEL_KEY[row.etaxStatus])], // REAL status only
    ];
    ctx.openModal({
      title: row.no,
      subtitle,
      icon: "doc",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <div>
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>
                {value}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            {row.etaxStatus === "rejected" ? (
              <Btn
                kind="primary"
                size="md"
                icon="sync"
                onClick={() => {
                  close();
                  retry(row);
                }}
              >
                {t("tax.etax.btnRetry")}
              </Btn>
            ) : (
              <Btn kind="primary" size="md" onClick={close}>
                {t("pm.btnClose")}
              </Btn>
            )}
          </div>
        </div>
      ),
    });
  };

  const isLoading = statusQ.isLoading || invoicesQ.isLoading;

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("tax.etax.breadcrumbTax"), t("tax.etax.breadcrumb")]}
      title={t("tax.etax.title")}
      subtitle={t("tax.etax.subtitle").replace("{company}", companyName)}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={openExport}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn
            kind="primary"
            size="md"
            icon="upload"
            disabled={pendingCount === 0}
            onClick={sendBatch}
          >
            {t("tax.etax.btnBatch").replace("{count}", String(pendingCount))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): issued (count + REAL total amount), sent (count; RD ack sub dropped),
          queued/rejected (real counts), connection (value em-dash + CA-cert sub dropped, B-124). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("ar.taxInvoice.kpiIssued")}
          value={String(total)}
          unit={t("ar.cn.kpiUnitDocs")}
          sub={t("tax.etax.kpiIssuedSub").replace("{amount}", formatMillions(grossTotal))}
          accent="var(--brand)"
        />
        <Kpi
          label={t("tax.etax.statusSent")}
          value={String(counts.sent)}
          unit={t("ar.cn.kpiUnitDocs")}
          accent="var(--ok)"
        />
        <Kpi
          label={t("tax.etax.kpiPending")}
          value={`${counts.queued} / ${counts.rejected}`}
          unit={t("ar.cn.kpiUnitDocs")}
          sub={t("tax.etax.kpiPendingSub")}
          accent={counts.rejected > 0 ? "var(--danger)" : "var(--warn)"}
        />
        <Kpi label={t("tax.etax.kpiConn")} value={DASH} accent="var(--ok)" />
      </div>

      <Card pad={0}>
        {isLoading ? (
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
                <th style={th(150)}>{t("tax.vat.colInvoiceNo")}</th>
                <th style={th()}>{t("tax.etax.colCustomerTaxId")}</th>
                <th style={th(200)}>{t("pm.unitItems")}</th>
                <th style={th(120, true)}>{t("subcon.colValueBaht")}</th>
                <th style={th(90, true)}>{t("ar.invoice.thVat")}</th>
                <th style={th(90)}>{t("subcon.colDate")}</th>
                <th style={th(150)}>{t("tax.etax.colStatus")}</th>
                <th style={th(100)} />
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                invoices.map((row) => {
                  const customer = customerOf(row.customerId);
                  const date = formatDate(row.createdAt);
                  const badge = statusBadgeKind(row.etaxStatus);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openDetail(row)}
                      style={{
                        borderTop: "1px solid var(--border)",
                        cursor: "pointer",
                        background:
                          row.etaxStatus === "rejected"
                            ? "color-mix(in srgb, var(--danger-soft) 45%, white)"
                            : "transparent",
                        opacity: row.etaxStatus === "void" ? 0.6 : 1,
                      }}
                    >
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {row.no || DASH}
                      </td>
                      {/* customer name + tax id: REAL (GET /customers), em-dash when unresolved */}
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{customer?.name || DASH}</div>
                        <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {customer?.taxId || DASH}
                        </div>
                      </td>
                      {/* description: no wire field -> em-dash */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                      {/* value: REAL gross total (amount + vat) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(row.total)}
                      </td>
                      {/* VAT: REAL output VAT */}
                      <td style={{ ...td, textAlign: "right", color: "var(--text-2)" }} className="num">
                        {formatMoney(row.vat)}
                      </td>
                      {/* date: REAL created_at (UTC), em-dash on missing/invalid */}
                      <td style={{ ...td, color: "var(--text-2)" }} className="num">
                        {date || DASH}
                      </td>
                      {/* status: REAL etax_status badge only — the fabricated RD ack sub-line is dropped (B-124) */}
                      <td style={td}>
                        <StatusBadge kind={badge} label={t(STATUS_LABEL_KEY[row.etaxStatus])} />
                      </td>
                      {/* action cell stops row-click propagation (Btn onClick has no event arg) */}
                      <td style={{ ...td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        {row.etaxStatus === "rejected" ? (
                          <Btn kind="danger" size="sm" icon="sync" onClick={() => retry(row)}>
                            {t("tax.etax.btnRetry")}
                          </Btn>
                        ) : (
                          <Btn kind="ghost" size="sm" icon="eye" onClick={() => openDetail(row)}>
                            {t("perm.view")}
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-3)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="info" size={13} />
          {t("tax.etax.footerInfo")}
        </div>
      </Card>
    </Page>
  );
}
