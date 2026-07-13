/*
 * G3 unit tests for performLogin() (P1-WEB-01). Pure logic, no DOM — a fake
 * `login` transport + a spy `setToken` cover every outcome branch.
 */
import { describe, expect, it, vi } from "vitest";
import { performLogin, type LoginResponse } from "./login-submit";

const ok = (token: string): LoginResponse => ({ data: { token } });

describe("performLogin", () => {
  it("returns 'invalid' when email is blank (no request sent)", async () => {
    const login = vi.fn();
    const setToken = vi.fn();
    const out = await performLogin({ email: "  ", password: "secret", login, setToken });
    expect(out).toEqual({ status: "invalid" });
    expect(login).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("returns 'invalid' when password is blank (no request sent)", async () => {
    const login = vi.fn();
    const setToken = vi.fn();
    const out = await performLogin({ email: "a@b.co", password: "", login, setToken });
    expect(out).toEqual({ status: "invalid" });
    expect(login).not.toHaveBeenCalled();
  });

  it("persists the token and returns 'ok' on success", async () => {
    const login = vi.fn(async () => ok("jwt-123"));
    const setToken = vi.fn();
    const out = await performLogin({
      email: "  a@b.co  ",
      password: "  pw  ",
      login,
      setToken,
    });
    expect(login).toHaveBeenCalledWith({ email: "a@b.co", password: "pw" });
    expect(setToken).toHaveBeenCalledWith("jwt-123");
    expect(out).toEqual({ status: "ok", token: "jwt-123" });
  });

  it("returns 'error' when the client reports an error (401)", async () => {
    const err = { code: "UNAUTHORIZED", message: "bad creds" };
    const login = vi.fn(async (): Promise<LoginResponse> => ({ error: err }));
    const setToken = vi.fn();
    const out = await performLogin({ email: "a@b.co", password: "pw", login, setToken });
    expect(out).toEqual({ status: "error", error: err });
    expect(setToken).not.toHaveBeenCalled();
  });

  it("returns 'error' when the response has no token", async () => {
    const login = vi.fn(async (): Promise<LoginResponse> => ({ data: {} }));
    const setToken = vi.fn();
    const out = await performLogin({ email: "a@b.co", password: "pw", login, setToken });
    expect(out.status).toBe("error");
    expect(setToken).not.toHaveBeenCalled();
  });

  it("returns 'error' when the transport throws", async () => {
    const boom = new Error("network down");
    const login = vi.fn(async () => {
      throw boom;
    });
    const setToken = vi.fn();
    const out = await performLogin({ email: "a@b.co", password: "pw", login, setToken });
    expect(out).toEqual({ status: "error", error: boom });
  });
});
