/*
 * AppShell — the root layout, ported from pototype/shell.jsx AppShell (28-209).
 *
 * Rendered as the TanStack Router root component (inside ShellProvider). Mirrors
 * shell.jsx exactly:
 *  - route "login" returns EARLY, full-bleed, with NO sidebar/topbar but the shared
 *    modal + toast hosts still mounted (shell.jsx:106-119). Login owns its own
 *    login-local hosts; the shared hosts read ctx (empty there) so nothing doubles.
 *  - otherwise: flex row = Sidebar (244px) + content column (optional back-nav strip
 *    + the routed screen via <Outlet/>), plus the floating Tweaks gear + shared
 *    modal/toast hosts (shell.jsx:121-207).
 *
 * The routed screen (Outlet) is the per-route content — Placeholder(→Page→TopBar) for
 * every not-yet-ported route, so the topbar appears per-page exactly as ds.jsx Page does.
 */
import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import { useShellCtx } from "./shell-context";
import { Sidebar } from "./sidebar";
import { ModalHost } from "./modal-host";
import { ToastHost } from "./toast-host";
import { TweaksPopover } from "./tweaks-popover";

export function AppShell() {
  const ctx = useShellCtx();
  const { t, dir } = useI18n();
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Standalone login branch (shell.jsx:106-119) — full-bleed, hosts still mounted.
  if (ctx.route === "login") {
    return (
      <>
        <Outlet />
        <ModalHost />
        <ToastHost />
      </>
    );
  }

  const showBackNav = ctx.history.length > 0 || Boolean(ctx.params.ref);
  const fromBoq = ctx.params.fromBoq as string | undefined;
  const ref = ctx.params.ref as string | undefined;

  return (
    <div dir={dir} style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {showBackNav && (
          <div
            style={{
              padding: "8px 24px",
              background: "var(--brand-soft)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 12,
            }}
          >
            <button
              onClick={ctx.back}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 6,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--brand)",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Icon name="chevL" size={12} />
              {t("common.back")}
            </button>
            {fromBoq && (
              <span style={{ color: "var(--text-2)" }}>
                BOQ <b className="num" style={{ color: "var(--brand)" }}>{fromBoq}</b>
              </span>
            )}
            {ref && (
              <span style={{ color: "var(--text-2)" }}>
                <b className="num" style={{ color: "var(--brand)" }}>{ref}</b>
              </span>
            )}
            <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>
              {t("common.navHistory")} · {ctx.history.length}
            </span>
          </div>
        )}
        <Outlet />
      </div>

      {/* Floating Tweaks toggle (shell.jsx:160-178). */}
      <button
        onClick={() => setTweaksOpen((o) => !o)}
        title={t("common.theme")}
        style={{
          position: "fixed",
          top: 12,
          right: 16,
          zIndex: 90,
          width: 36,
          height: 36,
          borderRadius: 999,
          background: tweaksOpen ? "var(--brand)" : "var(--surface)",
          color: tweaksOpen ? "#fff" : "var(--text-2)",
          border: "1px solid var(--border)",
          boxShadow: "0 2px 8px rgba(15,23,42,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Icon name="settings" size={16} />
      </button>
      {tweaksOpen && <TweaksPopover onClose={() => setTweaksOpen(false)} />}

      <ModalHost />
      <ToastHost />
    </div>
  );
}
