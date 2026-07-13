/**
 * Project-type module gating for @juneflow/web (P0-WEB-05).
 *
 * Ports pototype/project-types.jsx moduleOn()/TypeBadge data (63-92). The active
 * project's type decides which sidebar modules render (e.g. a real-estate project
 * hides the solar/energy section — confirmed in gallery/g1/01). The type comes
 * from real data: GET /projects rows carry `type` (realestate|solar|civil|service).
 */
import typeData from "./project-types.json" with { type: "json" };
import type { IconName } from "../ui/icon";

export type ProjectTypeKey = "realestate" | "solar" | "civil" | "service";

export interface ProjectTypeMeta {
  id: ProjectTypeKey;
  /** Thai display name (TypeBadge). */
  name: string;
  nameEn: string;
  icon: string;
  color: string;
  /** Module gate map: mod id -> 1 when enabled for this type. */
  modules: Record<string, number>;
}

const TYPES = typeData.types as Record<ProjectTypeKey, ProjectTypeMeta>;

/** Type metadata for a project type key (falls back to realestate, like the prototype). */
export function projectTypeMeta(type: string | undefined): ProjectTypeMeta {
  return TYPES[(type as ProjectTypeKey) in TYPES ? (type as ProjectTypeKey) : "realestate"];
}

/** TypeBadge icon for a type. */
export function projectTypeIcon(type: string | undefined): IconName {
  return projectTypeMeta(type).icon as IconName;
}

/**
 * Is a module enabled for the active project type? (prototype moduleOn: null/undefined
 * module = always on.) `type` is the active project's `type` from GET /projects.
 */
export function moduleOn(mod: string | undefined | null, type: string | undefined): boolean {
  if (!mod) return true;
  return !!projectTypeMeta(type).modules[mod];
}

/** Module that gates a route (pototype/project-types.jsx routeModule 95-113); null = always on. */
export function routeModuleOf(route: string | undefined): string | null {
  if (!route) return null;
  if (route.startsWith("land.")) return "land";
  if (route.startsWith("pm.")) return "pm";
  if (route.startsWith("boq.")) return "boq";
  if (/^(pr|po|wo|gr)\./.test(route)) return "proc";
  if (route === "subcon") return "subcon";
  if (route === "timeline") return "timeline";
  if (route.startsWith("inv.")) return "inv";
  if (route === "petty") return "petty";
  if (route.startsWith("sales.")) return "sales_re";
  if (route === "line") return "lineoa";
  if (route === "solar.monitor") return "om";
  if (route === "solar.ppa") return "ppa";
  if (route === "solar.roi") return "roi";
  if (route === "solar.permit") return "permit";
  if (route === "solar.warranty") return "warranty";
  return null;
}

/** Is a route reachable under a project type? (project-types.jsx routeAllowedForProject.) */
export function routeAllowedForType(route: string | undefined, type: string | undefined): boolean {
  return moduleOn(routeModuleOf(route), type);
}
