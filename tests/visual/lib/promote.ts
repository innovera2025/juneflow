import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";

// tests/visual/lib/promote.ts — the visual gate's PROMOTE mode (re-baseline of
// the app-baseline reference pack · B-409, approved by Wei).
//
// WHY THIS MODULE EXISTS AT ALL
// -----------------------------
// tests/visual/reference/app-baseline/*.png is the arbiter of design fidelity
// (PLAN.md §0 rule 4). Re-capturing it replaces that arbiter. The previous
// re-baseline (91dee5c) was done by an ad-hoc script that lived outside the
// repo, so the *mechanism* was thrown away and only the pixels survived. This
// module is the permanent, auditable replacement: it is not a convenience, it
// is a set of refusals with a write attached to the end.
//
// THE FAILURE IT IS DESIGNED AGAINST — B-155
// ------------------------------------------
// The capture spec once navigated with `${base}/#/${route}` while the app uses
// browser-path routing. Every route resolved to "/" -> indexRoute redirect ->
// /dashboard, so ALL 28 baselines became pictures of the dashboard, and the
// gate then compared the dashboard against itself, 28 times, green. It was a
// no-op for weeks and nobody noticed. A promote step that cannot detect "I just
// captured the same page 99 times" will do it again — so this module refuses on
// (a) the landing pathname not matching the requested route, per screen, and
// (b) an implausibly low number of DISTINCT image hashes across the pack.
//
// DESIGN RULES
//   - Nothing here writes to reference/ until commit(), and commit() writes all
//     rows or none. A pack half-captured on one stack and half left over from an
//     older one is exactly how you get a baseline nobody can reproduce (B-323).
//   - Every refusal names the screens involved and the counts it measured, so a
//     human can judge instead of re-running blind.
//   - Two artifacts, on purpose: a DIFF-CLEAN manifest (stable order, no
//     timestamps — this is what proves two runs captured the same pixels) and a
//     separate diagnostic evidence JSON that may contain run-specific noise.

/** Opt-in env var. OFF unless it is exactly "1" or "true" (case-insensitive). */
export const PROMOTE_ENV = "VISUAL_PROMOTE_BASELINE";

/** The only subdirectory of reference/ a promote may write into. */
export const BASELINE_DIR = "app-baseline";

// ---- the B-155 detector's constants -----------------------------------------
//
// Where the line sits, and why:
//   * Two DISTINCT routes producing BYTE-IDENTICAL screenshots already means the
//     same page rendered twice — same sidebar, same title, same body, same
//     antialiasing. That is conceivable (two stub screens sharing one empty
//     state), so a PAIR is reported but allowed.
//   * THREE routes sharing one image is the B-155 shape at small scale. There is
//     no credible reason for three different screens of a 99-screen ERP to be
//     pixel-identical. The cost of a false refusal is one human look at the
//     named groups; the cost of a false accept is a gate that tests nothing for
//     weeks. So the cap is 2.
//   * A pack can also fail DIFFUSELY: 40 identical pairs would pass the group
//     cap while the pack is obviously broken. So the distinct RATIO is checked
//     too — but only once the pack is big enough for a ratio to mean anything.
export const MAX_IDENTICAL_GROUP = 2;
export const MIN_DISTINCT_RATIO = 0.9;
export const RATIO_MIN_SCREENS = 10;

// ---- the B-155 detector, part 2: NEAR-identical, not just byte-identical -----
//
// MEASURED FAILURE (adversarial verify of this module, 2026-08-17): 12 captures
// of the SAME page differing in ONE pixel produced 12 distinct sha256 values, so
// duplicateGroups() found zero groups and commit() succeeded. Byte identity is
// the wrong instrument for "did the nav break", because this app has a shape
// that defeats it: an unported route renders <Placeholder routeId/>, whose title
// is the route id, so N broken screens are pixel-DISTINCT and structurally the
// same picture.
//
// THE MEASURE: downscale each capture to a NEAR_DUP_GRID x NEAR_DUP_GRID grid of
// mean luminance and take the mean absolute per-cell difference (0..255 scale).
// It is deliberately dumb — no feature detection, no decode dependency beyond
// node:zlib — and it is a pure function of the pixels, so it stays as
// reproducible as the sha256 it supplements.
//
// CALIBRATED ON THE REAL PACK, NOT GUESSED. All 99 files currently in
// reference/app-baseline/ (all 1600x1000, RGB8, non-interlaced, known to be 99
// DISTINCT screens), all 4851 pairs:
//     closest legitimate pair   0.677   (sales-down.png vs sales-loan.png)
//     1st percentile            1.626
//     median                    4.267
// Against that, the attack side, measured by painting a real baseline:
//     1 pixel changed           0.00009
//     10x10 block               0.0093
//     50x50 block               0.2329
//     60x60 block               0.3361
//
// So MAX_NEAR_DUP_DISTANCE = 0.35 costs, MEASURED: 0 false positives out of 4851
// real pairs, with a 1.93x margin to the closest legitimate pair — while the
// one-pixel attack sits ~3900x below the line. Its honest reach: it catches two
// captures that differ by less than roughly a 60x60 px region (0.22% of the
// frame). It does NOT reach a placeholder pair that differs only by its title
// (measured 0.49-0.55 for a 250x28 text run) — no threshold on this metric can,
// because a real DISTINCT pair in the pack (0.677) is closer than that title
// difference. That gap is why the advisory band below exists instead of a
// pretend-stronger cutoff.
//
// Two further limits, stated rather than papered over:
//   * The measure is LUMINANCE only, so two captures identical in brightness but
//     differing only in hue would group. Untested against this app (it would
//     need a hue-only-different screen pair to exist); such a pair would in any
//     case be a PAIR, which the cap allows, so it takes three to refuse.
//   * It compares whole frames. A pack where every screen shares the Fiori
//     chrome is exactly why the numbers above cluster so tightly — the metric is
//     calibrated for THIS pack's uniformity, and re-calibration is required if
//     the shell layout changes materially.
export const NEAR_DUP_GRID = 16;
export const MAX_NEAR_DUP_DISTANCE = 0.35;
// Reported, never refused. Measured cost of refusing here: 35 of 4851 real pairs
// would be false positives, which is a gate people would learn to force past.
// A realistic placeholder pair (different sidebar active row + different title,
// measured 1.33) lands in this band, so the human sees it named at commit time.
export const NEAR_DUP_ADVISORY_DISTANCE = 1.5;

// ---- "zero / absurd size" bounds ---------------------------------------------
// The load-bearing size check is the IHDR one (dimensions must equal the
// viewport the compare path will use, or the promoted baseline auto-FAILs on
// dimensionMismatch forever). These two are the crude truncation/runaway
// bounds: the smallest valid PNG is ~67 bytes, and today's real 1600x1000
// baselines run 99,895..403,622 bytes.
export const MIN_PNG_BYTES = 128;
export const MAX_PNG_BYTES = 32 * 1024 * 1024;

/** Manifest row shape this module needs (a subset of screens.manifest.json). */
export interface PromoteRow {
  screen: string;
  route: string;
  /** Path relative to tests/visual/reference/ — must be inside app-baseline/. */
  ref: string;
  viewport?: { width: number; height: number };
}

