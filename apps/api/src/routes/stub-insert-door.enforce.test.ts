// B-386 · THE INSERT-DOOR BLIND SPOT, enforced instead of swept for again.
//
// WHY THIS FILE EXISTS
// --------------------
// `TenantDb` has TWO insert doors, and a test stub that models only one is blind to
// the other in a way nothing announces:
//
//   · insertThrough() and insert(...).returning() END in `.returning()`.
//   · the plain scoped insert() does NOT — db/tenant-db.ts returns
//     `db.insert(table).values(row)` and the CALLER awaits that builder directly.
//
// A stub whose `values(...)` exposes only `returning` hands the second door an object
// with no `then`. `await` on a non-thenable resolves to the object itself, so the write
// completes, raises nothing, and is NEVER RECORDED. Every
// `expect(inserted.find(w => w.table === X)).toBeUndefined()` about such a write then
// holds whatever the handler does — the assertion cannot fail.
//
// This was found twice by hand. B-376 found it in gr.test.ts, where 4 absence
// assertions about stock_ledger were provably vacuous (inject a reversal: 4 tests fail
// with a both-doors stub, the same 4 PASS with the old one). B-386 then swept the
// siblings — and the sweep's own premise turned out to be wrong in both directions: the
// two files it named as carrying bare-door writes carry none, while 32 stubs it had not
// looked at have the blind shape. A third hand-sweep would be the same move a third
// time, so this file derives the population instead of listing it.
//
// B-388 then converted all 32 (34 doors — admin.test.ts carried three) and deleted the
// allowlist B-386 had parked them in; see the note where it used to live, below. Every
// stub insert door in apps/api now captures both doors, and each converted file carries
// its own single-recording evidence, because this test proves a `then` key exists and
// NOT that it records correctly (blind spot 2).
//
// WHAT THIS MECHANISM CAN SEE
// ---------------------------
//  · Every stub insert door under apps/api/src: a `insert:` property (or method) whose
//    body exposes a `values:` property (or method), found by walking the TypeScript AST
//    of every `*.test.ts` file. Both stub shapes in the repo are matched — the concise
//    `values: (v) => ({ returning, then })` and the block form that computes a `record()`
//    first and then returns the object.
//  · Which of `returning` / `then` each door's RETURNED object literal exposes, and so
//    whether the door can observe a bare `TenantDb.insert()` at all.
//  · Every bare-door WRITE in non-test source: a `.insert(table, values)` call (the
//    2-argument TenantDb signature) whose chain does not terminate in `.returning()`.
//    Comments and string bodies are stripped first, so prose cannot create or hide one.
//  · Whether the registry below has gone stale in either direction — a bare-door writer
//    with no entry, an entry whose writer is gone, or a changed site count.
//  · Whether the hazard still exists at all: that TenantDb.insert() itself still omits
//    `.returning()`. If that ever changes, this whole file is obsolete and says so.
//
// WHAT IT CANNOT SEE — the honest blind spots
// -------------------------------------------
//  1. SHAPE OF THE STUB. The door must be spelled as an object property/method named
//     `insert` containing one named `values`. A stub built by a factory, spread in from
//     another object, or assigned (`raw.insert = ...`) is not matched. Checked, not
//     assumed: every stub in apps/api today uses the literal shape (the scan finds 38
//     doors across 36 files — admin.test.ts carries three — and the believability floor
//     below fails if that collapses; the floor asserts a threshold, not this number, so
//     the count is documentation and nothing depends on it).
//  2. WHAT THE DOOR DOES WITH THE CALL. It proves a `then` key exists on the returned
//     object. It does NOT prove `then` records into the same array `returning` does, nor
//     that it models a throw identically. A THIRD limit, worth stating because the
//     blocker row that commissioned this guard got it imprecise: the bare-write matcher
//     keys on `n.arguments.length >= 2`, so it sees only the two-argument TenantDb door.
//     Five raw-drizzle inserts are awaited directly and are invisible to it —
//     plugins/audit-log.ts:228 and auth-provisioning.ts:330/338/398/463. None is reachable
//     from a vacuous assertion today (audit-log.test.ts defines no insert door, and
//     createDbAuditSink is wired only in app.ts), but "the only bare-door calls in
//     apps/api/src" is true of TenantDb.insert(table, values) and of nothing wider. A `then: () => Promise.resolve([])` that
//     records nothing would pass this scan and still be blind — which is why B-388 gave
//     every converted stub its own SINGLE-RECORDING EVIDENCE (one bare-door write records
//     exactly +1, asserted at the foot of each file) rather than relying on this test
//     alone. admin.test.ts's wFake is the case in point: its door recorded nothing through
//     EITHER path, so a bare `then` would have satisfied this scan and left the "INSERT is
//     denied" assertion exactly as unfalsifiable — it was given a recorder instead.
//  3. INDIRECTION IN THE WRITE. A bare-door write reached through a variable table
//     (`const t = stockLedgers; db.insert(t, row)`) or via a helper taking the table as
//     a parameter is still FOUND (the scan keys on argument count, not on the argument
//     being an identifier), but its table name is reported as the expression text.
//  4. SCOPE. apps/api/src only — not packages/db, not the seed, not apps/web|mobile.
//  5. THE OTHER DOORS. `TenantDb.update()` has the identical hazard and is NOT enforced
//     here: subscription.ts is its only bare-door caller and subscription.test.ts is
//     already the one update stub capturing both paths. `delete()` captures at `.where()`,
//     which TenantDb.delete always calls, so it is not blind. Both are asserted below as
//     narrow facts so a change makes this comment fail rather than quietly rot.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(SRC_ROOT, "..", "..", "..");

