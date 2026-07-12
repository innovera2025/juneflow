// G3 unit tests (PLAN.md §9) — tenant-scope middleware: fail closed without a
// tenant, attach a company_id-scoped handle when one is resolved (P0-BE-11).
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb } from "@juneflow/db/client";
import { registerTenantScope } from "./tenant-scope.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
// Never queried in these tests (only the hook constructs a TenantDb over it).
const db = createDb("postgres://u:p@127.0.0.1:5432/juneflow_test");

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

/** App wired with a stub resolver returning `companyId` for every request. */
async function buildApp(companyId: string | null): Promise<FastifyInstance> {
  app = Fastify();
  await registerTenantScope(app, {
    db,
    resolveCompanyId: async () => companyId,
  });
  app.get("/health", async () => ({ ok: true }));
  app.get("/projects", async (request) => ({
    tenant: request.tenant ?? null,
    scoped: request.db?.companyId ?? null,
  }));
  await app.ready();
  return app;
}

describe("public paths bypass tenant scope", () => {
  it("allows /health without any tenant", async () => {
    const res = await (await buildApp(null)).inject({ url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("protected routes fail closed", () => {
  it("rejects with 401 UNAUTHENTICATED when no tenant resolves", async () => {
    const res = await (await buildApp(null)).inject({ url: "/projects" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });

  it("never runs the handler when the tenant is missing", async () => {
    // A missing tenant must short-circuit before the handler; the handler would
    // otherwise return a 200 body, so a 401 proves it never ran.
    const res = await (await buildApp(null)).inject({ url: "/projects" });
    expect(res.statusCode).toBe(401);
  });
});

describe("resolved tenant is attached and scoped", () => {
  it("sets request.tenant and a company_id-scoped request.db", async () => {
    const res = await (await buildApp(COMPANY)).inject({ url: "/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tenant: { companyId: COMPANY },
      scoped: COMPANY,
    });
  });
});
