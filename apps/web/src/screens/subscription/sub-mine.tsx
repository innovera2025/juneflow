/*
 * SubMine — the tenant "My Subscription" screen (route sub.mine), ported from
 * pototype/subscription.jsx SubMine (L41-129). Registry section "usage".
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / subtitle, the two header
 * actions (bill history + upgrade), and the 2-column grid (1fr 1.4fr) of a LEFT current-
 * package card (gradient hero + 4 detail rows + a days-left warn strip + renew/cancel
 * buttons) and a RIGHT usage/quota card (header + 4 metered quota rows + a modules footer)
 * are the prototype's, 1:1.
 *
 * Data (rules 3/4): a single TanStack Query read via the generated client —
 * useSubscriptionMe (GET /subscription/me, a SINGLE object, not a list). All narrowing /
 * days-left / quota-percent / status-badge derivation lives in the pure, unit-tested
 * sub-rows.ts (G3); this screen stays declarative. The package block reuses toPlanRow (the
 * /me handler enriches me.package with the SAME planWire row /subscription/plans returns).
 *
 * Honest divergences (reported, never fabricated — Phase-6 minimal wire):
 *   - tagline + modLabel: NO wire field -> em-dash (a data-completeness follow-up, exactly
 *     like sub.plans). The prototype's per-package tagline/modLabel are not on planWire.
 *   - usage: projects/users are LIVE server counts (will differ from the prototype mock
 *     7/12); storage is an honest 0 (no byte-accounting yet) and ai is the real credits used
 *     — NOT the prototype's mock 24/18. The server values render faithfully (seed reality).
 *   - usageUpdatedAt: the fixed sub.mine.usageUpdatedAt key renders verbatim (the prototype's
 *     static "last updated today HH:MM" label); NO live now() is computed.
 *   - PkgDemoSwitcher (prototype L60): a pure demo mock (no i18n key) -> dropped entirely.
 *   - renew: REAL (W1c) -> POST /subscription/renew (no body) invalidates the /me read; renew is
 *     NOT idempotent, so the button is disabled-while-pending (a double-click would double-advance
 *     the paid-through date). cancel stays MOCK -> a faithful ctx.notify toast (no cancel
 *     mutation). The upgrade + bill-history header actions navigate.
 *   - money: the yearly price renders verbatim from the server via formatMoney (never
 *     recomputed); the baht/year suffix is the prototype's static keyed UI text.
 *   - billing cycle: the yearly cycle shows the sub.mine.valYearly key; any other cycle code
 *     renders raw (wire-reality) — no non-yearly cycle key exists in this namespace.
 *   - icon: the prototype's header "arrowU" glyph is absent from the app icon set -> "trend"
 *     (the codebase's upgrade glyph, same substitution sub.plans made).
 *
 * i18n (rule 2): every visible string is a sub.mine.* / sub.common.* dict key (t). No Thai
 * literal lives in source (B-073); tokens back every colour (rule 6) except the prototype-
 * verbatim gradient hex (reconstructed from size, B-037(a)), the #fff hero text + #000
 * gradient mix, and the StatusBadge dot hexes (B-037(a), matching sub-billing). Numeric cells
 * (price, days-left, quota used/cap) carry class `num` (rule 7).
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toSubscriptionMe,
  sizeColor,
  formatMoney,
  formatDate,
  isUnlimited,
  usagePct,
  usagePctTone,
  daysLeft,
  subStatusBadge,
  type SubscriptionMe,
  type BadgeTone,
} from "./sub-rows";
import { fireWithToast } from "../admin/admin-rows";
import { useRenewSubscription, useSubscriptionMe } from "./use-subscription";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** White hero text (prototype-verbatim, no token — B-037(a)). */
const WHITE = "#fff";

/** ds.jsx STATUS tone tokens for a badge tone (mirrors sub-billing statusTone). */
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

/** Map a usage tone discriminant to its CSS var (subscription.jsx pctTone returned these). */
function toneVar(kind: "danger" | "warn" | "ok"): string {
  return kind === "danger" ? "var(--danger)" : kind === "warn" ? "var(--warn)" : "var(--ok)";
}

