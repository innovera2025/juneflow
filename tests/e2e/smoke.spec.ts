import { test, expect, request } from "@playwright/test";

// Smoke reachability (Gate G4) — P0-QA-03, re-scoped per BLOCKERS.md B-034.
//
// Purpose: prove the compose dev stack is reachable end-to-end before any UI
// flow can be asserted. Source of truth for the surface under test is
// infra/docker-compose.yml, which exposes:
//   - web  on $WEB_PORT (default 5173) -> nginx serving apps/web
//   - api  /health on $API_PORT (default 3000) -> Fastify skeleton
// This file asserts ONLY "the service serves" — no product/spec behavior beyond
// reachability. The actual "login -> shell load" flow is a Phase-1 todo below
// (blocked on P0-WEB-05 / B-020) and must NOT be fabricated here.

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";

test.describe("smoke: compose dev reachability (G4)", () => {
  test("web root serves 200 and Playwright loads the document", async ({ page }) => {
    // baseURL comes from playwright.config.ts (E2E_BASE_URL, default :5173).
    const res = await page.goto("/");
    expect(res, "Playwright must receive a response for GET /").not.toBeNull();
    expect(res!.status()).toBe(200);
    // Document parsed and attached — Playwright successfully loaded the page.
    await expect(page.locator("html")).toBeAttached();
  });

  test("api /health returns 200 { ok: true }", async () => {
    const ctx = await request.newContext();
    try {
      const res = await ctx.get(`${API_URL}/health`);
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    } finally {
      await ctx.dispose();
    }
  });
});

// login -> shell load (Phase 1 — blocked on P0-WEB-05 / B-020).
//
// TODO(P0-QA-03 / B-034): implement the full smoke once login + app shell are
// ported. Spec: prototype extra-screens.jsx:7-56 (ScreenLogin — empty
// email/password -> validation error; valid creds -> authed + navigate to the
// dashboard shell) plus the state machine in docs/handoff/flows.html.
// apps/web currently renders only Placeholder scaffolds (no login form, no
// shell), so asserting this flow now would invent behavior absent from spec and
// violate PLAN.md §0 rules 1 & 4. Registered as fixme (a running-suite todo)
// rather than fabricated — it appears in the report without failing G4.
test.describe("login -> shell load (Phase 1 — awaits P0-WEB-05 / B-020)", () => {
  test.fixme(
    "empty email/password shows validation error; valid creds navigate to dashboard shell",
    async () => {
      // Intentionally empty: awaiting login screen + app shell port (P0-WEB-05).
    },
  );
});
