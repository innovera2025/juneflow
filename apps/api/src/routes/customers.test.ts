// G3 unit tests (PLAN.md §9) — customers read handlers (Phase-3 Finance
// round-A, C-179). Covers GET /customers (company-scoped list envelope, sorted
// by name, fail-closed 401) and GET /customers/{id} (scoped fetch, 404 for a
// foreign/unknown id, 401 without a tenant). Reads need only a resolved tenant
// (no perm gate). Expected values come from the stub — never hand-computed.
//
// The routes are wired in app.ts (registerCustomersRoute) → buildApp mounts them;
// the root tenant-scope hook populates request.db, so the tests exercise the real
// fail-closed path.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { customers } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

/** Minimal Db stub: db.select(customers) resolves the canned rows (list or by-id;
 *  the stub does not filter — the by-id 404 case passes an empty row set). */
function stubDb(rows: (typeof customers.$inferSelect)[]): Db {
  const builder = {
    $dynamic: () => builder,
    where: () => Promise.resolve(rows),
    then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onOk, onErr),
  };
  return {
    select: () => ({ from: () => builder }),
  } as unknown as Db;
}

const customer = (
  id: string,
  name: string,
  taxId: string | null = "0105551234567",
): typeof customers.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    name,
    taxId,
    createdAt: D,
    updatedAt: D,
  }) as typeof customers.$inferSelect;

const C1 = "c1111111-0000-0000-0000-0000000000c1";
const C2 = "c2222222-0000-0000-0000-0000000000c2";
const FOREIGN = "ffffffff-0000-0000-0000-00000000ffff";

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

describe("GET /api/v1/customers", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "GET",
      url: "/api/v1/customers",
    });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's customers as a name-sorted envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([customer(C2, "Zenith Co"), customer(C1, "Acme Co")]),
      })
    ).inject({ method: "GET", url: "/api/v1/customers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((c: { name: string }) => c.name)).toEqual([
      "Acme Co",
      "Zenith Co",
    ]);
    // wire = REAL columns only (id, name, tax_id, created_at) — no fabricated field.
    expect(body.data[0]).toMatchObject({ id: C1, name: "Acme Co", tax_id: "0105551234567" });
  });
});

describe("GET /api/v1/customers/:id", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "GET",
      url: `/api/v1/customers/${C1}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the customer when it belongs to this tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([customer(C1, "Acme Co")]),
      })
    ).inject({ method: "GET", url: `/api/v1/customers/${C1}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: C1, name: "Acme Co", tax_id: "0105551234567" });
  });

  it("404s a foreign / unknown id (scoped select resolves nothing)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([]), // scoped select returns nothing for a foreign id
      })
    ).inject({ method: "GET", url: `/api/v1/customers/${FOREIGN}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});
