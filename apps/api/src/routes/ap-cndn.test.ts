// G3 unit tests (PLAN.md §9) — AP credit-note / debit-note handlers (B-231 · Wei=ก
// Model-A). The payables-side mirror of ar.test.ts: 401 fail-closed, 403 without
// the finance perm, create (server-generated no + company_id force-set + the 400 /
// 404 guards), list envelope, and the approve Model-A JV (BALANCED, 2-line, no-VAT:
// CN Dr 2010 AP / Cr 5020 materials · DN Dr 5100 admin-expense / Cr 2010 AP), with
// source_doc apcn:/apdn:, the idempotent 409 (prior JV), the concurrent 409 (23505),
// and the unknown-id 404. Every expected value comes from the stub — never
// hand-computed against the impl.
//
// The routes are registered onto the built app in buildTestApp (app.ts wiring —
// registerApCnDnRoute). The root tenant-scope + audit hooks apply to them exactly
// as to the other wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apBillings,
  apCreditNotes,
  apDebitNotes,
  glAccounts,
  jvLines,
  jvs,
  roles,
  users,
  vendors,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";
import type { AuditRecord } from "../plugins/audit-log.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

/** A canned rows source: a fixed list, or a where-aware fn (a table read more than
 *  once with different predicates — e.g. jvs idempotency vs ownership). */
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
}

