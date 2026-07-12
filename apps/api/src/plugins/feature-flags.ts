// Feature-flag mechanism (P0-BE-14).
//
// Purpose (Bootstrap Manifest กลุ่ม 5 Phase-0 requirement, PLAN.md §7):
//   Hide modules that are not finished yet so `dev` stays green and the stack is
//   always demoable. A flag names a build-rollout capability (e.g. the deferred
//   AI QTO engine, PLAN.md §12) — NOT a per-tenant/product entitlement and NOT
//   the pototype project-type module gating (that is C7/C8, owned by the web zone
//   via routeModule; docs/extract/PROJECT-TYPES.md). Keep the two separate.
//
// Model (mirrors project-types `moduleOn`: "unknown module = always on"):
//   - A flag NOT in the registry is treated as ENABLED — finished code is the
//     default, so shipping a route needs no flag bookkeeping.
//   - A flag in the registry defaults to whatever it is declared as. Unfinished
//     modules are registered `false` (hidden) until their zone completes them.
//   - The environment can override any flag (config, never hardcoded), so a
//     reviewer/demo env can reveal an in-progress module without a code change.
//
// Hiding == "does not exist": `requireFeature(flag)` answers 404 (not 403) when a
// module is disabled, so a hidden module is indistinguishable from an unbuilt one.
//
// G3: src/plugins/feature-flags.test.ts proves default/override resolution, env
// parsing, the enabled-set snapshot, and that the guard 404s a disabled module.
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

/** Declared build flags → default state. Absent flag ⇒ enabled (see header). */
export type FeatureFlagDefaults = Readonly<Record<string, boolean>>;

/**
 * Phase-0 default registry. Only capabilities that are genuinely not built yet
 * belong here, each anchored to a spec decision — do not invent product modules.
 *   - ai_qto: real AI QTO engine is Deferred (PLAN.md §12); the UI runs a fake
 *     result first, so the live engine stays hidden until Wei starts it.
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagDefaults = {
  ai_qto: false,
};

/** Env var prefix for a single flag override, e.g. FEATURE_AI_QTO=on. */
const ENV_PREFIX = "FEATURE_";
/** Bulk override, e.g. FEATURE_FLAGS="ai_qto=on,subcon=off". */
const ENV_BULK = "FEATURE_FLAGS";

const TRUE_TOKENS = new Set(["1", "true", "on", "yes", "enabled"]);
const FALSE_TOKENS = new Set(["0", "false", "off", "no", "disabled"]);

/**
 * Parse an override token into a boolean. Unknown/blank tokens return null so the
 * caller keeps the default rather than silently guessing an intent.
 */
export function parseFlagValue(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const token = raw.trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  return null;
}

/** `FEATURE_AI_QTO` → `ai_qto`. */
function envKeyToFlag(envKey: string): string {
  return envKey.slice(ENV_PREFIX.length).toLowerCase();
}

/**
 * Collect flag overrides from an env bag. Precedence: a dedicated `FEATURE_<FLAG>`
 * var wins over an entry in the bulk `FEATURE_FLAGS` list, which wins over the
 * defaults. Only well-formed tokens count; malformed ones are ignored.
 */
export function readFlagOverrides(
  env: Record<string, string | undefined>,
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};

  // Bulk list first (lowest env precedence).
  const bulk = env[ENV_BULK];
  if (bulk) {
    for (const pair of bulk.split(",")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const flag = pair.slice(0, eq).trim().toLowerCase();
      const value = parseFlagValue(pair.slice(eq + 1));
      if (flag && value !== null) overrides[flag] = value;
    }
  }

  // Per-flag vars override the bulk list.
  for (const [envKey, raw] of Object.entries(env)) {
    if (envKey === ENV_BULK || !envKey.startsWith(ENV_PREFIX)) continue;
    const value = parseFlagValue(raw);
    if (value === null) continue;
    overrides[envKeyToFlag(envKey)] = value;
  }

  return overrides;
}

export interface FeatureFlagsOptions {
  /** Declared flags → default state. Defaults to DEFAULT_FEATURE_FLAGS. */
  defaults?: FeatureFlagDefaults;
  /** Env-style override bag. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Immutable resolved flag set: defaults merged with env overrides once at boot.
 * Unknown flags resolve to enabled (finished code is the default).
 */
export class FeatureFlags {
  readonly #state: Map<string, boolean>;

  constructor(options: FeatureFlagsOptions = {}) {
    const defaults = options.defaults ?? DEFAULT_FEATURE_FLAGS;
    const env = options.env ?? process.env;
    this.#state = new Map(Object.entries(defaults));
    for (const [flag, value] of Object.entries(readFlagOverrides(env))) {
      this.#state.set(flag, value);
    }
  }

  /** Is a module visible? Unknown flag ⇒ enabled (see header). */
  isEnabled(flag: string): boolean {
    return this.#state.get(flag) ?? true;
  }

  /** Known (registered or overridden) flags that are currently enabled. */
  enabledFlags(): string[] {
    return [...this.#state.entries()]
      .filter(([, on]) => on)
      .map(([flag]) => flag)
      .sort();
  }

  /** Every known flag with its resolved state (snapshot for the shell / debug). */
  snapshot(): Record<string, boolean> {
    return Object.fromEntries([...this.#state.entries()].sort());
  }
}

declare module "fastify" {
  interface FastifyInstance {
    features: FeatureFlags;
  }
  interface FastifyRequest {
    features: FeatureFlags;
  }
}

/**
 * Register the resolved flag set on the app + every request, and expose a
 * read-only `GET /feature-flags` (public — the shell reads it to hide unfinished
 * menus before auth). Returns { enabled } so a client only sees what is live.
 */
export async function registerFeatureFlags(
  app: FastifyInstance,
  features: FeatureFlags,
): Promise<void> {
  app.decorate("features", features);
  app.decorateRequest("features", { getter: () => features });

  app.get("/feature-flags", async () => ({ enabled: features.enabledFlags() }));
}

/**
 * preHandler guard: 404 when `flag` is disabled, so a hidden module reads as
 * non-existent. Mount on any route whose module may still be unfinished.
 */
export function requireFeature(flag: string): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.features.isEnabled(flag)) return;
    await reply.code(404).send({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
    return reply; // stop the chain; the handler never runs for a hidden module.
  };
}
