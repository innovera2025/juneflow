/*
 * Btn — ported 1:1 from pototype/ds.jsx Btn(). Colors/radius come from
 * @juneflow/tokens (var(--brand), var(--r-md), …); only the fixed geometry
 * (heights/paddings) and the drop-shadow are literal, exactly as the prototype
 * defines them, so the visual gate matches the reference (PLAN.md §0 rule 1).
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type BtnKind =
  | "primary"
  | "accent"
  | "ok"
  | "danger"
  | "outline"
  | "ghost"
  | "soft";
type BtnSize = "sm" | "md" | "lg";

export interface BtnProps {
  kind?: BtnKind;
  size?: BtnSize;
  icon?: IconName;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
  /** Accessible name for icon-only buttons (applied as aria-label). */
  label?: string;
}

const SIZES: Record<BtnSize, { h: number; px: number; fs: number; gap: number; ic: number }> = {
  sm: { h: 28, px: 11, fs: 12, gap: 6, ic: 14 },
  md: { h: 34, px: 13, fs: 13, gap: 7, ic: 15 },
  lg: { h: 40, px: 17, fs: 13.5, gap: 8, ic: 17 },
};

const KINDS: Record<BtnKind, { bg: string; color: string; border: string; shadow: string }> = {
  primary: { bg: "var(--brand)", color: "#fff", border: "var(--brand)", shadow: "0 1px 2px rgba(15,118,110,0.18)" },
  accent: { bg: "var(--accent)", color: "#fff", border: "var(--accent)", shadow: "0 1px 2px rgba(15,118,110,0.18)" },
  ok: { bg: "var(--ok)", color: "#fff", border: "var(--ok)", shadow: "0 1px 2px rgba(26,127,90,0.18)" },
  danger: { bg: "var(--danger)", color: "#fff", border: "var(--danger)", shadow: "0 1px 2px rgba(180,69,60,0.18)" },
  outline: { bg: "var(--surface)", color: "var(--text)", border: "var(--border-strong)", shadow: "0 1px 1px rgba(28,27,26,0.02)" },
  ghost: { bg: "transparent", color: "var(--text-2)", border: "transparent", shadow: "none" },
  soft: { bg: "var(--brand-soft)", color: "var(--brand)", border: "transparent", shadow: "none" },
};

export function Btn({
  kind = "ghost",
  size = "md",
  icon,
  children,
  onClick,
  disabled,
  type = "button",
  style = {},
  label,
}: BtnProps) {
  const s = SIZES[size];
  const k = KINDS[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        height: s.h,
        padding: `0 ${s.px}px`,
        background: k.bg,
        color: k.color,
        border: `1px solid ${k.border}`,
        borderRadius: "var(--r-md)",
        fontSize: s.fs,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "-0.005em",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .14s ease",
        boxShadow: k.shadow,
        fontFamily: "inherit",
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={s.ic} />}
      {children}
    </button>
  );
}
