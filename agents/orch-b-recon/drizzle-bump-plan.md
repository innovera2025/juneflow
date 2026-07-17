<!-- orch-B recon · READ-ONLY plan · nothing bumped/edited · 2026-07-17 -->
# drizzle-orm 0.38.4 → 0.45.2 — safe bump + verify plan (for orch-A, Wei-gated)

**Why:** GHSA-gpj5-g38j-94v9 / CVE-2026-39356 (HIGH, CVSS 7.5) — SQL injection via improperly
escaped SQL identifiers in `escapeName()` (`sql.identifier()` / `sql.as()`). Vulnerable `<0.45.2`,
patched `>=0.45.2`. Current: `drizzle-orm@0.38.4` (declared `^0.38.3` in `packages/db/package.json`
+ `apps/api/package.json`). See `agents/orch-b-recon/dep-vuln.md`.

**Gating:** dependency + lockfile = platform/Wei-gated. This doc is a READ-ONLY checklist — orch-A
runs it the instant Wei greenlights. Nothing here has been applied.

**App exposure (verified this recon):** the app has **zero direct call sites** on the vulnerable
path — `grep` for `sql.identifier`, dynamic `.as("…")` aliases, `orderBy`, relational-query API
(`db.query.*`), CTE (`.with`/`$with`), `union` → **all empty** in `apps/api/src` + `packages/db/src`
(non-test). The only `sql.raw`/`sql\`\`` sites are CODE-supplied: `tenant-db.ts` `sql.raw(column.getSQLType())`
(static schema-type string) + the CASE builder; `seed/index.ts` TRUNCATE list (from `pg_tables`);
`extensions.ts` `upper(${t.code})` partial-index expression (schema literal). So the bump is
**defense-in-depth**, not an active-exploit patch — which is exactly why it can be scheduled calmly
and reverted freely.

---

## Pre-flight facts gathered (so orch-A doesn't re-derive them)

| Fact | Value | Source |
|---|---|---|
| Installed now | `drizzle-orm@0.38.4`, `drizzle-kit@0.30.6` | `node_modules/.pnpm/…`, lockfile |
| Target (latest patched 0.45.x) | **`drizzle-orm@0.45.2`** (0.45.0/1/2 exist; 0.45.2 IS the fix + newest stable; 1.0.0 is beta-only — DO NOT go to 1.0.0-beta.x) | `npm view drizzle-orm versions` |
| drizzle-kit target | **`drizzle-kit@0.31.10`** (latest 0.31.x; ≥0.31.4 required by better-auth peer) | `npm view drizzle-kit versions` |
| Migration snapshot format | `version: "7"`, `dialect: postgresql` — **unchanged** between drizzle-kit 0.30.x and 0.31.x (no snapshot rewrite expected) | `packages/db/drizzle/meta/_journal.json` + `0025_snapshot.json` |
| Migrations on disk | `0000`–`0025` (26) + meta snapshots; merged = **sacred** (never regenerate/commit a new one) | `packages/db/drizzle/` |
| better-auth alignment | installed `better-auth@1.6.23` peer-deps `drizzle-orm: ^0.45.2` + `drizzle-kit: >=0.31.4` (both `optional:true`). **The bump SATISFIES an existing unmet peer** — it aligns, not conflicts. | lockfile lines 320/1390-1391 |
| API test baseline | ~**447** `it/test` blocks across 31 `apps/api/src/**/*.test.ts` (prompt says 457 — likely incl. `packages/db`; orch-A must record the exact GREEN count BEFORE bumping) | `grep -c` |
| Relational-query API | **NOT used** anywhere (`db.query.*` = 0 hits) → the single biggest 0.3x→0.4x churn area does not apply | grep |
| Generated columns / customType / `.array()` / `.$type()` | **NOT used** in schema → no generated-column or custom-type breakage surface | grep |

