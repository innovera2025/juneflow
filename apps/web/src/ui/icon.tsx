/*
 * Icon — ported 1:1 from pototype/ds.jsx Icon(). Line-drawn 24x24 SVG glyphs.
 *
 * Paths are transcribed verbatim from the prototype (design fidelity, PLAN.md §0
 * rule 1). The full ds.jsx glyph table is included so the app-shell (P0-WEB-05:
 * sidebar + topbar) renders every NAV/chrome icon exactly as the prototype does.
 * Colors default to currentColor so callers set tone via tokens.
 *
 * Note (faithful): chrome.jsx NAV uses icon "report" for the reports row, but
 * ds.jsx has no "report" glyph — the prototype renders `paths[name] || null`, i.e.
 * a blank icon. We reproduce that blank exactly rather than invent a glyph.
 */
import type { CSSProperties } from "react";

/** Glyph names available (full ds.jsx set; "report" is intentionally blank). */
export type IconName =
  | "dashboard"
  | "building"
  | "budget"
  | "cart"
  | "box"
  | "truck"
  | "hardhat"
  | "sun"
  | "briefcase"
  | "landplot"
  | "compass"
  | "ruler"
  | "water"
  | "handshake"
  | "wrench"
  | "gauge"
  | "cash"
  | "pie"
  | "tag"
  | "shield"
  | "ledger"
  | "check"
  | "inbox"
  | "globe"
  | "settings"
  | "chevR"
  | "chevD"
  | "chevL"
  | "search"
  | "bell"
  | "plus"
  | "filter"
  | "download"
  | "upload"
  | "print"
  | "paperclip"
  | "user"
  | "users"
  | "calendar"
  | "trend"
  | "warn"
  | "info"
  | "arrowR"
  | "x"
  | "more"
  | "grid"
  | "link"
  | "flag"
  | "sync"
  | "doc"
  | "clock"
  | "history"
  | "edit"
  | "copy"
  | "list"
  | "lock"
  | "key"
  | "mail"
  | "eye"
  | "alert"
  | "report";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

