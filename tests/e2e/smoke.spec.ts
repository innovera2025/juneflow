import { test, expect, request } from "@playwright/test";

// Smoke reachability (Gate G4) — P0-QA-03, re-scoped per BLOCKERS.md B-034.
//
// Purpose: prove the compose dev stack is reachable end-to-end before any UI
// flow can be asserted. Source of truth for the surface under test is
// infra/docker-compose.yml, which exposes:
//   - web  on $WEB_PORT (default 5173) -> nginx serving apps/web
//   - api  /health on $API_PORT (default 3000) -> Fastify skeleton
// Default mode = reachability + the SPA <-> api wiring discriminator (5 tests):
// a stack that serves the shell but whose bundle cannot reach /api/v1 as JSON
// (B-410 / B-304 shapes) can no longer pass. `E2E_LIVE=1` adds the UI login
// flow (implemented 38c29ef) below.

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";

// --- attachment redaction --------------------------------------------------
// Responses are attached verbatim on purpose: the default artefact shows only
// Expected/Received, which cannot tell "wrong process on the port" from "api
// down". But POST /auth/login answers with a LIVE bearer credential (apps/api
// routes/auth.ts `token: signedIn.token` — the very string the bundle then
// sends as `Authorization: Bearer`), and an attachment outlives the run once a
// runner copies test-results out. With E2E_LOGIN_EMAIL/E2E_LOGIN_PASSWORD
// pointed at a real environment, that would be a usable account token sitting
// in a CI artefact — so the credential is removed before it is attached, and
// the diagnostic value (status, headers, body shape) is kept.
//
// Two independent nets, because the mint shape is not fixed (compose answers an
// opaque 32-char better-auth token; a JWT elsewhere) and neither alone covers:
//   1. any STRING under a credential-shaped key, at any depth — `token`, a
//      relocated `data.session.accessToken`, a `set-cookie` header;
//   2. anything JWT-shaped anywhere in the text — a token under a key this list
//      does not know, and one inside a body that is not JSON at all (a proxy
//      page, a truncated body), where net 1 cannot reach.
// Deliberately NOT redacted: non-string values under those keys. `"token": null`
// (or absent) is exactly what the "did not mint" assertion reports, and a null
// is not a credential. A blob with nothing to redact is attached byte-identical.
const CREDENTIAL_KEY =
  /token|password|passwd|secret|credential|authorization|cookie|api[-_]?key|passphrase/i;
const JWT_SHAPED = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g;

/** Replace string leaves under credential-shaped keys, keeping type + length. */
function redactCredentialStrings(value: unknown, underCredentialKey: boolean): unknown {
  if (typeof value === "string") {
    return underCredentialKey ? `[redacted string(${value.length})]` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentialStrings(item, underCredentialKey));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactCredentialStrings(item, CREDENTIAL_KEY.test(key)),
      ]),
    );
  }
  return value;
}

/** A response body (or header blob) with any live credential removed. */
function redactSecrets(text: string): string {
  let out = text;
  try {
    const parsed: unknown = JSON.parse(text);
    const redacted = JSON.stringify(redactCredentialStrings(parsed, false));
    // Swap only when something actually changed, so a credential-free blob — an
    // Error envelope, an HTML fallback — reaches the report untouched.
    if (redacted !== JSON.stringify(parsed)) out = redacted;
  } catch {
    /* not JSON (SPA fallback HTML / a foreign listener's page) — net 2 only */
  }
  return out.replace(JWT_SHAPED, "[redacted jwt]");
}

/** The attachment shape used below: status + headers + body head, redacted. */
function responseDigest(
  status: number,
  headers: Record<string, string>,
  body: string,
): string {
  return `${status} ${redactSecrets(JSON.stringify(headers))}\n${redactSecrets(body).slice(0, 300)}`;
}

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
      // Keep the raw answer in the report: the default artefact only shows
      // Expected/Received, which cannot tell "wrong process on the port" from
      // "api down".
      const body = await res.text();
      await test.info().attach("health-response", {
        contentType: "text/plain",
        body: responseDigest(res.status(), res.headers(), body),
      });
      expect(res.status()).toBe(200);
      expect(
        res.headers()["content-type"],
        `${API_URL}/health did not answer JSON — a foreign listener on :3000? (2026-08-06 tests/test-results saw a 500 from another process on that port); point E2E_API_URL at the compose api port`,
      ).toMatch(/^application\/json/);
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
    // Registered BEFORE the click — after it the response may already be in.
    const loginRes = page.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await page.getByRole("button", { name: LOGIN_TITLE }).click();

    // A correct credential is never throttled per-account (B-100), so a 429 here
    // is real spam from this IP — a named FAILURE, not a skip (B-099 note 2026-09).
    expect(
      (await loginRes).status(),
      "login throttled 429 — per-IP FAILED-attempt backstop LOGIN_MAX_PER_IP=50/60 s (routes/auth.ts:94-99,:249-251); another spec sprayed bad credentials from this IP; wait 60 s — do NOT skip",
    ).not.toBe(429);

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

