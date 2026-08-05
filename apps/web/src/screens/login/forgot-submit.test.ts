/*
 * G3 unit tests for performForgot(). Pure logic, no DOM — a fake `forgot`
 * transport covers every outcome branch.
 *
 * The load-bearing test is "a request is actually sent": the defect these
 * replace was a submit that toasted "link sent" without ever calling the server.
 */
import { describe, expect, it, vi } from "vitest";
import { performForgot, type ForgotResponse } from "./forgot-submit";

/** The uniform 200 the endpoint gives for EVERY address (auth.ts FORGOT_ACCEPTED). */
const accepted = (): ForgotResponse => ({
  data: { ok: true },
  response: { status: 200 },
});

describe("performForgot", () => {
  it("SENDS the request — a submit is never a local no-op", async () => {
    const forgot = vi.fn(async () => accepted());
    const out = await performForgot({ email: "a@b.co", forgot });
    expect(forgot).toHaveBeenCalledTimes(1);
    expect(forgot).toHaveBeenCalledWith({ email: "a@b.co" });
    expect(out).toEqual({ status: "accepted", email: "a@b.co" });
  });

  it("trims the address before sending and echoes the trimmed form", async () => {
    const forgot = vi.fn(async () => accepted());
    const out = await performForgot({ email: "  a@b.co  ", forgot });
    expect(forgot).toHaveBeenCalledWith({ email: "a@b.co" });
    expect(out).toEqual({ status: "accepted", email: "a@b.co" });
  });

  it("returns 'invalid' for a blank address and sends nothing", async () => {
    const forgot = vi.fn();
    const out = await performForgot({ email: "   ", forgot });
    expect(out).toEqual({ status: "invalid" });
    expect(forgot).not.toHaveBeenCalled();
  });

  it("gives the SAME 'accepted' outcome for a known and an unknown address", async () => {
    // The server cannot tell them apart on the wire (uniform 200), so neither
    // can this function — the anti-enumeration property, asserted.
    const forgot = vi.fn(async () => accepted());
    const known = await performForgot({ email: "somchai@rungrueang.co.th", forgot });
    const unknown = await performForgot({ email: "nobody@nowhere.invalid", forgot });
    expect(known.status).toBe("accepted");
    expect(unknown.status).toBe("accepted");
  });

  it("returns 'throttled' on 429 (even though the body also parses as an error)", async () => {
    const forgot = vi.fn(
      async (): Promise<ForgotResponse> => ({
        error: { code: "RATE_LIMITED", message: "Too many reset requests" },
        response: { status: 429 },
      }),
    );
    const out = await performForgot({ email: "a@b.co", forgot });
    expect(out).toEqual({ status: "throttled" });
  });

  it("returns 'failed' when the client reports a non-429 error", async () => {
    const err = { code: "INTERNAL", message: "boom" };
    const forgot = vi.fn(
      async (): Promise<ForgotResponse> => ({ error: err, response: { status: 500 } }),
    );
    const out = await performForgot({ email: "a@b.co", forgot });
    expect(out).toEqual({ status: "failed", error: err });
  });

  it("returns 'failed' on an unexpected non-200 with no error body", async () => {
    const forgot = vi.fn(
      async (): Promise<ForgotResponse> => ({ response: { status: 503 } }),
    );
    const out = await performForgot({ email: "a@b.co", forgot });
    expect(out.status).toBe("failed");
  });

  it("returns 'failed' when the transport throws", async () => {
    const boom = new Error("network down");
    const forgot = vi.fn(async () => {
      throw boom;
    });
    const out = await performForgot({ email: "a@b.co", forgot });
    expect(out).toEqual({ status: "failed", error: boom });
  });
});
