/**
 * Contract shape tests (Gate G2) — P0-QA-02
 *
 * Every case here is GENERATED from `packages/contracts/openapi.yaml` and asserts
 * an invariant the contract itself declares. No implementation is read and no value
 * is hand-written (tests/CLAUDE.md · PLAN.md §5). These run without a dev API — they
 * verify the harness can enumerate the contract and that the contract is internally
 * consistent enough to test a live API against. Live assertions live in live.spec.ts.
 *
 * A future openapi.yaml change that breaks one of these invariants fails G2 (by design;
 * openapi.yaml is sacred — such a change goes through Wei, PLAN.md §10).
 */
import { describe, expect, it } from 'vitest';
import {
  collectRefs,
  deref,
  loadSpec,
  listOperations,
  resolveRef,
  validate,
} from './lib/openapi';

const doc = loadSpec();
const operations = listOperations(doc);
const authOps = operations.filter((o) => o.authRequired);
const bodyOps = operations.filter((o) => o.hasRequestBody);
const quotaOps = operations.filter((o) => o.statusCodes.includes('402'));

/** Does a resolved schema (possibly via allOf) look like the standard Error envelope? */
function isErrorEnvelope(schema: unknown): boolean {
  const s = deref(doc, schema) as any;
  if (!s) return false;
  const required: string[] = [
    ...(s.required ?? []),
    ...((s.allOf ?? []).flatMap((sub: any) => (deref(doc, sub) as any)?.required ?? [])),
  ];
  return required.includes('code') && required.includes('message');
}

describe('openapi surface', () => {
  it('loads OpenAPI 3.x with the /api/v1 server and at least one operation', () => {
    expect(String(doc.openapi)).toMatch(/^3\./);
    expect(doc.servers?.[0]?.url).toBe('/api/v1');
    expect(operations.length).toBeGreaterThan(0);
  });

  it('declares global bearerAuth security', () => {
    expect(doc.components?.securitySchemes?.bearerAuth).toBeTruthy();
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  it('has globally unique operationIds', () => {
    const ids = operations.map((o) => o.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every local $ref pointer', () => {
    const dangling = [...new Set(collectRefs(doc))].filter((ref) => {
      try {
        resolveRef(doc, ref);
        return false;
      } catch {
        return true;
      }
    });
    expect(dangling).toEqual([]);
  });
});

describe('operation invariants (generated per endpoint)', () => {
  it.each(operations)('$method $path documents a 2xx success response', (op) => {
    expect(op.operationId, `${op.method} ${op.path} missing operationId`).toBeTruthy();
    expect(op.successStatuses.length, `${op.method} ${op.path} has no 2xx response`).toBeGreaterThan(0);
  });

  it.each(authOps)('$method $path (auth-required) declares 401 with the Error envelope', (op) => {
    expect(op.statusCodes, `${op.method} ${op.path} missing 401`).toContain('401');
    const res401 = op.responses.find((r) => r.status === '401');
    expect(isErrorEnvelope(res401?.schema), `${op.method} ${op.path} 401 is not an Error envelope`).toBe(true);
  });

  it.each(bodyOps)('$method $path requestBody references a resolvable JSON schema', (op) => {
    expect(op.requestBodySchema, `${op.method} ${op.path} requestBody has no JSON schema`).toBeTruthy();
    // deref throws on a dangling ref → resolvability is asserted by not throwing.
    expect(deref(doc, op.requestBodySchema)).toBeTruthy();
  });
});

describe('error + quota conventions', () => {
  it('404 responses use the standard Error envelope', () => {
    const with404 = operations.filter((o) => o.statusCodes.includes('404'));
    expect(with404.length).toBeGreaterThan(0);
    for (const op of with404) {
      const res = op.responses.find((r) => r.status === '404');
      expect(isErrorEnvelope(res?.schema), `${op.method} ${op.path} 404 is not an Error envelope`).toBe(true);
    }
  });

  it('QuotaExceededError requires QUOTA_EXCEEDED code + upgrade_url (PLAN.md §5)', () => {
    const q = doc.components?.schemas?.QuotaExceededError;
    expect(q).toBeTruthy();
    // Valid payload passes; a missing upgrade_url / wrong code fails — proving the guard.
    expect(validate({ code: 'QUOTA_EXCEEDED', message: 'x', upgrade_url: 'https://app/upgrade' }, q, doc)).toEqual([]);
    expect(validate({ code: 'WRONG', message: 'x', upgrade_url: 'https://app/upgrade' }, q, doc).length).toBeGreaterThan(0);
    expect(validate({ code: 'QUOTA_EXCEEDED', message: 'x' }, q, doc)).toContain(
      '$: missing required property "upgrade_url"',
    );
  });

  it.each(quotaOps)('$method $path declares 402 QuotaExceeded per the quota convention', (op) => {
    const res = op.responses.find((r) => r.status === '402');
    const errs = validate(
      { code: 'QUOTA_EXCEEDED', message: 'quota', upgrade_url: 'https://app/upgrade' },
      res?.schema,
      doc,
    );
    expect(errs, `${op.method} ${op.path} 402 does not accept the QUOTA_EXCEEDED shape`).toEqual([]);
  });
});
