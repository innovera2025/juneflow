/*
 * AdminOverview — the Platform-owner revenue overview (route admin.overview, Flow-G; the
 * platform-mode landing route), ported from pototype/subscription-admin.jsx AdminOverview
 * (L54-110). Registry section "platform" (owner-gated: shown only when viewMode="platform";
 * the backend 403s non-owners -> graceful skeleton/empty here). Mirrors the sibling admin-subs
 * / admin-invoices header + KPI + Card idiom.
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / subtitle + a single export
 * action, the 5-KPI grid (MRR / ARR / active / trial / churn), and the 2-card row
 * (subscriber-history chart 1.6fr + package-share 1fr) are the prototype's.
 *
 * Data (rules 3/4): three TanStack Query reads via the generated client — useAdminOverviewTotals
 * (GET /admin/subscribers envelope, the SERVER-computed mrr/arr) + useAdminSubscribers (the rows,
 * for the active/trial counts + package-share) + useAdminPackages (the package name/colour). All
 * narrowing (subscriberCountByPackage, sizeColor, formatMoney) lives in the pure, unit-tested
 * admin-rows.ts (G3); this screen stays declarative.
 *
 * REAL vs em-dash + mock (reported honestly, never fabricated — Phase-6 B-179):
 *   - MRR/ARR: REAL, SERVER-computed on the subscribers envelope (money = SERVER); DISPLAYED
 *     as-is, NOT re-derived client-side (the deprecated client deriveMrr is not used for the KPI).
 *   - Active/Trial: REAL, DERIVED counts over the subscribers read (active||trial vs trial); the
 *     active sub interpolates the total row count.
 *   - Churn KPI: honest EM-DASH — computeMrrArr emits no churn and there is no period-rate source;
 *     the prototype's "2.1%" + its month-over-month delta chip (and MRR's delta) are mock trends
 *     with NO wire, so the delta chips are dropped (the KPI values are all real).
 *   - Subscriber-history chart: honest-EMPTY — subscriber rows carry only created_at and the
 *     prototype MONTHS series [142..191] is a decorative mock (>> the seeded rows) with no monthly-
 *     history source; the card + title are kept, the body renders skeleton -> empty, and NO
 *     6-month series is fabricated.
 *   - Package-share: REAL, subscriberCountByPackage over the subscribers read (status != cancelled).
 *   - Export: MOCK faithful toast (no export endpoint on the wire).
 *
 * i18n (rule 2): every visible string is an admin.overview.* / admin.common.* dict key (t); the
 * baht / percent / unit ("rai") / em-dash glyphs (U+0E3F / U+2014 etc.) resolve through keys,
 * never literals (B-073). Tokens back every colour except the prototype-verbatim size->hex
 * (sizeColor, B-037(a)). Numeric cells carry class `num`.
 */
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toSubscriberRow,
  toPackageRow,
  subscriberCountByPackage,
  sizeColor,
  formatMoney,
  type SubscriberRow,
  type PackageRow,
} from "./admin-rows";
import { useAdminSubscribers, useAdminPackages, useAdminOverviewTotals } from "./use-admin";

/**
 * Bar — ported 1:1 from ds.jsx Bar (L168-179). NOTE: the prototype's Bar takes no `color`
 * param, so AdminOverview's `<Bar ... color={p.color}/>` colour is DROPPED by ds.jsx and the
 * fill is threshold-based (brand -> warn > 85% -> danger when over). Matching that exactly keeps
 * the render faithful (the colour lives on the row's dot, not the bar).
 */