/**
 * localStorage key holding the bearer JWT. MUST match
 * apps/web/src/auth-token.ts TOKEN_STORAGE_KEY — that module is the single
 * holder of the token, and playwright.visual.config.ts injects it through
 * VISUAL_STORAGE_STATE.
 */
export const AUTH_TOKEN_KEY = "juneflow-token";

/**
 * Console-error text that means "this screen's data layer was refused or never
 * arrived". Deliberately a SIGNATURE LIST rather than "any console error":
 * I could not measure this app's baseline console noise in this session (it
 * needs a running stack), and a blanket refusal calibrated on nothing is how a
 * guard gets switched off by the first person it inconveniences. Everything
 * NOT matching is still collected, written to the evidence JSON, and counted in
 * the commit log — consulted, not discarded.
 */
const AUTH_FAILURE_CONSOLE = /\b(401|403)\b|unauthenticated|unauthorized|forbidden|failed to fetch|networkerror|err_connection|err_network|failed to load resource/i;

/** Per-screen diagnostics collected at capture time (evidence JSON only). */
export interface CaptureEvidence {
  /** page.url() AFTER navigation + settle — the B-155 per-screen signal. */
  landedUrl: string;
  status: number | null;
  pageErrors: string[];
  consoleErrors: string[];
  bodyChars?: number | null;
  placeholder?: boolean | null;
  /**
   * Was AUTH_TOKEN_KEY present in localStorage at screenshot time?
   * null = not measured (the probe did not run) — which promote treats as
   * unverified, not as "fine".
   */
  authTokenPresent?: boolean | null;
  /** Count of requests to the API base path observed during this capture. */
  apiRequests?: number | null;
  /** How many of those answered 401/403. */
  apiUnauthorized?: number | null;
}

export interface PlannedTarget extends PromoteRow {
  /** Absolute, realpath-resolved destination inside reference/app-baseline/. */
  absRef: string;
}

export interface StagedRecord {
  screen: string;
  route: string;
  ref: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  /** Absolute path of the staged file (never under reference/). */
  stagedPath: string;
  /**
   * NEAR_DUP_GRID^2 mean-luminance cells — the near-duplicate signature.
   * null when the PNG could not be fully decoded (that screen then falls back to
   * byte identity only, and commit() says so out loud).
   */
  signature?: number[] | null;
}

export interface DuplicateGroup {
  sha256: string;
  screens: string[];
}

/** Every refusal in this module is this class — a promote refusal, not a crash. */
export class PromoteRefusal extends Error {
  constructor(message: string) {
    super(`PROMOTE REFUSED — ${message}`);
    this.name = "PromoteRefusal";
  }
}

