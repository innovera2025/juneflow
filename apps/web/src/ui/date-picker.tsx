/*
 * DatePicker — ported from pototype/datepicker.jsx DatePicker (12-149) + fmtThaiDate
 * (7-9). Anchor button (calendar icon + Thai-Buddhist short date + chevron) with a
 * portal calendar popover: month/year nav, a selectable day grid (Mon-first), and a
 * "today" quick action.
 *
 * §0 fidelity: the prototype hardcodes Thai month/weekday arrays (TH_MONTHS /
 * TH_MONTHS_SHORT / TH_DAYS). This port derives the SAME strings from Intl at runtime
 * (locale th-TH, buddhist calendar) so no Thai byte lives in this source (B-073) while
 * the rendered labels match the prototype byte-for-byte (short date, long month name, and
 * the Monday-first narrow weekday row — all verified against the prototype output). The
 * Buddhist-era header year is computed as getFullYear()+543 (a number) to avoid Intl's
 * era prefix, matching the prototype's `(year + 543)` arithmetic.
 *
 * i18n: this is a generic ui/ primitive (no i18n import). The one visible copy string —
 * the "today" quick action — is supplied by the caller as `todayLabel` (the dashboard
 * passes the i18n phrase). The prototype's extra quick jumps (month-start / year-start)
 * are intentionally omitted: their Thai copy has NO i18n key (§0 rule 2 → BLOCKERS, never
 * invented). Tokens back every colour (rule 6); geometry literals are prototype-verbatim.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icon";

/** Intl formatters — one instance each (th-TH, Buddhist calendar). */
const SHORT_FMT = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  day: "numeric",
  month: "short",
  year: "2-digit",
});
const MONTH_FMT = new Intl.DateTimeFormat("th-TH", { month: "long" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("th-TH", { weekday: "narrow" });

/** Narrow weekday labels, Monday-first (2024-01-01 was a Monday). */
const WEEKDAYS: string[] = Array.from({ length: 7 }, (_, i) =>
  WEEKDAY_FMT.format(new Date(2024, 0, 1 + i)),
);

/** Prototype fmtThaiDate(d) — short Thai-Buddhist date via Intl (no Thai literal here). */
export function formatThaiShort(d: Date): string {
  return SHORT_FMT.format(d);
}

export interface DatePickerProps {
  value: Date;
  onChange: (d: Date) => void;
  /** i18n copy for the "today" quick action (dashboard supplies the phrase). */
  todayLabel: string;
  icon?: IconName;
  anchorStyle?: CSSProperties;
}

const ctlBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "none",
  background: "var(--surface-2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--text-2)",
};

export function DatePicker({ value, onChange, todayLabel, icon = "calendar", anchorStyle }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(value);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
      setView(value);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const tid = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(tid);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  const goMonth = (delta: number) => setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));
  const goYear = (delta: number) => setView(new Date(view.getFullYear() + delta, view.getMonth(), 1));

  const y = view.getFullYear();
  const m = view.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isSel = (d: number) =>
    value.getFullYear() === y && value.getMonth() === m && value.getDate() === d;
  const isToday = (d: number) =>
    d === today.getDate() && y === today.getFullYear() && m === today.getMonth();

  const pick = (d: number) => {
    onChange(new Date(y, m, d));
    setOpen(false);
  };
  const jumpToday = () => {
    onChange(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    setView(today);
    setOpen(false);
  };

  const popover = open ? (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: pos.top,
        right: pos.right,
        zIndex: 2500,
        width: 280,
        padding: 12,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px -12px rgba(15,23,42,0.22), 0 4px 12px -4px rgba(15,23,42,0.10)",
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => goYear(-1)} style={ctlBtn} aria-label="prev-year">
          <span style={{ fontSize: 11 }}>&laquo;</span>
        </button>
        <button onClick={() => goMonth(-1)} style={ctlBtn} aria-label="prev-month">
          <Icon name="chevL" size={12} />
        </button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700 }} className="num">
          {MONTH_FMT.format(view)} {y + 543}
        </div>
        <button onClick={() => goMonth(1)} style={ctlBtn} aria-label="next-month">
          <Icon name="chevR" size={12} />
        </button>
        <button onClick={() => goYear(1)} style={ctlBtn} aria-label="next-year">
          <span style={{ fontSize: 11 }}>&raquo;</span>
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {WEEKDAYS.map((d, i) => (
          <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textAlign: "center", padding: "4px 0" }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const sel = isSel(d);
          const t = isToday(d);
          return (
            <button
              key={i}
              onClick={() => pick(d)}
              className="num"
              style={{
                height: 32,
                borderRadius: 6,
                border: "none",
                background: sel ? "var(--brand)" : t ? "var(--brand-soft)" : "transparent",
                color: sel ? "#fff" : t ? "var(--brand)" : "var(--text)",
                fontSize: 12,
                fontWeight: sel || t ? 700 : 500,
                cursor: "pointer",
                fontFamily: "var(--font-num)",
              }}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <button
          onClick={jumpToday}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 11,
            fontWeight: 600,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text-2)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {todayLabel}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 34,
          padding: "0 12px",
          background: open ? "var(--brand-soft)" : "var(--surface)",
          color: "var(--text)",
          border: `1px solid ${open ? "var(--brand)" : "var(--border-strong)"}`,
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1,
          cursor: "pointer",
          fontFamily: "inherit",
          ...anchorStyle,
        }}
      >
        <Icon name={icon} size={16} />
        <span className="num">{formatThaiShort(value)}</span>
        <Icon name="chevD" size={12} color="var(--text-3)" />
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
