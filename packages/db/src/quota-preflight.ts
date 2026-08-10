// B-349 — the SEAT-QUOTA PREFLIGHT. Read-only. Run it BEFORE the users quota
// check reaches production.
//
// WHY THIS EXISTS. `SubscriptionQuotaResolver` is production-only (apps/api
// index.ts gates it; non-prod keeps the unlimited resolver), so the new
// `quota.check(companyId, "users")` on POST /users CANNOT fail in dev or in CI.
// It fails first in production — against real tenants that may ALREADY sit over a
// cap nothing was enforcing. The failure mode is specific and bad: a tenant on
// `starter` (limits.users = 5) with 6 members is refused their next invite for a
// seat they already occupy.
//
// This script answers, per company, the question the meter will ask:
//
//     limit(users) = subscription.seats ?? package.limits->>'users'    (-1 = ∞)
//     used(users)  = count(*) FROM "user" WHERE company_id = …
//     BLOCKED when limit >= 0 AND used >= limit
//
// It reads NOTHING but those three facts, writes nothing, and deliberately
// mirrors the resolver's own precedence (apps/api/src/plugins/subscription-quota.ts
// #limit / #used) rather than re-deciding it — including the two things that make
// the count larger than an operator expects:
//   · every user row counts, INCLUDING `blocked` and `invited`. Whether a blocked
//     ex-employee should consume a paid seat is a billing definition, not an
//     implementer's call (filed on B-350) — so this reports the breakdown instead
//     of quietly choosing.
//   · a subscription with NO resolvable package is fail-closed by the resolver
//     (limit 0 → every invite 402), so it is reported as BLOCKED here too.
//
// THE FIX for anything this flags is not a code change: raise that subscriber's
// `seats` through the existing PUT /admin/subscribers/{id}/package (admin.ts
// already validates and persists it).
//
// Usage:  DATABASE_URL=postgres://… pnpm --filter @juneflow/db quota:preflight
// Exit code: 0 when nothing is blocked, 1 when at least one tenant would be.
import { Client } from "pg";

interface Row {
  company_id: string;
  company: string | null;
  package_code: string | null;
  seats: number | null;
  package_users: number | null;
  users_total: number;
  users_active: number;
  users_invited: number;
  users_blocked: number;
}

const SQL = `
SELECT c.id                                        AS company_id,
       c.name                                      AS company,
       p.name                                      AS package_code,
       s.seats                                     AS seats,
       (p.limits ->> 'users')::int                 AS package_users,
       count(u.id)                                 AS users_total,
       count(u.id) FILTER (WHERE u.status = 'active')  AS users_active,
       count(u.id) FILTER (WHERE u.status = 'invited') AS users_invited,
       count(u.id) FILTER (WHERE u.status = 'blocked') AS users_blocked
  FROM company c
  -- The resolver picks an active/trial subscription first, else any; mirror that
  -- ordering so this reports the SAME subscription the meter will read.
  LEFT JOIN LATERAL (
      SELECT * FROM subscription sub
       WHERE sub.company_id = c.id
       ORDER BY (sub.status IN ('active','trial')) DESC, sub.created_at
       LIMIT 1
  ) s ON true
  LEFT JOIN package p ON p.id = s.package_id
  LEFT JOIN "user" u ON u.company_id = c.id
 GROUP BY c.id, c.name, p.name, s.seats, p.limits
 ORDER BY c.name NULLS LAST, c.id
`;

/** The limit the resolver will apply, or null when it will fail closed (deny). */
function effectiveLimit(r: Row): number | null {
  if (r.package_code == null) return null; // no resolvable subscription/package
  if (r.seats != null) return r.seats; // the users-only seat override
  return r.package_users;
}

function label(limit: number | null): string {
  if (limit == null) return "DENY (no package)";
  if (limit === -1) return "unlimited";
  return String(limit);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required (read-only connection).");
    process.exit(2);
  }
  const pg = new Client({ connectionString });
  await pg.connect();
  let blocked = 0;
  try {
    const { rows } = await pg.query<Row>(SQL);
    console.log(
      [
        "company".padEnd(34),
        "pkg".padEnd(12),
        "limit".padEnd(18),
        "used".padEnd(6),
        "(active/invited/blocked)".padEnd(26),
        "verdict",
      ].join(" "),
    );
    for (const raw of rows) {
      const r = {
        ...raw,
        users_total: Number(raw.users_total),
        users_active: Number(raw.users_active),
        users_invited: Number(raw.users_invited),
        users_blocked: Number(raw.users_blocked),
      };
      const limit = effectiveLimit(r);
      const over = limit == null || (limit >= 0 && r.users_total >= limit);
      if (over) blocked += 1;
      console.log(
        [
          (r.company ?? r.company_id).slice(0, 33).padEnd(34),
          (r.package_code ?? "—").padEnd(12),
          `${label(limit)}${r.seats != null ? " (seats)" : ""}`.padEnd(18),
          String(r.users_total).padEnd(6),
          `${r.users_active}/${r.users_invited}/${r.users_blocked}`.padEnd(26),
          over ? "*** NEXT INVITE WOULD 402 ***" : "ok",
        ].join(" "),
      );
    }
    console.log(
      `\n${rows.length} companies · ${blocked} would be refused their next invite.`,
    );
    if (blocked > 0) {
      console.log(
        "Raise `seats` for each via PUT /admin/subscribers/{id}/package before the\n" +
          "users quota check is enabled in production.",
      );
    }
  } finally {
    await pg.end();
  }
  process.exit(blocked > 0 ? 1 : 0);
}

void main();
