/*
 * Shell data hooks for @juneflow/web (P0-WEB-05 5a scaffold; 5b live wiring P1-WEB-06).
 *
 * All reads go through the generated typed client (api-client.ts) + TanStack Query
 * via the unwrap() adapter — no hand-written models/fetch (PLAN.md §5). Queries are
 * gated on a present bearer token so the login screen (no token) never fires 401s.
 *
 * C10 (PLAN.md Appendix C): the sidebar badge counts are a mock mechanic in the
 * prototype (hardcoded 4/17/8/…). They come from a real tenant-scoped query —
 * GET /counts?keys=<9 nav ids> , one batched request) — never hardcoded.
 * A pill is hidden when the count is null/0 (prototype pill only renders a number).
 */
import { useQuery } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../api-client";
import { unwrap } from "../query-client";
import { getAuthToken } from "../auth-token";

type Me = components["schemas"]["Me"];
type Project = components["schemas"]["Project"];
type Company = components["schemas"]["Company"];

/**
 * The 9 NAV badge sources (chrome.jsx NAV badges) — decision C10 / B-040.
 * These are the exact enum keys accepted by GET /counts (openapi.yaml). One
 * batched request counts them all; each nav row reads its own key.
 */
export const BADGE_KEYS = [
  "boq",
  "boq.approval",
  "pr.list",
  "accept",
  "pm.wo",
  "gl.inbox",
  "sales",
  "sales.crm",
  "sales.service",
] as const;

export type BadgeKey = (typeof BADGE_KEYS)[number];

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /me — sidebar footer identity + user menu + package.menus (opaque Entity fields). */
export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => unwrap(apiClient.GET("/me")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /projects — projects (extended: short/color/company_id/units/phases[]) for the switcher. */
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => unwrap(apiClient.GET("/projects")),
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /companies — affiliated group companies for the Multi-Company switcher (B-041). */
export function useCompanies() {
  return useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: () => unwrap(apiClient.GET("/companies")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * GET /counts?keys=<9 nav ids> — the batched C10 badge counts (B-040). One
 * request for all sidebar badges; the array serialises comma-separated
 * (style=form, explode=false) exactly as the contract declares.
 */
export function useCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["counts"],
    queryFn: async () => {
      const data = await unwrap(
        apiClient.GET("/counts", {
          params: { query: { keys: [...BADGE_KEYS] } },
          querySerializer: { array: { style: "form", explode: false } },
        }),
      );
      return data.counts;
    },
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** Read a defensively-typed string field off an opaque Entity ({ [k]: unknown }). */
export function entityStr(
  entity: Record<string, unknown> | undefined | null,
  key: string,
): string {
  const v = entity?.[key];
  return typeof v === "string" ? v : "";
}

/**
 * The active project (ProjectSwitcher selection) resolved against real /projects.
 * Default = the first row (NOT the prototype mock "rjp.p2") when no tweak is set.
 * projectTweak is "projectId.phaseId" (like the prototype ctx.tweaks.project).
 */
export function resolveActiveProject(
  projects: Project[] | undefined,
  projectTweak: string | undefined,
): Project | undefined {
  if (!projects || projects.length === 0) return undefined;
  const projId = projectTweak?.split(".")[0];
  return projects.find((p) => p.id === projId) ?? projects[0];
}

/**
 * The active company (CompanySwitcher selection), resolved against real /companies.
 * Mirrors company-accept.jsx activeCompanyId(): an explicit company tweak wins;
 * otherwise it falls back to the active project's owning company; else the first
 * company row. Returns undefined only when the company list is empty.
 */
export function resolveActiveCompany(
  companies: Company[] | undefined,
  companyTweak: string | undefined,
  activeProject: Project | undefined,
): Company | undefined {
  if (!companies || companies.length === 0) return undefined;
  const byTweak = companyTweak ? companies.find((c) => c.id === companyTweak) : undefined;
  if (byTweak) return byTweak;
  const byProject = activeProject?.company_id
    ? companies.find((c) => c.id === activeProject.company_id)
    : undefined;
  return byProject ?? companies[0];
}

/**
 * C10 badge count for a nav row's count-source key (B-040). Reads from the
 * single shared /counts query (TanStack Query dedupes by key). Returns undefined
 * when the count is missing OR zero — the sidebar renders no pill for undefined,
 * exactly like the prototype (a pill only ever shows a positive number).
 */
export function useBadgeCount(sourceKey: string | undefined): number | undefined {
  const counts = useCounts();
  if (!sourceKey) return undefined;
  const n = counts.data?.[sourceKey];
  return typeof n === "number" && n > 0 ? n : undefined;
}

/**
 * pkgMenuAllowed — port of pkg-builder.jsx:237-242 (B-043). `menus` is the
 * tenant package's allow-list of NAV top-level ids (GET /me → package.menus).
 * Dashboard + Subscription are always visible; "*" means every menu; otherwise
 * the id must be in the list. A missing/absent list means "no gating" (allow),
 * matching the prototype's `if (!p) return true`.
 */
export function pkgMenuAllowed(navId: string, menus: readonly string[] | undefined): boolean {
  if (!menus) return true;
  if (navId === "dashboard" || navId === "sub") return true;
  if (menus.includes("*")) return true;
  return menus.includes(navId);
}

/** The tenant package's menu allow-list from GET /me (package.menus), or undefined. */
export function packageMenus(me: Me | undefined): readonly string[] | undefined {
  const pkg = me?.package as Record<string, unknown> | undefined;
  const menus = pkg?.menus;
  return Array.isArray(menus) ? (menus as string[]) : undefined;
}

/** GET /notifications — bell popover list + unread dot (opaque EntityList, C10). */
export function useNotifications() {
  return useQuery<Record<string, unknown>[]>({
    queryKey: ["notifications"],
    queryFn: () => unwrap(apiClient.GET("/notifications")),
    enabled: authed(),
    staleTime: 30_000,
  });
}