export function isPromoteMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env[PROMOTE_ENV] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG's IHDR dimensions, or null when the buffer is not a valid PNG. */
export function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Normalize a URL/pathname for the landing check (trailing slash, escapes). */
function landingPath(urlOrPath: string): string {
  let p = urlOrPath;
  try {
    p = new URL(urlOrPath).pathname;
  } catch {
    /* not absolute — treat the input as a pathname */
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed escape — compare raw */
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/**
 * GUARD 2 — only paths the manifest already declares, and only ones that
 * already exist. Refuses the WHOLE run (never a partial promote) when any row
 * is bad, and reports every offender at once so one re-run shows them all.
 *
 * A promote may never MINT a reference: a typo'd ref would otherwise create a
 * brand-new "baseline" that no human ever approved, and the gate would then be
 * green against a picture of whatever the app did that afternoon.
 */
export function planPromotion(rows: PromoteRow[], refDir: string): PlannedTarget[] {
  const problems: string[] = [];
  const targets: PlannedTarget[] = [];
  const seenRef = new Map<string, string>();
  const seenScreen = new Set<string>();

  const baselineRoot = join(refDir, BASELINE_DIR);
  let baselineRootReal: string;
  try {
    baselineRootReal = realpathSync(baselineRoot);
  } catch {
    throw new PromoteRefusal(
      `the baseline directory does not exist: ${baselineRoot} — a promote writes over an EXISTING pack, it never creates one`
    );
  }

  for (const row of rows) {
    const where = `${row.screen} (${row.route})`;
    if (!row.screen || seenScreen.has(row.screen)) {
      problems.push(`${where}: duplicate or empty screen id — screen ids key the promote`);
      continue;
    }
    seenScreen.add(row.screen);

    const ref = String(row.ref ?? "");
    if (!ref) {
      problems.push(`${where}: manifest row has no ref`);
      continue;
    }
    if (isAbsolute(ref) || normalize(ref).split(sep).includes("..")) {
      problems.push(`${where}: ref "${ref}" is absolute or escapes with ".." — refs are relative to reference/`);
      continue;
    }
    if (!ref.toLowerCase().endsWith(".png")) {
      // lib/compare.ts picks its decoder from the EXTENSION (mimeForPath), so
      // PNG bytes under a .jpg name would decode as garbage or throw later.
      problems.push(`${where}: ref "${ref}" is not a .png — captures are PNG and compare.ts decodes by extension`);
      continue;
    }
    const previous = seenRef.get(ref);
    if (previous) {
      problems.push(`${where}: ref "${ref}" is also claimed by ${previous} — two screens writing one file makes the promote order-dependent`);
      continue;
    }
    seenRef.set(ref, row.screen);

    const abs = resolve(refDir, ref);
    if (!existsSync(abs)) {
      problems.push(`${where}: reference does not exist: ${ref} — a promote overwrites, it never mints a new baseline`);
      continue;
    }
    let real: string;
    try {
      real = realpathSync(abs);
      if (!statSync(real).isFile()) {
        problems.push(`${where}: ${ref} is not a regular file`);
        continue;
      }
    } catch (e) {
      problems.push(`${where}: cannot resolve ${ref} — ${(e as Error).message}`);
      continue;
    }
    // Containment is checked on the REALPATH so a symlink inside app-baseline/
    // cannot redirect the write outside the pack.
    if (!(real + sep).startsWith(baselineRootReal + sep)) {
      problems.push(`${where}: ${ref} resolves to ${real}, outside ${baselineRootReal}/ — promote writes only inside ${BASELINE_DIR}/`);
      continue;
    }
    targets.push({ ...row, absRef: real });
  }

  if (problems.length > 0) {
    throw new PromoteRefusal(
      `${problems.length} manifest target(s) unusable — nothing was written:\n  - ${problems.join("\n  - ")}`
    );
  }
  return targets;
}

/**
 * GUARD 5 — never promote a failed capture. Returns the list of problems (empty
 * = usable). "The screen errored / navigated to an error page / produced a
 * zero-or-absurd image" are all here, plus the per-screen B-155 landing check.
 */
export function captureProblems(
  row: PromoteRow,
  png: Buffer,
  evidence: CaptureEvidence
): string[] {
  const problems: string[] = [];
  const viewport = row.viewport ?? { width: 1600, height: 1000 };

  if (!Buffer.isBuffer(png) || png.length === 0) {
    problems.push("capture is empty (0 bytes)");
  } else {
    if (png.length < MIN_PNG_BYTES) problems.push(`capture is ${png.length} B — below MIN_PNG_BYTES=${MIN_PNG_BYTES} (truncated)`);
    if (png.length > MAX_PNG_BYTES) problems.push(`capture is ${png.length} B — above MAX_PNG_BYTES=${MAX_PNG_BYTES}`);
    const dims = readPngSize(png);
    if (!dims) {
      problems.push("capture is not a decodable PNG (bad signature/IHDR)");
    } else if (dims.width !== viewport.width || dims.height !== viewport.height) {
      // A promoted baseline whose dimensions differ from the capture viewport
      // makes every later gate run auto-FAIL on dimensionMismatch (P0-FIX-04),
      // which masks can never rescue.
      problems.push(
        `capture is ${dims.width}x${dims.height} but the capture viewport is ${viewport.width}x${viewport.height} (deviceScaleFactor? wrong viewport?)`
      );
    }
  }

  // HOLE 1 (measured): `status !== null && status >= 400` meant a NULL status
  // skipped the HTTP check entirely — captureProblems returned [] and the
  // capture promoted. Playwright returns null from goto() for a same-document
  // navigation, so "no status" is not "status fine", it is "the check did not
  // apply". captureScreen() always navigates cross-document (a fresh page at
  // about:blank -> `${baseURL}/${route}`), so a null here means the navigation
  // did not happen the way the capture path assumes, and the one signal that
  // would have caught an error page is missing. Refuse rather than skip.
  if (evidence.status === null || evidence.status === undefined) {
    problems.push(
      "navigation returned NO HTTP status (goto() -> null: same-document navigation) — " +
        "the HTTP check cannot apply, so this capture is unverified, not clean"
    );
  } else if (evidence.status >= 400) {
    problems.push(`navigation returned HTTP ${evidence.status} — an error page is not a baseline`);
  }
  if (evidence.pageErrors.length > 0) {
    problems.push(`uncaught page error(s): ${evidence.pageErrors.slice(0, 3).join(" · ")}`);
  }

  // HOLE 2 (measured): consoleErrors was collected and NEVER read. Consulted
  // now, through AUTH_FAILURE_CONSOLE — see that constant for why it is a
  // signature list and not "any console error".
  const authConsole = (evidence.consoleErrors ?? []).filter((m) => AUTH_FAILURE_CONSOLE.test(m));
  if (authConsole.length > 0) {
    problems.push(
      `${authConsole.length} console error(s) reporting a refused/failed request: ${authConsole.slice(0, 3).join(" · ")}`
    );
  }

  // HOLE 3 (measured): bodyChars === 0 — a blank page — was promotable.
  if (typeof evidence.bodyChars !== "number") {
    problems.push("the body probe did not run — a promote cannot confirm the page rendered anything");
  } else if (evidence.bodyChars === 0) {
    problems.push("the page body is EMPTY (0 characters) — a blank page is not a baseline");
  }

  // THE UNAUTHENTICATED-CAPTURE DETECTOR.
  //
  // What is actually true of this app, measured in the source rather than
  // assumed: apps/web's ROUTER IS NOT AUTH-GATED. The bearer token gates the API
  // layer only (src/api-client.ts attaches it per request; src/shell/use-shell-data.ts
  // gates every hook on `enabled: authed()`), never navigation. So a promote run
  // with a missing or expired VISUAL_STORAGE_STATE still produces captures that
  // are correctly routed, HTTP 200, and DISTINCT per screen — full Fiori chrome,
  // empty body. Every check above passes on those. That pack would then become
  // the definition of "correct".
  //
  // The two failure modes have DIFFERENT signatures, measured from the source,
  // and each needs its own signal:
  //   * token MISSING  -> `authed()` is false -> the hooks never fire -> ZERO
  //     API requests. Nothing 401s, because nothing is asked. Only the absence
  //     of the token itself gives this away.
  //   * token EXPIRED/BAD -> the hooks fire -> apps/api's tenant-scope hook
  //     fails closed with 401 UNAUTHENTICATED (apps/api/src/plugins/tenant-scope.ts)
  //     on every non-public path.
  //
  // Why these do not fire on a screen that is legitimately empty by design: an
  // empty-by-design screen is served 200 with an empty list, and its session
  // token is present. Emptiness is a property of the DATA; both signals below
  // are properties of the SESSION. A static/placeholder screen that calls no API
  // at all reports apiRequests 0 / apiUnauthorized 0 and is judged only on the
  // token, which it still has.
  if (evidence.authTokenPresent === false) {
    problems.push(
      `no ${AUTH_TOKEN_KEY} in localStorage at screenshot time — this capture is UNAUTHENTICATED. ` +
        `apps/web's router is not auth-gated, so the shell still renders and the shot looks plausible; ` +
        `the body is an empty/error state. Check VISUAL_STORAGE_STATE`
    );
  } else if (evidence.authTokenPresent !== true) {
    problems.push(
      `the ${AUTH_TOKEN_KEY} probe did not run — a promote cannot confirm this capture was authenticated`
    );
  }
  if (typeof evidence.apiUnauthorized !== "number") {
    // Not measured is not "fine": an expired token STAYS in localStorage, so
    // authTokenPresent alone cannot see a session that died mid-run. Without the
    // wire count there is no signal left for that case.
    problems.push(
      "API traffic was not measured for this screen — a promote cannot tell a screen that is empty by design " +
        "from one whose data layer was refused"
    );
  } else if (evidence.apiUnauthorized > 0) {
    problems.push(
      `${evidence.apiUnauthorized} of ${evidence.apiRequests ?? "?"} API request(s) answered 401/403 — ` +
        `the session was rejected, so this screen's body is an error/empty state, not its content ` +
        `(an expired token still renders the shell: the router is not auth-gated)`
    );
  }
  const want = `/${row.route}`;
  const landed = landingPath(evidence.landedUrl);
  if (landed !== landingPath(want)) {
    // THE B-155 SIGNAL, per screen: a redirect bakes the WRONG screen into the
    // baseline. This is how 28 baselines once became 28 dashboards.
    problems.push(
      `landed on "${landed}" but the manifest route is "${want}" (redirect) — this is the B-155 shape: the baseline would be a picture of a different screen`
    );
  }
  return problems;
}

export function duplicateGroups(records: Pick<StagedRecord, "screen" | "sha256">[]): DuplicateGroup[] {
  const byHash = new Map<string, string[]>();
  for (const r of records) {
    const list = byHash.get(r.sha256) ?? [];
    list.push(r.screen);
    byHash.set(r.sha256, list);
  }
  return [...byHash.entries()]
    .filter(([, screens]) => screens.length > 1)
    .map(([hash, screens]) => ({ sha256: hash, screens: [...screens].sort() }))
    .sort((a, b) => b.screens.length - a.screens.length || (a.sha256 < b.sha256 ? -1 : 1));
}

// ---- the near-duplicate signature -------------------------------------------

/**
 * Decode a non-interlaced 8-bit PNG to a NEAR_DUP_GRID^2 grid of mean luminance.
 * Returns null for anything it cannot decode — the caller degrades to byte
 * identity for that screen and REPORTS it, never silently.
 *
 * Hand-rolled on node:zlib on purpose: tests/ has no image dependency (only
 * @playwright/test, js-yaml, pg, vitest) and lib/compare.ts decodes inside the
 * browser, which is not available where these guards run. Measured against the
 * real pack: all 99 files in reference/app-baseline/ decode (1600x1000, bit
 * depth 8, colour type 2, interlace 0, 26..100 IDAT chunks each), 4.0 s total.
 */
export function imageSignature(png: Buffer, grid = NEAR_DUP_GRID): number[] | null {
  try {
    if (!Buffer.isBuffer(png) || png.length < 33) return null;
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    if (png.subarray(12, 16).toString("latin1") !== "IHDR") return null;
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const depth = png[24];
    const colorType = png[25];
    const interlace = png[28];
    if (width <= 0 || height <= 0) return null;
    // 8-bit, non-interlaced only. Playwright screenshots are exactly this, and
    // so is every file in the current pack (measured above).
    if (depth !== 8 || interlace !== 0) return null;
    const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
    if (channels === 0) return null;

    const idat: Buffer[] = [];
    let off = 8;
    while (off + 8 <= png.length) {
      const len = png.readUInt32BE(off);
      const type = png.toString("latin1", off + 4, off + 8);
      if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
      if (type === "IEND") break;
      off += 12 + len;
    }
    if (idat.length === 0) return null;

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < height * (stride + 1)) return null;

    // Undo the per-scanline PNG filters (RFC 2083 §6). Only the current and
    // previous reconstructed rows are needed, so memory stays at 2 scanlines.
    const sums = new Float64Array(grid * grid);
    const counts = new Float64Array(grid * grid);
    let cur = Buffer.alloc(stride);
    let prev = Buffer.alloc(stride);
    let p = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[p++];
      const line = raw.subarray(p, p + stride);
      p += stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? cur[x - channels] : 0;
        const b = prev[x];
        const c = x >= channels ? prev[x - channels] : 0;
        const v = line[x];
        let r: number;
        switch (filter) {
          case 0: r = v; break;
          case 1: r = v + a; break;
          case 2: r = v + b; break;
          case 3: r = v + ((a + b) >> 1); break;
          case 4: {
            const pa = Math.abs(b - c);
            const pb = Math.abs(a - c);
            const pc = Math.abs(a + b - 2 * c);
            r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default: return null; // unknown filter type — do not guess
        }
        cur[x] = r & 0xff;
      }
      const gy = Math.min(grid - 1, Math.floor((y * grid) / height));
      for (let x = 0; x < width; x++) {
        const i = x * channels;
        const lum =
          channels <= 2 ? cur[i] : cur[i] * 0.299 + cur[i + 1] * 0.587 + cur[i + 2] * 0.114;
        const cell = gy * grid + Math.min(grid - 1, Math.floor((x * grid) / width));
        sums[cell] += lum;
        counts[cell] += 1;
      }
      const swap = prev;
      prev = cur;
      cur = swap;
    }
    const out: number[] = new Array(grid * grid);
    for (let i = 0; i < out.length; i++) out[i] = counts[i] === 0 ? 0 : sums[i] / counts[i];
    return out;
  } catch {
    // A corrupt/exotic PNG is not a crash here: the caller degrades to byte
    // identity and reports the degradation.
    return null;
  }
}

