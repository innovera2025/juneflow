<!-- orch-B dep-vuln audit · read-only · 2026-07-17 01:47 -->
# Dependency Vulnerability Audit (orch-B, 2026-07-17 01:47)

`pnpm audit --prod` = **5 vulnerabilities (2 high, 3 moderate)**. Correction to the earlier next-lane survey (which claimed all 5 were dev-chain): **ONE is a PRODUCTION-surface HIGH in the ORM.**

## 🔴 HIGH · PROD · drizzle-orm — the real one
- **module:** `drizzle-orm@0.38.4` (declared `^0.38.3` in `packages/db/package.json` + `apps/api/package.json`) — the production DB layer used by EVERY query.
- **advisory:** GHSA-gpj5-g38j-94v9 — "SQL injection via improperly escaped SQL identifiers". **vulnerable `<0.45.2` · patched `>=0.45.2`** → 0.38.4 is vulnerable.
- **app exposure:** the app's own `sql.raw`/`sql\`\`` sites are CODE-SUPPLIED, not user identifiers — `tenant-db.ts` (`sql.raw(column.getSQLType())` = schema type string) · `extensions.ts` (schema expr) · `seed/index.ts` (seed). So there is no obvious direct app-level trigger. BUT the flaw is in drizzle's OWN identifier escaping, so any dynamic-identifier path (present or future) inherits it → the safe posture is the version bump.
- **fix (owner: platform/backend + Wei):** bump `drizzle-orm ^0.38.3 → >=0.45.2` in both packages + `pnpm install` (lockfile). **0.38→0.45 is a meaningful jump** — must: run `drizzle-kit` check, regen/verify migrations still generate identically, run api tests (443/447), confirm the tenant-db doors + generated columns still compile. NOT an orch-B apply (dependency + lockfile = platform/sacred-adjacent).

## 🟡 MODERATE/HIGH · DEV-CHAIN only (low prod risk — not shipped)
All via the vite/vitest/better-auth dev toolchain (build/test only, not in the prod bundle):
- HIGH: `vite` server.fs.deny bypass on Windows alternate data streams (dev server only).
- MOD: `esbuild` — any website can send requests to the dev server (dev only).
- MOD: `vite` path traversal in optimized deps (dev only).
- MOD: `launch-editor` NTLMv2 hash disclosure via UNC path (dev tooling).
- **fix:** opportunistic `vite`/`vitest` bump; low priority (dev-surface).

## Recommendation
1. **Bump drizzle-orm to >=0.45.2** — tracked backend/platform task (HIGH, prod ORM), test migrations carefully.
2. Dev-chain 4 → low-priority vite/vitest bump.
3. Re-run `pnpm audit --prod` after bumps to confirm 0 prod-surface vulns.