/** Db stub: canned rows per table (reads) + write capture (mirrors ar.test.ts). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [] } = opts;
  const rowsFor = (table: unknown, where: SQL | undefined): unknown[] => {
    for (const [t, r] of rows) {
      if (t === table) return typeof r === "function" ? r(where) : r;
    }
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table, where));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table, undefined)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return Promise.resolve(
            arr.map((v) => {
              const row = v as Record<string, unknown>;
              return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
            }),
          );
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([{ id: "upd", ...set }]);
          },
        }),
      }),
    }),
  };
  // B-097: the transaction door runs its callback against this SAME stub, so writes
  // inside a tx still capture (the fake has no real BEGIN/COMMIT — it proves the
  // door threads one scoped handle).
  raw.transaction = (cb: (tx: unknown) => unknown) => cb(raw);
  return raw as unknown as Db;
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
  // AP CN/DN routes are wired in app.ts (registerApCnDnRoute) → buildApp mounts them.
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const VENDOR = "vend0000-0000-0000-0000-0000000000v1";
const APBILL = "apbl0000-0000-0000-0000-0000000000b1";
const CN0 = "apcn0000-0000-0000-0000-0000000000c1";
const DN0 = "apdn0000-0000-0000-0000-0000000000d1";

const vendorRow = {
  id: VENDOR,
  companyId: COMPANY,
  name: "หจก. รุ่งเรืองวัสดุ",
  createdAt: D,
  updatedAt: D,
};

const apBillingRow = {
  id: APBILL,
  companyId: COMPANY,
  amount: "1000.00",
  currencyCode: "THB",
  status: "draft",
  createdAt: D,
  updatedAt: D,
};

const cnSeed = (
  id: string,
  extra: Partial<typeof apCreditNotes.$inferSelect> = {},
): typeof apCreditNotes.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "CN-2026-0001",
    vendorId: VENDOR,
    refApId: APBILL,
    reason: "คืนสินค้า",
    amount: "1000.00",
    currencyCode: "THB",
    status: null,
    noteDate: null,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof apCreditNotes.$inferSelect;

const dnSeed = (
  id: string,
  extra: Partial<typeof apDebitNotes.$inferSelect> = {},
): typeof apDebitNotes.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "DN-2026-0001",
    vendorId: VENDOR,
    refApId: APBILL,
    reason: "เพิ่มหนี้",
    amount: "1000.00",
    currencyCode: "THB",
    status: null,
    noteDate: null,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof apDebitNotes.$inferSelect;

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance.create / finance.approve perms. */
const roleRow = (financeCreate = true, financeApprove = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance",
  approvalLimits: {},
  perms: {
    finance: {
      view: true,
      create: financeCreate,
      edit: true,
      approve: financeApprove,
      cancel: false,
    },
  },
  approvalLevel: 3,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

// The tenant COA rows the Model-A posts resolve (codes → ids): AP 2010, materials
// 5020 (CN), admin-expense 5100 (DN).
const ACC_AP = "acc-2010";
const ACC_MATERIALS = "acc-5020";
const ACC_ADMIN = "acc-5100";
const coaRows = [
  { id: ACC_AP, companyId: COMPANY, code: "2010", name: "เจ้าหนี้การค้า" },
  { id: ACC_MATERIALS, companyId: COMPANY, code: "5020", name: "วัสดุก่อสร้าง" },
  { id: ACC_ADMIN, companyId: COMPANY, code: "5100", name: "ค่าใช้จ่ายบริหาร" },
];

// jvs is read three ways in the approve post: idempotency (source_doc apcn:/apdn:)
// → none; allocJvNo (all) + insertThrough ownership (jv id + company) → an owned row.
const jvSource = (where: SQL | undefined): unknown[] => {
  const isIdempotencyProbe = paramsOf(where).some(
    (p) => typeof p === "string" && (p.startsWith("apcn:") || p.startsWith("apdn:")),
  );
  return isIdempotencyProbe ? [] : [{ id: "jv-owned", companyId: COMPANY }];
};

// ===========================================================================
// The two notes are structurally identical — table-drive the shared behavior,
// then assert the money direction explicitly per note (below).
// ===========================================================================
interface NoteFixture {
  label: string;
  base: string; // url base: "cn" | "dn"
  noteTable: unknown;
  seed: (id: string, extra?: Record<string, unknown>) => Record<string, unknown>;
  seedId: string;
  noPrefix: string; // "CN" | "DN"
}
const NOTES: NoteFixture[] = [
  { label: "credit", base: "cn", noteTable: apCreditNotes, seed: cnSeed as never, seedId: CN0, noPrefix: "CN" },
  { label: "debit", base: "dn", noteTable: apDebitNotes, seed: dnSeed as never, seedId: DN0, noPrefix: "DN" },
];

for (const N of NOTES) {
  // -------------------------------------------------------------------------
  // GET /ap/{cn|dn}
  // -------------------------------------------------------------------------
  describe(`GET /api/v1/ap/${N.base}`, () => {
    it("401s flat without a session (fail closed)", async () => {
      const res = await (await buildTestApp()).inject({ method: "GET", url: `/api/v1/ap/${N.base}` });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    });

    it("envelopes the notes newest-first (opaque wire, no derived VAT)", async () => {
      const older = N.seed("older", { createdAt: new Date("2024-01-10T00:00:00Z"), no: `${N.noPrefix}-2026-0001` });
      const newer = N.seed("newer", { createdAt: new Date("2024-02-10T00:00:00Z"), no: `${N.noPrefix}-2026-0002` });
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[N.noteTable, [older, newer]]] }),
        })
      ).inject({ method: "GET", url: `/api/v1/ap/${N.base}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.data[0].id).toBe("newer"); // newest first
      const row = body.data[0];
      expect(row.vendor_id).toBe(VENDOR);
      expect(row.ref_ap_id).toBe(APBILL);
      expect(row.amount).toBe(1000);
      expect(row.currency_code).toBe("THB");
      expect(row.vat).toBeUndefined(); // Model-A is NO-VAT (no derived vat field)
    });
  });

  // -------------------------------------------------------------------------
  // POST /ap/{cn|dn}
  // -------------------------------------------------------------------------
  describe(`POST /api/v1/ap/${N.base}`, () => {
    const createDb = (inserted: Inserted[] = [], existing: unknown[] = []) =>
      stubDb({
        rows: [
          [vendors, [vendorRow]],
          [apBillings, [apBillingRow]],
          [N.noteTable, existing], // nextNoteNo running-number scan
          [users, [userRow]],
          [roles, [roleRow(true)]],
        ],
        inserted,
      });

    it("401s flat without a session", async () => {
      const res = await (await buildTestApp()).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(401);
    });

    it("403s a caller without the finance.create perm (fail closed)", async () => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [[vendors, [vendorRow]], [apBillings, [apBillingRow]], [users, [userRow]], [roles, [roleRow(false)]]],
          }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/finance create permission/);
    });

    it("creates the note (201) with a SERVER-generated no + company_id force-set", async () => {
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: createDb(inserted) })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 214, reason: "ปรับปรุงยอด" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.no).toMatch(new RegExp(`^${N.noPrefix}-\\d{4}-0001$`)); // server-gen, first of the year
      expect(body.amount).toBe(214);
      expect(body.vendor_id).toBe(VENDOR);
      expect(body.ref_ap_id).toBe(APBILL);
      const ins = inserted.find((i) => i.table === N.noteTable);
      expect(ins).toBeTruthy();
      const note = ins!.values as Record<string, unknown>;
      expect(note.companyId).toBe(COMPANY); // force-set by the scoped insert
      expect(note.amount).toBe("214.00");
      expect(note.currencyCode).toBe("THB");
      expect(String(note.no)).toMatch(new RegExp(`^${N.noPrefix}-\\d{4}-0001$`));
    });

    it("server-gen no continues past the tenant's max suffix (+1)", async () => {
      const inserted: Inserted[] = [];
      const year = new Date().getFullYear();
      const existing = [
        N.seed("e1", { no: `${N.noPrefix}-${year}-0007` }),
        N.seed("e2", { no: `${N.noPrefix}-${year}-0003` }),
      ];
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: createDb(inserted, existing) })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().no).toBe(`${N.noPrefix}-${year}-0008`); // max 0007 + 1
    });

    it("400s a missing vendor_id (no insert)", async () => {
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: createDb(inserted) })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/vendor_id is required/);
      expect(inserted.find((i) => i.table === N.noteTable)).toBeFalsy();
    });

    it("400s a missing ref_ap_id", async () => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: createDb() })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, amount: 100 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/ref_ap_id is required/);
    });

    it("400s a ≤ 0 amount (no insert)", async () => {
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: createDb(inserted) })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 0 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/greater than zero/);
      expect(inserted.find((i) => i.table === N.noteTable)).toBeFalsy();
    });

    it("400s (fail closed) a vendor outside the tenant (no insert)", async () => {
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [vendors, []], // vendor absent → foreign
              [apBillings, [apBillingRow]],
              [users, [userRow]],
              [roles, [roleRow(true)]],
            ],
            inserted,
          }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/vendor not found/);
      expect(inserted.find((i) => i.table === N.noteTable)).toBeFalsy();
    });

    it("404s (fail closed) a ref ap_billing outside the tenant (no insert)", async () => {
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [vendors, [vendorRow]],
              [apBillings, []], // billing absent → foreign
              [users, [userRow]],
              [roles, [roleRow(true)]],
            ],
            inserted,
          }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(inserted.find((i) => i.table === N.noteTable)).toBeFalsy();
    });

    it("records an AuditLog row on a successful create, silent on a 4xx guard", async () => {
      const fired: AuditRecord[] = [];
      const okRes = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: createDb(),
          auditSink: (r) => { fired.push(r); },
        })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { vendor_id: VENDOR, ref_ap_id: APBILL, amount: 100 },
      });
      expect(okRes.statusCode).toBe(201);
      expect(fired).toHaveLength(1);

      const silent: AuditRecord[] = [];
      const badRes = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: createDb(),
          auditSink: (r) => { silent.push(r); },
        })
      ).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}`,
        payload: { ref_ap_id: APBILL, amount: 100 }, // missing vendor_id → 400
      });
      expect(badRes.statusCode).toBe(400);
      expect(silent).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // POST /ap/{cn|dn}/{id}/approve — shared guards (403 / 404 / idempotency / race)
  // -------------------------------------------------------------------------
  describe(`POST /api/v1/ap/${N.base}/:id/approve — guards`, () => {
    const approveDb = (
      opts: {
        note?: unknown[];
        jv?: RowSource;
        coa?: unknown[];
        inserted?: Inserted[];
        approve?: boolean;
      } = {},
    ) =>
      stubDb({
        rows: [
          [N.noteTable, opts.note ?? [N.seed(N.seedId)]],
          [jvs, opts.jv ?? jvSource],
          [glAccounts, opts.coa ?? coaRows],
          [users, [userRow]],
          [roles, [roleRow(true, opts.approve ?? true)]],
        ],
        inserted: opts.inserted,
      });

    it("401s flat without a session", async () => {
      const res = await (await buildTestApp()).inject({
        method: "POST",
        url: `/api/v1/ap/${N.base}/${N.seedId}/approve`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("403s without the finance.approve perm (fail closed)", async () => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ approve: false }) })
      ).inject({ method: "POST", url: `/api/v1/ap/${N.base}/${N.seedId}/approve` });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/finance approve permission/);
    });

    it("404s a note outside the tenant", async () => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ note: [] }) })
      ).inject({ method: "POST", url: `/api/v1/ap/${N.base}/${N.seedId}/approve` });
      expect(res.statusCode).toBe(404);
    });

    it("409s (idempotent) when a JV already carries the note's source_doc", async () => {
      const prefix = N.base === "cn" ? "apcn" : "apdn";
      const inserted: Inserted[] = [];
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: approveDb({ jv: [{ id: "jv-prior", companyId: COMPANY, sourceDoc: `${prefix}:${N.seedId}` }], inserted }),
        })
      ).inject({ method: "POST", url: `/api/v1/ap/${N.base}/${N.seedId}/approve` });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toMatch(/already approved/);
      expect(inserted.find((i) => i.table === jvs)).toBeFalsy(); // no double post
    });

    it("409s a concurrent double-approve (23505 on the source_doc index → idempotent)", async () => {
      const base = approveDb({});
      const db = {
        ...(base as unknown as Record<string, unknown>),
        transaction: async () => {
          const e = new Error("duplicate key") as Error & { code: string };
          e.code = "23505";
          throw e;
        },
      } as unknown as typeof base;
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db })
      ).inject({ method: "POST", url: `/api/v1/ap/${N.base}/${N.seedId}/approve` });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toMatch(/already approved/);
    });

    it("409s honestly when the tenant COA lacks a required posting account", async () => {
      // Only 2010 present → the counter account (5020 CN / 5100 DN) is missing.
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: approveDb({ coa: [{ id: ACC_AP, companyId: COMPANY, code: "2010", name: "AP" }] }),
        })
      ).inject({ method: "POST", url: `/api/v1/ap/${N.base}/${N.seedId}/approve` });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toMatch(/missing a required posting account/);
    });
  });
}

