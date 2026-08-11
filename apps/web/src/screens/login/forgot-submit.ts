/*
 * Pure "request a password-reset link" logic for the Login screen's ForgotForm,
 * extracted so it is unit-testable without a DOM (mirrors the sibling
 * login-submit.ts — G3).
 *
 * WHY THIS FILE EXISTS (mock mechanic removed — PLAN.md §0 rule 3): the
 * prototype's ForgotForm (pototype/extra-screens.jsx:210-222) submits with
 * `ctx.notify(...)` and nothing else — it closes the modal and tells the user a
 * link was sent WITHOUT any request ever leaving the browser. The port copied
 * that mechanic verbatim, so the screen satisfied rule 1 (design) by breaking
 * rule 3 (no mock mechanics). The submit now POSTs /auth/forgot through the
 * generated client; the design above it is untouched.
 *
 * The endpoint's REAL behaviour (apps/api/src/routes/auth.ts:300-372) shapes
 * every outcome modelled here:
 *
 *   1. It answers ONE uniform 200 for a known address, an unknown one, a
 *      malformed one, a failed token write and a failed delivery — deliberately,
 *      so it can never be used as an account-enumeration oracle. There is
 *      therefore NO "found / not found" outcome to model, and no caller may try
 *      to infer one: doing so would re-open the hole the backend closed.
 *   2. It is throttled BEFORE any lookup (5 per email+IP, 30 per IP, 60s fixed
 *      window; auth.ts:111-112,315-322) and returns 429. Both throttle keys are
 *      values the REQUESTER supplies about themselves, so a 429 is exactly as
 *      reachable for an address that exists as for one that does not — modelling
 *      it as its own outcome leaks nothing (auth.ts:312-314 says so explicitly).
 *   3. Delivery is still a no-op seam (B-282, a BACKEND gap): a 200 means "the
 *      server accepted the request", never "mail reached the inbox".
 *
 * The 200 body is the contract's opaque `Entity` (openapi.yaml EntityOk), so its
 * shape is deliberately NOT inspected here — asserting fields on an opaque
 * response would be inventing a model (apps/web/CLAUDE.md "API client").
 */

/** Result of the generated openapi-fetch POST (subset used here). */
export interface ForgotResponse {
  data?: unknown;
  error?: unknown;
  /** Raw fetch Response — the only place the 429 is visible (429 is undeclared). */
  response?: { status: number } | undefined;
}

export interface PerformForgotInput {
  /** Address as typed. Trimmed here; the SERVER canonicalises (canonicalEmail). */
  email: string;
  /** Bound generated client call: apiClient.POST("/auth/forgot", { body }). */
  forgot: (body: { email: string }) => Promise<ForgotResponse>;
}

export type ForgotOutcome =
  /** Nothing to send — no request was made (never reached via the UI: the
   *  submit button is disabled while the field is blank). */
  | { status: "invalid" }
  /** The server ACCEPTED the request. Says nothing about whether the address
   *  has an account, and nothing about delivery (B-282). */
  | { status: "accepted"; email: string }
  /** 429 — too many reset requests for this email+IP or this IP in the window. */
  | { status: "throttled" }
  /** Transport failure or any other non-200. */
  | { status: "failed"; error: unknown };

/** HTTP status of the shared auth throttle (auth.ts rateLimited). */
export const RATE_LIMITED_STATUS = 429;

export async function performForgot({
  email,
  forgot,
}: PerformForgotInput): Promise<ForgotOutcome> {
  const e = email.trim();
  if (!e) return { status: "invalid" };

  let res: ForgotResponse;
  try {
    res = await forgot({ email: e });
  } catch (error) {
    return { status: "failed", error };
  }

  const status = res.response?.status;
  // Checked BEFORE res.error: a 429 also carries a parsed error body, and the
  // throttle is the one failure the user can actually act on (wait, retry).
  if (status === RATE_LIMITED_STATUS) return { status: "throttled" };
  if (res.error !== undefined && res.error !== null) {
    return { status: "failed", error: res.error };
  }
  if (typeof status === "number" && status !== 200) {
    return { status: "failed", error: new Error(`forgot responded ${status}`) };
  }
  return { status: "accepted", email: e };
}
