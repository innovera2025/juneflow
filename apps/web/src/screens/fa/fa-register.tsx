/*
 * FARegister — the Fixed Asset Register screen, ported from pototype/fa.jsx FARegister
 * (L24-141) + its modals AssetForm (L144-240), AssetImportForm (L243-336), AssetDetail
 * (L339-437). Route fa.register (docs/extract/NAV-ROUTES.md L85, registry section "acct").
 * Mirrors the Phase-3 gl.inbox precedent (inlined th/td/MiniKpi/TabBar, generated client + unwrap)
 * and po-wo/wo-list (list + KPI strip + TabBar + table).
 *
 * Design fidelity (rule 1): the three-part breadcrumb (finance / assets / register), the
 * title/subtitle, the import + add header actions, the 5-card MiniKpi strip, the TabBar
 * (all / active / land / veh / mach / write-off), the search + filter toolbar, and the 9-column
 * clickable table are the prototype's.
 *
 * Data (rule 3): GET /fa/assets (use-fa.ts) via the generated client — the prototype's local
 * ASSETS array becomes the real server catalogue. Pure narrowing / tab filter / sums / format /
 * status tone live in fa-register-rows.ts (unit-tested, G3). The add modal -> POST /fa/assets
 * (asset-form.tsx, server owns the row); the import modal is presentational (asset-import-form.tsx,
 * no upload endpoint); the detail modal shows the real asset fields + a client-side schedule
 * projection (asset-detail.tsx).
 *
 * REAL vs em-dash (honest, never fabricated) — the wire (fa.ts assetWire, migration-0035 superset)
 * carries NO human `code`, NO `category`, and NO `location` column:
 *   - code / category / location cells -> em-dash; the category tabs (land/veh/mach) can never
 *     match a row -> they render 0 / empty (honest, not a bug).
 *   - age -> real life_years (the fa.lifeYears "{n} yr" template); cost / accumulated_depr / book_value -> real; status ->
 *     the active/writeoff badge; the row sub-line -> real depr_method + acquired_date.
 *   - KPIs: total count, purchase-cost (Σ cost), accumulated-depr (Σ accumulated_depr), net-book
 *     (Σ book_value), and write-off count are ALL real; the accum + write-off KPI sub-captions
 *     have no dict key (mock-specific "% of cost" / "188K · Hino") -> dropped (never minted).
 *   - The three toolbar filter selects (category / location / method) are DEAD in the prototype
 *     (no onChange) -> rendered presentational; the location options are un-keyed mock strings, so
 *     that select shows only its "all locations" default. The functional filtering is the tabs +
 *     the search (over the real name — there is no wire code to search).
 *
 * i18n (rule 2): every string resolves via t() from the DICT layer (i18n-full.json) — the fa.* keys
 * (Wave-B) plus reused existing keys (fin.breadcrumbFinance, common.all/status, model.priceUnit,
 * cc.thCode). Tokens back every colour (rule 6). ZERO Thai/baht in this .tsx.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toAssetRow,
  filterByTab,
  tabCount,
  countByStatus,
  sumCost,
  sumAccum,
  sumBook,
  formatMoney,
  formatMillions,
  statusTone,
  applySearch,
  type AssetRow,
  type FaTab,
} from "./fa-register-rows";
import { useFaAssetList } from "./use-fa";
import { AssetForm } from "./asset-form";
import { AssetImportForm } from "./asset-import-form";
import { AssetDetail } from "./asset-detail";

const DASH = "—";

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the optional unit span, wo-list variant). */
function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** TabBar, inlined from ds.jsx TabBar (functional, as in wo-list). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: FaTab; label: string; count: number }[];
  active: FaTab;
  onChange: (id: FaTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              background: "none",
              border: "none",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: on ? "var(--brand)" : "var(--surface-3)",
                color: on ? "#fff" : "var(--text-2)",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Native-select style for the presentational toolbar filters (jv-create-form headInput). */
const filterSelectStyle: CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "transparent",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text-2)",
};

/** The six FA category option keys (presentational filter select). */
const CATEGORY_KEYS = [
  "fa.catLand",
  "fa.catBuilding",
  "fa.catMachine",
  "fa.catVehicle",
  "fa.catIT",
  "fa.catTool",
] as const;

/** The three depreciation-method option keys (presentational filter select). */
const METHOD_KEYS = ["fa.methodStraight", "fa.methodDeclining", "pm.cycleByHours"] as const;

