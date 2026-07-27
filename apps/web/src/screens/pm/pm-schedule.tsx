/*
 * PMSchedule — the PM plan calendar (route pm.schedule), ported from pototype/pm2.jsx
 * PMSchedule (L497-551) + PMCalendar (L552-591) + PMUpcoming (L592-624). Registry mod
 * "pm". Wei B-108a: this is a WEB-SIDE derivation over the existing PM reads — there is
 * NO /pm/schedule endpoint.
 *
 * Design fidelity (PLAN.md section 0 rule 1): the two-crumb breadcrumb (PM root / PM
 * schedule), the title + subtitle, the header view toggle (month / quarter / year) +
 * the genWO action, the "1.3fr 1fr" split (fixed calendar left; upcoming plan right),
 * the calendar's weekday row + 30-cell grid + legend, and the genWO modal are the
 * prototype's. The PMCalendar / PMUpcoming primitives are inlined here (like
 * pm-dashboard.tsx inlines them); the mock's popover mechanics are dropped (rule 3).
 *
 * Data (rules 3/4): GET /pm/assets (usePmAssetList) + GET /pm/contracts
 * (usePmContractList) via the generated client. The prototype's PM_PLAN_ITEMS +
 * PM_DAY_MARKS mocks are dropped — every plan row is derived in the pure, unit-tested
 * pm-schedule-rows.ts (G3). Nothing is fabricated: an asset with a null/unparseable
 * next_due is honestly EXCLUDED (never given a guessed date).
 *
 * FIXED calendar grid (Wei 2026-07-20): the month is the prototype's verbatim
 * pm.calMonthTitle ("June 2569"); 30 day cells (1..30) draw straight into the 7-column
 * grid with NO weekday offset; marks derive only from June-2026 asset next_due
 * (scheduleDayMarks) — the SAME fixed grid as pm.dashboard. With the current all-August
 * seed the grid renders clean of marks (honest, not a bug).
 *
 * Honest DEFAULTS (each flagged in-place):
 *   - DEFAULT 1: neither the genWO button/modal nor a PMUpcoming "+" has a backing
 *     endpoint (no /pm/schedule mutation) — both wire to a toast + navigate("pm.wo")
 *     only, mock-parity (no server write).
 *   - DEFAULT 2: pm.genWoConfirmBtn + pm.toastGenWo hardcode a mock "3-unit" count —
 *     used verbatim (the sacred value can't be retranslated), so the button/toast text
 *     will NOT match the live due-item count. Honest, flagged mismatch.
 *   - DEFAULT 3: /pm/contracts is fetched (proving the Wave-2 source, B-108, is live)
 *     but contract.visits_per_year is NOT expanded into multiple calendar entries — the
 *     mock rendered one plan entry per asset, so the schedule stays one-per-asset here.
 *   - DEFAULT 4: the view toggle (month / quarter / year) is cosmetic in the prototype
 *     (it never re-filters the grid) — kept cosmetic.
 *   - STATUS window: the tri-state status uses the prototype's own "next 14 days" copy
 *     (pm.genWoInfoLine) as the due threshold — see pm-schedule-rows.ts scheduleStatus.
 *
 * i18n (rule 2): every visible string is a pm.* / common.* dict key (t). No Thai
 * literal lives in source (rule 2); tokens back every colour (rule 6). The `cycle`
 * label rides through verbatim from the wire (a raw stored value, never a key).
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { usePmAssetList, usePmContractList } from "./use-pm";
import {
  toScheduleAsset,
  scheduleItems,
  scheduleDayMarks,
  formatScheduleDate,
  todayISO,
  PM_SCHEDULE_DAYS,
  type ScheduleStatus,
  type ScheduleItem,
} from "./pm-schedule-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Soft-tone tokens for a schedule status (prototype danger/warn/brand soft surfaces). */
function toneColors(tone: ScheduleStatus): { soft: string; fg: string } {
  if (tone === "overdue") return { soft: "var(--danger-soft)", fg: "var(--danger)" };
  if (tone === "due") return { soft: "var(--warn-soft)", fg: "var(--warn)" };
  return { soft: "var(--brand-soft)", fg: "var(--brand)" };
}