/**
 * Mean absolute per-cell difference of two signatures, on the 0..255 luminance
 * scale. Infinity when either side is missing or the grids differ, so a missing
 * signature can never be mistaken for "these two are far apart".
 */
export function signatureDistance(a?: number[] | null, b?: number[] | null): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface NearDuplicateGroup extends DuplicateGroup {
  /** The largest pairwise distance inside the group (0 for byte-identical). */
  maxDistance: number;
}

export interface NearDuplicateReport {
  /** Groups of 2+ screens within MAX_NEAR_DUP_DISTANCE of each other. */
  groups: NearDuplicateGroup[];
  /** Pairs in the advisory band — reported, never refused. */
  advisory: Array<{ screens: [string, string]; distance: number }>;
  /** Screens whose PNG could not be decoded (byte identity only). */
  undecodable: string[];
}

/**
 * Group captures that are near-identical, by transitive closure over
 * MAX_NEAR_DUP_DISTANCE. Byte-identical images have distance 0, so these groups
 * are a strict SUPERSET of duplicateGroups() — the near-duplicate rule
 * generalises the byte-identity rule rather than sitting beside it.
 *
 * Measured on the real pack: the 99 known-distinct baselines form 99 groups of
 * 1 (no chaining, no false grouping) — see the calibration note on
 * MAX_NEAR_DUP_DISTANCE.
 */
export function nearDuplicateReport(
  records: Array<Pick<StagedRecord, "screen" | "sha256"> & { signature?: number[] | null }>
): NearDuplicateReport {
  const n = records.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };

  const advisory: NearDuplicateReport["advisory"] = [];
  const pairDistance = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Byte-identical always counts, even when neither side could be decoded.
      const identical = records[i].sha256 === records[j].sha256;
      const d = identical ? 0 : signatureDistance(records[i].signature, records[j].signature);
      if (d <= MAX_NEAR_DUP_DISTANCE) {
        union(i, j);
        pairDistance.set(`${i}:${j}`, d);
      } else if (d <= NEAR_DUP_ADVISORY_DISTANCE) {
        advisory.push({ screens: [records[i].screen, records[j].screen], distance: d });
      }
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = byRoot.get(r) ?? [];
    list.push(i);
    byRoot.set(r, list);
  }

  const groups: NearDuplicateGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    let maxDistance = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const i = Math.min(members[a], members[b]);
        const j = Math.max(members[a], members[b]);
        const d = pairDistance.get(`${i}:${j}`);
        if (d !== undefined && d > maxDistance) maxDistance = d;
      }
    }
    const screens = members.map((i) => records[i].screen).sort();
    const hashes = new Set(members.map((i) => records[i].sha256));
    groups.push({
      sha256: hashes.size === 1 ? [...hashes][0] : "(near-identical, distinct bytes)",
      screens,
      maxDistance,
    });
  }
  groups.sort((a, b) => b.screens.length - a.screens.length || (a.screens[0] < b.screens[0] ? -1 : 1));
  advisory.sort((a, b) => a.distance - b.distance);

  return {
    groups,
    advisory,
    undecodable: records.filter((r) => !r.signature).map((r) => r.screen).sort(),
  };
}

function describeGroup(g: DuplicateGroup): string {
  const shown = g.screens.slice(0, 20).join(", ");
  const more = g.screens.length > 20 ? ` (+${g.screens.length - 20} more)` : "";
  return `sha ${g.sha256.slice(0, 12)} x${g.screens.length}: ${shown}${more}`;
}

function describeNearGroup(g: NearDuplicateGroup): string {
  const kind = g.maxDistance === 0 ? "byte-identical" : `max distance ${g.maxDistance.toFixed(4)}`;
  return `${describeGroup(g)} [${kind}]`;
}

