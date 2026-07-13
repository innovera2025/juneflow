// G3 unit tests (PLAN.md §9) — P1-BE-04 (B-043(ค)): the seeded package.menus
// allow-lists must be the NAV TOP-LEVEL IDS of docs/extract/PACKAGE-RULES.md
// §2 (pkgPresetIds) VERBATIM — not module keys — because they drive
// pkgMenuAllowed on the web shell (g1/01 reference = package M). GET /me
// serves the list opaque (menus reach the client untouched).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PACKAGES } from "@juneflow/db/seed/packages";
import {
  aiUsage,
  packages,
  roles,
  subscriptions,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

// --- PACKAGE-RULES.md §2 — transcribed here INDEPENDENTLY of the seed -------
// (cumulative S ⊂ M ⊂ L; Full = every menu → seeded as "*")
const RULES_S = ["dashboard", "boq", "proc", "petty", "timeline", "reports"];
const RULES_M = [
  ...RULES_S,
  "land", "subcon", "accept", "inv", "pm", "gl", "ap",
  "ar", "bank", "tax", "fa", "alloc", "dms", "master",
];
const RULES_L = [
  ...RULES_M,
  "sales", "labor", "opex", "exec", "mobile", "line",
  "users", "audit", "settings",
];

const seeded = (key: string) => PACKAGES.find((p) => p.key === key);

describe("seed package.menus = PACKAGE-RULES §2 NAV id allow-lists (B-043(ค))", () => {
  it("S menus == the §2 list verbatim (6 เมนู)", () => {
    expect([...(seeded("S")?.menus ?? [])]).toEqual(RULES_S);
  });

  it("M menus == the §2 list verbatim (20 เมนู)", () => {
    expect([...(seeded("M")?.menus ?? [])]).toEqual(RULES_M);
  });

  it("L menus == the §2 list verbatim (29 เมนู)", () => {
    expect([...(seeded("L")?.menus ?? [])]).toEqual(RULES_L);
  });

  it('Full menus == ["*"] (ทุกเมนู)', () => {
    expect([...(seeded("Full")?.menus ?? [])]).toEqual(["*"]);
  });

  it("M includes accept and EXCLUDES exec/sales/labor/opex (g1/01 reference)", () => {
    const m = seeded("M")?.menus ?? [];
    expect(m).toContain("accept");
    for (const id of ["exec", "sales", "labor", "opex"]) {
      expect(m).not.toContain(id);
    }
  });

  it("lists are cumulative: S ⊂ M ⊂ L", () => {
    const s = new Set(seeded("S")?.menus);
    const m = new Set(seeded("M")?.menus);
    const l = new Set(seeded("L")?.menus);
    for (const id of s) expect(m.has(id)).toBe(true);
    for (const id of m) expect(l.has(id)).toBe(true);
    expect(s.size).toBe(6);
    expect(m.size).toBe(20);
    expect(l.size).toBe(29);
  });
});

// --- GET /me serves the seeded menus opaque ---------------------------------
const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

function stubDb(rows: Array<[unknown, unknown[]]>): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: () => Promise.resolve(rowsFor(table)),
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => Promise.resolve(rowsFor(table)).then(onOk, onErr),
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({
        resolver: unlimitedQuotaResolver,
        upgradeUrl: "https://upgrade.test",
      }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

describe("GET /me carries the seeded M allow-list verbatim (opaque)", () => {
  it("package.menus == PACKAGE-RULES §2 M list (T-1001 = package M)", async () => {
    const seedM = seeded("M");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [
            users,
            [{ id: "u-0", companyId: COMPANY, email: SESSION.user.email, name: SESSION.user.name, roleId: null, status: "active" }],
          ],
          [roles, []],
          [subscriptions, [{ id: "s-0", companyId: COMPANY, packageId: "pkg-m", status: "active" }]],
          [
            packages,
            [{ id: "pkg-m", size: "M", name: "Professional", limits: seedM?.limits, menus: [...(seedM?.menus ?? [])], subRules: seedM?.subRules }],
          ],
          [aiUsage, []],
        ]),
      })
    ).inject({ url: "/api/v1/me" });

    expect(res.statusCode).toBe(200);
    expect(res.json().package.menus).toEqual(RULES_M);
  });
});
