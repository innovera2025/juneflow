/*
 * PMWorkOrders — the PM Work-Order screen (route pm.wo), ported from pototype/pm3.jsx
 * PMWorkOrders (L39-110). Registry mod "pm". A single Card with a five-tab pill strip
 * over a 7-column table, a row-click that opens the WO detail (ctx.params.wo), a
 * create-WO launcher, an Export modal, and a checklist-settings launcher.
 *
 * This screen is BOTH the list and the detail host (pm3.jsx PMWorkOrders returns
 * <PMWorkOrderDetail> when params.wo is set): when ctx.params.wo is present it renders
 * wo-detail.tsx; otherwise the list. Navigation carries the WO's uuid id (there is no
 * human WO number, DEFAULT 4) so the detail resolves the same row from the wire.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (PM · maintenance /
 * PM work-order), the title/subtitle, the three header actions (checklist-settings /
 * Export / create-WO), the tab pill strip with count badges, and the 7-column table
 * (no · type · asset+Site · tech · due · SLA · status) are the prototype's.
 *
 * Data (rules 3/4): three TanStack Query reads via the generated client —
 * useWorkOrderList (GET /pm/workorders) joined to usePmAssetList (GET /pm/assets) +
 * usePmContractList (GET /pm/contracts). All narrowing / the asset+contract JOIN / the
 * status derivation / the tab partition live in the pure, unit-tested wo-rows.ts (G3).
 *
 * REAL vs em-dash (reported honestly, never fabricated):
 *   - no (colWoNo): NO wo_no column (id is a uuid) -> em-dash, never the raw uuid (DEFAULT 4).
 *   - type: NO type column -> em-dash (the mock's PM/CM Tag is dropped, DEFAULT 5).
 *   - asset name/code/Site: REAL, joined from GET /pm/assets (em-dash when unresolved).
 *   - tech: REAL wo.tech column.
 *   - due: REAL, the joined asset next_due (em-dash when unresolved).
 *   - SLA: REAL, joined asset.contract_id -> contract.sla (em-dash when unresolved).
 *   - status: DERIVED from real columns (wo-rows deriveStatus, FLAG) -> the 5 tabs + badge.
 *   - contract ref: pm_contract has NO human code column -> only its SLA rides the join
 *     (the ref itself is an em-dash, like pm-assets colContract).
 *
 * SCOPE (honest, flagged): the checklist-settings header button opens the checklist
 * TEMPLATE MANAGER, which lives in the un-ported pototype/pm-checklist.jsx (its modal
 * strings have no dict keys yet) — so the button is rendered for fidelity but is
 * presentational (no onClick), exactly like wo-list.tsx's variation/files buttons.
 *
 * i18n (rule 2): every visible string is a pm.* / common.* dict key (t). No Thai
 * literal lives in source; tokens back every colour (rule 6). The ds.jsx StatusBadge
 * dot hexes are prototype-verbatim (B-037(a), matching po-wo-rows statusTone).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toWoRaw,
  toWoAssetRef,
  toWoContractRef,
  buildAssetMap,
  buildContractMap,
  resolveWoRows,
  filterWoByTab,
  woTabCount,
  statusToneKind,
  todayISO,
  type WoRow,
  type WoTab,
  type WoStatus,
} from "./wo-rows";
import { useWorkOrderList, usePmAssetList, usePmContractList } from "./use-pm";
import { PMWOForm } from "./wo-form";
import { PMWorkOrderDetail } from "./wo-detail";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** Middot separator (U+00B7, non-Thai) — matches pm-dashboard.tsx's literal. */
const MIDDOT = "·";

