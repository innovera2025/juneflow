// G3 unit tests (PLAN.md §9) — the worker's Redis connection resolution.
//
// WHY THIS FILE EXISTS. A live preflight (`docker compose up -d --build --wait`)
// brought 5 of 6 services up Healthy and left `worker` permanently
// `Up (unhealthy)`, logging `connect ECONNREFUSED 127.0.0.1:6379` from the first
// second: worker.ts built its connection from REDIS_HOST/REDIS_PORT, and
// REDIS_HOST is set NOWHERE in this repo — every deployment supplies REDIS_URL.
// Nothing constructs a Queue yet, so no flow went red; the only symptom was the
// runbook's own deploy command exiting 1 on a correct deploy.
//
// HOW IT TESTS THE REAL THING. The subject is production
// `resolveRedisConnection` — no double stands in for it. `bullmq` IS faked, but
// only as the boundary: importing worker.ts otherwise opens four real sockets,
// and the fake's job is to RECORD what the production code hands the Worker
// constructor. That recording is the point of the last test: a resolver that is
// correct but unwired would pass every case above it and fail there.
//
// Revert check: restore `host: process.env.REDIS_HOST ?? "localhost"` and every
// REDIS_URL case below resolves to localhost:6379 instead — red.
//
// THE SECOND HALF: the liveness heartbeat. The same preflight also left `worker`
// unhealthy for a second, independent reason — it runs the api image, so it
// inherited an HTTP /health probe it can never answer while serving no HTTP.
// The fix is a heartbeat file the compose probe reads for staleness, refreshed
// ONLY while every queue's Redis connection is "ready" (an unconditional refresh
// is `healthcheck.disable: true` in disguise: it reports healthy while the worker
// is wedged in a connect-retry loop). The heartbeat tests below drive the real
// `setInterval` through fake timers and assert on the real file on disk.
//
// Revert check: delete the heartbeat block and the four "liveness heartbeat"
// tests go red; drop only the `status === "ready"` gating and the two "does not
// beat" tests go red.
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every `new Worker(...)` this module sees, in construction order. */
const { constructed, redis } = vi.hoisted(() => ({
  constructed: [] as { name: string; connection: unknown }[],
  /**
   * What `worker.client` yields, per read. Default: a promise that never settles
   * — bullmq's `client` resolves on `waitUntilReady`, so a worker retrying
   * `ECONNREFUSED` leaves it pending forever, and that is also what keeps the
   * heartbeat off the filesystem in the resolver tests above.
   */
  redis: {
    client: (_queue: string): Promise<{ status: string }> =>
      new Promise<never>(() => {}),
  },
}));

