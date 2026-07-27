/*
 * LandBank — the Land Bank registry, ported from pototype/land.jsx LandBank (L137-220)
 * + the shared LandKpi (L41-57). Route land.bank (docs/extract/NAV-ROUTES.md L18, parent
 * `land`, prototype file land.jsx).
 *
 * READ-ONLY register (no write bundle filed). The read-side wire (GET /land/plots,
 * apps/api/src/routes/land-sales.ts plotWire) returns
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 *     tenure, created_at }
 * and there is NO write handler — POST/PUT /land/plots are not registered (a live 404).
 * So this screen ships the honest register:
 *   - the breadcrumb / title / subtitle are the prototype's;
 *   - the two header actions (Export / add-plot) are honest-DISABLED — the add-plot form
 *     is a dropped mock (§0 rule 3, no POST handler) and there is no export endpoint, so
 *     neither is a functional button that would 404 / open a mock modal;
 *   - the three KPI cards are REAL: plots-in-registry = the filtered row count, total area
 *     (rai + sqm) and total assessed value are summed from area_sqm x price_per_rai;
 *   - the table renders id / deed_no / area (rai-ngan-wa reconstructed EXACTLY from
 *     area_sqm) / gps / price_per_rai (money, class num) / a tenure status badge /
 *     the project NAME resolved from project_id via GET /projects;
 *   - the toolbar search + tenure filter operate on the real wire fields;
 *   - loading = token skeleton; an empty catalogue = the table's empty state.
 *
 * WIRE GAP (reported honestly, never fabricated — LA-2 not merged yet): the prototype's
 * title / tambon / amphoe / prov / owner columns have NO source on plotWire (the LA-2
 * ALTER is a pending P3 backend migration). The location cell renders a literal em-dash
 * and the free-text search narrows to id + deed_no; a future enrich round adds them.
 *
 * i18n (§0 rule 2): every visible string is a land.bank.* dict key (t, minted B-153) or a
 * reuse of an existing land.* / common.* dict key from the SAME prototype file (land.jsx):
 * the breadcrumb root (land.bc.root), Export label (land.action.export), plot/rai units
 * (land.unit.plot / land.unit.rai), the "total area" KPI label (land.pipeline.kpiAreaTotal
 * — flagged for a future land.bank.kpiArea mint), tenure labels (land.tenure.*), the
 * status / project headers (common.status / land.common.project) and the "all" filter
 * option (common.all). The ONE non-dict string, the KPI unit "million baht", reuses the
 * existing phrases key via land-bank-strings.json (tp), exactly like boq-strings.json.
 * No Thai/baht literal sits in this source (B-073); tokens back every colour (§0 rule 6);
 * numeric cells carry class `num` (§0 rule 7). The KPI accent hexes (#0F766E / #B45309)
 * are prototype-verbatim (land.jsx L167-168), like PartyKpi's #B45309 (master-customer).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useProjects } from "../../shell/use-shell-data";
import {
  toPlotRow,
  filterPlots,
  areaText,
  areaRai,
  totalRai,
  totalSqm,
  totalValue,
  plotCount,
  tenureStatusKind,
  tenureLabelKind,
  statusTone,
  formatMoney,
  raiText,
  millionsText,
  sqmText,
  projectNameById,
  type PlotRow,
} from "./land-bank-rows";
import { useLandPlots } from "./use-land-bank";
import landBankStrings from "./land-bank-strings.json" with { type: "json" };

/** The literal em-dash the screen renders for every LA-2 column with no wire field. */
const DASH = "—";

/** Table header cell style, ported from ds.jsx th() — same as boq-list/po-list. */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "start",
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
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

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

/** LandKpi, ported 1:1 from land.jsx LandKpi (L41-57). color-mix + white verbatim. */
function LandKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
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

