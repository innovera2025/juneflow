/*
 * Solar shared presentational primitives — ported 1:1 from pototype/solar.jsx SolarKpi
 * (L6-22) + the ds.jsx StatusBadge (L93-105) and Tag (L273-280) the solar screens use.
 * No such KPI card / status-badge / tag primitive exists in ../../ui yet (each ported
 * screen inlines them), so the three that every solar screen shares live here once.
 *
 * Every colour/size comes from @juneflow/tokens (§0 rule 6); the ONLY literals are the
 * prototype-verbatim ones with no token match (B-037(a)): the color-mix "white" mix and
 * the StatusBadge dot hexes (via statusTone). No display text lives here — labels/values
 * are passed in from the screens as already-resolved t() strings.
 */
import type { ReactNode } from "react";
import { Card } from "../../ui/card";
import { Icon, type IconName } from "../../ui/icon";
import { statusTone, type StatusKind } from "./solar-shared";

/** SolarKpi, ported 1:1 from solar.jsx SolarKpi (L6-22). color-mix + white verbatim. */
export function SolarKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent: string;
  icon: IconName;
}) {
  return (
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/**
 * StatusBadge, ported 1:1 from ds.jsx StatusBadge (L93-105). The tone kind is resolved
 * in pure logic (per-screen status mapping); the visible label is always passed as
 * children (a resolved t() string or a raw backend value), never inferred here.
 */
export function StatusBadge({
  kind,
  size = "md",
  children,
}: {
  kind: StatusKind;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const s = statusTone(kind);
  const pad = size === "sm" ? "3px 9px" : "5px 12px";
  const fs = size === "sm" ? 11 : 12;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pad,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: fs,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {children}
    </span>
  );
}

/** Tag chip, ported 1:1 from ds.jsx Tag (L273-280). color-mix + white verbatim (B-037(a)). */
export function Tag({ children, tone = "var(--text-2)" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
