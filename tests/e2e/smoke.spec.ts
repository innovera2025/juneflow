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

// login -> shell load (the REAL G4 flow) — runs when E2E_LIVE=1.
//
// Spec source (expected BEHAVIOR, not implementation): pototype/extra-screens.jsx
// ScreenLogin (login() = empty email|password -> validation error, no navigate;
// valid creds -> authed + navigate("dashboard")) + docs/handoff/flows.html. Only
// spec-backed, language-stable selectors are asserted:
//   - LOGIN_TITLE / LOGIN_ERR_REQUIRED are login.title / login.errRequired from
//     docs/extract/i18n-full.json, which are Thai in EVERY language (B-035/B-036),
//     so they are stable regardless of the active locale.
//   - the email/password fields are matched structurally (the only text field /
//     the sole type=password field on the login panel), never by pixel or layout.
// Credentials + identity come from the central seed (packages/db seed/index.ts:
//   COMPANY_USERS[0] "สมชาย วัฒนกุล" / somchai@rungrueang.co.th, DEV_PASSWORD
//   "juneflow-dev") — no ad-hoc fixture (tests/CLAUDE.md "central seed only").
//
// Gated on E2E_LIVE because it needs the seeded compose stack behind the
// single-origin live-proxy (see e2e/live-proxy.mjs + playwright.config.ts): the
// browser must make same-origin /api/v1 calls that reach apps/api for the real
// bearer-JWT flow. Without the flag the suite stays at reachability only.
const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

// Thai-in-all-languages login copy (i18n-full.json login.*) — stable selectors.
const LOGIN_TITLE = "เข้าสู่ระบบ"; // login.title (header + submit button)
const LOGIN_ERR_REQUIRED = "กรุณากรอกอีเมลและรหัสผ่าน"; // login.errRequired
// Central-seed credentials + the authenticated identity the shell must show.
const SEED_EMAIL = "somchai@rungrueang.co.th";
const SEED_PASSWORD = "juneflow-dev";
const SEED_USER_NAME = "สมชาย วัฒนกุล"; // COMPANY_USERS[0].name -> GET /me user.name

liveDescribe("login -> shell load (G4, live seeded stack)", () => {
  test("empty credentials show the validation error and do NOT navigate", async ({ page }) => {
    await page.goto("/login");

    // The login panel exposes exactly one plain text field (email) + one
    // type=password field (chrome/checkbox excluded) — ScreenLogin form panel.
    const email = page.locator('input:not([type="password"]):not([type="checkbox"])').first();
    const password = page.locator('input[type="password"]').first();
    await expect(email).toBeVisible();

    // Empty BOTH fields (email is pre-filled by the screen) then submit.
    await email.fill("");
    await password.fill("");
    await page.getByRole("button", { name: LOGIN_TITLE }).click();

    // ScreenLogin.login(): validation error is shown and navigation is blocked.
    await expect(page.getByText(LOGIN_ERR_REQUIRED)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("valid seeded credentials authenticate and render the app shell", async ({ page }) => {
    await page.goto("/login");

    const email = page.locator('input:not([type="password"]):not([type="checkbox"])').first();
    const password = page.locator('input[type="password"]').first();
    await expect(email).toBeVisible();

    await email.fill(SEED_EMAIL);
    await password.fill(SEED_PASSWORD);
    await page.getByRole("button", { name: LOGIN_TITLE }).click();

    // login() navigates to the dashboard shell on the real bearer-JWT success.
    await expect(page).toHaveURL(/\/dashboard$/);

    // App shell chrome renders: sidebar (aside) + its menu tree (nav) + the
    // per-page topbar (header, ported from chrome.jsx TopBar).
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.locator("aside nav")).toBeVisible();
    await expect(page.locator("header").first()).toBeVisible();

    // The sidebar footer identity comes from the authenticated GET /me — its
    // presence proves the bearer token flowed through and the session is real.
    await expect(page.getByText(SEED_USER_NAME)).toBeVisible();
  });
});
