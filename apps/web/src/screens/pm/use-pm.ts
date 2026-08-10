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
 * Encode captured ink as the string stored in `customer_sign`, or `null` when there
 * is nothing honest to store.
 *
 * Returns null — never an empty-but-present value — for a degenerate viewport, for an
 * empty pad, and for a pad carrying nothing but TAPS (no stroke with 2+ points). That
 * last case is not fussiness: a single-point stroke is exactly what an accidental
 * click produces, and every reader in the product treats a non-empty `customer_sign`
 * as the customer's consent WITHOUT looking inside (wo-rows.ts deriveStatus L206,
 * mobile pm_jobs_agg, api counts.ts). A stray dot must not close a work order. This is
 * the one choke point for that rule, so no caller can route around it.
 */
export function encodeSignatureInk(ink: SignatureInk): string | null {
  if (!Number.isFinite(ink.width) || !Number.isFinite(ink.height)) return null;
  if (ink.width <= 0 || ink.height <= 0) return null;
  if (!ink.strokes.some((s) => s.length >= 2)) return null;

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
