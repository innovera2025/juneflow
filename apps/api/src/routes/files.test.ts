// G3 unit tests (PLAN.md §9) — POST /files presigned skeleton: returns the
// contract FileUploaded on success, 402 QuotaExceededError when storage is over
// quota (contract /files, PLAN.md §5).
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { QuotaGuard, type QuotaResolver } from "../plugins/quota.js";
import {
  registerFilesRoute,
  createFakeR2Storage,
  type FileStorage,
} from "./files.js";

const COMPANY = "44444444-4444-4444-4444-444444444444";
const UPGRADE = "https://app.juneflow.local/settings/subscription";

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function quotaGuard(limit: number, used: number): QuotaGuard {
  const resolver: QuotaResolver = { async resolve() { return { limit, used }; } };
  return new QuotaGuard({ resolver, upgradeUrl: UPGRADE });
}

async function buildApp(opts: {
  quota: QuotaGuard;
  storage?: FileStorage;
}): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.tenant = { companyId: COMPANY };
  });
  await registerFilesRoute(app, {
    storage: opts.storage ?? createFakeR2Storage("https://r2.test"),
    quota: opts.quota,
  });
  await app.ready();
  return app;
}

describe("successful upload", () => {
  it("responds 201 with FileUploaded { file_id, link_module, url }", async () => {
    const app = await buildApp({ quota: quotaGuard(-1, 0) });
    const res = await app.inject({
      method: "POST",
      url: "/files?link_module=boq:123",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.file_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.link_module).toBe("boq:123");
    expect(body.url).toBe(`https://r2.test/${COMPANY}/${body.file_id}`);
  });

  it("passes company_id + link_module to the storage seam", async () => {
    const calls: unknown[] = [];
    const storage: FileStorage = {
      async presignUpload(input) {
        calls.push(input);
        return { fileId: "fixed-id", url: "https://r2.test/x", linkModule: input.linkModule };
      },
    };
    const app = await buildApp({ quota: quotaGuard(-1, 0), storage });
    await app.inject({ method: "POST", url: "/files?link_module=dms:1" });
    expect(calls[0]).toEqual({ companyId: COMPANY, linkModule: "dms:1" });
  });
});

describe("storage quota", () => {
  it("responds 402 QUOTA_EXCEEDED + upgrade_url when over the storage limit", async () => {
    const app = await buildApp({ quota: quotaGuard(5, 5) });
    const res = await app.inject({ method: "POST", url: "/files" });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for storage_gb",
      upgrade_url: UPGRADE,
    });
  });

  it("does not mint a handle when quota is exceeded", async () => {
    let minted = false;
    const storage: FileStorage = {
      async presignUpload() {
        minted = true;
        return { fileId: "x", url: "u" };
      },
    };
    const app = await buildApp({ quota: quotaGuard(1, 1), storage });
    await app.inject({ method: "POST", url: "/files" });
    expect(minted).toBe(false);
  });
});
