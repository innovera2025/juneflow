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
// out-of-set status is rejected 400. B-395 (audit H2): POST/PUT are gated on
// master.create / master.edit — a caller without the right is 403'd BEFORE any
// write, which is a money property, not master-data tidiness (`vendor.bank` is
// the beneficiaryAccountNo the bank payment file pays to, bank.ts:684).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { vendors, users, roles } from "@juneflow/db";
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
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — it is
      // invoked once per DOOR CALL and never in the `values(...)` body, which
      // would make `.returning()` double-count. Proven by the single-recording
      // evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          return [{ id: `new-${seq++}`, ...values }];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
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

// B-395 (audit H2): creating/editing a vendor is master-data administration
// (B-084 class), now gated on master.create / master.edit. loadCaller resolves
// the session email → dictionary `user` → `role`, so every WRITE fixture must
// carry both rows for the caller to be attributable at all (models.test.ts:347).
const masterRole = {
  id: "role-admin", companyId: COMPANY, name: "Admin", approvalLimits: {},
  perms: { master: { view: true, create: true, edit: true, approve: true, cancel: true } },
  approvalLevel: 4, approvalLimit: null, currencyCode: "THB",
  createdAt: new Date(), updatedAt: new Date(),
};
const callerUser = {
  id: "u-caller", companyId: COMPANY, email: SESSION.user.email, name: "สมชาย",
  roleId: "role-admin", status: "active", department: null,
  createdAt: new Date(), updatedAt: new Date(),
};
/** The two dictionary rows loadCaller() reads — caller HOLDS master.create/edit. */
const AUTHZ_ROWS: Array<[unknown, unknown[]]> = [
  [users, [callerUser]],
  [roles, [masterRole]],
];

// The seed `wh` (warehouse) role holds ZERO master perms — the role the B-395
// live probe ran as (anucha@rungrueang.co.th → Warehouse): PUT and POST both
// answered 403 and the target supplier's `bank` column did not move.
// Attributable, authenticated, and still denied. The perms below mirror the
// seeded row exactly (master absent entirely; inventory approve IS true).
const whRole = {
  ...masterRole, id: "role-wh", name: "คลังสินค้า",
  perms: { inventory: { view: true, create: true, edit: true, approve: true, cancel: false } },
  approvalLevel: 1,
};
const whUser = { ...callerUser, id: "u-wh", roleId: "role-wh" };
/** Same two doors, a role WITHOUT master.create/edit. */
const WH_ROWS: Array<[unknown, unknown[]]> = [
  [users, [whUser]],
  [roles, [whRole]],
];

/**
 * The vendor's STORED bank string after replaying every captured update onto the
 * base row — the money value bank.ts:684 exports as beneficiaryAccountNo. An
 * escaped write shows up here even if the status code looks right, so the
 * "unchanged" assertions below are not satisfiable by an empty capture alone
 * (the positive control proves this reducer does observe a real bank write).
 */
function bankAfter(updates: Updated[], base: { bank: string | null }): unknown {
  return updates.reduce<unknown>(
    (value, u) =>
      Object.prototype.hasOwnProperty.call(u.set, "bank") ? u.set.bank : value,
    base.bank,
  );
}

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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "ไม่ระบุชนิด" } });
    expect(inserted[0]!.values.kind).toBe("supplier");
  });

  it("stores a non-numeric credit term as null (backend does not guess days)", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
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
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS] }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { kind: "supplier" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("400s an invalid kind", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS] }),
      })
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
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated, updateBase: SUP1 }),
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
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated, updateBase: SUP1 }),
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
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated, updateBase: SUP1 }),
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
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated }),
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
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated }),
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
        db: stubDb({ rows: [[vendors, []], ...AUTHZ_ROWS], updated }),
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