export function FARegister() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = useFaAssetList();

  const [tab, setTab] = useState<FaTab>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo<AssetRow[]>(() => (assetsQ.data ?? []).map(toAssetRow), [assetsQ.data]);
  const visible = useMemo(() => applySearch(filterByTab(rows, tab), search), [rows, tab, search]);

  const totalCost = useMemo(() => sumCost(rows), [rows]);
  const totalAccum = useMemo(() => sumAccum(rows), [rows]);
  const totalBook = useMemo(() => sumBook(rows), [rows]);
  const writeoffCount = countByStatus(rows, "writeoff");

  const openAdd = () => {
    ctx.openModal({
      title: t("fa.register.addTitle"),
      subtitle: t("fa.register.addSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <AssetForm onClose={close} />,
    });
  };

  const openImport = () => {
    ctx.openModal({
      title: t("fa.register.importTitle"),
      subtitle: t("fa.register.importSubtitle"),
      icon: "upload",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <AssetImportForm onClose={close} />,
    });
  };

  const openDetail = (row: AssetRow) => {
    ctx.openModal({
      // No wire code -> the name is the asset's identity in the title; the subtitle carries the
      // real depreciation method (category/location are em-dash on the wire, so omitted).
      title: row.name,
      subtitle: row.deprMethod || t("fa.methodNone"),
      icon: "box",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <AssetDetail asset={row} onClose={close} />,
    });
  };

  const TABS: readonly { id: FaTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: rows.length },
    { id: "active", label: t("fa.statusActive"), count: countByStatus(rows, "active") },
    { id: "land", label: t("fa.catLand"), count: tabCount(rows, "land") },
    { id: "veh", label: t("fa.catVehicle"), count: tabCount(rows, "veh") },
    { id: "mach", label: t("fa.catMachine"), count: tabCount(rows, "mach") },
    { id: "writeoff", label: t("fa.statusWriteoff"), count: writeoffCount },
  ];

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("fa.breadcrumbAssets"), t("fa.breadcrumbRegister")]}
      title={t("fa.register.title")}
      subtitle={t("fa.register.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="upload" onClick={openImport}>
            {t("fa.register.btnImport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openAdd}>
            {t("fa.register.btnAdd")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5) — all values are real; the accum + write-off sub-captions have no dict key
          (mock-specific) and are dropped honestly. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("fa.register.kpiTotal")}
          value={String(rows.length)}
          sub={t("fa.register.kpiTotalSub")}
          tone="var(--brand)"
          icon="grid"
        />
        <MiniKpi
          label={t("fa.register.kpiBuy")}
          value={formatMillions(totalCost)}
          unit={t("model.priceUnit")}
          sub={t("fa.register.kpiBuySub")}
          tone="var(--info)"
          icon="ledger"
        />
        <MiniKpi
          label={t("fa.accumDepr")}
          value={formatMillions(totalAccum)}
          unit={t("model.priceUnit")}
          tone="var(--warn)"
          icon="trend"
        />
        <MiniKpi
          label={t("fa.register.kpiBook")}
          value={formatMillions(totalBook)}
          unit={t("model.priceUnit")}
          sub={t("fa.register.kpiBookSub")}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi
          label={t("fa.register.kpiWriteoff")}
          value={String(writeoffCount)}
          tone="var(--danger)"
          icon="x"
        />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {/* Search (functional) + three presentational filter selects (dead in the prototype). */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("fa.register.searchPh")}
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
          {/* Category filter (presentational — no onChange, matching the prototype's dead dropdown). */}
          <select defaultValue="__all" style={filterSelectStyle}>
            <option value="__all">{t("common.all")}</option>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
          {/* Location filter (presentational — location options are un-keyed, so only the default). */}
          <select defaultValue="__all" style={filterSelectStyle}>
            <option value="__all">{t("fa.register.filterAllLoc")}</option>
          </select>
          {/* Method filter (presentational). */}
          <select defaultValue={METHOD_KEYS[0]} style={filterSelectStyle}>
            {METHOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </div>

        {assetsQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th(100)}>{t("cc.thCode")}</th>
                <th style={th()}>{t("fa.colName")}</th>
                <th style={th(120)}>{t("fa.fieldCat")}</th>
                <th style={th(100)}>{t("fa.fieldLoc")}</th>
                <th style={th(80)}>{t("fa.colLife")}</th>
                <th style={th(130, true)}>{t("fa.colCostBaht")}</th>
                <th style={th(130, true)}>{t("fa.accumDepr")}</th>
                <th style={th(130, true)}>{t("fa.colBook")}</th>
                <th style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("common.all")}
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const tone = statusTone(r.status);
                  const methodLabel = r.deprMethod || t("fa.methodNone");
                  const ageLabel =
                    r.lifeYears != null ? t("fa.lifeYears").replace("{n}", String(r.lifeYears)) : DASH;
                  const rowSub = t("fa.register.rowSub")
                    .replace("{method}", methodLabel)
                    .replace("{date}", r.acquiredDate || DASH);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openDetail(r)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      {/* code: no wire column -> em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }} className="num">{DASH}</td>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {r.name}
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{rowSub}</div>
                      </td>
                      {/* category: no wire column -> em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      {/* location: no wire column -> em-dash */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{ageLabel}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.cost)}
                      </td>
                      {/* accum: em-dash when zero (prototype fa.jsx L125) */}
                      <td style={{ ...td, textAlign: "right", color: "var(--warn)" }} className="num">
                        {r.accumulatedDepr === 0 ? DASH : formatMoney(r.accumulatedDepr)}
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: "right",
                          fontWeight: 700,
                          color: r.status === "writeoff" ? "var(--text-3)" : "var(--ok)",
                        }}
                        className="num"
                      >
                        {formatMoney(r.bookValue)}
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: tone.bg,
                            color: tone.fg,
                          }}
                        >
                          {t(tone.labelKey)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
