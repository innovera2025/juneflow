/*
 * GRList — the Goods Receipt screen, ported from pototype/gr.jsx GRList
 * (L17-205). Route gr.list (docs/extract/NAV-ROUTES.md L32, registry mod "proc"),
 * visual-gate reference tests/visual/reference/gallery/g1/18-s.jpg.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (procurement ·
 * Goods Receipt), the title/subtitle, the two header actions (Export / create-GR),
 * the 4-card MiniKpi strip, the TabBar (from-PO · from-WO · others · returns ·
 * cancelled, counts C10), the toolbar (search + status/period/warehouse chips), the
 * split list+detail table for the receipt tabs, the return-tab table, and the
 * cancel-tab count message are the prototype's. The row-select + detail panel + the
 * create/return/cancel actions reproduce the prototype's flows.
 *
 * Data (rule 8): GET /gr (use-gr.ts) via the generated client — the prototype's
 * local GR_ROWS becomes the server catalogue. GET /po + GET /wo resolve each row's
 * ref number (po_id/wo_id -> PO-/WO- no, §0 rule 3) and feed the create picker.
 * Pure logic (tab filter / status tone / ref resolve / money format) lives in
 * gr-rows.ts (unit-tested, gate G3).
 *
 * WIRE GAPS (reported honestly, never fabricated) — the grWire is only
 * { id, no, po_id, wo_id, status, received, rejected, photos } (apps/api/src/routes/gr.ts):
 *   - NO money column (GAP 2): the value column renders an em-dash.
 *   - NO vendor / date / received-by columns: those list + detail cells em-dash.
 *   - NO per-line item table (GAP 1): the detail received-items block shows the
 *     aggregate received/rejected totals (the only real quantities), not line items.
 *   - NO ordered qty on the list read (GAP 3): the received-vs-ordered progress bar
 *     + the partial/complete badges are omitted (no source), never invented.
 *   - The prototype's separate RT return documents (RT-number / reason) do not exist
 *     on the wire — the returns tab lists GRs whose status is "returned".
 *   - The 3 filter chips (status/period/warehouse) are presentational: the wire has
 *     no warehouse column and status is already partitioned by the tabs, so they show
 *     their "all" value and do not filter (mirrors boq-list's degraded phase filter).
 *   - KPI cards 2 (awaiting-PO) + 3 (WO pending-approval) have no wire metric ->
 *     em-dash; card 1 (received) is month-unscoped (no date on wire); the mock value
 *     subs are unkeyed and omitted.
 *   - Return / cancel are wired (POST /gr/{id}/{return,cancel}); the shell
 *     ConfirmDialog is a minimal port (no reason textarea, fixed confirm/cancel
 *     labels) and the endpoints take no body, so the prototype's reason capture +
 *     the "cancel-document" title (which also have no i18n key) are not reproduced
 *     (flagged).
 *
 * i18n (rule 2): every string is a gr.list* / gr.create* / common.* / nav.sec.proc
 * dict key (t), the Goods Receipt nav label (tn), or a gr-strings.json phrase (tp).
 * Tokens back every colour (rule 6); the ds.jsx STATUS.cancelled hexes are
 * prototype-verbatim (B-037(a), in gr-rows.ts).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toGrRow,
  toAnchorDoc,
  filterByTab,
  tabCount,
  countByStatus,
  refKind,
  refNoMap,
  resolveRefNo,
  statusTone,
  statusLabelKind,
  filterByQuery,
  type GrRow,
  type GrTab,
} from "./gr-rows";
import { useGrList, usePoList, useWoList, useReturnGr, useCancelGr } from "./use-gr";
import { GRCreateForm } from "./gr-create-form";
import grStrings from "./gr-strings.json" with { type: "json" };

const P = (k: keyof typeof grStrings) => grStrings[k] as PhraseKey;

/** Table header cell style (ds.jsx th(), L214-219 — same as boq-list). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td(), L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (L330-354) — web has no shared MiniKpi. */
function MiniKpi({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
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
        <span
          style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** TabBar, inlined from ds.jsx TabBar (L302-327). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: GrTab; label: string; count: number }[];
  active: GrTab;
  onChange: (id: GrTab) => void;
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
              letterSpacing: "-0.005em",
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

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ status, label }: { status: string; label: string }) {
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
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** Static filter chip (ds.jsx Filter muted button visual) — presentational only. */
function FilterChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: muted ? "transparent" : "var(--surface-2)",
        fontSize: 11.5,
        color: "var(--text)",
        height: 32,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "var(--text-3)" : "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/** Small stacked stat (ds.jsx SmallStat) — detail panel info rows. */
function SmallStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  );
}

const DASH = "—";

