// B-369 — the SEAT-QUOTA PREFLIGHT. Read-only. Run it BEFORE the users quota
// check reaches production.
//
// WHY THIS EXISTS. `quota.check(companyId, "users")` on POST /users refuses an
// invite from a tenant that is already at its seat cap — against real tenants that
// may ALREADY sit over a cap nothing was enforcing. The failure mode is specific
// and bad: a tenant on `starter` (limits.users = 5) with 6 members is refused their
// next invite for a seat they already occupy.
//
// CORRECTION (B-363). This file used to say the check "CANNOT fail in dev or in
// CI" because `SubscriptionQuotaResolver` is production-only. THAT PREMISE IS FALSE
// FOR THE STACK THE GATES RUN ON: infra/docker-compose.yml sets
// `NODE_ENV=production` on the api service, so apps/api index.ts selects the REAL
// resolver on every compose run — a gate run fired a real 402 in that stack. So the
// answer this script gives is not a production-only concern: a seeded or fixture
// tenant near its cap breaks G4/G5 locally too. Run it wherever the real resolver
// runs.
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
//     implementer's call (filed on B-370) — so this reports the breakdown instead
//     of quietly choosing.
//   · a subscription with NO resolvable package is fail-closed by the resolver
//     (limit 0 → every invite 402), so it is reported as BLOCKED here too.
//
// THE REMEDY DEPENDS ON THE VERDICT, and B-363 split them because the single line
// this script used to print was wrong for most of the rows it flagged. On the
// seeded stack it flags 4 companies; 3 of them are `DENY (no package)` and have NO
// `subscription` ROW AT ALL, so "raise `seats` via PUT /admin/subscribers/{id}"
// cannot apply to them — {id} is a SUBSCRIPTION id (admin.ts:464 resolves it
// directly, 404 otherwise), and there is no POST that creates one. Their remedy is
// operational, not an API call:
//   · OVER CAP, package resolvable  → raise `seats` via
//     PUT /admin/subscribers/{id}/package (admin.ts validates -1 or >= 1).
//   · DENY (no package)             → the tenant has no subscription row; it must
//     be created (seed/ops/SQL — there is no create endpoint) or the tenant is
//     genuinely unbilled and every invite SHOULD be refused.
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
  --
  -- B-363: (created_at, id) is the tie-break, and it is load-bearing rather than
  -- tidy. The resolver used to fall back to subs[0] over an UNORDERED select, so
  -- for a company with 2+ subscriptions this script and the meter could name
  -- DIFFERENT rows — and then a preflight that says "ok" would be answering about a
  -- subscription the meter never reads. subscription-quota.ts #limit now sorts by
  -- exactly this key. Latent on today's data (no company has two subscriptions —
  -- checked), which is precisely why it had to be pinned before one does.
  LEFT JOIN LATERAL (
      SELECT * FROM subscription sub
       WHERE sub.company_id = c.id
       ORDER BY (sub.status IN ('active','trial')) DESC, sub.created_at, sub.id
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
  let noPackage = 0;
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
      if (limit == null) noPackage += 1; // no subscription/package → no PUT remedy
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
    // B-363: the remedy is per-verdict. The old single line ("raise `seats` via
    // PUT …") does not apply to a company with NO subscription row — {id} there is
    // a SUBSCRIPTION id and no endpoint creates one.
    const overCap = blocked - noPackage;
    if (overCap > 0) {
      console.log(
        `${overCap} at/over a resolvable cap: raise \`seats\` via ` +
          "PUT /admin/subscribers/{id}/package ({id} = the SUBSCRIPTION id).",
      );
    }
    if (noPackage > 0) {
      console.log(
        `${noPackage} with NO resolvable subscription/package: the PUT above does ` +
          "NOT apply\n(there is no subscriber row to address, and no endpoint " +
          "creates one). Either\ncreate the subscription out of band, or accept " +
          "that these tenants are unbilled\nand every invite is correctly refused.",
      );
    }
  } finally {
    await pg.end();
  }
  process.exit(blocked > 0 ? 1 : 0);
}

void main();
