/*
 * LaborWorkers — the worker register, ported from pototype/labor.jsx LaborWorkers (L18-71)
 * + the shared ds.jsx Kpi (dashboard.jsx L93-115) / Tag (L273-281) / StatusBadge (L93-108).
 * Route labor.workers (docs/extract/NAV-ROUTES.md, registry.ts L116, mod "labor").
 *
 * READ-ONLY display port. The read wire (GET /labor/workers, use-labor.ts) returns the
 * worker register; the prototype's local WORKERS_SEED becomes the server catalogue. The
 * pure narrowing / team derivation / KPI aggregates / status mapping / money format live
 * in labor-workers-rows.ts (unit-tested, gate G3).
 *
 * Design fidelity (section 0 rule 1): the three-crumb breadcrumb, the title/subtitle, the
 * two header actions (Export / add-worker), the 4-card KPI strip, the team filter bar with
 * the row count, and the 7-column table (code / name / team / skill / type / day-rate /
 * status) are the prototype's.
 *
 * Honest divergences (reported, never fabricated):
 *   - Export button: openExportModal is a dropped mock with no export endpoint ->
 *     honest-DISABLED (mirror land-bank).
 *   - Add-worker button: POST /labor/workers exists but the create form is out of this
 *     display round -> honest-DISABLED (the button stays for fidelity; a write round wires
 *     the modal).
 *   - Teams KPI + team filter: derived from the fetched rows (distinctTeams) — no
 *     /labor/teams endpoint (the prototype's hardcoded 4-team const is dropped).
 *   - day_rate is nullable on the wire -> em-dash in the day-rate cell; the status column
 *     derives from the real `active` flag (active -> approved badge, else draft).
 *   - Loading = token skeleton; an empty register = the table's honest empty state.
 *
 * i18n (section 0 rule 2, ZERO-sacred borrow round): every visible static string resolves
 * to an EXISTING dict key — labor.workers.* / labor.* / common.status — or a cross-module
 * BORROW whose `th` value byte-matches the prototype string: org.fieldCode (code header),
 * cc.fldType (type header), org.noteCountUnit (person unit), subcon.unitBaht (baht symbol),
 * vendor.btnExport (Export). Nothing is minted. Server data (name / team / skill / pay_type) renders raw
 * (rule 3). Tokens back every colour; the KPI-Avg accent #B45309 is prototype-verbatim
 * (labor.jsx L39), like land-bank's KPI accents. Numeric cells carry class `num`.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import {
  toWorkerRow,
  filterByTeam,
  distinctTeams,
  activeCount,
  inactiveCount,
  avgWage,
  estimatedDayWage,
  statusKind,
  fmt,
  type WorkerRow,
} from "./labor-workers-rows";
import { useLaborWorkers } from "./use-labor";

/** The literal em-dash rendered for a null day rate / empty server field. */
const DASH = "—";

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