function Bar({ value, max, height = 6 }: { value: number; max: number; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max;
  const color = over ? "var(--danger)" : pct > 85 ? "var(--warn)" : "var(--brand)";
  return (
    <div style={{ width: "100%", height, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width .3s" }} />
    </div>
  );
}

/** AdminKpi — ds.jsx Kpi (dashboard.jsx L93); this screen's variant has no delta chip (dropped —
 *  the prototype deltas are mock trends with no wire). `accent` defaults to the value text colour. */
function AdminKpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function AdminOverview() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const subscribersQ = useAdminSubscribers();
  const packagesQ = useAdminPackages();
  const totalsQ = useAdminOverviewTotals();

  const subscribers = useMemo<SubscriberRow[]>(() => (subscribersQ.data ?? []).map(toSubscriberRow), [subscribersQ.data]);
  const packages = useMemo<PackageRow[]>(() => (packagesQ.data ?? []).map(toPackageRow), [packagesQ.data]);
  const countByPkg = useMemo(() => subscriberCountByPackage(subscribers), [subscribers]);

  // KPI counts (subscription-admin.jsx L56, L73-74): active||trial vs trial, over the full list.
  const activeCount = subscribers.filter((s) => s.status === "active" || s.status === "trial").length;
  const trialCount = subscribers.filter((s) => s.status === "trial").length;
  const totalCount = subscribers.length;

  // Revenue totals — SERVER-computed on the subscribers envelope (money = SERVER), displayed as-is.
  const mrr = totalsQ.data?.mrr ?? 0;
  const arr = totalsQ.data?.arr ?? 0;

  const baht = t("admin.overview.kpiMrrUnit");
  const rai = t("admin.common.rai");
  const dash = t("admin.common.emptyDash");

  // Package-share denominator (subscription-admin.jsx maxN, L59); 0 when there are no packages.
  const maxN = packages.length ? Math.max(...packages.map((p) => countByPkg.get(p.id) ?? 0)) : 0;

  return (
    <Page
      breadcrumbs={[t("admin.overview.breadcrumbOwner"), t("admin.overview.breadcrumbRevenue")]}
      title={t("admin.overview.title")}
      subtitle={t("admin.overview.subtitle")}
      actions={
        // Export -> MOCK toast (no export endpoint on the wire).
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("admin.overview.exportToast"))}>
          {t("admin.common.export")}
        </Btn>
      }
    >
      {/* KPI grid (5) — MRR/ARR = SERVER totals; active/trial = DERIVED counts; churn = honest em-dash. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 18 }}>
        {/* MRR — envelope .mrr (NOT client deriveMrr). Mock delta chip dropped (no trend wire). */}
        <AdminKpi label={t("admin.overview.kpiMrrLabel")} value={formatMoney(mrr)} unit={baht} accent="var(--brand)" />
        {/* ARR — envelope .arr / 1e6, 2 dp (server arr === mrr*12). */}
        <AdminKpi
          label={t("admin.overview.kpiArrLabel")}
          value={(arr / 1e6).toFixed(2)}
          unit={t("admin.overview.kpiArrUnit")}
          sub={t("admin.overview.kpiArrSub")}
        />
        {/* Active — count active||trial; sub interpolates {n} = total rows. */}
        <AdminKpi
          label={t("admin.overview.kpiActiveLabel")}
          value={String(activeCount)}
          unit={rai}
          sub={t("admin.overview.kpiActiveSub").replace("{n}", String(totalCount))}
          accent="var(--ok)"
        />
        {/* Trial — count trial. */}
        <AdminKpi
          label={t("admin.overview.kpiTrialLabel")}
          value={String(trialCount)}
          unit={rai}
          sub={t("admin.overview.kpiTrialSub")}
          accent="var(--warn)"
        />
        {/* Churn — honest em-dash (no churn on the wire); the mock 2.1% + its delta chip are dropped. */}
        <AdminKpi
          label={t("admin.overview.kpiChurnLabel")}
          value={dash}
          unit={t("admin.overview.kpiChurnUnit")}
          sub={t("admin.overview.kpiChurnSub")}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        {/* Subscriber-history chart — HONEST-EMPTY: no monthly-history wire (rows carry only
            created_at; the prototype MONTHS series is decorative mock). Keep the card + title,
            render skeleton -> an empty state; NEVER fabricate a 6-month series. */}
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700 }}>
            {t("admin.overview.chartSubscribersTitle")}
          </div>
          <div style={{ padding: "20px 18px" }}>
            {subscribersQ.isLoading ? (
              <div style={{ height: 170, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 170 }}>
                <Icon name="trend" size={30} color="var(--text-3)" style={{ opacity: 0.5 }} />
              </div>
            )}
          </div>
        </Card>

        {/* Package-share — REAL: subscriberCountByPackage over the subscribers read. */}
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700 }}>
            {t("admin.overview.chartPackagesTitle")}
          </div>
          <div style={{ padding: 18 }}>
            {packagesQ.isLoading ? (
              [0, 1, 2, 3].map((n) => (
                <div
                  key={n}
                  style={{ height: 34, marginBottom: 14, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
                />
              ))
            ) : packages.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "var(--text-3)", fontSize: 13 }}>
                {dash}
              </div>
            ) : (
              packages.map((p) => {
                const count = countByPkg.get(p.id) ?? 0;
                return (
                  <div key={p.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color || sizeColor(p.size) }} />
                        {p.name}
                      </span>
                      <span className="num" style={{ fontWeight: 700 }}>
                        {count} {rai}
                      </span>
                    </div>
                    <Bar value={count} max={maxN} />
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
