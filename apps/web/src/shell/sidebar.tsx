/*
 * Sidebar — ported 1:1 from pototype/chrome.jsx Sidebar()/Logo()/NAV (74-446).
 *
 * Structure (chrome.jsx:340-444): fixed 244px aside → Logo header → tenant/platform
 * viewMode switch → scrollable nav tree → user footer (avatar row → UserMenu).
 * The menu tree is built from the structural registry (routes/registry.ts, via
 * nav-tree.ts) + i18n labels (tn) + icons — never chrome.jsx's literal Thai/badges.
 *
 * Three gates faithful to chrome.jsx:311-333 — (i) viewMode: platform mode shows
 * only the platform section + dashboard; tenant shows everything else; (ii) a
 * section shows only when ≥1 child passes; (iii) an item shows when moduleOn(mod)
 * for the active project's type. Package gating (pkgMenuAllowed) is a prototype
 * window-global mock with no client endpoint (PACKAGE-RULES.md) → deferred, so all
 * module-visible rows show (matches the default-package reference gallery/g1/01).
 *
 * Data (C10, §0 rule 3): footer identity comes from GET /me (not the prototype's
 * hardcoded user); module gating from GET /projects' active project type; badge
 * counts from a real query (none yet -> no pill, BLOCKERS B-039). Logo gradient +
 * avatar color are prototype-verbatim literals (B-037(a): no token match).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon";
import { Avatar } from "../ui/avatar";
import { useI18n } from "../i18n";
import { parentOf, type SectionId } from "../routes/registry";
import { NAV_TREE, asIconName, asNavKey, type NavItem } from "./nav-tree";
import { moduleOn } from "./project-types";
import { useShellCtx } from "./shell-context";
import { useMe, useProjects, resolveActiveProject, entityStr } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";
import { BadgeCount } from "./badge-count";
import { UserMenu } from "./user-menu";

/** Logo — chrome.jsx:74-96. Teal-gradient house tile + brand text. Gradient/shadow
 *  are prototype-verbatim literals (B-037(a)); "Juneflow" is the (untranslated) brand
 *  mark and the tagline is the dict key app.name. */
function Logo() {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "linear-gradient(135deg, #0F766E 0%, #0B5F58 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 4px rgba(15,118,110,0.22)",
          flexShrink: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 21h18M6 21V8l6-4 6 4v13M9 12h2M13 12h2M9 16h2M13 16h2"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Juneflow</div>
        <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 500 }}>{t("app.name")}</div>
      </div>
    </div>
  );
}

/** Section-id tagged per node (chrome.jsx sideOf[]); undefined before the 1st section. */
interface DisplayItem {
  node: (typeof NAV_TREE)[number];
  section: SectionId | undefined;
}