/** One label/value detail row in the LEFT card (subscription.jsx L77-79). */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/** A single metered quota row in the RIGHT card (subscription.jsx L102-114). */
interface QuotaRow {
  key: string;
  label: string;
  unit: string;
  icon: IconName;
  used: number;
  /** The package cap (-1 = unlimited); null when the package is unknown. */
  cap: number | null;
}

/** The 2-card body for a resolved subscription (me is non-null here). */
function MineBody({ me }: { me: SubscriptionMe }) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const renew = useRenewSubscription();

  const pkg = me.package;
  const accent = sizeColor(pkg ? pkg.size : "");
  const pkgName = pkg ? pkg.name : DASH;
  const priceText = pkg && pkg.priceY != null ? formatMoney(pkg.priceY) : DASH;

  const badge = subStatusBadge(me.status);
  const statusLabel = badge.labelKind === "active" ? t("sub.mine.statusActive") : me.status;

  // The prototype hardcoded the yearly label; the yearly cycle shows the keyed valYearly, any
  // other cycle code renders raw (wire-reality) — this namespace has no non-yearly cycle key.
  const cycleLabel = me.cycle === "yearly" ? t("sub.mine.valYearly") : me.cycle || DASH;

  const detailRows: { label: string; value: ReactNode }[] = [
    { label: t("sub.mine.rowBillingCycle"), value: cycleLabel },
    { label: t("sub.mine.rowContractStart"), value: formatDate(me.startedAt) || DASH },
    { label: t("sub.mine.rowNextRenew"), value: formatDate(me.renewAt) || DASH },
    { label: t("sub.mine.rowPaymentMethod"), value: t("sub.mine.valPaymentMethod") },
  ];

  // Days-left warn strip: split the keyed sentence around {daysLeft} and bold the count.
  const dl = daysLeft(me.renewAt, new Date());
  const daysParts = t("sub.mine.daysLeftBeforeRenew").split("{daysLeft}");

  const quotaRows: QuotaRow[] = [
    { key: "projects", label: t("sub.mine.rowProjects"), unit: t("sub.mine.unitProjects"), icon: "grid", used: me.usage.projects, cap: pkg ? pkg.projects : null },
    { key: "users", label: t("sub.mine.rowUsers"), unit: t("sub.mine.unitUsers"), icon: "users", used: me.usage.users, cap: pkg ? pkg.users : null },
    { key: "storage", label: t("sub.mine.rowStorage"), unit: t("sub.mine.unitStorage"), icon: "box", used: me.usage.storage, cap: pkg ? pkg.storageGb : null },
    { key: "ai", label: t("sub.mine.rowAi"), unit: t("sub.mine.unitAi"), icon: "pie", used: me.usage.ai, cap: pkg ? pkg.aiPerMonth : null },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
      {/* LEFT — current package card */}
      <Card pad={0} style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "18px 20px",
            background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #000))`,
            color: WHITE,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                opacity: 0.85,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {t("sub.mine.currentPkgLabel")}
            </span>
            <StatusBadge tone={badge.tone} label={statusLabel} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{pkgName}</div>
          {/* tagline — NO wire field (em-dash, data-completeness follow-up). */}
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{DASH}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 14 }}>
            <span className="num" style={{ fontSize: 24, fontWeight: 800 }}>
              {priceText}
            </span>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{t("sub.mine.priceYearlySuffix")}</span>
          </div>
        </div>
        <div style={{ padding: 18 }}>
          {detailRows.map((r) => (
            <DetailRow key={r.label} label={r.label} value={r.value} />
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 12,
              padding: "10px 12px",
              background: "var(--warn-soft)",
              borderRadius: 9,
              fontSize: 11.5,
              color: "var(--warn)",
            }}
          >
            <Icon name="clock" size={15} />
            <span>
              {daysParts[0]}
              <b className="num">{dl == null ? DASH : String(dl)}</b>
              {daysParts[1] ?? ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Btn
              kind="outline"
              size="md"
              style={{ flex: 1 }}
              // renew is NOT idempotent (each POST advances renew_at one cycle, no server dedup),
              // so disabled-while-pending guards a double-click double-advance of the paid-through
              // date. The toast off the settled promise; the new date surfaces via the SUB_ME
              // re-read (rowNextRenew), NOT the static toast. The rejection path shows the error toast.
              disabled={renew.isPending}
              onClick={() =>
                fireWithToast(
                  () => renew.mutateAsync(),
                  () => ctx.notify(t("sub.mine.toastRenew")),
                  () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                )
              }
            >
              {t("sub.mine.btnRenew")}
            </Btn>
            <Btn kind="ghost" size="md" onClick={() => ctx.notify(t("sub.mine.toastCancel"))}>
              {t("sub.mine.btnCancel")}
            </Btn>
          </div>
        </div>
      </Card>

      {/* RIGHT — usage / quota card */}
      <Card pad={0}>
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t("sub.mine.usageHeader")}</div>
          {/* usageUpdatedAt — the prototype's fixed static label, rendered verbatim (no live now()). */}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("sub.mine.usageUpdatedAt")}</span>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          {quotaRows.map((r) => {
            const cap = r.cap;
            const unlimited = cap != null && isUnlimited(cap);
            const pct = cap == null ? 0 : usagePct(r.used, cap);
            const tone = toneVar(cap == null || unlimited ? "ok" : usagePctTone(pct));
            const capLabel = cap == null ? DASH : unlimited ? t("sub.common.unlimited") : formatMoney(cap);
            const showWarn = cap != null && !unlimited && pct >= 75;
            const warnText = `${t("sub.mine.usageUsedPct").replace("{pct}", String(pct))} ${t("sub.common.dotSep")} ${
              pct >= 90 ? t("sub.mine.usageWarnNearFull") : t("sub.mine.usageWarnCaution")
            }`;
            return (
              <div key={r.key}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: "var(--surface-2)",
                      color: "var(--brand)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={r.icon} size={15} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{r.label}</span>
                  <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>
                    {formatMoney(r.used)}
                  </span>
                  <span className="num" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                    / {capLabel} {r.unit}
                  </span>
                </div>
                <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tone, borderRadius: 999 }} />
                </div>
                {showWarn && (
                  <div style={{ fontSize: 10.5, color: tone, marginTop: 4, fontWeight: 600 }}>{warnText}</div>
                )}
              </div>
            );
          })}
          <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
              {t("sub.mine.modulesHeader")}
            </div>
            {/* modLabel — NO wire field (em-dash, data-completeness follow-up). */}
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>{DASH}</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
                padding: "10px 12px",
                background: "var(--brand-soft)",
                borderRadius: 9,
                fontSize: 11.5,
                color: "var(--brand-ink)",
              }}
            >
              <Icon name="info" size={15} />
              <span>{t("sub.mine.upgradeInfoLine")}</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** A 2-card grid skeleton matching the resolved layout (loading state, rule 6). */
function MineSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
      {[0, 1].map((n) => (
        <div
          key={n}
          style={{ height: 360, borderRadius: "var(--r-lg)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
        />
      ))}
    </div>
  );
}

export function SubMine() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const meQ = useSubscriptionMe();
  const me = useMemo<SubscriptionMe | null>(() => (meQ.data ? toSubscriptionMe(meQ.data) : null), [meQ.data]);

  const actions: ReactNode = (
    <>
      <Btn kind="outline" size="md" icon="doc" onClick={() => ctx.navigate("sub.billing")}>
        {t("sub.mine.actionBillHistory")}
      </Btn>
      {/* arrowU is absent from the app icon set -> trend (the upgrade glyph, as sub.plans). */}
      <Btn kind="primary" size="md" icon="trend" onClick={() => ctx.navigate("sub.plans")}>
        {t("sub.mine.actionUpgrade")}
      </Btn>
    </>
  );

  return (
    <Page
      breadcrumbs={[t("sub.mine.breadcrumbAccount"), t("sub.mine.breadcrumbMyPkg")]}
      title={t("sub.mine.title")}
      subtitle={t("sub.mine.subtitle")}
      actions={actions}
    >
      {meQ.isLoading ? (
        <MineSkeleton />
      ) : me == null ? (
        // Graceful empty state — no subscription (404) or unresolved. Icon-only, no minted copy.
        <Card pad={40} style={{ textAlign: "center" }}>
          <Icon name="box" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
        </Card>
      ) : (
        <MineBody me={me} />
      )}
    </Page>
  );
}
