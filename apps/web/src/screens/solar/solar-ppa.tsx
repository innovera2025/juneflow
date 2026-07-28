/*
 * SolarPPA — the sell-electricity / PPA billing screen (route solar.ppa), ported from
 * pototype/solar.jsx SolarPPA (L110-161) + the shared SolarKpi (L6-22). Section module
 * `ppa` (registry.ts L125). READ-ONLY (solar.ts is GET-only, no write bundle filed).
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb, the title + TypeBadge subtitle,
 * the create-invoice header action, the 4-card KPI strip, and the monthly-billing table
 * with a YTD footer are the prototype's.
 *
 * DATA (rule 3): GET /solar/ppa-invoices (use-solar.ts) via the generated client — the
 * prototype's local array becomes the server catalogue. Pure narrowing / YTD aggregation /
 * status-tone mapping lives in solar-ppa-rows.ts (unit-tested, G3).
 *
 * KPIs: "revenue YTD" (MW-baht, millions) is DERIVED from the returned amounts. Counterparty
 * / FiT-rate / COD are fixed illustrative figures rendered via their i18n value-keys
 * (solar.ppa.kpiCounterpartyValue / kpiFitValue / kpiCodValue — consume-only).
 *
 * HONEST DIVERGENCES (rule 4 — flagged, never fabricated):
 *   - create-invoice (header primary) is a dropped mock — no write endpoint — so DISABLED.
 *   - the ppa `status` enum has NO i18n label keys, so the badge renders the RAW backend
 *     value; only the tone is code-mapped (ppaStatusKind). Labels are a future i18n round.
 *
 * i18n (rule 2): every visible string is a solar.ppa.* dict key (t) — consume-only, no key
 * minted here. No Thai literal lives in source (B-073); tokens back every colour except the
 * KPI accent hex #B45309 (prototype-verbatim, solar.jsx L127, B-037(a)); numeric cells carry
 * class `num` (rule 7).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { TypeBadge } from "../../shell/type-badge";
import { SolarKpi, StatusBadge } from "./solar-kpi";
import { formatMoney } from "./solar-shared";
import { toPpaRow, ytdAmount, kpiYtdValue, rateText, ppaStatusKind, type PpaRow } from "./solar-ppa-rows";
import { useSolarPpaInvoices } from "./use-solar";

/** Em-dash for an empty billing register (never a fabricated value). */
const DASH = "—";

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
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

export function SolarPPA() {
  const { t } = useI18n();

  const ppaQ = useSolarPpaInvoices();
  const rows = useMemo<PpaRow[]>(() => (ppaQ.data ?? []).map(toPpaRow), [ppaQ.data]);
  const ytd = useMemo(() => ytdAmount(rows), [rows]);

  return (
    <Page
      breadcrumbs={[t("solar.ppa.breadcrumbEnergy"), t("solar.ppa.breadcrumbSelf")]}
      title={t("solar.ppa.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type="solar" size="sm" />
          <span>{t("solar.ppa.subtitle")}</span>
        </span>
      }
      actions={
        // Honest-DISABLED: no write endpoint (create-invoice is a dropped mock).
        <Btn kind="primary" size="md" icon="plus" disabled>
          {t("solar.ppa.actionCreateInvoice")}
        </Btn>
      }
    >
      {/* KPI strip (4): #3 revenue-YTD DERIVED; #1/#2/#4 are i18n value-keys (verbatim figures). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <SolarKpi
          label={t("solar.ppa.kpiCounterpartyLabel")}
          value={t("solar.ppa.kpiCounterpartyValue")}
          sub={t("solar.ppa.kpiCounterpartySub")}
          accent="#B45309"
          icon="paperclip"
        />
        <SolarKpi
          label={t("solar.ppa.kpiFitLabel")}
          value={t("solar.ppa.kpiFitValue")}
          unit={t("solar.ppa.kpiFitUnit")}
          sub={t("solar.ppa.kpiFitSub")}
          accent="var(--info)"
          icon="trend"
        />
        <SolarKpi
          label={t("solar.ppa.kpiYtdLabel")}
          value={kpiYtdValue(rows)}
          unit={t("solar.ppa.kpiYtdUnit")}
          sub={t("solar.ppa.kpiYtdSub")}
          accent="var(--ok)"
          icon="pie"
        />
        <SolarKpi
          label={t("solar.ppa.kpiCodLabel")}
          value={t("solar.ppa.kpiCodValue")}
          sub={t("solar.ppa.kpiCodSub")}
          accent="var(--brand)"
          icon="check"
        />
      </div>

      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
          {t("solar.ppa.tableTitle")}
        </div>
        {ppaQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th(140)}>{t("solar.ppa.colMonth")}</th>
                <th scope="col" style={th(140, true)}>{t("solar.ppa.colMwh")}</th>
                <th scope="col" style={th(120, true)}>{t("solar.ppa.colRate")}</th>
                <th scope="col" style={th(150, true)}>{t("solar.ppa.colAmount")}</th>
                <th scope="col" style={th(140)}>{t("solar.ppa.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  {/* No dedicated empty-state key exists (no minting) -> honest em-dash. */}
                  <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>{DASH}</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.month || DASH}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(r.mwh)}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">{rateText(r.rate)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">{formatMoney(r.amount)}</td>
                    <td style={td}>
                      {/* Raw backend value as the label (no ppa i18n key); tone is code-mapped. */}
                      <StatusBadge kind={ppaStatusKind(r.status)} size="sm">{r.status || DASH}</StatusBadge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
              <tr>
                <td colSpan={3} style={{ padding: 12, fontWeight: 700, fontSize: 12.5 }}>{t("solar.ppa.footYtd")}</td>
                <td style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }} className="num">{formatMoney(ytd)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </Page>
  );
}
