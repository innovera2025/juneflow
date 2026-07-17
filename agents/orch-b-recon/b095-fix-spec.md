# B-095 — Fix-spec: tax-engine + bank-file dist build (prod boot blocker)

> **From:** orch-B (verify lane) · **For:** orch-A (backend + devops zones) · **2026-07-17**
> **Severity:** HIGH — batch-8 **promote-blocker**. Ships an API that crashes on boot in the production image.
> **Caught by:** Wave-2 finance money-path E2E (7/7 logic PASS, but `docker compose up api` = exit 1).
> **Pattern:** identical to the already-shipped `@juneflow/db` fix (**P0-FIX-08 / B-033**). This is copy-paste-verbatim ready.

---

## Problem (verified)

`node dist/index.js` (production image) crashes on boot:
```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently
unsupported for files under node_modules, for ".../@juneflow/tax-engine/src/thailand/index.ts"
```

- `packages/tax-engine` + `packages/bank-file` ship **raw `./src/*.ts`** (`main`/`types`/`exports` → `.ts`, no `build`, no `dist`).
- `pnpm --filter @juneflow/api deploy --prod` packs them under `node_modules` as raw `.ts`. Node 22 **refuses to type-strip files under `node_modules`**.
- At-load importers (both **new in batch-8**, absent on main `1b7fbca`) → `app.ts` loads them at boot → **whole API fails to boot**, not just finance:
  - `apps/api/src/routes/ap.ts:58` → `@juneflow/tax-engine/thailand`, `:59` → `@juneflow/tax-engine`
  - `apps/api/src/routes/bank.ts:61` → `@juneflow/bank-file`, `:65` → `@juneflow/bank-file/kbank-direct`, `:66` → `@juneflow/bank-file/config`
- **Why unit tests (api 527/527) missed it:** vitest/tsx are TS-aware; only the compiled `node dist` runtime (prod / docker / CI stack bring-up) triggers Node's refusal.
- **Repro:** `POSTGRES_PORT=5433 docker compose -f infra/docker-compose.yml up --build api` → api exits(1).

---

## Fix — 4 files edited + 2 files new

### 1. `packages/tax-engine/package.json`

**Remove** the `"main"` + `"types"` lines (mirror `@juneflow/db`, which has neither — resolution uses `exports`).
**Replace** the `"exports"` block and **add** a `"build"` script:

```jsonc
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./thailand": {
      "development": "./src/thailand/index.ts",
      "types": "./dist/thailand/index.d.ts",
      "default": "./dist/thailand/index.js"
    },
    "./config": {
      "development": "./src/config.ts",
      "types": "./dist/config.d.ts",
      "default": "./dist/config.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
```

### 2. `packages/tax-engine/tsconfig.build.json` — **NEW**

```jsonc
{
  // Production build config for @juneflow/tax-engine (B-095, mirrors @juneflow/db P0-FIX-08/B-033).
  // Emits dist/ (JS + .d.ts) so the packed prod image resolves compiled JS instead of raw .ts
  // under node_modules (node refuses to type-strip: ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
  // Dev (tsx) + tests (vitest) still resolve src via the `development` export condition.
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

### 3. `packages/bank-file/package.json`

Same treatment. **Remove** `"main"`/`"types"`, **replace** `"exports"`, **add** `"build"`:

```jsonc
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./kbank-direct": {
      "development": "./src/kbank-direct/index.ts",
      "types": "./dist/kbank-direct/index.d.ts",
      "default": "./dist/kbank-direct/index.js"
    },
    "./config": {
      "development": "./src/config.ts",
      "types": "./dist/config.d.ts",
      "default": "./dist/config.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
```

### 4. `packages/bank-file/tsconfig.build.json` — **NEW**

Identical to #2, change the comment name to `@juneflow/bank-file`.

### 5. `apps/api/Dockerfile` — build the 2 packages **before** the api build

Insert two lines between the existing db build (line 24) and api build (line 25):

```diff
 RUN pnpm --filter @juneflow/db build
+RUN pnpm --filter @juneflow/tax-engine build
+RUN pnpm --filter @juneflow/bank-file build
 RUN pnpm --filter @juneflow/api build
```

(Optional: extend the comment at lines 20-23 to name tax-engine + bank-file alongside db.)

---

## Notes / why this is safe (pre-checked by orch-B)

- **No `@types/node` needed.** `config.ts` in both packages declares a **minimal inline ambient `process.env`** type (see the header comment there) and keeps `types: []` — emit works; `process` is a Node runtime global. Do **not** add `@types/node`; keep `tsconfig.json` `types: []` unchanged.
- **Dev + tests stay green (api 527/527).** vitest/tsx resolve the `development` export condition → `src/*.ts` — the exact mechanism `@juneflow/db` already uses. No test change.
- **Local `turbo run build` auto-orders.** `turbo.json` `build` = `{ dependsOn: ["^build"], outputs: ["dist/**"] }`. Once these packages have a `build` script, turbo builds them before `@juneflow/api` (same as db). The Dockerfile order is the explicit belt-and-suspenders for the non-turbo image build.
- **`dist/` already gitignored** (root `.gitignore:5`) — emitted output is not committed. `pnpm deploy --prod` packs the built `dist/` (it copies package content, not gitignore-filtered — same as db).
- **Build order rationale:** after conditional `exports`, the api's `tsc` build resolves `@juneflow/tax-engine/thailand` via the `types` condition → `./dist/thailand/index.d.ts`, so the 2 packages **must** emit `dist/` first. Dockerfile line order + turbo `^build` both guarantee this.

---

## Verification checklist (orch-A applies → orch-B re-verifies)

1. `pnpm --filter @juneflow/tax-engine build && pnpm --filter @juneflow/bank-file build` → emits `dist/{index,config}.{js,d.ts}` + `dist/thailand/*` + `dist/kbank-direct/*`.
2. `pnpm --filter @juneflow/api build` → still compiles (resolves the new `dist` `.d.ts`).
3. `pnpm --filter @juneflow/api test` → still 527/527 (dev condition → src, unchanged).
4. `POSTGRES_PORT=5433 docker compose -f infra/docker-compose.yml up --build api` → **boots** (was exit 1). ← the actual gate.
5. **orch-B re-verify:** finance E2E via compose (`E2E_LIVE=1 tests/e2e/finance-flow.spec.ts`) passes end-to-end + live-G5 round on the finance screens → batch-8 fully deployable → GO for Wei promote as one bundle.

---

## Board

- Suggested id **B-095** (next after B-094 — grep-verified fresh; note `B-256` in BLOCKERS.md looks like a typo, not the max).
- Zone: **backend** (packages/*, apps/api/Dockerfile) — orch-A owns. Not a sacred file (no openapi/i18n/migration/CLAUDE.md touched).
- Recommend: **fold into batch-8** so the promote is a single deployable bundle (don't promote batch-8 until this lands).
- After apply → ping orch-B (C-08x) and I run verification step 5 immediately.
