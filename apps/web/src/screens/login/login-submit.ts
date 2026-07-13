/*
 * Pure login-submit logic for the Login screen (P1-WEB-01), extracted so it is
 * unit-testable without a DOM (mirrors auth-token.ts / i18n lang-store.ts — G3).
 *
 * Behaviour ported from pototype/extra-screens.jsx ScreenLogin.login(): empty
 * email/password => validation error; otherwise POST /auth/login through the
 * generated client and, on a token, persist it (setAuthToken) so api-client.ts's
 * bearer middleware picks it up. The prototype's mock always succeeds; the
 * transport-error branch is production-only (see login-screen.tsx for how the
 * outcome maps to UI — auth-failure copy is not yet specified, kept silent).
 */

/** Result of the generated openapi-fetch POST (subset used here). */
export interface LoginResponse {
  data?: { token?: string } | undefined;
  error?: unknown;
}

export interface PerformLoginInput {
  email: string;
  password: string;
  /** Bound generated client call: apiClient.POST("/auth/login", { body }). */
  login: (body: { email: string; password: string }) => Promise<LoginResponse>;
  /** Persist the bearer JWT on success (setAuthToken). */
  setToken: (token: string) => void;
}

export type LoginOutcome =
  | { status: "invalid" }
  | { status: "ok"; token: string }
  | { status: "error"; error: unknown };

export async function performLogin({
  email,
  password,
  login,
  setToken,
}: PerformLoginInput): Promise<LoginOutcome> {
  const e = email.trim();
  const p = password.trim();
  if (!e || !p) return { status: "invalid" };

  let res: LoginResponse;
  try {
    res = await login({ email: e, password: p });
  } catch (error) {
    return { status: "error", error };
  }

  if (res.error !== undefined && res.error !== null) {
    return { status: "error", error: res.error };
  }
  const token = res.data?.token;
  if (!token) {
    return { status: "error", error: new Error("login response missing token") };
  }
  setToken(token);
  return { status: "ok", token };
}
