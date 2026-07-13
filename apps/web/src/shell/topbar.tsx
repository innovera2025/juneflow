/*
 * TopBar — ported from pototype/chrome.jsx TopBar (852-889).
 *
 * Per the prototype architecture the topbar is NOT owned by the shell host — it is
 * rendered per-screen by the Page primitive (ds.jsx Page 284-287). This port keeps
 * that: Page (page.tsx) mounts <TopBar/>. Order: [CompanySwitcher] · ProjectSwitcher ·
 * breadcrumbs · spacer · LanguageSwitcher · Notifications · {actions} · SearchPalette.
 *
 * CompanySwitcher is OMITTED: the prototype's COMPANIES are a hardcoded mock (§0 rule 3)
 * and GET /me has no company entity and there is no /companies list endpoint in the
 * SACRED openapi.yaml — so no compliant data source exists (BLOCKERS B-039). Breadcrumbs
 * are nav keys resolved with tn(), chevron direction-aware for RTL.
 */
import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import { asNavKey } from "./nav-tree";
import { ProjectSwitcher } from "./project-switcher";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationsPopover } from "./notifications";
import { SearchPalette } from "./search-palette";

export interface TopBarProps {
  /** Nav-key breadcrumbs (tn-resolved), last is the current page. */
  breadcrumbs?: string[];
  actions?: ReactNode;
  projectSwitch?: boolean;
}

export function TopBar({ breadcrumbs = [], actions, projectSwitch = true }: TopBarProps) {
  const { tn, dir } = useI18n();
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
      {projectSwitch && <ProjectSwitcher />}

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
                {tn(asNavKey(b))}
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
