/*
 * Unit tests for renderRich (G3). DOM-free: we render the returned nodes to a
 * static HTML string with react-dom/server and assert the structure. All fixtures
 * here are ASCII so this .ts source stays Thai-free (i18n-guard, B-073).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderRich } from "./render-rich";

const html = (s: string) => renderToStaticMarkup(renderRich(s) as never);

describe("renderRich", () => {
  it("renders a plain string as a single text node (no markup)", () => {
    expect(html("hello world")).toBe("hello world");
  });

  it("turns <br/> into a <br/> element and keeps the surrounding text", () => {
    expect(html("line one<br/>line two")).toBe("line one<br/>line two");
  });

  it("turns <b>...</b> into a real <b> span", () => {
    expect(html("due <b>Jun 8</b> soon")).toBe("due <b>Jun 8</b> soon");
  });

  it("handles a leading <b> run (benefit-bullet shape)", () => {
    expect(html("<b>No app</b> needed")).toBe("<b>No app</b> needed");
  });

  it("handles multiple <b> runs on one line", () => {
    expect(html("<b>A</b> and <b>B</b>")).toBe("<b>A</b> and <b>B</b>");
  });

  it("combines <br/> line breaks with <b> emphasis", () => {
    expect(html("step:<br/>ok <b>now</b><br/>done")).toBe(
      "step:<br/>ok <b>now</b><br/>done",
    );
  });

  it("does NOT inject raw HTML: an unsupported tag stays literal text", () => {
    // <i> is not parsed -> it must render escaped, never as a real element.
    expect(html("<i>x</i>")).toBe("&lt;i&gt;x&lt;/i&gt;");
  });

  it("escapes HTML-significant characters in plain text (no dangerouslySetInnerHTML)", () => {
    expect(html("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("renders an empty string as empty output", () => {
    expect(html("")).toBe("");
  });
});