// SPA <-> api wiring discriminator — runs in DEFAULT mode (no gate), against the
// web origin itself (playwright.config.ts baseURL = compose web / E2E_BASE_URL),
// NOT the api port and NOT the live-proxy: the thing under test is the image's
// own path from the bundle to /api/v1. It exists because two failures already
// passed this smoke while every screen rendered empty:
//   - B-410: the bundle was built with a blank VITE_API_BASE_URL, so every call
//     lost its prefix and hit the origin root — index.html, 200, no error.
//   - B-304: /api/* was not proxied to the api, so every call got the SPA
//     fallback — index.html, 200, no error.
// Every query in apps/web is disabled until a bearer token is present, so a
// plain GET / makes 0 API calls by design (tests/visual/README.md:117-120) and
// proves nothing; T3 therefore mints a session through the web origin, injects
// it, and counts what the bundle actually fetches.
//
// Expected values come from spec, not implementation: the landing route is
// `dashboard` (docs/extract/NAV-ROUTES.md:5 "Route เริ่มต้น"), the API answers
// the `Error` envelope { code, message } (openapi.yaml components Error), and
// the placeholder copy is the shell's own literal (chrome-strings.json
// phDeveloping — the same string tests/visual/visual-gate.spec.ts:45 consumes).
//
// Credential override (B22/O3): E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD retarget
// the mint (e.g. staging after the B-419 rehash) without editing this file. When
// set, the identity check becomes "GET /me answered for that email" instead of
// the seed user's display name.
const LOGIN_EMAIL = process.env.E2E_LOGIN_EMAIL || SEED_EMAIL;
const LOGIN_PASSWORD = process.env.E2E_LOGIN_PASSWORD || SEED_PASSWORD;
const LOGIN_OVERRIDE = Boolean(process.env.E2E_LOGIN_EMAIL);
// localStorage key the bundle reads its bearer JWT from (apps/web auth-token.ts:19).
const TOKEN_STORAGE_KEY = "juneflow-token";
// Shell placeholder copy (apps/web/src/shell/chrome-strings.json phDeveloping).
const PLACEHOLDER_TEXT = "กำลังพัฒนา — เลือกเมนูอื่นทางซ้าย";
// Document markers of the built app (apps/web/index.html — the same pair
// tests/visual/lib/promote.ts appReachable checks).
const DOC_TITLE_MARKER = "<title>Juneflow</title>";
const DOC_ROOT_MARKER = 'id="root"';

