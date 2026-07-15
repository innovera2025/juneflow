/*
 * Phase/Block/Unit-grid helpers for MasterProject (P1-WEB-09) — pure, i18n-free
 * logic ported 1:1 from pototype/master.jsx MasterProject (L311-420).
 *
 * The prototype held the block list in local state (BLOCK_SEED, master.jsx:240) and
 * derived each unit cell's status from the block's sold/built COUNTS with a fixed
 * threshold (master.jsx:382-385). Here the block list is the real server tree:
 * GET /projects/{id}/hierarchy returns the flat pre-order phase->block->unit nodes
 * (apps/api/src/routes/project-nodes.ts, B-053), each block carrying REAL
 * units/sold/built aggregates. The block's colour + model label are not on the
 * hierarchy node (only model_id is), so they are resolved through GET /models
 * (§0 rule 3: the mock's FK-as-string becomes a real model_id -> model join).
 * The unit-cell threshold algorithm is kept verbatim so the grid renders exactly
 * like the reference (gallery/g2/32) from the same three numbers.
 */

/** One block row of a project's structure (kind="block" HierarchyNode + model join). */
export interface Block {
  id: string;
  name: string;
  code: string;
  /** Model display label `${code} (${type})` — "" when the node has no model. */
  model: string;
  /** Left-border colour (the model's colour) — "" falls back to a token in the view. */
  color: string;
  units: number;
  sold: number;
  built: number;
}

/** The model fields the block card reads (GET /models rows, narrowed from opaque). */
export interface ModelLite {
  id: string;
  code: string;
  type: string;
  color: string;
}

/** A unit cell's sale/build state (master.jsx:382-385). */
export type UnitStatus = "soldBuilt" | "sold" | "built" | "empty";

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a non-negative integer off an opaque row; 0 when absent/invalid. */
function int(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Narrow an opaque /models row to the {id, code, type, color} the block card needs. */
export function toModelLite(e: Record<string, unknown>): ModelLite {
  return { id: str(e.id), code: str(e.code), type: str(e.type), color: str(e.color) };
}

/** Index /models rows by id for the block -> model join. */
export function modelsById(models: readonly Record<string, unknown>[]): Map<string, ModelLite> {
  const map = new Map<string, ModelLite>();
  for (const m of models) {
    const lite = toModelLite(m);
    if (lite.id) map.set(lite.id, lite);
  }
  return map;
}

/**
 * The blocks of a project = every kind="block" node of the hierarchy tree, in the
 * server's pre-order (master.jsx renders BLOCK_SEED flat, not phase-filtered — the
 * phase ScopePill is display-only). model_id is joined to /models for the label +
 * left-border colour.
 */
export function toBlocks(
  nodes: readonly Record<string, unknown>[],
  models: Map<string, ModelLite>,
): Block[] {
  return nodes
    .filter((n) => str(n.kind) === "block")
    .map((n) => {
      const modelId = str(n.model_id ?? n.modelId);
      const model = modelId ? models.get(modelId) : undefined;
      return {
        id: str(n.id),
        name: str(n.name),
        code: str(n.code),
        model: model ? `${model.code} (${model.type})` : "",
        color: model?.color ?? "",
        units: int(n.units),
        sold: int(n.sold),
        built: int(n.built),
      };
    });
}

/** Header totals — sum of block units/sold/built (master.jsx:357). */
export function blockTotals(blocks: readonly Block[]): {
  units: number;
  sold: number;
  built: number;
} {
  return blocks.reduce(
    (acc, b) => ({ units: acc.units + b.units, sold: acc.sold + b.sold, built: acc.built + b.built }),
    { units: 0, sold: 0, built: 0 },
  );
}

/**
 * Unit-cell status by index — verbatim master.jsx:382-385. A cell is soldBuilt when
 * it is within BOTH the sold and built counts, sold when within sold only, built when
 * within built only, else empty. Contiguous fills, exactly like the reference grid.
 */
export function unitStatus(index: number, sold: number, built: number): UnitStatus {
  if (index < sold && index < built) return "soldBuilt";
  if (index < sold) return "sold";
  if (index < built) return "built";
  return "empty";
}

/** Percent built of a block, rounded (master.jsx:371 `(built/units*100).toFixed(0)`). */
export function builtPct(block: Pick<Block, "units" | "built">): number {
  if (block.units <= 0) return 0;
  return Math.round((block.built / block.units) * 100);
}

/** Unit tooltip code `${blockCode}-${NN}` (master.jsx:391 padStart 2). */
export function unitCode(blockCode: string, index: number): string {
  return `${blockCode}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * The hierarchy labels (WBS) for a project type — GET /project-types rows carry
 * `key` + `hierarchy` (apps/api/src/routes/project-types.ts). Falls back to [] when
 * the type is unknown/absent; the view then shows its loading state.
 */
export function typeHierarchy(
  types: readonly Record<string, unknown>[],
  typeKey: string | undefined,
): string[] {
  if (!typeKey) return [];
  const row = types.find((t) => str(t.key) === typeKey || str(t.id) === typeKey);
  const h = row?.hierarchy;
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === "string") : [];
}

/** First segment of a phase name (master.jsx:355 `l.split(" · ")[0]`). */
export function phaseHead(name: string | undefined): string {
  return (name ?? "").split(" · ")[0];
}
