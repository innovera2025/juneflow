/*
 * SubBilling — the tenant Billing/receipts screen (route sub.billing), ported from
 * pototype/subscription.jsx SubBilling (L187-216). Registry section "usage".
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / subtitle and the single
 * Card wrapping a 6-column invoice table (no / date / description / amount right-aligned /
 * status / receipt action) are the prototype's.
 *
 * Data (rules 3/4): one TanStack Query read via the generated client —
 * useSubscriptionInvoices (GET /subscription/invoices). The narrowing + status-badge
 * mapping + date/number formatting live in the pure, unit-tested sub-rows.ts (G3).
 *
 * REAL vs em-dash (reported honestly, never fabricated — Phase-6 B-179 minimal invoice wire
 * { id, subscription_id, amount, currency_code, status, created_at }):
 *   - invoice no: NO wire column -> em-dash (never the raw uuid). Data-completeness follow-up.
 *   - date: REAL created_at, rendered YYYY-MM-DD (the codebase date convention), not the
 *     mock's Thai buddhist-era string.
 *   - description: NO wire column -> em-dash. Data-completeness follow-up.
 *   - amount: REAL, rendered verbatim via formatMoney (money -> currency_code, class num).
 *   - status: REAL status -> a tokened StatusBadge; paid -> the sub.billing.statusPaid label,
 *     other statuses render their raw backend code (no sub.billing label key exists -- the
 *     wire-reality "render the raw value" rule).
 *   - receipt download: MOCK -> a faithful ctx.notify toast (no receipt/PDF endpoint exists).
 *
 * i18n (rule 2): every visible string is a sub.billing.* / sub.common.* dict key (t). No Thai
 * literal in source (B-073); tokens back every colour (rule 6) except the prototype-verbatim
 * StatusBadge dot hexes (B-037(a), matching wo-list/land). Numeric cells carry class `num`.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { toInvoiceRow, invoiceBadge, formatMoney, formatDate, type BadgeTone, type InvoiceRow } from "./sub-rows";
import { useSubscriptionInvoices } from "./use-subscription";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

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

/** ds.jsx STATUS tone tokens for a badge tone (mirrors wo-list/land statusTone). */
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

/** StatusBadge (ds.jsx L91-108, size sm). */
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

export function SubBilling() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const invoicesQ = useSubscriptionInvoices();
  const rows = useMemo<InvoiceRow[]>(() => (invoicesQ.data ?? []).map(toInvoiceRow), [invoicesQ.data]);

  const statusLabel = (status: string): string => {
    const b = invoiceBadge(status);
    return b.labelKind === "paid" ? t("sub.billing.statusPaid") : status;
  };

  return (
    <Page
      breadcrumbs={[t("sub.common.breadcrumbAccount"), t("sub.billing.breadcrumb")]}
      title={t("sub.billing.title")}
      subtitle={t("sub.billing.subtitle")}
    >
      <Card pad={0}>
        {invoicesQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2].map((n) => (
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
                  <th scope="col" style={th(170)}>{t("sub.billing.colNo")}</th>
                  <th scope="col" style={th(120)}>{t("sub.billing.colDate")}</th>
                  <th scope="col" style={th()}>{t("sub.billing.colDesc")}</th>
                  <th scope="col" style={th(130, true)}>{t("sub.billing.colAmount")}</th>
                  <th scope="col" style={th(110)}>{t("sub.billing.colStatus")}</th>
                  <th scope="col" style={th(110)} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    {/* Icon-only empty state (no invented copy). */}
                    <td colSpan={6} style={{ padding: 60, textAlign: "center" }}>
                      <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  rows.map((iv) => {
                    const b = invoiceBadge(iv.status);
                    return (
                      <tr key={iv.id} style={{ borderTop: "1px solid var(--border)" }}>
                        {/* invoice no — NO wire column -> em-dash (never the raw uuid). */}
                        <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                          {DASH}
                        </td>
                        {/* date — REAL created_at (YYYY-MM-DD). */}
                        <td style={{ ...td, color: "var(--text-2)" }} className="num">
                          {formatDate(iv.createdAt) || DASH}
                        </td>
                        {/* description — NO wire column -> em-dash. */}
                        <td style={td}>{DASH}</td>
                        {/* amount — REAL (money, class num, right-aligned). */}
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                          {formatMoney(iv.amount)}
                        </td>
                        {/* status — REAL -> tokened badge. */}
                        <td style={td}>
                          <StatusBadge tone={b.tone} label={statusLabel(iv.status)} />
                        </td>
                        {/* receipt download — MOCK toast (no receipt endpoint). */}
                        <td style={td}>
                          <Btn
                            kind="ghost"
                            size="sm"
                            icon="download"
                            onClick={() => ctx.notify(`${t("sub.billing.downloadToast")} ${DASH}`)}
                          >
                            {t("sub.billing.receiptBtn")}
                          </Btn>
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
