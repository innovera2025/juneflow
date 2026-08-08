// B-323 · THE ENFORCEMENT, not another count.
//
// WHY THIS FILE EXISTS
// --------------------
// Three rounds hand-derived the population of tie-blind list comparators and published
// each number as authoritative: 5, then 7, then 10. Every time, the next review found
// survivors the count had missed — because the enumeration was done by eye and by
// `grep` for NAMED helpers, and most of the population is inline lambdas that no name
// search reaches. A fourth hand-count would be the same move a fourth time.
//
// So this test does not count anything. It ENUMERATES the api source's `.sort()` calls
// mechanically, MATERIALISES each comparator, and PROBES it with two rows that are equal
// on every property except one designated floor. A comparator that returns 0 for that
// pair is tie-blind: it hands the pair back to whatever order the input happened to have
// (the join plan), which is the defect B-323 exists to close.
//
// A new tie-blind `.sort()` written the ordinary way, anywhere under apps/api/src, fails
// this test by default. Nobody has to remember to update a list. (Blind spot 7 names the
// three unidiomatic shapes that would still slip past.)
//
// ---------------------------------------------------------------------------
// WHAT THIS MECHANISM CAN SEE
// ---------------------------------------------------------------------------
//  · Every `.sort(...)` / `.toSorted(...)` call written as a plain member call
//    (`xs.sort(…)`) in a NON-test file ending `.ts` under apps/api/src, found by walking
//    the TypeScript AST — inline arrow functions, inline function expressions,
//    identifier references to a local helper, and calls with no comparator at all.
//    Three shapes outside that description escape; blind spot 7 lists them.
//  · Whether that comparator, given two rows identical on every key it reads except
//    the declared floor, returns a finite non-zero, antisymmetric result.
//  · Whether a comparator that references other module-level declarations still does
//    so: dependencies are resolved transitively out of the same file, and imports of
//    ./list-order.js are bound to the real helpers.
//  · Whether an exemption in the registry below has gone stale (its comparator no
//    longer exists) — a stale exemption fails just as loudly as a missing one.
//  · Whether a SQL `.orderBy(` has appeared. The whole design orders in TypeScript
//    (see list-order.ts for why); a SQL clause would be a SECOND ordering surface this
//    scan does not model, so its appearance must break the build rather than pass
//    silently.
//
// WHAT THIS MECHANISM CANNOT SEE — the honest blind spots
// ---------------------------------------------------------------------------
//  1. SCOPE. apps/api/src only. NOT apps/web, NOT apps/mobile, NOT packages/db
//     (including the seed's own ordering), NOT tests.
//  2. NON-`.sort` ordering. `.reverse()`, a manual insertion loop, `Object.keys()`
//     iteration order, `Map` insertion order, and SQL `ORDER BY` are all invisible to
//     the probe. (`.orderBy(` is separately asserted absent; the rest are not.)
//  3. INDIRECTION. A comparator selected at runtime (`.sort(flag ? f : g)`), built by a
//     factory, or passed in as a parameter cannot be materialised. Those come out as
//     UNANALYSABLE and must be registered by hand — the registry entry is then a human
//     claim, not a proof.
//  4. CLOSURES. A comparator that reads a local of its enclosing FUNCTION (not the
//     module) cannot be lifted out and called. Also UNANALYSABLE → registry.
//  5. UNIQUENESS. The probe proves the comparator DISCRIMINATES on the declared floor.
//     It cannot prove that floor is unique across rows — that is a data fact. Where the
//     claim rests on a DB constraint the registry names it and this test verifies the
//     constraint still exists in the drizzle schema; where it rests on construction
//     (a Map key, an array index) the reason has to be read and believed.
//  6. CORRECTNESS OF THE ORDER. Total ≠ right. Nothing here says a list is sorted the
//     way the screen wants it; only that two runs agree.
//  7. CALL SHAPE AND FILE EXTENSION. The scan matches a CallExpression whose callee is a
//     PROPERTY-ACCESS named `sort`/`toSorted`, in a file whose name ends `.ts`. Three
//     shapes therefore pass unseen — each checked against that exact predicate, not
//     assumed: computed-member access (`rows["sort"](cmp)` parses as an ElementAccess-
//     Expression, so `isPropertyAccessExpression` is false),
//     `Array.prototype.sort.call(rows, cmp)` (the callee's property name is `call`, not
//     `sort`), and any `.mts` / `.cts` file (`"x.mts".endsWith(".ts")` is false, so the
//     walker never opens it). Deliberately NOT chased in code: the repo has zero (grep
//     for computed sort access = 0 hits; `.mts`/`.cts` files tracked = 0) and each needs
//     unidiomatic code to write, so an honest entry here beats a matcher grown to cover
//     shapes nobody uses. Distinct from blind spot 2, which is ordering achieved with no
//     `.sort` at all; these three ARE `.sort`, spelled so the matcher misses them.
//
// So: the number of tie-blind comparators is no longer published, because the number
// was never the deliverable. The property is enforced, and the enforcement's reach is
// written above.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { glAccounts } from "@juneflow/db";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as listOrder from "./list-order.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(SRC_ROOT, "..", "..", "..");

