/*
 * ToastHost — the shared bottom-center toast from pototype/shell.jsx (180-195).
 * Single {msg,tone} pill; tone -> var(--ok/info/warn/danger) + icon; auto-dismiss is
 * owned by ctx.notify (2400ms, shell.jsx:85). Extracted so login + shell reuse ONE host.
 */
import { Icon, type IconName } from "../ui/icon";
import { useShellCtx, type ToastTone } from "./shell-context";

const TONE_BG: Record<ToastTone, string> = {
  ok: "var(--ok)",
  info: "var(--info)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

const TONE_ICON: Record<ToastTone, IconName> = {
  ok: "check",
  info: "info",
  warn: "warn",
  danger: "x",
};

export function ToastHost() {
  const { toast } = useShellCtx();
  // Persistent polite live region so screen readers announce each toast as it
  // appears (the empty wrapper renders no pixels — the visible pill is the same
  // position:fixed element as before). left:"50%"+translateX centers correctly in
  // both dir modes, so it is intentionally NOT converted to a logical inset.
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 18px",
            background: TONE_BG[toast.tone],
            color: "#fff",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 6000,
          }}
        >
          <Icon name={TONE_ICON[toast.tone]} size={16} />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
