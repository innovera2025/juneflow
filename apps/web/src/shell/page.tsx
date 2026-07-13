/*
 * Page + Placeholder — ported from pototype/ds.jsx Page (284-297) + shell.jsx
 * Placeholder (327-338).
 *
 * Page is the per-screen shell: TopBar (owns the company/project/lang/search chrome)
 * + an optional title/subtitle header + the screen body. RouteView renders Placeholder
 * for every not-yet-ported route (all of them in P0-WEB-05 except login), so the topbar
 * appears on every route exactly as the prototype's Page does. The Placeholder title is
 * the route's nav label (tn); routes without a sidebar label show the raw route id.
 */
import type { ReactNode } from "react";
import { Card } from "../ui/card";
import { Btn } from "../ui/button";
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import { TopBar, type TopBarProps } from "./topbar";
import { useShellCtx } from "./shell-context";
import { useChromeText } from "./chrome-i18n";
import { navLabelForRoute } from "./nav-tree";

export interface PageProps extends TopBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}

export function Page({ title, subtitle, actions, breadcrumbs, children }: PageProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar breadcrumbs={breadcrumbs} actions={actions} />
      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-page)" }}>
        {(title || subtitle) && (
          <div style={{ marginBottom: 24 }}>
            {title && (
              <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", color: "var(--text)" }}>{title}</h1>
            )}
            {subtitle && <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Not-yet-ported route scaffold (shell.jsx Placeholder). */
export function Placeholder({ routeId }: { routeId: string }) {
  const ctx = useShellCtx();
  const { tn } = useI18n();
  const ct = useChromeText();
  const labelKey = navLabelForRoute(routeId);
  const title = labelKey ? tn(labelKey) : routeId;
  return (
    <Page title={title}>
      <Card pad={40} style={{ textAlign: "center" }}>
        <Icon name="info" size={32} color="var(--text-3)" />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--text-2)" }}>{ct("phDeveloping")}</div>
        <div style={{ marginTop: 14 }}>
          <Btn kind="primary" size="md" icon="dashboard" onClick={() => ctx.navigate("dashboard")}>
            {ct("phBackDashboard")}
          </Btn>
        </div>
      </Card>
    </Page>
  );
}
