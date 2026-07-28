/*
 * renderRich — parse the literal inline markup that the LINE OA fixture strings
 * carry (line-oa-fixture.json) into safe React nodes.
 *
 * The fixture stores each phone-mockup string byte-exact from the prototype
 * (pototype/line-oa.jsx / line-pm.jsx), which means some bubble/benefit strings
 * embed the prototype's own `<br/>` line breaks and `<b>…</b>` emphasis. This
 * helper turns `<br/>` into a <br/> element and `<b>…</b>` into a <b> span, with
 * everything else rendered as plain text nodes.
 *
 * It NEVER uses dangerouslySetInnerHTML: the markup is parsed into elements, so no
 * fixture string is ever interpreted as raw HTML. Any tag other than the two
 * supported ones stays literal text (defensive — the fixture only ever uses these
 * two, but an unexpected `<i>` would render as the visible characters, not an
 * element). Kept in a .ts file (createElement, no JSX) per the port brief.
 */
import { Fragment, createElement, type ReactNode } from "react";

const BOLD = /<b>(.*?)<\/b>/g;

/** Parse one line's `<b>…</b>` runs into text nodes + <b> spans (in order). */
function parseLine(line: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let boldIdx = 0;
  // Fresh regex state per call (BOLD is a shared /g literal).
  BOLD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    nodes.push(createElement("b", { key: `${keyBase}-b${boldIdx}` }, match[1]));
    last = match.index + match[0].length;
    boldIdx += 1;
    // Guard against a zero-width match looping forever (defensive).
    if (match.index === BOLD.lastIndex) BOLD.lastIndex += 1;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

/**
 * Render a fixture string with literal `<br/>` and `<b>…</b>` markup as React
 * nodes. Plain strings (no markup) render as a single text node.
 */
export function renderRich(text: string): ReactNode {
  const lines = text.split("<br/>");
  const out: ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push(createElement("br", { key: `br${idx}` }));
    for (const node of parseLine(line, `l${idx}`)) out.push(node);
  });
  return createElement(Fragment, null, ...out);
}
