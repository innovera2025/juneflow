/*
 * APBilling — the AP Billing (tang-nee) screen, ported from pototype/ap.jsx APBilling
 * (L11-99). Route ap.billing (docs/extract/NAV-ROUTES.md L68, component APBilling,
 * section "acct"), visual-gate reference tests/visual/reference/gallery/g2/07-s.jpg.
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb (finance section, AP
 * module, billing screen), the title/subtitle, the Export + create-billing header
 * actions, the 4-card MiniKpi strip, the TabBar (all · due · over · paid), and the
 * 10-column table (checkbox · AP no · vendor/invoice · ref · amount · VAT · WHT ·
 * Retention · due-date · status) are the prototype's. The create action opens the
 * BillingForm modal (a real POST /ap/billing).
 *
 * Data: GET /ap/billing (use-ap.ts) via the generated client — the prototype's local
 * AP_BILL becomes the real server catalogue. The row narrowing / KPI + tab counts /
 * aging / status tone live in billing-rows.ts (unit-tested, G3).
 *   HONEST GAPS (em-dashed, never fabricated) — the billing wire (ap.ts billingWire):
 *   - `no` is an honest null on EVERY row (ap_billing has no doc-number column) ->
 *     the "AP number" cell em-dashes. The AP-2026-xxxx numbers the prototype shows
 *     are not persisted.
 *   - `aging` derives from `due_date`; the seed has no due_date -> aging + the due
 *     cell em-dash there (not an invented age). `wht` / `retention` are nullable ->
 *     null em-dashes.
 *   - the KPI values + tab counts ARE real derivations off the loaded rows (amount /
 *     wht / aging / status), so they stay honest even when a column reads null (0).
 *   - the TabBar is PRESENTATIONAL (active fixed to "all"; it does not partition —
 *     matching the prototype's own no-op onChange, ap.jsx L55) but carries real
 *     counts. The checkbox column is uncontrolled + non-functional (prototype parity).
 *   - Export has no server endpoint -> it fires the prototype's export toast (client
 *     intent), the stand-in gl/gr/po-list use.
 *
 * i18n: every string is a billing-strings.json phrase (tp) or an existing DICT key
 * (t: vendor.btnExport / common.status). ap.billing is a NEW screen, so most compound
 * keys are absent (billing-strings.json._missing) -> honest Thai, flagged for the
 * Wave-2 i18n round. Tokens back every colour; the STATUS dot hexes are prototype-
 * verbatim (B-037(a), billing-rows.ts). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toBillingRow,
  billingKpis,
  billingTabCounts,
  formatMoney,
  formatMillions,
  formatThousands0,
  agingCell,
  agingColor,
  statusTone,
  statusLabelKind,
  type BillingRow,
} from "./billing-rows";
import { useApBillingList } from "./use-ap";
import { BillingForm } from "./billing-form";
import billingStrings from "./billing-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof billingStrings): PhraseKey => billingStrings[k] as PhraseKey;

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

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gl-jv). */
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
 * TabBar (ds.jsx TabBar). PRESENTATIONAL: `active` is fixed to "all" and the tabs do
 * not partition the list (the prototype's own onChange is a no-op, ap.jsx L55), but
 * every tab carries its real count. Kept for structural fidelity with the reference.
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

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ status, label }: { status: string; label: string }) {
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
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

export function APBilling() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const billingQ = useApBillingList();
  const rows = useMemo<BillingRow[]>(() => (billingQ.data ?? []).map(toBillingRow), [billingQ.data]);
  const kpis = useMemo(() => billingKpis(rows), [rows]);
  const tabs = useMemo(() => billingTabCounts(rows), [rows]);

  const statusLabel = (status: string): string => {
    switch (statusLabelKind(status)) {
      case "pending":
        return tp(P("statusPending"));
      case "approved":
        return tp(P("statusApproved"));
      case "rejected":
        return tp(P("statusRejected"));
      case "paid":
        return tp(P("statusPaid"));
      default:
        return tp(P("statusDraft"));
    }
  };

  const agingText = (aging: number | null): { text: string; color: string } | null => {
    const cell = agingCell(aging);
    if (!cell) return null;
    const prefix = cell.kind === "over" ? tp(P("agingLate")) : tp(P("agingLeft"));
    return { text: `${prefix} ${cell.days} ${tp(P("dayUnit"))}`, color: agingColor(cell.kind) };
  };

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("modalTitle")),
      subtitle: tp(P("modalSubtitle")),
      icon: "cart",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <BillingForm onClose={close} />,
    });
  };

  const TABS = [
    { id: "all", label: tp(P("tabAll")), count: tabs.all },
    { id: "due", label: tp(P("tabDue")), count: tabs.due },
    { id: "over", label: tp(P("tabOver")), count: tabs.over },
    { id: "paid", label: tp(P("tabPaid")), count: tabs.paid },
  ];

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "AP", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("vendor.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("addBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — all derived from the loaded rows (amount / aging / wht). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={tp(P("kpiTotalLabel"))}
          value={formatMillions(kpis.totalAmount)}
          unit={tp(P("unitM"))}
          sub={`${kpis.count} ${tp(P("unitDoc"))}`}
          tone="var(--brand)"
          icon="ledger"
        />
        <MiniKpi
          label={tp(P("kpiDue7Label"))}
          value={String(kpis.due7Count)}
          sub={`${formatMillions(kpis.due7Amount)} ${tp(P("unitM"))}`}
          tone="var(--accent)"
          icon="clock"
        />
        <MiniKpi
          label={tp(P("kpiOverLabel"))}
          value={String(kpis.overCount)}
          sub={`${formatMoney(kpis.overAmount)} ${tp(P("baht"))}`}
          tone="var(--danger)"
          icon="warn"
        />
        <MiniKpi
          label={tp(P("kpiWhtLabel"))}
          value={formatThousands0(kpis.whtTotal)}
          unit={tp(P("unitK"))}
          tone="var(--info)"
          icon="paperclip"
        />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} />

        {billingQ.isLoading ? (
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
                <th scope="col" style={th(28)}>
                  {/* Uncontrolled + non-functional (prototype parity, ap.jsx L61). */}
                  <input type="checkbox" readOnly />
                </th>
                <th scope="col" style={th(130)}>{tp(P("thNo"))}</th>
                <th scope="col" style={th()}>{tp(P("thVendor"))}</th>
                <th scope="col" style={th(130)}>{tp(P("thRef"))}</th>
                <th scope="col" style={th(110, true)}>{tp(P("thAmount"))}</th>
                <th scope="col" style={th(90, true)}>{tp(P("thVat"))}</th>
                <th scope="col" style={th(90, true)}>{tp(P("thWht"))}</th>
                <th scope="col" style={th(90, true)}>{tp(P("thRetention"))}</th>
                <th scope="col" style={th(110)}>{tp(P("thDue"))}</th>
                <th scope="col" style={th(100)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const aging = agingText(r.aging);
                const overdue = r.aging != null && r.aging < 0;
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: overdue ? "var(--danger-soft)" : "transparent",
                    }}
                  >
                    <td style={td}>
                      <input type="checkbox" readOnly />
                    </td>
                    {/* AP no: honest null on the wire -> em-dash (ap.ts GAP). */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 500 }}>{r.vendorName || DASH}</div>
                      <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                        {r.invoiceNo || DASH}
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }} className="num">
                      <span style={{ color: "var(--brand)" }}>{r.ref || DASH}</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {formatMoney(r.vat)}
                    </td>
                    {/* WHT: nullable -> em-dash. */}
                    <td style={{ ...td, textAlign: "right", color: "var(--info)", fontWeight: 600 }} className="num">
                      {r.wht == null ? DASH : formatMoney(r.wht)}
                    </td>
                    {/* Retention: nullable -> em-dash (prototype shows dash for 0/none). */}
                    <td style={{ ...td, textAlign: "right", color: "var(--warn)", fontWeight: 600 }} className="num">
                      {r.retention == null || r.retention === 0 ? DASH : formatMoney(r.retention)}
                    </td>
                    <td style={td}>
                      {/* due-date + aging: both derive from due_date -> em-dash when absent. */}
                      <div style={{ fontSize: 11.5 }}>{r.dueDate || DASH}</div>
                      {aging && (
                        <div style={{ fontSize: 10.5, color: aging.color, fontWeight: 600 }}>{aging.text}</div>
                      )}
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
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