vi.mock("bullmq", () => ({
  Worker: class {
    readonly name: string;
    constructor(name: string, _processor: unknown, opts: { connection: unknown }) {
      this.name = name;
      constructed.push({ name, connection: opts.connection });
    }
    /** A getter, as in bullmq — the heartbeat re-reads it on every beat. */
    get client(): Promise<{ status: string }> {
      return redis.client(this.name);
    }
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

// Every fresh import of worker.ts registers its own SIGINT/SIGTERM shutdown
// handler, and this file imports it once per test — past Node's default cap of
// 10 that prints a spurious "EventEmitter memory leak" warning.
process.setMaxListeners(64);

const MANAGED_ENV_VARS = [
  "REDIS_URL",
  "REDIS_HOST",
  "REDIS_PORT",
  "WORKER_HEARTBEAT_PATH",
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of MANAGED_ENV_VARS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  constructed.length = 0;
  redis.client = () => new Promise<never>(() => {});
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

/** Import worker.ts fresh so module-level `resolveRedisConnection()` re-reads env. */
async function loadWorker() {
  vi.resetModules();
  return import("./worker.js");
}

describe("resolveRedisConnection", () => {
  it("uses REDIS_URL — the variable compose actually sets", async () => {
    process.env.REDIS_URL = "redis://redis:6379";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({ host: "redis", port: 6379 });
  });

  it("beats REDIS_HOST/REDIS_PORT when both are present", async () => {
    // The live failure in reverse: REDIS_URL is the deployed truth, so a stale
    // REDIS_HOST left on a host must not win.
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.REDIS_HOST = "localhost";
    process.env.REDIS_PORT = "6379";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({ host: "redis", port: 6379 });
  });

  it("carries a non-default port, password and db index off the URL", async () => {
    process.env.REDIS_URL = "redis://:s3cr3t@cache.internal:6390/2";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({
      host: "cache.internal",
      port: 6390,
      password: "s3cr3t",
      db: 2,
    });
  });

  it("turns on TLS for rediss: and percent-decodes credentials", async () => {
    process.env.REDIS_URL = "rediss://acl-user:p%40ss%3Aword@tls.example:6380";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({
      host: "tls.example",
      port: 6380,
      username: "acl-user",
      password: "p@ss:word",
      tls: {},
    });
  });

  it("defaults the port to 6379 when the URL omits it", async () => {
    process.env.REDIS_URL = "redis://redis";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({ host: "redis", port: 6379 });
  });

  it("falls back to REDIS_HOST/REDIS_PORT when REDIS_URL is unset", async () => {
    process.env.REDIS_HOST = "legacy-host";
    process.env.REDIS_PORT = "6399";
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({ host: "legacy-host", port: 6399 });
  });

  it("falls back to localhost:6379 when nothing is set", async () => {
    const { resolveRedisConnection } = await loadWorker();

    expect(resolveRedisConnection()).toEqual({ host: "localhost", port: 6379 });
  });

  // These two assert on the IMPORT, not on a later call: the resolver runs at
  // module scope, so an unusable REDIS_URL kills the worker at boot with a
  // message instead of retrying a wrong host forever (auth.ts resolveAuthSecret
  // precedent). Silently defaulting to localhost is how the original bug hid.
  it("fails the boot on an unusable REDIS_URL instead of using localhost", async () => {
    process.env.REDIS_URL = "not-a-url";

    await expect(loadWorker()).rejects.toThrow(/REDIS_URL is not a valid URL/);
    expect(constructed).toHaveLength(0);
  });

  it("fails the boot on a non-redis scheme", async () => {
    process.env.REDIS_URL = "http://redis:6379";

    await expect(loadWorker()).rejects.toThrow(/unsupported scheme/);
    expect(constructed).toHaveLength(0);
  });
});

describe("worker wiring", () => {
  it("hands the REDIS_URL-derived connection to every queue's Worker", async () => {
    process.env.REDIS_URL = "redis://cache.internal:6390/3";
    process.env.REDIS_HOST = "localhost";
    const { QUEUE_NAMES, resolveRedisConnection } = await loadWorker();

    // Guards the resolver being correct but unused — the shape of the original
    // bug, where the connection object came from somewhere else entirely.
    expect(constructed.map((w) => w.name)).toEqual([...QUEUE_NAMES]);
    expect(constructed).not.toHaveLength(0);
    for (const worker of constructed) {
      expect(worker.connection).toEqual(resolveRedisConnection());
      expect(worker.connection).toEqual({ host: "cache.internal", port: 6390, db: 3 });
    }
  });
});

describe("liveness heartbeat", () => {
  /** Must match HEARTBEAT_INTERVAL_MS in worker.ts. */
  const BEAT_MS = 5_000;
  /** Older than the 20s staleness threshold the compose probe applies. */
  const STALE_MS = 60_000;

  let dir: string;
  let beatPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "juneflow-worker-heartbeat-"));
    // Never a repo path: the subject writes for real, and the probe reads mtime.
    beatPath = join(dir, "worker.alive");
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.WORKER_HEARTBEAT_PATH = beatPath;
    // Only the interval is faked. Real setTimeout/promise scheduling must keep
    // working, or the beat's own async fs write could never land.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  /** mtime in ms, or null when the heartbeat file does not exist. */
  async function beatMtime(): Promise<number | null> {
    try {
      return (await stat(beatPath)).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Give the beat's promise chain and its real fs write time to land. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Wait for a beat newer than `since` (null = any beat at all). */
  async function waitForBeat(since: number | null): Promise<number> {
    for (let i = 0; i < 100; i += 1) {
      const mtime = await beatMtime();
      if (mtime !== null && (since === null || mtime > since)) return mtime;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no heartbeat written to ${beatPath} within 1s`);
  }

  /** Plant a heartbeat old enough that the compose probe would call it stale. */
  async function plantStaleBeat(): Promise<number> {
    await writeFile(beatPath, "0\n");
    const stale = new Date(Date.now() - STALE_MS);
    await utimes(beatPath, stale, stale);
    const mtime = await beatMtime();
    if (mtime === null) throw new Error("failed to plant a stale heartbeat");
    return mtime;
  }

  it("writes the heartbeat file once every connection is ready", async () => {
    redis.client = async () => ({ status: "ready" });
    const startedAt = Date.now();
    await loadWorker();

    // Nothing at boot — the file only exists because the interval ran.
    expect(await beatMtime()).toBeNull();

    vi.advanceTimersByTime(BEAT_MS);
    await waitForBeat(null);

    const stamp = Number((await readFile(beatPath, "utf8")).trim());
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThanOrEqual(startedAt);
  });

  it("refreshes a stale heartbeat file on each beat", async () => {
    // The probe reads mtime, so re-writing (not merely existing) is the signal.
    const stale = await plantStaleBeat();
    redis.client = async () => ({ status: "ready" });
    await loadWorker();

    vi.advanceTimersByTime(BEAT_MS);
    const first = await waitForBeat(stale);
    expect(first).toBeGreaterThan(stale);
    expect(Date.now() - first).toBeLessThan(STALE_MS);

    vi.advanceTimersByTime(BEAT_MS);
    expect(await waitForBeat(first)).toBeGreaterThan(first);
  });

  it("does not beat while a connection stays pending (the ECONNREFUSED loop)", async () => {
    // The live failure: bullmq's `client` never resolves while ioredis retries,
    // so a worker that can never reach Redis must never look healthy.
    redis.client = () => new Promise<never>(() => {});
    await loadWorker();

    vi.advanceTimersByTime(BEAT_MS * 3);
    await settle();

    expect(await beatMtime()).toBeNull();
  });

  it("does not beat while a connection is connected but not yet ready", async () => {
    const stale = await plantStaleBeat();
    redis.client = async () => ({ status: "connecting" });
    await loadWorker();

    vi.advanceTimersByTime(BEAT_MS * 3);
    await settle();

    // Untouched: the probe still sees a stale file and reports unhealthy.
    expect(await beatMtime()).toBe(stale);
  });

  it("does not beat while only one queue's connection is not ready", async () => {
    const stale = await plantStaleBeat();
    redis.client = async (queue) => ({
      status: queue === "pm-schedule" ? "reconnecting" : "ready",
    });
    await loadWorker();

    vi.advanceTimersByTime(BEAT_MS * 3);
    await settle();

    expect(await beatMtime()).toBe(stale);
  });

  it("resumes beating once the connection becomes ready", async () => {
    // ioredis flips `status` in place on the client bullmq handed back.
    const client = { status: "connecting" };
    redis.client = async () => client;
    await loadWorker();

    vi.advanceTimersByTime(BEAT_MS);
    await settle();
    expect(await beatMtime()).toBeNull();

    client.status = "ready";
    vi.advanceTimersByTime(BEAT_MS);

    expect(await waitForBeat(null)).toBeGreaterThan(0);
  });
});
