/*
 * AdminPlans — the Platform-owner package-management screen (route admin.plans), ported from
 * pototype/subscription-admin.jsx AdminPlans (L179-190) + pkg-builder.jsx PkgAdminGrid
 * (L187-230). Registry section "platform" (owner-gated; the backend 403s non-owners ->
 * graceful skeleton/empty here).
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / subtitle + a primary
 * create-package action, and the 4-column package-card grid (size badge + name + price line +
 * 3 quota rows + a "menus released n/total" progress bar with up to 5 nav-label chips + a
 * subscriber-count footer + an edit button) are the prototype's.
 *
 * Data (rules 3/4): two TanStack Query reads via the generated client — useAdminPackages
 * (GET /admin/packages) for the cards + useAdminSubscribers (GET /admin/subscribers) for the
 * per-package subscriber count (DERIVED: count where package_id matches && status!=='cancelled',
 * subscriberCountByPackage in admin-rows.ts). The menu-tree denominator + the chip labels are
 * NAV-registry data (nav-tree.ts top-level items), NOT screen i18n keys — never minted.
 *
 * W1b (B-197): Create/Edit are REAL owner-gated writes — the create-package primary + the
 * per-card edit ghost both open the builder modal (openPkgBuilder, admin-pkg-builder.tsx).
 * money = SERVER: the builder sends price_m only, the door derives price_y, and the card shows
 * the server price_y — never a client yearly. NO delete affordance (B-196). The "popular" badge
 * renders from the real `popular` column (0045). `color` is still reconstructed from size on the
 * card (B-037(a)); a plan that carries its own color round-trips it through an edit.
 *   - Enterprise `menus` is the ["*"] wildcard -> expanded to the full nav id list so the
 *     n/total + first-5 chips match the prototype's Full-shows-all behaviour (expandMenus).
 *
 * i18n (rule 2): every visible string is an admin.plans.* / admin.common.* dict key (t) or a
 * NAV label (tn) for a menu chip. No Thai literal in source (B-073); the ∞ unlimited glyph
 * uses the admin.common.infinity key. Tokens back every colour except the prototype-verbatim
 * plan hexes reconstructed from size + `white` on the badge color-mix (B-037(a)). Numeric
 * cells carry class `num`.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { NAV_TREE, type NavItem } from "../../shell/nav-tree";
import {
  toPackageRow,
  toSubscriberRow,
  subscriberCountByPackage,
  expandMenus,
  sizeColor,
  isUnlimited,
  formatMoney,
  type PackageRow,
} from "./admin-rows";
import { useAdminPackages, useAdminSubscribers } from "./use-admin";
import { openPkgBuilder } from "./admin-pkg-builder";

/** Middot separator (U+00B7, non-Thai) — matches the prototype's price line. */
const MIDDOT = "·";
/** White literal on the size-badge color-mix (prototype-verbatim, no token — B-037(a)). */
const WHITE = "white";
/** How many nav-label chips a card shows before the "+N" overflow (pkg-builder L219). */
const CHIP_LIMIT = 5;

