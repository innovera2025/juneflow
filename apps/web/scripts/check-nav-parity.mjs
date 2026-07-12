// NAV route parity checker (P0-WEB-02 gate: "route ตรง NAV-ROUTES 100%").
//
// Proves apps/web/src/routes/registry.ts matches the extracted source of truth
// docs/extract/NAV-ROUTES.md exactly — by route id + component + file + parent.
// Dependency-free: parses the markdown by hand and loads the TS registry via
// Node's --experimental-strip-types (no vitest / no new package, so nothing is
// added to the root lockfile, which is out of the web zone).
//
// Run:  node --experimental-strip-types scripts/check-nav-parity.mjs
//   or: pnpm --filter @juneflow/web run check:routes
// Exit 0 = parity holds; exit 1 = drift (prints every mismatch).

import { readFile } from "node:fs/promises";

const NAV_URL = new URL("../../../docs/extract/NAV-ROUTES.md", import.meta.url);
const REG_URL = new URL("../src/routes/registry.ts", import.meta.url);

const errors = [];
const fail = (msg) => errors.push(msg);

// ---- parse NAV-ROUTES.md -----------------------------------------------------

const md = await readFile(NAV_URL, "utf8");
const lines = md.split(/\r?\n/);

// Heading offsets delimit the two route tables.
const headingIdx = (needle) => lines.findIndex((l) => l.startsWith("## ") && l.includes(needle));
const sidebarStart = headingIdx("ตาราง Route");
const extraStart = headingIdx("RouteView");
const parentStart = headingIdx("กติกา parent");
if (sidebarStart < 0 || extraStart < 0 || parentStart < 0) {
  console.error("check-nav-parity: could not locate the NAV-ROUTES.md table headings");
  process.exit(1);
}

const cellsOf = (line) =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

const backtick = (cell) => {
  const m = cell.match(/`([^`]+)`/);
  return m ? m[1] : null;
};
const jsxFile = (cell) => {
  const m = cell.match(/([A-Za-z0-9._-]+\.jsx)/);
  return m ? m[1] : null;
};
// First token of a parent cell; "—"/"-"/empty means top-level (null).
const parentToken = (cell) => {
  const tok = cell.split(/[\s(]/)[0];
  return /^[—–-]?$/.test(tok) ? null : tok;
};
// A data row is a table row whose first cell is a single backticked route id.
const routeIdOf = (cells) => {
  if (cells.length < 1) return null;
  const m = cells[0].match(/^`([A-Za-z0-9._-]+)`$/);
  return m ? m[1] : null;
};

// Sidebar table: | id | name | parent | component | file |
const navSidebar = new Map(); // id -> { component, file, parent }
for (let i = sidebarStart + 1; i < extraStart; i++) {
  const line = lines[i];
  if (!line.startsWith("|")) continue;
  const cells = cellsOf(line);
  const id = routeIdOf(cells);
  if (!id || cells.length < 5) continue;
  navSidebar.set(id, {
    component: backtick(cells[3]),
    file: jsxFile(cells[4]),
    parent: parentToken(cells[2]),
  });
}

// RouteView-only table: | id | label | component | file | access |
const navExtra = new Map(); // id -> { component, file }
const navLegacy = new Set(); // fin.* ids
for (let i = extraStart + 1; i < parentStart; i++) {
  const line = lines[i];
  if (!line.startsWith("|")) continue;
  const cells = cellsOf(line);
  const id = routeIdOf(cells);
  if (!id || cells.length < 4) continue;
  if (id.startsWith("fin.")) {
    navLegacy.add(id);
    continue;
  }
  navExtra.set(id, { component: backtick(cells[2]), file: jsxFile(cells[3]) });
}

// ---- load the registry -------------------------------------------------------

const reg = await import(REG_URL.href);
const { SIDEBAR_ROUTES, EXTRA_ROUTES, LEGACY_REDIRECTS, parentOf } = reg;

// ---- compare -----------------------------------------------------------------

const compareTable = (label, navMap, regRows, checkParent) => {
  const regById = new Map(regRows.map((r) => [r.id, r]));

  for (const id of navMap.keys()) {
    if (!regById.has(id)) fail(`${label}: route "${id}" is in NAV-ROUTES.md but missing from the registry`);
  }
  for (const id of regById.keys()) {
    if (!navMap.has(id)) fail(`${label}: route "${id}" is in the registry but not in NAV-ROUTES.md`);
  }
  for (const [id, nav] of navMap) {
    const r = regById.get(id);
    if (!r) continue;
    if (r.component !== nav.component)
      fail(`${label}: "${id}" component ${JSON.stringify(r.component)} != NAV ${JSON.stringify(nav.component)}`);
    if (r.file !== nav.file)
      fail(`${label}: "${id}" file ${JSON.stringify(r.file)} != NAV ${JSON.stringify(nav.file)}`);
    if (checkParent) {
      const p = parentOf(id);
      if (p !== nav.parent)
        fail(`${label}: "${id}" parentOf()=${JSON.stringify(p)} != NAV parent ${JSON.stringify(nav.parent)}`);
    }
  }
};

compareTable("sidebar", navSidebar, SIDEBAR_ROUTES, true);
compareTable("extra", navExtra, EXTRA_ROUTES, false);

// Legacy fin.* ids must match, and every redirect target must be a known route.
const allIds = new Set([...SIDEBAR_ROUTES, ...EXTRA_ROUTES].map((r) => r.id));
const regLegacy = new Set(LEGACY_REDIRECTS.map((r) => r.id));
for (const id of navLegacy) if (!regLegacy.has(id)) fail(`legacy: "${id}" in NAV-ROUTES.md but missing from LEGACY_REDIRECTS`);
for (const id of regLegacy) if (!navLegacy.has(id)) fail(`legacy: "${id}" in LEGACY_REDIRECTS but not in NAV-ROUTES.md`);
for (const r of LEGACY_REDIRECTS)
  if (!allIds.has(r.target)) fail(`legacy: "${r.id}" redirects to unknown route "${r.target}"`);

// No duplicate ids across the whole registry.
const seen = new Set();
for (const r of [...SIDEBAR_ROUTES, ...EXTRA_ROUTES, ...LEGACY_REDIRECTS]) {
  if (seen.has(r.id)) fail(`duplicate route id "${r.id}" in the registry`);
  seen.add(r.id);
}

// ---- report ------------------------------------------------------------------

const counts =
  `NAV-ROUTES.md: ${navSidebar.size} sidebar + ${navExtra.size} extra + ${navLegacy.size} legacy` +
  ` | registry: ${SIDEBAR_ROUTES.length} sidebar + ${EXTRA_ROUTES.length} extra + ${LEGACY_REDIRECTS.length} legacy`;

if (errors.length) {
  console.error(`check-nav-parity: FAIL (${errors.length} mismatch)`);
  for (const e of errors) console.error("  - " + e);
  console.error(counts);
  process.exit(1);
}

console.log("check-nav-parity: PASS — registry matches NAV-ROUTES.md 100%");
console.log(counts);
