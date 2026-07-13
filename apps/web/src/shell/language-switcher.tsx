/*
 * LanguageSwitcher — ported 1:1 from pototype/i18n.jsx LanguageSwitcher (129-188).
 *
 * Portal dropdown driving the lang-store (th/zh/en/ar, ar=RTL flips <html dir>) via
 * setLang() from useI18n — the key-based path, NOT the prototype's DOM MutationObserver
 * (§0 rule 3). Language rows come from LANGS (i18n-full.json langs: code/label/en/dir);
 * the prototype's flag emoji is absent from i18n-full.json langs, so a globe glyph
 * stands in (data gap noted in BLOCKERS B-039). Title/header = dict key common.lang.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icon";
import { useI18n } from "../i18n";
import type { LangCode } from "@juneflow/i18n";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, langs, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLButtonElement>(null);
  const cur = langs.find((l) => l.code === lang) ?? langs[0];

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 190) });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest?.("[data-lang-pop]")) setOpen(false);
    };
    const tm = setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => {
      clearTimeout(tm);
      document.removeEventListener("mousedown", h);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        onClick={toggle}
        title={t("common.lang")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 36,
          padding: "0 11px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: open ? "var(--brand-soft)" : "var(--surface)",
          cursor: "pointer",
          color: "var(--text)",
        }}
      >
        <Icon name="globe" size={16} color="var(--text-2)" />
        {!compact && <span style={{ fontSize: 12.5, fontWeight: 600 }}>{cur.label}</span>}
        <Icon name="chevD" size={12} color="var(--text-3)" />
      </button>
      {open &&
        createPortal(
          <div
            data-lang-pop
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 4000,
              width: 180,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
              padding: 5,
            }}
          >
            <div
              style={{
                padding: "6px 9px 4px",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {t("common.lang")}
            </div>
            {langs.map((l) => {
              const on = l.code === lang;
              return (
                <div
                  key={l.code}
                  onClick={() => {
                    setLang(l.code as LangCode);
                    setOpen(false);
                  }}
                  dir={l.dir}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 9px",
                    borderRadius: 7,
                    cursor: "pointer",
                    background: on ? "var(--brand-soft)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: on ? "var(--brand-soft)" : "var(--surface-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="globe" size={13} color="var(--text-2)" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--brand)" : "var(--text)" }}>
                      {l.label}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)" }}>{l.en}</div>
                  </div>
                  {on && <Icon name="check" size={14} color="var(--brand)" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