// ---------------------------------------------------------------------------
// The bare-door writer registry.
//
// One entry per non-test file containing `.insert(table, values)` calls that do NOT end
// in `.returning()`. `stubs` names the test files whose stub MUST therefore capture both
// doors — those are the assertions that would otherwise be unfalsifiable. A new bare-door
// write anywhere fails the derivation test until it is registered, which is the moment
// someone has to say which stub needs to grow.
// ---------------------------------------------------------------------------
interface BareDoorWriter {
  /** Repo-relative non-test file. */
  file: string;
  /** Number of bare-door `.insert(t, v)` statements expected in it. */
  sites: number;
  /** Test files whose stub must capture BOTH doors because of these writes. */
  stubs: string[];
  why: string;
}

const BARE_DOOR_WRITERS: BareDoorWriter[] = [
  {
    file: "apps/api/src/routes/gr.ts",
    sites: 2,
    stubs: ["apps/api/src/routes/gr.test.ts"],
    why:
      "createGr and reverseGrMovements each write stock_ledger through the plain scoped " +
      "insert() and await it directly — a receipt only ever RAISES a balance, so neither " +
      "needs the inserted row back. These are the only bare-door writes in apps/api, and " +
      "they are what made 4 stock_ledger absence assertions in gr.test.ts vacuous until " +
      "B-376 taught that stub the second door.",
  },
];

// ---------------------------------------------------------------------------
// B-388 · THE ALLOWLIST IS GONE — this is the note that explains the empty space.
//
// B-386 shipped with a BLIND_STUBS_ALLOWED array naming the 32 stubs that still
// captured only `.returning()`, so nothing went red on the day the guard landed. All 32
// have since been converted (34 doors — admin.test.ts carried three), which left the
// array empty and its staleness test with nothing to check.
//
// It was DELETED rather than kept empty, for one reason: an empty allowlist whose
// staleness test can never fail is a test that reports green without discriminating —
// the exact pathology the believability floor below exists to catch, in miniature. It
// also advertises an escape hatch this file's own instruction contradicts ("capture both
// doors rather than extending the allowlist"). With it gone, re-admitting a blind stub
// means weakening the assertion itself: a visible, reviewable act rather than one more
// name on a list.
//
// NOTHING THE GUARD CAN CATCH CHANGED. The offender test below filtered `blind` by
// `!allowed.has(file)`; against an empty allowlist that filter was already a no-op, so
// dropping it reports exactly the same set, with the same message naming the same files.
// Only the (by then vacuous) staleness test is gone.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function filesUnder(pred: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(e.name)) out.push(p);
    }
  };
  walk(SRC_ROOT);
  return out.sort().map((p) => relative(REPO_ROOT, p).split(sep).join("/"));
}

const testFiles = (): string[] => filesUnder((n) => n.endsWith(".test.ts"));
const sourceFiles = (): string[] =>
  filesUnder((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));

// ---------------------------------------------------------------------------
// Stub-door classification (AST)
// ---------------------------------------------------------------------------

type DoorKind = "BOTH" | "RETURNING_ONLY" | "THEN_ONLY" | "UNRECOGNISED";

interface StubDoor {
  file: string;
  line: number;
  kind: DoorKind;
  /** Property names found on the object the `values(...)` call returns. */
  exposes: string[];
}

