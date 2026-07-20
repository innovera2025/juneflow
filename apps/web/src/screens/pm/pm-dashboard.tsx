/*
 * PMDashboard — the read-only PM KPI overview (route pm.dashboard), ported from
 * pototype/pm.jsx PMKpi (L74-90) + PMDashboard (L95-150) and pototype/pm2.jsx
 * PMCalendar (L552-590) + PMUpcoming (L592-623). Registry mod "pm" (routes/
 * registry.ts L117). Wei B-108d: this is a WEB-SIDE derivation over the existing PM
 * reads — no new endpoint.
 *
 * Design fidelity (PLAN.md section 0 rule 1): the two-crumb breadcrumb (PM root /
 * PM Dashboard), the title + subtitle, the two header actions (Export / work-order),
 * the 5-card KPI strip, the "1.6fr 1fr" split (calendar left; near/overdue panel +
 * upcoming right), and the calendar's weekday row + day grid + legend are the
 * prototype's. The PMKpi / PMCalendar / PMUpcoming primitives are inlined here (like
 * wo-list.tsx inlines MiniKpi/StatusBadge) — the mock's popover mechanics are dropped
 * (rule 3).
 *
 * Data (rules 3/4): two TanStack Query reads via the generated client —
 * usePmAssetList() (GET /pm/assets) + useWorkOrderList() (GET /pm/workorders). All
 * KPI/panel/calendar values are computed in the pure, unit-tested pm-dashboard-rows.ts
 * (G3). Nothing is fabricated: an unbacked metric renders an em-dash.
 *
 * REAL vs em-dash (reported honestly):
 *   - Overdue KPI + panel-header count = REAL (assets next_due < today).
 *   - Compliance % KPI = REAL (checklist items normal / any-result-set; DEFAULT 1
 *     pass = 'normal'); em-dash when no item has a result yet.
 *   - near/overdue panel + upcoming list + calendar marks = REAL (asset next_due).
 *   - Asset name + code (id line) = REAL (migration 0034, B-110).
 *   DEFAULT em-dash KPIs (unbacked wire — see the FLAGs below):
 *   - DEFAULT 2 "this-month WO" (workOrderWire has no created_at/status) -> em-dash
 *     value + em-dash "done/remaining" sub.
 *   - DEFAULT 3 "pending quotes" (B-108d names only workorders+assets; derivable from
 *     GET /pm/quotes only if Wei admits that source) -> em-dash value.
 *   - DEFAULT 4 "cost YTD" (no cost/spend column on any wire) -> em-dash VALUE; its
 *     period sub-caption is now the keyed pm.kpiCostYtdSub (B-115, static period label).
 *   Calendar month = the FIXED prototype grid (Wei 2026-07-20): the title is the
 *   verbatim pm.calMonthTitle ("June 2569") and 30 day cells (1..30) draw straight
 *   into the 7-column grid with no weekday offset; marks derive only from June-2026
 *   assets (calendarMarks). This replaces the earlier dynamic-month divergence — the
 *   calendar is now the prototype's fixed month verbatim, so no divergence flag remains.
 *
 * i18n (rule 2): every visible string is a pm.* / common.* dict key (t). The near/
 * overdue panel's due badge uses pm.statusDue — the canonical near-due key (B-115)
 * whose value is the prototype's PM_STATUS.due.l "near due" wording (pm.jsx L34).
 * The overdue badge uses pm.legendOverdue, whose value already matches. The calendar
 * legend keeps pm.legendOverdue / pm.legendDue / pm.legendPlan (the swatch labels). The
 * "%" unit is a literal symbol
 * (precedent: dashboard.tsx / exec.tsx). No Thai literal lives in source (rule 2);
 * tokens back every colour (rule 6); "#B45309" is the prototype-verbatim cost accent
 * (B-037(a) prototype-verbatim-hex precedent).
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { usePmAssetList, useWorkOrderList } from "./use-pm";
import {
  toDashAsset,
  toDashWo,
  overdueCount,
  compliancePct,
  duePanelRows,
  upcomingRows,
  calendarMarks,
  PM_CALENDAR_DAYS,
  formatUpcomingDate,
  todayISO,
  type DueTone,
  type PanelRow,
  type UpcomingRow,
} from "./pm-dashboard-rows";

/** Em-dash for every honest wire gap / unbacked metric (never a fabricated value). */
const DASH = "—";
/** Compliance unit — a literal symbol, not translatable (dashboard.tsx precedent). */
const PERCENT = "%";
/** Prototype-verbatim cost-YTD accent (pm.jsx L114) — B-037(a) verbatim-hex precedent. */
const COST_ACCENT = "#B45309";

