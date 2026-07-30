/*
 * SubPlans — the tenant Plans/Pricing screen (route sub.plans), ported from
 * pototype/subscription.jsx SubPlans (L132-184). Registry section "usage".
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / subtitle, the header
 * monthly|yearly cycle toggle (client useState) + primary signup action, and the plan-card
 * grid (colour chip + name + price block + full-width CTA + a 4-row feature list) are the
 * prototype's.
 *
 * Data (rules 3/4): a single TanStack Query read via the generated client —
 * useSubscriptionPlans (GET /subscription/plans). C1: the card grid is DATA-DRIVEN over the
 * returned list (S/M/L/Full), replacing the hardcoded 3-entry SUB_PACKAGES constant; the
 * column count follows the plan count. All narrowing / price-by-cycle / CTA-kind derivation
 * lives in the pure, unit-tested sub-rows.ts (G3).
 *
 * Honest divergences (reported, never fabricated — Phase-6 B-179 minimal wire):
 *   - NO current-plan marking: there is no active-subscription read, so no card is disabled
 *     as the current plan; every card shows a change CTA (contact / downgrade / upgrade).
 *   - plan-change CTA is REAL (W1c): the confirm modal's confirm button fires POST
 *     /subscription/change-plan {package_id, cycle} (money = SERVER, NO proration — B-191) and
 *     invalidates the /me read; the Enterprise (price==null) card stays a toast-only no-POST.
 *   - signup button is honest-DISABLED: the signup action had a window.openSignup global with
 *     no backend; it must not POST, so it is a disabled button.
 *   - wire gaps: planWire carries no `tagline` (em-dash), no `modLabel` (em-dash), no
 *     `color` (reconstructed from size, B-037(a)), and no `popular` flag (the popular badge
 *     + 2px brand border are dropped). Flagged as a data-completeness follow-up.
 *   - money: the price is rendered verbatim from the server via formatMoney (never
 *     recomputed); the baht unit is the prototype's static UI text.
 *
 * i18n (rule 2): every visible string is a sub.plans.* / sub.common.* dict key (t). No Thai
 * literal lives in source (B-073); tokens back every colour (rule 6) except the prototype-
 * verbatim plan hexes reconstructed from size + `#fff` on the brand-toggle (B-037(a)).
 * Numeric cells carry class `num` (rule 7).
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toPlanRow,
  sizeColor,
  priceForCycle,
  isUnlimited,
  planCtaKind,
  formatMoney,
  type PlanRow,
} from "./sub-rows";
import { fireWithToast } from "../admin/admin-rows";
import { useChangePlan, useSubscriptionPlans } from "./use-subscription";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** White literal on the active brand toggle pill (prototype-verbatim, no token — B-037(a)). */
const WHITE = "#fff";

type Cycle = "monthly" | "yearly";

/** A single row in a plan card's feature list. */
function FeatureRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12 }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="num" style={{ fontWeight: 700 }}>
        {value}
      </span>
    </div>
  );
}

