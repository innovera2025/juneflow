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
import { describe, expect, it } from 'vitest';
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
