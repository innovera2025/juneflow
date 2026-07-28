/*
 * AdminInvoices — the Platform-owner invoice/revenue screen (route admin.invoices), ported
 * from pototype/subscription-admin.jsx AdminInvoices (L193-238) + the openNotifySend dunning
 * dialog (real-forms2.jsx L207-215). Registry section "platform" (owner-gated: shown only
 * when viewMode="platform"; the backend 403s non-owners -> graceful skeleton/empty here).
 *
 * Design fidelity (PLAN.md §0 rule 1): the title/subtitle + a single export action, a 3-up
 * KPI row (billed-this-cycle / paid / outstanding), and a 6-column invoice table (no / org /
 * date / amount right / status / action) are the prototype's.
 *
 * Data (rules 3/4): two TanStack Query reads via the generated client — useAdminInvoices
 * (GET /admin/invoices) + useAdminSubscribers (GET /admin/subscribers) for the org join. The
 * 3 KPI figures are DERIVED (sum/filter over the fetched list), NOT hardcoded — invoiceTotals
 * in the pure, unit-tested admin-rows.ts (G3).
 *
 * REAL vs em-dash (reported honestly, never fabricated — Phase-6 B-179 minimal invoice wire
 * { id, subscription_id, amount, currency_code, status, created_at }):
 *   - invoice no: NO wire column -> em-dash. Data-completeness follow-up.
 *   - org: REAL, joined invoice.subscription_id -> /admin/subscribers.company_name
 *     (subscriberNameById); em-dash only when unresolved (never a raw uuid).
 *   - date: REAL created_at (YYYY-MM-DD).
 *   - amount: REAL (money, class num, right-aligned).
 *   - status: REAL status -> a tokened tri-state badge (paid->approved, pending->pending,
 *     overdue->rejected); an unknown status renders its raw code.
 *   - actions: overdue -> a dunning button (a faithful confirm dialog + toast; NOTHING is
 *     sent and nothing is written to the Audit Log despite the toast copy -- no reminder
 *     endpoint); other -> a view button (a mock download toast). Export -> a mock toast. No
 *     write endpoint exists.
 *
 * i18n (rule 2): every visible string is an admin.invoices.* / admin.common.* dict key (t);
 * the baht KPI unit reuses the shared admin.overview.kpiMrrUnit glyph key (the baht sign is
 * U+0E3F, so it cannot be a literal -- B-073). Tokens back every colour except the prototype-
 * verbatim StatusBadge dot hexes (B-037(a)). Numeric cells carry class `num`. The recon's
 * LABEL DEDUP is honoured: statusPaid/statusOverdue key both the KPI label and the badge.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toAdminInvoiceRow,
  toSubscriberRow,
  subscriberNameById,
  invoiceStatusInfo,
  invoiceTotals,
  formatMoney,
  formatDate,
  type BadgeTone,
  type AdminInvoiceRow,
} from "./admin-rows";
import { useAdminInvoices, useAdminSubscribers } from "./use-admin";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

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
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

function statusTone(tone: BadgeTone): { bg: string; fg: string; dot: string } {
  switch (tone) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  const s = statusTone(tone);
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
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** AdminKpi — ds.jsx Kpi (dashboard.jsx L93), the admin.invoices variant has no delta. */
function AdminKpi({ label, value, unit, sub, accent }: { label: string; value: string; unit: string; sub?: string; accent: string }) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}>
          {value}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function AdminInvoices() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const invoicesQ = useAdminInvoices();
  const subscribersQ = useAdminSubscribers();
  const rows = useMemo<AdminInvoiceRow[]>(() => (invoicesQ.data ?? []).map(toAdminInvoiceRow), [invoicesQ.data]);
  const totals = useMemo(() => invoiceTotals(rows), [rows]);
  // Org join: invoice.subscription_id -> /admin/subscribers.company_name (em-dash if unresolved).
  const orgById = useMemo(
    () => subscriberNameById((subscribersQ.data ?? []).map(toSubscriberRow)),
    [subscribersQ.data],
  );

  const baht = t("admin.overview.kpiMrrUnit"); // shared baht glyph key (U+0E3F, cannot be literal)

  const statusLabel = (status: string): string => {
    const info = invoiceStatusInfo(status);
    switch (info.labelKind) {
      case "paid":
        return t("admin.invoices.statusPaid");
      case "pending":
        return t("admin.invoices.statusPending");
      case "overdue":
        return t("admin.invoices.statusOverdue");
      default:
        return status; // raw backend code (no label key)
    }
  };

  /** Dunning dialog (real-forms2.jsx openNotifySend) -- faithful confirm + toast (org is
   *  em-dash; NOTHING is sent, nothing is audit-logged despite the toast copy). */
  const openDunning = (org: string) => {
    ctx.openModal({
      title: t("admin.invoices.notifyTitle"),
      subtitle: org,
      icon: "bell",
      iconTone: "var(--warn)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 16 }}>
            {t("admin.invoices.notifyMessage").replace("{org}", org)}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("admin.common.cancel")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="bell"
              onClick={() => {
                close();
                ctx.notify(t("admin.invoices.notifyToast").replace("{org}", org));
              }}
            >
              {t("admin.invoices.notifyConfirm")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("admin.common.crumbPlatform"), t("admin.invoices.breadcrumb")]}
      title={t("admin.invoices.title")}
      subtitle={t("admin.invoices.subtitle")}
      actions={
        // Export -> MOCK toast (no export endpoint).
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("admin.invoices.exportToast"))}>
          {t("admin.invoices.exportAction")}
        </Btn>
      }
    >
      {/* KPI strip (3) — all DERIVED via invoiceTotals over the fetched list. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <AdminKpi
          label={t("admin.invoices.kpiBilledLabel")}
          value={formatMoney(totals.billedSum)}
          unit={baht}
          sub={t("admin.invoices.kpiSheetSuffix").replace("{n}", String(totals.billedCount))}
          accent="var(--brand)"
        />
        <AdminKpi label={t("admin.invoices.statusPaid")} value={formatMoney(totals.paidSum)} unit={baht} accent="var(--ok)" />
        <AdminKpi
          label={t("admin.invoices.statusOverdue")}
          value={formatMoney(totals.outstandingSum)}
          unit={baht}
          sub={t("admin.invoices.kpiSheetSuffix").replace("{n}", String(totals.outstandingCount))}
          accent="var(--danger)"
        />
      </div>

      <Card pad={0}>
        {invoicesQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(170)}>{t("admin.invoices.colNo")}</th>
                  <th scope="col" style={th()}>{t("admin.invoices.colOrg")}</th>
                  <th scope="col" style={th(120)}>{t("admin.invoices.colDate")}</th>
                  <th scope="col" style={th(130, true)}>{t("admin.invoices.colAmount")}</th>
                  <th scope="col" style={th(110)}>{t("admin.invoices.colStatus")}</th>
                  <th scope="col" style={th(110)} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 60, textAlign: "center" }}>
                      <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  rows.map((x) => {
                    const info = invoiceStatusInfo(x.status);
                    return (
                      <tr key={x.id} style={{ borderTop: "1px solid var(--border)" }}>
                        {/* invoice no — NO wire column -> em-dash. */}
                        <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                          {DASH}
                        </td>
                        {/* org — REAL, joined subscription_id -> /admin/subscribers.company_name. */}
                        <td style={td}>{orgById.get(x.subscriptionId) ?? DASH}</td>
                        {/* date — REAL created_at. */}
                        <td style={{ ...td, color: "var(--text-2)" }} className="num">
                          {formatDate(x.createdAt) || DASH}
                        </td>
                        {/* amount — REAL (money, class num, right-aligned). */}
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                          {formatMoney(x.amount)}
                        </td>
                        {/* status — REAL -> tri-state badge. */}
                        <td style={td}>
                          <StatusBadge tone={info.tone} label={statusLabel(x.status)} />
                        </td>
                        {/* action — overdue -> dunning (mock); other -> view download (mock). */}
                        <td style={td}>
                          {x.status === "overdue" ? (
                            <Btn kind="soft" size="sm" icon="bell" onClick={() => openDunning(DASH)}>
                              {t("admin.invoices.dunAction")}
                            </Btn>
                          ) : (
                            <Btn
                              kind="ghost"
                              size="sm"
                              icon="download"
                              onClick={() => ctx.notify(t("admin.invoices.downloadToast").replace("{no}", DASH))}
                            >
                              {t("admin.invoices.viewAction")}
                            </Btn>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