test.describe("smoke: SPA ↔ api wiring through the web origin (G4 default mode)", () => {
  test("GET / serves the Juneflow document and the bundle redirects to /dashboard", async ({
    page,
  }) => {
    // Recorded, NOT asserted: with no token the bundle fires 0 API calls by
    // design, but "0" is an implementation fact (tests/CLAUDE.md), so it goes in
    // the report as an annotation only.
    const apiResponses: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/v1")) apiResponses.push(`${r.status()} ${r.url()}`);
    });

    const res = await page.goto("/");
    expect(res, "Playwright must receive a response for GET /").not.toBeNull();
    expect(res!.status()).toBe(200);
    const html = await res!.text();
    expect(
      html,
      `the process on ${page.url()} is not the Juneflow app — no ${DOC_TITLE_MARKER} in the document (wrong port / foreign listener?)`,
    ).toContain(DOC_TITLE_MARKER);
    expect(
      html,
      `the document on ${page.url()} has no ${DOC_ROOT_MARKER} mount point — not the built apps/web index.html`,
    ).toContain(DOC_ROOT_MARKER);

    // NAV-ROUTES.md:5 — the default route is `dashboard`; the bundle must boot
    // far enough to perform that client-side redirect.
    await expect(page).toHaveURL(/\/dashboard$/);

    test.info().annotations.push({
      type: "api-v1-responses-unauthenticated",
      description: `${apiResponses.length}${apiResponses.length ? ` (${apiResponses.join(", ")})` : ""}`,
    });
  });

  test("the web origin answers /api/v1 as JSON (401 envelope), not the SPA fallback", async ({
    baseURL,
  }) => {
    // Through the WEB origin on purpose (not E2E_API_URL): this is the path the
    // bundle uses. Mint-independent, so it still names the cause when T3
    // cannot even log in.
    const ctx = await request.newContext({ baseURL });
    try {
      const res = await ctx.get("/api/v1/me");
      const body = await res.text();
      await test.info().attach("me-unauthenticated-response", {
        contentType: "text/plain",
        body: responseDigest(res.status(), res.headers(), body),
      });
      expect(
        res.status(),
        `GET ${baseURL}/api/v1/me returned ${res.status()} (expected 401 from the api) — 200 = index.html answered an API call (B-304 / B-410 proxy half): check apps/web/nginx.conf.template:65 location /api/, apps/web/Dockerfile:58 API_UPSTREAM, infra/Caddyfile:52`,
      ).toBe(401);
      expect(
        res.headers()["content-type"],
        `GET ${baseURL}/api/v1/me was not JSON — the api did not answer this path (B-304 shape)`,
      ).toMatch(/^application\/json/);
      const json = JSON.parse(body) as { code?: unknown; message?: unknown };
      expect(typeof json.code, "Error envelope (openapi.yaml Error) needs a string `code`").toBe("string");
      expect(typeof json.message, "Error envelope (openapi.yaml Error) needs a string `message`").toBe("string");
    } finally {
      await ctx.dispose();
    }
  });

  test("a session minted THROUGH the web origin lets the SPA fetch JSON from /api/v1", async ({
    page,
    context,
    baseURL,
  }) => {
    // 1. Mint through the web origin (same path the login screen's POST takes).
    const ctx = await request.newContext({ baseURL });
    let token: unknown;
    try {
      const login = await ctx.post("/api/v1/auth/login", {
        data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
      });
      const body = await login.text();
      // Redacted: this body carries the live bearer credential (see
      // redactSecrets above) — everything else about it stays readable.
      await test.info().attach("login-response", {
        contentType: "text/plain",
        body: responseDigest(login.status(), login.headers(), body),
      });
      expect(
        login.status(),
        `POST ${baseURL}/api/v1/auth/login returned ${login.status()} (expected 200) for ${LOGIN_EMAIL} — 401 = that credential is not in auth_account (seed packages/db/src/seed/index.ts:1131-1145 · B-419 rehash? set E2E_LOGIN_EMAIL/E2E_LOGIN_PASSWORD) · 405/200-with-HTML = the SPA fallback answered the API (B-304) · 5xx = api/DB failure (S4-P0). Body: ${redactSecrets(body).slice(0, 200)}`,
      ).toBe(200);
      expect(
        login.headers()["content-type"],
        `POST ${baseURL}/api/v1/auth/login answered 200 but not JSON — index.html for an API call (B-304)`,
      ).toMatch(/^application\/json/);
      token = (JSON.parse(body) as { token?: unknown }).token;
      expect(
        typeof token,
        "seed credential did not mint — 200 JSON without a string `token` (packages/db/src/seed/index.ts:1131-1145)",
      ).toBe("string");
    } finally {
      await ctx.dispose();
    }

    // 2. Inject it where the bundle reads it, before any document loads.
    await context.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [TOKEN_STORAGE_KEY, token as string],
    );

    // 3. Watch what the bundle does with it.
    const apiRequests: string[] = [];
    const apiNonJson: string[] = [];
    const apiUnauthorized: string[] = []; // 401 only — 403 is a permission fact, not wiring
    const pageErrors: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1")) apiRequests.push(`${r.method()} ${r.url()}`);
    });
    page.on("response", (r) => {
      if (!r.url().includes("/api/v1")) return;
      const ct = r.headers()["content-type"] ?? "";
      if (!/^application\/json/.test(ct)) apiNonJson.push(`${r.status()} ${ct || "(no content-type)"} ${r.url()}`);
      if (r.status() === 401) apiUnauthorized.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    // Registered before navigation; swallowed on timeout so the assertions
    // below name the cause instead of a bare "waitForResponse timed out".
    const meSeen = page
      .waitForResponse((r) => r.url().includes("/api/v1/me"), { timeout: 15_000 })
      .catch(() => null);

    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    const meRes = await meSeen;

    // 4. Assertions, cheapest cause first.
    expect(
      apiRequests.length,
      `the bundle made NO /api/v1 request after boot with a token present — B-410 shape: blank/wrong VITE_API_BASE_URL baked into the image (apps/web/src/api-client.ts:40-45 · apps/web/Dockerfile:45-46)`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      apiNonJson,
      "an /api/v1 call was answered with something other than JSON — index.html for an API call (B-304 shape: nginx /api/ proxy / API_UPSTREAM)",
    ).toEqual([]);
    if (LOGIN_OVERRIDE) {
      expect(meRes, "GET /api/v1/me was never answered within 15 s after boot").not.toBeNull();
      const me = (await meRes!.json()) as { user?: { email?: unknown } };
      expect(
        me.user?.email,
        `GET /api/v1/me did not answer for the overridden login ${LOGIN_EMAIL}`,
      ).toBe(LOGIN_EMAIL);
    } else {
      // Sidebar footer identity from GET /me — the same proof the LIVE flow uses.
      // Scoped to the sidebar: the dashboard body also prints the name once its
      // own data lands, and an unscoped getByText then hits strict mode.
      await expect(page.locator("aside").getByText(SEED_USER_NAME)).toBeVisible();
    }
    await expect(
      page.getByText(PLACEHOLDER_TEXT),
      "the landing route rendered the shell placeholder instead of the dashboard screen",
    ).toHaveCount(0);
    expect(
      apiUnauthorized,
      "an /api/v1 call came back 401 although a freshly minted token was injected — the bundle did not send it (auth-token.ts / bearer middleware) or the api rejected it",
    ).toEqual([]);
    expect(pageErrors, "uncaught errors in the page during boot").toEqual([]);
  });
});
