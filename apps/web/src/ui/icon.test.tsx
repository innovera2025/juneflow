/*
 * Icon guard tests (B-087). The Icon component is fed opaque server strings by some
 * callers (e.g. master-company passes `r.icon as IconName` from GET /org-units), so a
 * `name` outside the glyph table must NOT throw — it renders a blank svg, reproducing
 * the prototype's `paths[name] || null`. Known names still render their glyph verbatim
 * (behaviour-preserving). DOM-free static render, matching ui/chart.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, type IconName } from "./icon";

describe("Icon glyph guard", () => {
  it("renders the glyph for a known name (unchanged)", () => {
    const html = renderToStaticMarkup(<Icon name="check" />);
    expect(html).toContain("<svg");
    // The "check" glyph is a single <path d="M5 12l4 4 10-10">.
    expect(html).toContain("<path");
    expect(html).toContain("M5 12l4 4 10-10");
  });

  it("renders a blank svg (no throw) for a name outside the glyph table", () => {
    // Opaque server value cast to IconName — the org-units crash vector.
    const bad = "not-a-real-glyph" as IconName;
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(<Icon name={bad} />);
    }).not.toThrow();
    expect(html).toContain("<svg");
    // No glyph children were emitted for the unknown name.
    expect(html).not.toContain("<path");
    expect(html).not.toContain("<rect");
    expect(html).not.toContain("<circle");
  });

  it("renders a blank svg for an empty-string name (icon:null / icon:'' on the wire)", () => {
    const empty = "" as IconName;
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(<Icon name={empty} />);
    }).not.toThrow();
    expect(html).toContain("<svg");
    expect(html).not.toContain("<path");
  });

  it('keeps the intentional blank for the "report" glyph', () => {
    const html = renderToStaticMarkup(<Icon name="report" />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("<path");
  });
});
