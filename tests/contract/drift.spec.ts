/**
 * Handler ⟷ OpenAPI drift-sweep (Gate G2, static) — QA durable lane
 *
 * Catches the B-086 failure class: a route handler shipping in apps/api with NO
 * matching declaration in the single system contract (packages/contracts/openapi.yaml).
 * B-086 (getPo/getWo) reached a batch audit undetected because the live suite only
 * probes declared endpoints — an UNdeclared-but-mounted handler is invisible to it.
 * This test closes that gap mechanically: it enumerates the routes actually mounted
 * by apps/api/src/app.ts and cross-checks every one against the contract.
 *
 * Static by design — reads source + openapi.yaml only, needs no dev stack, and stays
 * in the default-green suite. openapi.yaml is a sacred file: this module only READS it.
 *
 * Two directions:
 *   A) mounted-but-UNdeclared  → HARD GATE (the B-086 class). Must be empty.
 *   B) declared-but-UNmounted  → informational warn (the not-yet-built contract
 *      surface; ~100 endpoints at this scaffolding stage — expected, not a failure).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listOperations, loadSpec } from './lib/openapi';

/** Walk up from this test file until the API app-assembly file is found. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'apps/api/src/app.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Cannot locate apps/api/src/app.ts above the drift-sweep test');
}

const ROOT = findRepoRoot();
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface MountedRoute {
  method: string;
  /** Path template with :param normalized to {param} (openapi form). */
  path: string;
  /** Source route file the handler lives in (for a precise drift message). */
  file: string;
}

/** Normalize a Fastify path (`/po/:id`) to the OpenAPI template form (`/po/{id}`). */
function toTemplate(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Enumerate the routes app.ts actually mounts. Only route modules imported from
 * `./routes/*` AND invoked in the assembly are followed (plugins, helpers, and
 * dead imports are ignored), so "mounted" reflects the real wiring, not the folder.
 */
function enumerateMountedRoutes(): MountedRoute[] {
  const appSrc = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');

  // Map every `register*` symbol imported from ./routes/<file>.js to its file.
  const importRe = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*["']\.\/routes\/([\w-]+)\.js["']/g;
  const fnToFile = new Map<string, string>();
  for (let m = importRe.exec(appSrc); m; m = importRe.exec(appSrc)) {
    const file = m[2];
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '');
      if (/^register/.test(name)) fnToFile.set(name, file);
    }
  }

  // A register fn is "mounted" only if app.ts actually calls it (`fn(`); an import
  // uses `{ fn }` with no paren, so a plain call-shape probe never false-matches.
  const mountedFiles = new Set<string>();
  for (const [fn, file] of fnToFile) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(appSrc)) mountedFiles.add(file);
  }
  expect(mountedFiles.size, 'app.ts mounts no route modules — parser broke').toBeGreaterThan(0);

  // Extract `app.<method>("<path>", …)` declarations from each mounted file.
  const routeRe = /\bapp\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const routes: MountedRoute[] = [];
  for (const file of [...mountedFiles].sort()) {
    const src = readFileSync(join(ROOT, 'apps/api/src/routes', `${file}.ts`), 'utf8');
    for (let r = routeRe.exec(src); r; r = routeRe.exec(src)) {
      routes.push({ method: r[1].toUpperCase(), path: toTemplate(r[2]), file });
    }
  }
  return routes;
}

const doc = loadSpec();
const declaredOps = new Set(listOperations(doc).map((o) => `${o.method} ${o.path}`));
const mountedRoutes = enumerateMountedRoutes();
const mountedKeys = new Set(mountedRoutes.map((r) => `${r.method} ${r.path}`));

describe('handler ⟷ openapi drift-sweep (static G2 gate)', () => {
  it('parses a plausible number of mounted routes (guards a silent parser regression)', () => {
    // ~75 routes are wired today. A regex/rename regression that drops matches would
    // let the hard gate below pass vacuously — this floor makes that fail loudly.
    expect(mountedRoutes.length).toBeGreaterThanOrEqual(60);
    expect(declaredOps.size).toBeGreaterThan(0);
  });

  it('every mounted API route is declared in openapi.yaml (B-086 class)', () => {
    const mountedButUndeclared = mountedRoutes
      .filter((r) => !declaredOps.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method} ${r.path}  [apps/api/src/routes/${r.file}.ts]`)
      .sort();
    // The B-086 failure mode: a handler live in apps/api with no contract line.
    // Any entry here is a real contract drift to declare in openapi.yaml (sacred —
    // goes through Wei, PLAN.md §10), NOT something this test should paper over.
    expect(mountedButUndeclared, 'handlers mounted with no openapi declaration').toEqual([]);
  });

  it('reports declared operations with no mounted handler (informational — not a gate)', () => {
    const declaredButUnmounted = [...declaredOps].filter((d) => !mountedKeys.has(d)).sort();
    if (declaredButUnmounted.length > 0) {
      // Expected during scaffolding: most of the contract surface is not built yet.
      // Warned (not failed) so the reverse-direction gap stays visible without gating.
      // eslint-disable-next-line no-console
      console.warn(
        `[drift] ${declaredButUnmounted.length} declared op(s) have no mounted handler ` +
          `(not-yet-built contract surface):\n  ${declaredButUnmounted.join('\n  ')}`,
      );
    }
    // No hard assertion on the count — this direction is informational by contract
    // with the QA lane. The B-086 gate above is the enforced invariant.
    expect(Array.isArray(declaredButUnmounted)).toBe(true);
  });
});
