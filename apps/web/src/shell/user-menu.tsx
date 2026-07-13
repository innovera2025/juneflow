/*
 * UserMenu — ported 1:1 from pototype/chrome.jsx UserMenuPopover (792-846).
 *
 * Portal popover anchored to the sidebar avatar row. Identity comes from GET /me
 * (not the prototype's hardcoded user/email, §0 rule 3). Item labels:
 * profile/inbox/settings/sync from chrome-strings (tp), logout from the dict key
 * common.logout. Logout clears the real bearer token then navigates login.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../ui/icon";
import { Avatar } from "../ui/avatar";
import { useI18n } from "../i18n";
import { useShellCtx } from "./shell-context";
import { useMe, entityStr } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";
import { clearAuthToken } from "../auth-token";

export function UserMenu({
  open,
  anchorRef,
  onClose,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const ctx = useShellCtx();
  const { t } = useI18n();
  const ct = useChromeText();
  const me = useMe();
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ left: r.right + 6, bottom: window.innerHeight - r.bottom });
    const h = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", h);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;

  const userName = entityStr(me.data?.user, "name");
  const userEmail = entityStr(me.data?.user, "email");

  const item = (icon: IconName, label: string, color: string | undefined, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12.5,
        color: color || "var(--text)",
      }}
    >
      <Icon name={icon} size={14} color={color || "var(--text-2)"} />
      {label}
    </div>
  );

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: "fixed",
        left: pos.left,
        bottom: pos.bottom,
        zIndex: 2500,
        width: 240,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.22)",
        padding: 8,
        color: "var(--text)",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={userName || "?"} color="#0F766E" size={36} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{userName}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{userEmail}</div>
          </div>
        </div>
      </div>
      {item("user", ct("umProfile"), undefined, () => {
        onClose();
        ctx.navigate("users");
      })}
      {item("inbox", ct("umInbox"), undefined, () => {
        onClose();
        ctx.navigate("mobile");
      })}
      {item("settings", ct("umSettings"), undefined, () => {
        onClose();
        ctx.notify(ct("umSettings"), "info");
      })}
      {item("sync", ct("umSync"), undefined, () => {
        onClose();
        ctx.navigate("sync");
      })}
      <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
      {item("x", t("common.logout"), "var(--danger)", () => {
        onClose();
        clearAuthToken();
        ctx.notify(t("common.logout"), "info");
        ctx.navigate("login");
      })}
    </div>,
    document.body,
  );
}
