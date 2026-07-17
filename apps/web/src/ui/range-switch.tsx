/*
 * RangeSwitch — ported 1:1 from pototype/datepicker.jsx RangeSwitch (151-170). A
 * segmented pill control: the selected option gets the brand fill, the rest are ghost.
 * Generic (no i18n / no Thai): the caller supplies `options` with pre-resolved labels.
 * All colours are token-backed (§0 rule 6); geometry literals are prototype-verbatim.
 */
import type { ReactNode } from "react";

export interface RangeOption {
  v: string;
  l: ReactNode;
}

export interface RangeSwitchProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly RangeOption[];
}

export function RangeSwitch({ value, onChange, options }: RangeSwitchProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: 8,
        border: "1px solid var(--border)",
        padding: 2,
        background: "var(--surface)",
      }}
    >
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            background: value === o.v ? "var(--brand)" : "transparent",
            color: value === o.v ? "#fff" : "var(--text-2)",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all .12s ease",
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
