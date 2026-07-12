// G3 unit tests (PLAN.md §9) — feature flags: hide unfinished modules so dev
// stays green/demoable (P0-BE-14). Covers default/override resolution, env
// parsing, the enabled snapshot, and that the guard 404s a disabled module.
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  DEFAULT_FEATURE_FLAGS,
  FeatureFlags,
  parseFlagValue,
  readFlagOverrides,
  registerFeatureFlags,
  requireFeature,
} from "./feature-flags.js";

describe("parseFlagValue", () => {
  it("reads truthy tokens (case/space-insensitive)", () => {
    for (const t of ["1", "true", "on", "YES", " enabled "]) {
      expect(parseFlagValue(t)).toBe(true);
    }
  });
  it("reads falsy tokens", () => {
    for (const t of ["0", "false", "OFF", "no", "disabled"]) {
      expect(parseFlagValue(t)).toBe(false);
    }
  });
  it("returns null for undefined/blank/garbage (keep the default)", () => {
    expect(parseFlagValue(undefined)).toBeNull();
    expect(parseFlagValue("")).toBeNull();
    expect(parseFlagValue("maybe")).toBeNull();
  });
});

describe("readFlagOverrides", () => {
  it("ignores unrelated env vars", () => {
    expect(readFlagOverrides({ PATH: "/bin", PORT: "3000" })).toEqual({});
  });
  it("parses a single FEATURE_<FLAG> var", () => {
    expect(readFlagOverrides({ FEATURE_AI_QTO: "on" })).toEqual({ ai_qto: true });
  });
  it("parses the bulk FEATURE_FLAGS list", () => {
    expect(readFlagOverrides({ FEATURE_FLAGS: "ai_qto=on, subcon=off" })).toEqual({
      ai_qto: true,
      subcon: false,
    });
  });
  it("lets a per-flag var win over the bulk list", () => {
    expect(
      readFlagOverrides({ FEATURE_FLAGS: "ai_qto=off", FEATURE_AI_QTO: "on" }),
    ).toEqual({ ai_qto: true });
  });
  it("skips malformed bulk entries and unknown tokens", () => {
    expect(
      readFlagOverrides({ FEATURE_FLAGS: "noeq, ai_qto=on, subcon=maybe" }),
    ).toEqual({ ai_qto: true });
  });
});

describe("FeatureFlags resolution", () => {
  it("treats an unregistered flag as enabled (unknown module = always on)", () => {
    const f = new FeatureFlags({ defaults: {}, env: {} });
    expect(f.isEnabled("anything")).toBe(true);
  });

  it("honors a registered default (unfinished module hidden)", () => {
    const f = new FeatureFlags({ defaults: { ai_qto: false }, env: {} });
    expect(f.isEnabled("ai_qto")).toBe(false);
  });

  it("lets env reveal a hidden module without a code change", () => {
    const f = new FeatureFlags({
      defaults: { ai_qto: false },
      env: { FEATURE_AI_QTO: "on" },
    });
    expect(f.isEnabled("ai_qto")).toBe(true);
  });

  it("ships ai_qto hidden by default (PLAN.md §12 deferred)", () => {
    expect(DEFAULT_FEATURE_FLAGS.ai_qto).toBe(false);
    const f = new FeatureFlags({ env: {} });
    expect(f.isEnabled("ai_qto")).toBe(false);
  });

  it("enabledFlags() lists only live known flags, sorted", () => {
    const f = new FeatureFlags({
      defaults: { ai_qto: false, reports: true },
      env: { FEATURE_BILLING: "on" },
    });
    expect(f.enabledFlags()).toEqual(["billing", "reports"]);
  });

  it("snapshot() exposes every known flag with its resolved state", () => {
    const f = new FeatureFlags({
      defaults: { ai_qto: false, reports: true },
      env: { FEATURE_AI_QTO: "on" },
    });
    expect(f.snapshot()).toEqual({ ai_qto: true, reports: true });
  });
});

describe("registerFeatureFlags + requireFeature guard", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  const build = async (features: FeatureFlags): Promise<FastifyInstance> => {
    app = Fastify();
    await registerFeatureFlags(app, features);
    app.get("/qto", { preHandler: requireFeature("ai_qto") }, async () => ({
      ok: true,
    }));
    await app.ready();
    return app;
  };

  it("GET /feature-flags returns the enabled set", async () => {
    await build(new FeatureFlags({ defaults: { ai_qto: false, reports: true }, env: {} }));
    const res = await app.inject({ method: "GET", url: "/feature-flags" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: ["reports"] });
  });

  it("404s a disabled module (hidden == does not exist)", async () => {
    await build(new FeatureFlags({ defaults: { ai_qto: false }, env: {} }));
    const res = await app.inject({ method: "GET", url: "/qto" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });

  it("passes through when the module is enabled", async () => {
    await build(new FeatureFlags({ defaults: { ai_qto: false }, env: { FEATURE_AI_QTO: "on" } }));
    const res = await app.inject({ method: "GET", url: "/qto" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("exposes features on the app and every request", async () => {
    app = Fastify();
    await registerFeatureFlags(app, new FeatureFlags({ defaults: { ai_qto: false }, env: {} }));
    app.get("/probe", async (req) => ({
      appFlag: req.server.features.isEnabled("ai_qto"),
      reqFlag: req.features.isEnabled("unknown"),
    }));
    await app.ready();
    expect(app.features.isEnabled("ai_qto")).toBe(false);
    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.json()).toEqual({ appFlag: false, reqFlag: true });
  });
});
