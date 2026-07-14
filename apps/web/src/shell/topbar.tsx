/*
 * TopBar — ported from pototype/chrome.jsx TopBar (852-889).
 *
 * Per the prototype architecture the topbar is NOT owned by the shell host — it is
 * rendered per-screen by the Page primitive (ds.jsx Page 284-287). This port keeps
 * that: Page (page.tsx) mounts <TopBar/>. Order: CompanySwitcher · ProjectSwitcher ·
 * breadcrumbs · spacer · LanguageSwitcher · Notifications · {actions} · SearchPalette
 * (chrome.jsx:862 `<CompanySwitcher /><ProjectSwitcher />`).
 *
 * CompanySwitcher is now wired (B-041): it renders the affiliated group
 * companies from GET /companies (company-accept.jsx:24-104). Breadcrumbs are
 * PRE-RESOLVED display nodes (matching ds.jsx Page, which takes display strings):
 * the caller resolves each crumb with the right layer — e.g. master.company mixes a
 * dict crumb t("master.breadcrumb") with a nav crumb tn("Company / Org"), which a
 * single-layer NavKey[] could not express. Chevron is direction-aware for RTL.
 */
import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import { CompanySwitcher } from "./company-switcher";
import { ProjectSwitcher } from "./project-switcher";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationsPopover } from "./notifications";
import { SearchPalette } from "./search-palette";

export interface TopBarProps {
  /** Pre-resolved breadcrumb nodes (caller applies t()/tn()), last is the current page. */
  breadcrumbs?: ReactNode[];
  actions?: ReactNode;
  projectSwitch?: boolean;
}

export function TopBar({ breadcrumbs = [], actions, projectSwitch = true }: TopBarProps) {
  const { dir } = useI18n();
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 16,
      }}
    >
      {projectSwitch && (
        <>
          <CompanySwitcher />
          <ProjectSwitcher />
        </>
      )}

      {breadcrumbs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-2)" }}>
          {breadcrumbs.map((b, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <Icon name={dir === "rtl" ? "chevL" : "chevR"} size={12} color="var(--text-3)" />}
              <span
                style={{
                  fontWeight: i === breadcrumbs.length - 1 ? 600 : 500,
                  color: i === breadcrumbs.length - 1 ? "var(--text)" : "var(--text-2)",
                }}
              >
                {b}
              </span>
            </span>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <LanguageSwitcher />
      <NotificationsPopover />
      {actions}
      <SearchPalette />
    </header>
  );
}
