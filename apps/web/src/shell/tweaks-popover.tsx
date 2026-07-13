/*
 * TweaksPopover + floating gear — ported from pototype/shell.jsx (160-178, 345-462).
 *
 * The gear (top-right, title=common.theme) is part of the shell chrome (visible in the
 * reference closed state). CROSS-ZONE LIMIT (B-042, Wei ruling): @juneflow/tokens
 * (out of the web zone) defines only the `fiori`/`navy` themes, NOT the prototype's
 * light/dark + navy/teal/emerald/indigo accent model. shell.jsx applyTweaks sets
 * data-theme=light on mount, which would override the navy palette and BREAK the visual
 * gate — so data-theme stays "navy" (index.html) and only data-density is wired live
 * (compact/comfortable/spacious CSS from @juneflow/tokens, PLAT-04). Setting the density
 * segment updates ctx.tweaks.density; ShellProvider applies the data-density attribute
 * globally (shell-context.tsx). Theme/accent selections persist in the tweaks bag but
 * are visually inert until token themes land. Reset (clear localStorage + reload) works.
 */
import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { useShellCtx, type Tweaks } from "./shell-context";
import { useChromeText } from "./chrome-i18n";

function TwSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--text-3)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SegSwitch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div style={{ display: "flex", padding: 3, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            border: "none",
            background: value === o.v ? "var(--surface)" : "transparent",
            color: value === o.v ? "var(--brand)" : "var(--text-2)",
            fontSize: 12,
            fontWeight: value === o.v ? 700 : 500,
            boxShadow: value === o.v ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

const ACCENTS: { v: string; l: string; c: string }[] = [
  { v: "navy", l: "Navy", c: "#0B2A4A" },
  { v: "teal", l: "Teal", c: "#0F766E" },
  { v: "emerald", l: "Emerald", c: "#047857" },
  { v: "indigo", l: "Indigo", c: "#3730A3" },
];

export function TweaksPopover({ onClose }: { onClose: () => void }) {
  const ctx = useShellCtx();
  const ct = useChromeText();
  const { tweaks, setTweak } = ctx;

  const set = (k: keyof Tweaks, v: string) => setTweak(k, v);

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 16,
        zIndex: 100,
        width: 300,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.18), 0 4px 12px -4px rgba(15,23,42,0.08)",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="settings" size={15} color="var(--brand)" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Tweaks</span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "none",
            background: "var(--surface-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="x" size={12} color="var(--text-2)" />
        </button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <TwSection label="Theme">
          <SegSwitch
            value={tweaks.theme}
            onChange={(v) => set("theme", v)}
            options={[
              { v: "light", l: ct("themeLight") },
              { v: "dark", l: ct("themeDark") },
            ]}
          />
        </TwSection>

        <TwSection label={ct("tweaksDensity")}>
          <SegSwitch
            value={tweaks.density}
            onChange={(v) => set("density", v)}
            options={[
              { v: "compact", l: "Compact" },
              { v: "comfortable", l: "Comfortable" },
              { v: "spacious", l: "Spacious" },
            ]}
          />
        </TwSection>

        <TwSection label={ct("tweaksAccent")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {ACCENTS.map((o) => (
              <button
                key={o.v}
                onClick={() => set("accent", o.v)}
                style={{
                  padding: "8px 6px",
                  borderRadius: 8,
                  border: tweaks.accent === o.v ? `2px solid ${o.c}` : "1px solid var(--border)",
                  background: tweaks.accent === o.v ? `color-mix(in srgb, ${o.c} 8%, white)` : "var(--surface)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <div style={{ width: 22, height: 22, borderRadius: 999, background: o.c }} />
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-2)" }}>{o.l}</span>
              </button>
            ))}
          </div>
        </TwSection>

        <div
          style={{
            paddingTop: 4,
            borderTop: "1px dashed var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{ct("tweaksDefault")}</span>
          <button
            onClick={() => {
              try {
                window.localStorage.removeItem("juneflow-state");
              } catch {
                /* no storage */
              }
              window.location.reload();
            }}
            style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {ct("tweaksReset")}
          </button>
        </div>
      </div>
    </div>
  );
}
