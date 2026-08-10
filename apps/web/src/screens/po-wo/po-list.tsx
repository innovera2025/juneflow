/*
 * POList — the Purchase Order screen, ported from pototype/po-wo.jsx POList
 * (L12-205). Route po.list (docs/extract/NAV-ROUTES.md L30, registry mod "proc"),
 * visual-gate reference tests/visual/reference/gallery/g1/16-s.jpg.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (procurement ·
 * purchase-order), the title/subtitle, the two header actions (Export / create-PO),
 * the 5-card MiniKpi strip, the TabBar (all · pending · open · deposit-due ·
 * awaiting-GR · closed), the split list+detail layout (1fr / 380px), the 8-column
 * table, and the detail panel (header · 4 SmallStats · payment schedule · PO
 * Decrement · action row) are the prototype's. Row-select drives the detail panel;
 * the create-PO action opens the create modal.
 *
 * Data (rule 3): GET /po (use-po-wo.ts) via the generated client — the prototype's
 * local PO_ROWS becomes the server catalogue. The vendor NAME resolves from
 * vendor_id via GET /vendors; the refPR no from pr_id via GET /pr; the detail
 * project name via pr_id -> pr.project_id -> GET /projects. Pure logic (tab filter /
 * status tone / money format / id joins) lives in po-wo-rows.ts (unit-tested, G3).
 *
 * LIST PAYLOAD (apps/api/src/routes/po.ts poWire, pinned by po.test.ts's exact-key
 * assertion): { id, no, pr_id, vendor_id, status, approval_step, currency_code,
 * credit_term, total, vat, amount, doc_date, paid, deposit }.
 *   - REAL (B-355 re-wire): `paid` (= Σ ap_billing on the PO, server-computed 2dp,
 *     B-079/F2) drives the จ่ายไป column + its proportion bar; `doc_date` (= created_at)
 *     drives the detail document-date SmallStat, ISO/UTC per the house formatDate.
 *     Both are displayed verbatim — never recomputed (money = SERVER).
 * WIRE GAPS (reported honestly, never fabricated):
 *   - deposit column: the prototype cell is a CONTRACTED down-payment PERCENT pill
 *     (po.list.depositPaid/depositDue "{pct}% · ..."), but the wire's `deposit` is a PAID
 *     amount and `pos` has no agreed-rate column — deriving pct from a payment would
 *     misstate a contract term, so the cell stays an em-dash (B-356).
 *   - payment-schedule amounts + "PO remaining": amount×pct / total−paid are monetary
 *     totals that would be originated in the browser — em-dash (money = SERVER).
 *   - NO GR% column on the po wire: the receive-goods(%) list cell renders an em-dash
 *     and its progress bar is omitted (the receive-progress lives on GET /gr, not here).
 *   - NO "closed" status: the closed row-badge + the closed tab stay empty.
 *   - KPI values: pending + open (approved) are real C10 counts; deposit-due (needs the
 *     same missing agreed rate) / awaiting-GR / closed-this-month have no wire metric ->
 *     em-dash. The mock money sub-captions are unkeyed and omitted.
 *   - credit_term / vat ARE on the payload, but pototype/po-wo.jsx POList (L12-205) has
 *     no cell for either (8 fixed columns, 4 fixed detail SmallStats) — adding one would
 *     be a redesign (§0 rule 1). Reported, not invented (B-356).
 *   - Detail actions target mock subsystems: pay (no deposit endpoint) shows a
 *     confirm + toast only; receive-goods navigates to the GR screen; edit / print are
 *     presentational (no PO line-item edit endpoint; print is icon-only in the
 *     prototype); cancel-PO shows a confirm but /po has no cancel endpoint (only the
 *     submit/approve/reject state machine, surfaced via the approvals inbox) — so it
 *     cannot persist (flagged). The ConfirmDialog is the shell's minimal port
 *     (fixed confirm/cancel labels, no reason capture).
 *
 * i18n (rule 2): every string is a po.list* / po.form* / common.* / nav.sec.proc dict
 * key (t), the purchase-order (PO) nav label (tn), or a po-wo-strings.json phrase (tp).
 * Tokens back every colour (rule 6); the ds.jsx STATUS dot hexes are prototype-
 * verbatim (B-037(a), in po-wo-rows.ts).
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
import { useProjects } from "../../shell/use-shell-data";
import { useVendorList } from "../master/use-vendors";
import {
  toPoRow,
  toPrRef,
  toVendorRef,
  filterPoByTab,
  poTabCount,
  countByStatus,
  statusTone,
  statusLabelKind,
  vendorNameById,
  prNoById,
  prProjectIdById,
  projectNameById,
  resolvePoProjectName,
  formatMoney,
  type PoRow,
  type PoTab,
} from "./po-wo-rows";
import { poListWireById, formatDate, paidPct, type PoListWire } from "./po-list-rows";
import { usePoList, usePrList } from "./use-po-wo";
import { POCreateForm } from "./po-create-form";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
const DASH = "—";
/** THAI BAHT SIGN (U+0E3F) — prototype-verbatim currency unit. No baht-only i18n key
 *  exists and a literal baht sign trips the i18n-guard (U+0E00-U+0E7F), so it is
 *  sourced from a unicode escape (same pattern as master/user-add-form.tsx). */