/** The function body of a property or method named `name`, if it is function-like. */
function functionNamed(node: ts.Node, name: string): ts.FunctionLikeDeclaration | undefined {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAssignment(n) &&
      ((ts.isIdentifier(n.name) && n.name.text === name) ||
        (ts.isStringLiteral(n.name) && n.name.text === name)) &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      found = n.initializer;
      return;
    }
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;

/** Object literals a function-like RETURNS (concise body, or `return {...}` in a block). */
function returnedObjectLiterals(fn: ts.FunctionLikeDeclaration): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];
  const body = fn.body;
  if (!body) return out;
  if (!ts.isBlock(body)) {
    const e = unwrap(body);
    if (ts.isObjectLiteralExpression(e)) out.push(e);
    return out;
  }
  const visit = (n: ts.Node): void => {
    // Do not descend into nested functions — their returns are not this one's.
    if (n !== body && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))) return;
    if (ts.isReturnStatement(n) && n.expression) {
      const e = unwrap(n.expression);
      if (ts.isObjectLiteralExpression(e)) out.push(e);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

function propertyNames(obj: ts.ObjectLiteralExpression): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    const n = p.name;
    if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n))) out.push(n.text);
  }
  return out;
}

/** Every stub insert door in one parsed source. Also driven directly by the self-probe. */
function doorsInSource(file: string, text: string): StubDoor[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const doors: StubDoor[] = [];
  const visit = (n: ts.Node): void => {
    const isInsert =
      (ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === "insert" &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) ||
      (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "insert");
    if (isInsert) {
      const insertFn = ts.isPropertyAssignment(n)
        ? (n.initializer as ts.FunctionLikeDeclaration)
        : (n as ts.MethodDeclaration);
      const valuesFn = insertFn.body ? functionNamed(insertFn.body, "values") : undefined;
      if (valuesFn) {
        const exposes = [
          ...new Set(returnedObjectLiterals(valuesFn).flatMap(propertyNames)),
        ].sort();
        const hasRet = exposes.includes("returning");
        const hasThen = exposes.includes("then");
        doors.push({
          file,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          kind: hasRet && hasThen ? "BOTH" : hasRet ? "RETURNING_ONLY" : hasThen ? "THEN_ONLY" : "UNRECOGNISED",
          exposes,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return doors;
}

// ---------------------------------------------------------------------------
// Bare-door write enumeration (source text, comments stripped)
// ---------------------------------------------------------------------------

interface BareWrite {
  file: string;
  line: number;
  table: string;
}

/**
 * Comments and string BODIES blanked, offsets and newlines preserved. Prose describing
 * `.insert(t, v)` must not register as one — boq.ts carries exactly such a comment, and
 * an earlier hand-sweep counted it.
 */
function codeOnly(src: string): string {
  const a = src.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < a.length; k++) if (a[k] !== "\n") a[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const e = j === -1 ? src.length : j + 2;
      blank(i, e);
      i = e;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return a.join("");
}

/** `.insert(table, values)` calls (the 2-arg TenantDb door) whose chain omits .returning(). */
function bareDoorWrites(file: string, text: string): BareWrite[] {
  const sf = ts.createSourceFile(file, codeOnly(text), ts.ScriptTarget.ES2022, true);
  const out: BareWrite[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "insert" &&
      n.arguments.length >= 2
    ) {
      // Walk OUT through the call chain: `.insert(t,v).returning()` has the insert call
      // as the expression of a property access whose name is `returning`.
      let terminates = false;
      let cur: ts.Node = n;
      while (
        cur.parent &&
        ts.isPropertyAccessExpression(cur.parent) &&
        cur.parent.expression === cur
      ) {
        const access = cur.parent;
        if (access.name.text === "returning") {
          terminates = true;
          break;
        }
        cur = access.parent && ts.isCallExpression(access.parent) ? access.parent : access;
      }
      if (!terminates) {
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          table: n.arguments[0]!.getText(sf).trim(),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------

function allDoors(): StubDoor[] {
  return testFiles().flatMap((f) =>
    doorsInSource(f, readFileSync(join(REPO_ROOT, f), "utf8")),
  );
}

function allBareWrites(): BareWrite[] {
  return sourceFiles().flatMap((f) => {
    // tenant-db.ts DEFINES the door; its own `db.insert(table).values(row)` is the raw
    // drizzle 1-arg call, not a TenantDb 2-arg one, so it is not matched here anyway.
    const text = readFileSync(join(REPO_ROOT, f), "utf8");
    return bareDoorWrites(f, text);
  });
}

describe("B-386 · stub insert doors are enforced, not swept for", () => {
  const doors = allDoors();
  const bare = allBareWrites();

  it("finds enough stub insert doors for the scan to be believable", () => {
    // NOT a completeness claim — a floor that fails loudly if the walker, the parser or
    // the path resolution silently stops matching. A scanner that quietly finds nothing
    // is the same defect this file exists to close, in a new place: it would report a
    // clean sweep over zero files. The real assertions are below.
    expect(
      doors.length,
      "the stub-door scan matched (almost) nothing — the AST shape it keys on has " +
        "changed, or the walk is looking at the wrong root. Fix the scan; do not lower " +
        "this floor.",
    ).toBeGreaterThan(25);
    expect(
      doors.filter((d) => d.kind === "BOTH").length,
      "no stub captures BOTH doors, which cannot be true while gr.test.ts and the three " +
        "B-386 files exist — the classifier has stopped recognising `then`.",
    ).toBeGreaterThan(0);
  });

  it("classifies a known blind door and a known fixed door correctly (probes itself)", () => {
    // The scan's own discrimination, proven on synthetic source rather than assumed.
    // Every assertion above is worthless if the classifier cannot tell the doors apart,
    // and it would still pass a green run in that state.
    const blind = `const s = { insert: (t) => ({ values: (v) => ({ returning: () => [] }) }) };`;
    const fixed = `const s = { insert: (t) => ({ values: (v) => ({ returning: () => [], then: (ok) => ok([]) }) }) };`;
    const block = `const s = { insert: (t) => ({ values: (v) => { const rec = () => [];
      return { returning: () => rec(), then: (ok) => ok(rec()) }; } }) };`;
    const noDoor = `const s = { select: () => ({ from: (t) => t }) };`;
    expect(doorsInSource("blind.ts", blind).map((d) => d.kind)).toEqual(["RETURNING_ONLY"]);
    expect(doorsInSource("fixed.ts", fixed).map((d) => d.kind)).toEqual(["BOTH"]);
    expect(doorsInSource("block.ts", block).map((d) => d.kind)).toEqual(["BOTH"]);
    expect(doorsInSource("none.ts", noDoor)).toEqual([]);
  });

  it("still has a hazard to enforce: TenantDb.insert() omits .returning()", () => {
    // The premise, asserted. If the plain door is ever changed to RETURNING, every
    // `.returning()`-only stub stops being blind and this whole file is obsolete —
    // which should be a loud failure telling someone to delete it, not a silent pass.
    const text = readFileSync(join(REPO_ROOT, "apps/api/src/db/tenant-db.ts"), "utf8");
    const sf = ts.createSourceFile("tenant-db.ts", codeOnly(text), ts.ScriptTarget.ES2022, true);
    let insertBody: string | undefined;
    const visit = (n: ts.Node): void => {
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "insert") {
        insertBody = n.getText(sf);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(insertBody, "TenantDb.insert() was not found — this scan's premise moved").toBeDefined();
    expect(
      insertBody!.includes(".returning()"),
      "TenantDb.insert() now ends in .returning(). The two-door hazard is gone, so this " +
        "entire file — and the `then` door on all 38 doors across 36 stub files — " +
        "should be deleted rather than maintained.",
    ).toBe(false);
  });

  it("derives every bare-door writer from source, and the registry covers them", () => {
    const derived = [...new Set(bare.map((b) => b.file))].sort();
    const registered = [...new Set(BARE_DOOR_WRITERS.map((w) => w.file))].sort();
    expect(
      derived,
      "a file writing through the BARE TenantDb.insert() door appeared or disappeared. " +
        "Such a write is invisible to any stub that captures only `.returning()`, which " +
        "silently makes every absence assertion about it unfalsifiable. Add a " +
        "BARE_DOOR_WRITERS entry naming the test stubs that must capture both doors — or " +
        "give the write a `.returning()` and it stops being a hazard.",
    ).toEqual(registered);
  });

  it("holds each registered bare-door writer to its declared site count", () => {
    for (const w of BARE_DOOR_WRITERS) {
      const mine = bare.filter((b) => b.file === w.file);
      expect(
        mine.length,
        `${w.file} was registered with ${w.sites} bare-door write(s) and now has ` +
          `${mine.length} (${mine.map((m) => `${m.line}:${m.table}`).join(", ")}). The reason ` +
          `on the entry has to be re-read:\n  ${w.why}`,
      ).toBe(w.sites);
    }
  });

  it("requires BOTH doors on every stub a bare-door writer depends on", () => {
    // THE CORRECTNESS PROPERTY. Everything else in this file is hygiene; this is the
    // assertion that would have caught B-376 and B-386 before they were found by hand.
    for (const w of BARE_DOOR_WRITERS) {
      for (const stub of w.stubs) {
        const mine = doors.filter((d) => d.file === stub);
        expect(
          mine.length,
          `${stub} is registered as the stub for ${w.file}'s bare-door writes but defines ` +
            `no insert door the scan can see.`,
        ).toBeGreaterThan(0);
        for (const d of mine) {
          expect(
            d.kind,
            `${d.file}:${d.line} captures only [${d.exposes.join(", ")}], but ${w.file} writes ` +
              `through the bare TenantDb.insert() door, which never calls .returning(). ` +
              `Those writes are therefore NOT recorded, and every ` +
              `\`expect(inserted.find(...)).toBeUndefined()\` in this file about them holds ` +
              `whatever the handler does. Capture the awaited-directly door too (see ` +
              `gr.test.ts).\n  ${w.why}`,
          ).toBe("BOTH");
        }
      }
    }
  });

  it("admits NO blind stub, anywhere (B-388: the allowlist is empty and deleted)", () => {
    const offenders = doors
      .filter((d) => d.kind !== "BOTH")
      .map((d) => `  ${d.file}:${d.line}  [${d.kind}] exposes [${d.exposes.join(", ")}]`);
    expect(
      offenders,
      `\n${offenders.length} stub insert door(s) capture only \`.returning()\`. A write ` +
        `through the plain scoped TenantDb.insert() would go unrecorded, making absence ` +
        `assertions about it unfalsifiable. Capture both doors — every stub in apps/api ` +
        `already does, so copy the nearest one (gr.test.ts and inventory.test.ts are the ` +
        `richest: they thread insertThrows/onInsert through both paths). Route both doors ` +
        `through ONE record() closure invoked once per door call, and carry the ` +
        `single-recording evidence at the foot of the file: one bare-door write must ` +
        `record exactly +1. Do NOT re-introduce an allowlist.\n\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("pins the two sibling doors this file deliberately does NOT enforce (blind spot 5)", () => {
    // Header blind spot 5, asserted rather than trusted, so the claim cannot rot quietly.
    //
    // update(): the SAME hazard — TenantDb.update() awaits its builder without
    // .returning(). It needs no enforcement only because subscription.ts is its one
    // bare-door caller and subscription.test.ts is the one update stub capturing both.
    // If a second bare-door update appears, that coincidence ends.
    const bareUpdaters: string[] = [];
    for (const f of sourceFiles()) {
      const text = codeOnly(readFileSync(join(REPO_ROOT, f), "utf8"));
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true);
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "update" &&
          n.arguments.length >= 2 &&
          // NOT the db door when the 2nd argument is a string: that is
          // `createHash(...).update(token, "utf8")`, whose arity collides with
          // `update(table, set, where)`. The real door's 2nd argument is the `set`
          // object. This scan found that call on its first run, which is the matcher
          // being narrowed by evidence rather than by guesswork.
          !ts.isStringLiteral(n.arguments[1]!) &&
          !ts.isNoSubstitutionTemplateLiteral(n.arguments[1]!) &&
          !(
            n.parent &&
            ts.isPropertyAccessExpression(n.parent) &&
            n.parent.name.text === "returning"
          )
        ) {
          if (!bareUpdaters.includes(f)) bareUpdaters.push(f);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(
      bareUpdaters.sort(),
      "the set of files awaiting a bare TenantDb.update() changed. subscription.test.ts " +
        "is the only update stub that captures both paths, so a new bare-door updater " +
        "elsewhere is blind exactly as the insert door was — extend this file to cover " +
        "update() rather than editing this expectation.",
    ).toEqual(["apps/api/src/routes/subscription.ts"]);

    // delete(): captures at `.where()`, which TenantDb.delete always calls, so a delete
    // stub cannot be blind the way an insert stub can. Pinned so that stays true.
    const deleteStubs = testFiles().filter((f) =>
      /\n\s*delete:\s*\(/.test(readFileSync(join(REPO_ROOT, f), "utf8")),
    );
    expect(deleteStubs.sort()).toEqual([
      "apps/api/src/routes/org-units.test.ts",
      "apps/api/src/routes/users.test.ts",
    ]);
  });
});
