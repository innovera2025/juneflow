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
const TARGET_COMPANY = "44444444-4444-4444-4444-444444444444";

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
  // B-183: an owner-gated cross-tenant admin READ (a 2xx here means an owner);
  // and a 403 admin read (a denied non-owner) must NOT be logged.
  app.get("/admin/subscribers", async () => ({ ok: true }));
  app.get("/admin/denied", async (_req, reply) => reply.code(403).send({ bad: true }));
  // B-193 W1a: a cross-tenant WRITE stamps the TARGET tenant on the request; the
  // audit row must carry THAT company, not the caller's own (COMPANY).
  app.post("/admin/users/:id/block", async (request) => {
    request.auditTargetCompanyId = TARGET_COMPANY;
    return { ok: true };
  });
  await app.ready();
  return { app, records };
}

describe("reads are never audited (except owner cross-tenant /admin/*)", () => {
  it("writes no record for a normal tenant GET", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(0);
  });

  it("B-183: audits a successful owner /admin/* GET as action=read (who·what·when)", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/subscribers" });
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      companyId: COMPANY,
      userId: "user-1",
      action: "read",
      entity: "/admin/subscribers",
    });
    expect(records[0]!.after).toBeUndefined(); // a read carries no mutation body
    expect(records[0]!.at).toBeInstanceOf(Date);
  });

  it("does NOT audit a DENIED (403) admin read — only a non-owner reaches it", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/denied" });
    expect(res.statusCode).toBe(403);
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

  it("B-193: a cross-tenant write attributes the audit row to the TARGET tenant, not the caller's own", async () => {
    const { app, records } = await buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/users/u-1/block" });
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]!.companyId).toBe(TARGET_COMPANY); // the affected tenant, NOT COMPANY
    expect(records[0]!.companyId).not.toBe(COMPANY);
    expect(records[0]!.action).toBe("block"); // derived from the trailing path segment
  });
});

// B-282: audit_log is durable, append-only and readable through GET /audit-log,
// and the hook records `after: request.body`. POST /auth/reset is the first
// mutating route whose body carries credentials ({token, password}) AND names a
// tenant, so the redaction and that attribution must never be separated.
describe("secrets never reach audit_log", () => {
  it("redacts credential-named fields out of the recorded body, at any depth", async () => {
    const { app, records } = await buildApp();
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: "Tower A",
        password: "correct-horse",
        token: "raw-reset-token",
        photo_after: "after.jpg",
        nested: { client_secret: "sh-1", api_key: "ak-1", label: "keep me" },
        rows: [{ Password: "MiXeD", qty: 3 }],
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]!.after).toEqual({
      name: "Tower A",
      password: "[redacted]",
      token: "[redacted]",
      // Business fields keep their real value — matching is on the key NAME,
      // exact and case-insensitive, never on the value.
      photo_after: "after.jpg",
      nested: { client_secret: "[redacted]", api_key: "[redacted]", label: "keep me" },
      rows: [{ Password: "[redacted]", qty: 3 }],
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("correct-horse");
    expect(serialized).not.toContain("raw-reset-token");
  });

  it("redacts a secret nested BELOW any fixed depth bound — 'at any depth' means any", async () => {
    // The first cut of redactSecrets stopped at `depth > 8` and returned
    // everything under it VERBATIM, while the test above — which nests two
    // levels — already called itself "at any depth". This body is the
    // counter-example that reached audit_log.after in the clear: no route
    // registers a body schema, so any mutating route accepts it and the hook
    // records the whole body.
    const { app, records } = await buildApp();
    let payload: Record<string, unknown> = { password: "correct-horse" };
    for (let i = 0; i < 12; i += 1) payload = { n: payload };

    const res = await app.inject({ method: "POST", url: "/projects", payload });
    expect(res.statusCode).toBe(200);

    expect(records).toHaveLength(1);
    const after = JSON.stringify(records[0]!.after);
    expect(after).not.toContain("correct-horse");
    expect(after).toContain("[redacted]");
    // Redaction COPIES the whole tree — it does not truncate it. A cap that
    // dropped the tail instead of leaking it would also hide the password, so
    // assert the 12 wrappers all survived.
    expect(after.match(/"n":/g)).toHaveLength(12);
  });

  it("leaves request.body itself intact for anything running after the hook", async () => {
    // Redaction copies; it must not overwrite the parsed body in place, or a
    // later hook would see a request that no longer says what the client sent.
    const records: AuditRecord[] = [];
    const bodySeenAfterAudit: unknown[] = [];
    app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.tenant = { companyId: COMPANY };
    });
    await registerAuditLog(app, { sink: (r) => records.push(r) });
    // Registered AFTER the audit hook, so it runs after it (Fastify keeps hook
    // registration order) and observes whatever the audit hook left behind.
    app.addHook("onResponse", async (request) => {
      bodySeenAfterAudit.push(request.body);
    });
    app.post("/projects", async () => ({ id: "p1" }));
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { password: "correct-horse" },
    });

    expect(records[0]!.after).toEqual({ password: "[redacted]" });
    expect(bodySeenAfterAudit).toEqual([{ password: "correct-horse" }]);
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
