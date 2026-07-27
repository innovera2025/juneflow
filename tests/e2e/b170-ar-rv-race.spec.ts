import { test, expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

// B-170 AR /ar/rv concurrent double cash-receipt — a live REAL-concurrency proof.
// The money-idempotency audit + orch-B ground-truth found createArRv's over-allocation
// guard reads Σ prior rv.amount OUTSIDE the tx with NO unique index on the rv table, so
// two concurrent full-amount receipts for one invoice both pass the guard and both commit
// → double cash-in (2× the invoice) → two duplicate receipt JVs at /gl/post.
//
// Expected AFTER the Wei=ก fix (SELECT FOR UPDATE the invoice + Σ-read inside the tx):
//   N concurrent full-amount receipts → EXACTLY ONE 201, the rest 409 over-allocation,
//   and the ledger truth: Σ committed receipts ≤ the invoice total (no double cash-in).
// BEFORE the fix this test FAILS on `main` (documents the bug — [201,201,…]).
//
// Gated on E2E_LIVE (mirrors b163 / b097-rollback): default vitest/CI stays green (the
// stack need not be up); E2E_LIVE=1 runs it against the live seeded stack via E2E_API_URL.
// F4-safe: a login 429 tags rate-limit and every test skips honestly (never a false green).

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

/** Concurrent fan-out — N simultaneous full-amount receipts of one invoice. High N
 * widens the odds that ≥2 read priorRvs before either commits (the TOCTOU window). */
const N = 15;

/** Rows out of a B-014 list envelope ({data}) — defensive over {items}/bare array. */
function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
async function errorCode(res: APIResponse): Promise<string | undefined> {
  try {
    const b = (await res.json()) as { code?: unknown };
    return typeof b.code === "string" ? b.code : undefined;
  } catch {
    return undefined;
  }
}
async function okJson(res: APIResponse, what: string): Promise<Record<string, unknown>> {
  if (!res.ok()) throw new Error(`${what} → ${res.status()}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * An AR invoice that still has a positive outstanding balance (so a full-amount receipt
 * is a legitimate settlement) and is NOT already fully received. Returns {id, outstanding}
 * or null when the seed has none (→ the test skips honestly rather than false-pass).
 */
async function openInvoice(
  client: APIRequestContext,
): Promise<{ id: string; outstanding: number } | null> {
  const rows = rowsOf(await okJson(await client.get("/api/v1/ar/invoices"), "GET /ar/invoices"));
  for (const r of rows) {
    const total = round2(num(r.amount) + num(r.vat));
    const outstanding =
      r.outstanding != null ? round2(num(r.outstanding)) : total; // fall back to full total
    if (String(r.status) !== "paid" && outstanding > 0) {
      return { id: String(r.id), outstanding };
    }
  }
  return null;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Σ of committed receipts recorded against one invoice (GET /ar/rv). */
async function receiptsFor(client: APIRequestContext, invoiceId: string): Promise<number> {
  const rows = rowsOf(await okJson(await client.get("/api/v1/ar/rv"), "GET /ar/rv"));
  return rows
    .filter((r) => String(r.invoice_id ?? r.invoiceId) === invoiceId)
    .reduce((s, r) => s + num(r.amount), 0);
}

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const LOGIN = {
  email: process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th",
  password: process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev",
};

liveDescribe("B-170 AR /ar/rv concurrent double-receipt (live seeded stack, G4)", () => {
  let finMgr: APIRequestContext;
  let rateLimited = false;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/v1/auth/login", { data: LOGIN }).catch(() => null);
    if (!res || res.status() === 429) {
      rateLimited = true;
      await ctx.dispose();
      return;
    }
    const token = ((await res.json().catch(() => ({}))) as { token?: string }).token;
    if (!token) {
      rateLimited = true;
      await ctx.dispose();
      return;
    }
    finMgr = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });
    await ctx.dispose();
  });

  test.afterAll(async () => {
    await finMgr?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) — skip honestly rather than false-fail");
  });

  test("N concurrent full-amount receipts of one invoice → exactly one 201, rest 409; Σ receipts ≤ invoice total (no double cash-in)", async () => {
    const inv = await openInvoice(finMgr);
    test.skip(
      inv == null,
      "no open AR invoice in the seed — cannot prove the over-receipt race without a false pass",
    );
    const { id: invoiceId, outstanding } = inv!;
    const before = await receiptsFor(finMgr, invoiceId);

    // Each of N clients concurrently receives the FULL outstanding amount. Correct
    // behavior: exactly one settles, the rest are over-allocation 409s. The bug (guard
    // read outside the tx + no unique index on rv) lets more than one commit → double
    // cash-in against a single invoice.
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        finMgr.post("/api/v1/ar/rv", { data: { invoice_id: invoiceId, amount: outstanding } }),
      ),
    );
    const statuses = responses.map((r) => r.status());

    expect(
      statuses.filter((s) => s >= 500),
      `no 5xx from the receipt race (got ${statuses.join(",")})`,
    ).toHaveLength(0);
    expect(
      statuses.filter((s) => s === 200 || s === 201),
      `exactly one winning receipt (got ${statuses.join(",")})`,
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === 409),
      `the other ${N - 1} are over-allocation 409 (got ${statuses.join(",")})`,
    ).toHaveLength(N - 1);
    for (const res of responses) {
      if (res.status() === 409) {
        expect(await errorCode(res), "receipt loser → INVALID_STATE").toBe("INVALID_STATE");
      }
    }

    // The ledger truth: total received against this invoice grew by AT MOST one full
    // outstanding — never double. Proves no duplicate cash-in even if statuses were odd.
    const after = await receiptsFor(finMgr, invoiceId);
    expect(
      round2(after - before),
      `received grew by exactly one outstanding (before ${before}, after ${after}, outstanding ${outstanding})`,
    ).toBeLessThanOrEqual(outstanding);
  });
});
