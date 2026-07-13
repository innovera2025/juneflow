/*
 * NotificationsPopover — ported from pototype/chrome.jsx NotificationsPopover (607-700).
 *
 * The prototype's 5 hardcoded NOTIFS + red dot are a mock mechanic (§0 rule 3, C10) and
 * are NOT ported. The list + unread dot come from GET /notifications (real query). That
 * endpoint returns an opaque EntityList (no Notification schema in openapi.yaml), so each
 * row is rendered defensively from a best-effort title field; the prototype's rich per-type
 * icon/tone/time/route mapping needs a typed Notification schema (contract gap, BLOCKERS
 * B-039). Header/actions/empty copy come from chrome-strings (tp); the dot shows only when
 * the real list is non-empty.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icon";
import { Btn } from "../ui/button";
import { useShellCtx } from "./shell-context";
import { useNotifications, entityStr } from "./use-shell-data";
import { useChromeText } from "./chrome-i18n";

export function NotificationsPopover() {
  const ctx = useShellCtx();
  const ct = useChromeText();
  const notifs = useNotifications();
  const list = notifs.data ?? [];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", h);
    };
  }, [open]);

  const hasUnread = list.length > 0;

  const popover = open ? (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: pos.top,
        right: pos.right,
        zIndex: 2500,
        width: 360,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.22), 0 4px 12px -4px rgba(15,23,42,0.10)",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>{ct("notifTitle")}</div>
        <button
          onClick={() => setOpen(false)}
          style={{ fontSize: 11, color: "var(--brand)", background: "none", border: "none", fontWeight: 600, cursor: "pointer" }}
        >
          {ct("notifMarkAll")}
        </button>
      </div>
      <div style={{ maxHeight: 380, overflow: "auto" }}>
        {list.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>{ct("notifEmpty")}</div>
        ) : (
          list.map((n, i) => (
            <div
              key={i}
              onClick={() => {
                setOpen(false);
                ctx.navigate("notifications");
              }}
              style={{ display: "flex", gap: 10, padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  flexShrink: 0,
                  background: "var(--surface-3)",
                  color: "var(--text-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="bell" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>
                  {entityStr(n, "title") || entityStr(n, "message") || entityStr(n, "text")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
        <Btn
          kind="ghost"
          size="sm"
          icon="inbox"
          onClick={() => {
            setOpen(false);
            ctx.navigate("notifications");
          }}
        >
          {ct("notifViewAll")}
        </Btn>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          position: "relative",
          width: 34,
          height: 34,
          borderRadius: 8,
          border: `1px solid ${open ? "var(--brand)" : "var(--border)"}`,
          background: open ? "var(--brand-soft)" : "var(--surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Icon name="bell" size={16} color={open ? "var(--brand)" : "var(--text-2)"} />
        {hasUnread && (
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 7,
              height: 7,
              borderRadius: 999,
              background: "var(--danger)",
              border: "1.5px solid var(--surface)",
            }}
          />
        )}
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
