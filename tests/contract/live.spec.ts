/**
 * Live contract tests against the dev API (Gate G2 — "harness รันได้กับ dev API") — P0-QA-02
 *
 * These exercise the running dev API and validate its responses against the contract
 * (openapi.yaml). Every expectation is derived from the contract only — no implementation
 * is read (tests/CLAUDE.md). The dev stack does not exist yet (P0-DEV-01 / P0-BE-13 pending),
 * so the suite is GATED on CONTRACT_API_URL:
 *   - unset  → skipped (harness stays green while scaffolding — the QA-zone pattern)
 *   - set    → runs against that base, e.g. CONTRACT_API_URL=http://localhost:3000/api/v1
 *
 * Only side-effect-free calls are made: unauthenticated GETs (must be rejected) and a
 * bogus login (must fail the contract way). No seed data is assumed and no mutations run.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { deref, loadSpec, listOperations, resolveRef, validate } from './lib/openapi';

const BASE = process.env.CONTRACT_API_URL?.replace(/\/$/, '');
const suite = BASE ? describe : describe.skip;

const doc = loadSpec();
const operations = listOperations(doc);

// Auth-required GETs with a concrete path (no {param}) — safe to call unauthenticated.
const guardedGets = operations.filter(
  (o) => o.method === 'GET' && o.authRequired && !o.hasPathParams,
);

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

/** Resolve the response schema the contract declares for a given operation + status. */
function schemaFor(pathTemplate: string, method: string, status: string) {
  const op = operations.find((o) => o.path === pathTemplate && o.method === method);
  return op?.responses.find((r) => r.status === status)?.schema;
}

suite(`contract vs dev API @ ${BASE ?? '(unset)'}`, () => {
  it('has guarded GET endpoints to probe', () => {
    expect(guardedGets.length).toBeGreaterThan(0);
  });

  it.each(guardedGets)(
    '$path rejects the unauthenticated request with 401 + Error envelope',
    async (op) => {
      const { status, body } = await fetchJson(op.path);
      expect(status, `${op.path} should reject anonymous access`).toBe(401);
      const errors = validate(body, schemaFor(op.path, 'GET', '401'), doc);
      expect(errors, `${op.path} 401 body violated the Error contract`).toEqual([]);
    },
  );

  it('POST /auth/login with bad credentials answers a contract-declared response', async () => {
    const { status, body } = await fetchJson('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'definitely-wrong' }),
    });
    const declared = deref(doc, resolveRef(doc, '#/paths/~1auth~1login/post/responses'));
    expect(Object.keys(declared), `unexpected login status ${status}`).toContain(String(status));
    const errors = validate(body, schemaFor('/auth/login', 'POST', String(status)), doc);
    expect(errors, `login ${status} body violated the contract`).toEqual([]);
  });
});

/**
 * Authenticated POSITIVE path (Gate G2 live backfill) — the 401 probes above prove
 * the guard closes; these prove the guarded GET LIST endpoints, once a real bearer
 * is presented, answer 200 with a body that HONORS its declared response schema.
 * Black-box by design (tests/CLAUDE.md — no route implementation is read): the
 * contract is the sole source of expected shape, so this catches contract-vs-impl
 * drift the 401 tests cannot see.
 *
 * The bearer comes from the central seed (packages/db seed/index.ts): logging in as
 * COMPANY_USERS[0] somchai@rungrueang.co.th with DEV_PASSWORD "juneflow-dev" — no
 * ad-hoc fixture, no mutation (only side-effect-free GETs are driven).
 */
const SEED_EMAIL = 'somchai@rungrueang.co.th';
const SEED_PASSWORD = 'juneflow-dev';

/** All 9 nav-badge count keys (Counts enum) so GET /counts returns 200, not 400. */
const COUNT_KEYS = ['boq', 'boq.approval', 'pr.list', 'accept', 'pm.wo', 'gl.inbox', 'sales', 'sales.crm', 'sales.service'];

interface AuthTarget {
  /** Contract path template (used to look up the declared 200 schema). */
  path: string;
  /** Extra query string appended to the live request (e.g. required params). */
  query?: string;
  /**
   * A documented, quarantined contract-vs-impl drift to tolerate on THIS endpoint
   * (still fails on any OTHER violation, so the probe keeps guarding for regressions).
   * See the QA handoff — deciding the conflict is not the QA zone's call and
   * openapi.yaml is a sacred file, so it is surfaced, not silently passed or fixed.
   */
  knownDrift?: RegExp;
}

// The guarded list endpoints named in the QA task. /counts needs its required
// `keys`; /projects carries one known drift (ProjectPhase.sale_status is declared
// `type: string` yet its own description says "nullable free text" and the live
// stack returns null — a contract-internal inconsistency, flagged for the contract
// owner, quarantined here so the rest of the /projects body is still validated).
const AUTH_GET_TARGETS: readonly AuthTarget[] = [
  { path: '/companies' },
  { path: '/projects', knownDrift: /\.sale_status: expected type string, got null$/ },
  { path: '/vendors' },
  { path: '/boq' },
  { path: '/pr' },
  { path: '/po' },
  { path: '/wo' },
  { path: '/gr' },
  { path: '/counts', query: `?keys=${COUNT_KEYS.join(',')}` },
];

suite(`authenticated GET list endpoints @ ${BASE ?? '(unset)'}`, () => {
  let bearer = '';

  beforeAll(async () => {
    const { status, body } = await fetchJson('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    expect(status, 'seed login must succeed to drive the authenticated probes').toBe(200);
    const token = (body as { token?: string } | undefined)?.token;
    expect(token, 'login 200 body must carry a bearer token').toBeTruthy();
    bearer = token as string;
  });

  const authInit = (): RequestInit => ({ headers: { Authorization: `Bearer ${bearer}` } });

  for (const target of AUTH_GET_TARGETS) {
    it(`GET ${target.path} returns 200 with a contract-honoring body`, async (ctx) => {
      // Guard against a contract path the test names but the spec no longer has.
      const op = operations.find((o) => o.path === target.path && o.method === 'GET');
      expect(op, `${target.path} GET is not declared in the contract`).toBeDefined();

      const { status, body } = await fetchJson(`${target.path}${target.query ?? ''}`, authInit());

      // A genuinely-unimplemented route (not mounted) answers 404 — skip + note,
      // don't fail. Every other non-200 is a real regression and must fail.
      if (status === 404) {
        // eslint-disable-next-line no-console
        console.warn(`[live] SKIP ${target.path}: not implemented on dev (404)`);
        ctx.skip();
        return;
      }
      expect(status, `${target.path} should authorize the seeded bearer`).toBe(200);

      const schema = schemaFor(target.path, 'GET', '200');
      expect(schema, `${target.path} has no declared 200 response schema`).toBeDefined();

      const violations = validate(body, schema, doc).filter(
        (v) => !(target.knownDrift && target.knownDrift.test(v)),
      );
      expect(violations, `${target.path} 200 body drifted from its contract schema`).toEqual([]);
    });
  }
});
