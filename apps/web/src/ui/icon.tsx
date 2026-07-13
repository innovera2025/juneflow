/*
 * Icon — ported 1:1 from pototype/ds.jsx Icon(). Line-drawn 24x24 SVG glyphs.
 *
 * Paths are transcribed verbatim from the prototype (design fidelity, PLAN.md §0
 * rule 1). Only the glyphs used by the ported screens are included; add more as
 * screens land. Colors default to currentColor so callers set tone via tokens.
 */
import type { CSSProperties } from "react";

/** Glyph names available so far (extend when new screens are ported). */
export type IconName =
  | "building"
  | "warn"
  | "arrowR"
  | "key"
  | "mail"
  | "check"
  | "info"
  | "x";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

/** SVG children per glyph — verbatim from pototype/ds.jsx. */
const GLYPHS: Record<IconName, (p: Record<string, unknown>) => JSX.Element> = {
  building: (p) => (
    <>
      <path d="M3 21h18" {...p} />
      <path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" {...p} />
      <path d="M16 21V9h3a2 2 0 0 1 2 2v10" {...p} />
      <path d="M9 7h2M9 11h2M9 15h2" {...p} />
    </>
  ),
  warn: (p) => (
    <>
      <path d="M12 3l10 18H2L12 3z" {...p} />
      <path d="M12 10v5M12 18v0.5" {...p} />
    </>
  ),
  arrowR: (p) => (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" {...p} />
    </>
  ),
  key: (p) => (
    <>
      <circle cx="8" cy="14" r="4" {...p} />
      <path d="M11 11l8-8M16 4l3 3M14 6l2 2" {...p} />
    </>
  ),
  mail: (p) => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" {...p} />
      <path d="M4 7l8 5 8-5" {...p} />
    </>
  ),
  check: (p) => (
    <>
      <path d="M5 12l4 4 10-10" {...p} />
    </>
  ),
  info: (p) => (
    <>
      <circle cx="12" cy="12" r="9" {...p} />
      <path d="M12 8v0.5M12 11v5" {...p} />
    </>
  ),
  x: (p) => (
    <>
      <path d="M6 6l12 12M18 6L6 18" {...p} />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  color = "currentColor",
  strokeWidth = 1.6,
  style = {},
}: IconProps) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
    >
      {GLYPHS[name](p)}
    </svg>
  );
}
