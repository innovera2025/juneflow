// tests/e2e/_api-client.ts — shared FLOW-A E2E plumbing (Gate G4).
//
// A `_`-prefixed, non-`*.spec.ts` module: Playwright's default testMatch
// (`**/*.@(spec|test).ts`) never collects it, so it carries the login + API
// helpers the procurement money-path specs share WITHOUT becoming a test itself.
//
// The two specs that import this (procurement-flow.spec.ts + b084-exploit.spec.ts)
// drive the REAL api behind the seeded compose stack, black-box, over the genuine
// bearer-JWT flow (POST /api/v1/auth/login → Authorization: Bearer <token>). This
// module holds ONLY the mechanics (auth, request contexts, seed-user identities,
// spec-derived tier constants) — every expected VALUE (status enums, tier
// thresholds, approval-level ladder) is asserted in the specs from the flows.html
// state machine + Approval Matrix, never derived from the api implementation
// (tests/CLAUDE.md iron rule).
//
// API base: E2E_API_URL (default http://localhost:3000 — the compose api port,
// same default as smoke.spec.ts). Contract routes live under /api/v1
// (apps/api/src/app.ts); /health is the only root path.

import { type APIRequestContext, request as pwRequest } from "@playwright/test";

/** The compose api origin under test (matches smoke.spec.ts E2E_API_URL default). */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";

/** DEV-only seed credential shared by every seeded auth_account (packages/db seed). */
export const SEED_PASSWORD = "juneflow-dev";

// ---------------------------------------------------------------------------
// Seed identities — the central seed (packages/db seed/index.ts) assigns each
// COMPANY_USERS row a role by index cycling ROLE_DEFS, and every role carries an
// `approvalLevel` (ROLE_DEFS `level`). These four users give one holder of each
// approval tier we need for the FLOW-A ladder. Emails + the tier each role sits
// at come from the seed data (central-seed only — tests/CLAUDE.md), NOT from any
// api handler. The APPROVAL LADDER SEMANTICS that make a given level pass/fail a
// given amount are asserted in the specs from the flows.html Approval Matrix.
// ---------------------------------------------------------------------------

/** Site Engineer — approval level 1. Has pr.create; cannot approve a tiered doc. */
export const USER_SITE_L1 = "pranee@rungrueang.co.th";
/** Procurement Mgr (หน.จัดซื้อ) — approval level 2. The base-tier PO/PR approver. */
export const USER_PROC_L2 = "teerapong@rungrueang.co.th";
/** Project Manager (ผจก.โครงการ) — approval level 3. The mid tier (PR >500K / PO >1M). */
export const USER_PM_L3 = "somchai@rungrueang.co.th";
/** Director / MD — approval level 4. The top tier (PR >2M / PO >5M), unlimited. */
export const USER_MD_L4 = "wipha@rungrueang.co.th";

// ---------------------------------------------------------------------------
// Spec-derived constants — flows.html "Approval Matrix (ขั้นอนุมัติตามมูลค่า)".
// These are the AUTHORITATIVE thresholds (docs/handoff/flows.html, MATRIX rows
// "PR ใบขอซื้อ" + "PO / WO"), transcribed here as the source of truth the specs
// assert against — the api must MATCH these, so they are declared independent of
// it. Strict `>` (flows.html "&gt;"): a doc escalates a tier only ABOVE the line.
// ---------------------------------------------------------------------------

/** PR tier lines (THB, strict >): >500K → ผจก.โครงการ; >2M → MD (flows.html PR row). */
export const PR_TIER_PM = 500_000;
export const PR_TIER_MD = 2_000_000;
/** PO/WO tier lines (THB, strict >): >1M → ผจก.โครงการ; >5M → MD (flows.html PO/WO row). */
export const PO_TIER_PM = 1_000_000;
export const PO_TIER_MD = 5_000_000;

/** FLOW-A document state machine (flows.html "สถานะ PR/PO/PV"). */
export const STATUS = {
  draft: "draft",
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
} as const;

/** A monotonically-unique document number so parallel/repeated runs never collide. */
let seq = 0;
export function uniqueNo(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

/**
 * Authenticate a seed user over the REAL bearer flow and return the session
 * token. Throws loudly (not a silent skip) if login fails — a broken seed/stack
 * must fail the gate, not pass vacuously.
 */
export async function login(email: string, password = SEED_PASSWORD): Promise<string> {
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  try {
    const res = await ctx.post("/api/v1/auth/login", { data: { email, password } });
    if (res.status() !== 200) {
      throw new Error(`login ${email} failed: HTTP ${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) {
      throw new Error(`login ${email} returned no bearer token`);
    }
    return body.token;
  } finally {
    await ctx.dispose();
  }
}

/** A bearer-authenticated APIRequestContext for a seed user (login first). */
export async function clientFor(email: string): Promise<APIRequestContext> {
  const token = await login(email);
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

/** Parse a 200-OK JSON body, else throw with the status + text (fail loud). */
export async function okJson(
  res: { status(): number; json(): Promise<unknown>; text(): Promise<string> },
  what: string,
): Promise<Record<string, unknown>> {
  if (res.status() < 200 || res.status() >= 300) {
    throw new Error(`${what}: expected 2xx, got HTTP ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** The tenant's first project id (any project anchors a PR — scope flows via project_id). */
export async function firstProjectId(client: APIRequestContext): Promise<string> {
  const body = await okJson(await client.get("/api/v1/projects"), "GET /projects");
  const data = body.data as Array<{ id: string }>;
  if (!data?.length) throw new Error("no seeded projects");
  return data[0]!.id;
}

/** The tenant's first vendor id (a PO must reference a tenant vendor). */
export async function firstVendorId(client: APIRequestContext): Promise<string> {
  const body = await okJson(await client.get("/api/v1/vendors"), "GET /vendors");
  const data = body.data as Array<{ id: string }>;
  if (!data?.length) throw new Error("no seeded vendors");
  return data[0]!.id;
}

/** One priced BOQ item {id, price}. */
export interface BoqItem {
  id: string;
  price: number;
}

/**
 * Every priced BOQ item of the tenant, ascending by unit price. A PR line priced
 * from a cheap item needs a large qty (good for a partial GR); an expensive item
 * reaches the >5M PO tier in a couple of units (the B-084 exploit setup). Sourced
 * live so the specs compute quantities from the SAME prices the api sums — the
 * tier-band asserts then catch any amount-computation drift.
 */
export async function boqItemsByPrice(client: APIRequestContext): Promise<BoqItem[]> {
  const docs = await okJson(await client.get("/api/v1/boq"), "GET /boq");
  const docRows = docs.data as Array<{ id: string; total: number }>;
  const items: BoqItem[] = [];
  for (const doc of docRows) {
    if (!(doc.total > 0)) continue; // only docs that actually carry priced lines
    const body = await okJson(
      await client.get(`/api/v1/boq/${doc.id}/items`),
      `GET /boq/${doc.id}/items`,
    );
    for (const it of body.data as Array<{ id: string; price: number }>) {
      if (Number.isFinite(it.price) && it.price > 0) items.push({ id: it.id, price: it.price });
    }
  }
  if (!items.length) throw new Error("no priced BOQ items in the seed");
  return items.sort((a, b) => a.price - b.price);
}