// ---------------------------------------------------------------------------
// The exemption registry.
//
// An entry is a claim that a comparator is deterministic for a reason the probe cannot
// establish by itself. Each one must say WHICH key closes the order and WHY that key
// cannot repeat. Entries are matched by (file, comparator-source prefix): if the
// comparator is edited the entry stops matching and the test fails, so a rewrite forces
// a re-read of the reason rather than inheriting it.
// ---------------------------------------------------------------------------
interface Exemption {
  /** Repo-relative file the comparator lives in. */
  file: string;
  /** Prefix of the comparator's normalised source ("«none»" for a bare `.sort()`). */
  starts: string;
  /** Property the probe must find discriminating (omit for unprobeable entries). */
  floor?: string;
  /** Value kind the floor is compared as. */
  floorKind?: "string" | "number";
  /** The probe cannot materialise this comparator — the reason is the only guard. */
  unprobeable?: true;
  /** A drizzle unique constraint that makes the floor unique; verified to exist. */
  uniqueBy?: { table: unknown; constraint: string };
  why: string;
}

const EXEMPT: Exemption[] = [
  {
    file: "apps/api/src/routes/gl.ts",
    starts: "(a, b) => { const ac = a.account_code ?? \"\";",
    floor: "account_code",
    floorKind: "string",
    uniqueBy: { table: glAccounts, constraint: "gl_account_company_code_uq" },
    why:
      "Trial-balance rows are a group-by aggregate: one row per gl_account id, labelled " +
      "with that account's code. Two rows can only tie on account_code if two accounts in " +
      "ONE company share a code, which the named unique constraint forbids. The row shape " +
      "ships on the wire and carries no id to fall back on, so the constraint is the floor.",
  },
  {
    file: "apps/api/src/routes/gl.ts",
    starts: "byCode",
    floor: "account_code",
    floorKind: "string",
    uniqueBy: { table: glAccounts, constraint: "gl_account_company_code_uq" },
    why:
      "Same shape as the trial balance, at the two statement builders (balance sheet / " +
      "income statement sections and the cash-flow sections). Both are Map-per-accountId " +
      "aggregates rendered as {account_code, account_name, amount}; account_code is unique " +
      "per company by the named constraint.",
  },
  {
    file: "apps/api/src/routes/dashboard.ts",
    starts: "(a, b) => a.due_date.localeCompare(b.due_date) || a._seq - b._seq",
    floor: "_seq",
    floorKind: "number",
    why:
      "The 7-day cash-flow ladder synthesises its rows from two source loops and ships " +
      "them straight out, so they carry no id. `_seq` is the insertion index attached " +
      "immediately before the sort and stripped immediately after: unique by " +
      "construction (0..n-1 over one array) and never on the wire.",
  },
  {
    file: "apps/api/src/routes/gl.ts",
    starts: "(a, b) => b.revenue - a.revenue ||",
    floor: "project_id",
    floorKind: "string",
    why:
      "Per-project P&L rows are a Map aggregate keyed by project id (\"\" = the " +
      "unallocated bucket), so project_id is one-per-row by construction. The rows have " +
      "no id, and the Map's insertion order comes from a JOINED jv_line read — i.e. it " +
      "IS join-plan order, so the insertion index would not be a floor here.",
  },
  {
    file: "apps/api/src/plugins/feature-flags.ts",
    starts: "«none»",
    why:
      "Two bare `.sort()` calls over the keys / entries of a Map. Map keys are unique by " +
      "construction, so the default lexicographic comparator can never see two equal " +
      "elements. Neither call is on a tenant read path — this is the flag snapshot for the " +
      "shell and debug output.",
  },
  {
    file: "apps/api/src/routes/gr.ts",
    starts: "(a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)",
    floor: "itemId",
    floorKind: "string",
    why:
      "B-340: a LOCK ORDER, not a list order — the only comparator in the tree whose " +
      "consumer is Postgres rather than a screen. inLockOrder() sorts a receipt's " +
      "stock_ledger inserts ascending by inventory_item id so their implicit FK " +
      "`FOR KEY SHARE` locks are acquired in the SAME direction as " +
      "TenantDb.selectForUpdate's `ORDER BY id FOR UPDATE`; opposite directions deadlocked " +
      "8 of 14 measured rounds (40P01 -> 500 -> the phone's offline drain wedged). It needs " +
      "an entry for TWO reasons the probe cannot settle by itself: the rows are stock " +
      "DRAFTS carrying no `id` at all (the probe's default floor), so the floor is declared " +
      "as `itemId`, on which it demonstrably discriminates; and a TIE here is NOT the B-323 " +
      "defect — two receipt lines naming the SAME item tie deliberately, and their relative " +
      "order is unobservable, because taking a row lock twice inside one transaction is a " +
      "no-op. Nothing sorted here is rendered or returned: the output is consumed only by " +
      "the INSERT loop. Reuse it to order something a reader sees and this entry stops " +
      "matching, which is the scan saying so.",
  },
  {
    file: "apps/api/src/routes/list-order.ts",
    starts: "(a, b) => { const ra = sourceRank(a);",
    unprobeable: true,
    why:
      "The inline comparator inside bySourceThenNewest closes over `sourceRank`, a " +
      "PARAMETER of the enclosing function, so it cannot be lifted to module scope and " +
      "called — blind spot 4. Its total-ness comes from the tail call to byNewestThenId " +
      "(itself probed here, at its own .sort sites) and is exercised by list-order.test.ts, " +
      "which feeds equal timestamps and asserts the id floor decides.",
  },
];