/**
 * GUARD 3 — THE B-155 DETECTOR. Throws when the captured pack is implausibly
 * uniform. Always reports the duplicate groups BY SCREEN NAME so a human can
 * judge whether a pair is genuine or the nav is broken.
 */
export function assertPlausiblyDistinct(
  records: Array<Pick<StagedRecord, "screen" | "sha256"> & { signature?: number[] | null }>
): DuplicateGroup[] {
  const groups = duplicateGroups(records);
  const total = records.length;

  // The near-duplicate report SUBSUMES byte identity (identical bytes are
  // distance 0), so both the group cap and the ratio are judged on it. A pack of
  // 12 shots of one page differing by a pixel each has 12 distinct sha256 values
  // but ONE near-duplicate group — which is the measured hole this closes.
  const near = nearDuplicateReport(records);
  const groupedScreens = near.groups.reduce((n, g) => n + g.screens.length, 0);
  const distinctUnits = total - groupedScreens + near.groups.length;
  const oversized = near.groups.filter((g) => g.screens.length > MAX_IDENTICAL_GROUP);
  const ratio = total === 0 ? 1 : distinctUnits / total;
  const ratioBad = total >= RATIO_MIN_SCREENS && ratio < MIN_DISTINCT_RATIO;

  if (oversized.length > 0 || ratioBad) {
    const lines = [
      `the captured pack is implausibly uniform (B-155 detector) — nothing was written.`,
      `  screens captured: ${total} · distinct images: ${distinctUnits} · ratio: ${ratio.toFixed(4)}`,
      `  limits: max ${MAX_IDENTICAL_GROUP} screens per identical image · min ratio ${MIN_DISTINCT_RATIO} once >= ${RATIO_MIN_SCREENS} screens`,
      `  "identical" here means byte-identical OR within ${MAX_NEAR_DUP_DISTANCE} mean-luma distance (near-duplicate detector)`,
    ];
    if (oversized.length > 0) {
      lines.push(`  groups over the cap (${oversized.length}):`);
      for (const g of oversized) lines.push(`    ${describeNearGroup(g)}`);
    }
    if (ratioBad) {
      lines.push(`  duplicate groups in total: ${near.groups.length}`);
      for (const g of near.groups.slice(0, 10)) lines.push(`    ${describeNearGroup(g)}`);
      if (near.groups.length > 10) lines.push(`    (+${near.groups.length - 10} more groups)`);
    }
    if (near.undecodable.length > 0) {
      lines.push(
        `  NOTE — ${near.undecodable.length} capture(s) could not be decoded, so they were judged on byte identity ALONE: ${near.undecodable.slice(0, 10).join(", ")}`
      );
    }
    lines.push(
      `  B-155: hash navigation once made every route resolve to /dashboard — all 28 baselines were dashboards and the gate was a no-op. Check the nav, the auth state and the settle before promoting.`
    );
    throw new PromoteRefusal(lines.join("\n"));
  }
  return groups;
}

/**
 * GUARD 4 — the diff-clean manifest of what was written.
 * Stable ordering (code-unit sort on screen id, NOT locale-dependent), one
 * screen per line, tab-separated, no timestamps and nothing run-specific: two
 * runs that captured the same pixels must produce byte-identical files, because
 * `diff` between two runs is the reproducibility proof B-409 requires.
 *
 * v2 adds the WxH column. v1 carried sha256 + bytes only, so a run captured at
 * the wrong viewport (a stale --window-size, a deviceScaleFactor, a headed vs
 * headless default) diffed as "every one of the 99 sha256s changed" with no
 * clue why — the operator's next move is then to re-run and stare, when the
 * answer is one token per line. The dimensions are already known per record
 * (IHDR, read at stage time), so this costs nothing and is as diff-clean as the
 * rest of the row.
 */
export function renderPromoteManifest(records: StagedRecord[]): string {
  const rows = [...records].sort((a, b) => (a.screen < b.screen ? -1 : a.screen > b.screen ? 1 : 0));
  const lines = [
    "# juneflow visual gate — promoted app-baseline manifest v2",
    "# sha256\tbytes\tWxH\tscreen\troute\tref",
    ...rows.map((r) =>
      [r.sha256, String(r.bytes), `${r.width}x${r.height}`, r.screen, r.route, r.ref].join("\t")
    ),
  ];
  return lines.join("\n") + "\n";
}

// ---- GUARD 2b — the operator-supplied OUTPUT paths ---------------------------
//
// MEASURED HOLE (adversarial verify of this module, 2026-08-17). GUARD 2 spends
// its whole length proving that an IMAGE write cannot leave app-baseline/ —
// realpath, no "..", no absolute, no symlink, and it never mints a file that
// does not already exist. The three ARTIFACT paths in PromoteSessionOptions had
// no check at all, and one of them is operator-settable from the command line
// (`VISUAL_PROMOTE_MANIFEST`). Measured, in that order:
//
//   A. VISUAL_PROMOTE_MANIFEST=<pack>/app-baseline/run-1.txt
//      -> app-baseline/ afterwards contained [alpha.png, run-1.txt].
//      The promote MINTED a file inside the pack through the artifact path,
//      which is exactly what the image path exists to refuse. So the README's
//      containment claim was false as written.
//   B. stagingDir === refDir
//      -> the old test was `resolve(stagingDir).startsWith(resolve(refDir) + sep)`,
//      and a directory is not a strict prefix of ITSELF, so this passed. The
//      next statement is rmSync(stagingDir, {recursive:true, force:true}):
//      measured, reference/app-baseline/ and its baseline were GONE. A typo in
//      one path deletes the arbiter of design fidelity.
//   C. stagingDir = <link>/staging, where <link> -> reference/
//      -> resolve() cannot see a symlink, so this passed too, and a real
//      staging/ directory was created inside reference/.
//
// So the artifact paths get the containment reasoning the image writes already
// had, and they get it on the REALPATH of the deepest existing ancestor — the
// leaf usually does not exist yet (a manifest is a new file), so realpathSync()
// on the path itself would throw and prove nothing.
//
// REFUSED, NEVER RELOCATED: quietly rewriting the path to a safe one would hand
// the operator a run-1.txt somewhere they did not ask for, and the two-run diff
// (README § "เงื่อนไข 2 รอบ") is only evidence if it is the file they think it is.

/**
 * Absolute path of `p` with its EXISTING prefix realpath-resolved. Walks up to
 * the deepest ancestor that exists, resolves that, and re-appends the rest, so
 * a not-yet-created leaf still gets judged on where it would actually land.
 */
