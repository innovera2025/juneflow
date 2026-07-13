/*
 * CompanySwitcher — ported from pototype/company-accept.jsx CompanySwitcher (24-104).
 *
 * Data (B-041): the prototype's COMPANIES are a hardcoded mock (§0 rule 3); the
 * production source is GET /companies — the tenant's affiliated group companies with
 * short / color / biz / tax_id / doc_prefix / project_count. No field is invented.
 *
 * B-046 (open): project_count is derived from the tenant's project rows attributed
 * to each group company; until a group-attribution column lands it is 0 for every
 * company. We render that 0 honestly rather than hiding the switcher — the Multi-
 * Company chrome exists in the reference and its data source is now real.
 *
 * The active company follows company-accept.jsx activeCompanyId(): an explicit
 * company tweak wins, else the active project's owning company, else the first row.
 * Picking a company records ctx.tweaks.company (the prototype also re-scopes projects
 * by company, deferred here per the B-046 attribution gap — same as the 5a switcher
 * which does not notify/redirect on switch).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { components } from "@juneflow/contracts";
import { Icon } from "../ui/icon";
import { useShellCtx } from "./shell-context";
import { useCompanies, useProjects, resolveActiveProject, resolveActiveCompany } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";

type Company = components["schemas"]["Company"];

export function CompanySwitcher() {
  const ctx = useShellCtx();
  const ct = useChromeText();
  const companiesQ = useCompanies();
  const projectsQ = useProjects();
  const companies = companiesQ.data ?? [];
  const activeProject = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const active = resolveActiveCompany(companies, ctx.tweaks.company, activeProject);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", h);
    };
  }, [open]);

  const pick = (c: Company) => {
    ctx.setTweak("company", c.id);
    setOpen(false);
  };

  // The switcher needs a company to render its button; while /companies loads or if
  // the tenant has none, render nothing (the topbar simply has no company chip).
  if (!active) return null;

  const bizShort = (active.biz ?? "").split(" ")[0].slice(0, 14);

  const popover = open ? (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 2600,
        width: 330,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.22)",
        color: "var(--text)",
        padding: 6,
      }}
    >
      <div
        style={{
          padding: "8px 10px 6px",
          fontSize: 10.5,
          fontWeight: 700,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {ct("companyPickTitle")}
      </div>
      {companies.map((c) => {
        const on = c.id === active.id;
        return (
          <div
            key={c.id}
            onClick={() => pick(c)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 10px",
              borderRadius: 9,
              cursor: "pointer",
              background: on ? "var(--brand-soft)" : "transparent",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                flexShrink: 0,
                background: c.color ?? "var(--brand)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {c.short}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                {c.biz} · <span className="num">{c.project_count ?? 0}</span> {ct("companyProjSuffix")}
              </div>
              <div className="num" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                {ct("companyTaxLabel")} {c.tax_id} · {ct("companyDocLabel")} {c.doc_prefix}-XX-2569-XXXX
              </div>
            </div>
            {on && <Icon name="check" size={15} color="var(--brand)" />}
          </div>
        );
      })}
      <div
        style={{
          margin: "4px 6px 6px",
          padding: "8px 10px",
          background: "var(--surface-2)",
          borderRadius: 8,
          fontSize: 10.5,
          color: "var(--text-3)",
          display: "flex",
          gap: 6,
        }}
      >
        <Icon name="info" size={13} /> {ct("companyInfo")}
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
          gap: 8,
          height: 38,
          padding: "0 10px",
          border: "1px solid var(--border)",
          borderRadius: 9,
          background: open ? "var(--surface-2)" : "var(--surface)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: active.color ?? "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 800,
          }}
        >
          {active.short}
        </span>
        <span style={{ lineHeight: 1.1, textAlign: "left" }}>
          <span style={{ display: "block", fontSize: 9.5, color: "var(--text-3)", fontWeight: 500 }}>{ct("companyEyebrow")}</span>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
            {active.short} · {bizShort}
          </span>
        </span>
        <Icon name="chevD" size={13} color="var(--text-3)" />
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