export function GRList() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const grQ = useGrList();
  const poQ = usePoList();
  const woQ = useWoList();
  const returnGr = useReturnGr();
  const cancelGr = useCancelGr();

  const [tab, setTab] = useState<GrTab>("po");
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState("");

  const rows = useMemo<GrRow[]>(() => (grQ.data ?? []).map(toGrRow), [grQ.data]);
  const poNos = useMemo(() => refNoMap((poQ.data ?? []).map(toAnchorDoc)), [poQ.data]);
  const woNos = useMemo(() => refNoMap((woQ.data ?? []).map(toAnchorDoc)), [woQ.data]);

  const tabRows = useMemo(
    () => filterByQuery(filterByTab(rows, tab), q, poNos, woNos),
    [rows, tab, q, poNos, woNos],
  );
  const selectedRow = tabRows[Math.min(sel, Math.max(tabRows.length - 1, 0))];

  const navTitle = tn(grStrings.navGrList as NavKey);

  const statusLabel = (status: string): string => {
    switch (statusLabelKind(status)) {
      case "returned":
        return t("gr.list.kpiReturns");
      case "cancelled":
        return tp(P("statusCancelled"));
      default:
        return tp(P("statusApproved"));
    }
  };

  const openCreate = () => {
    ctx.openModal({
      title: t("gr.create.modalTitle"),
      subtitle: t("gr.create.modalSubtitle"),
      icon: "truck",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <GRCreateForm onClose={close} />,
    });
  };

  const confirmReturn = (row: GrRow) => {
    ctx.confirm({
      title: t("gr.list.kpiReturns"),
      subtitle: row.no,
      icon: "arrowR",
      iconTone: "var(--warn)",
      onConfirm: () => returnGr.mutate(row.id),
    });
  };

  const confirmCancel = (row: GrRow) => {
    ctx.confirm({
      title: t("common.cancel"),
      subtitle: row.no,
      icon: "x",
      iconTone: "var(--danger)",
      danger: true,
      onConfirm: () => cancelGr.mutate(row.id),
    });
  };

  const changeTab = (id: GrTab) => {
    setTab(id);
    setSel(0);
  };

  const TABS: readonly { id: GrTab; label: string; count: number }[] = [
    { id: "po", label: tp(P("tabPo")), count: tabCount(rows, "po") },
    { id: "wo", label: tp(P("tabWo")), count: tabCount(rows, "wo") },
    { id: "other", label: t("gr.list.tabOther"), count: tabCount(rows, "other") },
    { id: "return", label: t("gr.list.kpiReturns"), count: tabCount(rows, "return") },
    { id: "cancel", label: t("common.cancel"), count: tabCount(rows, "cancel") },
  ];

  const isReceiptTab = tab === "po" || tab === "wo" || tab === "other";

  return (
    <Page
      breadcrumbs={[t("nav.sec.proc"), navTitle]}
      title={t("gr.list.title")}
      subtitle={t("gr.list.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("vendor.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("gr.list.createBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("gr.list.kpiReceivedMonth")}
          value={String(countByStatus(rows, "received"))}
          tone="var(--ok)"
          icon="truck"
        />
        {/* No awaiting-PO metric on the wire — em-dash, never fabricated. */}
        <MiniKpi label={t("gr.list.kpiAwaitPo")} value={DASH} tone="var(--warn)" icon="clock" />
        {/* No WO-pending-approval metric on the wire — em-dash. */}
        <MiniKpi label={tp(P("kpiWoPending"))} value={DASH} tone="var(--accent)" icon="hardhat" />
        <MiniKpi
          label={t("gr.list.kpiReturns")}
          value={String(countByStatus(rows, "returned"))}
          tone="var(--danger)"
          icon="arrowR"
        />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={changeTab} />

        {/* Toolbar */}
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
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              placeholder={t("gr.list.searchPlaceholder")}
              style={{ border: "none", outline: "none", width: 260, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          <FilterChip label={t("common.status")} value={t("common.all")} muted />
          <FilterChip label={tp(P("filterPeriod"))} value={t("common.all")} />
          <FilterChip label={t("gr.list.filterWarehouse")} value={t("gr.list.allWarehouses")} muted />
        </div>

        {grQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : isReceiptTab ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", alignItems: "stretch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, borderRight: "1px solid var(--border)" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th style={th()}>{t("gr.list.colNo")}</th>
                  <th style={th()}>{t("gr.list.colRef")}</th>
                  <th style={th()}>{t("gr.list.colItemVendor")}</th>
                  <th style={th(110)}>{t("gr.list.colReceivedOrdered")}</th>
                  <th style={th(120, true)}>{tp(P("thValue"))}</th>
                  <th style={th()}>{tp(P("thDate"))}</th>
                </tr>
              </thead>
              <tbody>
                {tabRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="truck" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                      <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                    </td>
                  </tr>
                ) : (
                  tabRows.map((r, i) => {
                    const kind = refKind(r);
                    const ref = resolveRefNo(r, poNos, woNos);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSel(i)}
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: r.id === selectedRow?.id ? "var(--brand-soft)" : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ ...td, fontWeight: 600 }} className="num">
                          <span style={{ color: "var(--brand)" }}>{r.no}</span>
                        </td>
                        <td style={{ ...td, fontSize: 11.5 }}>
                          {kind !== "" && (
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                marginInlineEnd: 5,
                                padding: "1px 4px",
                                borderRadius: 3,
                                background: kind === "PO" ? "var(--brand-soft)" : "var(--accent-soft)",
                                color: kind === "PO" ? "var(--brand)" : "var(--accent)",
                              }}
                            >
                              {kind}
                            </span>
                          )}
                          <span className="num" style={{ color: "var(--brand)" }}>
                            {ref || DASH}
                          </span>
                        </td>
                        {/* items + vendor: no list wire — em-dash (GAP 1 / no vendor) */}
                        <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                        <td style={td}>
                          <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>
                            {r.received} / {DASH}
                          </span>
                        </td>
                        {/* money: no wire (GAP 2) — em-dash */}
                        <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
                          {DASH}
                        </td>
                        {/* date: no wire — em-dash */}
                        <td style={{ ...td, fontSize: 11, color: "var(--text-3)" }}>{DASH}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Detail panel */}
            <div style={{ padding: 18 }}>
              {selectedRow ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div className="num" style={{ fontSize: 15, fontWeight: 700, color: "var(--brand)" }}>
                        {selectedRow.no}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {t("gr.list.colRef")}{" "}
                        <span className="num" style={{ color: "var(--brand)" }}>
                          {resolveRefNo(selectedRow, poNos, woNos) || DASH}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={selectedRow.status} label={statusLabel(selectedRow.status)} />
                  </div>

                  {/* vendor / date / receiver: no wire — em-dash */}
                  <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8, marginBottom: 12 }}>
                    <SmallStat label={tp(P("vendor"))} value={DASH} />
                    <div style={{ marginTop: 8 }}>
                      <SmallStat label={tp(P("dateReceived"))} value={DASH} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <SmallStat label={t("gr.list.receivedBy")} value={DASH} />
                    </div>
                  </div>

                  {/* received items: no per-line wire (GAP 1) — show the real aggregates */}
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t("gr.list.receivedItems")}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        background: "var(--surface-2)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ fontSize: 11.5, fontWeight: 500 }}>{t("gr.create.colReceived")}</div>
                      <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>{selectedRow.received}</div>
                    </div>
                    {selectedRow.rejected > 0 && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          background: "var(--warn-soft)",
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--warn)" }}>{tp(P("statusRejected"))}</div>
                        <div className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)" }}>
                          {selectedRow.rejected}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                    <Btn kind="ghost" size="sm" icon="paperclip" onClick={() => ctx.notify(t("gr.list.viewDeliveryToast"))}>
                      {tp(P("deliveryNote"))}
                    </Btn>
                    <Btn kind="ghost" size="sm" icon="print" onClick={() => ctx.notify(t("gr.list.printReceiptToast"))}>
                      {t("gr.list.receiptNote")}
                    </Btn>
                    <Btn kind="outline" size="sm" icon="arrowR" onClick={() => confirmReturn(selectedRow)}>
                      {t("gr.list.kpiReturns")}
                    </Btn>
                    <Btn
                      kind="ghost"
                      size="sm"
                      icon="x"
                      style={{ color: "var(--danger)", marginInlineStart: "auto" }}
                      onClick={() => confirmCancel(selectedRow)}
                    >
                      {t("common.cancel")}
                    </Btn>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : tab === "return" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th()}>{tp(P("thNo"))}</th>
                <th style={th()}>{t("gr.list.colRefGr")}</th>
                <th style={th()}>{tp(P("vendor"))}</th>
                <th style={th()}>{tp(P("thReason"))}</th>
                <th style={th(80, true)}>{tp(P("thQty"))}</th>
                <th style={th(120, true)}>{tp(P("thValue"))}</th>
                <th style={th()}>{tp(P("thDate"))}</th>
                <th style={th(100)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {tabRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="arrowR" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                  </td>
                </tr>
              ) : (
                tabRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">{r.no}</td>
                    {/* no separate RT doc -> gr link on the wire — em-dash */}
                    <td style={td} className="num">{DASH}</td>
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">{r.received}</td>
                    <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">{DASH}</td>
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          /* cancel tab */
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            <Icon name="info" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 10 }}>
              {t("gr.list.canceledCount").replace("{n}", String(tabCount(rows, "cancel")))}
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}