export function realpathOfDeepestExisting(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  // Bounded by path depth: each miss pops exactly one segment, and dirname()
  // of the filesystem root is the root itself, which ends the loop.
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Refuses an operator-supplied output path that lands inside the reference pack
 * — including the pack root ITSELF, and including anything reached through a
 * symlinked ancestor. Returns the resolved path so callers can report it.
 */
/**
 * The (device, inode) pair identifying a filesystem entry, or null when the path
 * cannot be stat'ed. Two paths with the same pair ARE the same directory no matter
 * how they were spelled — which is the question `assertArtifactOutsidePack` has to
 * answer on a case-insensitive filesystem, where string comparison answers a
 * different one and answers it wrong.
 */
function statIdOf(target: string): { dev: number; ino: number } | null {
  try {
    const st = statSync(target);
    return { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

export function assertArtifactOutsidePack(label: string, p: string, refDir: string): string {
  const real = realpathOfDeepestExisting(p);
  const packReal = realpathOfDeepestExisting(refDir);
  // Decide by FILESYSTEM IDENTITY, not by string. Measured on this checkout:
  // realpathSync preserves the case the caller TYPED while the filesystem is
  // case-insensitive, so `<root>/REFERENCE/app-baseline/x.png` compared as
  // OUTSIDE and the kernel wrote it INSIDE — overwriting an approved baseline
  // with manifest text, reported as success. A string prefix answers a question
  // about spelling; the guard needs the one the kernel will answer.
  //
  // Walk the artifact's existing ancestors and compare (dev, ino) with the pack.
  // Same inode = same directory however it was spelled, symlinked or cased.
  // The string test is KEPT as a second, independent reason to refuse: it catches
  // the case where an ancestor does not exist yet (nothing to stat), and two
  // independent refusals are what this guard is for. Polarity is refuse-if-inside
  // on both, so an undecidable case refuses via `sameEntry` returning false only
  // when it genuinely could not match — see the explicit unstattable branch.
  const packId = statIdOf(packReal);
  for (let dir: string = real; ; dir = dirname(dir)) {
    const id = statIdOf(dir);
    if (packId && id && id.dev === packId.dev && id.ino === packId.ino) {
      throw new PromoteRefusal(
        `${label} "${p}" resolves to ${real}, inside the reference pack ${packReal} — ` +
          `its ancestor ${dir} is that pack by device+inode, whatever the spelling says. ` +
          `Artifacts (manifest · evidence · staging) belong outside the pack, e.g. under .results/. ` +
          `This path is refused, not relocated.`
      );
    }
    const parent = dirname(dir);
    if (parent === dir) break;
  }
  if ((real + sep).startsWith(packReal + sep)) {
    throw new PromoteRefusal(
      `${label} "${p}" resolves to ${real}, inside the reference pack ${packReal} — ` +
        `the ONLY thing a promote may write inside the pack is the .png files the manifest already ` +
        `declares under ${BASELINE_DIR}/, and those it overwrites, never mints. Artifacts ` +
        `(manifest · evidence · staging) belong outside the pack, e.g. under .results/. ` +
        `This path is refused, not relocated — a promote never writes somewhere other than where you pointed it.`
    );
  }
  return real;
}

/**
 * An artifact path that already exists as a directory (or anything else that is
 * not a regular file) would throw EISDIR at writeFileSync — and the manifest is
 * written AFTER the pack has been overwritten, so the operator would be left
 * with a rewritten arbiter, no manifest to diff, and a stack trace instead of a
 * refusal. Cheap to detect before the first screenshot; expensive to discover
 * at the end.
 */
function assertPlainFilePath(label: string, p: string): void {
  const target = resolve(p);
  // Walk to the deepest thing that exists on the way to the target. If that IS
  // the target it must be a regular file (writeFileSync would throw EISDIR on a
  // directory); if it is an ancestor it must be a directory (commit() does
  // mkdirSync(recursive) first, which throws ENOTDIR when an ancestor is a
  // file). Both failures land at commit time — i.e. after the pack has already
  // been overwritten — so both are decided here, before the first screenshot.
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return; // nothing on the path exists; nothing to judge
    existing = parent;
  }
  const st = statSync(existing);
  if (existing === target ? st.isFile() : st.isDirectory()) return;
  throw new PromoteRefusal(
    existing === target
      ? `${label} "${p}" already exists and is not a regular file — the write would fail only AFTER ` +
        `the pack had been overwritten, leaving a re-baselined pack with no manifest to diff`
      : `${label} "${p}" cannot be created: ${existing} is not a directory — the write would fail only ` +
        `AFTER the pack had been overwritten, leaving a re-baselined pack with no manifest to diff`
  );
}

// ---- GUARD 0 — the auth pre-flight ------------------------------------------

export interface AuthPreflightOptions {
  /** VISUAL_STORAGE_STATE — the Playwright storageState the run will use. */
  storageStatePath?: string;
  /** VISUAL_BASE_URL — the SAME origin the browser will be pointed at. */
  baseURL: string;
  /** Contract server path (openapi.yaml `servers`). */
  apiBasePath?: string;
  /** When set, /me must come back as exactly this user. */
  expectUser?: string;
  timeoutMs?: number;
  // Deliberately NO fetch-injection hook. The discrimination tests drive this
  // against a real http server over a real socket instead, so nothing can stand
  // in for the call being verified — a suite that injects a double for the thing
  // it claims to test proves only the double.
}

export interface AuthPreflightResult {
  origin: string;
  tokenChars: number;
  user: string;
}

/**
 * GUARD 0 — prove the session is authenticated ONCE, before screen 0.
 *
 * WHY THIS IS THE CHEAPEST GUARD IN THE MODULE. Every per-screen check in
 * captureProblems() fires 99 times and, on the unauthenticated path, fires for
 * the first time on screen 0 anyway — but only after the stack is up, the
 * browser is launched, and the run has committed to capturing. Worse, a token
 * that expires DURING a run is discovered on screen 73, and the whole run is
 * wasted either way because commit() is all-or-nothing. Asking the API one
 * question first costs one HTTP round trip and turns a 99-screen waste into an
 * immediate, readable refusal.
 *
 * It deliberately goes through `baseURL` — the same origin the browser uses —
 * not straight at the API container. That makes it also exercise the dev-server
 * /api proxy, which has a measured history in this repo of silently answering
 * every API call with index.html and HTTP 200 (an experiment once "proved" a
 * stale pack when in fact no API call had ever succeeded). An HTML body here is
 * therefore a refusal with its own message, not a confusing JSON parse crash.
 */
export async function assertAuthenticatedSession(
  opts: AuthPreflightOptions
): Promise<AuthPreflightResult> {
  const statePath = String(opts.storageStatePath ?? "").trim();
  if (!statePath) {
    throw new PromoteRefusal(
      "VISUAL_STORAGE_STATE is not set — the run would capture 99 screens with NO bearer token. " +
        "apps/web's router is not auth-gated, so those shots would look routed and plausible while every " +
        "body is an unauthenticated empty state, and promoting them would make that the definition of correct."
    );
  }
  if (!existsSync(statePath)) {
    throw new PromoteRefusal(`VISUAL_STORAGE_STATE points at a file that does not exist: ${statePath}`);
  }

  let state: { origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }> };
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (e) {
    throw new PromoteRefusal(`VISUAL_STORAGE_STATE is not readable JSON (${statePath}): ${(e as Error).message}`);
  }

  let token = "";
  let tokenOrigin = "";
  for (const o of state.origins ?? []) {
    for (const kv of o.localStorage ?? []) {
      if (kv?.name === AUTH_TOKEN_KEY && String(kv.value ?? "").trim() !== "") {
        token = String(kv.value);
        tokenOrigin = String(o.origin ?? "");
      }
    }
  }
  if (!token) {
    const seen = (state.origins ?? [])
      .map((o) => `${o.origin ?? "?"}[${(o.localStorage ?? []).map((k) => k?.name ?? "?").join(",") || "empty"}]`)
      .join(" ");
    throw new PromoteRefusal(
      `no "${AUTH_TOKEN_KEY}" localStorage entry in ${statePath} — the storageState carries no bearer token. ` +
        `Origins present: ${seen || "(none)"}. Re-run the login step that mints the state.`
    );
  }

  const base = opts.baseURL.replace(/\/+$/, "");
  const url = `${base}${opts.apiBasePath ?? "/api/v1"}/me`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new PromoteRefusal(
      `the API did not answer the pre-flight at ${url}: ${(e as Error).message} — ` +
        `bring the stack up (and check the /api proxy) before promoting.`
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    throw new PromoteRefusal(
      `GET ${url} answered HTTP ${res.status} with the storageState token — the session is EXPIRED or INVALID. ` +
        `Every screen would still render (the router is not auth-gated) with an empty/error body. ` +
        `Re-mint VISUAL_STORAGE_STATE. Body: ${body.slice(0, 200)}`
    );
  }
  if (!res.ok) {
    throw new PromoteRefusal(`GET ${url} answered HTTP ${res.status} — the API is not healthy. Body: ${body.slice(0, 200)}`);
  }

  let parsed: { user?: { email?: string; name?: string; id?: string } };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PromoteRefusal(
      `GET ${url} answered HTTP ${res.status} but the body is not JSON — the /api proxy is almost certainly ` +
        `serving index.html for API paths, so every request the app makes would "succeed" with HTML. ` +
        `First 120 chars: ${body.slice(0, 120).replace(/\s+/g, " ")}`
    );
  }
  const who = String(parsed?.user?.email ?? "").trim();
  if (!who) {
    throw new PromoteRefusal(
      `GET ${url} answered 200 but carried no user.email — the pre-flight cannot confirm WHO the session is. ` +
        `Body: ${body.slice(0, 200)}`
    );
  }
  const expect = String(opts.expectUser ?? "").trim();
  if (expect && who.toLowerCase() !== expect.toLowerCase()) {
    throw new PromoteRefusal(
      `the session authenticates as "${who}" but the run expects "${expect}" — a pack captured as the wrong ` +
        `user has the wrong menus and the wrong permissions baked into it.`
    );
  }
  return { origin: tokenOrigin, tokenChars: token.length, user: who };
}

/**
 * The pre-flight as the RUN calls it: a no-op when promote is off, a refusal
 * when the session is not authenticated. Lives here rather than inline in the
 * spec's beforeAll so the decision "does this run need an authenticated
 * session, and is it?" is itself testable — an inline beforeAll body is a seam
 * no unit test can reach without a live stack.
 */
export async function promoteAuthPreflight(
  session: object | null,
  opts: AuthPreflightOptions
): Promise<AuthPreflightResult | null> {
  if (!session) return null;
  return assertAuthenticatedSession(opts);
}

export interface PromoteSessionOptions {
  /** tests/visual/reference — the pack root. */
  refDir: string;
  /** Where captures are staged. MUST NOT be inside refDir. */
  stagingDir: string;
  /** Diff-clean manifest output path (the reproducibility artifact). */
  manifestPath: string;
  /** Optional diagnostic JSON (may contain run-specific noise). */
  evidencePath?: string;
  log?: (msg: string) => void;
}

export interface CommitSummary {
  promoted: number;
  manifestPath: string;
  duplicateGroups: DuplicateGroup[];
  records: StagedRecord[];
}

/**
 * One promote run. Constructed ONLY through openPromoteSession(), which is the
 * single place the opt-in env var is read.
 */
export class PromoteSession {
  readonly targets: PlannedTarget[];
  private readonly byScreen: Map<string, PlannedTarget>;
  private readonly staged = new Map<string, StagedRecord>();
  private readonly evidence: Array<Record<string, unknown>> = [];
  private readonly opts: PromoteSessionOptions;
  private readonly log: (msg: string) => void;
  private committed = false;

  constructor(rows: PromoteRow[], opts: PromoteSessionOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((m) => console.log(m));
    // GUARD 2b, FIRST — before anything is deleted, created or written.
    // stagingDir leads because the third statement below rmSync()s it
    // recursively: stagingDir === refDir measurably deleted the whole pack.
    assertArtifactOutsidePack("stagingDir", opts.stagingDir, opts.refDir);
    assertArtifactOutsidePack("manifestPath", opts.manifestPath, opts.refDir);
    assertPlainFilePath("manifestPath", opts.manifestPath);
    if (opts.evidencePath !== undefined) {
      assertArtifactOutsidePack("evidencePath", opts.evidencePath, opts.refDir);
      assertPlainFilePath("evidencePath", opts.evidencePath);
    }
    // Preflight: refuse the WHOLE run before a single screenshot is taken.
    this.targets = planPromotion(rows, opts.refDir);
    this.byScreen = new Map(this.targets.map((t) => [t.screen, t]));
    rmSync(opts.stagingDir, { recursive: true, force: true });
    mkdirSync(opts.stagingDir, { recursive: true });
  }

  /** GUARD 5 + staging. Throws (fails that screen's test) on any problem. */
  stage(row: PromoteRow, png: Buffer, evidence: CaptureEvidence): StagedRecord {
    const target = this.byScreen.get(row.screen);
    if (!target) {
      throw new PromoteRefusal(`${row.screen} is not a planned target — promote writes only what the manifest already declares`);
    }
    if (this.staged.has(row.screen)) {
      throw new PromoteRefusal(`${row.screen} was staged twice in one run`);
    }
    const problems = captureProblems(target, png, evidence);
    this.evidence.push({
      screen: row.screen,
      route: row.route,
      ref: target.ref,
      bytes: png?.length ?? 0,
      landedUrl: evidence.landedUrl,
      status: evidence.status,
      bodyChars: evidence.bodyChars ?? null,
      placeholder: evidence.placeholder ?? null,
      authTokenPresent: evidence.authTokenPresent ?? null,
      apiRequests: evidence.apiRequests ?? null,
      apiUnauthorized: evidence.apiUnauthorized ?? null,
      pageErrors: evidence.pageErrors,
      consoleErrors: evidence.consoleErrors,
      problems,
    });
    this.writeEvidence();
    if (problems.length > 0) {
      throw new PromoteRefusal(`${row.screen} (${row.route}) did not capture cleanly:\n  - ${problems.join("\n  - ")}`);
    }
    const dims = readPngSize(png)!;
    const stagedPath = join(this.opts.stagingDir, basename(target.ref));
    writeFileSync(stagedPath, png);
    const record: StagedRecord = {
      screen: row.screen,
      route: row.route,
      ref: target.ref,
      bytes: png.length,
      sha256: sha256(png),
      width: dims.width,
      height: dims.height,
      stagedPath,
      // Decoded here, one screen at a time, so the O(n) decode cost (measured
      // ~40 ms per 1600x1000 frame) is spread across the run instead of landing
      // as a 4 s stall inside commit().
      signature: imageSignature(png),
    };
    this.staged.set(row.screen, record);
    return record;
  }

  stagedRecords(): StagedRecord[] {
    return [...this.staged.values()];
  }

  private writeEvidence(): void {
    if (!this.opts.evidencePath) return;
    mkdirSync(resolve(this.opts.evidencePath, ".."), { recursive: true });
    writeFileSync(
      this.opts.evidencePath,
      JSON.stringify({ planned: this.targets.length, staged: this.staged.size, screens: this.evidence }, null, 2)
    );
  }

  /**
   * The only code path in this repo that writes tests/visual/reference/.
   * All-or-nothing: every planned target must be staged and every guard must
   * pass, or nothing is written at all. A pack that is half new captures and
   * half leftovers from an older stack is unreproducible by construction —
   * which is the B-323 problem this whole exercise exists to stop re-burying.
   */
  commit(): CommitSummary {
    if (this.committed) throw new PromoteRefusal("commit() called twice in one run");
    const records = this.stagedRecords();

    // Defense in depth: re-validate the targets. Something may have moved or
    // been deleted while the run was capturing.
    planPromotion(this.targets, this.opts.refDir);

    const missing = this.targets.filter((t) => !this.staged.has(t.screen));
    if (missing.length > 0) {
      const names = missing.slice(0, 20).map((m) => `${m.screen} (${m.route})`).join(", ");
      const more = missing.length > 20 ? ` (+${missing.length - 20} more)` : "";
      throw new PromoteRefusal(
        `${missing.length} of ${this.targets.length} screens did not stage — nothing was written. Missing: ${names}${more}\n` +
          `  A partial promote mixes captures from two stacks into one pack; fix the failing screens and re-run the whole promote.`
      );
    }

    const groups = assertPlausiblyDistinct(records);

    // Write. Temp file + rename inside the SAME directory so a reader never
    // sees a half-written PNG.
    let written = 0;
    for (const r of records) {
      const target = this.byScreen.get(r.screen)!.absRef;
      const tmp = `${target}.promote-tmp`;
      try {
        writeFileSync(tmp, readFileSync(r.stagedPath));
        renameSync(tmp, target);
        written += 1;
      } catch (e) {
        try {
          if (existsSync(tmp)) unlinkSync(tmp);
        } catch {
          /* best effort */
        }
        throw new PromoteRefusal(
          `write failed on ${r.screen} after ${written} file(s) were already replaced — the pack is now MIXED and must be restored from git before re-running: ${(e as Error).message}`
        );
      }
    }

    mkdirSync(resolve(this.opts.manifestPath, ".."), { recursive: true });
    writeFileSync(this.opts.manifestPath, renderPromoteManifest(records));
    this.writeEvidence();
    this.committed = true;

    // Not a refusal (a manifest row may legitimately be a shell-only screen),
    // but a re-baseline that quietly enshrines "กำลังพัฒนา" as the approved
    // look of a screen deserves to be said out loud.
    const placeholders = this.evidence.filter((e) => e.placeholder === true).map((e) => e.screen);
    if (placeholders.length > 0) {
      this.log(`  WARNING — ${placeholders.length} promoted screen(s) rendered the "not ported yet" placeholder: ${placeholders.join(", ")}`);
    }

    // The advisory band: too close to ignore, too far to refuse without costing
    // measured false positives (35 of 4851 real pairs at
    // NEAR_DUP_ADVISORY_DISTANCE). Named here so a human judges them — this is
    // where a placeholder pair that differs only by title + active sidebar row
    // lands, and where a broken nav that this metric cannot separate from a
    // genuinely similar screen would show up.
    const near = nearDuplicateReport(records);
    if (near.advisory.length > 0) {
      this.log(
        `  ADVISORY — ${near.advisory.length} pair(s) within ${NEAR_DUP_ADVISORY_DISTANCE} mean-luma distance (NOT a refusal; judge them):`
      );
      for (const p of near.advisory.slice(0, 10)) {
        this.log(`    ${p.screens[0]} ~ ${p.screens[1]} · distance ${p.distance.toFixed(4)}`);
      }
      if (near.advisory.length > 10) this.log(`    (+${near.advisory.length - 10} more pairs)`);
    }
    if (near.undecodable.length > 0) {
      this.log(
        `  WARNING — ${near.undecodable.length} capture(s) could not be decoded for the near-duplicate check and were judged on byte identity ALONE: ${near.undecodable.join(", ")}`
      );
    }
    const consoleNoise = this.evidence.reduce(
      (n, e) => n + ((e.consoleErrors as string[] | undefined)?.length ?? 0),
      0
    );
    if (consoleNoise > 0) {
      this.log(
        `  NOTE — ${consoleNoise} console error(s) were recorded across the pack and did NOT match the refusal signature; they are in the evidence JSON.`
      );
    }

    this.log(
      `\nPROMOTE COMMITTED — ${written} baseline(s) overwritten under ${BASELINE_DIR}/\n` +
        `  manifest: ${this.opts.manifestPath}\n` +
        `  distinct images: ${new Set(records.map((r) => r.sha256)).size} of ${records.length}` +
        (groups.length > 0 ? ` · identical pairs allowed: ${groups.map(describeGroup).join(" | ")}` : "") +
        `\n  Run the promote a SECOND time on a fresh stack and diff the two manifests: a non-empty diff means the capture is not reproducible (B-323) and the pack must NOT be trusted.\n`
    );
    return { promoted: written, manifestPath: this.opts.manifestPath, duplicateGroups: groups, records };
  }
}

/**
 * GUARD 1 — the single opt-in decision point. Returns null (and touches
 * nothing) unless VISUAL_PROMOTE_BASELINE is explicitly set, so a normal gate
 * run is byte-identical to what it was before promote mode existed.
 */
export function openPromoteSession(
  env: NodeJS.ProcessEnv,
  rows: PromoteRow[],
  opts: PromoteSessionOptions
): PromoteSession | null {
  if (!isPromoteMode(env)) return null;
  if (String(env.CI ?? "").trim() !== "") {
    // A re-baseline is a deliberate, Wei-approved, local act (B-409 / B-322).
    // CI silently rewriting the arbiter of design fidelity is the one way this
    // mechanism could do more damage than the bug it fixes.
    throw new PromoteRefusal(`${PROMOTE_ENV} is set but CI=${env.CI} — a re-baseline is never promoted from CI`);
  }
  const log = opts.log ?? ((m: string) => console.log(m));
  const line = "=".repeat(78);
  log(
    `\n${line}\nVISUAL GATE — PROMOTE MODE (${PROMOTE_ENV}=${env[PROMOTE_ENV]})\n` +
      `  This run does NOT compare. It will OVERWRITE ${rows.length} reference baseline(s)\n` +
      `  under ${join(opts.refDir, BASELINE_DIR)} — the arbiter of design fidelity (PLAN.md §0).\n` +
      `  References are written only at the very end, only if every guard passes,\n` +
      `  and only over files the manifest already declares.\n${line}\n`
  );
  return new PromoteSession(rows, opts);
}