// ---------------------------------------------------------------------------
// AST enumeration
// ---------------------------------------------------------------------------

/** Every non-test `.ts` file under apps/api/src, repo-relative, sorted. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(SRC_ROOT);
  return out.sort().map((p) => relative(REPO_ROOT, p).split(sep).join("/"));
}

/** Collapse whitespace so a reformat does not silently unpin a registry entry. */
const normalise = (s: string): string => s.replace(/\s+/g, " ").trim();

interface Site {
  file: string;
  line: number;
  /** Normalised comparator source, or "«none»" for a bare `.sort()`. */
  source: string;
  /** The comparator argument node, or undefined for a bare `.sort()`. */
  arg: ts.Expression | undefined;
  sf: ts.SourceFile;
}

/**
 * Every `.sort(...)` / `.toSorted(...)` call site in one parsed file that is spelled as a
 * property access (`xs.sort(…)`). Computed access (`xs["sort"](…)`) and
 * `Array.prototype.sort.call(…)` are not matched — header blind spot 7.
 */
function sitesIn(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const found: Site[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "sort" || n.expression.name.text === "toSorted")
    ) {
      const arg = n.arguments[0];
      found.push({
        file,
        // The comparator's own line, not the call chain's head — that is the line a
        // reader greps for and the line the failure message has to point at.
        line: sf.getLineAndCharacterOfPosition((arg ?? n).getStart(sf)).line + 1,
        source: arg ? normalise(arg.getText(sf)) : "«none»",
        arg,
        sf,
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

// ---------------------------------------------------------------------------
// Materialisation: lift a comparator out of its file and make it callable
// ---------------------------------------------------------------------------

const GLOBALS = new Set([
  "Array", "BigInt", "Boolean", "Date", "Error", "Infinity", "Intl", "JSON", "Map",
  "Math", "NaN", "Number", "Object", "RegExp", "Set", "String", "Symbol", "TypeError",
  "isFinite", "isNaN", "parseFloat", "parseInt", "undefined",
]);

/** Identifiers a node uses but does not itself declare (types and property names skipped). */
function freeIdentifiers(node: ts.Node): Set<string> {
  const declared = new Set<string>();
  const used = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) || ts.isTypeParameterDeclaration(n)) return;
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) declared.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) declared.add(n.name.text);
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name) {
      declared.add(n.name.text);
    }
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) declared.add(n.name.text);
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isShorthandPropertyAssignment(p) && p.objectAssignmentInitializer !== n) ||
        (ts.isBindingElement(p) && p.propertyName === n) ||
        (ts.isMethodDeclaration(p) && p.name === n) ||
        (ts.isPropertySignature(p) && p.name === n);
      if (!isMemberName) used.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  for (const d of declared) used.delete(d);
  return used;
}

