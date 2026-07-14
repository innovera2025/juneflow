/*
 * Project-type-card helpers for MasterProjectType (P1-WEB-10) — pure, i18n-free,
 * ASCII-only logic ported 1:1 from pototype/project-type-screen.jsx
 * MasterProjectType (L15-108) + MODULE_LABELS (L5-12).
 *
 * The prototype held the type list in local state (PROJECT_TYPE_LIST) and each type
 * carried an inline `{ land: 1, boq: 1, ... }` module map plus its presentation fields
 * (nameEn / desc / icon / color / costTypes). Here the type list is the real
 * platform-global reference table: GET /project-types returns the opaque rows
 * {id, key, name, hierarchy, modules} where `modules` is a string[] of enabled nav-ids
 * (seed PROJECT_TYPES). The 5 presentation fields the server omits live in client meta
 * (ptype-meta.json), keyed by `key` (resolved in the view, not here).
 *
 * ALL_MODULES is the FIXED render order (16, the MODULE_LABELS key order) — the enabled
 * chips render in this order regardless of the server's modules[] array order (the seed
 * lists `pm` mid-array, but the reference g2/29 renders PM last). MOD_DICT maps the 7
 * module keys whose label is a stable DICT i18n key (ptype.mod.*); the remaining 9
 * resolve through the PHRASE layer in the view (ptype-strings.json). No Thai / i18n here
 * (i18n-guard) — the view binds labels to keys.
 */

/** The 16 module keys in FIXED render order (MODULE_LABELS key order, project-type-screen.jsx:5-13). */
export const ALL_MODULES = [
  "land",
  "boq",
  "proc",
  "subcon",
  "timeline",
  "inv",
  "petty",
  "sales_re",
  "aftersales",
  "lineoa",
  "om",
  "ppa",
  "roi",
  "permit",
  "warranty",
  "pm",
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

/**
 * The 7 module keys whose label is a stable DICT i18n key (ptype.mod.*), resolved with
 * t() in the view. The other 9 (land / boq / subcon / inv / petty / ppa / roi / permit /
 * warranty) resolve through the PHRASE layer (their Thai text is the phrase key), read
 * from ptype-strings.json. 7 + 9 = the 16 ALL_MODULES.
 */
export const MOD_DICT: Readonly<Record<string, string>> = {
  proc: "ptype.mod.procure",
  timeline: "ptype.mod.timeline",
  sales_re: "ptype.mod.salesRe",
  aftersales: "ptype.mod.aftersales",
  lineoa: "ptype.mod.lineoa",
  om: "ptype.mod.om",
  pm: "ptype.mod.pm",
};

/** A project type as the card grid consumes it (GET /project-types row, narrowed from opaque). */
export interface TypeCard {
  id: string;
  /** Type key (realestate | solar | civil | service) — the meta + project-usage join key. */
  key: string;
  /** Thai display name — opaque row data (row.name), rendered raw. */
  name: string;
  /** Ordered WBS labels — opaque row data (row.hierarchy), rendered raw. */
  hierarchy: string[];
  /** Enabled nav-id keys (server modules[]) — filtered/ordered by enabledModules in the view. */
  modules: string[];
}

/** Read a string field off an opaque row; "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a string[] off an opaque row; [] when absent; non-string members dropped. */
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Narrow an opaque /project-types row to the {id, key, name, hierarchy, modules} the
 * card needs. Missing fields default (strings -> "", arrays -> []) so a partial row
 * never throws at render.
 */
export function toTypeCard(e: Record<string, unknown>): TypeCard {
  return {
    id: str(e.id),
    key: str(e.key),
    name: str(e.name),
    hierarchy: strArray(e.hierarchy),
    modules: strArray(e.modules),
  };
}

/**
 * The enabled modules of a type in FIXED ALL_MODULES order (project-type-screen.jsx:46
 * `ALL_MODULES.filter((m) => t.modules[m])`). The server modules[] may be in any order
 * (the seed puts `pm` mid-array); filtering ALL_MODULES always yields ALL_MODULES order,
 * so PM renders last — matching the reference g2/29. Unknown/absent module keys are
 * dropped.
 */
export function enabledModules(modules: readonly string[]): ModuleKey[] {
  const enabled = new Set(modules);
  return ALL_MODULES.filter((m) => enabled.has(m));
}

/**
 * Projects that use a given type key (project-type-screen.jsx:18 `p.type === id`). Kept
 * generic over `{ type?: string }` so it stays pure/decoupled from the contracts Project
 * shape while the caller keeps full row typing (e.g. reads `.name` off the result).
 */
export function projectsByType<T extends { type?: string }>(
  projects: readonly T[],
  key: string,
): T[] {
  return projects.filter((p) => p.type === key);
}
