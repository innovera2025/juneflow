# Type-stripping regression scan — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`

> **From:** orch-B (verify lane) · **For:** orch-A · **2026-07-17**
> Follow-up to **B-095**. Question: are there *other* workspace packages that would crash the same way once packed under `node_modules` in a deployed node runtime?
> **Verdict:** **B-095 (tax-engine + bank-file) = the complete ACTIVE set.** No other package currently ships raw `.ts` into a deployed `node dist` runtime. Three packages are *latent* risk. Recommend **folding `@juneflow/notifications` into B-095** proactively.

---

## The failure class

Node 22 **refuses to type-strip `.ts` files under `node_modules`**. A workspace package is a **live blocker** only when ALL three hold:
1. its `exports`/`main` resolve to raw `./src/*.ts` (no `dist` build), **and**
2. it is a **prod dependency** packed by `pnpm --filter @juneflow/api deploy --prod`, **and**
3. it is imported (at module load) by a **`node dist` runtime** (the api/worker image) — NOT a bundler.

Bundled consumers (Vite/esbuild for `apps/web`) transpile `.ts` themselves, so raw-`.ts` deps are **safe** there. Flutter/`apps/mobile` is Dart — N/A.

---

## Full scan (all 7 workspace packages)

| Package | Ships | api (`node dist`) imports? | web (Vite bundle) imports? | Status |
|---|---|---|---|---|
| `@juneflow/db` | ✅ dist (build + conditional exports) | ✓ 97× (`/client`,`/schema`,`/seed`) | — | **SAFE** (P0-FIX-08/B-033) |
| `@juneflow/tokens` | ✅ dist (build) | — | ✓ | **SAFE** |
| `@juneflow/tax-engine` | ⚠️ raw `.ts` | ✓ (`ap.ts:58-59`) | — | 🔴 **B-095** (fix-spec ready) |
| `@juneflow/bank-file` | ⚠️ raw `.ts` | ✓ (`bank.ts:61,65,66`) | — | 🔴 **B-095** (fix-spec ready) |
| `@juneflow/contracts` | ⚠️ raw `.ts` | ✗ (0) | ✓ 19× | 🟡 latent — web-only (bundled) |
| `@juneflow/i18n` | ⚠️ raw `.ts` | ✗ (0) | ✓ 48× | 🟡 latent — web-only (bundled) |
| `@juneflow/notifications` | ⚠️ raw `.ts` | ✗ (0) | ✗ (0) | 🟡 latent — **unwired** (no consumer yet) |

**Evidence:** `apps/api/package.json` prod deps = `{db, tax-engine, bank-file}` only (exactly what `deploy --prod` packs). `grep 'from "@juneflow/' apps/api/src` = db / tax-engine / bank-file only — **no contracts/i18n/notifications import in any api or worker source** (worker.ts lives under apps/api/src, covered by the grep).

---

## Why the 3 latent packages are safe **today** (and when they stop being safe)

- **contracts + i18n** — imported only by `apps/web`. Vite/esbuild **bundles** their `.ts`; the browser never resolves `node_modules` `.ts`, so the type-stripping refusal never fires. They break the same way **only if** imported by `apps/api` (e.g. server-side i18n email copy, runtime contract validation).
- **notifications** — imported by **nothing** currently (skeleton). It becomes a live blocker the moment it is wired into the **BullMQ worker** (same `node dist` image as api) — the most likely next consumer (Phase 3 integrations: LINE/email/webpush).

### ⚠️ Do NOT blanket-convert contracts + i18n right now
Converting them to db-style conditional exports (`development`→src, `default`→dist) would make **`vite build` resolve the `default`/`production` branch → `dist/*.js`**, which won't exist unless web's build pipeline builds them first → **breaks the web build** for zero current benefit. Leave them raw-`.ts` until/unless a `node dist` runtime imports them; convert *then* (and wire their build into the web pipeline via turbo `^build` at the same time).

---

## Recommendation

1. **Fold `@juneflow/notifications` into B-095** (proactive, cheap, zero-risk): it is structurally identical to tax-engine/bank-file, consumed by nothing today (so the change affects no current consumer), and is the next package to hit the wall when the worker wires notifications. Give it the build infra now so it "just works" later. Spec below.
2. **Leave contracts + i18n as-is** — documented latent risk; convert only when a node runtime imports them.
3. **Durable guard (recommend to Wei / gate-4.5 checklist):** *"Any new `@juneflow/*` added to `apps/api` dependencies or imported by `apps/api/src` must ship a `dist` build (conditional exports + `build` script + Dockerfile build step)."* This kills the whole regression class permanently — it would have caught B-095 at review time.

---

## Fold-in spec — `@juneflow/notifications` (same pattern as B-095)

### `packages/notifications/package.json`
Remove `"main"`/`"types"`; replace `"exports"`; add `"build"`:

```jsonc
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./adapters/line": {
      "development": "./src/adapters/line.ts",
      "types": "./dist/adapters/line.d.ts",
      "default": "./dist/adapters/line.js"
    },
    "./adapters/email": {
      "development": "./src/adapters/email.ts",
      "types": "./dist/adapters/email.d.ts",
      "default": "./dist/adapters/email.js"
    },
    "./adapters/webpush": {
      "development": "./src/adapters/webpush.ts",
      "types": "./dist/adapters/webpush.d.ts",
      "default": "./dist/adapters/webpush.js"
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

### `packages/notifications/tsconfig.build.json` — NEW
Identical to the tax-engine/bank-file build config (comment renamed):
```jsonc
{
  // Production build config for @juneflow/notifications (B-095, mirrors @juneflow/db P0-FIX-08/B-033).
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

### `apps/api/Dockerfile` — add alongside the other two (optional-but-recommended)
```diff
 RUN pnpm --filter @juneflow/db build
 RUN pnpm --filter @juneflow/tax-engine build
 RUN pnpm --filter @juneflow/bank-file build
+RUN pnpm --filter @juneflow/notifications build
 RUN pnpm --filter @juneflow/api build
```
Note: notifications is not yet an api prod dep, so `deploy --prod` won't pack it and this line is currently **inert** (harmless future-proofing). When notifications is later added to `apps/api` deps + imported, no further packaging change is needed.

### Pre-checked (same as B-095)
- `config.ts` uses inline ambient `process.env` typing → **no `@types/node`**, keep `types: []`.
- Its own vitest/tsx tests resolve `development`→src, stay green.
- Consumed by nothing today → the exports change affects no current build (web does not import it).
- `dist/` already gitignored (root `.gitignore:5`).

---

## Net

- **Promote gate:** only tax-engine + bank-file block batch-8 (both in the B-095 fix-spec). notifications is proactive, not blocking.
- **After orch-A applies B-095 (+ notifications fold):** orch-B re-verifies `docker compose up --build api` boots + finance E2E via compose + live-G5 → batch-8 fully deployable.
