/*
 * Shared, pure, i18n-free, ASCII-only helpers for the Solar/Energy-EPC screens
 * (solar.monitor / solar.ppa / solar.roi / solar.permit / solar.warranty), ported from
 * pototype/solar.jsx. The opaque-row readers (str/num), the money formatter, and the
 * status-badge tone map are used across every solar screen, so they live here once
 * instead of being duplicated per screen (mirrors the single land-bank-rows helper set).
 *
 * The status tone map is the ds.jsx STATUS table the prototype's <StatusBadge> reads
 * (ds.jsx L84-91): bg/fg are @juneflow/tokens var() references (§0 rule 6) and `dot` is
 * the prototype-verbatim hex (no matching token, B-037(a) — exactly as land-bank-rows'
 * statusTone keeps them). No colour/number literal here comes from anywhere but the
 * prototype; nothing is fabricated.
 */

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent/null. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid (money cols arrive as strings). */
export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Group a number with thousands separators ("1750000" -> "1,750,000"), matching the
 * prototype's Intl fmt (ds.jsx fmt, th-TH, maximumFractionDigits 0). ASCII digits +
 * comma only (never a Thai/locale glyph, B-073); NaN / non-finite -> "0". Mirrors
 * land-bank-rows formatMoney byte-for-byte.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The four ds.jsx STATUS keys the solar screens use (draft is the fallback). */
export type StatusKind = "approved" | "pending" | "rejected" | "draft";

/**
 * Status-badge tone (ds.jsx STATUS map, read by the ported <StatusBadge>). bg/fg are
 * @juneflow/tokens var() references (§0 rule 6); `dot` is the prototype-verbatim hex
 * (no matching token, B-037(a)). An unknown kind falls back to draft, exactly like the
 * prototype's `STATUS[status] || STATUS.draft`.
 */
export function statusTone(kind: StatusKind): { bg: string; fg: string; dot: string } {
  switch (kind) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}
