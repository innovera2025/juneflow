/*
 * LaborAttendance — the daily attendance sheet, ported from pototype/labor.jsx
 * LaborAttendance (L108-185) + its ATT_OPTS status config (L103-107) + the shared ds.jsx
 * Kpi (dashboard.jsx L93-115). Route labor.attendance (registry.ts L114, mod "labor").
 *
 * READ-ONLY display port. The prototype is a WRITE form (status buttons, OT steppers, a
 * Save action). Section 0 rule 3: those write mechanics become an honest read — the status
 * buttons + OT steppers render but are non-interactive, the Save button is honest-disabled,
 * and the saved-badge / save-toast are omitted. The roster + worker_id -> name/team/skill/
 * day_rate join come from GET /labor/workers; the per-worker status/ot for the shown day
 * come from GET /labor/attendance (use-labor.ts). Pure narrowing / day selection / cost
 * projection / aggregates live in labor-attendance-rows.ts (unit-tested, gate G3).
 *
 * Honest divergences (reported, never fabricated):
 *   - SINGLE-DAY SCOPE (needs a Wei ruling): no authoritative header date / day-picker
 *     exists; the interim shown day is the LATEST `day` present, rendered raw in the
 *     subtitle {date}; when no attendance row exists the date is an em-dash.
 *   - Subtitle {site}: there is no site field on any labor wire -> em-dash.
 *   - A worker with no record for the shown day is honest-empty (no status selected, OT
 *     em-dash, cost em-dash).
 *   - The day cost is a client-side DISPLAY projection using the SERVER day_fraction; a
 *     null day_rate -> em-dash. Authoritative labor money is server POST /labor/payroll.
 *   - Save button (POST /labor/attendance) -> honest-DISABLED. Team filter is functional
 *     (client-side roster filter). Loading = skeleton; no active workers = empty state.
 *
 * i18n (section 0 rule 2, ZERO-sacred borrow round): every static string resolves to an
 * existing labor.att.* / labor.* / nav.sec.main key, or a cross-module BORROW whose `th`
 * value byte-matches: org.noteCountUnit (person unit), subcon.unitBaht (baht symbol). Nothing is minted.
 * Server data (name/team/skill) renders raw (rule 3). Tokens back every colour; the KPI
 * accents var(--ok)/#B45309/var(--brand) are prototype-verbatim (labor.jsx L133-136).
 * Numeric cells carry class `num`.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { toWorkerRow, distinctTeams, filterByTeam, fmt, type WorkerRow } from "./labor-workers-rows";
import {
  toAttRecord,
  activeWorkers,
  latestDay,
  recordsForDay,
  dayCost,
  presentCount,
  absentCount,
  totalOt,
  totalCost,
} from "./labor-attendance-rows";
import { useLaborWorkers, useLaborAttendance } from "./use-labor";

/** The literal em-dash for a missing record / undefined date / null cost. */
const DASH = "—";

/**
 * ATT_OPTS ported from labor.jsx L103-107 — the 3 status options. The prototype's pay
 * factor `f` is dropped (the SERVER day_fraction is authoritative); each option keeps its
 * i18n label key + token colour. Read-only: the buttons render the actual status but are
 * non-interactive.
 */
const ATT_OPTS: readonly { v: string; labelKey: DictKey; color: string }[] = [
  { v: "full", labelKey: "labor.att.optFull", color: "var(--ok)" },
  { v: "half", labelKey: "labor.att.optHalf", color: "var(--warn)" },
  { v: "absent", labelKey: "labor.att.optAbsent", color: "var(--danger)" },
];

/** Table header cell style, ported from ds.jsx th() — align param honours the spec cols. */
function th(w?: number, align: "left" | "center" | "right" = "left"): CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td(). */
function td(align: "left" | "center" | "right" = "left"): CSSProperties {
  return { padding: "14px", verticalAlign: "middle", textAlign: align };
}

