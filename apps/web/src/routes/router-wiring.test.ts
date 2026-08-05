/*
 * Router <-> registry wiring tests (B-291, gate G3).
 *
 * WHY THIS FILE EXISTS: registry.ts declares WHICH component every route id renders and
 * check:routes proves the registry matches docs/extract/NAV-ROUTES.md — but neither of them
 * looks at router.tsx's PORTED_SCREENS map, which is what actually mounts the screen. A
 * route could therefore be declared everywhere and still fall through to <Placeholder>
 * ("under development") with every gate green. `subcon` did: NAV-ROUTES.md row 129 and
 * registry EXTRA_ROUTES both give it component SubconProgress ("route id ซ้ำกับ
 * subcon.progress"), yet only the dotted id was mapped.
 *
 * router.tsx cannot be imported in this node/no-DOM vitest env (it builds a live TanStack
 * router and pulls in chart.js), so PORTED_SCREENS is read from source. registry.ts is pure
 * data and is imported normally.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SIDEBAR_ROUTES, EXTRA_ROUTES } from "./registry";

const ROUTER_PATH = fileURLToPath(new URL("../router.tsx", import.meta.url));

/** route id -> the component IDENTIFIER router.tsx mounts for it (PORTED_SCREENS). */
function portedScreens(): Record<string, string> {
  const src = readFileSync(ROUTER_PATH, "utf8");
  const start = src.indexOf("const PORTED_SCREENS");
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n};", start));
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(?:"([\w.]+)"|([\w.]+))\s*:\s*(\w+),/gm)) {
    map[(m[1] ?? m[2]) as string] = m[3] as string;
  }
  return map;
}

const REGISTRY = [...SIDEBAR_ROUTES, ...EXTRA_ROUTES];

describe("PORTED_SCREENS <-> registry", () => {
  it("mounts the `subcon` alias on the same component as `subcon.progress`", () => {
    const map = portedScreens();
    expect(map["subcon.progress"]).toBe("SubconProgress");
    // the alias was absent -> /subcon rendered <Placeholder routeId="subcon" />
    expect(map.subcon).toBe(map["subcon.progress"]);
  });

  it("agrees with the registry's declared component for the alias", () => {
    const declared = REGISTRY.find((r) => r.id === "subcon");
    expect(declared?.component).toBe("SubconProgress");
    expect(portedScreens().subcon).toBe(declared?.component);
  });

  it("maps no route id the registry does not know (a typo'd key renders a Placeholder)", () => {
    const known = new Set(REGISTRY.map((r) => r.id));
    expect(Object.keys(portedScreens()).filter((id) => !known.has(id))).toEqual([]);
  });

  /**
   * The class the `subcon` alias belonged to: a registry route whose declared component is
   * ALREADY mounted for some other id — i.e. the screen demonstrably exists — but which has
   * no mapping of its own, so it silently shows "under development". `subcon` was the only
   * live instance; this keeps it that way.
   */
  it("leaves no registry route unmapped whose component is already mounted elsewhere", () => {
    const map = portedScreens();
    const mounted = new Set(Object.values(map));
    const orphans = REGISTRY.filter((r) => !(r.id in map) && mounted.has(r.component)).map(
      (r) => `${r.id} -> ${r.component}`,
    );
    expect(orphans).toEqual([]);
  });
});
