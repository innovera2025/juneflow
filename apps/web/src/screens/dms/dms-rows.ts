/*
 * DMS list-row helpers for DMSCenter (B-221) — pure, i18n-free, ASCII-only logic
 * derived from pototype/dms.jsx DMSCenter (L31-145) + the DMS_CATS / DMS_ST consts
 * (L5-29) and the ds.jsx STATUS map (L84-92) the prototype's <StatusBadge> reads.
 *
 * The prototype held its files in a local DMS_SEED array (dms.jsx:14-28) whose rows
 * carried denormalised display strings (a Thai uploader name, a pre-formatted Thai
 * calendar date, a Thai "expires on ..." phrase). §0 rule 3: that mock array is
 * dropped — the list is the real server catalogue (GET /documents, use-dms.ts). The
 * handler resolves project_id → project_name and by_user_id → the uploader name in
 * memory, so a display field carries a real NAME, never a raw uuid (PLAN.md §4); a
 * null FK resolves to null → "" here → an em-dash in the view.
 *
 * WIRE (documents.ts listDocuments, opaque Entity rows):
 *   { id, name, cat, project_name, version, by, size, status, expiry, link_module,
 *     url, at }
 * where `at` = created_at (newest-first from the handler), `by`/`project_name` are
 * the resolved names, and `link_module` is the source-module route id.
 *
 * HONEST DIVERGENCES (reported, never fabricated — see the DMSCenter header):
 *  - No document_version table: `version` is the CURRENT version only; there is no
 *    per-version history (the prototype's versions modal is dropped).
 *  - The prototype's varied per-row Thai dates do not exist on the wire; the real
 *    created_at (`at`, a uniform seed time) is rendered instead of a fabricated date.
 *  - The prototype's Thai "expires on ..." phrase is a mock string; the raw `expiry`
 *    date is shown (there is no key/formatter for the phrase).
 */

import type { DictKey } from "@juneflow/i18n";
import type { IconName } from "../../ui/icon";

/** A DMS document as the table consumes it (GET /documents row, narrowed). */
export interface DmsRow {
  id: string;
  name: string;
  /** Category id (contract | drawing | permit | finance | land | photo | defect). */
  cat: string;
  /** Resolved project name ("" when null / not in the tenant set). */
  proj: string;
  /** Current version number (there is no version-history table — B-221). */
  ver: number;
  /** Resolved uploader name ("" when null / not a seed user). */
  by: string;
  /** Human file size string (e.g. "2.4 MB"), stored verbatim. */
  size: string;
  /** Lifecycle status — "active" | "review" | "expiring" (dms.jsx DMS_ST). */
  status: string;
  /** Expiry date (ISO "YYYY-MM-DD") for an expiring permit; "" otherwise. */
  expiry: string;
  /** Source-module route id ("subcon.contracts", …); "" when unattached. */
  link: string;
  /** Storage url (opaque; not shown, kept for completeness). */
  url: string;
  /** created_at (ISO timestamp) — the real upload time; "" when absent. */
  date: string;
}

/** Read a string field off an opaque row; "" when null/absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an opaque /documents Entity row to the DmsRow the table needs. Multi-word
 * fields accept the handler's snake_case wire (project_name / by / link_module / at)
 * or camelCase for robustness. Missing fields default (0 / "").
 */
export function toDmsRow(e: Record<string, unknown>): DmsRow {
  return {
    id: str(e.id),
    name: str(e.name),
    cat: str(e.cat),
    proj: str(e.project_name ?? e.projectName),
    ver: num(e.version ?? e.ver),
    by: str(e.by),
    size: str(e.size),
    status: str(e.status),
    expiry: str(e.expiry),
    link: str(e.link_module ?? e.linkModule ?? e.link),
    url: str(e.url),
    date: str(e.at ?? e.created_at ?? e.createdAt ?? e.date),
  };
}

/** A DMS category (dms.jsx DMS_CATS L5-13). `color` is prototype-verbatim (B-037a). */
export interface DmsCat {
  id: string;
  /** i18n DICT key for the category label (resolved with t() in the view). */
  labelKey: DictKey;
  icon: IconName;
  /** Prototype-verbatim category color hex (dms.jsx DMS_CATS). */
  color: string;
}

/**
 * The seven DMS categories, in prototype order (dms.jsx L5-13). Labels are i18n
 * DICT keys — dedicated dms.cat* keys plus two byte-exact borrows (contract →
 * subcon.unitContract, finance → nav.sec.fin). Colors are the prototype's verbatim
 * hexes.
 */
export const DMS_CATS: readonly DmsCat[] = [
  { id: "contract", labelKey: "subcon.unitContract", icon: "doc", color: "#0B2A4A" },
  { id: "drawing", labelKey: "dms.catDrawing", icon: "ruler", color: "#1D4ED8" },
  { id: "permit", labelKey: "dms.catPermit", icon: "paperclip", color: "#B45309" },
  { id: "finance", labelKey: "nav.sec.fin", icon: "ledger", color: "#0F766E" },
  { id: "land", labelKey: "dms.catLand", icon: "landplot", color: "#6D28D9" },
  { id: "photo", labelKey: "dms.catPhoto", icon: "eye", color: "#B91C1C" },
  { id: "defect", labelKey: "dms.catDefect", icon: "warn", color: "#B4453C" },
];

/** The category meta for an id, or undefined (dms.jsx catOf). */
export function catById(id: string): DmsCat | undefined {
  return DMS_CATS.find((c) => c.id === id);
}

/** Which i18n status label a wire status renders (resolved in the view — no Thai here). */
export type DmsStatusKind = "active" | "review" | "expiring";

/**
 * Status-badge descriptor. bg/fg are @juneflow/tokens var() references; `dot` is
 * prototype-verbatim (ds.jsx STATUS map, B-037a). dms.jsx DMS_ST maps the wire
 * statuses onto ds.jsx STATUS entries: active→approved, review→pending,
 * expiring→rejected. Unknown → active (approved), matching StatusBadge's default.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "review":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "expiring":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    case "active":
    default:
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
  }
}

/** Map a wire status to its i18n label kind (the view picks the DICT key). */
export function statusLabelKind(status: string): DmsStatusKind {
  if (status === "review") return "review";
  if (status === "expiring") return "expiring";
  return "active";
}

/**
 * Filter the docs by category + free-text query (dms.jsx L35): a doc matches when
 * (no category selected OR its cat === the selected id) AND (no query OR its
 * name+proj contains the query, case-insensitive). An empty cat/query is "no filter".
 */
export function filterDocs(rows: readonly DmsRow[], cat: string, q: string): DmsRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!cat || r.cat === cat) &&
      (!needle || (r.name + r.proj).toLowerCase().includes(needle)),
  );
}

/** Count docs in a category (dms.jsx cnt, L37) — the rail badge number. */
export function catCount(rows: readonly DmsRow[], id: string): number {
  return rows.filter((r) => r.cat === id).length;
}

/** Count docs of a given status (dms.jsx KPI review/expiring aggregates). */
export function countByStatus(rows: readonly DmsRow[], status: string): number {
  return rows.filter((r) => r.status === status).length;
}

/**
 * Format the real created_at for display: the ISO calendar part ("YYYY-MM-DD"),
 * ASCII + stable. The prototype's varied Thai dates are a mock (§0 rule 3) with no
 * wire source, so the real timestamp is shown instead. "" when absent or unparseable
 * (→ em-dash in the view).
 */
export function formatDocDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (m) return m[1];
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
