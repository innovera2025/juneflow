/*
 * SearchPalette — ported from pototype/chrome.jsx SearchPalette (706-786).
 *
 * Global ⌘K / Ctrl+K + Esc palette. The prototype searches ROUTE_LABELS + 6 hardcoded
 * demo documents; the demo docs are a mock mechanic (§0 rule 3) and are NOT ported.
 * Results are the real nav routes (nav-tree ids + tn() labels), navigated via the
 * shell ctx. Copy (placeholder/empty/tag/hints) comes from chrome-strings + Kbd.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icon";
import { Kbd } from "../ui/kbd";
import type { NavKey } from "@juneflow/i18n";
import { useI18n } from "../i18n";
import { useShellCtx } from "./shell-context";
import { useChromeText } from "./chrome-i18n";
import { NAV_TREE } from "./nav-tree";

interface Entry {
  id: string;
  key: NavKey;
}

/** Flatten nav-tree leaves + subs into {id, thai-label-key}. */
function navEntries(): Entry[] {
  const out: Entry[] = [];
  for (const n of NAV_TREE) {
    if (n.kind !== "item") continue;
    if (n.sub) for (const s of n.sub) out.push({ id: s.id, key: s.label });
    else out.push({ id: n.id, key: n.label });
  }
  return out;
}

export function SearchPalette() {
  const ctx = useShellCtx();
  const { tn } = useI18n();
  const ct = useChromeText();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => navEntries(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const matches = useMemo(() => {
    const withLabel = entries.map((e) => ({ ...e, label: tn(e.key) }));
    if (!q) return withLabel.slice(0, 8);
    const ql = q.toLowerCase();
    return withLabel.filter((e) => e.label.toLowerCase().includes(ql)).slice(0, 10);
  }, [entries, q, tn]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2400,
        background: "rgba(8,18,32,0.42)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600,
          maxWidth: "calc(100vw - 40px)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 24px 60px -12px rgba(8,18,32,0.35)",
          overflow: "hidden",
          color: "var(--text)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="search" size={18} color="var(--text-3)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ct("searchPlaceholder")}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: "var(--text)", fontFamily: "inherit" }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div style={{ maxHeight: 400, overflow: "auto", padding: 6 }}>
          {matches.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>{ct("searchEmpty")}</div>
          ) : (
            matches.map((m, i) => (
              <div
                key={m.id}
                onClick={() => {
                  setOpen(false);
                  ctx.navigate(m.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: i === 0 ? "var(--brand-soft)" : "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: "var(--surface-3)",
                    color: "var(--text-2)",
                  }}
                >
                  {ct("searchPageTag")}
                </span>
                <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
                <Icon name="arrowR" size={13} color="var(--text-3)" />
              </div>
            ))
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)", display: "flex", gap: 14 }}>
          <span>
            <Kbd>↑↓</Kbd> {ct("searchHintNav")}
          </span>
          <span>
            <Kbd>↵</Kbd> {ct("searchHintOpen")}
          </span>
          <span>
            <Kbd>⌘K</Kbd> {ct("searchHintClose")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
