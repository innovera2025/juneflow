// G3 unit tests (PLAN.md §9) — audit-log middleware: EVERY successful mutation
// writes exactly one AuditLog row; reads and failed mutations write none
// (PLAN.md §5, apps/api/CLAUDE.md).
//
// Strategy mirrors tenant-scope.test.ts: a real Fastify app driven by .inject()
// with a spy sink (no DB). The tenant is stubbed so request.tenant is present,
// exactly as the tenant-scope hook would set it in production.
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuditLog, type AuditRecord } from "./audit-log.js";

const COMPANY = "33333333-3333-3333-3333-333333333333";

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

/** App with a spy sink and a set of routes exercising each method/outcome. */
async function buildApp(): Promise<{ app: FastifyInstance; records: AuditRecord[] }> {
  const records: AuditRecord[] = [];
  app = Fastify();
  // Stand in for the tenant-scope hook: attach a tenant to every request.
  app.addHook("onRequest", async (request) => {
    request.tenant = { companyId: COMPANY };
  });
  await registerAuditLog(app, {
    sink: (record) => {
      records.push(record);
    },
    resolveUserId: () => "user-1",
  });
  app.get("/projects", async () => ({ ok: true }));
  app.post("/projects", async () => ({ id: "p1" }));
  app.post("/projects/:id/approve", async () => ({ ok: true }));
  app.put("/projects/:id", async () => ({ ok: true }));
  app.delete("/projects/:id", async () => ({ ok: true }));
  app.post("/projects/fail", async (_req, reply) => reply.code(400).send({ bad: true }));
  await app.ready();
  return { app, records };
}

describe("reads are never audited", () => {
  it("writes no record for a GET", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(0);
  });
});

describe("every successful mutation writes exactly one record", () => {
  it("audits a POST create with company_id, action=create, entity, body as after", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Tower A" },
    });
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      companyId: COMPANY,
      userId: "user-1",
      action: "create",
      entity: "/projects",
      after: { name: "Tower A" },
    });
    expect(records[0]!.at).toBeInstanceOf(Date);
  });

  it.each([
    ["PUT", "/projects/p1", "update"],
    ["DELETE", "/projects/p1", "delete"],
  ])("audits a %s as action=%s", async (method, url, action) => {
    const { app, records } = await buildApp();
    await app.inject({ method: method as "PUT" | "DELETE", url });
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe(action);
  });

  it("derives the verb for an action endpoint (POST /:id/approve → approve)", async () => {
    const { app, records } = await buildApp();
    await app.inject({ method: "POST", url: "/projects/p1/approve" });
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe("approve");
  });
});

describe("failed mutations are not audited", () => {
  it("writes no record when the mutation returns 4xx (no state changed)", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "POST", url: "/projects/fail" });
    expect(res.statusCode).toBe(400);
    expect(records).toHaveLength(0);
  });
});

describe("mutations without a tenant are not audited", () => {
  it("writes no orphan row when request.tenant is absent", async () => {
    const records: AuditRecord[] = [];
    app = Fastify(); // no tenant hook this time
    await registerAuditLog(app, { sink: (r) => records.push(r) });
    app.post("/projects", async () => ({ id: "p1" }));
    await app.ready();
    await app.inject({ method: "POST", url: "/projects" });
    expect(records).toHaveLength(0);
  });
});
