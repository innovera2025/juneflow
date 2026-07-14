/**
 * Sidebar nav-tree loader for @juneflow/web (P0-WEB-05 · 5b B-039).
 *
 * The structural route table (routes/registry.ts) deliberately omits the sidebar
 * label/icon/grouping layer (registry.ts header, §7 of the scout). This module
 * supplies exactly that layer from the data file nav-tree.json — a faithful
 * transcription of pototype/chrome.jsx NAV (98-239) — while nav-tree.test.ts
 * asserts every leaf/sub id here equals SIDEBAR_ROUTES 1:1 (no drift, PLAN.md §0)
 * AND every label is a real nav_i18n key.
 *
 * Labels are the Thai nav_i18n keys (chrome.jsx renders tn(n.label)); Thai is data,
 * kept in .json (the i18n-guard hook skips .json), never hardcoded in .tsx source.
 * After PLAT-03 (B-039) every label — including the previously-absent 15 — is a
 * real nav_i18n key, so `label` is typed NavKey directly (one boundary cast at the
 * JSON import) and consumers call tn(node.label) with no per-call `asNavKey` cast.
 * Badge fields carry the count-source route id (C10), never the mock number.
 */
import navData from "./nav-tree.json" with { type: "json" };
import type { NavKey } from "@juneflow/i18n";
import type { IconName } from "../ui/icon";
import type { SectionId } from "../routes/registry";

/** A child row under a parent (chrome.jsx sub[] — no icon, optional badge). */
export interface NavSub {
  id: string;
  /** Thai nav_i18n key — passed straight to tn(). */
  label: NavKey;
  /** Count-source key for the badge pill (C10 / B-040), or undefined. */
  badge?: string;
}

/** A top-level sidebar row: standalone leaf or a parent with children. */
export interface NavItem {
  kind: "item";
  id: string;
  icon: string;
  label: NavKey;
  /** Module gate id (moduleOn); undefined = always on for the view. */
  mod?: string;
  badge?: string;
  sub?: NavSub[];
}

/** A section header row. */
export interface NavSection {
  kind: "section";
  sectionId: SectionId;
  label: NavKey;
}

export type NavNode = NavItem | NavSection;

/** The ordered flat nav tree (sections + items), exactly in chrome.jsx order. */
export const NAV_TREE = navData.tree as unknown as readonly NavNode[];

/** Section id -> Thai section-header key (tn()). */
export const NAV_SECTIONS = navData.sections as Readonly<Record<SectionId, NavKey>>;

/** Narrowing helper for a data-sourced icon name. */
export function asIconName(icon: string): IconName {
  return icon as IconName;
}

/** Every route id that has a sidebar entry (leaf + sub) — for the parity test. */
export function allNavRouteIds(): string[] {
  const ids: string[] = [];
  for (const n of NAV_TREE) {
    if (n.kind !== "item") continue;
    if (n.sub) for (const s of n.sub) ids.push(s.id);
    else ids.push(n.id);
  }
  return ids;
}

/** route id -> Thai nav_i18n label key (leaf + sub). */
const LABEL_BY_ID: Record<string, NavKey> = (() => {
  const m: Record<string, NavKey> = {};
  for (const n of NAV_TREE) {
    if (n.kind !== "item") continue;
    if (n.sub) for (const s of n.sub) (m[s.id] = s.label);
    else m[n.id] = n.label;
  }
  return m;
})();

/** Nav label key for a route id, or undefined for a non-sidebar route (extra/legacy). */
export function navLabelForRoute(id: string): NavKey | undefined {
  return LABEL_BY_ID[id];
}
