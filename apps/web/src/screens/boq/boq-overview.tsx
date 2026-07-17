/*
 * BOQOverview — the BOQ Overview screen, ported 1:1 from pototype/boq.jsx BOQOverview
 * (L52-311). Route boq.overview (docs/extract/NAV-ROUTES.md L21), visual-gate reference
 * tests/visual/reference/gallery/g1/07.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout is the prototype's, verbatim — the
 * two-crumb breadcrumb + title/subtitle, the three header actions (Export / BOQ List /
 * create-BOQ), the scope-picker strip (project → phase → block → floor → unit/model +
 * reload), the 4-card KPI strip, the BOQ→PR→PO/WO→GR waterfall card with its info chip,
 * and the 5-tab panel (BOQ+Balance table + the Non-BOQ/GR-PO/GR-WO/Revise placeholders).
 *
 * Data (rule 8, C10): every figure is a REAL aggregate through the generated client —
 * never the prototype's hard-coded 12.4M / 11.8M / waterfall / 247-row numbers. Pure
 * aggregation (doc-total slices, PR/PO/WO amount sums, balance-item derivation) lives in
 * boq-overview-agg.ts (unit-tested, gate G3); the hooks are in use-boq-overview.ts.
 *   KPI money   : GET /boq doc totals sliced by status (total / approved / pending+revise).
 *   KPI used %  : SUM(usedV)/SUM(boqV) over the representative doc's items (on-label
 *                 "budget used FROM the BOQ" — item remain_qty derived, real).
 *   waterfall   : approved doc totals · SUM GET /pr amounts · SUM approved GET /po + /wo.
 *   balance tab : GET /boq/{id} groups + GET /boq/{id}/items for the first approved scoped
 *                 doc, grouped by group with qty/used/balance derived from remain_qty.
 *   scope picker: GET /projects (project — real filter) + GET /projects/{id}/hierarchy
 *                 (phase/block/unit names).
 *
 * WIRE GAPS (reported honestly, never fabricated — B-066 / boq-list precedent):
 *   1. GR money — gr.ts stores receipt QUANTITIES only, returns no `amount` (gr.ts GAP 2).
 *      So the 4th waterfall bar (GR) and the "commitment awaiting GR" chip cannot be
 *      computed: the GR bar shows an em-dash + empty bar, and the commit chip is omitted.
 *   2. phase/block/floor/unit scope — boq_doc carries only a free-text `scope`, no
 *      phase/block/unit FK, so those four selects are display-only (they do NOT filter the
 *      data); only the project select drives the aggregates (same as boq-list's phase gap).
 *
 * i18n (rule 2): every string is a boq.ov* DICT key (t), the BOQ Overview / BOQ List nav
 * labels (tn), or a boq-overview-strings.json phrase (tp). Strings with NO key anywhere —
 * the KPI subs/deltas, the flow-row subs, the two mock type/status filter default values,
 * the "showing 1-10 of N" count line, the mock updated-time — are mock decoration with no
 * wire source; they are dropped, never translated (§0 rule 2 + rule 3). (Comments here are
 * English-only per CLAUDE.md; the Thai copy lives only in the i18n-full.json keys.)
 * Tokens back every colour (rule 6); the CAT chip hexes + the #0F766E/#15803D flow-bar
 * colours are prototype-verbatim literals with no token (B-037(a)).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey, NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { useProjectHierarchy } from "../master/use-project-hierarchy";
import { hierarchyNames } from "./boq-rows";
import { useBoqList } from "./use-boq";
import {
  usePrList,
  usePoList,
  useWoList,
  useBoqDetail,
  useBoqItems,
} from "./use-boq-overview";
import {
  toBoqRow,
  toAmtRow,
  toBalanceItem,
  toGroupList,
  docsInProject,
  sumDocTotal,
  sumTotalByStatuses,
  sumAmount,
  millions1,
  pct,
  pct1,
  formatMoney,
  usedPctFromItems,
  groupBalanceItems,
  filterBalanceItems,
  type BalanceItem,
  type ItemCat,
} from "./boq-overview-agg";
import { NewBOQForm } from "./new-boq-form";
import ovStrings from "./boq-overview-strings.json" with { type: "json" };

const P = (k: keyof typeof ovStrings) => ovStrings[k] as PhraseKey;

/**
 * The baht currency glyph (U+0E3F) the prototype appends to money figures (boq.jsx
 * `${fmt(v)} <baht>`). Built from a char code so no Thai-block char sits in the .tsx source
 * (the i18n-guard bans literal Thai in code); it is a currency SYMBOL, not translatable
 * copy — the same glyph the boq.ov* money-header dict values already carry.
 */
