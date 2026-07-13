/*
 * ProjectSwitcher — ported from pototype/chrome.jsx ProjectSwitcher (452-601).
 *
 * DATA GAP (scout BLOCKER candidate, BLOCKERS B-039): the prototype renders a
 * short-code color chip, phase list, per-phase units & sold%. GET /projects (SACRED
 * contract) returns ONLY {id,name,type,budget,currency_code,status} — no short,
 * color, phases, units or sold%. Inventing them is forbidden (§0), so this switcher
 * renders faithfully with the fields that exist: TypeBadge (from `type`) + name +
 * status, and selects a project id (no phase). Popover copy comes from chrome-strings.
 *
 * On select, if the current route's module is off for the new project's type, we
 * redirect to dashboard first (shell.jsx setTweak project special-case, 91-96).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icon";
import { Btn } from "../ui/button";
import { useShellCtx } from "./shell-context";
import { useProjects, resolveActiveProject } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";
import { TypeBadge } from "./type-badge";
import { routeAllowedForType } from "./project-types";

export function ProjectSwitcher() {
  const ctx = useShellCtx();
  const ct = useChromeText();
  const projectsQ = useProjects();
  const projects = projectsQ.data ?? [];
  const active = resolveActiveProject(projects, ctx.tweaks.project);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
      setQ("");
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", onMouse), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [open]);

  const select = (id: string, type: string) => {
    if (!routeAllowedForType(ctx.route, type)) ctx.navigate("dashboard");
    ctx.setTweak("project", id);
    setOpen(false);
  };

  const filtered = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  const popover = open ? (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 2500,
        width: 360,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.22), 0 4px 12px -4px rgba(15,23,42,0.10)",
        color: "var(--text)",
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{ct("projPickTitle")}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 30,
            padding: "0 10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <Icon name="search" size={13} color="var(--text-3)" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ct("projSearch")}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12.5, color: "var(--text)" }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
        {filtered.map((p) => {
          const isCur = active?.id === p.id;
          return (
            <div
              key={p.id}
              onClick={() => select(p.id, p.type)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 10px",
                borderRadius: 7,
                cursor: "pointer",
                background: isCur ? "var(--brand-soft)" : "transparent",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name}</div>
                <div style={{ marginTop: 3 }}>
                  <TypeBadge type={p.type} size="sm" />
                </div>
              </div>
              {isCur && <Icon name="check" size={13} color="var(--brand)" />}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>{ct("projEmpty")}</div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 6 }}>
        <Btn
          kind="ghost"
          size="sm"
          icon="plus"
          onClick={() => {
            setOpen(false);
            ctx.navigate("master.project");
          }}
        >
          {ct("projAddEdit")}
        </Btn>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 12px 6px 8px",
          background: open ? "var(--brand-soft)" : "var(--surface-2)",
          border: `1px solid ${open ? "var(--brand)" : "var(--border)"}`,
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: "inherit",
          height: 38,
        }}
      >
        {active && <TypeBadge type={active.type} size="sm" showName={false} />}
        <div style={{ lineHeight: 1.1, textAlign: "left" }}>
          <div style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 500 }}>{ct("projEyebrow")}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
            {active?.name ?? (projectsQ.isLoading ? "…" : "")}
          </div>
        </div>
        <Icon name="chevD" size={14} color="var(--text-3)" />
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
