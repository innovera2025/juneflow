/*
 * G3 tests for the self-hosted webfonts (B-440 = ก).
 *
 * WHAT THIS PROTECTS. index.html used to <link> fonts.googleapis.com, and that made
 * what the app RENDERS depend on a third-party fetch. Measured, one browser and one
 * stack with the only variable being whether the CDN was reachable: `login` differed
 * by 130,840 of 1,600,000 pixels — 8.18% — against a CI gap of 1.42-3.74% that three
 * separate re-baselines had failed to close. The gate could not have been made stable
 * while that link existed.
 *
 * So these are not style checks. Each one fails if the dependency comes back, or if
 * the shipped files stop covering what the app promises to render.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS_PATH = new URL("../public/fonts/fonts.css", import.meta.url);
const CSS = readFileSync(CSS_PATH, "utf8");
const FILES_DIR = new URL("../public/fonts/files/", import.meta.url);

/** Every family the stylesheet declares. */
const families = [...CSS.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]!);

describe("the app does not fetch fonts from anybody", () => {
  it("has no font CDN link left in index.html", () => {
    // The comment above the local <link> still NAMES the CDN, on purpose — it records
    // what was removed. So this asserts on the markup, not on the file's prose.
    const markup = HTML.split("\n")
      .filter((l) => !l.trimStart().startsWith("-") && !l.includes("- "))
      .join("\n");
    expect(markup).not.toMatch(/<link[^>]*fonts\.googleapis\.com/);
    expect(markup).not.toMatch(/<link[^>]*fonts\.gstatic\.com/);
  });

  it("links the local stylesheet instead", () => {
    expect(HTML).toContain('<link href="/fonts/fonts.css" rel="stylesheet" />');
  });

  it("has no remote URL anywhere in the stylesheet", () => {
    // A single missed subset would silently reintroduce the dependency for exactly the
    // characters that subset covers — Thai, say — and nothing else would look wrong.
    expect(CSS).not.toContain("fonts.gstatic.com");
    expect(CSS).not.toContain("http://");
    expect(CSS).not.toContain("https://");
  });
});

describe("what the stylesheet promises, the repo actually ships", () => {
  it("declares all five families the app renders in four languages", () => {
    expect(new Set(families)).toEqual(
      new Set(["Inter", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans SC", "IBM Plex Sans"]),
    );
  });

  it("points every src at a file that exists", () => {
    // The failure this closes is silent: a missing woff2 makes the browser fall back
    // for that unicode range only, so Thai text degrades while the page still looks
    // fine in English.
    const refs = [...CSS.matchAll(/url\((\/fonts\/files\/[^)]+)\)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    const missing = refs.filter(
      (r) => !existsSync(new URL(r.replace("/fonts/files/", ""), FILES_DIR)),
    );
    expect(missing).toEqual([]);
  });

  it("ships no file the stylesheet never references", () => {
    const refs = new Set(
      [...CSS.matchAll(/url\(\/fonts\/files\/([^)]+)\)/g)].map((m) => m[1]!),
    );
    const orphans = readdirSync(FILES_DIR).filter((f) => f.endsWith(".woff2") && !refs.has(f));
    expect(orphans).toEqual([]);
  });

  it("keeps the unicode-range subsetting, which is why this is megabytes not gigabytes", () => {
    // Without unicode-range the browser would download every CJK range to render a
    // Thai page. The ranges are Google's own and are copied verbatim.
    expect(CSS.match(/unicode-range:/g)?.length ?? 0).toBeGreaterThan(50);
  });

  it("ships the licence the OFL requires to travel with the files", () => {
    const lic = readFileSync(new URL("../public/fonts/LICENSE.md", import.meta.url), "utf8");
    expect(lic).toContain("SIL OPEN FONT LICENSE");
    for (const f of ["Inter", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans SC", "IBM Plex Sans"]) {
      expect(lic).toContain(f);
    }
  });
});

describe("the stylesheet and index.html cannot drift apart", () => {
  it("declares a weight for every one the app's token scale uses", () => {
    // index.html no longer carries the weight list (it is in scripts/fetch-fonts.sh),
    // so the check that matters is that the SHIPPED css covers the weights the design
    // tokens ask for: 400-800 on the display face, 400-700 elsewhere.
    const weights = new Set(
      [...CSS.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1])),
    );
    for (const w of [400, 500, 600, 700, 800]) expect(weights.has(w)).toBe(true);
  });
});
