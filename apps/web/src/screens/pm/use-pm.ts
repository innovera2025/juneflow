/*
 * Data hooks for the PM module — the tenant's PM asset registry (pm.assets), the
 * read-only PM work-order list (pm.dashboard, B-108d), and the PM contract list
 * (pm.schedule, B-108a).
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md section 5,
 * apps/web/CLAUDE.md). The prototype held its data in the local PM_ASSETS_BY_TYPE
 * arrays (pm.jsx L7-37); here the server is the system of record:
 *   GET  /pm/assets      -> the tenant PM assets (B-014 paginated envelope `.data`).
 *   POST /pm/assets      -> register a new asset under a PM contract.
 *   GET  /pm/workorders  -> the tenant PM work orders (read-only; the dashboard's
 *                           checklist-compliance derivation, B-108d).
 *   GET  /pm/contracts   -> the tenant PM contracts (read-only; the schedule's
 *                           web-side derivation, B-108a).
 * The create mutation invalidates the assets list so the new state appears.
 *
 * WIRE STATE (updated — the pre-0034 gaps are now closed on dev): assetWire carries
 * { id, contract_id, code, name, kind, site, cycle, next_due } — `code` + `name`
 * gained real columns in migration 0034 (B-110), so they now ride the wire (the
 * pm.assets list/detail still render an em-dash for them pending its re-port; the
 * pm.dashboard consumes them live). GET /pm/contracts is LIVE (registered Wave-2,
 * B-108) and is now consumed by usePmContractList (pm.schedule, B-108a) — no longer a
 * gated source. (The pm.assets create form still collects the contract id as raw text
 * pending its own re-port.)
 *
 * CREATE PATH. POST /pm/assets REQUIRES `contract_id` (400 otherwise) and resolves
 * it THROUGH the tenant scope (a foreign/absent id -> 404, apps/api/src/routes/pm.ts).
 * `kind` is also required; `site` / `cycle` / `next_due` are optional. The server
 * owns `id`; `name`/`code` are not sent by the current form (its re-port is pending).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types the /pm/assets rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key (list + invalidation). */