/** Table header cell style (ds.jsx th()). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "start",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** ds.jsx STATUS tone tokens for a derived WO status (mirrors po-wo-rows statusTone). */
function statusTone(status: WoStatus): { bg: string; fg: string; dot: string } {
  switch (statusToneKind(status)) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** StatusBadge (ds.jsx L91-108, size sm). */
function StatusBadge({ status, label }: { status: WoStatus; label: string }) {
  const s = statusTone(status);
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
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

export function PMWorkOrders() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  // pm3.jsx: PMWorkOrders returns the detail when params.wo is set (single route).
  const woParam = ctx.params.wo;
  const woId = typeof woParam === "string" ? woParam : "";

  const wosQ = useWorkOrderList();
  const assetsQ = usePmAssetList();
  const contractsQ = usePmContractList();

  const [tab, setTab] = useState<WoTab>("all");

  const today = todayISO();
  const rows = useMemo<WoRow[]>(() => {
    const assetMap = buildAssetMap((assetsQ.data ?? []).map(toWoAssetRef));
    const contractMap = buildContractMap((contractsQ.data ?? []).map(toWoContractRef));
    return resolveWoRows((wosQ.data ?? []).map(toWoRaw), assetMap, contractMap, today);
  }, [wosQ.data, assetsQ.data, contractsQ.data, today]);

  // The five tabs (pm3.jsx L72): "all" plus one per derived status.
  const TABS: readonly { id: WoTab; label: string }[] = [
    { id: "all", label: t("common.all") },
    { id: "open", label: t("pm.tabOpen") },
    { id: "inprogress", label: t("pm.tabInprogress") },
    { id: "overdue", label: t("pm.tabOverdue") },
    { id: "done", label: t("pm.tabDone") },
  ];

  const statusLabel = (status: WoStatus): string => {
    switch (status) {
      case "open":
        return t("pm.tabOpen");
      case "inprogress":
        return t("pm.tabInprogress");
      case "overdue":
        return t("pm.tabOverdue");
      case "done":
        return t("pm.tabDone");
    }
  };

  const tabRows = useMemo(() => filterWoByTab(rows, tab), [rows, tab]);

  const openCreate = () => {
    ctx.openModal({
      title: t("pm.createModalTitle"),
      subtitle: t("pm.createModalSubtitle"),
      icon: "wrench",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => <PMWOForm onClose={close} />,
    });
  };

  // Export modal (pm.jsx openPMExport, mirrors pm-assets/pm-dashboard) — presentational.
  const openExport = () => {
    const what = t("pm.breadcrumbWo");
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
                textAlign: "start",
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

  // Detail host (pm3.jsx: params.wo -> <PMWorkOrderDetail>).
  if (woId) return <PMWorkOrderDetail key={woId} woId={woId} />;

  const cellAssetSite = (r: WoRow): ReactNode => (
    <>
      <div style={{ fontWeight: 600 }}>{r.assetName || DASH}</div>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        <span className="num">{r.assetCode || DASH}</span> {MIDDOT} {r.site || DASH}
      </div>
    </>
  );

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbWo")]}
      title={t("pm.woPageTitle")}
      subtitle={t("pm.woSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* checklist-settings: opens the un-ported template manager -> presentational (FLAG). */}
          <Btn kind="outline" size="md" icon="settings">
            {t("pm.checklistSettingsBtn")}
          </Btn>
          <Btn kind="outline" size="md" icon="download" onClick={openExport}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("pm.createBtn")}
          </Btn>
        </div>
      }
    >
      <Card pad={0}>
        {/* Tab pill strip (pm3.jsx L71-77) — count badges are real C10 tab lengths. */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          {TABS.map((tb) => {
            const on = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 13px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: on ? "var(--brand)" : "transparent",
                  color: on ? "#fff" : "var(--text-2)",
                }}
              >
                {tb.label}
                <span
                  className="num"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: on ? "rgba(255,255,255,0.25)" : "var(--surface-3)",
                    color: on ? "#fff" : "var(--text-3)",
                  }}
                >
                  {woTabCount(rows, tb.id)}
                </span>
              </button>
            );
          })}
        </div>

        {wosQ.isLoading ? (
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
                  <th style={th(150)}>{t("pm.colWoNo")}</th>
                  <th style={th(110)}>{t("pm.type")}</th>
                  <th style={th()}>{t("pm.colAssetSite")}</th>
                  <th style={th(150)}>{t("pm.tech")}</th>
                  <th style={th(100)}>{t("pm.due")}</th>
                  <th style={th(130)}>{t("pm.sla")}</th>
                  <th style={th(140)}>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {tabRows.length === 0 ? (
                  <tr>
                    {/* Icon-only empty state (no invented text). */}
                    <td colSpan={7} style={{ padding: 60, textAlign: "center" }}>
                      <Icon name="wrench" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  tabRows.map((r) => (
                    <tr
                      key={r.id}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      onClick={() => ctx.navigate("pm.wo", { wo: r.id })}
                    >
                      {/* no: uuid, never rendered raw (DEFAULT 4) — em-dash. */}
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {DASH}
                      </td>
                      {/* type: no column (DEFAULT 5) — em-dash (mock PM/CM Tag dropped). */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={td}>{cellAssetSite(r)}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{r.tech || DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }} className="num">
                        {r.nextDue || DASH}
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 11,
                            color: r.status === "overdue" ? "var(--danger)" : "var(--text-2)",
                            fontWeight: r.status === "overdue" ? 700 : 500,
                          }}
                        >
                          {r.sla || DASH}
                        </span>
                      </td>
                      <td style={td}>
                        <StatusBadge status={r.status} label={statusLabel(r.status)} />
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