/** Tag, ported 1:1 from ds.jsx Tag() — the "popular" badge. color-mix + white are verbatim. */
function Tag({ children, tone = "var(--text-2)" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, ${WHITE})`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function AdminPlans() {
  const { t, tn } = useI18n();
  const ctx = useShellCtx();

  const packagesQ = useAdminPackages();
  const subscribersQ = useAdminSubscribers();

  const packages = useMemo<PackageRow[]>(() => (packagesQ.data ?? []).map(toPackageRow), [packagesQ.data]);
  const subsCountByPkg = useMemo(
    () => subscriberCountByPackage((subscribersQ.data ?? []).map(toSubscriberRow)),
    [subscribersQ.data],
  );

  // NAV top-level items (pkg-builder pkgNavGroups items) drive the menus denominator + chip
  // labels. This is NAV-registry data (tn labels), never minted screen keys.
  const navItems = useMemo(() => NAV_TREE.filter((n): n is NavItem => n.kind === "item"), []);
  const total = navItems.length;
  const allNavIds = useMemo(() => navItems.map((n) => n.id), [navItems]);
  const labelById = useMemo(() => new Map(navItems.map((n) => [n.id, n.label] as const)), [navItems]);
  const labelOf = (id: string): string => {
    const key = labelById.get(id);
    return key ? tn(key) : id;
  };

  /** Unlimited quota -> the ∞ glyph key, else the raw integer (pkg-builder L209-210). */
  const infOr = (v: number): string => (isUnlimited(v) ? t("admin.common.infinity") : String(v));

  /** The monthly · yearly price line, or the contact-sales label when there is no price. */
  const priceLine = (p: PackageRow): string => {
    if (p.priceM == null) return t("admin.plans.priceContact");
    const y = p.priceY == null ? "" : ` ${MIDDOT} ${formatMoney(p.priceY)} ${t("admin.plans.priceYearUnit")}`;
    return `${formatMoney(p.priceM)} ${t("admin.plans.priceMonthUnit")}${y}`;
  };

  return (
    <Page
      breadcrumbs={[t("admin.common.crumbPlatform"), t("admin.plans.crumb")]}
      title={t("admin.plans.title")}
      subtitle={t("admin.plans.subtitle")}
      actions={
        // W1b: open the builder modal for a new plan (POST /admin/packages, money=SERVER).
        <Btn kind="primary" size="md" icon="plus" onClick={() => openPkgBuilder(ctx, null)}>
          {t("admin.plans.createBtn")}
        </Btn>
      }
    >
      {packagesQ.isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {[0, 1, 2, 3].map((n) => (
            <div
              key={n}
              style={{ height: 300, borderRadius: "var(--r-lg)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <Card pad={40} style={{ textAlign: "center" }}>
          <Icon name="grid" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {packages.map((p) => {
            const color = sizeColor(p.size);
            const released = expandMenus(p.menus, allNavIds);
            const subsCount = subsCountByPkg.get(p.id) ?? 0;
            const pct = total > 0 ? Math.min(100, (released.length / total) * 100) : 0;
            return (
              <Card key={p.id} pad={0} style={{ overflow: "hidden", borderTop: `3px solid ${color}` }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        className="num"
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          background: `color-mix(in srgb, ${color} 14%, ${WHITE})`,
                          color,
                          fontWeight: 800,
                          fontSize: 12.5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {p.size}
                      </span>
                      <span style={{ fontSize: 14.5, fontWeight: 800 }}>{p.name}</span>
                      {/* popular badge — REAL `popular` column (0045), rendered like pkg-builder L202. */}
                      {p.popular && <Tag tone="var(--brand)">{t("admin.plans.popularTag")}</Tag>}
                    </span>
                    {/* W1b: open the builder modal to edit this plan (PUT /admin/packages/{id}). */}
                    <Btn kind="ghost" size="sm" icon="edit" onClick={() => openPkgBuilder(ctx, p)}>
                      {t("admin.plans.editBtn")}
                    </Btn>
                  </div>
                  <div className="num" style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6 }}>
                    {priceLine(p)}
                  </div>
                </div>
                <div style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                    <span style={{ color: "var(--text-3)" }}>{t("admin.plans.limitProjectsUsers")}</span>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {infOr(p.projects)} / {infOr(p.users)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                    <span style={{ color: "var(--text-3)" }}>{t("admin.plans.limitStorage")}</span>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {infOr(p.storageGb)} {t("admin.plans.storageUnit")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                    <span style={{ color: "var(--text-3)" }}>{t("admin.plans.limitAi")}</span>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {isUnlimited(p.aiPerMonth) ? t("admin.plans.unlimited") : `${p.aiPerMonth}${t("admin.plans.perMonthUnit")}`}
                    </span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 5 }}>
                      <span style={{ fontWeight: 700, color: "var(--text-2)" }}>{t("admin.plans.menusReleased")}</span>
                      <span className="num" style={{ fontWeight: 800, color }}>
                        {released.length}/{total}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 99 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99 }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                      {released.slice(0, CHIP_LIMIT).map((id) => (
                        <span
                          key={id}
                          style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-2)" }}
                        >
                          {labelOf(id)}
                        </span>
                      ))}
                      {released.length > CHIP_LIMIT && (
                        <span
                          className="num"
                          style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-3)" }}
                        >
                          +{released.length - CHIP_LIMIT}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)" }}>
                    {t("admin.plans.subscribersLabel")}{" "}
                    <b className="num" style={{ color: "var(--text)" }}>
                      {subsCount}
                    </b>{" "}
                    {t("admin.plans.subscribersUnit")}
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