/** Tag, ported 1:1 from ds.jsx Tag (L273-281) — color-mix tint + tone. */
function Tag({ children, tone = "var(--text-2)" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ kind, label }: { kind: "approved" | "draft"; label: string }) {
  const s =
    kind === "approved"
      ? { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" }
      : { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
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
        height: 32,
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

export function LaborWorkers() {
  const { t } = useI18n();

  const workersQ = useLaborWorkers();

  const [team, setTeam] = useState("");

  const docs = useMemo<WorkerRow[]>(() => (workersQ.data ?? []).map(toWorkerRow), [workersQ.data]);
  const teams = useMemo(() => distinctTeams(docs), [docs]);
  const list = useMemo(() => filterByTeam(docs, team), [docs, team]);

  // KPIs derive over the FULL fetched set (prototype uses `rows`, not the filtered list).
  const active = activeCount(docs);
  const inactive = inactiveCount(docs);
  const avg = avgWage(docs);
  const est = estimatedDayWage(docs);

  const unitPerson = t("org.noteCountUnit"); // BORROW: person unit
  const unitBaht = t("subcon.unitBaht"); // BORROW: baht symbol

  return (
    <Page
      breadcrumbs={[t("nav.sec.main"), t("labor.crumbSection"), t("labor.workers.crumb")]}
      title={t("labor.workers.title")}
      subtitle={t("labor.workers.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Honest-DISABLED: no export endpoint / the export modal is a dropped mock. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("vendor.btnExport")}
          </Btn>
          {/* Honest-DISABLED: POST /labor/workers exists, but the create form is out of this display round. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("labor.workers.btnAdd")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — total / teams (derived) / avg wage / estimated day wage. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("labor.workers.kpiTotalLabel")}
          value={String(docs.length)}
          unit={unitPerson}
          sub={t("labor.workers.kpiTotalSub").replace("{active}", String(active)).replace("{inactive}", String(inactive))}
          accent="var(--brand)"
        />
        <Kpi
          label={t("labor.workers.kpiTeamsLabel")}
          value={String(teams.length)}
          unit={t("labor.team")}
          sub={t("labor.workers.kpiTeamsSub")}
        />
        <Kpi
          label={t("labor.workers.kpiAvgLabel")}
          value={String(avg)}
          unit={t("labor.unitBahtDay")}
          sub={t("labor.workers.kpiAvgSub")}
          accent="#B45309"
        />
        <Kpi
          label={t("labor.workers.kpiEstLabel")}
          value={fmt(est)}
          unit={unitBaht}
          sub={t("labor.workers.kpiEstSub")}
          accent="var(--ok)"
        />
      </div>

      <Card pad={0}>
        {/* Filter bar — team filter (functional, client-side) + the row count. */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <FilterSelect value={team} onChange={setTeam} ariaLabel={t("labor.team")}>
            <option value="">{t("labor.filterAllTeams")}</option>
            {teams.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <span style={{ marginInlineStart: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
            {t("labor.workers.countSuffix").replace("{count}", String(list.length))}
          </span>
        </div>

        {workersQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror land-bank / gr-list).
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(80)}>{t("org.fieldCode")}</th>
                  <th scope="col" style={th()}>{t("labor.thName")}</th>
                  <th scope="col" style={th(150)}>{t("labor.team")}</th>
                  <th scope="col" style={th(110)}>{t("labor.thSkill")}</th>
                  <th scope="col" style={th(90)}>{t("cc.fldType")}</th>
                  <th scope="col" style={th(110, "right")}>{t("labor.wageDayField")}</th>
                  <th scope="col" style={th(100)}>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  // Honest empty state — icon only, no minted / semantically-wrong copy
                  // (no labor-scoped "no data" dict key exists to reuse).
                  <tr>
                    <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="users" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  list.map((w) => (
                    <tr key={w.id} style={{ borderTop: "1px solid var(--border)", opacity: w.active ? 1 : 0.55 }}>
                      {/* code — brand-bold business code (wire `code`, not the uuid). */}
                      <td style={{ ...td(), fontWeight: 700, color: "var(--brand)" }} className="num">
                        {w.code || DASH}
                      </td>
                      {/* name — server data, raw. */}
                      <td style={{ ...td(), fontWeight: 600 }}>{w.name || DASH}</td>
                      {/* team — server data, raw. */}
                      <td style={{ ...td(), fontSize: 11.5, color: "var(--text-2)" }}>{w.team || DASH}</td>
                      {/* skill — server data in a tone tag. */}
                      <td style={td()}>{w.skill ? <Tag tone="var(--info)">{w.skill}</Tag> : DASH}</td>
                      {/* pay type — server data, raw. */}
                      <td style={{ ...td(), fontSize: 11.5, color: "var(--text-2)" }}>{w.payType || DASH}</td>
                      {/* day rate — money (server-owned), class num; null -> em-dash. */}
                      <td style={{ ...td("right"), fontWeight: 700 }} className="num">
                        {w.dayRate != null ? fmt(w.dayRate) : DASH}
                      </td>
                      {/* status — derived from the real `active` flag. */}
                      <td style={td()}>
                        <StatusBadge
                          kind={statusKind(w.active)}
                          label={w.active ? t("labor.workers.stActive") : t("labor.workers.stInactive")}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