export function LandBank() {
  const { t, tp } = useI18n();

  const plotsQ = useLandPlots();
  const projectsQ = useProjects();

  const [q, setQ] = useState("");
  const [tenure, setTenure] = useState("");

  const docs = useMemo<PlotRow[]>(() => (plotsQ.data ?? []).map(toPlotRow), [plotsQ.data]);
  const rows = useMemo(() => filterPlots(docs, { q, tenure }), [docs, q, tenure]);
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  const unitPlot = t("land.unit.plot");
  const unitRai = t("land.unit.rai");
  const unitMillion = tp(landBankStrings.unitMillionBaht as PhraseKey);

  /** land.tenure.* label for a plot's status badge (kind resolved in pure logic). */
  const tenureLabel = (row: PlotRow): string => {
    switch (tenureLabelKind(row)) {
      case "own":
        return t("land.tenure.own");
      case "lease":
        return t("land.tenure.lease");
      case "study":
        return t("land.tenure.study");
      default:
        return t("land.tenure.negotiate");
    }
  };

  return (
    <Page
      breadcrumbs={[t("land.bc.root"), t("land.bank.bc")]}
      title={t("land.bank.title")}
      subtitle={t("land.bank.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Honest-DISABLED: no export endpoint / the export modal is a dropped mock. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("land.action.export")}
          </Btn>
          {/* Honest-DISABLED: POST /land/plots is not registered (a 404) — no functional add. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("land.bank.addBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (3) — all REAL: filtered count, summed area (rai + sqm), summed value. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
        <LandKpi
          label={t("land.bank.kpiInRegistry")}
          value={String(plotCount(rows))}
          unit={unitPlot}
          sub={t("land.bank.kpiInRegistrySub").replace("{n}", String(plotCount(docs)))}
          accent="var(--brand)"
          icon="landplot"
        />
        <LandKpi
          // Reuse of land.pipeline.kpiAreaTotal (same value, same prototype file) until a
          // land.bank.kpiArea is minted — mirrors master-customer's same-file key reuse.
          label={t("land.pipeline.kpiAreaTotal")}
          value={raiText(totalRai(rows))}
          unit={unitRai}
          sub={t("land.bank.kpiAreaSub").replace("{n}", sqmText(totalSqm(rows)))}
          accent="#0F766E"
          icon="grid"
        />
        <LandKpi
          label={t("land.bank.kpiValueTotal")}
          value={millionsText(totalValue(rows))}
          unit={unitMillion}
          sub={t("land.bank.kpiValueSub")}
          accent="#B45309"
          icon="cash"
        />
      </div>

      <Card pad={0}>
        {/* Toolbar — search (id + deed_no) + tenure filter + the show-count. */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--surface)",
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("land.bank.searchPlaceholder")}
              style={{
                border: "none",
                outline: "none",
                width: 240,
                fontSize: 12,
                background: "transparent",
                color: "var(--text)",
              }}
            />
          </div>
          <FilterSelect value={tenure} onChange={setTenure} ariaLabel={t("land.bank.filterTenureHint")}>
            <option value="">{t("common.all")}</option>
            <option value="buy">{t("land.tenure.buy")}</option>
            <option value="lease">{t("land.tenure.lease")}</option>
            <option value="negotiate">{t("land.tenure.negotiate")}</option>
          </FilterSelect>
          <span style={{ marginInlineStart: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
            {String(plotCount(rows))} {unitPlot}
          </span>
        </div>

        {plotsQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror boq-list / master-customer).
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  height: 44,
                  marginBottom: 4,
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(80)}>{t("land.bank.colCode")}</th>
                  <th scope="col" style={th(130)}>{t("land.bank.colDeed")}</th>
                  <th scope="col" style={th()}>{t("land.bank.colLocation")}</th>
                  <th scope="col" style={th(120)}>{t("land.bank.colArea")}</th>
                  <th scope="col" style={th(130)}>{t("land.bank.colGps")}</th>
                  <th scope="col" style={th(120, true)}>{t("land.bank.colPricePerRai")}</th>
                  <th scope="col" style={th(110)}>{t("common.status")}</th>
                  <th scope="col" style={th(160)}>{t("land.common.project")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = statusTone(tenureStatusKind(p.tenure));
                  const projectName = p.projectId ? projectNames.get(p.projectId) ?? "" : "";
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                      {/* code — wire-backed (brand, bold). */}
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {p.id || DASH}
                      </td>
                      {/* deed no — wire-backed. */}
                      <td style={td} className="num">
                        {p.deedNo || DASH}
                      </td>
                      {/* location (title / tambon / amphoe / prov) — LA-2 GAP: em-dash. */}
                      <td style={td}>{DASH}</td>
                      {/* area — rai-ngan-wa reconstructed EXACTLY from area_sqm. */}
                      <td style={td} className="num">
                        {p.areaSqm > 0 ? (
                          <>
                            {areaText(p.areaSqm)}{" "}
                            <span style={{ color: "var(--text-3)" }}>
                              ({areaRai(p.areaSqm).toFixed(1)} {unitRai})
                            </span>
                          </>
                        ) : (
                          DASH
                        )}
                      </td>
                      {/* gps — wire-backed. */}
                      <td style={{ ...td, fontSize: 11, color: "var(--text-2)" }} className="num">
                        {p.gps || DASH}
                      </td>
                      {/* price/rai — money (server-owned), class num, right-aligned. */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {p.pricePerRai > 0 ? formatMoney(p.pricePerRai) : DASH}
                      </td>
                      {/* status — tenure badge (colour from tenure, label from stage+tenure). */}
                      <td style={td}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 9px",
                            borderRadius: 4,
                            background: st.bg,
                            color: st.fg,
                            fontSize: 11,
                            fontWeight: 600,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            letterSpacing: "-0.005em",
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: st.dot }} />
                          {tenureLabel(p)}
                        </span>
                      </td>
                      {/* project — resolved from project_id via GET /projects (never a raw UUID). */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>
                        {projectName || DASH}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                <tr>
                  <td colSpan={3} style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                    {t("land.bank.footTotal").replace("{n}", String(plotCount(rows)))}
                  </td>
                  <td style={{ padding: 12, fontWeight: 700 }} className="num">
                    {raiText(totalRai(rows))} {unitRai}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
