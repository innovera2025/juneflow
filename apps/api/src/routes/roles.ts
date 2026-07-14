// GET + POST /roles + PUT /roles/{id} — the tenant's permission/approval roles
// (P1-BE-09, B-051; master.jsx UsersPermissions/RoleAddForm L895-1116,
// SACRED-EDITS-QUEUE §4b/§4c).
//
// Contract (openapi.yaml /roles, /roles/{id}): GET → the B-014 list envelope of
// opaque Entity rows; POST → 201 EntityCreated; PUT → 200 EntityOk (the
// Permission-Matrix "บันทึก" save). Field semantics are locked by B-051 (schema
// `role`, platform.ts — the superset). The wire row is
//   {id, name, approval_limit, currency_code, approval_level, approval_limits,
//    perms, user_count}
// where
//   approval_limit  = the single blanket approval ceiling in REAL baht (Number)
//                     or null (unlimited / no ceiling) — NEVER the mock's
//                     "1,000,000 ฿" / "ไม่จำกัด" display strings.
//   approval_level  = the approval tier 0..4 (0 = no approval rights).
//   approval_limits = the dictionary per-doc-type ceiling map (jsonb), returned
//                     verbatim (empty {} when the role has no per-type overrides).
//   perms           = the 11-module × 5-permission matrix as number[][] in the
//                     MODULE_IDS × PERM order (master.jsx ROLE_PRESETS.perms
//                     shape), re-projected from the stored module→flags map so
//                     the FE renders it exactly like the mock.
//   user_count      = DERIVED (C10): users whose role_id is this role — NEVER a
//                     stored/hardcoded count (the mock's `c`).
//
// `role` + `user` both carry their OWN company_id column (platform.ts), so they
// are read/written through the scoped TenantDb.select()/insert()/update() door
// (auto-injects / force-sets WHERE|SET company_id = <this tenant>) — a bare read
// is impossible, so another tenant's roles/users can never leak. Without a
// resolved tenant, request.db is absent and the handler answers 401.
//
// filter/page query params are accepted per the contract but not interpreted.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { roles, users, type RolePerms } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

/**
 * The 11 permission modules in matrix order (master.jsx MODULES_LBL:908 /
 * seed MODULE_IDS) and the 5 rights per module (master.jsx PERMS:907). These
 * fix the row/column order for projecting the stored module→flags map back to
 * the mock's number[][] matrix and vice-versa.
 */
const MODULE_IDS = [
  "dashboard",
  "boq",
  "pr",
  "po",
  "wo",
  "gr",
  "subcon",
  "inventory",
  "petty",
  "finance",
  "master",
] as const;
const PERM_KEYS = ["view", "create", "edit", "approve", "cancel"] as const;

type RoleRow = typeof roles.$inferSelect;

/** Stored module→flags map → the mock's 11×5 number[][] matrix (GET/response). */
function matrixFromPerms(perms: RolePerms): number[][] {
  return MODULE_IDS.map((moduleId) => {
    const flags = perms[moduleId];
    return PERM_KEYS.map((right) => (flags?.[right] ? 1 : 0));
  });
}

/**
 * Request perms → the stored module→flags map. Accepts the mock's number[][]
 * matrix (RoleAddForm `perms` state) OR an already-shaped module→flags object;
 * anything else yields an empty matrix (all rights off).
 */
function permsFromInput(input: unknown): RolePerms {
  const out: RolePerms = {};
  if (Array.isArray(input)) {
    MODULE_IDS.forEach((moduleId, i) => {
      const row = input[i];
      const cells = Array.isArray(row) ? row : [];
      out[moduleId] = {
        view: !!cells[0],
        create: !!cells[1],
        edit: !!cells[2],
        approve: !!cells[3],
        cancel: !!cells[4],
      };
    });
    return out;
  }
  if (input && typeof input === "object") {
    const map = input as Record<string, Record<string, unknown>>;
    for (const moduleId of MODULE_IDS) {
      const flags = map[moduleId];
      out[moduleId] = {
        view: !!flags?.view,
        create: !!flags?.create,
        edit: !!flags?.edit,
        approve: !!flags?.approve,
        cancel: !!flags?.cancel,
      };
    }
    return out;
  }
  return {};
}

