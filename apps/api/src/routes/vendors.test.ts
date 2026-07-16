// G3 unit tests (PLAN.md §9) — GET/POST /vendors + GET/PUT /vendors/:id
// (P2-BE-01, B-070; master-party.jsx PartyVendors/VendorAddForm). Covers the
// B-014 list envelope, the ?kind=supplier|subcon filter, tenant scope on every
// read/write (company_id bound, no cross-tenant leak), create (201, force-set
// company_id), get-by-id (200 / 404), PUT partial-merge (200 / 404), the kind
// validation, and the fail-closed 401. The wire shape is the DB subset
// {id, name, code, tax_id, kind, credit_term, addr, bank, status} (B-071 added
// code/addr/bank/status) — spend/type are deliberately absent (no AP source /
// display-derived from kind). B-071 (P2-BE-08): the new columns are returned by
// every read, accepted by POST/PUT, status defaults active on create, and an
// out-of-set status is rejected 400.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { vendors } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}

interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  /** Base row merged with the update SET to synthesize the RETURNING row. */
  updateBase?: Record<string, unknown>;
}

/** Base Db stub: canned rows per table for reads; capture of write ops. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve([{ id: `new-${seq++}`, ...values }]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([{ ...updateBase, ...set }]);
          },
        }),
      }),
    }),
  } as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb({ rows: [] }),
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

// A small vendor master: 2 suppliers + 1 subcon (mixed kinds so the filter bites).
// B-071: code/addr/bank/status are the superset columns; `extra` carries them.
interface VendorExtra {
  code?: string | null;
  addr?: string | null;
  bank?: string | null;
  status?: string;
}
const vendor = (
  id: string,
  name: string,
  taxId: string | null,
  kind: "supplier" | "subcon",
  creditTerm: number | null,
  extra: VendorExtra = {},
) => ({
  id,
  companyId: COMPANY,
  name,
  code: extra.code ?? null,
  taxId,
  kind,
  creditTerm,
  addr: extra.addr ?? null,
  bank: extra.bank ?? null,
  status: extra.status ?? "active",
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});
const SUP1 = vendor("v-sup1", "บจก. รุ่งเรืองวัสดุก่อสร้าง", "0105545012345", "supplier", 30, {
  code: "V-0012",
  addr: "ถ.พหลโยธิน กทม.",
  bank: "KBANK 012-3-45678-9",
  status: "active",
});
const SUP2 = vendor("v-sup2", "หจก. ช่างเหล็กไทย", "0103539008765", "supplier", 45, {
  code: "V-0024",
  status: "inactive",
});
const SUB1 = vendor("v-sub1", "บจก. รุ่งเรืองก่อสร้าง", null, "subcon", null, { code: "SC-01" });
const VENDORS = [SUP1, SUP2, SUB1];

describe("GET /api/v1/vendors — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/vendors" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
});

describe("GET /api/v1/vendors — list envelope + kind filter", () => {
  it("returns the B-014 envelope of opaque vendor rows (no company_id / timestamp leak)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ url: "/api/v1/vendors" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["v-sup1", "v-sup2", "v-sub1"]);
    // wire shape is the DB subset — spend/type/company_id/timestamps absent;
    // B-071 added code/addr/bank/status.
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["addr", "bank", "code", "credit_term", "id", "kind", "name", "status", "tax_id"],
    );
    expect(body.data[0].tax_id).toBe("0105545012345");
    expect(body.data[0].credit_term).toBe(30);
    // B-071 superset columns are returned verbatim.
    expect(body.data[0].code).toBe("V-0012");
    expect(body.data[0].addr).toBe("ถ.พหลโยธิน กทม.");
    expect(body.data[0].bank).toBe("KBANK 012-3-45678-9");
    expect(body.data[0].status).toBe("active");
    // an inactive vendor round-trips its status.
    expect(body.data[1].status).toBe("inactive");
  });

  it("honours ?kind=supplier (only suppliers)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ url: "/api/v1/vendors?kind=supplier" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.every((r: { kind: string }) => r.kind === "supplier")).toBe(true);
  });

  it("honours ?kind=subcon (only subcons)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ url: "/api/v1/vendors?kind=subcon" });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("v-sub1");
  });

  it("ignores an out-of-enum kind (→ full list, no 400)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ url: "/api/v1/vendors?kind=bogus" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(3);
  });

  it("binds company_id on the read (tenant scope, no leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], captured }),
      })
    ).inject({ url: "/api/v1/vendors" });
    const call = captured.find((c) => c.table === vendors);
    expect(call).toBeTruthy();
    expect(paramsOf(call!.where)).toContain(COMPANY);
  });
});

describe("POST /api/v1/vendors — create rules", () => {
  it("creates a supplier (201), force-setting company_id via the scoped door", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: { name: "บจก. ใหม่", kind: "supplier", tax_id: "0105560778800", credit_term: 60 },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted[0]!.values;
    expect(v.name).toBe("บจก. ใหม่");
    expect(v.kind).toBe("supplier");
    expect(v.taxId).toBe("0105560778800");
    expect(v.creditTerm).toBe(60);
    // scoped insert() force-sets company_id (never trusts a client value).
    expect(v.companyId).toBe(COMPANY);
    // response echoes the opaque wire shape.
    expect(res.json().kind).toBe("supplier");
  });

  it("persists the B-071 superset fields (code / addr / bank / status)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: {
        name: "บจก. หัวเว่ย เทคโนโลยี",
        code: "V-0061",
        addr: "ถ.วิภาวดี กทม.",
        bank: "SCB 555-6-11223-4",
        status: "inactive",
      },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted[0]!.values;
    expect(v.code).toBe("V-0061");
    expect(v.addr).toBe("ถ.วิภาวดี กทม.");
    expect(v.bank).toBe("SCB 555-6-11223-4");
    expect(v.status).toBe("inactive");
    // and the wire echoes them back.
    const body = res.json();
    expect(body.code).toBe("V-0061");
    expect(body.status).toBe("inactive");
  });

  it("defaults status to active + code/addr/bank to null when none are sent", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "ไม่ระบุรายละเอียด" } });
    const v = inserted[0]!.values;
    expect(v.status).toBe("active");
    expect(v.code).toBeNull();
    expect(v.addr).toBeNull();
    expect(v.bank).toBeNull();
  });

  it("400s an out-of-set status (closed set enforced by the handler, not the DB)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "x", status: "archived" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(inserted).toHaveLength(0);
  });

  it("maps a subcon kind through unchanged (web maps 4-way type → kind first, B-070)", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: { name: "ผู้รับเหมา ก", kind: "subcon" },
    });
    expect(inserted[0]!.values.kind).toBe("subcon");
    // absent tax_id / credit_term → null (never invented).
    expect(inserted[0]!.values.taxId).toBeNull();
    expect(inserted[0]!.values.creditTerm).toBeNull();
  });

  it("defaults kind to supplier when none is sent", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "ไม่ระบุชนิด" } });
    expect(inserted[0]!.values.kind).toBe("supplier");
  });

  it("stores a non-numeric credit term as null (backend does not guess days)", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: { name: "เงินสดวี", credit_term: "เงินสด" },
    });
    expect(inserted[0]!.values.creditTerm).toBeNull();
  });

  it("400s a missing name", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { kind: "supplier" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("400s an invalid kind", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, VENDORS]] }) })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "x", kind: "material" } });
    expect(res.statusCode).toBe(400);
  });

  it("401s a create without a session (fail closed, no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ db: stubDb({ rows: [[vendors, VENDORS]], inserted }) })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "x" } });
    expect(res.statusCode).toBe(401);
    expect(inserted).toHaveLength(0);
  });
});

describe("GET /api/v1/vendors/:id — single fetch", () => {
  it("returns one vendor (200), scoped by company_id", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], captured }),
      })
    ).inject({ url: "/api/v1/vendors/v-sup1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("v-sup1");
    // the read is bound to both company_id and the requested id.
    const call = captured.find((c) => c.table === vendors);
    const params = paramsOf(call!.where);
    expect(params).toContain(COMPANY);
    expect(params).toContain("v-sup1");
  });

  it("404s an id outside the tenant (scoped select resolves to nothing)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[vendors, []]] }) })
    ).inject({ url: "/api/v1/vendors/v-ghost" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("401s without a session", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/vendors/v-sup1" });
    expect(res.statusCode).toBe(401);
  });
});

describe("PUT /api/v1/vendors/:id — partial merge", () => {
  it("merges ONLY the provided fields (omitted fields untouched), scoped by company_id", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { credit_term: 90 },
    });
    expect(res.statusCode).toBe(200);
    const set = updated[0]!.set;
    expect(Object.keys(set)).toEqual(["creditTerm"]); // name/tax_id/kind untouched
    expect(set.creditTerm).toBe(90);
    expect(paramsOf(updated[0]!.where)).toContain(COMPANY);
  });

  it("updates kind (web-mapped) and name together", async () => {
    const updated: Updated[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { name: "แก้ชื่อ", kind: "subcon" },
    });
    expect(updated[0]!.set.name).toBe("แก้ชื่อ");
    expect(updated[0]!.set.kind).toBe("subcon");
  });

  it("merges the B-071 superset fields (code / addr / bank / status)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { code: "V-9999", addr: "ที่อยู่ใหม่", bank: "TTB 999-9-99999-9", status: "inactive" },
    });
    expect(res.statusCode).toBe(200);
    const set = updated[0]!.set;
    expect(set.code).toBe("V-9999");
    expect(set.addr).toBe("ที่อยู่ใหม่");
    expect(set.bank).toBe("TTB 999-9-99999-9");
    expect(set.status).toBe("inactive");
    // credit_term / name / kind / tax_id were not in the body → untouched.
    expect(Object.keys(set).sort()).toEqual(["addr", "bank", "code", "status"]);
    expect(res.json().status).toBe("inactive");
  });

  it("400s an invalid status on update (no write attempted)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated }),
      })
    ).inject({ method: "PUT", url: "/api/v1/vendors/v-sup1", payload: { status: "archived" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(updated).toHaveLength(0);
  });

  it("400s an invalid kind on update (no write attempted)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated }),
      })
    ).inject({ method: "PUT", url: "/api/v1/vendors/v-sup1", payload: { kind: "material" } });
    expect(res.statusCode).toBe(400);
    expect(updated).toHaveLength(0);
  });

  it("404s an id outside the tenant (no update attempted)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, []]], updated }),
      })
    ).inject({ method: "PUT", url: "/api/v1/vendors/v-ghost", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    expect(updated).toHaveLength(0);
  });

  it("401s without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
