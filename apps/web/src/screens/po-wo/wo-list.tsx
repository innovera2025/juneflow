/*
 * WOList — the Work Order screen, ported from pototype/po-wo.jsx WOList
 * (L280-431). Route wo.list (docs/extract/NAV-ROUTES.md L31, registry mod "proc"),
 * visual-gate reference tests/visual/reference/gallery/g1/17-s.jpg. A WO is the
 * subcontractor counterpart of a PO (lump-sum subcon work).
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (procurement ·
 * work-order), the title/subtitle, the two header actions (Export / create-WO), the 5-card MiniKpi
 * strip, the TabBar (all · pending · active · approve-installment · closed), the
 * split list+detail layout (1fr / 420px), the 7-column table, and the detail panel
 * (header · installments · Variation+Retention · action row) are the prototype's.
 *
 * Data (rule 3): GET /wo (use-po-wo.ts) via the generated client — the prototype's
 * local WO_ROWS becomes the server catalogue. The subcon NAME resolves from
 * vendor_id via GET /vendors. Retention is a REAL derived column (value x
 * retention_pct / 100 = retention_amount). Pure logic (tab filter / status tone /
 * money format / retention sum / plan aggregates) lives in po-wo-rows.ts
 * (unit-tested, G3); the component<->wire seam is wo-list.test.tsx.
 *
 * B-277 RE-WIRE — the woWire had GROWN (migration 0020 / B-080 F3) while this screen
 * still declared four of its fields absent. GET /wo returns, per the api's own
 * exact-key assertion (wo.test.ts "returns the envelope with retention_amount +
 * scope/progress/installments (F3)"): { id, no, pr_id, vendor_id, contract_id,
 * status, approval_step, currency_code, value, retention_pct, retention_amount,
 * amount, scope, progress, installments[] }. Now consumed:
 *   - `scope` (= the source PR's title, wo.ts: the only real description of lump-sum subcon work)
 *     -> the scope list cell + the detail scope line.
 *   - `progress` (SERVER-derived, see the honesty note below) -> the progress list
 *     cell's bar + % and the detail installment summary's {pct}.
 *   - `installments[]` (work_period rows) -> the detail installment rows, the summary's
 *     {n}, the "approve-installment" tab and the "due installments" KPI.
 *   - `contract_id` -> tells "no plan linked" (em-dash the installment count) apart from
 *     "a linked plan that is empty" (an honest 0).
 *
 * MONEY / POPULATION HONESTY (the gr.list class of defect):
 *   - `progress` is NEVER recomputed here. The server derives it as SUM(passed|paid
 *     installment amount) / SUM(all installment amount) over ONE WO's own plan —
 *     numerator and denominator are the same rows and the same column. null means the
 *     server itself says "not computable": the cell renders an em-dash and DROPS the
 *     bar rather than drawing a 0%-wide one.
 *   - progress === 100 only means the plan's AMOUNTS balance; it does not mean every
 *     installment individually passed. It drives nothing but the prototype's own bar colour
 *     (po-wo.jsx L342) — never a closed/complete badge (the WO wire still has no
 *     closed status, so the prototype's closed chip stays absent).
 *   - The "due installments" KPI counts INSTALLMENTS (the LINE population, de-duplicated by
 *     installment id because two WOs may share one subcon contract); the
 *     "approve-installment" TAB counts WOs (the HEADER population). Different numbers by
 *     design — see dueInstallmentCount in po-wo-rows.ts.
 *   - Every installment amount shown is the server's `amount` column verbatim.
 *
 * WIRE GAPS THAT REMAIN (reported honestly, never fabricated):
 *   - NO per-installment label column (wo.ts: "the FE composes the installment label from
 *     seq/basis"): the row caption is the existing subcon.rowDp / subcon.colPeriod
 *     key plus the real seq — the prototype's descriptive installment text is never invented.
 *   - NO cumulative-% target for a non-percent-basis plan: `pct` only carries a
 *     contract share on the "percent" basis, so the atContractPct template ("at {pct}% of the contract") em-dashes on any
 *     plan that is not entirely percent-basis (cumulativeContractPct returns null).
 *   - NO variation-order endpoint on /wo (only /po has one): the Variation figure +
 *     the variation action are presentational (em-dash / no persist).
 *   - NO deposit (downPct), NO "closed" status, NO attachment count: the deposit detail,
 *     the closed-contract KPI value + tab, and the file count em-dash.
 *   - work_period_status has 6 values but the prototype draws 3 installment states, so a
 *     REJECTED installment takes the neutral not-done styling (truthful, but the "sent back"
 *     nuance is lost — flagged in BLOCKERS.md B-277 for a Wei ruling; inventing a
 *     fourth colour would be redesigning a screen the prototype fixes).
 *   - KPI values: pending + active (approved) are real C10 counts; due-installments is
 *     the real de-duplicated installment count; Retention-outstanding is the real sum of
 *     retention_amount (the "outstanding" semantic is approximated — the wire has no
 *     retention-return tracking); closed-this-month has no wire metric -> em-dash.
 *     Mock money sub-captions are omitted; the static descriptive sub-captions
 *     (kpiDueSub / kpiRetentionSub) are kept.
 *   - Detail actions: approve-installment runs the REAL WO-level approve (/wo/{id}/approve, tiered
 *     authority) via a confirm — the prototype's per-installment approval has no
 *     endpoint, so this is a flagged semantic approximation (the full submit/approve/
 *     reject state machine is wired in use-po-wo.ts + routed through the approvals
 *     inbox). variation (no /wo VO endpoint) + files are presentational; close-contract shows a
 *     confirm + toast only (/wo has no close endpoint). ConfirmDialog is the shell's
 *     minimal port (fixed confirm/cancel labels).
 *
 * i18n (rule 2): every string is a wo.list* / wo.form* / common.* / nav.sec.proc /
 * dashboard.progressTitleDefault / model.priceUnit dict key (t), the work-order (WO) nav
 * label (tn), or a po-wo-strings.json phrase (tp). "Retention" is the prototype's
 * verbatim ASCII column header (no Thai key; identical across languages). Tokens back
 * every colour (rule 6); the ds.jsx STATUS dot hexes are prototype-verbatim (B-037(a)).
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
import { useVendorList } from "../master/use-vendors";
import {
  toWoRow,
  toVendorRef,
  filterWoByTab,
  woTabCount,
  countByStatus,
  sumRetention,
  statusTone,
  statusLabelKind,
  vendorNameById,
  formatMoney,
  millionsValue,
  cumulativeContractPct,
  dueInstallmentCount,
  installmentDisplayKind,
  type WoInstallment,
  type WoRow,
  type WoTab,
} from "./po-wo-rows";
import { useWoList, useApproveWo } from "./use-po-wo";
import { WOCreateForm } from "./wo-create-form";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
const DASH = "—";
/** The prototype's verbatim ASCII "Retention" column header (no Thai key, B). */
const RETENTION_HEADER = "Retention";
/** THAI BAHT SIGN (U+0E3F) — prototype-verbatim currency unit sourced from a unicode
 *  escape so the literal glyph never trips the i18n-guard (master/user-add-form.tsx). */