/** The opaque Entity wire shape for one role; user_count is a derived count. */
function toWire(r: RoleRow, userCount: number): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    approval_limit: r.approvalLimit == null ? null : Number(r.approvalLimit),
    currency_code: r.currencyCode,
    approval_level: r.approvalLevel,
    approval_limits: r.approvalLimits,
    perms: matrixFromPerms(r.perms),
    user_count: userCount,
  };
}

/** Parse a money amount (number | numeric string) from opaque JSON, else null. */
function toMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseFloat(value.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse the approval tier (integer 0..4) from opaque JSON; undefined if absent. */
function toLevel(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Validate + normalize the role create/update body. Returns an error message
 *  string on failure, else the normalized fields to write. */
function parseRoleBody(
  body: Record<string, unknown>,
): { error: string } | {
  name: string;
  approvalLimit: string | null;
  approvalLevel: number;
  perms: RolePerms;
} {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name is required" };

  const rawLimit = body.approval_limit ?? body.approvalLimit;
  const limit = toMoney(rawLimit);
  if (rawLimit != null && rawLimit !== "" && limit == null) {
    return { error: "approval_limit must be a number" };
  }

  const level = toLevel(body.approval_level ?? body.approvalLevel);
  if (level !== undefined && (Number.isNaN(level) || level < 0 || level > 4)) {
    return { error: "approval_level must be an integer 0..4" };
  }

  return {
    name,
    approvalLimit: limit == null ? null : limit.toFixed(2),
    approvalLevel: level ?? 0,
    perms: permsFromInput(body.perms),
  };
}

/** Register GET + POST /roles and PUT /roles/:id on the /api/v1 scope. */
export function registerRolesRoute(app: FastifyInstance): void {
  app.get("/roles", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // role + user → own company_id (scoped select). user_count is derived from
    // the real user rows of this tenant (C10), grouped by role_id.
    const [roleRows, userRows] = await Promise.all([
      db.select(roles),
      db.select(users),
    ]);
    const usersByRole = new Map<string, number>();
    for (const u of userRows) {
      if (!u.roleId) continue;
      usersByRole.set(u.roleId, (usersByRole.get(u.roleId) ?? 0) + 1);
    }

    return reply.code(200).send(
      listEnvelope(roleRows.map((r) => toWire(r, usersByRole.get(r.id) ?? 0))),
    );
  });

  app.post("/roles", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const parsed = parseRoleBody((request.body ?? {}) as Record<string, unknown>);
    if ("error" in parsed) {
      return reply.code(400).send({ code: "VALIDATION", message: parsed.error });
    }

    const [created] = await db
      .insert(roles, {
        name: parsed.name,
        approvalLimit: parsed.approvalLimit,
        approvalLevel: parsed.approvalLevel,
        perms: parsed.perms,
      })
      .returning();

    // A brand-new role has no members yet → user_count 0.
    return reply.code(201).send(toWire(created!, 0));
  });

  app.put("/roles/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const { id } = request.params as { id: string };
    const parsed = parseRoleBody((request.body ?? {}) as Record<string, unknown>);
    if ("error" in parsed) {
      return reply.code(400).send({ code: "VALIDATION", message: parsed.error });
    }

    // Scoped update — company_id is AND-ed into the WHERE, so a foreign tenant's
    // id never matches (→ 404), and company_id itself can never be reassigned.
    const [updated] = await db
      .update(
        roles,
        {
          name: parsed.name,
          approvalLimit: parsed.approvalLimit,
          approvalLevel: parsed.approvalLevel,
          perms: parsed.perms,
        },
        eq(roles.id, id),
      )
      .returning();

    if (!updated) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `role ${id} not found`,
      });
    }

    // Preserve the derived user_count on the response (real query, C10).
    const userRows = await db.select(users, eq(users.roleId, id));
    return reply.code(200).send(toWire(updated, userRows.length));
  });
}
