/*
 * Card — ported 1:1 from pototype/ds.jsx Card() (154-165). Surface panel with the
 * token radius + shadow. All values token-backed.
 */
import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  style = {},
  pad = 22,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        padding: pad,
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
