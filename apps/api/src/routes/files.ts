// POST /files — presigned upload skeleton (P0-BE-13).
//
// Contract (packages/contracts/openapi.yaml /files, api-contract.md note 2):
//   attachments upload here first, then the returned file_id is passed to the
//   owning endpoint; the file enters the DMS with its link_module. Storage quota
//   is enforced → 402 QuotaExceededError when over the storage_gb limit.
//
// Skeleton scope (PLAN.md §5: "POST /files presigned → R2, fake in dev"):
//   Real bytes go client→R2 via a presigned URL; this endpoint mints that
//   handle (file_id + url). Storage is behind a FileStorage seam so dev uses a
//   fake R2 (no network, no bucket) exactly like the integrations fake adapters,
//   and the G3 unit tests inject a spy. Writing the DMS `document` row is wired
//   when the resource/DMS layer lands — called out, not silently dropped.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { QuotaGuard, sendQuotaExceeded } from "../plugins/quota.js";

/** Result of minting an upload handle — shape feeds the contract FileUploaded. */
export interface UploadHandle {
  fileId: string;
  url: string;
  linkModule?: string;
}

/** Storage seam: mint a presigned upload handle for the tenant. */
export interface FileStorage {
  presignUpload(input: {
    companyId: string;
    linkModule?: string;
    filename?: string;
  }): Promise<UploadHandle>;
}

/**
 * Fake R2 storage for dev/tests: mints a deterministic-looking object key + URL
 * without touching the network. NOT production storage — the real R2 presigner
 * replaces this via the same interface (mock-first, PLAN.md §4).
 */
export function createFakeR2Storage(
  baseUrl = process.env.R2_PUBLIC_BASE_URL ?? "https://r2.fake.local",
): FileStorage {
  return {
    async presignUpload({ companyId, linkModule }) {
      const fileId = randomUUID();
      return {
        fileId,
        url: `${baseUrl}/${companyId}/${fileId}`,
        linkModule,
      };
    },
  };
}

/** link_module arrives as a multipart field in prod; accept query/body in the
 *  skeleton so the endpoint is exercisable without a multipart parser. */
function readLinkModule(request: FastifyRequest): string | undefined {
  const q = request.query as Record<string, unknown> | undefined;
  const b = request.body as Record<string, unknown> | undefined;
  const value = q?.link_module ?? b?.link_module;
  return typeof value === "string" ? value : undefined;
}

export interface FilesRouteOptions {
  storage: FileStorage;
  quota: QuotaGuard;
}

/** Register POST /files on the given instance. */
export async function registerFilesRoute(
  app: FastifyInstance,
  options: FilesRouteOptions,
): Promise<void> {
  app.post("/files", async (request, reply) => {
    const companyId = request.tenant?.companyId;
    if (!companyId) {
      // tenant-scope should already have rejected; fail closed regardless.
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHENTICATED", message: "Missing tenant context" } });
    }

    // Storage quota gates the upload (contract: POST /files → 402 QuotaExceeded).
    const status = await options.quota.check(companyId, "storage_gb");
    if (!status.ok) {
      return sendQuotaExceeded(reply, "storage_gb", options.quota.upgradeUrl);
    }

    const linkModule = readLinkModule(request);
    const handle = await options.storage.presignUpload({ companyId, linkModule });

    // FileUploaded (contract): file_id required; link_module + url optional.
    return reply.code(201).send({
      file_id: handle.fileId,
      link_module: handle.linkModule,
      url: handle.url,
    });
  });
}
