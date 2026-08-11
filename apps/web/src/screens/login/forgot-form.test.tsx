/*
 * ForgotForm SCREEN-SEAM tests (gate G3) — the submit as the COMPONENT wires it,
 * not the pure outcome mapping (that is forgot-submit.test.ts).
 *
 * WHY THIS FILE EXISTS: forgot-submit.test.ts stays green even if the component
 * never calls performForgot and goes back to the prototype's local-only
 * `ctx.notify` — which is precisely the defect being fixed. These tests take the
 * onClick the component actually hands its primary button, invoke it, and assert
 * what crossed the seam: a request was sent, and nothing was said to the user
 * before the server answered. Put the mock submit back and they go red.
 *
 * Harness: the repo's vitest env is `node` (no jsdom, no event dispatch), so the
 * component renders DOM-free with renderToStaticMarkup and ui/button is vi.mock'd
 * to CAPTURE its props — the same mocking style as screens/subcon/
 * subcon-accept.test.tsx, which documents why an untestable onClick is left
 * uncovered rather than faked. Translators echo their key, so this .tsx stays
 * ASCII-only and the assertions read keys + interpolated values.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgotResponse } from "./forgot-submit";

/** Captured Btn props, newest render last. */
interface CapturedBtn {
  kind?: string;
  disabled?: boolean;
  /** The real handler; `send` is async, which Btn's own prop type widens to void. */
  onClick?: () => unknown;
}

const h = vi.hoisted(() => ({ btns: [] as CapturedBtn[] }));

/** login.forgotSent carries {email}; every other key echoes itself. */
const TPL: Record<string, string> = {
  "login.forgotSent": "sent to {email}",
};

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => TPL[k] ?? k,
    tn: (k: string) => k,
    tp: (k: string) => k,
  }),
}));

