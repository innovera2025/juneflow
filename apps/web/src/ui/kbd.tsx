/*
 * Kbd — ported 1:1 from pototype/ds.jsx Kbd() (191-197). Keycap chip for the
 * ⌘K search palette footer. All values token-backed except none needed.
 */
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-num)",
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        border: "1px solid var(--border)",
        borderRadius: 4,
        color: "var(--text-2)",
        background: "var(--surface-2)",
      }}
    >
      {children}
    </span>
  );
}
