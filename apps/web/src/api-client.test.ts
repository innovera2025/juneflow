/*
 * API base-URL resolution (B-410, gate G3). Pure helper only (no network).
 *
 * These cases exist because the app once shipped an image whose bundle carried
 * no "/api/v1" at all: apps/web/Dockerfile declared `ARG VITE_API_BASE_URL` and
 * then `ENV VITE_API_BASE_URL=${...}`, Docker substituted the empty string for
 * the unpassed arg, `ENV` DEFINED it, and `raw ?? "/api/v1"` passed "" straight
 * through. Requests went to the origin root, nginx's SPA fallback answered
 * index.html with 200, and every screen rendered its shell with no data and no
 * error. The empty and whitespace cases below are the ones that fail if the
 * resolver is ever reverted to `??`.
 */
import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl, DEFAULT_API_BASE_URL } from "./api-client";

describe("resolveApiBaseUrl", () => {
  it("falls back to the contract's servers url when the override is absent", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("/api/v1");
    expect(DEFAULT_API_BASE_URL).toBe("/api/v1");
  });

  it('treats a DEFINED-but-empty override as absent (Docker `ENV X=${unpassed ARG}`)', () => {
    expect(resolveApiBaseUrl("")).toBe("/api/v1");
  });

  it("treats a whitespace-only override as absent", () => {
    expect(resolveApiBaseUrl("   ")).toBe("/api/v1");
    expect(resolveApiBaseUrl("\n\t")).toBe("/api/v1");
  });

  it("honours a real override and trims incidental whitespace", () => {
    expect(resolveApiBaseUrl("https://api.example.test/api/v1")).toBe("https://api.example.test/api/v1");
    expect(resolveApiBaseUrl("  /custom/base  ")).toBe("/custom/base");
  });

  it("never returns an empty base, whatever it is handed", () => {
    for (const raw of [undefined, "", " ", "\t\n", "  \r "]) {
      expect(resolveApiBaseUrl(raw)).not.toBe("");
    }
  });
});
