/*
 * ProjectSwitcher — ported from pototype/chrome.jsx ProjectSwitcher (452-601).
 *
 * Data (B-041): the extended GET /projects now carries short / color / units /
 * phases[] (each {id, name, units, sold_pct, sale_status}) — the exact fields the
 * prototype's PROJECTS switcher renders (short-code color chip, phase list, per-phase
 * units & sold%). No field beyond what the API returns is invented (§0). The active
 * selection is "projectId.phaseId" in ctx.tweaks.project, like the prototype.
 *
 * On select, if the current route's module is off for the new project's type, we
 * redirect to dashboard first (shell.jsx setTweak project special-case, 91-96).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { components } from "@juneflow/contracts";
import { Icon } from "../ui/icon";
import { Btn } from "../ui/button";
import { useShellCtx } from "./shell-context";
import { useProjects, resolveActiveProject } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";
import { TypeBadge } from "./type-badge";
import { routeAllowedForType } from "./project-types";

type Project = components["schemas"]["Project"];

/** The active phase for a project + the selected phase id (prototype phase resolution). */
function resolvePhase(project: Project | undefined, phaseId: string | undefined) {
  const phases = project?.phases ?? [];
  return phases.find((ph) => ph.id === phaseId) ?? phases[0];
}

export function ProjectSwitcher() {
  const ctx = useShellCtx();
  const ct = useChromeText();
  const projectsQ = useProjects();
  const projects = projectsQ.data ?? [];

  const [projTweak, phaseTweak] = (ctx.tweaks.project ?? "").split(".");
  const active = resolveActiveProject(projects, ctx.tweaks.project);
  const activePhase = resolvePhase(active, phaseTweak);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [q, setQ] = useState("");
  const [expandedProj, setExpandedProj] = useState<string | null>(projTweak || null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
      setQ("");
      setExpandedProj(active?.id ?? null);
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

  const select = (projectId: string, phaseId: string, type: string) => {
    if (!routeAllowedForType(ctx.route, type)) ctx.navigate("dashboard");
    ctx.setTweak("project", `${projectId}.${phaseId}`);
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
          const isExp = expandedProj === p.id;
          const phases = p.phases ?? [];
          return (
            <div key={p.id}>
              <div
                onClick={() => setExpandedProj(isExp ? null : p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 7,
                  cursor: "pointer",
                  background: isExp ? "var(--surface-2)" : "transparent",
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: p.color ?? "var(--brand)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {p.short}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}>
                    <TypeBadge type={p.type} size="sm" />
                    <span>
                      {phases.length} {ct("projPhase")} · <span className="num">{p.units ?? 0}</span> {ct("projUnitsTotal")}
                    </span>
                  </div>
                </div>
                <Icon name={isExp ? "chevD" : "chevR"} size={13} color="var(--text-3)" />
              </div>
              {isExp && (
                <div style={{ paddingInlineStart: 32, paddingBottom: 6 }}>
                  {phases.map((ph) => {
                    const isCur = p.id === projTweak && ph.id === phaseTweak;
                    return (
                      <div
                        key={ph.id}
                        onClick={() => select(p.id, ph.id, p.type)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          background: isCur ? "var(--brand-soft)" : "transparent",
                          borderLeft: isCur ? "2px solid var(--brand)" : "2px solid transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 2,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: isCur ? 700 : 500, color: isCur ? "var(--brand)" : "var(--text)" }}>{ph.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                            <span className="num">{ph.units ?? 0}</span> {ct("projUnits")}
                            {ph.sold_pct != null && (
                              <>
                                {" "}· {ct("projSold")} <span className="num">{ph.sold_pct}%</span>
                              </>
                            )}
                            {ph.sale_status === "pre-sale" && <> · {ct("projPresale")}</>}
                          </div>
                        </div>
                        {isCur && <Icon name="check" size={13} color="var(--brand)" />}
                      </div>
                    );
                  })}
                </div>
              )}
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
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: active?.color ?? "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 800,
          }}
        >
          {active?.short}
        </div>
        <div style={{ lineHeight: 1.1, textAlign: "start" }}>
          <div style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 500 }}>{ct("projEyebrow")}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
            {active
              ? `${active.name}${activePhase ? ` · ${activePhase.name.split(" · ")[0]}` : ""}`
              : projectsQ.isLoading
                ? "…"
                : ""}
          </div>
        </div>
        {active && (
          <div style={{ marginInlineStart: 2 }}>
            <TypeBadge type={active.type} size="sm" showName={false} />
          </div>
        )}
        <Icon name="chevD" size={14} color="var(--text-3)" />
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
