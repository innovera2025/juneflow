/*
 * FinAging — the shared AR/AP Aging Report screen, ported from pototype/accounting-extra.jsx
 * FinAging (L168-276). One component serves BOTH routes: ar.aging (side="ar") and ap.aging
 * (side="ap") — NAV-ROUTES.md L73/L78. The router registers two thin wrappers (ARAging / APAging)
 * that fix the side; the in-screen AP/AR pill tab (the prototype's toggle) then lets a user switch
 * ledger direction from either entry.
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, AP/AR side,
 * Aging Report screen), the title/subtitle, the Export header action, the AP/AR pill toggle, the
 * 4-card KPI strip, and the party x bucket table (party column, five bucket columns
 * current/1-30/31-60/61-90/90+, total column, and the tfoot column sums) are the prototype's,
 * inlined (th/td/KpiCard). Every colour is an @juneflow/tokens var() (rule 6); ZERO Thai/baht in
 * this .tsx (B-073) — every glyph lives only in i18n-full.json (consumed via t(), CONSUME-ONLY).
 *
 * DATA — the pivotal honest gap (rule 3, flagged, never fabricated):
 *   AR side -> GET /ar/aging (use-aging.ts useArAging). The handler (apps/api/src/routes/ar.ts
 *   aging()) returns an AGGREGATE-BY-BUCKET report { buckets:[{bucket,count,amount}],
 *   total_outstanding, currency_code } — it has the BUCKET dimension but NOT the PARTY (customer)
 *   dimension. So:
 *     - the 4 KPI cards + the tfoot column sums are REAL (derived from the aggregate) — toAgingView.
 *     - the per-party table BODY is HONEST-EMPTY: resolveParties() yields no rows because an
 *       aggregate report carries no customer breakdown, and a party row is never fabricated. The
 *       body seam (parties.map) lights up unchanged the moment a per-customer aging wire lands (a
 *       /ar/aging breakdown, or a client-side GET /ar/invoices aggregation — a flagged follow-up).
 *   AP side -> there is NO /ap/aging endpoint (apps/api/src/routes/ap.ts exposes none), so the AP
 *   tab renders HONEST-EMPTY: the KPI values + tfoot em-dash (null view) and the body is empty.
 *   /ar/aging is NEVER reused for AP (different party + direction) and nothing is fabricated.
 *
 * The prototype's per-party detail modal (row click -> openModal with the bucket breakdown +
 * view-docs / remind / create-PV actions) is UNREACHABLE without per-party rows, so it is deferred
 * honestly (drop-not-collect) — its keys (fin.aging.modalSubtitle / bucket30/60/90/Over90 /
 * btnViewDocs* / btnRemind / toastRemind / btnCreatePv / toastGoPv) are unused until a per-party
 * wire exists. Export has no server endpoint -> it fires a client toast (fin.toastExportExcel),
 * mirroring the ap.billing precedent (the shared export modal is not yet a web primitive).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toAgingView,
  resolveParties,
  partyRowTotal,
  formatMoney,
  formatMillion,
  type AgingSide,
  type AgingPartyRow,
} from "./fin-aging-rows";
import { useArAging } from "./use-aging";

/** Honest em-dash for a cell with no wire value. */
const DASH = "—";

/**
 * The 61-90 bucket tone. The prototype paints this bucket with a verbatim hex (#B45309,
 * accounting-extra.jsx L259) that is NOT an @juneflow/tokens var; kept byte-for-byte as the
 * gl-inbox #D97706 precedent (B-037(a)) — a prototype-fidelity constant, not new design.
 */
const BUCKET_6190_TONE = "#B45309";