/** KPI card, inlined from pm.jsx PMKpi (L74-90). Accent tints the icon chip + value. */
function PMKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent: string;
  icon: IconName;
}) {
  return (
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Soft-tone tokens for a schedule tone (prototype danger/warn soft surfaces). */
function toneColors(tone: DueTone): { soft: string; fg: string } {
  if (tone === "overdue") return { soft: "var(--danger-soft)", fg: "var(--danger)" };
  if (tone === "due") return { soft: "var(--warn-soft)", fg: "var(--warn)" };
  return { soft: "var(--brand-soft)", fg: "var(--brand)" };
}

/** Panel status badge (ds.jsx StatusBadge, size sm) — overdue/due soft pill. */
function ToneBadge({ tone, label }: { tone: "overdue" | "due"; label: string }) {
  const c = toneColors(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: c.soft,
        color: c.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg }} />
      {label}
    </span>
  );
}

/**
 * PMCalendar (pm2.jsx L552-591) — the FIXED prototype grid (Wei 2026-07-20). The title
 * is the verbatim pm.calMonthTitle ("June 2569"); the grid draws a static weekday
 * header then 30 day cells (1..30) straight into the 7-column grid with NO weekday
 * offset (exactly as the prototype draws it, not a real month's first-weekday). Day
 * marks derive only from June-2026 asset next_due (calendarMarks). Clicking a day
 * toggles the selectedDay that filters the upcoming list.
 */