// ===========================================================================
// B-395 (audit H2) · the master.create / master.edit gates.
//
// Before this, POST /vendors and PUT /vendors/:id had NO authz gate: the global
// onRequest hook only 401s a MISSING tenant, so ANY tenant member — including
// the seed `wh` role, which holds zero master perms — could mint a payee or
// rewrite an existing vendor's `bank`. That column is the beneficiaryAccountNo
// the generated bank payment file pays to (bank.ts:684), so the hole paid a
// real vendor's AP to an attacker-controlled account on the next export.
//
// Each denial below is asserted on the STATUS, the error CODE, and the absence
// of the write — a status-only test would still pass if a later edit moved the
// gate below the insert/update. The positive control on each pair is the SAME
// fixture and the SAME payload, differing only in the caller's role rows, so a
// green denial cannot be an artifact of a fixture that never writes anyway.
//
// Both mutants were run, not assumed: neutering each `permAllowed` check fails
// 5 of these (both positive controls stay green, as they must — they do not
// depend on the gate), and MOVING the PUT gate below the update — which still
// answers 403 — fails the 3 write-absence assertions. Nothing here passes on a
// vendors.ts without the gate.
// ===========================================================================
const ATTACKER_BANK = "BAY 999-0-00000-1";

describe("B-395 · POST /api/v1/vendors is gated on master.create", () => {
  it("403s a caller whose role lacks master.create — and inserts nothing", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS], ...WH_ROWS], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: { name: "บจก. ผู้รับเงินปลอม", bank: ATTACKER_BANK },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toBe("requires master.create permission");
    // No fake payee was minted — the money property, not just the status code.
    expect(inserted).toHaveLength(0);
  });

  it("still creates for a caller holding master.create (same fixture, same payload)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS], ...AUTHZ_ROWS], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/vendors",
      payload: { name: "บจก. ผู้รับเงินปลอม", bank: ATTACKER_BANK },
    });
    expect(res.statusCode).toBe(201);
    // The capture list DOES fill on this fixture — so the empty list above is
    // the gate biting, not a stub that records nothing.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.values.bank).toBe(ATTACKER_BANK);
  });

  it("403s an unattributable caller (session, but no dictionary user row) — fail closed", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, VENDORS]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/vendors", payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(inserted).toHaveLength(0);
  });
});

describe("B-395 · PUT /api/v1/vendors/:id is gated on master.edit", () => {
  it("403s a caller whose role lacks master.edit — and updates nothing", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]], ...WH_ROWS], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { name: "แก้ชื่อ", status: "inactive" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toBe("requires master.edit permission");
    expect(updated).toHaveLength(0);
  });

  it("REGRESSION: a caller lacking master.edit cannot rewrite `bank` (the payout account)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]], ...WH_ROWS], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { bank: ATTACKER_BANK },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    // The MONEY assertion leads deliberately: under a "gate moved below the
    // update" edit the status is still 403, so this is the assertion that fires.
    // The stored beneficiary account is untouched — the next bank export still
    // pays KBANK 012-3-45678-9.
    expect(bankAfter(updated, SUP1)).toBe("KBANK 012-3-45678-9");
    // and no captured write carried the attacker's account at all.
    expect(updated.flatMap((u) => Object.values(u.set))).not.toContain(ATTACKER_BANK);
    expect(updated).toHaveLength(0);
  });

  it("still updates `bank` for a caller holding master.edit (same fixture, same payload)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]], ...AUTHZ_ROWS], updated, updateBase: SUP1 }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/vendors/v-sup1",
      payload: { bank: ATTACKER_BANK },
    });
    expect(res.statusCode).toBe(200);
    expect(updated).toHaveLength(1);
    // bankAfter() DOES observe a bank rewrite on this fixture — so the
    // "unchanged" assertion above is a live property, not a vacuous one.
    expect(bankAfter(updated, SUP1)).toBe(ATTACKER_BANK);
    expect(res.json().bank).toBe(ATTACKER_BANK);
  });

  it("403s an unattributable caller (session, but no dictionary user row) — fail closed", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [SUP1]]], updated, updateBase: SUP1 }),
      })
    ).inject({ method: "PUT", url: "/api/v1/vendors/v-sup1", payload: { bank: ATTACKER_BANK } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(updated).toHaveLength(0);
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing vendors.ts does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce
// is a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    // The awaited-directly door (what the plain scoped TenantDb.insert() hits).
    const bare = await doorOf(db, vendors).values({ name: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, vendors).values({ name: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: vendors, values: { name: "bare" } },
      { table: vendors, values: { name: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", name: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", name: "ret" }]);
  });
});