export function SubPlans() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const [cycle, setCycle] = useState<Cycle>("yearly");
  const plansQ = useSubscriptionPlans();
  const changePlan = useChangePlan();
  const plans = useMemo<PlanRow[]>(() => (plansQ.data ?? []).map(toPlanRow), [plansQ.data]);

  /** Quota display: an unlimited value -> the shared "unlimited" key, else grouped digits. */
  const limitLabel = (v: number): string => (isUnlimited(v) ? t("sub.common.unlimited") : formatMoney(v));
  /** The per-cycle unit suffix (baht-per + year|month). */
  const perUnit = (): string => t("sub.plans.bahtPer") + (cycle === "yearly" ? t("sub.plans.perYear") : t("sub.plans.perMonth"));

  /** Open the plan-change confirm modal -- its confirm fires a faithful toast (NO mutation). */
  const openChange = (p: PlanRow) => {
    const price = priceForCycle(p, cycle);
    ctx.openModal({
      title: `${t("sub.plans.changeToPrefix")} ${p.name}`,
      subtitle: price == null ? t("sub.plans.modalSubtitleContact") : `${formatMoney(price)} ${perUnit()}`,
      // arrowU (the prototype's upgrade glyph) is absent from the app icon set -> trend.
      icon: "trend",
      iconTone: sizeColor(p.size),
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 16 }}>
            {t("sub.plans.modalBodyPrefix")}
            <b>{p.name}</b>
            {t("sub.plans.modalBodySuffix")}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("sub.common.cancel")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="check"
              onClick={() => {
                close();
                // Enterprise (price==null) stays a toast-only no-POST (no priced plan to change to).
                if (price == null) {
                  ctx.notify(t("sub.plans.toastEnterprise"));
                  return;
                }
                // The modal unmounts on close() before the POST settles, so the toast fires off the
                // settled promise (fireWithToast). Body = {package_id, cycle} (cycle captured at
                // modal-open); money = SERVER (NO client price, NO proration — B-191). The rejection
                // path shows the error toast, not a swallowed catch.
                fireWithToast(
                  () => changePlan.mutateAsync({ package_id: p.id, cycle }),
                  () => ctx.notify(`${t("sub.plans.changeToPrefix")} ${p.name} ${t("sub.plans.toastChangedSuffix")}`),
                  () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                );
              }}
            >
              {t("sub.common.confirm")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  /** The CTA label for a plan card (contact / downgrade / upgrade — no current-plan mark). */
  const ctaLabel = (p: PlanRow): string => {
    switch (planCtaKind(p, cycle)) {
      case "contact":
        return t("sub.plans.contactSales");
      case "downgrade":
        return t("sub.plans.downgradeBtn");
      default:
        return t("sub.plans.upgradeBtn");
    }
  };

  const gridCols = `repeat(${Math.max(1, plans.length)}, 1fr)`;

  const toggle: readonly { v: Cycle; label: string }[] = [
    { v: "monthly", label: t("sub.plans.cycleMonthly") },
    { v: "yearly", label: t("sub.plans.cycleYearly") },
  ];

  return (
    <Page
      breadcrumbs={[t("sub.common.crumbAccount"), t("sub.plans.crumb")]}
      title={t("sub.plans.title")}
      subtitle={t("sub.plans.subtitle")}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* monthly|yearly cycle toggle — pure client state (no server call). */}
          <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
            {toggle.map((tg) => {
              const on = cycle === tg.v;
              return (
                <button
                  key={tg.v}
                  type="button"
                  onClick={() => setCycle(tg.v)}
                  style={{
                    padding: "7px 13px",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    background: on ? "var(--brand)" : "transparent",
                    color: on ? WHITE : "var(--text-2)",
                  }}
                >
                  {tg.label}
                </button>
              );
            })}
          </div>
          {/* Honest-DISABLED: window.openSignup has no Phase-6 backend (must not POST). */}
          <Btn kind="primary" size="md" icon="tag" disabled>
            {t("sub.plans.signupBtn")}
          </Btn>
        </div>
      }
    >
      {plansQ.isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {[0, 1, 2, 3].map((n) => (
            <div
              key={n}
              style={{ height: 320, borderRadius: "var(--r-lg)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card pad={40} style={{ textAlign: "center" }}>
          <Icon name="tag" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 16 }}>
          {plans.map((p) => {
            const price = priceForCycle(p, cycle);
            const accent = sizeColor(p.size);
            return (
              <Card key={p.id} pad={0} style={{ overflow: "hidden", position: "relative" }}>
                <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: accent }} />
                    <span style={{ fontSize: 17, fontWeight: 800 }}>{p.name}</span>
                  </div>
                  {/* tagline — NO wire field (em-dash, data-completeness follow-up). */}
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{DASH}</div>
                  <div style={{ marginTop: 14, minHeight: 44 }}>
                    {price == null ? (
                      <div style={{ fontSize: 19, fontWeight: 800 }}>{t("sub.plans.contactSales")}</div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                        <span className="num" style={{ fontSize: 28, fontWeight: 800 }}>
                          {formatMoney(price)}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{perUnit()}</span>
                      </div>
                    )}
                  </div>
                  <Btn
                    kind="outline"
                    size="md"
                    style={{ width: "100%", marginTop: 6, justifyContent: "center" }}
                    onClick={() => openChange(p)}
                  >
                    {ctaLabel(p)}
                  </Btn>
                </div>
                <div style={{ padding: 18 }}>
                  <FeatureRow label={t("sub.plans.featProjects")} value={limitLabel(p.projects)} />
                  <FeatureRow label={t("sub.plans.featUsers")} value={limitLabel(p.users)} />
                  <FeatureRow
                    label={t("sub.plans.featStorage")}
                    value={`${limitLabel(p.storageGb)} ${t("sub.plans.unitGb")}`}
                  />
                  <FeatureRow
                    label={t("sub.plans.featAi")}
                    value={isUnlimited(p.aiPerMonth) ? t("sub.common.unlimited") : `${p.aiPerMonth} ${t("sub.plans.unitAiPerMonth")}`}
                  />
                  {/* modLabel — NO wire field (em-dash, data-completeness follow-up). */}
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid var(--border)",
                      fontSize: 11.5,
                      color: "var(--text-2)",
                      lineHeight: 1.6,
                    }}
                  >
                    {DASH}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