function PMCalendar({
  title,
  dayCount,
  marks,
  selected,
  onSelectDay,
  weekdays,
  hint,
  legend,
}: {
  title: string;
  dayCount: number;
  marks: Map<number, DueTone>;
  selected: number | null;
  onSelectDay: (day: number | null) => void;
  weekdays: readonly string[];
  hint: string;
  legend: readonly { tone: DueTone; label: string }[];
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
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{hint}</span>
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
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => {
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
                  textAlign: "left",
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
                      left: 5,
                      right: 5,
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

export function PMDashboard() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = usePmAssetList();
  const wosQ = useWorkOrderList();

  const [selDay, setSelDay] = useState<number | null>(null);

  const today = todayISO();

  const assets = useMemo(() => (assetsQ.data ?? []).map(toDashAsset), [assetsQ.data]);
  const wos = useMemo(() => (wosQ.data ?? []).map(toDashWo), [wosQ.data]);

  const overdue = useMemo(() => overdueCount(assets, today), [assets, today]);
  const compliance = useMemo(() => compliancePct(wos), [wos]);
  const panelRows = useMemo(() => duePanelRows(assets, today), [assets, today]);
  const upcoming = useMemo(() => upcomingRows(assets, today), [assets, today]);
  const marks = useMemo(() => calendarMarks(assets, today), [assets, today]);
  // FIXED prototype grid (Wei 2026-07-20): the title is the verbatim June-2569 key and
  // the grid is always 30 cells (1..30) — neither is computed from `today`.
  const dayCount = PM_CALENDAR_DAYS;
  const calTitle = t("pm.calMonthTitle");

  // The upcoming list filters to the selected calendar day (pm2.jsx PMUpcoming).
  const upcomingShown = useMemo<UpcomingRow[]>(
    () => (selDay == null ? upcoming : upcoming.filter((u) => u.day === selDay)),
    [upcoming, selDay],
  );

  const weekdays = [
    t("pm.calDowMon"),
    t("pm.calDowTue"),
    t("pm.calDowWed"),
    t("pm.calDowThu"),
    t("pm.calDowFri"),
    t("pm.calDowSat"),
    t("pm.calDowSun"),
  ];
  const legend: { tone: DueTone; label: string }[] = [
    { tone: "overdue", label: t("pm.legendOverdue") },
    { tone: "due", label: t("pm.legendDue") },
    { tone: "plan", label: t("pm.legendPlan") },
  ];
  // The near/overdue panel badge: overdue -> pm.legendOverdue (value already matches);
  // due -> pm.statusDue, the canonical near-due key (B-115) whose value is the
  // prototype's PM_STATUS.due.l "near due" wording (pm.jsx L34). The calendar legend
  // keeps pm.legendDue for its own "due" swatch.
  const badgeLabel = (tone: "overdue" | "due"): string =>
    tone === "overdue" ? t("pm.legendOverdue") : t("pm.statusDue");

  // Export modal (pm.jsx openPMExport, mirrors pm-assets.tsx) — presentational.
  const openExport = () => {
    const what = t("pm.exportReportTitle");
    const opts: { ic: IconName; l: string }[] = [
      { ic: "grid", l: t("pm.exportExcel") },
      { ic: "doc", l: t("pm.exportPdf") },
      { ic: "download", l: t("pm.exportCsv") },
    ];
    ctx.openModal({
      title: t("pm.exportModalTitle"),
      subtitle: what,
      icon: "download",
      iconTone: "var(--brand)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {opts.map((o) => (
            <button
              key={o.l}
              type="button"
              onClick={() => {
                close();
                ctx.notify(t("pm.toastDownloading").replace("{name}", what).replace("{fmt}", o.l));
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--surface)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <Icon name={o.ic} size={18} color="var(--brand)" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{o.l}</span>
              <Icon name="arrowR" size={15} color="var(--text-3)" />
            </button>
          ))}
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbDashboard")]}
      title={t("pm.dashPageTitle")}
      subtitle={t("pm.dashSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={openExport}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => ctx.navigate("pm.wo")}>
            {t("pm.breadcrumbWo")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5). Overdue + Compliance are REAL; the other three are DEFAULT
          em-dash placeholders (unbacked wire — see header FLAGs 2/3/4). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        {/* DEFAULT 2: no created_at/status on workOrderWire -> em-dash value + sub. */}
        <PMKpi
          label={t("pm.kpiJobsThisMonth")}
          value={DASH}
          sub={t("pm.kpiJobsThisMonthSub").replace("{n}", DASH).replace("{count}", DASH)}
          accent="var(--brand)"
          icon="wrench"
        />
        {/* REAL compliance (DEFAULT 1 pass = 'normal'); em-dash when no result yet. */}
        <PMKpi
          label={t("pm.kpiCompliance")}
          value={compliance ?? DASH}
          unit={compliance != null ? PERCENT : undefined}
          sub={t("pm.kpiComplianceSub")}
          accent="var(--ok)"
          icon="gauge"
        />
        {/* REAL overdue count (assets next_due < today). */}
        <PMKpi
          label={t("pm.kpiOverdue")}
          value={String(overdue)}
          unit={t("pm.unitItems")}
          sub={t("pm.kpiOverdueSub")}
          accent="var(--danger)"
          icon="warn"
        />
        {/* DEFAULT 3: B-108d names only workorders+assets -> em-dash (static sub kept). */}
        <PMKpi
          label={t("pm.kpiQuotePending")}
          value={DASH}
          sub={t("pm.kpiQuoteSub")}
          accent="var(--warn)"
          icon="doc"
        />
        {/* DEFAULT 4: no cost/spend column on any wire -> em-dash VALUE; the period
            sub-caption is the keyed pm.kpiCostYtdSub (B-115, static period label). */}
        <PMKpi
          label={t("pm.kpiCostYtd")}
          value={DASH}
          sub={t("pm.kpiCostYtdSub")}
          accent={COST_ACCENT}
          icon="cash"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <PMCalendar
          title={calTitle}
          dayCount={dayCount}
          marks={marks}
          selected={selDay}
          onSelectDay={setSelDay}
          weekdays={weekdays}
          hint={t("pm.calHint")}
          legend={legend}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Near / overdue panel (pm.jsx L121-143). Header count = REAL overdue. */}
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
              <span>{t("pm.dueOverduePanelTitle")}</span>
              <span
                className="num"
                style={{ fontSize: 11, color: "var(--danger)", fontWeight: 700 }}
              >
                {t("pm.overdueCount").replace("{n}", String(overdue))}
              </span>
            </div>
            <div style={{ padding: 8 }}>
              {panelRows.length === 0 ? (
                // Honest empty state (DEFAULT 6: current seed is all future-dated).
                <div style={{ padding: "28px 12px", textAlign: "center" }}>
                  <Icon name="clock" size={22} color="var(--text-3)" style={{ opacity: 0.4 }} />
                </div>
              ) : (
                panelRows.map((a: PanelRow) => {
                  const c = toneColors(a.tone);
                  return (
                    <div
                      key={a.id}
                      onClick={() => ctx.navigate("pm.assets")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "10px 10px",
                        borderRadius: 9,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          flexShrink: 0,
                          background: c.soft,
                          color: c.fg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name={a.tone === "overdue" ? "warn" : "clock"} size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.name || DASH}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          <span className="num">{a.code || DASH}</span>{" "}
                          {t("pm.assetDueLine").replace("{date}", a.nextDue || DASH)}
                        </div>
                      </div>
                      <ToneBadge tone={a.tone} label={badgeLabel(a.tone)} />
                    </div>
                  );
                })
              )}
            </div>
          </Card>

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
                  style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--text-3)" }}
                >
                  {t("pm.upcomingEmpty")}
                </div>
              ) : (
                upcomingShown.map((p) => {
                  const c = toneColors(p.tone);
                  const d = formatUpcomingDate(p.nextDue);
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
                          paddingLeft: 11,
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
                          // pm2.jsx used the asset CODE as the toast identifier.
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
      </div>
    </Page>
  );
}
