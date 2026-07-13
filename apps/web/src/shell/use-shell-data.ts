/*
 * Shell data hooks for @juneflow/web (P0-WEB-05).
 *
 * All reads go through the generated typed client (api-client.ts) + TanStack Query
 * via the unwrap() adapter — no hand-written models/fetch (PLAN.md §5). Queries are
 * gated on a present bearer token so the login screen (no token) never fires 401s.
 *
 * C10 (PLAN.md Appendix C): the sidebar badge counts are a mock mechanic in the
 * prototype (hardcoded 4/17/8/5/12/6). They MUST come from a real count query and
 * MUST NOT be hardcoded. No /count|/badge|/unread endpoint exists in the sacred
 * openapi.yaml (confirmed by grep) — so useBadgeCount() returns undefined (no pill
 * rendered) until such an endpoint lands. Tracked in BLOCKERS B-039.
 */
import { useQuery } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../api-client";
import { unwrap } from "../query-client";
import { getAuthToken } from "../auth-token";

type Me = components["schemas"]["Me"];
type Project = components["schemas"]["Project"];

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /me — sidebar footer identity + user menu (opaque Entity fields read defensively). */
export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => unwrap(apiClient.GET("/me")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /projects — bare array of projects for the ProjectSwitcher + module gating. */
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => unwrap(apiClient.GET("/projects")),
    enabled: authed(),
    staleTime: 60_000,
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
 * Default = the first row (NOT the prototype mock "rjp.p2") when no tweak is set,
 * matching the scout's C10/data ruling.
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
 * C10 badge count for a nav row's count-source id. Returns undefined until a real
 * count endpoint exists (see BLOCKERS B-039) — the sidebar renders no pill for
 * undefined, never the prototype's hardcoded number.
 */
export function useBadgeCount(_sourceId: string | undefined): number | undefined {
  return undefined;
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
