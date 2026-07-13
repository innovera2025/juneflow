/*
 * Modal — ported 1:1 from pototype/modal.jsx Modal() (the "custom" kind used by
 * ctx.openModal). Backdrop click + Escape close; colors from @juneflow/tokens,
 * fixed geometry + shadow literal per the prototype. Animations use the
 * jf-fadeIn/jf-popIn keyframes defined in base.css.
 *
 * Only the props the ported screens use are kept (title/subtitle/icon/iconTone/
 * size/footer). ConfirmDialog and other modal kinds land with the screens that
 * need them (the app-shell host, P0-WEB-05).
 */
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  iconTone?: string;
  size?: ModalSize;
  contentPad?: number;
  footer?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
}

const WIDTHS: Record<ModalSize, CSSProperties["width"]> = {
  sm: 460,
  md: 620,
  lg: 880,
  xl: 1100,
  full: "calc(100vw - 80px)",
};

export function Modal({
  title,
  subtitle,
  icon,
  iconTone,
  size = "md",
  contentPad = 24,
  footer,
  onClose,
  children,
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(8, 18, 32, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "jf-fadeIn .14s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: WIDTHS[size],
          maxWidth: "100%",
          maxHeight: "calc(100vh - 40px)",
          background: "var(--surface)",
          borderRadius: 14,
          boxShadow:
            "0 24px 60px -12px rgba(8,18,32,0.35), 0 8px 20px -8px rgba(8,18,32,0.18)",
          display: "flex",
          flexDirection: "column",
          animation: "jf-popIn .18s cubic-bezier(.2,.7,.3,1.2)",
        }}
      >
        {(title || icon) && (
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            {icon && (
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: `color-mix(in srgb, ${iconTone || "var(--brand)"} 14%, white)`,
                  color: iconTone || "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={icon} size={18} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                  {subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon name="x" size={14} color="var(--text-2)" />
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: contentPad }}>
          {children}
        </div>

        {footer && (
          <div
            style={{
              padding: "14px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
