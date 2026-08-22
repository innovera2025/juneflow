/*
 * ProjectTimeline — the project schedule screen (route `timeline`), ported from
 * pototype/timeline.jsx ProjectTimeline (L274-487) + TaskDetail (L492-524).
 * NAV-ROUTES.md:35 · component ProjectTimeline · B-424.
 *
 * Design fidelity (PLAN.md §0 rule 1): the section order (KPI row → S-curve →
 * milestone strip → Gantt), the 240px label column beside a proportional day
 * axis, the plan/actual double bar, the today-line, the month header and the
 * task-detail modal are the prototype's.
 *
 * NOT PORTED FROM THIS FILE: openImportBOQ / ImportBOQBody (L7-232). They are
 * exported onto `window` and called from bom.jsx and boq.jsx — a different
 * screen's feature that happens to share the file.
 *
 * MOCK MECHANICS DROPPED (rule 3): TIMELINE_TASKS / MILESTONES as constant
 * arrays, `TODAY_DAY = 145` and `totalDays = 240`. All three come from the wire
 * now — the axis is derived from the project's own start and end dates and the
 * SERVER's as-of date, so the today-line cannot drift with a browser clock.
 *
 * HONEST GAPS (em-dash, never fabricated) — each is a value the prototype prints
 * as a literal with nothing behind it:
 *   - every KPI sub-caption and delta badge. The five KPI VALUES are derived
 *     from the rows; the captions beside them quote percentages, team counts and
 *     month-on-month deltas that no column and no endpoint carries.
 *   - the Gantt footer's two lines: the left embeds a fixed calendar date, the
 *     right asserts that the project's delay is still manageable, which nothing
 *     computes.
 *   - the milestone notes under each label — `milestone` has no note column.
 *   - the task-detail related-documents list — there is no task-to-document join.
 * All of these are B-425, filed rather than guessed at.
 *
 * The S-curve is the real EVM series (B-426 records how it differs from the
 * mock's eight hardcoded monthly points).
 *
 * i18n (rule 2): every string is a timeline-strings.json phrase (tp) or a
 * timeline.* / common.* dict key (t). No Thai in this source (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { ChartCanvas, baseChartOpts } from "../../ui/chart";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { useBoqEvm } from "../boq/use-boq-reports";
import { useProjectTimeline } from "./use-timeline";
import {
  bandColor,
  barGeometry,
  pctOfAxis,
  scurveFromEvm,
  timelineAxis,
  timelineKpis,
  toGanttGroups,
  toMilestonePoints,
  type GanttTask,
  type MilestonePoint,
  type TimelineAxis,
} from "./timeline-rows";
import strings from "./timeline-strings.json" with { type: "json" };

/** The screen's honest-unknown marker. */
const DASH = "—";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/** Status to the bar's fill, following the prototype's own three states. */
function barTone(task: GanttTask): string {
  if ((task.lateDays ?? 0) > 0) return "var(--warn)";
  if (task.status === "done") return "var(--ok)";
  return "var(--brand)";
}

/** The Gantt's fixed left column, matching the prototype's 240px label gutter. */
const labelCol: CSSProperties = { width: 240, minWidth: 240 };

interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  accent?: string;
}

/**
 * KPI card — the dashboard's Kpi shape without its delta badge and sub-caption,
 * because on this screen both would have to be invented (B-425). The slot is kept
 * and rendered em-dash so the card's height still matches the prototype's.
 */
function Kpi({ label, value, unit, accent }: KpiProps) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{DASH}</div>
    </Card>
  );
}

/** A read-only scope chip (label + value) — the prototype's header Filter. */
function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 11px",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "var(--surface)",
        fontSize: 12.5,
        color: "var(--text-2)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
    </span>
  );
}

/**
 * The month columns the Gantt header shows, derived from the project window.
 * The prototype hardcodes eight; a project can start in any month and run any
 * length, so the columns are the calendar months the window actually spans.
 */
function monthColumns(axis: TimelineAxis): { key: keyof typeof strings; id: string }[] {
  if (!axis.startDate || axis.totalDays == null) return [];
  const start = new Date(`${axis.startDate}T00:00:00Z`);
  const endMs = start.getTime() + axis.totalDays * 86_400_000;
  const months: { key: keyof typeof strings; id: string }[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= endMs && months.length < 36) {
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    months.push({ key: `month${mm}` as keyof typeof strings, id: `${cursor.getUTCFullYear()}-${mm}` });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
  }
  return months;
}