// ===========================================================================
// Money direction — asserted explicitly per note (the only cn/dn difference)
// ===========================================================================
const approveDbFor = (
  noteTable: unknown,
  note: unknown[],
  inserted: Inserted[],
) =>
  stubDb({
    rows: [
      [noteTable, note],
      [jvs, jvSource],
      [glAccounts, coaRows],
      [users, [userRow]],
      [roles, [roleRow(true, true)]],
    ],
    inserted,
  });

describe("POST /api/v1/ap/cn/:id/approve — Model-A JV (Dr 2010 AP / Cr 5020 materials)", () => {
  it("posts a BALANCED 2-line no-VAT JV + source_doc apcn:<id> + ActionOk", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDbFor(apCreditNotes, [cnSeed(CN0, { amount: "1000.00" })], inserted),
      })
    ).inject({ method: "POST", url: `/api/v1/ap/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(CN0);
    expect(body.amount).toBe(1000);
    expect(body.jv_no).toBe(`JV-${new Date().getFullYear()}-0001`);

    const jvIns = inserted.find((i) => i.table === jvs);
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`apcn:${CN0}`);

    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(1000);
    expect(sumCr).toBe(1000); // BALANCED (C9)
    // Dr AP 2010 = amount (reduce payable), Cr materials 5020 = amount.
    expect(lines.find((l) => l.accountId === ACC_AP)!.dr).toBe("1000.00");
    expect(lines.find((l) => l.accountId === ACC_MATERIALS)!.cr).toBe("1000.00");
  });
});

describe("POST /api/v1/ap/dn/:id/approve — Model-A JV (Dr 5100 admin-expense / Cr 2010 AP)", () => {
  it("posts a BALANCED 2-line no-VAT JV + source_doc apdn:<id> + ActionOk", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDbFor(apDebitNotes, [dnSeed(DN0, { amount: "1000.00" })], inserted),
      })
    ).inject({ method: "POST", url: `/api/v1/ap/dn/${DN0}/approve` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(DN0);
    expect(body.amount).toBe(1000);

    const jvIns = inserted.find((i) => i.table === jvs);
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`apdn:${DN0}`);

    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(1000);
    expect(sumCr).toBe(1000); // BALANCED (C9)
    // Dr admin-expense 5100 = amount (add expense), Cr AP 2010 = amount (increase payable).
    expect(lines.find((l) => l.accountId === ACC_ADMIN)!.dr).toBe("1000.00");
    expect(lines.find((l) => l.accountId === ACC_AP)!.cr).toBe("1000.00");
  });
});