const BAHT = String.fromCharCode(0x0e3f);

/**
 * Category chip palette — prototype-verbatim (boq.jsx CAT, L3-7). These hexes have no
 * @juneflow/tokens equivalent, so they are copied literally (B-037(a)); the CatChip
 * itself is ported from boq.jsx CatChip (L9-20).
 */
const CAT: Record<ItemCat, { short: string; color: string; soft: string }> = {
  M: { short: "MAT", color: "#0F766E", soft: "#E6F4F2" },
  S: { short: "SUB", color: "#1D4ED8", soft: "#E5ECFB" },
  L: { short: "LAB", color: "#B45309", soft: "#FEF3C7" },
};

function CatChip({ cat }: { cat: ItemCat }) {
  const c = CAT[cat];
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 4,
        background: c.soft,
        color: c.color,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {c.short}
    </span>
  );
}

/** Table header cell style (boq-list.tsx th / ds.jsx th). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "10px 12px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    whiteSpace: "nowrap",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td). */
const td: CSSProperties = { padding: "10px 12px", verticalAlign: "middle" };

/**
 * KPI card — inlined from dashboard.jsx Kpi (same as boq-list KpiCard), reduced to
 * label + value + unit. The prototype's sub/delta lines are mock decoration with no
 * i18n key + no wire source, so they are not rendered (module header, i18n note).
 */
function KpiCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
    </Card>
  );
}

/**
 * Scope-picker pill — a bordered box (hint label + native <select>), styled to match the
 * prototype's ds.jsx Dropdown mode="filter" pills. `muted` dims the value (the prototype's
 * greyed floor pill). Display-only pills (phase/block/floor/unit) still hold local state so
 * they are interactive, but they do NOT filter the data (WIRE GAP, header).
 */
function ScopeSelect({
  hint,
  value,
  options,
  onChange,
  muted,
}: {
  hint: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        height: 40,
        justifyContent: "center",
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface)",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 600 }}>{hint}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          color: muted ? "var(--text-3)" : "var(--text)",
          cursor: "pointer",
          padding: 0,
          maxWidth: "100%",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Static toolbar filter pill (ds.jsx Filter, display-only) — label + value. */
function FilterPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--surface)",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600 }}>{value}</span>
      <Icon name="chevD" size={12} color="var(--text-3)" />
    </div>
  );
}

/**
 * One waterfall stage row (boq.jsx FlowRow, L210-235) — label + value + pct + the stacked
 * bar. `value === null` is the GR wire gap: render an em-dash and an empty bar, never a
 * fabricated figure. The prototype's per-row sub line has no i18n key and is dropped.
 */
function FlowRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number | null;
  total: number;
  color: string;
}) {
  const p = value === null ? 0 : pct(value, total);
  const valueLabel = value === null ? "—" : `${formatMoney(value)} ${BAHT}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
          <span className="num" style={{ fontWeight: 700, color: "var(--text)" }}>{valueLabel}</span>
          <span className="num" style={{ color: "var(--text-3)", fontWeight: 600 }}>{p.toFixed(1)}%</span>
        </div>
      </div>
      <div style={{ height: 22, background: "var(--surface-3)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
        <div
          style={{
            width: `${p}%`,
            height: "100%",
            background: color,
            display: "flex",
            alignItems: "center",
            paddingLeft: 10,
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 600,
          }}
        >
          {p > 25 ? valueLabel : ""}
        </div>
      </div>
    </div>
  );
}

/** Tab descriptor for the 5-tab bar. */
interface TabDef {
  id: string;
  label: string;
  count?: number;
}

/** Tab bar (boq.jsx BOQTabBar, L26-50). tab-1 shows a real item count; 2-5 have none. */
function BOQTabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 16px" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          style={{
            padding: "13px 14px",
            background: "none",
            border: "none",
            borderBottom: active === t.id ? "2px solid var(--brand)" : "2px solid transparent",
            marginBottom: -1,
            fontSize: 12.5,
            fontWeight: active === t.id ? 600 : 500,
            color: active === t.id ? "var(--brand)" : "var(--text-2)",
            display: "flex",
            alignItems: "center",
            gap: 7,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t.label}
          {t.count != null && (
            <span
              className="num"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 999,
                background: active === t.id ? "var(--brand)" : "var(--surface-3)",
                color: active === t.id ? "#fff" : "var(--text-2)",
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Interpolate a boq.ov* template that bolds its {value} (and optional {pct}) numbers. */
function withBoldValue(template: string, value: string, pctText?: string): ReactNode {
  // Split on the two placeholders, keeping the surrounding Thai from the i18n template
  // (no new translation — §0 rule 2). Bold the numeric spans like the prototype.
  const [head, restRaw = ""] = template.split("{value}");
  const [mid, tail = ""] = restRaw.split("{pct}");
  return (
    <>
      {head}
      <b className="num" style={{ color: "var(--text)" }}>{value}</b>
      {pctText == null ? mid + tail : (<>{mid}<b className="num">{pctText}</b>{tail}</>)}
    </>
  );
}

export function BOQOverview() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const [tab, setTab] = useState("boq");
  const [q, setQ] = useState("");

  // ── Real data sources ──────────────────────────────────────────────────────
  const boqQ = useBoqList();
  const projectsQ = useProjects();
  const prQ = usePrList();
  const poQ = usePoList();
  const woQ = useWoList();

  // Project scope: default = the active project (ProjectSwitcher tweak), else the first
  // project. The project select drives the aggregates (real filter).
  const projects = projectsQ.data ?? [];
  const defaultProject = resolveActiveProject(projects, ctx.tweaks.project);
  const [projectId, setProjectId] = useState<string>("");
  const activeProjectId = projectId || defaultProject?.id || "";
  const activeProjectName =
    projects.find((p) => p.id === activeProjectId)?.name ?? defaultProject?.name ?? "";

  // Display-only scope cascade (phase/block/unit names for the project — WIRE GAP: they
  // do not filter, boq_doc has no phase/block/unit FK).
  const hierarchyQ = useProjectHierarchy(activeProjectId || undefined);
  const nodes = hierarchyQ.data ?? [];
  const allLabel = tp(P("all"));
  const phaseOpts = [allLabel, ...hierarchyNames(nodes, "phase")];
  const blockOpts = [allLabel, ...hierarchyNames(nodes, "block")];
  const unitOpts = [allLabel, ...hierarchyNames(nodes, "unit")];
  const [phase, setPhase] = useState("");
  const [block, setBlock] = useState("");
  const [unit, setUnit] = useState("");

  // ── Doc-level aggregates (KPIs + waterfall) ────────────────────────────────
  const docs = useMemo(() => (boqQ.data ?? []).map(toBoqRow), [boqQ.data]);
  const scoped = useMemo(() => docsInProject(docs, activeProjectId), [docs, activeProjectId]);
  const totalBoq = sumDocTotal(scoped);
  const approvedTotal = sumTotalByStatuses(scoped, ["approved"]);
  const pendingReviseTotal = sumTotalByStatuses(scoped, ["pending", "revise"]);

  const prRows = useMemo(() => (prQ.data ?? []).map(toAmtRow), [prQ.data]);
  const poRows = useMemo(() => (poQ.data ?? []).map(toAmtRow), [poQ.data]);
  const woRows = useMemo(() => (woQ.data ?? []).map(toAmtRow), [woQ.data]);
  const prOpened = sumAmount(prRows, activeProjectId); // any status = "opened as PR"
  const poWo =
    sumAmount(poRows, activeProjectId, ["approved"]) +
    sumAmount(woRows, activeProjectId, ["approved"]); // approved-as-PO/WO stage
  const remainReady = approvedTotal - prOpened;

  // ── Balance table: the first approved scoped doc (else the first scoped doc) ─
  const repDoc = useMemo(
    () => scoped.find((d) => d.status === "approved") ?? scoped[0],
    [scoped],
  );
  const detailQ = useBoqDetail(repDoc?.id);
  const itemsQ = useBoqItems(repDoc?.id);
  const groups = useMemo(
    () => toGroupList((detailQ.data?.groups as Record<string, unknown>[]) ?? undefined),
    [detailQ.data],
  );
  const items = useMemo<BalanceItem[]>(() => (itemsQ.data ?? []).map(toBalanceItem), [itemsQ.data]);
  const usedPct = usedPctFromItems(items);
  const shownItems = useMemo(() => filterBalanceItems(items, q), [items, q]);
  const balanceGroups = useMemo(() => groupBalanceItems(shownItems, groups), [shownItems, groups]);

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("newBoq")),
      subtitle: t("boq.listNewSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "xl",
      body: ({ close }: { close: () => void }) => (
        <NewBOQForm
          onClose={close}
          existingNos={docs.map((d) => d.no)}
          existingDocs={docs.map((d) => ({ no: d.no, name: d.name }))}
        />
      ),
    });
  };

  const reload = () => {
    ctx.notify(t("boq.ovReloadToast"));
    void boqQ.refetch();
    void prQ.refetch();
    void poQ.refetch();
    void woQ.refetch();
    void detailQ.refetch();
    void itemsQ.refetch();
  };

  const flowTotal = totalBoq > 0 ? totalBoq : 1; // avoid /0 bar widths before data loads

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), tn(ovStrings.navBoqOverview as NavKey)]}
      title={tn(ovStrings.navBoqOverview as NavKey)}
      subtitle={t("boq.ovSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Export reuses the vendor.btnExport dict key (the only keyed "Export" literal;
              no boq/common variant — no new translation, §0 rule 2). No export endpoint
              exists yet, so the click is a deferred no-op (boq-list stub precedent). */}
          <Btn kind="outline" size="md" icon="download">
            {t("vendor.btnExport" as DictKey)}
          </Btn>
          <Btn kind="ghost" size="md" icon="list" onClick={() => ctx.navigate("boq.list")}>
            {tn(ovStrings.navBoqList as NavKey)}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("newBoq"))}
          </Btn>
        </div>
      }
    >
      {/* Scope picker */}
      <Card pad={14} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{t("boq.ovScopeLabel")}</span>
          <ScopeSelect
            hint={tp(P("hintProject"))}
            value={activeProjectName}
            options={projects.map((p) => p.name)}
            onChange={(name) => {
              const found = projects.find((p) => p.name === name);
              if (found) setProjectId(found.id);
            }}
          />
          <ScopeSelect hint={tp(P("hintPhase"))} value={phase || allLabel} options={phaseOpts} onChange={setPhase} />
          <ScopeSelect hint={tp(P("hintBlock"))} value={block || allLabel} options={blockOpts} onChange={setBlock} />
          <ScopeSelect hint={t("boq.ovScopeFloor")} value={allLabel} options={[allLabel]} onChange={() => {}} muted />
          <ScopeSelect hint={tp(P("hintUnitModel"))} value={unit || allLabel} options={unitOpts} onChange={setUnit} />
          <Btn kind="outline" size="sm" icon="sync" onClick={reload}>
            {t("boq.ovReload")}
          </Btn>
        </div>
      </Card>

      {/* KPI strip — label + value + unit only (subs/deltas are mock, no key/wire). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <KpiCard label={t("boq.ovKpiTotal")} value={millions1(totalBoq)} unit={tp(P("millionBaht"))} accent="var(--brand)" />
        <KpiCard label={tp(P("approved"))} value={millions1(approvedTotal)} unit={tp(P("millionBaht"))} accent="var(--ok)" />
        <KpiCard
          label={t("boq.ovKpiPendingRevise")}
          value={millions1(pendingReviseTotal)}
          unit={tp(P("millionBaht"))}
          accent="var(--warn)"
        />
        <KpiCard label={t("boq.ovKpiUsed")} value={`${pct1(usedPct, 100)}%`} />
      </div>

      {/* Waterfall */}
      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t("boq.ovFlowTitle")}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
            {t("boq.ovFlowSubtitle").replace("{total}", `${millions1(totalBoq)}M ${BAHT}`)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          <FlowRow label={t("boq.ovFlowApproved")} value={approvedTotal} total={flowTotal} color="var(--brand)" />
          <FlowRow label={t("boq.ovFlowPR")} value={prOpened} total={flowTotal} color="#0F766E" />
          <FlowRow label={t("boq.ovFlowPOWO")} value={poWo} total={flowTotal} color="var(--accent)" />
          {/* GR bar — WIRE GAP: gr.ts returns no money, so value is null (em-dash, empty bar). */}
          <FlowRow label={t("boq.ovFlowGR")} value={null} total={flowTotal} color="#15803D" />
        </div>

        {/* Info chips — the "ready to open PR" remainder is real (approved − PR opened). The
            second chip ("commitment awaiting GR") has a keyed template but needs the GR money
            the wire does not expose (gap), so its value is an em-dash — the label + layout are
            preserved, the figure is never fabricated. */}
        <div
          style={{
            marginTop: 16,
            padding: "10px 14px",
            background: "var(--surface-2)",
            border: "1px dashed var(--border-strong)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          <Icon name="info" size={15} color="var(--accent)" />
          <span>
            {withBoldValue(
              t("boq.ovRemainInfo"),
              `${formatMoney(remainReady)} ${BAHT}`,
              `${pct1(remainReady, totalBoq)}%`,
            )}
          </span>
          <span style={{ color: "var(--text-3)" }}>·</span>
          <span>{withBoldValue(t("boq.ovCommitInfo"), "—")}</span>
        </div>
      </Card>

      {/* Tabs panel */}
      <Card pad={0}>
        <BOQTabBar
          tabs={[
            { id: "boq", label: t("boq.ovTabBoq"), count: items.length },
            { id: "non", label: t("boq.ovTabNon") },
            { id: "grpo", label: t("boq.ovTabGrpo") },
            { id: "grwo", label: t("boq.ovTabGrwo") },
            { id: "rev", label: t("boq.ovTabRev") },
          ]}
          active={tab}
          onChange={setTab}
        />

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
              height: 30,
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
              placeholder={t("boq.ovSearchPh")}
              style={{ border: "none", outline: "none", width: 280, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          {/* Display-only filter pills — value = the "all" phrase; the prototype's mock
              default type/status selections have no i18n key and are dropped (never invented). */}
          <FilterPill label={tp(P("catFilter"))} value={allLabel} />
          <FilterPill label={tp(P("typeFilter"))} value={allLabel} />
          <FilterPill label={tp(P("statusFilter"))} value={allLabel} />
        </div>

        {tab === "boq" ? (
          <BalanceTable
            loading={itemsQ.isLoading || detailQ.isLoading}
            groups={balanceGroups}
            t={t}
            tp={tp}
          />
        ) : (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            <Icon name="doc" size={32} color="var(--text-3)" style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>
              {t("boq.ovEmptyTab").split("{tab}")[0]}
              <b style={{ color: "var(--text-2)" }}>{t("boq.ovTabBoq")}</b>
              {t("boq.ovEmptyTab").split("{tab}")[1]}
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}

/** BOQ + Balance table (boq.jsx BOQBalanceTable, L248-311) — grouped real items. */
function BalanceTable({
  loading,
  groups,
  t,
  tp,
}: {
  loading: boolean;
  groups: { id: string; name: string; rows: BalanceItem[] }[];
  t: (k: DictKey) => string;
  tp: (k: PhraseKey) => string;
}) {
  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        {[0, 1, 2, 3, 4].map((n) => (
          <div
            key={n}
            style={{ height: 40, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
          />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
        <Icon name="doc" size={32} color="var(--text-3)" style={{ opacity: 0.5 }} />
        <div style={{ marginTop: 10, fontSize: 13 }}>{t("boq.ovTabBoq")}</div>
      </div>
    );
  }
  return (
    <div style={{ overflow: "auto", maxHeight: 480 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)", zIndex: 1 }}>
          <tr style={{ color: "var(--text-3)" }}>
            <th style={th(60)}>{tp(P("thCode"))}</th>
            <th style={th(54)}>{tp(P("typeFilter"))}</th>
            <th style={th()}>{tp(P("unitItems"))}</th>
            <th style={th(70)}>{tp(P("thUnit"))}</th>
            <th style={th(110, true)}>{t("boq.ovThBoqQty")}</th>
            <th style={th(110, true)}>{t("boq.ovThUsed")}</th>
            <th style={th(110, true)}>{t("boq.ovThBalance")}</th>
            <th style={th(120, true)}>{t("boq.ovThBoqValue")}</th>
            <th style={th(120, true)}>{t("boq.ovThBalanceValue")}</th>
            <th style={th(110)}>{t("boq.ovThPctUsed")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <BalanceGroupRows key={g.id} name={g.name} rows={g.rows} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceGroupRows({ name, rows }: { name: string; rows: BalanceItem[] }) {
  return (
    <>
      <tr style={{ background: "var(--brand-soft)" }}>
        <td colSpan={10} style={{ padding: "8px 12px", fontSize: 11.5, fontWeight: 700, color: "var(--brand)" }}>
          <Icon name="chevD" size={11} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {name}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.code} style={{ borderTop: "1px solid var(--border)" }}>
          <td style={{ ...td, color: "var(--text-3)" }} className="num">{r.code}</td>
          <td style={td}>
            <CatChip cat={r.cat} />
          </td>
          <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
          <td style={{ ...td, color: "var(--text-3)" }}>{r.unit}</td>
          <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(r.boqQty)}</td>
          <td style={{ ...td, textAlign: "right", color: "var(--text-2)" }} className="num">{formatMoney(r.used)}</td>
          <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">{formatMoney(r.balQty)}</td>
          <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(r.boqV)}</td>
          <td
            style={{ ...td, textAlign: "right", fontWeight: 600, color: r.balV === 0 ? "var(--text-3)" : "var(--brand)" }}
            className="num"
          >
            {formatMoney(r.balV)}
          </td>
          <td style={td}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 5, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${r.pct}%`, height: "100%", background: r.pct > 85 ? "var(--warn)" : "var(--accent)" }} />
              </div>
              <span className="num" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", minWidth: 26 }}>
                {r.pct}%
              </span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