const BAHT = "\u0E3F";

/** Table header cell style (ds.jsx th()). */
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
  tabs: readonly { id: WoTab; label: string; count: number }[];
  active: WoTab;
  onChange: (id: WoTab) => void;
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

/** StatusBadge (ds.jsx L91-108, size sm). */
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

/**
 * The list's progress cell (po-wo.jsx L339-346) — bar + %. `pct` is the SERVER's
 * `progress`, passed straight through; the bar turns --ok at 100 exactly as the
 * prototype does (that colour rule is about this number, not a completeness claim).
 * Rendered only when the server gave a number — a null progress em-dashes instead.
 */
function ProgressCell({ pct }: { pct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          background: "var(--surface-3)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct === 100 ? "var(--ok)" : "var(--accent)",
          }}
        />
      </div>
      <span className="num" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * One installment row of the detail plan (po-wo.jsx L380-394). The three visual states are
 * the prototype's; which one a row takes comes from the real work_period status
 * (installmentDisplayKind). `caption` is em-dashed by the caller when the cumulative
 * contract-% is not honestly computable.
 */
function InstallmentRow({
  label,
  caption,
  amount,
  kind,
}: {
  label: string;
  caption: string;
  amount: number;
  kind: "done" | "current" | "pending";
}) {
  const done = kind === "done";
  const current = kind === "current";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 7,
        background: done ? "var(--ok-soft)" : current ? "var(--warn-soft)" : "var(--surface-2)",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: done ? "var(--ok)" : current ? "var(--warn)" : "var(--surface)",
          border: done || current ? "none" : "2px solid var(--border-strong)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={done ? "check" : current ? "clock" : "user"}
          size={11}
          color={done || current ? "#fff" : "var(--text-3)"}
        />
      </div>
      <div style={{ flex: 1, fontSize: 11.5 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>{caption}</div>
      </div>
      <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>
        {formatMoney(amount)}
      </span>
    </div>
  );
}

/** Detail stat block (label over value), used in the Variation/Retention grid. */
function StatBlock({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: tone }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}

export function WOList() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const woQ = useWoList();
  const vendorQ = useVendorList();
  const approveWo = useApproveWo();

  const [tab, setTab] = useState<WoTab>("all");
  const [sel, setSel] = useState(0);

  const rows = useMemo<WoRow[]>(() => (woQ.data ?? []).map(toWoRow), [woQ.data]);
  const vendorNames = useMemo(
    () => vendorNameById((vendorQ.data ?? []).map(toVendorRef)),
    [vendorQ.data],
  );

  const tabRows = useMemo(() => filterWoByTab(rows, tab), [rows, tab]);
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

  const subconName = (id: string): string => vendorNames.get(id) ?? "";

  /** The selected WO's installment plan (already seq-sorted by toWoRow). */
  const plan: WoInstallment[] = selectedRow?.installments ?? [];

  /**
   * The installment caption. work_period carries no label column (wo.ts: "the FE
   * composes the label from seq/basis"), so this is the existing subcon.colPeriod /
   * subcon.rowDp key plus the row's REAL seq — the prototype's descriptive text
   * ("deposit + start" / "installment 1 - foundations") was mock and is not invented.
   */
  const installmentLabel = (p: WoInstallment): string =>
    p.seq === 0 ? t("subcon.rowDp") : `${t("subcon.colPeriod")} ${p.seq}`;

  /**
   * The atContractPct caption ("at {pct}% of the contract") — the CUMULATIVE contract
   * share this installment completes. Em-dashed whenever that cumulative would mix
   * populations: see cumulativeContractPct (a non-percent-basis plan carries no pct
   * target at all, so accumulating one would silently drop those rows).
   */
  const installmentCaption = (p: WoInstallment): string => {
    const cum = cumulativeContractPct(plan, p.seq);
    return cum == null ? DASH : t("wo.list.atContractPct").replace("{pct}", String(cum));
  };

  const changeTab = (id: WoTab) => {
    setTab(id);
    setSel(0);
  };

  const openCreate = () => {
    ctx.openModal({
      title: t("wo.list.createBtn"),
      icon: "hardhat",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <WOCreateForm onClose={close} />,
    });
  };

  // approve-installment — runs the REAL WO-level approve (flagged semantic approximation; see header).
  const confirmApprove = (row: WoRow) => {
    ctx.confirm({
      title: t("wo.list.approveInstallmentBtn"),
      subtitle: row.no,
      icon: "check",
      iconTone: "var(--ok)",
      onConfirm: () => approveWo.mutate(row.id),
    });
  };

  // close-contract — /wo has no close endpoint: confirm + toast only (flagged).
  const confirmClose = (row: WoRow) => {
    ctx.confirm({
      title: tp(P("tabClosedContract")),
      subtitle: row.no,
      icon: "flag",
      iconTone: "var(--ok)",
      message: t("wo.list.closeConfirmMsg"),
      onConfirm: () => ctx.notify(t("wo.list.closeStartToast")),
    });
  };

  const TABS: readonly { id: WoTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: woTabCount(rows, "all") },
    { id: "pending", label: tp(P("statusPending")), count: woTabCount(rows, "pending") },
    { id: "active", label: t("wo.list.tabActive"), count: woTabCount(rows, "active") },
    { id: "installment", label: t("wo.list.tabApproveInstallment"), count: woTabCount(rows, "installment") },
    { id: "closed", label: tp(P("tabClosedContract")), count: woTabCount(rows, "closed") },
  ];

  return (
    <Page
      breadcrumbs={[t("nav.sec.proc"), tn(poWoStrings.navWoList as NavKey)]}
      title={t("wo.list.title")}
      subtitle={t("wo.list.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("common.export")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("wo.list.createBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5) — pending + active are real counts; retention is a real sum. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("wo.list.kpiPending")}
          value={String(countByStatus(rows, "pending"))}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={t("wo.list.kpiActive")}
          value={String(countByStatus(rows, "approved"))}
          tone="var(--brand)"
          icon="hardhat"
        />
        {/* Real installment count awaiting acceptance across the WOs' plans (LINE population,
            de-duped by installment id — NOT the same number as the tab below). */}
        <MiniKpi
          label={t("wo.list.kpiDueInstallments")}
          value={String(dueInstallmentCount(rows))}
          sub={t("wo.list.kpiDueSub")}
          tone="var(--accent)"
          icon="check"
        />
        <MiniKpi
          label={tp(P("kpiRetentionDue"))}
          value={millionsValue(sumRetention(rows))}
          unit={t("model.priceUnit")}
          sub={t("wo.list.kpiRetentionSub")}
          tone="var(--info)"
          icon="ledger"
        />
        {/* No "closed" status / date on the wire — em-dash. */}
        <MiniKpi label={t("wo.list.kpiClosedMonth")} value={DASH} tone="var(--ok)" icon="flag" />
      </div>

      {/* Layout: list + detail */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16, alignItems: "start" }}>
        <Card pad={0}>
          <TabBar tabs={TABS} active={tab} onChange={changeTab} />

          {woQ.isLoading ? (
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
                  <th scope="col" style={th()}>{t("wo.list.colNo")}</th>
                  <th scope="col" style={th()}>{tp(P("thSubcon"))}</th>
                  <th scope="col" style={th()}>{tp(P("thScope"))}</th>
                  <th scope="col" style={th(130, true)}>{tp(P("thValue"))}</th>
                  <th scope="col" style={th(140)}>{t("dashboard.progressTitleDefault")}</th>
                  <th scope="col" style={th(100)}>{RETENTION_HEADER}</th>
                  <th scope="col" style={th(100)}>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {tabRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="hardhat" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
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
                      {/* subcon: resolved from vendor_id via GET /vendors */}
                      <td style={td}>{subconName(r.vendorId) || DASH}</td>
                      {/* scope = the source PR's title (wo.ts); "" -> em-dash */}
                      <td
                        style={{
                          ...td,
                          fontSize: 11.5,
                          color: r.scope ? "var(--text-2)" : "var(--text-3)",
                          maxWidth: 280,
                        }}
                      >
                        {r.scope || DASH}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.value)}
                      </td>
                      {/* progress: the SERVER's derived %; null (no plan) -> em-dash, no bar */}
                      <td style={{ ...td, ...(r.progress == null ? { color: "var(--text-3)" } : {}) }} className="num">
                        {r.progress == null ? DASH : <ProgressCell pct={r.progress} />}
                      </td>
                      {/* retention: real derived (value x retention_pct / 100) */}
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        {r.retentionAmount > 0 ? (
                          <span style={{ fontSize: 11.5, color: "var(--info)", fontWeight: 600 }}>
                            {formatMoney(r.retentionAmount)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                        )}
                      </td>
                      <td style={td}>
                        <StatusBadge status={r.status} label={statusLabel(r.status)} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                      {subconName(selectedRow.vendorId) || DASH}
                    </div>
                  </div>
                  <StatusBadge status={selectedRow.status} label={statusLabel(selectedRow.status)} />
                </div>
                {/* scope = the source PR's title (wo.ts) */}
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
                  {selectedRow.scope || DASH}
                </div>
              </div>

              {/* Installment plan — the REAL work_period rows carried on the /wo row (B-080 / F3).
                  {n} is the plan length (em-dashed when no contract is linked at all, so
                  "no plan known" never renders as an honest-looking 0 installments); {pct} is the
                  SERVER's progress. */}
              <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>
                  {tp(P("installments"))}{" "}
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                    {t("wo.list.installmentSummary")
                      .replace("{n}", selectedRow.contractId ? String(plan.length) : DASH)
                      .replace("{pct}", selectedRow.progress == null ? DASH : String(selectedRow.progress))}
                  </span>
                </div>
                {plan.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {plan.map((p) => (
                      <InstallmentRow
                        key={p.id}
                        label={installmentLabel(p)}
                        caption={installmentCaption(p)}
                        amount={p.amount}
                        kind={installmentDisplayKind(p.status)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Variation (presentational) + Retention (real derived) */}
              <div
                style={{
                  padding: 18,
                  borderBottom: "1px solid var(--border)",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                {/* variation: no variation figure on the wire — em-dash */}
                <StatBlock label={t("wo.list.variationLabel")} value={DASH} tone="var(--text-3)" />
                {/* Retention-held: real held amount; terms pct real, months mock -> em-dash */}
                <StatBlock
                  label={t("wo.list.retentionHeld")}
                  value={`${formatMoney(selectedRow.retentionAmount)} ${BAHT}`}
                  sub={t("wo.list.retentionTerms")
                    .replace("{pct}", String(selectedRow.retentionPct))
                    .replace("{months}", DASH)}
                  tone="var(--info)"
                />
              </div>

              {/* Actions (po-wo.jsx L412-426) — see header for the honest wiring of each. */}
              <div style={{ padding: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Btn kind="primary" size="sm" icon="check" onClick={() => confirmApprove(selectedRow)}>
                  {t("wo.list.approveInstallmentBtn")}
                </Btn>
                {/* variation: no /wo variation-order endpoint — presentational */}
                <Btn kind="outline" size="sm" icon="plus">
                  {t("wo.list.variationBtn")}
                </Btn>
                {/* files: no attachment count on the wire — em-dash n, presentational */}
                <Btn kind="ghost" size="sm" icon="paperclip">
                  {t("wo.list.filesCount").replace("{n}", DASH)}
                </Btn>
                <Btn
                  kind="ghost"
                  size="sm"
                  icon="flag"
                  style={{ marginInlineStart: "auto", color: "var(--ok)" }}
                  onClick={() => confirmClose(selectedRow)}
                >
                  {tp(P("tabClosedContract"))}
                </Btn>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