export function Sidebar() {
  const ctx = useShellCtx();
  const { tn } = useI18n();
  const ct = useChromeText();
  const me = useMe();
  const projectsQ = useProjects();

  const active = ctx.route;
  const viewMode = ctx.tweaks.viewMode;
  const parentId = parentOf(active) ?? active;
  const [expanded, setExpanded] = useState<string | null>(parentId);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  // Active parent is always auto-expanded (chrome.jsx:337).
  useEffect(() => setExpanded(parentOf(active) ?? active), [active]);

  const activeProject = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const activeType = activeProject?.type;

  // Build the visible list applying the three gates (chrome.jsx:311-333).
  const display: DisplayItem[] = [];
  let curSection: SectionId | undefined;
  const modOk = (mod: string | undefined) => moduleOn(mod, activeType);
  for (let i = 0; i < NAV_TREE.length; i++) {
    const node = NAV_TREE[i];
    const section = node.kind === "section" ? node.sectionId : curSection;
    if (node.kind === "section") curSection = node.sectionId;
    const inPlatform = section === "platform";
    // mode gate
    const modePass =
      viewMode === "platform" ? inPlatform || (node.kind === "item" && node.id === "dashboard") : !inPlatform;
    if (!modePass) continue;
    if (node.kind === "section") {
      // section shows only if ≥1 following item passes moduleOn
      let any = false;
      for (let j = i + 1; j < NAV_TREE.length; j++) {
        const nx = NAV_TREE[j];
        if (nx.kind === "section") break;
        if (modOk(nx.mod)) {
          any = true;
          break;
        }
      }
      if (any) display.push({ node, section });
    } else if (modOk(node.mod)) {
      display.push({ node, section });
    }
  }

  const userName = entityStr(me.data?.user, "name");
  const roleName = entityStr(me.data?.role, "name");

  return (
    <aside
      style={{
        width: 244,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
        <Logo />
      </div>

      {/* Tenant / Platform-owner mode switch (chrome.jsx:350-360). */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          background: "var(--surface-2)",
          borderRadius: 0,
          gap: 3,
        }}
      >
        {(
          [
            { v: "tenant" as const, l: ct("viewTenant"), ic: "users" as const },
            { v: "platform" as const, l: ct("viewPlatform"), ic: "shield" as const },
          ]
        ).map((m) => {
          const on = viewMode === m.v;
          return (
            <button
              key={m.v}
              onClick={() => {
                ctx.setTweak("viewMode", m.v);
                ctx.navigate(m.v === "platform" ? "admin.overview" : "dashboard");
              }}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 4px",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11.5,
                fontWeight: 700,
                background: on ? "var(--brand)" : "transparent",
                color: on ? "#fff" : "var(--text-2)",
              }}
            >
              <Icon name={m.ic} size={13} />
              {m.l}
            </button>
          );
        })}
      </div>

      <nav style={{ flex: 1, overflow: "auto", padding: "10px 10px 16px" }}>
        {display.map(({ node }, i) => {
          if (node.kind === "section") {
            return (
              <div
                key={`s${i}`}
                style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "14px 10px 6px",
                }}
              >
                {tn(asNavKey(node.label))}
              </div>
            );
          }
          return (
            <NavRow
              key={node.id}
              item={node}
              active={active}
              parentId={parentId}
              expanded={expanded}
              onToggle={(id) => setExpanded((e) => (e === id ? null : id))}
              onNavigate={ctx.navigate}
              tn={tn}
            />
          );
        })}
      </nav>

      <div
        ref={avatarRef}
        onClick={() => setUserMenuOpen((o) => !o)}
        style={{
          padding: 12,
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          background: userMenuOpen ? "var(--brand-soft)" : "transparent",
        }}
      >
        <Avatar name={userName || "?"} color="#0F766E" />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {userName || (me.isLoading ? "…" : "")}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{roleName}</div>
        </div>
        <Icon name="settings" size={16} color="var(--text-3)" />
      </div>

      <UserMenu open={userMenuOpen} anchorRef={avatarRef} onClose={() => setUserMenuOpen(false)} />
    </aside>
  );
}

/** One top-level row (parent or leaf) + its sub-list (chrome.jsx:375-425). */
function NavRow({
  item,
  active,
  parentId,
  expanded,
  onToggle,
  onNavigate,
  tn,
}: {
  item: NavItem;
  active: string;
  parentId: string;
  expanded: string | null;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  tn: (key: ReturnType<typeof asNavKey>) => string;
}) {
  const hasSub = !!item.sub;
  const isParentActive = hasSub ? item.id === parentId : item.id === active;
  const isOpen = expanded === item.id || isParentActive;
  return (
    <div>
      <div
        onClick={() => {
          if (hasSub) {
            onToggle(item.id);
            if (!isParentActive && item.sub?.[0]) onNavigate(item.sub[0].id);
          } else {
            onNavigate(item.id);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 8,
          background: isParentActive ? "var(--brand-soft)" : "transparent",
          color: isParentActive ? "var(--brand)" : "var(--text-2)",
          fontSize: 13,
          fontWeight: isParentActive ? 600 : 500,
          cursor: "pointer",
        }}
      >
        <Icon name={asIconName(item.icon)} size={17} />
        <span style={{ flex: 1 }}>{tn(asNavKey(item.label))}</span>
        {item.badge && <BadgeCount sourceId={item.badge} />}
        {hasSub && <Icon name={isOpen ? "chevD" : "chevR"} size={14} style={{ opacity: 0.6 }} />}
      </div>
      {hasSub && isOpen && (
        <div style={{ paddingLeft: 30, margin: "2px 0 6px" }}>
          {item.sub!.map((s) => {
            const isActive = s.id === active;
            return (
              <div
                key={s.id}
                onClick={() => onNavigate(s.id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--text)" : "var(--text-2)",
                  background: isActive ? "var(--surface-3)" : "transparent",
                  borderLeft: isActive ? "2px solid var(--brand)" : "2px solid transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{tn(asNavKey(s.label))}</span>
                {s.badge && <BadgeCount sourceId={s.badge} sub />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
