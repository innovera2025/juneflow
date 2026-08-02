/*
 * Shared visual primitives for the inventory read/display screens, inlined from
 * ds.jsx (MiniKpi L330-354, Filter chip L260-271, StatusBadge L93-108, th/td) —
 * the web app has no shared MiniKpi/Filter/StatusBadge, so each screen family
 * inlines them (the gr-list / land-bank precedent). No Thai/baht literal sits in
 * this source (B-073); every colour is a @juneflow/tokens var() (rule 6) except
 * the prototype-verbatim status dot hexes (B-037(a), from inv-shared docStatusTone).
 */
import type { CSSProperties } from "react";
import { Icon, type IconName } from "../../ui/icon";

/** The literal em-dash the screens render for every wire-gap cell. */
export const DASH = "—";

/** Table header cell style (ds.jsx th(), L214-219 — same as gr-list/land-bank). */
export function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "start",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td(), L220). */
export const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** MiniKpi card, inlined 1:1 from ds.jsx MiniKpi (L330-354) — supports a unit span. */
export function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span
          style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/**
 * Static filter chip (ds.jsx Filter muted/active button visual, L260-271) —
 * presentational only: GET /inventory/* takes no filter params, so these chips
 * show their "all" value and do not filter (the gr-list degraded-filter precedent).
 */
export function FilterChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: muted ? "transparent" : "var(--surface-2)",
        fontSize: 11.5,
        color: "var(--text)",
        height: 32,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "var(--text-3)" : "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/**
 * Small status badge (ds.jsx StatusBadge size sm, L93-108): tokened bg/fg + a
 * prototype-verbatim dot. The caller resolves `label` from i18n; `bg/fg/dot`
 * come from inv-shared docStatusTone / stockStatusTone.
 */
export function StatusBadge({
  bg,
  fg,
  dot,
  label,
}: {
  bg: string;
  fg: string;
  dot?: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />}
      {label}
    </span>
  );
}

/** Loading skeleton rows for a table body (token blocks, no invented copy). */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 20 }}>
      {Array.from({ length: rows }, (_, n) => (
        <div
          key={n}
          style={{
            height: 44,
            marginBottom: 4,
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
        />
      ))}
    </div>
  );
}

/** Re-export IconName for the screen components. */
export type { IconName };