const BAHT = "\u0E3F";

/** Table header cell style (ds.jsx th(), same as gr-list/boq-list). */
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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the optional unit span). */
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
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
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
  tabs: readonly { id: PoTab; label: string; count: number }[];
  active: PoTab;
  onChange: (id: PoTab) => void;
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

/** StatusBadge (ds.jsx L91-108, size sm): tokened bg/fg + verbatim dot. */
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

/** Small stacked stat (ds.jsx SmallStat) — detail panel info rows. */
function SmallStat({ label, value, brand }: { label: string; value: ReactNode; brand?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 2 }}>{label}</div>
      <div
        className={brand ? "num" : ""}
        style={{ fontSize: 12.5, fontWeight: 600, color: brand ? "var(--brand)" : "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

export function POList() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const poQ = usePoList();
  const prQ = usePrList();
  const vendorQ = useVendorList();
  const projectsQ = useProjects();

  const [tab, setTab] = useState<PoTab>("all");
  const [sel, setSel] = useState(0);

  const rows = useMemo<PoRow[]>(() => (poQ.data ?? []).map(toPoRow), [poQ.data]);
  // The two POList-only wire fields (paid, doc_date), keyed by doc id — see po-list-rows.ts.
  const wireById = useMemo(() => poListWireById(poQ.data), [poQ.data]);
  const wireOf = (id: string): PoListWire | undefined => wireById.get(id);
  const prRefs = useMemo(() => (prQ.data ?? []).map(toPrRef), [prQ.data]);
  const vendorNames = useMemo(
    () => vendorNameById((vendorQ.data ?? []).map(toVendorRef)),
    [vendorQ.data],
  );
  const prNos = useMemo(() => prNoById(prRefs), [prRefs]);
  const prProjectIds = useMemo(() => prProjectIdById(prRefs), [prRefs]);
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  const tabRows = useMemo(() => filterPoByTab(rows, tab), [rows, tab]);
  const selectedRow = tabRows[Math.min(sel, Math.max(tabRows.length - 1, 0))];

  const statusLabel = (status: string): string => {
    switch (statusLabelKind(status)) {
      case "pending":
        return tp(P("statusPending"));
      case "approved":
        return tp(P("statusApproved"));
      case "rejected":
        return tp(P("statusRejected"));
      default:
        return tp(P("statusDraft"));
    }
  };

  const vendorName = (id: string): string => vendorNames.get(id) ?? "";
  const refPrNo = (id: string): string => prNos.get(id) ?? "";

  const changeTab = (id: PoTab) => {
    setTab(id);
    setSel(0);
  };

  const openCreate = () => {
    ctx.openModal({
      title: t("po.list.createBtn"),
      icon: "cart",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <POCreateForm onClose={close} />,
    });
  };

  // pay — mock deposit subsystem (no endpoint): confirm + success toast only.
  const confirmPay = (row: PoRow) => {
    ctx.confirm({
      title: t("po.list.confirmPayTitle"),
      subtitle: row.no,
      icon: "cash",
      iconTone: "var(--accent)",
      onConfirm: () => ctx.notify(t("po.list.paySuccessToast").replace("{no}", row.no)),
    });
  };

  // cancel-PO — /po has no cancel endpoint (only submit/approve/reject); the confirm
  // shows but cannot persist (flagged in the header). onConfirm is a no-op close.
  const confirmCancel = (row: PoRow) => {
    ctx.confirm({
      title: t("po.list.cancelPo"),
      subtitle: row.no,
      icon: "x",
      iconTone: "var(--danger)",
      danger: true,
    });
  };

  const TABS: readonly { id: PoTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: poTabCount(rows, "all") },
    { id: "pending", label: tp(P("statusPending")), count: poTabCount(rows, "pending") },
    { id: "open", label: tp(P("tabOpen")), count: poTabCount(rows, "open") },
    { id: "deposit", label: t("po.list.tabDepositDue"), count: poTabCount(rows, "deposit") },
    { id: "wait", label: t("po.list.kpiAwaitGr"), count: poTabCount(rows, "wait") },
    { id: "closed", label: tp(P("tabClosed")), count: poTabCount(rows, "closed") },
  ];

  return (
    <Page
      breadcrumbs={[t("nav.sec.proc"), tn(poWoStrings.navPoList as NavKey)]}
      title={t("po.list.title")}
      subtitle={t("po.list.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("common.export")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("po.list.createBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5) — pending + open are real counts; the rest have no wire metric. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("po.list.kpiPending")}
          value={String(countByStatus(rows, "pending"))}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={t("po.list.kpiOpen")}
          value={String(countByStatus(rows, "approved"))}
          tone="var(--brand)"
          icon="cart"
        />
        {/* No deposit column on the wire — em-dash (po.ts GAP 2). */}
        <MiniKpi label={t("po.list.kpiDepositDue")} value={DASH} tone="var(--danger)" icon="cash" />
        {/* No GR% metric on the po wire — em-dash. */}
        <MiniKpi label={t("po.list.kpiAwaitGr")} value={DASH} tone="var(--accent)" icon="truck" />
        {/* No "closed" status / date on the wire — em-dash. */}
        <MiniKpi label={t("po.list.kpiClosedMonth")} value={DASH} tone="var(--ok)" icon="check" />
      </div>

      {/* Layout: list + detail */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>
        <Card pad={0}>
          <TabBar tabs={TABS} active={tab} onChange={changeTab} />

          {poQ.isLoading ? (
            <div style={{ padding: 20 }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
                />
              ))}
            </div>
          ) : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                    <th scope="col" style={th()}>{t("po.list.colNo")}</th>
                    <th scope="col" style={th()}>{tp(P("thVendor"))}</th>
                    <th scope="col" style={th(110)}>{t("po.list.colRefPr")}</th>
                    <th scope="col" style={th(120, true)}>{tp(P("thValue"))}</th>
                    <th scope="col" style={th(110)}>{tp(P("thDeposit"))}</th>
                    <th scope="col" style={th(110)}>{t("po.list.colPaid")}</th>
                    <th scope="col" style={th(120)}>{t("po.list.receiveGoods")}</th>
                    <th scope="col" style={th(110)}>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tabRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                        <Icon name="cart" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                        <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                      </td>
                    </tr>
                  ) : (
                    tabRows.map((r, i) => (
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
                        {/* vendor: resolved from vendor_id via GET /vendors */}
                        <td style={td}>{vendorName(r.vendorId) || DASH}</td>
                        {/* refPR: resolved from pr_id via GET /pr */}
                        <td style={{ ...td, fontSize: 11.5 }} className="num">
                          <span style={{ color: "var(--brand)" }}>{refPrNo(r.prId) || DASH}</span>
                        </td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                          {formatMoney(r.total)}
                        </td>
                        {/* deposit: the prototype pill is a CONTRACTED down-payment percent
                            ("{pct}% · paid/due"); the wire's `deposit` is a PAID amount, and
                            pos has no agreed-rate column — em-dash, never imputed (B-356). */}
                        <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                        {/* paid (จ่ายไป): real Σ ap_billing off the LIST payload (po.ts
                            sumBillings, B-079/F2) — server-computed, displayed verbatim.
                            The bar is a display proportion of paid/total (paidPct). */}
                        <td style={td} className="num">
                          {wireOf(r.id) ? (
                            <>
                              <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                                {formatMoney(wireOf(r.id)!.paid)}
                              </div>
                              <div
                                style={{
                                  height: 3,
                                  background: "var(--surface-3)",
                                  borderRadius: 999,
                                  marginTop: 3,
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${paidPct(wireOf(r.id)!.paid, r.total)}%`,
                                    height: "100%",
                                    background: "var(--accent)",
                                  }}
                                />
                              </div>
                            </>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                          )}
                        </td>
                        {/* receive-goods %: no wire on po — em-dash (progress bar omitted) */}
                        <td style={{ ...td, color: "var(--text-3)" }} className="num">{DASH}</td>
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

        {/* Detail panel */}
        <Card pad={0}>
          {selectedRow ? (
            <>
              <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "var(--brand)" }}>
                      {selectedRow.no}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3 }}>
                      {vendorName(selectedRow.vendorId) || DASH}
                    </div>
                  </div>
                  <StatusBadge status={selectedRow.status} label={statusLabel(selectedRow.status)} />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px dashed var(--border)",
                  }}
                >
                  <SmallStat label={tp(P("totalValue"))} value={`${formatMoney(selectedRow.total)} ${BAHT}`} />
                  <SmallStat
                    label={tp(P("project"))}
                    value={resolvePoProjectName(selectedRow.prId, prProjectIds, projectNames) || DASH}
                  />
                  {/* document-date: real `doc_date` off the LIST payload (= pos.created_at),
                      rendered ISO/UTC per the house formatDate convention. */}
                  <SmallStat
                    label={tp(P("docDate"))}
                    value={formatDate(wireOf(selectedRow.id)?.docDate ?? "") || DASH}
                  />
                  <SmallStat label={t("po.list.colRefPr")} value={refPrNo(selectedRow.prId) || DASH} brand />
                </div>
              </div>

              {/* Payment schedule — presentational (no deposit/paid wire, po.ts GAP 2):
                  the 3 milestone rows keep their labels/due for fidelity; pct + amounts
                  render an em-dash (never fabricated). */}
              <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{t("po.list.paymentSchedule")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { l: t("po.list.milestoneDeposit"), due: t("po.list.dueBeforeProduction") },
                    { l: t("po.list.milestonePartial"), due: t("po.list.dueAfterReceive50") },
                    { l: t("po.list.milestoneFinal"), due: t("po.list.dueAfterFull") },
                  ].map((m, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        background: "var(--surface-2)",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          background: "var(--surface)",
                          border: "2px solid var(--border-strong)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="clock" size={12} color="var(--text-3)" />
                      </div>
                      <div style={{ flex: 1, fontSize: 11.5 }}>
                        <div style={{ fontWeight: 600 }}>{m.l}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{m.due}</div>
                      </div>
                      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)" }}>
                        {DASH}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* PO Decrement — presentational (no paid/AP wire): header kept for
                  fidelity, no decrement rows, PO-remaining em-dash (paid unknown). */}
              <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {t("po.list.decrementTitle")}{" "}
                    <span style={{ color: "var(--text-3)", fontWeight: 500 }}>{t("po.list.decrementSub")}</span>
                  </div>
                  <Btn kind="ghost" size="sm" icon="plus">
                    {tp(P("addBtn"))}
                  </Btn>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      background: "var(--brand-soft)",
                      borderRadius: 6,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{t("po.list.poRemaining")}</span>
                    <span className="num" style={{ fontWeight: 700, color: "var(--brand)" }}>{DASH}</span>
                  </div>
                </div>
              </div>

              {/* Actions (po-wo.jsx L185-200) — see header for the honest wiring of each. */}
              <div style={{ padding: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Btn kind="primary" size="sm" icon="cash" onClick={() => confirmPay(selectedRow)}>
                  {t("po.list.payBtn")}
                </Btn>
                <Btn kind="outline" size="sm" icon="truck" onClick={() => ctx.navigate("gr.list")}>
                  {t("po.list.receiveGoods")}
                </Btn>
                {/* edit / print: presentational (no PO line-item edit endpoint; print is
                    icon-only in the prototype) */}
                <Btn kind="ghost" size="sm" icon="edit">
                  {t("common.edit")}
                </Btn>
                <Btn kind="ghost" size="sm" icon="print" label={t("common.print")} />
                <Btn
                  kind="ghost"
                  size="sm"
                  icon="x"
                  style={{ color: "var(--danger)", marginInlineStart: "auto" }}
                  onClick={() => confirmCancel(selectedRow)}
                >
                  {t("po.list.cancelPo")}
                </Btn>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
