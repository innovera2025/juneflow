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
 * RE-WIRE (B-078 / F1 data-completeness): this screen was ported against the OLD
 * 8-key grWire and em-dashed vendor / date / ordered / money / per-line items. The
 * list wire now carries all of them —
 * { id, no, po_id, wo_id, status, received, rejected, photos,
 *   vendor, date, ordered_qty, money, currency_code, items[] }
 * (apps/api/src/routes/gr.ts grWire; the 14-key set is pinned by the API's own list
 * test) — so those cells render REAL server data and the prototype's
 * items/vendor cell, received-vs-ordered bar, value column, date column and detail
 * line table are restored. MONEY = SERVER: `money` is Σ(received_qty × price)
 * computed and 2-dp rounded in grWire; the client only formats it, never sums.
 *
 * REMAINING WIRE GAPS (reported honestly, never fabricated):
 *   - NO received-by / receiver column: the date cell's sub-line and the detail
 *     received-by stat em-dash.
 *   - A receipt with NO gr_item lines has no per-line detail; the server then
 *     reports money 0 / ordered_qty 0, which means "not recorded", NOT "zero baht".
 *     Those cells em-dash instead of printing a false 0, and the detail panel falls
 *     back to the aggregate received/rejected totals (the only real quantities for
 *     such a receipt).
 *   - ONE POPULATION PER NUMBER (the rule this screen is built around). The wire
 *     mixes two: `received` / `rejected` are the receipt HEADER totals (Σ over ALL
 *     posted lines, named AND bare) while `items[]`, `ordered_qty` and `money` cover
 *     the NAMED lines only. Any cell that divides, compares or merely sits beside a
 *     figure from the other population reads as like-for-like and is not — a header
 *     quantity next to the line-derived value column implies a unit price that does
 *     not exist. So this view prints NO raw wire number anywhere: every figure in
 *     every tab comes from grRowDisplay(row) / grItemDisplay(item) (gr-rows.ts,
 *     unit-tested), which serve line figures when the receipt has line detail and
 *     the header total ONLY where it stands alone with the value column withheld.
 *     Both tabs read the same model, so they cannot contradict each other on the
 *     same GR. A ratio is formed only when EVERY line states its own ordered qty;
 *     otherwise the ordered half em-dashes, no bar is drawn, and no line is labelled
 *     fully-received on the strength of an ordered quantity it never carried. A receipt
 *     holding unmeasured quantity never gets the complete badge.
 *   - The prototype's "partial" badge has no i18n key (only gr.list.badgeComplete
 *     exists) -> only the complete badge renders; the partial badge is omitted
 *     rather than translated (B-275).
 *   - The prototype's separate RT return documents (RT-number / reason) do not exist
 *     on the wire — the returns tab lists GRs whose status is "returned", so its
 *     ref-GR + reason cells em-dash (vendor / value / date are real now).
 *   - The 3 filter chips (status/period/warehouse) are presentational: the wire has
 *     no warehouse column and status is already partitioned by the tabs, so they show
 *     their "all" value and do not filter (mirrors boq-list's degraded phase filter).
 *   - KPI cards 2 (awaiting-PO) + 3 (WO pending-approval) have no wire metric ->
 *     em-dash; card 1 (received) is month-unscoped (the list is not date-filtered);
 *     the mock value subs are money aggregates the server does not expose and the
 *     client must not sum (money = SERVER), so they stay omitted.
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
  grRowDisplay,
  grItemDisplay,
  itemsLabel,
  formatDate,
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
  // The detail panel prints the SAME display model as the row it mirrors.
  const selDisplay = selectedRow ? grRowDisplay(selectedRow) : null;

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
                  <th scope="col" style={th()}>{t("gr.list.colNo")}</th>
                  <th scope="col" style={th()}>{t("gr.list.colRef")}</th>
                  <th scope="col" style={th()}>{t("gr.list.colItemVendor")}</th>
                  <th scope="col" style={th(110)}>{t("gr.list.colReceivedOrdered")}</th>
                  <th scope="col" style={th(120, true)}>{tp(P("thValue"))}</th>
                  <th scope="col" style={th()}>{tp(P("thDate"))}</th>
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
                    // EVERY number in this row — quantity, ordered, bar, value,
                    // badge — comes from the one display model, so they all describe
                    // the same lines (gr-rows.ts grRowDisplay). No raw wire figure is
                    // read here: that is what kept a header total out of a ratio and
                    // out of the cell beside the line-derived value column.
                    const d = grRowDisplay(r);
                    const items = itemsLabel(r.items);
                    const date = formatDate(r.date);
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
                          {/* Complete badge (gr.list.badgeComplete). It may only
                              appear when the receipt is FULLY MEASURED — every line
                              carries its own ordered qty and no unmeasured (bare)
                              quantity hides in the header total — and every line met
                              it. Anything less cannot prove completeness, so the
                              badge is withheld rather than guessed (isFullyMeasured).
                              The prototype's sibling "partial" badge has no i18n key,
                              so it is omitted, never translated (B-275). */}
                          {d.complete && (
                            <span
                              style={{
                                fontSize: 9.5,
                                marginInlineStart: 5,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: "var(--ok-soft)",
                                color: "var(--ok)",
                                fontWeight: 700,
                              }}
                            >
                              {t("gr.list.badgeComplete")}
                            </span>
                          )}
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
                        {/* items + vendor — both real (gr_item names · resolved vendor) */}
                        <td style={td}>
                          <div style={{ fontSize: 12, color: items ? undefined : "var(--text-3)" }}>
                            {items || DASH}
                          </div>
                          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                            {r.vendor || DASH}
                          </div>
                        </td>
                        {/* received / ordered + progress bar — one population (see
                            grRowDisplay): Σ line received / Σ line ordered. */}
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>
                              {d.received} / {d.ordered ?? DASH}
                            </span>
                          </div>
                          {/* No ordered qty to measure against (lump-sum WO / no line
                              detail / a line that states no ordered qty) -> NO bar,
                              rather than a fabricated 0 or 100%. */}
                          {d.pct !== null && (
                            <div
                              style={{
                                height: 3,
                                background: "var(--surface-3)",
                                borderRadius: 999,
                                marginTop: 3,
                                overflow: "hidden",
                                width: 80,
                              }}
                            >
                              <div
                                style={{
                                  width: `${d.pct}%`,
                                  // The "full" tone follows the completeness the data
                                  // can evidence, not the ROUNDED percent: 99.6% also
                                  // rounds to 100, and a bar that turns green there
                                  // asserts a full receipt the badge is withholding.
                                  background: d.complete ? "var(--ok)" : "var(--accent)",
                                }}
                              />
                            </div>
                          )}
                        </td>
                        {/* value — SERVER-derived Σ(received_qty × price) over the NAMED
                            lines. Printed only when the quantity beside it is a line
                            figure too; a line-less receipt em-dashes both. */}
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: d.money !== null ? 600 : undefined,
                            color: d.money !== null ? undefined : "var(--text-3)",
                          }}
                          className="num"
                        >
                          {d.money ?? DASH}
                        </td>
                        {/* date real (created_at); the receiver sub-line has no wire */}
                        <td style={{ ...td, fontSize: 11, color: "var(--text-3)" }}>
                          <span className="num">{date || DASH}</span>
                          <div style={{ fontSize: 10 }}>{DASH}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Detail panel */}
            <div style={{ padding: 18 }}>
              {selectedRow && selDisplay ? (
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

                  {/* vendor + date are real now; receiver still has no wire column */}
                  <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8, marginBottom: 12 }}>
                    <SmallStat label={tp(P("vendor"))} value={selectedRow.vendor || DASH} />
                    <div style={{ marginTop: 8 }}>
                      <SmallStat
                        label={tp(P("dateReceived"))}
                        value={formatDate(selectedRow.date) || DASH}
                      />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <SmallStat label={t("gr.list.receivedBy")} value={DASH} />
                    </div>
                  </div>

                  {/* received items — the real gr_item lines (B-078 / F1). A receipt
                      with no line detail falls back to the aggregate received total,
                      the only real quantity it has. */}
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t("gr.list.receivedItems")}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selDisplay.hasLines ? (
                      selectedRow.items.map((it) => {
                        const line = grItemDisplay(it);
                        return (
                          <div
                            key={it.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              background: line.short ? "var(--warn-soft)" : "var(--surface-2)",
                              borderRadius: 6,
                            }}
                          >
                            <div style={{ fontSize: 11.5 }}>
                              <div style={{ fontWeight: 500 }}>{it.name || DASH}</div>
                              {/* gr.list.fullyReceived is a claim about an ordered quantity: a
                                  line that states none (ordered_qty 0) cannot be short
                                  and must NOT be read as fully received, so the label
                                  is withheld — em-dash, never a guess (see itemMeasure). */}
                              <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                                {line.measure === "short"
                                  ? t("gr.list.shortReceived").replace("{n}", line.shortfall)
                                  : line.measure === "full"
                                    ? t("gr.list.fullyReceived")
                                    : DASH}
                              </div>
                            </div>
                            <div
                              className="num"
                              style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}
                            >
                              <div>
                                {line.received} / {line.ordered ?? DASH}
                              </div>
                              <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                                {it.unit || DASH}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
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
                        {/* No lines at all -> the header total IS the receipt's only
                            quantity, so here (and only here) it stands alone. */}
                        <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>{selDisplay.received}</div>
                      </div>
                    )}
                    {/* Rejected is a receipt-header total with NO line counterpart on
                        the wire (gr_item carries qty_ok only) — a different measure,
                        never a line and never comparable with one. */}
                    {selDisplay.rejected !== null && (
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
                          {selDisplay.rejected}
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
                <th scope="col" style={th()}>{tp(P("thNo"))}</th>
                <th scope="col" style={th()}>{t("gr.list.colRefGr")}</th>
                <th scope="col" style={th()}>{tp(P("vendor"))}</th>
                <th scope="col" style={th()}>{tp(P("thReason"))}</th>
                <th scope="col" style={th(80, true)}>{tp(P("thQty"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thValue"))}</th>
                <th scope="col" style={th()}>{tp(P("thDate"))}</th>
                <th scope="col" style={th(100)}>{t("common.status")}</th>
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
                tabRows.map((r) => {
                  // SAME display model as the receipts tab (POST /gr/{id}/return only
                  // flips the status — the receipt's quantities are unchanged), so the
                  // two tabs cannot report different numbers for one GR. The qty and
                  // value columns sit side by side here, so they must be one population: a
                  // header total beside the line-derived value would imply a unit
                  // price no line carries.
                  const d = grRowDisplay(r);
                  return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">{r.no}</td>
                    {/* no separate RT doc -> gr link on the wire — em-dash */}
                    <td style={td} className="num">{DASH}</td>
                    <td style={{ ...td, color: r.vendor ? undefined : "var(--text-3)" }}>
                      {r.vendor || DASH}
                    </td>
                    {/* no return-reason column on the wire — em-dash */}
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">{d.received}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: d.money !== null ? 600 : undefined,
                        color: d.money !== null ? undefined : "var(--text-3)",
                      }}
                      className="num"
                    >
                      {d.money ?? DASH}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                      {formatDate(r.date) || DASH}
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
                    </td>
                  </tr>
                  );
                })
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