**drizzle API surface this repo actually uses** (the whole blast radius):
- Query builder: `.select().from().where()`, `.insert().values().returning()`, `.update().set().where().returning()`, `.delete().where()`, `.innerJoin()`, `.$dynamic()` (only `tenant-db.ts:173`).
- Operators: `and, eq, or, isNull, inArray, getTableColumns` (`drizzle-orm`).
- SQL templating: `` sql`` ``, `sql.raw`, `sql.join` (`tenant-db.ts`, `seed`, `extensions.ts`).
- Column/table helpers: `column.getSQLType()` (`tenant-db.ts:388`), `.toSQL()` (tests), `PgColumn/PgTable/PgUpdateSetSource/PgDialect/SQL` types.
- Type inference: `$inferSelect` / `$inferInsert` (55 hits).
- Driver: `drizzle-orm/node-postgres` (`drizzle`, `NodePgDatabase`, `Pool`), `tx.execute()`.
- Schema DSL: `pgTable, pgEnum(30), uuid/text/timestamp/numeric/date/integer/jsonb/boolean, index/uniqueIndex (array-callback form), .references/.notNull/.default/.defaultNow`, `timestamp({withTimezone,mode:"date"})`, `numeric({precision,scale})`, one expression+partial `uniqueIndex` (`extensions.ts:570`).

---

## 1 · The bump steps

1. **Edit `packages/db/package.json`** (2 lines):
   - `dependencies.drizzle-orm`: `"^0.38.3"` → `"0.45.2"` (pin exact).
   - `devDependencies.drizzle-kit`: `"^0.30.1"` → `"0.31.10"` (pin exact).
2. **Edit `apps/api/package.json`** (1 line):
   - `dependencies.drizzle-orm`: `"^0.38.3"` → `"0.45.2"` (pin exact).
   > Keep both drizzle-orm specifiers byte-identical (`0.45.2`) so pnpm dedupes to ONE instance —
   > a split instance would break `instanceof`/table-symbol checks across the `@juneflow/db` ↔ `apps/api` boundary.
3. **`pnpm install`** from repo root (regenerates `pnpm-lock.yaml`).
4. **Lockfile churn audit** — `git diff --stat pnpm-lock.yaml` then eyeball `git diff pnpm-lock.yaml`. **Expected to move:** `drizzle-orm@0.38.4…` → `0.45.2`, `drizzle-kit@0.30.6` → `0.31.10`, the `@better-auth/drizzle-adapter` + `better-auth` peer pointers that reference `drizzle-orm(...)`, and drizzle's own transitive deps. **Must NOT move:** `react`, `vite`, `vitest`, `fastify`, `pg`, `zod`, `bullmq`, `ioredis`, etc. If anything unrelated churns, STOP and investigate before proceeding.
   > **drizzle-kit note:** it is a build-time-only devDep (generate/check/migrate) and is NOT in the
   > prod bundle nor the vuln surface. It is bumped ONLY to keep the migration toolchain's internal
   > table-shape reader aligned with drizzle-orm 0.45 (a 0.30.6-kit / 0.45.2-orm mismatch is the most
   > likely cause of a spurious migration diff — see Risk #1). If step-2c below throws a spurious diff,
   > that's the knob to toggle to isolate orm-vs-kit.

---

## 2 · Breaking-change scan (0.38 → 0.45), scoped to what this repo uses

Verified against the drizzle changelog + advisory (0.40.0, 0.44.0, 0.45.2 changelogs read; releases page):
**no documented breaking change** to the query builder, `sql` tag, pg-core column/index/`pgTable`
API, node-postgres driver, or `$inferSelect`/`$inferInsert` type inference across this range. The
range added features only (0.40 Gel dialect, 0.44 `DrizzleQueryError` + opt-in cache module, 0.45.2
the security fix). Per-surface verdict:

| Surface used here | 0.38→0.45 status | Action |
|---|---|---|
| `escapeName()` / `sql.identifier()` / `sql.as()` | **CHANGED** (the fix) — stricter identifier escaping | Not called with untrusted input here (0 dynamic sites) → no behavior change for us; the point of the bump |
| `.select/.insert/.update/.delete/.where/.innerJoin/.returning` | No breaking change | VERIFY via api test suite (§3d) |
| `.$dynamic()` (`tenant-db.ts:173`) | No breaking change | VERIFY — `tenant-db.ts:143-185` `selectThrough` still compiles (§3c) |
| `` sql`` `` + `sql.raw` + `sql.join` (CASE builder) | No breaking change | VERIFY — `tenant-db.ts:388-393` `updateThroughChainMany` compiles + runs (§3e) |
| `column.getSQLType()` | No breaking change | VERIFY `tenant-db.ts:388` (§3c/§3e) |
| `getTableColumns()` | No breaking change | VERIFY `tenant-db.ts:171,376` (§3c) |
| `$inferSelect` / `$inferInsert` (55 sites) | Type inference stable | VERIFY via `@juneflow/db` build + api typecheck (§3c/§3d) |
| `pgTable` / column DSL / `pgEnum` | Stable | VERIFY via `drizzle-kit generate` = no-new-migration (§3a) |
| `index/uniqueIndex` **array-callback** form (already the post-0.31 API) | Stable — repo already uses `(t) => [index(...)]` | VERIFY §3a |
| `timestamp({withTimezone,mode:"date"})`, `numeric({precision,scale})` | Rendering stable | VERIFY §3a (these + the expression index are the diff-prone bits) |
| expression + partial `uniqueIndex` — `extensions.ts:570` `upper(${t.code})` + `.where(sql\`${t.code} is not null\`)` | **VERIFY** — expression/partial index SQL rendering is the historically diff-prone spot across drizzle-kit versions | §3a — the make-or-break line for no-new-migration |
| `drizzle(pool, { schema })` constructor (`client.ts:26`) | Signature unchanged (cache arg is optional/additive) | VERIFY §3c |
| `.toSQL()` output format (asserted by `tenant-db.test.ts` via `PgDialect`, substring `toContain('"company_id" = $1'`, `" and "`)) | **VERIFY** — 0.45 could tweak generated-SQL whitespace/casing; asserts are substrings so likely safe | §3d catches it |