/**
 * The modal descriptor the panel opens with — pure, so the parts that never reach
 * the screen's own markup can still be asserted. gate 4.5 found the descriptor
 * untested: reverting `iconTone` to a generic token or dropping the subtitle
 * killed nothing, because ctx.openModal is mocked away and the object was never
 * read.
 *
 * The icon tone is the BAND's colour, as the prototype sets it
 * (timeline.jsx:435 `iconTone: g.color`).
 */
export function taskModalDescriptor(
  task: GanttTask,
  group: string,
  t: (key: string) => string,
): { title: string; subtitle: string; icon: string; iconTone: string; size: string } {
  return {
    title: task.label || DASH,
    subtitle: t("timeline.taskModalSubtitle").replace("{group}", group || DASH),
    icon: "calendar",
    iconTone: bandColor(group),
    size: "md",
  };
}

/**
 * The task-detail panel (prototype TaskDetail, timeline.jsx:492-523).
 *
 * ONE ELEMENT IS OMITTED, and only one: the related-documents list. Its four rows
 * are hardcoded document numbers in the mock ("BOQ-2026-B-02", "WO-2026-0117", …)
 * and there is no task-to-document join anywhere in the schema, so every row would
 * be invented. Its two footer buttons ARE ported — both routes exist.
 *
 * Everything else the prototype prints is here, because every one of them has a
 * source: the group, the status, both windows, the percent and the stated delay.
 */
