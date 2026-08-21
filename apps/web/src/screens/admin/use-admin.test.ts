/*
 * use-admin request-shape tests (gate G3) — the admin.subs reset-password wire.
 *
 * WHY THIS FILE EXISTS: the reset-password control was ENABLED and fired a "reset link sent
 * to {email}" toast while calling nothing at all. A screen that lies about a write is not
 * caught by a row-narrowing test, a typecheck, or check:routes — every one of those was
 * green while the button was a no-op. So the assertion has to be on the CALL: which path,
 * which params, and — because this op is bodiless in the contract — that no body is sent.
 *
 * apiClient is mocked at the module boundary, so nothing here reaches the network; the
 * request functions are exported as plain functions precisely so this can be asserted in
 * the node/no-DOM vitest env (no React tree, no jsdom).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const POST = vi.fn();
const GET = vi.fn();
const PUT = vi.fn();

vi.mock("../../api-client", () => ({
  apiClient: {
    POST: (...args: unknown[]) => POST(...args),
    GET: (...args: unknown[]) => GET(...args),
    PUT: (...args: unknown[]) => PUT(...args),
  },
  API_BASE_URL: "/api/v1",
}));

const { resetUserPasswordRequest, remindInvoiceRequest } = await import("./use-admin");

beforeEach(() => {
  POST.mockReset();
  GET.mockReset();
  PUT.mockReset();
});

describe("resetUserPasswordRequest (B-282 wire)", () => {
  it("POSTs the reset-password path with the user id in the PATH", async () => {
    POST.mockResolvedValue({ data: { id: "u1", name: "Somchai" } });

    await resetUserPasswordRequest("u1");

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]![0]).toBe("/admin/users/{id}/reset-password");
    expect(POST.mock.calls[0]![1]).toEqual({ params: { path: { id: "u1" } } });
  });

  it("sends NOTHING beyond the path param — no body, no query", async () => {
    POST.mockResolvedValue({ data: {} });

    await resetUserPasswordRequest("u1");

    const opts = POST.mock.calls[0]![1] as Record<string, unknown>;
    // The contract types this op `requestBody?: never`. A body here would be silently
    // dropped by the handler and would mean the client had invented a field.
    expect(Object.keys(opts)).toEqual(["params"]);
    expect("body" in opts).toBe(false);
    expect(Object.keys(opts.params as Record<string, unknown>)).toEqual(["path"]);
  });

  it("touches no other verb (it is not a read, and it invalidates nothing)", async () => {
    POST.mockResolvedValue({ data: {} });

    await resetUserPasswordRequest("u1");

    expect(GET).not.toHaveBeenCalled();
    expect(PUT).not.toHaveBeenCalled();
  });

  it("REJECTS on a server error so the success toast cannot fire", async () => {
    // openapi-fetch never throws; unwrap() turns `{ error }` into a rejection. Without
    // this the 403 (non-owner) and 404 (user has no credential row) would both land on
    // the happy path and the owner would be told an email went out.
    POST.mockResolvedValue({ error: { code: "NOT_FOUND", message: "user u9 has no credential to reset" } });

    await expect(resetUserPasswordRequest("u9")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("remindInvoiceRequest (the dunning wire)", () => {
  it("POSTs the remind path with the INVOICE id in the PATH", async () => {
    POST.mockResolvedValue({ data: { ok: true } });

    await remindInvoiceRequest("inv-7");

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]![0]).toBe("/admin/invoices/{id}/remind");
    expect(POST.mock.calls[0]![1]).toEqual({ params: { path: { id: "inv-7" } } });
  });

  it("sends NOTHING beyond the path param — no body, no query", async () => {
    POST.mockResolvedValue({ data: {} });

    await remindInvoiceRequest("inv-7");

    // The contract declares no requestBody for remindAdminInvoice. money = SERVER:
    // the notice echoes the STORED invoice, so a client-sent amount would be a
    // number this screen invented about somebody's bill.
    const opts = POST.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(opts)).toEqual(["params"]);
    expect("body" in opts).toBe(false);
  });

  it("writes nothing else — no GET refetch, no PUT", async () => {
    POST.mockResolvedValue({ data: {} });

    await remindInvoiceRequest("inv-7");

    // The handler changes no field any admin read renders (no row, no GL/JV —
    // B-188), so an invalidation here would be a refetch that proves nothing.
    expect(GET).not.toHaveBeenCalled();
    expect(PUT).not.toHaveBeenCalled();
  });

  it("REJECTS on a server error so the success toast cannot fire", async () => {
    // The toast claims the reminder was recorded. A 403 (non-owner) or 404
    // (unknown invoice) landing on the happy path would make that claim false,
    // which is the whole defect this round closes: the button used to fire the
    // toast unconditionally and call nothing at all.
    POST.mockResolvedValue({ error: { code: "FORBIDDEN", message: "requires platform admin" } });

    await expect(remindInvoiceRequest("inv-7")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