---

## 3 · Verification checklist (the critical part — run in order, stop on first red)

All commands from repo root. Record the GREEN baseline of (d) BEFORE step 1's bump.

**(a) ⭐ no-new-migration — THE decisive check.** Schema→SQL must be byte-identical, proving the new
toolchain still describes the exact same DB as migrations `0000`–`0025`:
```
pnpm --filter @juneflow/db generate      # = drizzle-kit generate
git status --porcelain packages/db/drizzle/
```
Expected: drizzle prints **“No schema changes, nothing to migrate”** AND `git status` on
`packages/db/drizzle/` is **clean** (no new `0026_*.sql`, no meta-snapshot rewrite).
- If a NEW migration file appears → schema/SQL rendering drifted. **DO NOT keep or commit it**
  (merged migrations are sacred). `git clean -f packages/db/drizzle/ && git checkout packages/db/drizzle/`,
  inspect the diff (almost certainly the `extensions.ts` expression/partial index or a
  numeric/timestamptz render), isolate orm-vs-kit by toggling `drizzle-kit` back to `0.30.6`, and
  escalate to Wei via `BLOCKERS.md` — do not self-resolve a sacred-file diff.

**(b) migration ledger integrity:**
```
pnpm --filter @juneflow/db migration:check   # = drizzle-kit check
```
Expected: clean, no collisions/gaps reported.

**(c) `@juneflow/db` compiles under the new types:**
```
pnpm --filter @juneflow/db build        # tsc -p tsconfig.build.json (emits dist/)
pnpm --filter @juneflow/db typecheck    # tsc --noEmit
```
Expected: both exit 0. (This is where a schema-DSL or `getSQLType`/`getTableColumns` type break in `tenant-db.ts` would surface — note `apps/api` imports the built `@juneflow/db`, so build db FIRST.)