vi.mock("../../ui/button", () => ({
  Btn: (props: CapturedBtn & { children?: ReactNode }) => {
    h.btns.push({ kind: props.kind, disabled: props.disabled, onClick: props.onClick });
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));

import { ForgotForm } from "./forgot-form";

/** The uniform 200 the endpoint gives for EVERY address (auth.ts FORGOT_ACCEPTED). */
const accepted = (): ForgotResponse => ({ data: { ok: true }, response: { status: 200 } });

interface Harness {
  forgot: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onNotify: ReturnType<typeof vi.fn>;
  /** onClick of the primary (submit) button, as the component wired it. */
  submit: () => Promise<void>;
  /** disabled prop of the primary button at render time. */
  submitDisabled: boolean | undefined;
}

/** Render ForgotForm and hand back its captured submit seam. */
function mount(
  initial: string,
  transport: (body: { email: string }) => Promise<ForgotResponse>,
): Harness {
  h.btns = [];
  const forgot = vi.fn(transport);
  const onClose = vi.fn();
  const onNotify = vi.fn();
  renderToStaticMarkup(
    <ForgotForm initial={initial} onClose={onClose} onNotify={onNotify} forgot={forgot} />,
  );
  const primary = h.btns.find((b) => b.kind === "primary");
  if (!primary?.onClick) throw new Error("primary submit button not rendered");
  const submit = primary.onClick;
  return {
    forgot,
    onClose,
    onNotify,
    submit: async () => {
      await submit();
    },
    submitDisabled: primary.disabled,
  };
}

beforeEach(() => {
  h.btns = [];
});

describe("ForgotForm submit seam", () => {
  it("SENDS POST /auth/forgot — the submit is not a local-only notify", async () => {
    const f = mount("somchai@rungrueang.co.th", async () => accepted());
    await f.submit();
    expect(f.forgot).toHaveBeenCalledTimes(1);
    expect(f.forgot).toHaveBeenCalledWith({ email: "somchai@rungrueang.co.th" });
  });

  it("says NOTHING until the server has answered", async () => {
    // The reverted mechanic closes + toasts synchronously, before any request
    // could have been answered. This is the assertion that pins the defect.
    let release: (r: ForgotResponse) => void = () => {};
    const pending = new Promise<ForgotResponse>((resolve) => {
      release = resolve;
    });
    const f = mount("a@b.co", () => pending);

    const done = f.submit();
    expect(f.onNotify).not.toHaveBeenCalled();
    expect(f.onClose).not.toHaveBeenCalled();

    release(accepted());
    await done;
    expect(f.onClose).toHaveBeenCalledTimes(1);
    expect(f.onNotify).toHaveBeenCalledWith("sent to a@b.co");
  });

  it("closes and toasts login.forgotSent once the request is ACCEPTED", async () => {
    const f = mount("  a@b.co  ", async () => accepted());
    await f.submit();
    expect(f.forgot).toHaveBeenCalledWith({ email: "a@b.co" });
    expect(f.onClose).toHaveBeenCalledTimes(1);
    expect(f.onNotify).toHaveBeenCalledWith("sent to a@b.co");
  });

  it("shows the SAME thing for an address that exists and one that does not", async () => {
    // The server answers one uniform 200 either way (auth.ts:296-299); the UI
    // must not manufacture a difference it was never told about.
    const known = mount("somchai@rungrueang.co.th", async () => accepted());
    await known.submit();
    const unknown = mount("nobody@nowhere.invalid", async () => accepted());
    await unknown.submit();

    expect(known.onNotify.mock.calls[0]?.[1]).toBeUndefined();
    expect(unknown.onNotify.mock.calls[0]?.[1]).toBeUndefined();
    expect(known.onClose).toHaveBeenCalledTimes(1);
    expect(unknown.onClose).toHaveBeenCalledTimes(1);
  });

  it("on 429 keeps the modal OPEN and reports failure — never 'link sent'", async () => {
    const f = mount("a@b.co", async () => ({
      error: { code: "RATE_LIMITED", message: "Too many reset requests" },
      response: { status: 429 },
    }));
    await f.submit();
    expect(f.onClose).not.toHaveBeenCalled();
    expect(f.onNotify).toHaveBeenCalledWith("admin.common.actionFailedToast", "danger");
  });

  it("on a transport failure reports failure — never 'link sent'", async () => {
    const f = mount("a@b.co", async () => {
      throw new Error("network down");
    });
    await f.submit();
    expect(f.onClose).not.toHaveBeenCalled();
    expect(f.onNotify).toHaveBeenCalledWith("admin.common.actionFailedToast", "danger");
    expect(f.onNotify).not.toHaveBeenCalledWith("sent to a@b.co");
  });

  it("gives a 429 and a transport failure the SAME message (no rate-limit key: B-300)", async () => {
    const throttled = mount("a@b.co", async () => ({ response: { status: 429 } }));
    await throttled.submit();
    const broken = mount("a@b.co", async () => {
      throw new Error("network down");
    });
    await broken.submit();
    expect(throttled.onNotify.mock.calls[0]).toEqual(broken.onNotify.mock.calls[0]);
  });

  it("a double click costs ONE of the address's 5 requests per minute", async () => {
    const f = mount("a@b.co", async () => accepted());
    await Promise.all([f.submit(), f.submit()]);
    expect(f.forgot).toHaveBeenCalledTimes(1);
  });

  it("disables the submit while the address is blank, and sends nothing if invoked", async () => {
    const f = mount("   ", async () => accepted());
    expect(f.submitDisabled).toBe(true);
    await f.submit();
    expect(f.forgot).not.toHaveBeenCalled();
    expect(f.onNotify).not.toHaveBeenCalled();
    expect(f.onClose).not.toHaveBeenCalled();
  });

  it("leaves the submit enabled when the address is present", () => {
    const f = mount("a@b.co", async () => accepted());
    expect(f.submitDisabled).toBe(false);
  });
});
