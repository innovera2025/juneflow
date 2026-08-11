/*
 * BOQArchive SCREEN-SEAM tests (B-355, gate G3) — the component<->payload wiring, not the
 * pure narrowing (that is boq-archive-rows.test.ts).
 *
 * WHY THIS FILE EXISTS: boq-archive-rows.test.ts can only prove that toArchiveApproval /
 * formatApprovedAt behave; it stays green if the SCREEN never calls them and keeps printing
 * the two em-dashes it printed before. These tests assert the seam instead — that a served
 * GET /boq row's approved_by_name and approved_at actually reach the rendered approver /
 * approve-date cells, and that an unapproved doc still gets nothing. Revert the wire (put the
 * two literal em-dash <td>s back) and they go red.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same
 * style as screens/boq/boq-bom.test.tsx. Page is stubbed because it mounts TopBar, which
 * needs a live TanStack Router. Translators echo their key, so this .tsx stays ASCII-only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (boq-archive.tsx). */
const DASH = "—";

/** Mutable mock state, hoisted so the vi.mock factories can close over it. */
const h = vi.hoisted(() => ({
  /** What useBoqList returns (the served GET /boq rows + query flags). */
  boq: { data: [] as unknown[], isLoading: false },
  /** The GET /projects rows backing the project column + filter. */
  projects: [{ id: "p1", name: "juneflow ratchaphruek" }],
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));

// Page mounts TopBar (TanStack Router hooks) — stub it down to its slots.
vi.mock("../../shell/page", () => ({
  Page: ({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode }) => (
    <div>
      {title}
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({ navigate: () => {}, notify: () => {}, confirm: () => {} }),
}));

vi.mock("../../shell/use-shell-data", () => ({
  useProjects: () => ({ data: h.projects }),
}));

vi.mock("./use-boq", () => ({
  useBoqList: () => h.boq,
}));

import { BOQArchive } from "./boq-archive";

/**
 * A served GET /boq page: one APPROVED doc carrying the real approver + approval instant
 * (boq.ts docWire resolves approved_by_name from `users`), and one PENDING doc where the
 * server sends null for all three approval fields. ASCII text throughout.
 */
const SERVED = [
  {
    id: "d0",
    no: "BOQ-2025-A-04",
    name: "block a detached",
    scope: "48 units",
    project_id: "p1",
    version: 4,
    status: "approved",
    currency_code: "THB",
    total: 14240000,
    approved_by: "u-dir",
    approved_by_name: "Somporn Petchai",
    approved_at: "2025-10-22T03:15:00.000Z",
  },
  {
    id: "d1",
    no: "BOQ-2026-D-01",
    name: "block d semi detached",
    scope: "36 units",
    project_id: "p1",
    version: 1,
    status: "pending",
    currency_code: "THB",
    total: 8240000,
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
  },
];

const render = () => renderToStaticMarkup(<BOQArchive />);

/** Visible text of a static render — tags stripped. */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

/** The markup of the single <tr> that carries the given BOQ no (doc no -> end of row). */
const rowOf = (html: string, no: string): string => {
  const at = html.indexOf(no);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<tr", at);
  const end = html.indexOf("</tr>", at);
  return html.slice(start, end);
};

/** How many em-dashes a chunk of markup renders. */
const dashes = (chunk: string): number => chunk.split(DASH).length - 1;

beforeEach(() => {
  h.boq = { data: SERVED, isLoading: false };
});

describe("BOQArchive <-> GET /boq approval columns (B-355)", () => {
  it("renders the served approver name in the approved doc's row", () => {
    expect(rowOf(render(), "BOQ-2025-A-04")).toContain("Somporn Petchai");
  });

  it("renders the served approved_at as an ISO/UTC calendar date", () => {
    expect(text(rowOf(render(), "BOQ-2025-A-04"))).toContain("2025-10-22");
  });

  it("leaves only the two genuinely-sourceless cells em-dashed on an approved row", () => {
    // paperclip + history counts (no attachments table; version_history is detail-only).
    // Before the re-wire this row carried FOUR (approver + approve-date as well).
    expect(dashes(rowOf(render(), "BOQ-2025-A-04"))).toBe(2);
  });

  it("keeps an unapproved doc's approver + date empty rather than borrowing another row's", () => {
    const row = rowOf(render(), "BOQ-2026-D-01");
    expect(row).not.toContain("Somporn");
    expect(row).not.toContain("2025-10-22");
    // approver + approve-date + paperclip + history.
    expect(dashes(row)).toBe(4);
  });

  it("em-dashes an unparseable approved_at instead of printing the raw wire string", () => {
    h.boq = {
      data: [{ ...SERVED[0], approved_at: "not-a-date" }],
      isLoading: false,
    };
    const row = rowOf(render(), "BOQ-2025-A-04");
    expect(row).not.toContain("not-a-date");
    expect(dashes(row)).toBe(3); // approve-date falls back, approver still real
  });

  it("still renders the approver when the server sends no approval timestamp", () => {
    h.boq = { data: [{ ...SERVED[0], approved_at: null }], isLoading: false };
    const row = rowOf(render(), "BOQ-2025-A-04");
    expect(row).toContain("Somporn Petchai");
    expect(dashes(row)).toBe(3);
  });

  it("mounts the loading skeleton instead of a table while the read is in flight", () => {
    h.boq = { data: [], isLoading: true };
    const html = render();
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Somporn Petchai");
  });
});

/*
 * Honest-gap guards. These hold BOTH before and after the B-355 re-wire — they are stated as
 * negative invariants, not as evidence the wire works (see the revert probe in the slice
 * report). They fail only if a later change starts inventing these values.
 */
describe("BOQArchive invents nothing the LIST payload does not carry", () => {
  it("prints no attachment / revise counts (no attachments table; version_history is detail-only)", () => {
    // The file/revise cell is the row's last two em-dashes and carries no digit of its own.
    const row = rowOf(render(), "BOQ-2025-A-04");
    const cell = row.slice(row.lastIndexOf("<td", row.lastIndexOf(DASH)));
    expect(text(cell).replace(/[^0-9]/g, "")).toBe("");
  });

  it("keeps the year filter pill valueless rather than guessing a filter semantics", () => {
    // The pill sits in the toolbar, above the table.
    const toolbar = render().split("<table")[0]!;
    expect(toolbar).toContain(DASH);
    expect(toolbar).not.toContain("2025");
    expect(toolbar).not.toContain("2569");
  });
});