**(d) `apps/api` typecheck + full test suite:**
```
pnpm --filter @juneflow/api typecheck
pnpm --filter @juneflow/api test        # vitest run  (~447 cases)
```
Expected: typecheck exit 0; **all tests green, same count as the pre-bump baseline** (record baseline first). Watch specifically `apps/api/src/db/tenant-db.test.ts` (asserts `.toSQL()` substrings for every scoped door — the CASE/`sql.raw` `updateThroughChainMany` path included) and the 31 route test files (they mock `$dynamic`/`PgDialect`).

**(e) tenant-db doors — live-DB behavioral smoke (one door, real pg).** Unit `.toSQL()` in (d) proves
shape; this proves execution of the `sql.raw(getSQLType())` CASE path against Postgres 16:
```
docker compose -f infra/docker-compose.yml up -d db     # pg16
pnpm --filter @juneflow/db seed                          # seed one tenant
```
Then exercise ONE door end-to-end against the seeded tenant — cheapest real coverage is the
`updateThroughChainMany` path (it uses `` sql`…::${sql.raw(sqlType)}` `` + `sql.join` + `inArray`),
via the BOQ generate-PR cut-remain flow or a throwaway `tsx` snippet calling
`new TenantDb(db, <seededCompanyId>).selectThrough(...)` + one `updateThroughChain*`. Expected: the
scoped rows come back, the CASE update returns the mutated rows, no SQL error. (If an existing api
integration test already hits a real DB for these doors, running it satisfies (e).)

**(f) advisory cleared:**
```
pnpm audit --prod
```
Expected: **GHSA-gpj5-g38j-94v9 / drizzle-orm HIGH no longer listed** (the 4 dev-chain vite/vitest/esbuild/launch-editor findings from `dep-vuln.md` may remain — out of scope, dev-surface).

---

## 4 · Rollback plan

Any red check → single revert, no DB action needed:
```
git checkout -- packages/db/package.json apps/api/package.json pnpm-lock.yaml
pnpm install
```
- Migrations already applied are **unaffected**: this change regenerates NOTHING (that is the whole
  point of check §3a). No `drizzle-kit migrate` is ever run in this plan, so the live DB schema is
  never touched — nothing to roll back at the DB layer. Migrations are additive/append-only.
- If §3a produced a stray `0026_*.sql`, `git clean -f packages/db/drizzle/` removes it (it was never applied).
- Because `apps/api` consumes the built `@juneflow/db` `dist/`, after reverting, re-run
  `pnpm --filter @juneflow/db build` so `dist/` matches the reverted (0.38.4) types.

---

## 5 · Risk rating: **LOW**

Rationale: narrow, well-understood surface; no relational-query/generated-column/customType usage; the
security fix is in a code path the app never feeds untrusted input to; better-auth ALREADY wants
0.45.2 (aligning, not fighting, deps); snapshot format stays `v7`; and the change regenerates nothing
by design, so it's trivially reversible with zero DB impact.

**Top 2 things most likely to break:**
1. **`drizzle-kit generate` emits a spurious migration** — expression/partial `uniqueIndex`
   (`extensions.ts:570` `upper(code)` + partial `WHERE`), or `numeric(p,s)` / `timestamptz` rendering,
   formatted slightly differently by the newer toolchain. Most attributable to the drizzle-kit
   0.30.6→0.31.10 bump, not the orm bump. Caught by §3a; isolate by toggling drizzle-kit; never
   commit the regenerated sacred migration — escalate.
2. **`tenant-db.test.ts` `.toSQL()` substring asserts** (or an internal `PgTable`/`getTableColumns`/
   `getSQLType` shape change feeding `updateThroughChainMany`'s CASE builder). Caught by §3d; asserts
   are substrings (`toContain`) so resilient, but the CASE/`sql.raw` door is the one custom bit worth
   eyeballing.

---

### ⭐ Single most important verification step
**`pnpm --filter @juneflow/db generate` produces NO new migration** (drizzle-kit generate =
“No schema changes” + clean `git status packages/db/drizzle/`). Schema→SQL identical proves the new
0.45.2 / 0.31.10 toolchain still describes the exact DB that migrations 0000–0025 built — i.e. the
bump is purely a security patch with zero schema/behavioral drift.