/** Table header cell style (ds.jsx th()), inlined. */
function th(w?: number): CSSProperties {
  return {
    textAlign: "start",
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

/** tfoot numeric cell style (accounting-extra.jsx L268 column-sum cells). */
const footNum: CSSProperties = { padding: 12, textAlign: "right", fontWeight: 700 };

/** KPI card, inlined from dashboard.jsx Kpi reduced to label/value/unit/sub/accent. */
function KpiCard({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  accent: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}>
          {value}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>
    </Card>
  );
}

/** A right-aligned bucket amount cell (tone-coloured when positive, em-dash when zero). */
function BucketCell({ value, tone }: { value: number; tone?: string }) {
  return (
    <td style={{ ...td, textAlign: "right" }} className="num">
      {value > 0 ? (
        <span style={{ fontWeight: 600, color: tone ?? "var(--text)" }}>{formatMoney(value)}</span>
      ) : (
        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
      )}
    </td>
  );
}

/**
 * FinAging body. `side` fixes the initial ledger direction (route-provided); the pill tab then
 * switches it. AR reads the real aggregate report; AP is honest-empty (no endpoint).
 */
function FinAging({ side }: { side: AgingSide }) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [tab, setTab] = useState<AgingSide>(side);
  const isAp = tab === "ap";

  const arAgingQ = useArAging();
  // AR tab -> the real aggregate report view; AP tab -> null (no endpoint, honest-empty).
  const view = tab === "ar" ? toAgingView(arAgingQ.data) : null;
  // Per-party rows: HONEST-EMPTY on the aggregate wire (no party dimension) — see fin-aging-rows.
  const parties: AgingPartyRow[] = resolveParties(tab === "ar" ? arAgingQ.data : undefined);

  const breadcrumbs = [
    t("fin.breadcrumbFinance"),
    isAp ? t("fin.aging.breadcrumbApSide") : t("ar.breadcrumbArSide"),
    t("fin.aging.breadcrumb"),
  ];

  const kpiCountSub = t("fin.aging.kpiCountSub").replace("{count}", view ? String(view.count) : DASH);
  const kpiCurrentSub = t("fin.aging.kpiCurrentSub").replace("{percent}", view ? String(view.currentPct) : DASH);

  const tabs: { id: AgingSide; label: string }[] = [
    { id: "ap", label: t("fin.aging.tabAp") },
    { id: "ar", label: t("fin.aging.tabAr") },
  ];

  return (
    <Page
      breadcrumbs={breadcrumbs}
      title={t("fin.aging.title")}
      subtitle={t("fin.aging.subtitle")}
      actions={
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("fin.toastExportExcel"))}>
          {t("vendor.btnExport")}
        </Btn>
      }
    >
      {/* AP/AR pill toggle (accounting-extra.jsx L225-229). */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {tabs.map((tt) => {
          const on = tab === tt.id;
          return (
            <button
              key={tt.id}
              type="button"
              onClick={() => setTab(tt.id)}
              style={{
                padding: "9px 18px",
                borderRadius: 9,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                background: on ? "var(--brand)" : "var(--surface)",
                color: on ? "#fff" : "var(--text-2)",
                boxShadow: on ? "none" : "inset 0 0 0 1px var(--border)",
              }}
            >
              {tt.label}
            </button>
          );
        })}
      </div>

      {/* KPI strip (4): REAL on AR (aggregate report), em-dash on AP (no wire). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <KpiCard
          label={isAp ? t("fin.aging.kpiTotalAp") : t("fin.aging.kpiTotalAr")}
          value={view ? formatMillion(view.total) : DASH}
          unit={t("pm.unitMillion")}
          sub={kpiCountSub}
          accent="var(--brand)"
        />
        <KpiCard
          label={t("fin.aging.bucketCurrent")}
          value={view ? formatMillion(view.current) : DASH}
          unit={t("pm.unitMillion")}
          sub={kpiCurrentSub}
          accent="var(--ok)"
        />
        <KpiCard
          label={t("fin.aging.kpiOverdue")}
          value={view ? formatMillion(view.overdue) : DASH}
          unit={t("pm.unitMillion")}
          sub={t("fin.aging.kpiOverdueSub")}
          accent="var(--warn)"
        />
        <KpiCard
          label={t("fin.aging.kpiHighRisk")}
          value={view ? formatMoney(view.over) : DASH}
          unit={t("subcon.unitBaht")}
          sub={isAp ? t("fin.aging.kpiHighRiskSubAp") : t("fin.aging.kpiHighRiskSubAr")}
          accent="var(--danger)"
        />
      </div>

      <Card pad={0}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              <th style={th()}>{isAp ? t("fin.aging.thVendor") : t("fin.aging.thCustomer")}</th>
              <th style={{ ...th(120), textAlign: "right" }}>{t("fin.aging.bucketCurrent")}</th>
              <th style={{ ...th(110), textAlign: "right" }}>{t("fin.aging.th30")}</th>
              <th style={{ ...th(110), textAlign: "right" }}>{t("fin.aging.th60")}</th>
              <th style={{ ...th(110), textAlign: "right" }}>{t("fin.aging.th90")}</th>
              <th style={{ ...th(110), textAlign: "right" }}>{t("fin.aging.thOver90")}</th>
              <th style={{ ...th(130), textAlign: "right" }}>{t("fin.aging.thTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {/* Per-party rows are HONEST-EMPTY on the aggregate /ar/aging wire (no party dimension);
                this seam lights up unchanged when a per-customer aging wire lands — see header. */}
            {parties.map((r) => (
              <tr
                key={r.name}
                style={{
                  borderTop: "1px solid var(--border)",
                  background: r.over > 0 ? "color-mix(in srgb, var(--danger-soft) 45%, white)" : "transparent",
                }}
              >
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                    {t("fin.aging.docCount").replace("{count}", String(r.docs))}
                    {r.over > 0 && (
                      <span style={{ color: "var(--danger)", fontWeight: 700 }}>{t("fin.aging.overFlag")}</span>
                    )}
                  </div>
                </td>
                <BucketCell value={r.cur} />
                <BucketCell value={r.b30} tone="var(--info)" />
                <BucketCell value={r.b60} tone="var(--warn)" />
                <BucketCell value={r.b90} tone={BUCKET_6190_TONE} />
                <BucketCell value={r.over} tone="var(--danger)" />
                <td style={{ ...td, textAlign: "right", fontWeight: 800 }} className="num">
                  {formatMoney(partyRowTotal(r))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
            <tr>
              <td style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                {t("fin.aging.footTotal").replace("{count}", view ? String(view.count) : DASH)}
              </td>
              <td style={footNum} className="num">{view ? formatMoney(view.current) : DASH}</td>
              <td style={footNum} className="num">{view ? formatMoney(view.b30) : DASH}</td>
              <td style={footNum} className="num">{view ? formatMoney(view.b60) : DASH}</td>
              <td style={footNum} className="num">{view ? formatMoney(view.b90) : DASH}</td>
              <td style={footNum} className="num">{view ? formatMoney(view.over) : DASH}</td>
              <td style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }} className="num">
                {view ? formatMoney(view.total) : DASH}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </Page>
  );
}

/** Route ar.aging -> the AR ledger side (NAV-ROUTES.md L78, FinAging side="ar"). */
export function ARAging() {
  return <FinAging side="ar" />;
}

/** Route ap.aging -> the AP ledger side (NAV-ROUTES.md L73, FinAging side="ap"). */
export function APAging() {
  return <FinAging side="ap" />;
}