const PM_ASSETS_KEY = ["pm", "assets"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** Read a string field off an opaque row; "" when absent (mirrors toWoRaw's str). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** GET /pm/assets — the tenant PM assets for the table (B-014 envelope `data`). */
export function usePmAssetList() {
  return useQuery<Row[]>({
    queryKey: PM_ASSETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/assets"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The POST /pm/assets body (opaque Entity, so index-signed). `contract_id` +
 *  `kind` are required by the handler; the rest are optional real columns. */
export interface CreatePmAssetBody {
  [key: string]: unknown;
  contract_id: string;
  kind: string;
  site?: string;
  cycle?: string;
  next_due?: string;
}

/**
 * POST /pm/assets — register an asset under a PM contract. The server owns the id;
 * the asset is anchored on the contract's tenant-owned project (fail-closed).
 * Invalidates the asset catalogue on success.
 */
export function useCreatePmAsset(): UseMutationResult<
  Entity,
  unknown,
  CreatePmAssetBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePmAssetBody) =>
      unwrap(apiClient.POST("/pm/assets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_ASSETS_KEY }),
  });
}

/** Shared cache key for the PM work-order list (read-only). */
const PM_WORKORDERS_KEY = ["pm", "workorders"] as const;

/**
 * GET /pm/workorders — the tenant PM work orders, READ-ONLY for the dashboard's
 * checklist-compliance derivation (B-108d; B-014 envelope `data`). Mirrors
 * usePmAssetList: opaque Entity rows (the contract types /pm/workorders rows as
 * Entity), narrowed in pm-dashboard-rows.ts. No mutation is wired here (read-only).
 */
export function useWorkOrderList() {
  return useQuery<Row[]>({
    queryKey: PM_WORKORDERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/workorders"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The POST /pm/workorders body (opaque Entity, index-signed). `asset_id` is
 *  required by the handler; `tech` is the one other real stored column the create
 *  form collects (type/date have no column — dropped, not fabricated). */
export interface CreateWorkorderBody {
  [key: string]: unknown;
  asset_id: string;
  tech?: string;
}

/**
 * POST /pm/workorders — open a work order on an asset (pm3.jsx PMWOForm). The server
 * owns the id; with no template the checklist snapshot starts empty (honest — the
 * mock's `open` WO also starts empty). Invalidates the WO list on success.
 */
export function useCreateWorkorder(): UseMutationResult<
  Entity,
  unknown,
  CreateWorkorderBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkorderBody) =>
      unwrap(apiClient.POST("/pm/workorders", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Check-in args — the WO id plus a REAL captured GPS fix ("lat,lng"). */
export interface CheckinArgs {
  id: string;
  gps: string;
}

/**
 * POST /pm/workorders/{id}/checkin {gps} — the tech records their on-site GPS fix
 * (pm3.jsx check-in action). The gps is captured live from the browser (DEFAULT 2,
 * never fabricated). Invalidates the WO list so the checked-in state appears.
 */
export function useCheckinWorkorder(): UseMutationResult<unknown, unknown, CheckinArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, gps }: CheckinArgs) =>
      unwrap(apiClient.POST("/pm/workorders/{id}/checkin", { params: { path: { id } }, body: { gps } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Update-checklist args — the WO id plus the FULL positional item list. Each line
 *  carries its result; `label` is OPTIONAL and only sent when a NEW item is appended
 *  (the checklist-template picker, B-117): the server's positional merge preserves the
 *  captured label for existing rows (pm.ts mergeChecklistRow uses `existing?.label`),
 *  but a freshly appended row has no snapshot to fall back on, so its label must ride
 *  the body. The generated PUT body types items as {result?,before?,after?}; the extra
 *  `label` is carried through by assignability (the WO detail sends a typed variable,
 *  not a fresh literal) and read server-side by mergeChecklistRow. */
export interface UpdateChecklistArgs {
  id: string;
  items: { result: string; label?: string }[];
}

/**
 * PUT /pm/workorders/{id}/checklist {items} — autosave the checklist results
 * (DEFAULT 3: no explicit Save button; each tap persists) AND append picked template
 * items (B-117: new rows carry a label). The body carries the full item list
 * positionally (result "" for an unfilled line -> the server omits it, preserving the
 * captured label). Invalidates the WO list on success.
 */
export function useUpdateChecklist(): UseMutationResult<unknown, unknown, UpdateChecklistArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: UpdateChecklistArgs) =>
      unwrap(apiClient.PUT("/pm/workorders/{id}/checklist", { params: { path: { id } }, body: { items } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/* ===========================================================================
 * customer_sign — the stroke-JSON wire encoding (BLOCKERS.md B-331)
 * ===========================================================================
 * Wei ruled the encoding on 2026-08-07: an array of stroke point-lists, chosen so it
 * stays independent of the upload subsystem and re-renders on web and mobile alike
 * from the same stored value. The Dart half of this contract is
 * apps/mobile/lib/screens/pm_close/signature_ink.dart — the two MUST agree, so the
 * shape and the rounding are restated here rather than left to be inferred.
 *
 *   {"v":1,"w":300,"h":110,"s":[[[12,40.5],[13,41.2]],[[80,44]]]}
 *
 *   v  schema version · w/h capture viewport in CSS px · s strokes of [x,y] points
 *
 * `w`/`h` are load-bearing: without them the points are unitless and could not be
 * re-rendered at any other size. `v` is load-bearing because `customer_sign` is a
 * bare `text` column with no migration path, so a later shape change would otherwise
 * be undetectable in stored data.
 *
 * NOT stored, deliberately: pressure (the Pointer Events spec reports a constant 0.5
 * on non-force-sensing digitizers), per-point timing (only BIOMETRIC verification
 * needs it, nothing here verifies a signature, and storing it would turn an inert
 * mark into PDPA-sensitive behavioural data with no consent surface), stroke
 * width/colour (render-side — storing it would freeze today's theme into permanent
 * data), and the signer's name (contractWire stops at customer_id, so it would be
 * fabricated).
 */

/** Current stroke-JSON schema version. */
export const SIGNATURE_INK_VERSION = 1;

/**
 * Hard ceiling on the points ONE signature may carry — the same value as
 * `kSignatureMaxPoints` in the Dart encoder, because the two write the same column.
 *
 * Not a style limit, a body-size guarantee: apps/api/src/app.ts constructs Fastify
 * with no `bodyLimit`, so the only bound on this write is Fastify's 1 MiB default,
 * while the column itself is `text` (~1 GB). At ~14 bytes per encoded point this cap
 * is ~140 KB — far under that limit and far over any real signature (a 10-second
 * capture at 60 Hz is ~600 points before sub-pixel thinning). Points past the cap are
 * IGNORED, so what is stored is always a real PREFIX of what was drawn, never a hole
 * in the middle of a stroke.
 */
export const SIGNATURE_MAX_POINTS = 10_000;

/**
 * Minimum CSS-px distance between two consecutive points of one stroke — the same
 * 1.0 px `kSignatureMinPointGap` the Dart pad thins at, so the two clients produce
 * comparable point densities for the same gesture.
 *
 * THIS IS NOT THE GUARD, and reading it as one was the defect B-357/F2 records. It
 * filters ADJACENT samples for size (a nearly-still finger emits many sub-pixel
 * samples that add bytes and change no geometry); it says nothing about how far the
 * mark travelled. That is `SIGNATURE_MIN_STROKE_SPAN`.
 */
export const SIGNATURE_MIN_POINT_GAP = 1;

/**
 * Minimum SPAN — bounding-box diagonal in CSS px — that ONE stroke must cover before
 * the ink counts as a signature. Same value and same rule as `kSignatureMinStrokeSpan`
 * in the Dart encoder, because the two write the same column.
 *
 * WHY A SPAN AND NOT A POINT COUNT (B-357/F2). The rule used to be "a stroke with 2+
 * points", and both clients thin sub-pixel samples at 1 px — so the smallest accepted
 * signature was a ONE-PIXEL DRAG, while the rule was documented as stopping "an
 * accidental brush against the pad". It did not. Distance travelled is the property
 * the rule was always about, so it is now the property measured.
 *
 * WHY 8 and not a gesture slop (Flutter's `kTouchSlop` is 18 px): a slop classifies a
 * GESTURE, and borrowing it here would refuse a legitimately small INTENTIONAL mark —
 * a tick, one initial, the short final stroke of a name. 8 px is well clear of pointer
 * jitter (sub-pixel to a few px, and it stays in place rather than travelling) and
 * well under anything a person means to draw.
 *
 * MEASURED PER STROKE, never over the whole pad, so two unrelated accidents — a 1 px
 * twitch here and a stray dot 200 px away — cannot add up to a signature between them.
 *
 * WHAT IT STILL DOES NOT STOP, stated because the previous comment overclaimed: a hand
 * dragged across the pad, or a deliberate scribble. Both travel far more than 8 px and
 * are geometrically identical to a small mark. The guard makes a still or twitching
 * contact insufficient; it cannot make consent verifiable.
 */
export const SIGNATURE_MIN_STROKE_SPAN = 8;

/** One captured point, in the capture viewport's own coordinate space. */
export interface SignaturePoint {
  x: number;
  y: number;
}

/** A whole captured signature plus the viewport it was drawn in. */
export interface SignatureInk {
  width: number;
  height: number;
  strokes: SignaturePoint[][];
}

/** Round to one decimal place — the stored precision, matched to the Dart encoder. */
function roundCoord(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Whether ONE stroke travelled far enough to be a signature stroke.
 *
 * The measure is the bounding-box DIAGONAL, not the summed path length: a finger
 * resting on the pad emits a long jittering path inside a few px, and path length
 * would read that as a mark. A diagonal asks "how far did this get from itself",
 * which is what "it travelled" means.
 *
 * NON-FINITE POINTS ARE IGNORED, matching [encodeSignatureInk], which drops them
 * before writing — counting them here would let a stroke qualify on coordinates that
 * never reach the wire. Compared squared: no square root on a 60 Hz path.
 */
function isSignatureStroke(stroke: SignaturePoint[]): boolean {
  let minX: number | null = null;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const p of stroke) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (minX === null) {
      minX = p.x;
      maxX = p.x;
      minY = p.y;
      maxY = p.y;
      continue;
    }
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === null) return false;
  const dx = maxX - minX;
  const dy = maxY - minY;
  return dx * dx + dy * dy >= SIGNATURE_MIN_STROKE_SPAN * SIGNATURE_MIN_STROKE_SPAN;
}

/**
 * Encode captured ink as the string stored in `customer_sign`, or `null` when there
 * is nothing honest to store.
 *
 * Returns null — never an empty-but-present value — for a degenerate viewport, for an
 * empty pad, and for a pad on which NO STROKE TRAVELLED `SIGNATURE_MIN_STROKE_SPAN`
 * px: taps, one-pixel drags and jitter in place all land there. That last case is not
 * fussiness: every reader in the product treats a non-empty `customer_sign` as the
 * customer's consent WITHOUT looking inside (wo-rows.ts deriveStatus L206, mobile
 * pm_jobs_agg, api counts.ts). A stray mark must not close a work order. This is the
 * one choke point for that rule, so no caller can route around it.
 */
export function encodeSignatureInk(ink: SignatureInk): string | null {
  if (!Number.isFinite(ink.width) || !Number.isFinite(ink.height)) return null;
  if (ink.width <= 0 || ink.height <= 0) return null;
  if (!ink.strokes.some(isSignatureStroke)) return null;

  const s: number[][][] = [];
  let budget = SIGNATURE_MAX_POINTS;
  for (const stroke of ink.strokes) {
    if (budget <= 0) break;
    const out: number[][] = [];
    for (const p of stroke) {
      if (budget <= 0) break;
      // Never store a non-finite coordinate: JSON.stringify writes it as `null`, and
      // no reader could re-render that.
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      out.push([roundCoord(p.x), roundCoord(p.y)]);
      budget--;
    }
    // A pen-down that produced no usable point is not a stroke.
    if (out.length > 0) s.push(out);
  }
  if (s.length === 0) return null;

  return JSON.stringify({ v: SIGNATURE_INK_VERSION, w: roundCoord(ink.width), h: roundCoord(ink.height), s });
}

/* ===========================================================================
 * The pad's DOM-FREE half — the capture seam (B-357/F1)
 * ===========================================================================
 * WHY THIS LIVES HERE RATHER THAN INSIDE THE PAD COMPONENT. The pad used to own its
 * strokes in refs and hand the modal an ENCODED string through an `onChange` prop.
 * That put the one seam that historically WAS the defect — "a pad that drew and
 * discarded" — entirely inside JSX, where apps/web's node test environment (no canvas,
 * no DOM, and no jsdom in the workspace: see BLOCKERS.md B-358) cannot reach it. The
 * gate proved the point by mutating the wiring to `onChange={() => onChange(null)}`:
 * every stroke silently discarded, the close still fired, 1776 tests still green.
 *
 * So the pad no longer TRANSFORMS anything on its way out. It mutates a plain
 * [SignatureCapture] object that the confirm handler reads directly, and every rule
 * between a pointer event and the wire — rect-to-CSS-px, clamping, thinning, the
 * viewport, stroke assembly, the encode — is a pure function here, pinned in
 * use-pm.signature.test.ts. What is left in JSX is `<SignaturePad capture={…} />`,
 * which carries no callback to sabotage: the gate's mutation no longer type-checks,
 * because there is no `onChange` prop to hand a discarding function to.
 *
 * The Dart pad keeps its own callback shape (SignaturePadState is directly drivable
 * in a widget test — disabling one line there turns 5 screen tests red), so this is a
 * web-side answer to a web-side test-environment limit, not a contract change.
 */

/** The pad's live capture: completed strokes, the stroke in progress, and the
 *  viewport the points were measured in. Plain mutable data — the pad writes it, the
 *  confirm handler reads it, and nothing transforms it in between. */
export interface SignatureCapture {
  /** Capture viewport width in CSS px, 0 before the pad has been touched. */
  width: number;
  /** Capture viewport height in CSS px, 0 before the pad has been touched. */
  height: number;
  /** Completed strokes, in draw order. */
  strokes: SignaturePoint[][];
  /** The stroke being drawn right now, or null between pen-up and the next pen-down. */
  active: SignaturePoint[] | null;
}

/** An empty capture. */
export function createSignatureCapture(): SignatureCapture {
  return { width: 0, height: 0, strokes: [], active: null };
}

/** The part of a DOMRect this seam uses. */
export interface PadRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The part of a React PointerEvent this seam uses — structural, so a test drives it
 *  with a plain object and no DOM is required. `React.PointerEvent<HTMLCanvasElement>`
 *  is assignable to it. */
export interface PadPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  currentTarget: {
    getBoundingClientRect(): PadRect;
    setPointerCapture(pointerId: number): void;
  };
}

/**
 * Adopt a new capture viewport, RESCALING everything already drawn into it (B-357/F6).
 *
 * The defect this closes: one `w`/`h` is recorded and read back at render time, and
 * nothing used to reconcile the two. Sign the first stroke in portrait (360 px wide),
 * the phone rotates while it is handed across, the customer finishes in landscape
 * (780 px) — the encoder then stamped `w: 780` onto points measured in a 360 px space,
 * and every re-render scaled the pre-rotation half against the wrong unit. The round
 * trip was arithmetically perfect and the picture was wrong.
 *
 * The transform is the SAME one the painters use to re-render stored ink — uniform
 * `min` scale plus centring (SignatureInk.fit / SignatureInkPainter) — so the mark
 * that was on the pad before the resize is the mark on it afterwards, just drawn in
 * the new box. A non-uniform stretch would make it a different signature.
 *
 * A degenerate old viewport (nothing captured yet) simply adopts the new one; a
 * degenerate NEW viewport is ignored, because points measured against 0 would be
 * unitless and unrecoverable.
 *
 * The stroke arrays are rewritten IN PLACE rather than replaced. That is load-bearing,
 * not a style choice: this runs from inside [signaturePadMove], which is holding the
 * open stroke, and swapping the array out from under it would leave the rest of that
 * stroke being appended to a detached copy — the mark would simply stop at the
 * rotation.
 */
export function resizeSignatureCapture(c: SignatureCapture, width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  if (c.width === width && c.height === height) return;
  if (c.width <= 0 || c.height <= 0) {
    c.width = width;
    c.height = height;
    return;
  }
  const scale = Math.min(width / c.width, height / c.height);
  const dx = (width - c.width * scale) / 2;
  const dy = (height - c.height * scale) / 2;
  const remap = (s: SignaturePoint[]): void => {
    for (let i = 0; i < s.length; i++) {
      const p = s[i]!;
      s[i] = { x: dx + p.x * scale, y: dy + p.y * scale };
    }
  };
  for (const s of c.strokes) remap(s);
  if (c.active) remap(c.active);
  c.width = width;
  c.height = height;
}

/** Pointer position in CSS px, clamped into the pad.
 *
 *  A pointer that leaves the box mid-stroke keeps reporting (that is the whole point
 *  of the pointer capture taken on pen-down); storing those points would put ink
 *  outside the w×h viewport that DEFINES the stored coordinate space, and any
 *  re-render would then clip it or shrink the whole signature to fit an excursion. */
function padPoint(rect: PadRect, e: PadPointer): SignaturePoint {
  return {
    x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
  };
}

/** Pen down: adopt the box's current size (rescaling anything already drawn) and open
 *  a stroke. The pointer is CAPTURED so a finger that slides off the canvas keeps
 *  delivering moves — without it a stroke ends wherever the edge is. */
export function signaturePadDown(c: SignatureCapture, e: PadPointer): void {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.setPointerCapture(e.pointerId);
  resizeSignatureCapture(c, rect.width, rect.height);
  c.active = [padPoint(rect, e)];
}

/** Pen move: extend the open stroke, thinning sub-pixel samples
 *  (SIGNATURE_MIN_POINT_GAP) that add bytes and change no geometry. No open stroke
 *  means the pointer went down somewhere else, so nothing is recorded. */
export function signaturePadMove(c: SignatureCapture, e: PadPointer): void {
  const stroke = c.active;
  if (!stroke) return;
  const rect = e.currentTarget.getBoundingClientRect();
  // The box can change size DURING a stroke (rotation, a resized window). Rescale
  // first, so the point about to be pushed lands in the same space as the ones
  // already there — B-357/F6.
  resizeSignatureCapture(c, rect.width, rect.height);
  const next = padPoint(rect, e);
  const last = stroke[stroke.length - 1]!;
  if ((next.x - last.x) ** 2 + (next.y - last.y) ** 2 < SIGNATURE_MIN_POINT_GAP ** 2) return;
  stroke.push(next);
}

/** Pen up: the open stroke becomes a completed one. A pen-down that produced no point
 *  is not a stroke. */
export function signaturePadUp(c: SignatureCapture): void {
  const stroke = c.active;
  c.active = null;
  if (stroke && stroke.length > 0) c.strokes.push(stroke);
}

/** The pointer was cancelled (the OS took it, e.g. a system gesture). The in-progress
 *  stroke is DISCARDED rather than completed: the customer did not finish it, and a
 *  half-stroke the pad tore off itself is not a mark they made. */
export function signaturePadCancel(c: SignatureCapture): void {
  c.active = null;
}

/** Drop every stroke. The viewport is kept — it describes the box, not the ink. */
export function clearSignatureCapture(c: SignatureCapture): void {
  c.strokes = [];
  c.active = null;
}

/** Whether anything at all has been drawn (drives the clear affordance only — what
 *  may be SENT is decided by [readSignatureCapture]). */
export function signatureCaptureHasInk(c: SignatureCapture): boolean {
  return c.strokes.some((s) => s.length > 0) || (c.active?.length ?? 0) > 0;
}

/** What is on the pad right now, as the value `customer_sign` would store, or null.
 *
 *  Null covers an empty pad, a taps-only pad and a pad whose marks never travelled
 *  (SIGNATURE_MIN_STROKE_SPAN) — [encodeSignatureInk] is the single place that rule
 *  lives, and this is the only path from the pad to the request. */
export function readSignatureCapture(c: SignatureCapture): string | null {
  return encodeSignatureInk({
    width: c.width,
    height: c.height,
    strokes: c.active ? [...c.strokes, c.active] : c.strokes,
  });
}

/** Close args — the WO id, the REAL maintenance-log columns (cause/fix/advice), and
 *  the customer's signature when one was captured.
 *
 *  `signature` is OPTIONAL, and the optionality is load-bearing: the close endpoint
 *  keys off key PRESENCE, and it stores `str(...).trim() || null`, so a present-but-
 *  blank value would not store a blank — it would store NULL and ERASE a signature
 *  already on the row, reverting a completed work order to open. An empty pad
 *  therefore omits the key entirely (see [postCloseWorkorder]). B-331. */
export interface CloseWorkorderArgs {
  id: string;
  cause: string;
  fix: string;
  advice: string;
  /** Stroke JSON from [encodeSignatureInk], or undefined when the pad is empty. */
  signature?: string;
}

/**
 * The request the close actually makes — exported so a test can assert what goes ON
 * THE WIRE, rather than that a hook was called with something.
 *
 * The `signature` key is added ONLY for a non-blank captured value. That is the
 * empty-pad refusal at the request layer, and it is where it belongs: the server
 * branches on `has(body, "signature")` (apps/api/src/routes/pm.ts L792-794), so an
 * omitted key leaves `customer_sign` untouched while a blank one clears it.
 */
export function postCloseWorkorder({ id, cause, fix, advice, signature }: CloseWorkorderArgs): Promise<unknown> {
  const body: { cause: string; fix: string; advice: string; signature?: string } = { cause, fix, advice };
  if (signature != null && signature.trim() !== "") body.signature = signature;
  return unwrap(apiClient.POST("/pm/workorders/{id}/close", { params: { path: { id } }, body }));
}

/**
 * POST /pm/workorders/{id}/close — close a work order, persisting the real cause/fix/
 * advice maintenance log (pm3.jsx closeWO) AND the customer's signature as stroke JSON
 * (B-331). The server's LINE cert-push is still a no-op stub (B-108b), so nothing here
 * reports a certificate. Invalidates the WO list on success — the signature is what
 * flips the row to "done" (wo-rows.ts deriveStatus), so the list must re-read.
 */
export function useCloseWorkorder(): UseMutationResult<unknown, unknown, CloseWorkorderArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCloseWorkorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Shared cache key for the PM contract list (read-only). */
const PM_CONTRACTS_KEY = ["pm", "contracts"] as const;

/**
 * GET /pm/contracts — the tenant PM contracts, READ-ONLY for the pm.schedule web-side
 * derivation (B-108a; B-014 envelope `data`). Mirrors usePmAssetList: opaque Entity
 * rows (the contract types /pm/contracts rows as Entity), narrowed by the consumer. No
 * mutation is wired here (read-only). This proves the Wave-2 source (B-108) is live —
 * the schedule fetches it alongside /pm/assets (see pm-schedule.tsx DEFAULT 3).
 */
export function usePmContractList() {
  return useQuery<Row[]>({
    queryKey: PM_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** Shared cache key for the PM checklist-template list (read-only). */
const PM_CHECKLIST_TEMPLATES_KEY = ["pm", "checklist-templates"] as const;

/** One checklist item inside a template — only its `label` is consumed (the template
 *  rows carry no result yet; pm.ts templateWire.items = PmChecklistRow[]). */
export interface ChecklistTemplateItem {
  label: string;
}

/** A reusable checklist template as the picker consumes it (GET /pm/checklist-templates
 *  row, narrowed from the opaque Entity wire: pm.ts templateWire = { id, name, kind,
 *  items:[{label}] } — `name` gained a real column in migration 0034, B-110). */
export interface ChecklistTemplate {
  id: string;
  name: string;
  kind: string;
  items: ChecklistTemplateItem[];
}

/** Narrow an opaque /pm/checklist-templates Entity row to a ChecklistTemplate. Accepts
 *  the server's snake/camel shapes for robustness (mirrors toWoRaw); a non-array
 *  `items` yields []; missing fields default to "". */
export function toChecklistTemplate(e: Record<string, unknown>): ChecklistTemplate {
  const raw = Array.isArray(e.items) ? e.items : [];
  const items: ChecklistTemplateItem[] = raw.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return { label: str(o.label) };
  });
  return { id: str(e.id), name: str(e.name), kind: str(e.kind), items };
}

/**
 * GET /pm/checklist-templates — the tenant's reusable checklist template sets
 * (pm-checklist.jsx ChecklistPicker source; B-117). Opaque Entity rows narrowed by the
 * consumer via toChecklistTemplate; read-only (no mutation wired — template CRUD is the
 * deferred manager, B-065/066). checklist_template carries company_id directly, so the
 * server uses the plain company-scoped door.
 */
export function useChecklistTemplateList() {
  return useQuery<Row[]>({
    queryKey: PM_CHECKLIST_TEMPLATES_KEY,
    queryFn: async () =>
      (await unwrap(apiClient.GET("/pm/checklist-templates"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