/** SVG children per glyph — verbatim from pototype/ds.jsx (blank for "report"). */
const GLYPHS: Record<IconName, (p: Record<string, unknown>, color: string) => JSX.Element | null> = {
  dashboard: (p) => (<><rect x="3" y="3" width="7" height="9" rx="1.5" {...p} /><rect x="14" y="3" width="7" height="5" rx="1.5" {...p} /><rect x="14" y="12" width="7" height="9" rx="1.5" {...p} /><rect x="3" y="16" width="7" height="5" rx="1.5" {...p} /></>),
  building: (p) => (<><path d="M3 21h18" {...p} /><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" {...p} /><path d="M16 21V9h3a2 2 0 0 1 2 2v10" {...p} /><path d="M9 7h2M9 11h2M9 15h2" {...p} /></>),
  budget: (p) => (<><path d="M3 4h18v6H3z" {...p} /><path d="M3 14h18v6H3z" {...p} /><path d="M7 7h4M7 17h4M17 7h0M17 17h0" {...p} /></>),
  cart: (p) => (<><circle cx="9" cy="20" r="1.5" {...p} /><circle cx="17" cy="20" r="1.5" {...p} /><path d="M3 3h2l2.5 12h11l2-8H7" {...p} /></>),
  box: (p) => (<><path d="M3 7l9-4 9 4-9 4-9-4z" {...p} /><path d="M3 7v10l9 4 9-4V7" {...p} /><path d="M12 11v10" {...p} /></>),
  truck: (p) => (<><rect x="2" y="6" width="12" height="10" rx="1.5" {...p} /><path d="M14 9h4l3 4v3h-7" {...p} /><circle cx="7" cy="18" r="1.6" {...p} /><circle cx="17" cy="18" r="1.6" {...p} /></>),
  hardhat: (p) => (<><path d="M3 17h18v3H3z" {...p} /><path d="M5 17v-2a7 7 0 0 1 14 0v2" {...p} /><path d="M9 7v6M15 7v6" {...p} /></>),
  sun: (p) => (<><circle cx="12" cy="12" r="4" {...p} /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" {...p} /></>),
  briefcase: (p) => (<><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" {...p} /></>),
  landplot: (p, color) => (<><path d="M12 3l9 5-9 5-9-5 9-5z" {...p} /><path d="M3 14l9 5 9-5" {...p} /><circle cx="12" cy="8" r="1.4" fill={color} stroke="none" /></>),
  compass: (p) => (<><circle cx="12" cy="12" r="9" {...p} /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" {...p} /></>),
  ruler: (p) => (<><path d="M3 14l11-11 7 7-11 11z" {...p} /><path d="M7 10l2 2M10 7l2 2M13 4l2 2M4 13l2 2" {...p} /></>),
  water: (p) => (<><path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z" {...p} /></>),
  handshake: (p) => (<><path d="M11 17l-2 2-4-4 4-4 3 2h4l3 3" {...p} /><path d="M13 7l2-2 4 4-2 2" {...p} /></>),
  wrench: (p) => (<><path d="M14.5 6.5a3.5 3.5 0 0 1-4.6 4.6l-5.2 5.2a1.6 1.6 0 0 0 2.3 2.3l5.2-5.2a3.5 3.5 0 0 0 4.6-4.6l-2 2-2.3-2.3 2-2z" {...p} /></>),
  gauge: (p, color) => (<><path d="M4 18a8 8 0 1 1 16 0" {...p} /><path d="M12 18l4-5" {...p} /><circle cx="12" cy="18" r="1.2" fill={color} stroke="none" /></>),
  cash: (p) => (<><rect x="2" y="6" width="20" height="12" rx="2" {...p} /><circle cx="12" cy="12" r="3" {...p} /><path d="M6 10v0M6 14v0M18 10v0M18 14v0" {...p} /></>),
  pie: (p) => (<><path d="M12 3a9 9 0 1 0 9 9h-9V3z" {...p} /><path d="M14 3a7 7 0 0 1 7 7h-7V3z" {...p} /></>),
  tag: (p, color) => (<><path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9z" {...p} /><circle cx="7.5" cy="7.5" r="1.3" fill={color} stroke="none" /></>),
  shield: (p) => (<><path d="M12 3l8 3v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" {...p} /></>),
  ledger: (p) => (<><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" {...p} /><path d="M4 16a4 4 0 0 1 4-4h12" {...p} /><path d="M9 8h6" {...p} /></>),
  check: (p) => (<><path d="M5 12l4 4 10-10" {...p} /></>),
  inbox: (p) => (<><path d="M3 13l3-8h12l3 8" {...p} /><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-6l-1 2h-4l-1-2H3z" {...p} /></>),
  globe: (p) => (<><circle cx="12" cy="12" r="9" {...p} /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" {...p} /></>),
  settings: (p) => (<><circle cx="12" cy="12" r="3" {...p} /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2L10 21h4l.5-2.5c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" {...p} /></>),
  chevR: (p) => (<><path d="M9 6l6 6-6 6" {...p} /></>),
  chevD: (p) => (<><path d="M6 9l6 6 6-6" {...p} /></>),
  chevL: (p) => (<><path d="M15 6l-6 6 6 6" {...p} /></>),
  search: (p) => (<><circle cx="11" cy="11" r="7" {...p} /><path d="M21 21l-4-4" {...p} /></>),
  bell: (p) => (<><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 7H4s2-2 2-7z" {...p} /><path d="M10 21a2 2 0 0 0 4 0" {...p} /></>),
  plus: (p) => (<><path d="M12 5v14M5 12h14" {...p} /></>),
  filter: (p) => (<><path d="M3 5h18l-7 9v6l-4-2v-4z" {...p} /></>),
  download: (p) => (<><path d="M12 4v12M7 11l5 5 5-5" {...p} /><path d="M5 20h14" {...p} /></>),
  upload: (p) => (<><path d="M12 20V8M7 13l5-5 5 5" {...p} /><path d="M5 4h14" {...p} /></>),
  print: (p) => (<><rect x="6" y="3" width="12" height="6" rx="1" {...p} /><rect x="6" y="14" width="12" height="7" rx="1" {...p} /><path d="M6 9H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2" {...p} /><path d="M18 9h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" {...p} /></>),
  paperclip: (p) => (<><path d="M21 11l-9 9a5 5 0 1 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 1 1-3-3l8-8" {...p} /></>),
  user: (p) => (<><circle cx="12" cy="8" r="4" {...p} /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" {...p} /></>),
  users: (p) => (<><circle cx="9" cy="8" r="3.5" {...p} /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" {...p} /><path d="M16 4a3 3 0 0 1 0 6" {...p} /><path d="M18 20c0-2 1-4 4-4" {...p} /></>),
  calendar: (p) => (<><rect x="3" y="5" width="18" height="16" rx="2" {...p} /><path d="M3 9h18M8 3v4M16 3v4" {...p} /></>),
  trend: (p) => (<><path d="M3 17l6-6 4 4 8-8" {...p} /><path d="M14 7h7v7" {...p} /></>),
  warn: (p) => (<><path d="M12 3l10 18H2L12 3z" {...p} /><path d="M12 10v5M12 18v0.5" {...p} /></>),
  info: (p) => (<><circle cx="12" cy="12" r="9" {...p} /><path d="M12 8v0.5M12 11v5" {...p} /></>),
  arrowR: (p) => (<><path d="M5 12h14M13 6l6 6-6 6" {...p} /></>),
  x: (p) => (<><path d="M6 6l12 12M18 6L6 18" {...p} /></>),
  more: (p) => (<><circle cx="12" cy="6" r="1" {...p} /><circle cx="12" cy="12" r="1" {...p} /><circle cx="12" cy="18" r="1" {...p} /></>),
  grid: (p) => (<><rect x="3" y="3" width="7" height="7" rx="1" {...p} /><rect x="14" y="3" width="7" height="7" rx="1" {...p} /><rect x="3" y="14" width="7" height="7" rx="1" {...p} /><rect x="14" y="14" width="7" height="7" rx="1" {...p} /></>),
  link: (p) => (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11 7" {...p} /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L13 17" {...p} /></>),
  flag: (p) => (<><path d="M5 21V4h12l-2 4 2 4H5" {...p} /></>),
  sync: (p) => (<><path d="M4 4v6h6" {...p} /><path d="M20 20v-6h-6" {...p} /><path d="M5 14a8 8 0 0 0 14.5 2M19 10A8 8 0 0 0 4.5 8" {...p} /></>),
  doc: (p) => (<><path d="M7 3h7l5 5v13H7z" {...p} /><path d="M14 3v5h5" {...p} /><path d="M10 13h6M10 17h4" {...p} /></>),
  clock: (p) => (<><circle cx="12" cy="12" r="9" {...p} /><path d="M12 7v5l3 2" {...p} /></>),
  history: (p) => (<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" {...p} /><path d="M3 3v5h5" {...p} /><path d="M12 7v5l3 2" {...p} /></>),
  edit: (p) => (<><path d="M4 20h4l11-11-4-4L4 16v4z" {...p} /></>),
  copy: (p) => (<><rect x="9" y="9" width="11" height="11" rx="2" {...p} /><path d="M5 15V5a2 2 0 0 1 2-2h8" {...p} /></>),
  list: (p) => (<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" {...p} /></>),
  lock: (p) => (<><rect x="5" y="11" width="14" height="9" rx="2" {...p} /><path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} /></>),
  key: (p) => (<><circle cx="8" cy="14" r="4" {...p} /><path d="M11 11l8-8M16 4l3 3M14 6l2 2" {...p} /></>),
  mail: (p) => (<><rect x="3" y="5" width="18" height="14" rx="2" {...p} /><path d="M4 7l8 5 8-5" {...p} /></>),
  eye: (p) => (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" {...p} /><circle cx="12" cy="12" r="3" {...p} /></>),
  alert: (p) => (<><path d="M12 3l10 18H2z" {...p} /><path d="M12 9v5M12 17v.5" {...p} /></>),
  report: () => null,
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
  // Guard the glyph lookup: `name` is typed IconName, but callers feed it opaque
  // server strings (e.g. master-company passes `r.icon as IconName` from GET
  // /org-units). Any value outside the glyph table makes GLYPHS[name] undefined, so
  // calling it would throw. Reproduce the prototype's `paths[name] || null` blank
  // (ds.jsx) — render nothing for an unknown name instead of crashing (B-087).
  const glyph = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
    >
      {typeof glyph === "function" ? glyph(p, color) : null}
    </svg>
  );
}
