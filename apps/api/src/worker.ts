// BullMQ worker entrypoint (STUB).
//
// Async jobs go through BullMQ (PLAN.md section 5):
//   export / e-Tax / notification / PM schedule generation.
// Exports are async jobs per docs/handoff/api-contract.md note 3:
//   POST /exports {type,params} -> GET /exports/:id (url when done).
//
// TODO(P0-BE-13): implement the queue processors:
//   - export:      async report export -> file URL when done
//   - etax:        e-Tax queue send (status superset per decision C4,
//                  PLAN.md Appendix C)
//   - notification: fan-out via @juneflow/notifications adapters
//                  (line / email / webpush - integrations zone, mock-first)
//   - pm-schedule: PM contract mode=visits -> server auto-gens schedule + WOs
//                  (docs/handoff/api-contract.md, PM section)

import { writeFile } from "node:fs/promises";
import { Worker } from "bullmq";

export const QUEUE_NAMES = [
  "export",
  "etax",
  "notification",
  "pm-schedule",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** The ioredis options this worker sets — a subset of BullMQ's ConnectionOptions. */
export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  /** Present (and empty) only for `rediss:` — ioredis reads presence as "use TLS". */
  tls?: { servername?: string };
}

/**
 * Resolve the Redis connection, preferring the URL every deployment already sets.
 *
 * REDIS_URL is what infra/docker-compose.yml and infra/docker-compose.prod.yml
 * supply (`redis://redis:6379`); REDIS_HOST/REDIS_PORT are set nowhere as the
 * WORKER's env (the name REDIS_PORT does exist here — it is the compose host-port
 * mapping and some verify scripts export it, which is why a bare `pnpm dev:worker`
 * on such a shell could still pick it up). Reading only the latter pointed every deployed worker at its own
 * container's localhost — a permanent `connect ECONNREFUSED 127.0.0.1:6379`
 * retry loop that no flow noticed because nothing constructs a Queue yet.
 *
 * - REDIS_URL set   → parsed (host, port, ACL user, password, db index, and TLS
 *                     for the `rediss:` scheme).
 * - REDIS_URL unset → REDIS_HOST/REDIS_PORT, then localhost:6379, so anything
 *                     configured the old way keeps working.
 * - REDIS_URL unusable → throw (fail fast at boot, like resolveAuthSecret in
 *                     auth.ts). Falling back to localhost here is how the bug
 *                     above stayed invisible: a misconfigured deployment must
 *                     die with a message, not retry a wrong host forever.
 */
export function resolveRedisConnection(): RedisConnection {
  const raw = process.env.REDIS_URL;
  if (!raw) {
    return {
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `REDIS_URL is not a valid URL (${raw}). Expected redis://host:port or ` +
        "rediss://host:port — provision it via env (infra/.env or host env).",
    );
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(
      `REDIS_URL has unsupported scheme "${url.protocol}". Expected redis: or rediss:.`,
    );
  }

  const connection: RedisConnection = {
    // URL.hostname keeps the brackets on an IPv6 literal; ioredis wants them off.
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 6379),
  };
  // Credentials arrive percent-encoded in a URL; ioredis wants the raw values.
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, "");
  if (db) connection.db = Number(db);
  if (url.protocol === "rediss:") connection.tls = {};
  return connection;
}

const connection = resolveRedisConnection();

const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        // TODO(P0-BE-13): route to the real processor per queue name.
        throw new Error(
          `NOT_IMPLEMENTED: processor for queue "${name}" job ${job.id} (P0-BE-13)`,
        );
      },
      { connection },
    ),
);

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message);
  });
}

// Liveness heartbeat for the compose healthcheck. The runtime image bakes an
// HTTP /health probe (apps/api/Dockerfile) for the api; the worker runs that
// same image with a different CMD and serves no HTTP, so it inherited a probe it
// can never answer and sat `Up (unhealthy)` forever — which made `docker compose
// up --wait` (waits for HEALTHY, not running) exit 1 on a correct deploy.
// The file is refreshed ONLY while every queue's Redis connection reports
// "ready", so a worker wedged in a connect-retry loop still goes unhealthy —
// the signal that surfaced the REDIS_URL bug above, and the one `disable: true`
// would have thrown away.
const HEARTBEAT_PATH =
  process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/juneflow-worker.alive";
const HEARTBEAT_INTERVAL_MS = 5_000;

let beatInFlight = false;
const heartbeat = setInterval(() => {
  if (beatInFlight) return;
  beatInFlight = true;
  void Promise.all(workers.map((worker) => worker.client))
    .then(async (clients) => {
      if (clients.every((client) => client.status === "ready")) {
        await writeFile(HEARTBEAT_PATH, `${Date.now()}\n`);
      }
    })
    // A connection still initialising, or an unwritable path, just leaves the
    // file stale — exactly what the probe should report.
    .catch(() => undefined)
    .finally(() => {
      beatInFlight = false;
    });
}, HEARTBEAT_INTERVAL_MS);
// Never hold the process open on the timer alone (and keeps test runs clean).
heartbeat.unref();

const shutdown = async (): Promise<void> => {
  clearInterval(heartbeat);
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Juneflow worker up - queues: ${QUEUE_NAMES.join(", ")}`);
