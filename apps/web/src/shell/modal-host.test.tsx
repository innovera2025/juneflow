/*
 * ModalHost confirm-dialog tests (B-432, gate G3).
 *
 * The shared ConfirmDialog used to print common.confirm on every confirm modal, ignoring the
 * `confirmLabel` several prototype screens pass (shell.jsx supports it — "create JV" on
 * gl.revrec is one). That is a §0 rule-1 divergence on every such screen, and it was invisible
 * because no test rendered this component at all.
 *
 * Harness: vitest env is `node`, so the dialog renders DOM-free with renderToStaticMarkup and
 * its i18n/ui dependencies stay real except the translator, which echoes the key — this file is
 * ASCII-only (B-073) and the assertions read keys and structure.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ modal: null as Record<string, unknown> | null }));

vi.mock("../i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, tn: (k: string) => k, tp: (k: string) => k }),
}));

vi.mock("./shell-context", () => ({
  useShellCtx: () => ({ modal: h.modal, closeModal: () => {} }),
}));

// Modal mounts portal/overlay chrome; reduce it to its slots so the assertions read content.
vi.mock("../ui/modal", () => ({
  Modal: ({ title, children, footer }: { title?: ReactNode; children?: ReactNode; footer?: ReactNode }) => (
    <div>
      {title}
      {children}
      {footer}
    </div>
  ),
}));

import { ModalHost } from "./modal-host";

const render = (): string => renderToStaticMarkup(<ModalHost />);

describe("the shared confirm dialog", () => {
  it("renders nothing when no modal is open", () => {
    h.modal = null;
    expect(render()).toBe("");
  });

  it("falls back to the shared confirm label when the caller names none", () => {
    h.modal = { kind: "confirm", title: "t", message: "m" };
    const html = render();
    expect(html).toContain("common.confirm");
    expect(html).toContain("common.cancel");
  });

  it("uses the caller's own confirm label when one is given", () => {
    // shell.jsx lets a screen name its action; dropping this puts the generic label back on
    // every prototype screen that names one.
    h.modal = { kind: "confirm", title: "t", message: "m", confirmLabel: "createJv" };
    const html = render();
    expect(html).toContain("createJv");
    expect(html).not.toContain("common.confirm");
  });

  it("ignores a non-string confirmLabel rather than rendering it", () => {
    // ModalCfg has an index signature, so anything type-checks at the call site (B-429).
    // A number or object here must not reach the button.
    h.modal = { kind: "confirm", title: "t", message: "m", confirmLabel: 42 };
    expect(render()).toContain("common.confirm");
  });
});