export function TaskDetail({
  task,
  group,
  onClose,
  onNavigate,
}: {
  task: GanttTask;
  group: string;
  onClose: () => void;
  onNavigate: (route: string) => void;
}) {
  const { t, tp } = useI18n();
  const range = (w: readonly [number, number | null] | null): string =>
    w == null
      ? DASH
      : t("timeline.dateRange" as DictKey)
          .replace("{from}", String(w[0]))
          // An open window runs to "now", which is the prototype's own word for it
          // — not an em-dash, because the end is not unknown, it is ongoing.
          .replace("{to}", w[1] == null ? tp(P("openEnded")) : String(w[1]));
  const statusLabel =
    task.status === "done"
      ? t("timeline.statusDone" as DictKey)
      : task.status === "ongoing"
        ? tp(P("statusOngoing"))
        : t("timeline.statusNotStarted" as DictKey);
  const late = (task.lateDays ?? 0) > 0;

  const field = (label: string, value: ReactNode, style?: CSSProperties) => (
    <div>
      <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{label}</span>
      <div style={{ fontWeight: 600, marginTop: 2, ...style }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
          {field(tp(P("fieldGroup")), group || DASH)}
          {field(tp(P("fieldStatus")), statusLabel)}
          {field(tp(P("legendPlan")), <span className="num">{range(task.plan)}</span>)}
          {/* A null `actual` is not an unknown window — it is the answer "this has
              not started" (timeline.jsx:501), the same argument as the on-schedule
              cell below. Five of the thirteen seeded rows land here. */}
          {field(
            tp(P("legendActual")),
            task.actual == null ? (
              t("timeline.statusNotStarted" as DictKey)
            ) : (
              <span className="num">{range(task.actual)}</span>
            ),
          )}
          {field(
            tp(P("fieldProgress")),
            <span className="num">{task.pct == null ? DASH : `${task.pct}%`}</span>,
            { fontWeight: 700 },
          )}
          {/* "on schedule" is a real answer, not an unknown: `late` is a column the
              server filled in. An em-dash here would claim ignorance about
              something that was measured. */}
          {field(
            t("timeline.fieldDelay" as DictKey),
            late
              ? t("timeline.delayValue" as DictKey).replace("{days}", String(task.lateDays))
              : tp(P("onSchedule")),
            { color: late ? "var(--warn)" : "var(--ok)" },
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {tp(P("closeBtn"))}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="ghost" size="md" icon="hardhat" onClick={() => onNavigate("subcon")}>
          {t("timeline.btnSubconProgress" as DictKey)}
        </Btn>
        <Btn kind="primary" size="md" icon="link" onClick={() => onNavigate("boq.overview")}>
          {t("timeline.btnBoq" as DictKey)}
        </Btn>
      </div>
    </div>
  );
}

export function ProjectTimeline() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const projectId = active?.id;

  const timelineQ = useProjectTimeline(projectId);
  const evmQ = useBoqEvm(projectId);

  const wire = timelineQ.data ?? null;
  const axis = useMemo(
    () => timelineAxis(wire?.start_date ?? null, wire?.end_date ?? null, wire?.as_of_date ?? null),
    [wire],
  );
  const groups = useMemo(() => toGanttGroups(wire?.tasks ?? [], wire?.start_date ?? null), [wire]);
  const points = useMemo(() => toMilestonePoints(wire?.milestones ?? []), [wire]);
  const kpis = useMemo(() => timelineKpis(wire?.tasks ?? [], wire?.milestones ?? [], axis), [wire, axis]);
  const curve = useMemo(() => scurveFromEvm(evmQ.data?.series ?? []), [evmQ.data]);
  const months = useMemo(() => monthColumns(axis), [axis]);

  /**
   * The task panel opens through ctx.openModal, the shell's ported modal
   * (ui/modal.tsx) — the same door 105 other screens use and the one the
   * prototype itself calls (timeline.jsx:432-437). The first version of this
   * screen hand-rolled an overlay, which lost the title, the subtitle, the icon,
   * Escape-to-close and the size scale, and left the subtitle key minted but
   * unused.
   */
  const openTaskDetail = (task: GanttTask, group: string) => {
    ctx.openModal({
      ...taskModalDescriptor(task, group, (k) => t(k as DictKey)),
      body: ({ close }: { close: () => void }) => (
        <TaskDetail
          task={task}
          group={group}
          onClose={close}
          onNavigate={(route) => {
            close();
            ctx.navigate(route, {});
          }}
        />
      ),
    });
  };

  const num = (v: number | null, digits = 0): string => (v == null ? DASH : v.toFixed(digits));

  return (
    <Page
      breadcrumbs={[tp(P("crumbMain")), tp(P("crumbSelf"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Both chips display the resolved scope; neither filters. The
              prototype's were static labels, and a filter control with no
              endpoint behind it is a control that does nothing. The phase chip
              has no source at all — there is no phase column on the wire. */}
          <FilterChip label={tp(P("filterProject"))} value={active?.name ?? DASH} />
          <FilterChip label={tp(P("filterPhase"))} value={DASH} />
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("toastExport")))}>
            {t("vendor.btnExport" as DictKey)}
          </Btn>
          <Btn
            kind="primary"
            size="md"
            icon="sync"
            onClick={() => {
              void timelineQ.refetch();
              void evmQ.refetch();
              ctx.notify(t("timeline.toastRefreshWo" as DictKey));
            }}
          >
            {tp(P("btnRefreshWo"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip — values derived from the rows; every sub-caption the
          prototype hardcodes has no source and renders em-dash (B-425). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi label={tp(P("kpiProgress"))} value={num(kpis.progressPct)} unit="%" accent="var(--accent)" />
        <Kpi label={tp(P("kpiOngoing"))} value={kpis.ongoingCount} />
        <Kpi label={tp(P("kpiLate"))} value={kpis.lateCount} accent={kpis.lateCount > 0 ? "var(--warn)" : undefined} />
        <Kpi label={tp(P("kpiMilestone"))} value={kpis.upcomingMilestones} />
        <Kpi label={tp(P("kpiDueWeek"))} value={kpis.dueThisWeek ?? DASH} />
      </div>

      {/* S-curve — the REAL EVM series (B-426), not the mock's eight fixed points. */}
      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{tp(P("scurveTitle"))}</div>
          <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 16, height: 2, background: "var(--accent)", borderRadius: 1 }} />
              {tp(P("legendPlan"))}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 16, height: 2, background: "var(--brand)", borderRadius: 1 }} />
              {tp(P("legendActual"))}
            </span>
          </div>
        </div>
        {curve ? (
          <ChartCanvas
            height={220}
            deps={[curve]}
            build={(theme) => ({
              type: "line",
              data: {
                labels: curve.labels,
                datasets: [
                  {
                    label: tp(P("seriesPlan")),
                    data: curve.plan,
                    borderColor: theme.accent,
                    borderWidth: 2.5,
                    tension: 0.35,
                    fill: false,
                  },
                  {
                    label: tp(P("seriesActual")),
                    data: curve.actual,
                    borderColor: theme.brand,
                    borderWidth: 2.5,
                    tension: 0.35,
                    fill: false,
                  },
                ],
              },
              options: baseChartOpts(theme, {
                scales: {
                  x: { grid: { display: false }, ticks: { color: theme.text } },
                  y: { grid: { color: theme.grid }, ticks: { color: theme.text }, beginAtZero: true, max: 100 },
                },
              }),
            })}
          />
        ) : (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
            }}
          >
            {DASH}
          </div>
        )}
      </Card>

      {/* Milestone strip — positioned by each milestone's own day offset. */}
      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{tp(P("msTitle"))}</div>
        {points.length ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            {points.map((m: MilestonePoint) => {
              const tone =
                m.status === "done" ? "var(--ok)" : m.status === "ongoing" ? "var(--brand)" : "var(--text-3)";
              return (
                <div
                  key={m.id}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: m.status === "done" || m.status === "ongoing" ? tone : "transparent",
                      border: `2px solid ${tone}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {m.status === "done" && <Icon name="check" size={12} color="#fff" />}
                  </div>
                  <div style={{ textAlign: "center", maxWidth: 130 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.3 }}>{m.label || DASH}</div>
                    {/* The prototype prints a caption under the label; `milestone`
                        has no note column, so the slot carries the real date
                        instead of an invented one. */}
                    <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>
                      {m.date ?? DASH}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>{DASH}</div>
        )}
      </Card>

      {/* Gantt */}
      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t("timeline.ganttTitle" as DictKey)}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                {t("timeline.ganttSubtitle" as DictKey)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-2)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 8, background: "var(--surface-3)", borderRadius: 2 }} />
                {tp(P("seriesPlan"))}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 8, background: "var(--brand)", borderRadius: 2 }} />
                {t("timeline.legendActual" as DictKey)}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 8, background: "var(--warn)", borderRadius: 2 }} />
                {t("timeline.legendLate" as DictKey)}
              </span>
            </div>
          </div>
        </div>

        {/* Month header — one column per calendar month the window spans. */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div
            style={{
              ...labelCol,
              padding: "8px 14px",
              fontSize: 11,
              color: "var(--text-3)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {t("timeline.colGroupTask" as DictKey)}
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, months.length)}, 1fr)` }}>
            {months.map((m, i) => (
              <div
                key={m.id}
                style={{
                  padding: "8px 6px",
                  fontSize: 11,
                  color: "var(--text-3)",
                  fontWeight: 700,
                  textAlign: "center",
                  borderLeft: i > 0 ? "1px dashed var(--border)" : "none",
                }}
              >
                {tp(P(m.key))}
              </div>
            ))}
          </div>
        </div>

        {groups.length === 0 ? (
          // No axis (an unscheduled project) or no rows — an empty chart, never a
          // bar placed on today.
          <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>{DASH}</div>
        ) : (
          groups.map((band, bi) => (
            <div key={band.group || bi}>
              <div
                style={{
                  display: "flex",
                  background: `color-mix(in srgb, ${bandColor(band.group)} 6%, var(--surface))`,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    ...labelCol,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: bandColor(band.group),
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon name="chevD" size={11} />
                  {band.group || DASH}
                </div>
                <div style={{ flex: 1 }} />
              </div>

              {band.tasks.map((task) => {
                const plan = barGeometry(task.plan, axis);
                const actual = barGeometry(task.actual, axis);
                const late = (task.lateDays ?? 0) > 0;
                return (
                  <div key={task.id} style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
                    <div style={{ ...labelCol, padding: "10px 14px" }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{task.label || DASH}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 10.5 }}>
                        <span className="num" style={{ color: "var(--text-3)" }}>
                          {task.pct == null ? DASH : `${task.pct}%`}
                        </span>
                        {late && (
                          <span style={{ color: "var(--warn)", fontWeight: 700 }}>
                            {t("timeline.lateBadge" as DictKey).replace("{days}", String(task.lateDays))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{ flex: 1, position: "relative", padding: "10px 0", cursor: "pointer" }}
                      onClick={() => openTaskDetail(task, band.group)}
                    >
                      {plan && (
                        <div
                          style={{
                            position: "absolute",
                            left: `${plan.left}%`,
                            width: `${plan.width}%`,
                            top: 12,
                            height: 8,
                            background: "var(--surface-3)",
                            borderRadius: 2,
                          }}
                        />
                      )}
                      {actual && (
                        <div
                          style={{
                            position: "absolute",
                            left: `${actual.left}%`,
                            width: `${actual.width}%`,
                            top: 22,
                            height: 8,
                            background: barTone(task),
                            borderRadius: 2,
                          }}
                        />
                      )}
                      {axis.todayDay != null && axis.totalDays != null && (
                        <div
                          style={{
                            position: "absolute",
                            left: `${pctOfAxis(axis.todayDay, axis.totalDays)}%`,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: "var(--danger)",
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/* The prototype's footer prints a fixed calendar date on the left and an
            unsourced judgement on the right (B-425). The day counter behind the
            left one is real, so it is kept and the rest is not invented. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-3)",
          }}
        >
          <span className="num">
            {axis.todayDay != null && axis.totalDays != null ? `${axis.todayDay} / ${axis.totalDays}` : DASH}
          </span>
          <span>{DASH}</span>
        </div>
      </Card>

    </Page>
  );
}
