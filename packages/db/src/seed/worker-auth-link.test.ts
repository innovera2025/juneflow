/*
 * G3 unit tests for the worker→user auth link (B-438 = ก).
 *
 * WHAT THIS PROTECTS. worker.user_id is the column B-332 added to open the
 * SELF-SERVICE attendance door (labor.ts findWorkerByUserId). Before this change the
 * seed left it null on all eight rows, so the door could not open for anybody and the
 * mobile check-in screen showed its "no linked worker" state to every demo user —
 * measured on a live stack: 8 workers, 0 linked.
 *
 * Source-read rather than import, the stamp.test.ts precedent: seed/index.ts is a
 * script, and importing it to reach a private const would run it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SEED = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** Re-derive the mapping the seed computes, from the seed's own two source arrays. */
function derived(): { roleKeys: string[]; userCount: number; pairs: Array<[number, number]> } {
  const roleBlock = SEED.slice(
    SEED.indexOf("const ROLE_DEFS"),
    SEED.indexOf("// B-089 (F-PV1, migration 0026"),
  );
  const roleKeys = [...roleBlock.matchAll(/\{ key: "(\w+)", name:/g)].map((m) => m[1]!);

  const userBlock = SEED.slice(
    SEED.indexOf("const COMPANY_USERS = ["),
    SEED.indexOf("// project-types.jsx:6 PROJECT_TYPES"),
  );
  const userCount = [...userBlock.matchAll(/@rungrueang\.co\.th/g)].length;

  const siteRoleIdx = roleKeys.indexOf("site");
  const siteUsers = Array.from({ length: userCount }, (_, i) => i).filter(
    (i) => i % roleKeys.length === siteRoleIdx,
  );
  return {
    roleKeys,
    userCount,
    pairs: siteUsers.map((userIdx, workerIdx) => [workerIdx, userIdx] as [number, number]),
  };
}

describe("the seed's role table, as the link derives from it", () => {
  it("has exactly the eight prototype roles, with `site` among them", () => {
    // The derivation is `i % ROLE_DEFS.length === indexOf("site")`, so BOTH the length
    // and the position are load-bearing: a role added or reordered moves which users
    // are Site Engineers, and this test is where that shows up.
    const { roleKeys } = derived();
    expect(roleKeys).toEqual(["pm", "dir", "proc", "site", "acc", "sale", "wh", "exec"]);
  });

  it("seeds twelve company users", () => {
    expect(derived().userCount).toBe(12);
  });
});

describe("which workers carry an auth link", () => {
  it("links the first two roster rows to the two Site Engineer users", () => {
    // Site Engineer is ROLE_DEFS[3] and roles are assigned cyclically over 8 entries,
    // so users 3 and 11 hold it. Nothing here is a preference — change the role table
    // and the pairs change with it.
    expect(derived().pairs).toEqual([
      [0, 3],
      [1, 11],
    ]);
  });

  it("links TWO rows, not the whole roster", () => {
    // (ก) was chosen over (ข) to keep the roster at 8 rows so the labor.workers G5
    // baseline does not move; linking every labourer would also claim an app account
    // for people who have none.
    expect(derived().pairs).toHaveLength(2);
  });
});

describe("the seed actually applies it", () => {
  it("sets userId on the worker insert from the derived map", () => {
    expect(SEED).toContain("userId: SITE_ENGINEER_USER_IDXS[i] != null");
    expect(SEED).toContain("? det(`user:${SITE_ENGINEER_USER_IDXS[i]}`)");
  });

  it("leaves every unmapped row NULL rather than defaulting it", () => {
    // A fallback to some other user would silently give one person somebody else's
    // attendance door — the exact thing labor.ts's self-service check refuses.
    expect(SEED).toContain(": null,");
    expect(SEED).not.toContain("SITE_ENGINEER_USER_IDXS[i] ?? 0");
  });

  it("derives the site-role index instead of hardcoding 3", () => {
    expect(SEED).toContain('ROLE_DEFS.findIndex((r) => r.key === "site")');
    expect(SEED).not.toContain("const siteRoleIdx = 3");
  });
});