/** Kpi, ported from dashboard.jsx Kpi (L93-115) — the label/value/unit/sub/accent subset. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Filter pill (native <select> styled like ds.jsx Dropdown mode="filter", muted). */
function FilterSelect({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={{
        height: 34,
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--surface)",
        color: "var(--text-2)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {children}
    </select>
  );
}

/** Non-interactive OT stepper button (read-only chrome, ds.jsx L165/L167 geometry). */
function StepBtn({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        cursor: "default",
        fontWeight: 700,
        color: "var(--text-3)",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export function LaborAttendance() {
  const { t } = useI18n();

  const workersQ = useLaborWorkers();
  const attendanceQ = useLaborAttendance();

  const [team, setTeam] = useState("");

  const docs = useMemo<WorkerRow[]>(() => (workersQ.data ?? []).map(toWorkerRow), [workersQ.data]);
  const records = useMemo(() => (attendanceQ.data ?? []).map(toAttRecord), [attendanceQ.data]);

  const roster = useMemo(() => activeWorkers(docs), [docs]);
  const teams = useMemo(() => distinctTeams(roster), [roster]);
  const shownDay = useMemo(() => latestDay(records), [records]);
  const recMap = useMemo(() => recordsForDay(records, shownDay), [records, shownDay]);
  const list = useMemo(() => filterByTeam(roster, team), [roster, team]);

  // KPIs derive over the FULL active roster (prototype uses `workers`, not the filtered list).
  const total = roster.length;
  const present = presentCount(roster, recMap);
  const absent = absentCount(roster, recMap);
  const totOt = totalOt(roster, recMap);
  const totCost = totalCost(roster, recMap);

  const unitPerson = t("org.noteCountUnit"); // BORROW: person unit
  const unitBaht = t("subcon.unitBaht"); // BORROW: baht symbol
  const unitBahtDay = t("labor.unitBahtDay");

  const isLoading = workersQ.isLoading || attendanceQ.isLoading;

  const subtitle = t("labor.att.subtitle")
    .replace("{date}", shownDay || DASH)
    .replace("{site}", DASH);

  return (
    <Page
      breadcrumbs={[t("nav.sec.main"), t("labor.crumbSection"), t("labor.att.title")]}
      title={t("labor.att.title")}
      subtitle={subtitle}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <FilterSelect value={team} onChange={setTeam} ariaLabel={t("labor.team")}>
            <option value="">{t("labor.filterAllTeams")}</option>
            {teams.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </FilterSelect>
          {/* Honest-DISABLED: Save posts to /labor/attendance — a write, out of this display round. */}
          <Btn kind="primary" size="md" icon="check" disabled>
            {t("labor.att.btnSave")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — present/total · OT total · cost total · posting target. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("labor.att.kpiPresentLabel")}
          value={`${present}/${total}`}
          unit={unitPerson}
          sub={t("labor.att.kpiPresentSub").replace("{absent}", String(absent))}
          accent="var(--ok)"
        />
        <Kpi
          label={t("labor.att.kpiOtLabel")}
          value={String(totOt)}
          unit={t("labor.unitHours")}
          sub={t("labor.att.kpiOtSub")}
          accent="#B45309"
        />
        <Kpi
          label={t("labor.att.kpiCostLabel")}
          value={fmt(totCost)}
          unit={unitBaht}
          sub={t("labor.att.kpiCostSub")}
          accent="var(--brand)"
        />
        <Kpi
          label={t("labor.att.kpiPostLabel")}
          value={t("labor.att.kpiPostValue")}
          sub={t("labor.att.kpiPostSub")}
          accent="var(--ok)"
        />
      </div>

      <Card pad={0}>
        {isLoading ? (
          // Loading skeleton — token blocks, no invented copy.
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 48, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th()}>{t("labor.thWorker")}</th>
                  <th scope="col" style={th(150)}>{t("labor.team")}</th>
                  <th scope="col" style={th(220, "center")}>{t("labor.att.thStatusToday")}</th>
                  <th scope="col" style={th(140, "center")}>{t("labor.thOtHours")}</th>
                  <th scope="col" style={th(120, "right")}>{t("labor.att.thCostToday")}</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  // Honest empty state — icon only, no minted / semantically-wrong copy
                  // (no labor-scoped "no data" dict key exists to reuse).
                  <tr>
                    <td colSpan={5} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="users" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  list.map((w) => {
                    const r = recMap.get(w.id);
                    const isAbsent = r?.status === "absent";
                    const cost = dayCost(w.dayRate, r);
                    return (
                      <tr
                        key={w.id}
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: isAbsent ? "color-mix(in srgb, var(--danger-soft) 40%, white)" : "transparent",
                        }}
                      >
                        {/* worker: name + [code · skill · day-rate + per-day unit] subline */}
                        <td style={td()}>
                          <div style={{ fontWeight: 600 }}>{w.name || DASH}</div>
                          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                            <span className="num">{w.code || DASH}</span>
                            {" · "}
                            {w.skill || DASH}
                            {" · "}
                            <span className="num">{w.dayRate != null ? fmt(w.dayRate) : DASH}</span> {unitBahtDay}
                          </div>
                        </td>
                        {/* team — server data, raw. */}
                        <td style={{ ...td(), fontSize: 11.5, color: "var(--text-2)" }}>{w.team || DASH}</td>
                        {/* status — read-only: the actual status is selected, buttons non-interactive. */}
                        <td style={td("center")}>
                          <div style={{ display: "inline-flex", gap: 4 }}>
                            {ATT_OPTS.map((o) => {
                              const on = r?.status === o.v;
                              return (
                                <button
                                  key={o.v}
                                  type="button"
                                  disabled
                                  style={{
                                    padding: "6px 13px",
                                    borderRadius: 7,
                                    cursor: "default",
                                    fontFamily: "inherit",
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    border: `1.5px solid ${on ? o.color : "var(--border)"}`,
                                    background: on ? `color-mix(in srgb, ${o.color} 13%, white)` : "var(--surface)",
                                    color: on ? o.color : "var(--text-3)",
                                  }}
                                >
                                  {t(o.labelKey)}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        {/* OT — read-only static number inside the stepper chrome. */}
                        <td style={td("center")}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <StepBtn>{"−"}</StepBtn>
                            <span className="num" style={{ width: 20, fontWeight: 700, textAlign: "center" }}>
                              {r ? String(r.ot) : DASH}
                            </span>
                            <StepBtn>+</StepBtn>
                          </div>
                        </td>
                        {/* day cost — client-side projection; null -> em-dash. */}
                        <td
                          style={{ ...td("right"), fontWeight: 800, color: cost != null && !isAbsent ? "var(--brand)" : "var(--text-3)" }}
                          className="num"
                        >
                          {cost != null ? fmt(cost) : DASH}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {list.length > 0 && (
                <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                  <tr>
                    <td colSpan={4} style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                      {t("labor.att.footer").replace("{count}", String(list.length)).replace("{present}", String(present))}
                    </td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }} className="num">
                      {fmt(totCost)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
