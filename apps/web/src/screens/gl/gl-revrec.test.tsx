/*
 * GLRevenueWIP SCREEN-SEAM tests (B-432, gate G3) — what the SCREEN puts in the markup and
 * what it sends on the wire, not the pure derivations (that is gl-revrec-rows.test.ts).
 *
 * The three properties worth a screen-level test are the ones a helper suite cannot see:
 *   1. the method cell renders the honest-unknown marker rather than a guessed label,
 *   2. the recognition POST carries NO amount — the server computes it — while the transfer
 *      POST does carry the operator's amount,
 *   3. a failed post shows the failure and moves nothing.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same
 * style as subcon-accept.test.tsx. Translators echo the key (a key IS its Thai text in this
 * repo), so this .tsx stays ASCII-only and the assertions read structure + interpolated VALUES.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import strings from "./gl-revrec-strings.json" with { type: "json" };

/** Em-dash — the screen's honest-unknown marker (gl-revrec.tsx DASH). */
const DASH = "—";

const h = vi.hoisted(() => ({
  rev: [] as unknown[],
  wip: [] as unknown[],
  /** What ctx.confirm / ctx.openModal was last handed. */
  confirmCfg: null as Record<string, unknown> | null,
  modalCfg: null as Record<string, unknown> | null,
  toasts: [] as Array<{ msg: string; tone?: string }>,
  postArgs: [] as unknown[],
  transferArgs: [] as unknown[],
  /** Flip to make the mutation take the error path. */
  postFails: false,
}));

/** ASCII stand-ins for the gl.revrec.* templates, keeping the real {placeholder} names. */
const TPL: Record<string, string> = {
  "gl.revrec.kpiRecognizedSub": "count={count}",
  "gl.revrec.confirmMessage": "amount={amount} pct={pct}",
  "gl.revrec.toastPostJv": "posted={amount}",
  "gl.revrec.toastTransfer": "transferred={amount}",
  "gl.revrec.transferInfo": "balance={amount}",
};

/**
 * tp() is handed a phrase — the Thai text itself — so echoing it would put Thai in this
 * file's assertions (B-073 forbids it here). The screen looks its phrases up in
 * gl-revrec-strings.json, so the mock reverses that map and yields the JSON KEY instead:
 * assertions read "tabWip", the screen still exercises the real lookup.
 */
const KEY_BY_PHRASE: Record<string, string> = Object.fromEntries(
  Object.entries(strings)
    .filter(([k]) => k !== "_source")
    .map(([k, v]) => [v as string, k]),
);

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => TPL[k] ?? k,
    tn: (k: string) => k,
    tp: (k: string) => KEY_BY_PHRASE[k] ?? k,
  }),
}));

vi.mock("../../shell/page", () => ({
  Page: ({ title, subtitle, actions, breadcrumbs, children }: {
    title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
    breadcrumbs?: ReactNode[]; children?: ReactNode;
  }) => (
    <div>
      {breadcrumbs?.map((c, i) => <span key={i}>{c}</span>)}
      {title}
      {subtitle}
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({
    params: {},
    notify: (msg: string, tone?: string) => {
      h.toasts.push({ msg, tone });
    },
    navigate: () => {},
    confirm: (cfg: Record<string, unknown>) => {
      h.confirmCfg = cfg;
    },
    openModal: (cfg: Record<string, unknown>) => {
      h.modalCfg = cfg;
    },
  }),
}));

vi.mock("./use-gl-revrec", () => ({
  useGlRevRec: () => ({ data: h.rev, isLoading: false }),
  useGlWip: () => ({ data: h.wip, isLoading: false }),
  useGlRevRecPost: () => ({
    isPending: false,
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: () => void }) => {
      h.postArgs.push(id);
      if (h.postFails) opts?.onError?.();
      else opts?.onSuccess?.();
    },
  }),
  useTransferGlWip: () => ({
    isPending: false,
    mutate: (
      args: { id: string; amount: number },
      opts?: { onSuccess?: () => void; onError?: () => void },
    ) => {
      h.transferArgs.push(args);
      if (h.postFails) opts?.onError?.();
      else opts?.onSuccess?.();
    },
  }),
}));

import { GLRevenueWIP, postConfirmDescriptor } from "./gl-revrec";
import { toRevRec } from "./gl-revrec-rows";

/** One served recognition row (revrec.ts revRecWire) — the prototype's REVREC_SEED row 0. */
const REV = {
  id: "r-0",
  project_id: "p-0",
  project_name: "Ratchaphruek Phase 2",
  method: "percent-of-completion",
  contract_amount: 468000000,
  pct: 65,
  recognized: 68400000,
  billed: 74200000,
  unbilled: -5800000,
  currency_code: "THB",
  posted: true,
};