/**
 * PMCalendar (pm2.jsx L552-591) — the FIXED prototype grid (Wei 2026-07-20). The title
 * is the verbatim pm.calMonthTitle ("June 2569"); the grid draws a static weekday
 * header then 30 day cells (1..30) straight into the 7-column grid with NO weekday
 * offset (exactly as the prototype draws it, not a real month's first-weekday). Marks
 * derive only from June-2026 next_due (scheduleDayMarks). Clicking a day toggles the
 * selectedDay that filters the upcoming plan list.
 */
function PMCalendar({
  title,
  marks,
  selected,
  onSelectDay,
  weekdays,
  hint,
  legend,
}: {
  title: string;
  marks: Map<number, ScheduleStatus>;
  selected: number | null;
  onSelectDay: (day: number | null) => void;
  weekdays: readonly string[];
  hint: string;
  legend: readonly { tone: ScheduleStatus; label: string }[];
}) {
  return (
    <Card pad={0}>
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name="calendar" size={16} color="var(--brand)" />
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title || DASH}</span>
        <span style={{ marginInlineStart: "auto", fontSize: 11, color: "var(--text-3)" }}>{hint}</span>
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
            marginBottom: 8,
          }}
        >
          {weekdays.map((d, i) => (
            <div
              key={i}
              style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}
            >
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {Array.from({ length: PM_SCHEDULE_DAYS }, (_, i) => i + 1).map((d) => {
            const mark = marks.get(d);
            const sel = selected === d;
            const c = mark ? toneColors(mark) : null;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelectDay(sel ? null : d)}
                style={{
                  aspectRatio: "1",
                  borderRadius: 8,
                  padding: 5,
                  fontSize: 11,
                  position: "relative",
                  textAlign: "start",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: sel ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: sel ? "var(--brand-soft)" : c ? c.soft : "var(--surface)",
                }}
              >
                <span
                  className="num"
                  style={{ fontWeight: mark || sel ? 700 : 400, color: c ? c.fg : "var(--text-2)" }}
                >
                  {d}
                </span>
                {c && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 4,
                      insetInlineStart: 5,
                      insetInlineEnd: 5,
                      height: 3,
                      borderRadius: 2,
                      background: c.fg,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11 }}>
          {legend.map((l) => (
            <span key={l.tone} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{ width: 9, height: 9, background: toneColors(l.tone).fg, borderRadius: 2 }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function PMSchedule() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = usePmAssetList();
  // DEFAULT 3: /pm/contracts is fetched (proving the Wave-2 source, B-108, is live) but
  // its visits_per_year is NOT expanded into multiple calendar entries — the schedule
  // stays one-per-asset (mock parity). Its load state gates the grid alongside assets.
  const contractsQ = usePmContractList();
  const loading = assetsQ.isLoading || contractsQ.isLoading;

  // DEFAULT 4: the view toggle is cosmetic in the prototype (never re-filters the grid).
  const [view, setView] = useState<"month" | "quarter" | "year">("month");
  const [selDay, setSelDay] = useState<number | null>(null);

  const today = todayISO();

  const assets = useMemo(() => (assetsQ.data ?? []).map(toScheduleAsset), [assetsQ.data]);
  // Every dated asset, sorted by next_due ascending (pm2.jsx PMUpcoming order).
  const items = useMemo(() => scheduleItems(assets, today), [assets, today]);
  // FIXED June-2026 marks (scheduleDayMarks) — the same grid as pm.dashboard.
  const marks = useMemo(() => scheduleDayMarks(items), [items]);

  // The upcoming list filters to the selected calendar day (pm2.jsx PMUpcoming).
  const upcomingShown = useMemo<ScheduleItem[]>(
    () => (selDay == null ? items : items.filter((it) => it.day === selDay)),
    [items, selDay],
  );

  // Weekday header (Mon-first, exactly the prototype's order Mon..Sun).
  const weekdays = [
    t("pm.calDowMon"),
    t("pm.calDowTue"),
    t("pm.calDowWed"),
    t("pm.calDowThu"),
    t("pm.calDowFri"),
    t("pm.calDowSat"),
    t("pm.calDowSun"),
  ];
  const legend: { tone: ScheduleStatus; label: string }[] = [
    { tone: "overdue", label: t("pm.legendOverdue") },
    { tone: "due", label: t("pm.legendDue") },
    { tone: "plan", label: t("pm.legendPlan") },
  ];

  // View toggle options (cosmetic — DEFAULT 4).
  const viewOpts: { v: "month" | "quarter" | "year"; l: string }[] = [
    { v: "month", l: t("pm.viewMonth") },
    { v: "quarter", l: t("pm.viewQuarter") },
    { v: "year", l: t("pm.viewYear") },
  ];

  // genWO modal (pm2.jsx PMSchedule.genWO). Lists the due plan items (status != plan);
  // DEFAULT 1: confirm has no backing endpoint -> toast + navigate("pm.wo") only.
  // DEFAULT 2: the confirm/toast copy hardcodes a mock "3-unit" count, so it will not
  // match the live due-item count.
  const dueItems = useMemo(() => items.filter((it) => it.status !== "plan"), [items]);
  const openGenWO = () => {
    ctx.openModal({
      title: t("pm.genWoModalTitle"),
      subtitle: t("pm.genWoModalSubtitle"),
      icon: "wrench",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 12 }}>
            {t("pm.genWoInfoLine")}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}
          >
            {dueItems.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 9,
                }}
              >
                <Icon name="check" size={15} color="var(--ok)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name || DASH}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    <span className="num">{p.code || DASH}</span> {"·"}{" "}
                    {formatScheduleDate(p.nextDue).label || DASH} {"·"} {p.cycle || DASH}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("common.cancel")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="wrench"
              onClick={() => {
                // DEFAULT 1/2: no server mutation — toast (hardcoded mock count) + navigate.
                close();
                ctx.notify(t("pm.toastGenWo"));
                ctx.navigate("pm.wo");
              }}
            >
              {t("pm.genWoConfirmBtn")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbSchedule")]}
      title={t("pm.schedulePageTitle")}
      subtitle={t("pm.scheduleSubtitle")}
      actions={
        <>
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 9,
            }}
          >
            {viewOpts.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setView(o.v)}
                style={{
                  padding: "6px 14px",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 600,
                  background: view === o.v ? "var(--surface)" : "transparent",
                  color: view === o.v ? "var(--brand)" : "var(--text-2)",
                  boxShadow: view === o.v ? "var(--shadow-xs)" : "none",
                }}
              >
                {o.l}
              </button>
            ))}
          </div>
          <Btn kind="primary" size="md" icon="wrench" onClick={openGenWO}>
            {t("pm.genWoBtn")}
          </Btn>
        </>
      }
    >
      {loading ? (
        // Loading skeleton — an honest addition for the real data path (pm-assets.tsx
        // precedent); the mock always had rows so rendered none. Invisible to the
        // loaded-state visual reference.
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          {[0, 1].map((n) => (
            <div
              key={n}
              style={{
                height: 320,
                borderRadius: 12,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          <PMCalendar
            title={t("pm.calMonthTitle")}
            marks={marks}
            selected={selDay}
            onSelectDay={setSelDay}
            weekdays={weekdays}
            hint={t("pm.calHint")}
            legend={legend}
          />

          {/* Upcoming plan (pm2.jsx PMUpcoming) — filtered by the selected day. */}
          <Card pad={0}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                fontSize: 13.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>{t("pm.upcomingTitle")}</span>
              {selDay != null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>
                  {t("pm.upcomingSelDay").replace("{n}", String(selDay))}
                </span>
              )}
            </div>
            <div style={{ padding: 8 }}>
              {upcomingShown.length === 0 ? (
                <div
                  style={{
                    padding: "24px 12px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  {t("pm.upcomingEmpty")}
                </div>
              ) : (
                upcomingShown.map((p) => {
                  const c = toneColors(p.status);
                  const d = formatScheduleDate(p.nextDue);
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "10px 10px",
                        borderRadius: 9,
                      }}
                    >
                      <div style={{ width: 46, textAlign: "center", flexShrink: 0 }}>
                        <div className="num" style={{ fontSize: 13, fontWeight: 800, color: c.fg }}>
                          {d.day || DASH}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)" }}>{d.month}</div>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          borderLeft: "1px solid var(--border)",
                          paddingInlineStart: 11,
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name || DASH}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          <span className="num">{p.code || DASH}</span> {"·"} {p.cycle || DASH}
                        </div>
                      </div>
                      <button
                        type="button"
                        title={t("pm.createBtn")}
                        onClick={() => {
                          // DEFAULT 1: no backing endpoint — toast (asset code) + navigate.
                          ctx.notify(t("pm.toastGenWoAsset").replace("{name}", p.code || DASH));
                          ctx.navigate("pm.wo");
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="plus" size={14} color="var(--brand)" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