/** name -> module-scope declaration node (functions and variables only). */
function topLevelDecls(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.set(st.name.text, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.set(d.name.text, st);
      }
    }
  }
  return out;
}

/** local name -> module specifier, for every import in the file. */
function importsOf(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    const c = st.importClause;
    if (c.name) out.set(c.name.text, from);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
      for (const el of c.namedBindings.elements) out.set(el.name.text, from);
    }
  }
  return out;
}

type Comparator = (a: unknown, b: unknown) => number;

/**
 * Lift a comparator to module scope and compile it, dragging in the module-level
 * declarations it (transitively) needs and binding ./list-order.js imports to the real
 * helpers. Returns null when something cannot be resolved — that is blind spot 3/4, and
 * the caller turns it into a demand for a registry entry rather than a silent pass.
 */
function materialise(site: Site): Comparator | null {
  if (!site.arg) return null;
  const sf = site.sf;
  const decls = topLevelDecls(sf);
  const imports = importsOf(sf);

  const needed = new Map<string, ts.Node>();
  const injected = new Map<string, unknown>();
  const queue = [...freeIdentifiers(site.arg)];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (GLOBALS.has(name) || needed.has(name) || injected.has(name)) continue;
    const decl = decls.get(name);
    if (decl) {
      needed.set(name, decl);
      for (const f of freeIdentifiers(decl)) queue.push(f);
      continue;
    }
    const from = imports.get(name);
    if (from === "./list-order.js" && name in listOrder) {
      injected.set(name, (listOrder as Record<string, unknown>)[name]);
      continue;
    }
    return null; // unresolvable free identifier
  }

  // Source order keeps const/TDZ relationships as the original file had them.
  const body =
    [...new Set([...needed.values()])]
      .sort((a, b) => a.pos - b.pos)
      .map((n) => n.getText(sf))
      .join("\n") + `\nconst __CMP__ = (${site.arg.getText(sf)});`;

  const js = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const names = [...injected.keys()];
  try {
    // `exports` absorbs the `export` modifiers a lifted declaration may still carry.
    const factory = new Function(...names, "exports", `${js}\nreturn __CMP__;`);
    const fn = factory(...injected.values(), {}) as unknown;
    return typeof fn === "function" ? (fn as Comparator) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/**
 * Every property reads back the SAME value, so a and b are indistinguishable on every
 * key the comparator touches — except `floor`. A parseable ISO instant is used so a
 * `new Date(x).getTime()` path yields equal finite numbers rather than NaN on both
 * sides, which is the tie the real defect is made of.
 */
const TIE = "2026-01-01T00:00:00.000Z";

function probeRow(floor: string, value: unknown): unknown {
  return new Proxy(
    {},
    {
      get: (_t, p) => (typeof p === "string" ? (p === floor ? value : TIE) : undefined),
      has: () => true,
    },
  );
}

interface ProbeResult {
  total: boolean;
  detail: string;
}

/**
 * TOTAL means: two rows differing only in `floor` compare non-zero, finitely, and
 * antisymmetrically. Both a string floor and a numeric floor are tried because a
 * numeric tiebreak (`a.seq - b.seq`) and a lexical one (`a.id < b.id`) need different
 * probe values; discriminating under either is discrimination.
 */
function probe(cmp: Comparator, floor: string, kind?: "string" | "number"): ProbeResult {
  const pairs: [unknown, unknown][] =
    kind === "string"
      ? [["aaa", "bbb"]]
      : kind === "number"
        ? [[1, 2]]
        : [
            ["aaa", "bbb"],
            [1, 2],
          ];
  const notes: string[] = [];
  for (const [lo, hi] of pairs) {
    let ab: number;
    let ba: number;
    try {
      ab = cmp(probeRow(floor, lo), probeRow(floor, hi));
      ba = cmp(probeRow(floor, hi), probeRow(floor, lo));
    } catch (e) {
      notes.push(`threw on ${JSON.stringify(lo)}/${JSON.stringify(hi)}: ${String(e)}`);
      continue;
    }
    if (!Number.isFinite(ab) || !Number.isFinite(ba)) {
      notes.push(`non-finite result ${String(ab)}/${String(ba)} on ${JSON.stringify(lo)}`);
      continue;
    }
    if (ab === 0) {
      notes.push(`returned 0 for rows differing only in "${floor}" (${JSON.stringify(lo)})`);
      continue;
    }
    if (Math.sign(ab) !== -Math.sign(ba)) {
      notes.push(`not antisymmetric: ${ab} vs ${ba}`);
      continue;
    }
    return { total: true, detail: `discriminates on "${floor}"` };
  }
  return { total: false, detail: notes.join(" · ") || "no probe succeeded" };
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

interface Verdict {
  site: Site;
  status: "TOTAL" | "EXEMPT" | "TIE-BLIND" | "UNANALYSABLE";
  detail: string;
}

function classify(): { verdicts: Verdict[]; used: Set<number> } {
  const verdicts: Verdict[] = [];
  const used = new Set<number>();

  for (const file of sourceFiles()) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    if (!text.includes(".sort(") && !text.includes(".toSorted(")) continue;
    for (const site of sitesIn(file, text)) {
      const idx = EXEMPT.findIndex(
        (e) => e.file === site.file && site.source.startsWith(normalise(e.starts)),
      );
      const ex = idx >= 0 ? EXEMPT[idx] : undefined;
      if (ex) used.add(idx);

      if (ex?.unprobeable || ex?.floor === undefined) {
        if (ex) {
          verdicts.push({ site, status: "EXEMPT", detail: ex.why });
          continue;
        }
      }

      const cmp = materialise(site);
      if (!cmp) {
        verdicts.push({
          site,
          status: ex ? "EXEMPT" : "UNANALYSABLE",
          detail: ex ? ex.why : "could not be lifted to module scope (blind spot 3/4)",
        });
        continue;
      }
      const r = probe(cmp, ex?.floor ?? "id", ex?.floorKind);
      verdicts.push({
        site,
        status: r.total ? (ex ? "EXEMPT" : "TOTAL") : "TIE-BLIND",
        detail: r.detail,
      });
    }
  }
  return { verdicts, used };
}

describe("B-323 · list comparators are enforced TOTAL, not counted", () => {
  const { verdicts, used } = classify();

  it("finds enough .sort sites for the scan to be believable", () => {
    // NOT a completeness claim — a floor that fails loudly if the walker, the parser or
    // the path resolution silently stops finding anything. The real assertion is below.
    expect(verdicts.length).toBeGreaterThan(30);
  });

  it("has no tie-blind comparator anywhere under apps/api/src", () => {
    const bad = verdicts.filter((v) => v.status === "TIE-BLIND" || v.status === "UNANALYSABLE");
    const report = bad
      .map((v) => `  ${v.site.file}:${v.site.line}  [${v.status}]  ${v.detail}\n      ${v.site.source}`)
      .join("\n");
    expect(
      bad.length,
      `\n${bad.length} comparator(s) can return 0 for two distinct rows — their order is the\n` +
        `join plan's, not the code's. Give each a total order (see list-order.ts), or add an\n` +
        `entry to EXEMPT in this file naming the key that closes it and why it cannot repeat.\n\n` +
        `${report}\n`,
    ).toBe(0);
  });

  it("has no stale exemption", () => {
    const stale = EXEMPT.filter((_e, i) => !used.has(i)).map((e) => `${e.file} :: ${e.starts}`);
    expect(
      stale,
      "an exemption no longer matches any comparator — the code moved on and the reason " +
        "was not re-read:\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("verifies the DB constraints the exemptions lean on still exist", () => {
    for (const e of EXEMPT) {
      if (!e.uniqueBy) continue;
      const cfg = getTableConfig(e.uniqueBy.table as Parameters<typeof getTableConfig>[0]);
      const names = cfg.uniqueConstraints.map((u) => u.name);
      expect(
        names,
        `${e.file} :: ${e.starts} is exempt because ${e.uniqueBy.constraint} makes its ` +
          `floor unique. That constraint is gone from the schema, so the exemption no ` +
          `longer holds.`,
      ).toContain(e.uniqueBy.constraint);
    }
  });

  it("keeps ordering in TypeScript — no SQL .orderBy( has appeared", () => {
    // list-order.ts explains why the order is applied to resolved rows and not pushed
    // into the read doors. A SQL clause would be a second ordering surface that this
    // scan cannot model, so it must break the build rather than pass unseen.
    //
    // ONE NARROW CARVE-OUT (B-342): an `.orderBy(...)` that is part of a
    // `… .orderBy(x).for("update")` chain is a LOCK ORDER, not a presentation order.
    // TenantDb.selectForUpdate sorts so its callers acquire overlapping row sets in one
    // ascending direction; its result is used only for a `.length` check and is NEVER
    // rendered, so this scan stays blind to nothing. (Deadlock-freedom is a REPO-WIDE
    // invariant, not this clause's property — the implicit FK locks a stock_ledger INSERT
    // takes must run the same direction, which is what gr.ts inLockOrder() does. See the
    // selectForUpdate comment in tenant-db.ts, and B-340.)
    // The carve-out requires `.for("update")` IN THE SAME STATEMENT: a bare
    // `.orderBy(` anywhere — including elsewhere in tenant-db.ts — still breaks the build.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(join(REPO_ROOT, file), "utf8");
      const ordersWithoutLocking = src
        .split(";")
        .some((stmt) => stmt.includes(".orderBy(") && !stmt.includes('.for("update")'));
      if (ordersWithoutLocking) offenders.push(file);
    }
    expect(offenders, "SQL ordering appeared; this scan only models TypeScript sorts").toEqual([]);
  });
});