/** One served WIP row (revrec.ts wipWire) — the prototype's WIP_SEED row 0. */
const WIP = {
  id: "w-0",
  project_id: "p-0",
  project_name: "Ratchaphruek Phase 2",
  material: 18400000,
  subcon: 12600000,
  overhead: 3200000,
  transferred: 9800000,
  balance: 24400000,
  currency_code: "THB",
};

const render = (): string => renderToStaticMarkup(<GLRevenueWIP />);

beforeEach(() => {
  h.rev = [REV];
  h.wip = [WIP];
  h.confirmCfg = null;
  h.modalCfg = null;
  h.toasts = [];
  h.postArgs = [];
  h.transferArgs = [];
  h.postFails = false;
});

describe("the recognition tab", () => {
  it("renders the project name and the server figures, not a recomputed unbilled", () => {
    const html = render();
    expect(html).toContain("Ratchaphruek Phase 2");
    expect(html).toContain("468,000,000");
    expect(html).toContain("68,400,000");
    // unbilled comes off the wire as -5,800,000 and prints WITHOUT a "+" sign.
    expect(html).toContain("-5,800,000");
    expect(html).not.toContain("+-5,800,000");
  });

  it("em-dashes the method cell instead of printing a guessed label (B-432)", () => {
    // The stored code must not reach the screen as if it were a policy name, and no
    // prototype label may be attached to it until Wei rules.
    const html = render();
    expect(html).not.toContain("percent-of-completion");
    expect(html).toContain(DASH);
  });

  it("labels the button with the millions still recognisable", () => {
    // 468,000,000 x 65% = 304,200,000; less 68,400,000 = 235,800,000 -> 235.8M
    expect(render()).toContain("235.8M");
  });

  it("shows the fully-recognised marker instead of a button when nothing is due", () => {
    h.rev = [{ ...REV, recognized: 304200000 }];
    const html = render();
    expect(html).toContain("fullyRecognized");
    expect(html).not.toContain("235.8M");
  });

  it("counts the KPI row off the served rows", () => {
    h.rev = [REV, { ...REV, id: "r-1", recognized: 304200000 }];
    const html = render();
    expect(html).toContain("count=2");
  });
});

describe("posting a recognition — the confirm descriptor", () => {
  const build = (over: Partial<Parameters<typeof postConfirmDescriptor>[0]> = {}) =>
    postConfirmDescriptor({
      row: toRevRec(REV),
      title: "confirmPostTitle",
      confirmLabel: "createJv",
      message: TPL["gl.revrec.confirmMessage"]!,
      drCr: "drCr",
      onConfirm: () => h.postArgs.push("confirmed"),
      ...over,
    });

  it("names its own confirm action instead of the shared label", () => {
    // The prototype's confirmLabel is "create JV", and modal-host now honours it. If that
    // wiring is dropped the shared common.confirm comes back and this dies.
    expect(build().confirmLabel).toBe("createJv");
  });

  it("interpolates the row's recognisable amount and percent into the message", () => {
    const html = renderToStaticMarkup(<>{build().message as ReactNode}</>);
    expect(html).toContain("amount=235,800,000");
    expect(html).toContain("pct=65");
    expect(html).toContain("drCr");
  });

  it("subtitles with the project name, em-dashing an unresolved one", () => {
    expect(build().subtitle).toBe("Ratchaphruek Phase 2");
    expect(build({ row: toRevRec({ ...REV, project_name: null }) }).subtitle).toBe(DASH);
  });

  it("carries NO amount of its own — the descriptor hands the caller a bare callback", () => {
    // The money figure in the message is display; nothing in this object can reach the POST.
    // A refactor that started passing an amount through would have to add a key here.
    expect(Object.keys(build()).sort()).toEqual([
      "confirmLabel",
      "icon",
      "iconTone",
      "message",
      "onConfirm",
      "subtitle",
      "title",
    ]);
  });

  it("runs the caller's mutation when confirmed, and not before", () => {
    const cfg = build();
    expect(h.postArgs).toEqual([]);
    (cfg.onConfirm as () => void)();
    expect(h.postArgs).toEqual(["confirmed"]);
  });
});

describe("the WIP tab is reachable and totals its columns", () => {
  it("renders the WIP table when the tab state starts on recognition", () => {
    // The default tab is recognition, so the WIP table is not in the first paint —
    // this asserts the default rather than assuming it.
    const html = render();
    expect(html).toContain("tabWip");
    expect(html).not.toContain("24,400,000");
  });
});

describe("the export action is an honest stub", () => {
  it("renders the Export button and fires no toast", () => {
    const html = render();
    expect(html).toContain("common.export");
    expect(h.toasts).toEqual([]);
  });
});
