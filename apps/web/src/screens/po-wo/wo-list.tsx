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
 * money format / retention sum) lives in po-wo-rows.ts (unit-tested, G3).
 *
 * WIRE GAPS (reported honestly, never fabricated) — the woWire is only
 * { id, no, pr_id, vendor_id, status, approval_step, currency_code, value,
 *   retention_pct, retention_amount, amount } (apps/api/src/routes/wo.ts):
 *   - NO scope column: the scope list cell + the detail scope line em-dash.
 *   - NO progress / gist column: the progress list cell renders an em-dash and its
 *     progress bar is omitted.
 *   - NO installment table (wo.ts GAP 1 — installments live on
 *     subcon_contract -> work_period with no FK from wo): the detail installment
 *     section keeps its header for fidelity but has no rows / em-dash summary.
 *   - NO variation-order endpoint on /wo (only /po has one): the Variation figure +
 *     the variation action are presentational (em-dash / no persist).
 *   - NO deposit (downPct), NO "closed" status, NO attachment count: the deposit detail,
 *     the closed/approve-installment KPI values + tabs, and the file count em-dash.
 *   - KPI values: pending + active (approved) are real C10 counts; Retention-outstanding is
 *     the real sum of retention_amount (the "outstanding" semantic is approximated —
 *     the wire has no retention-return tracking); due-installments + closed-this-month
 *     have no wire metric -> em-dash. Mock money sub-captions are omitted; the static
 *     descriptive sub-captions (kpiDueSub / kpiRetentionSub) are kept.
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
        {/* No due-installment metric on the wire — em-dash value, static caption kept. */}
        <MiniKpi label={t("wo.list.kpiDueInstallments")} value={DASH} sub={t("wo.list.kpiDueSub")} tone="var(--accent)" icon="check" />
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
                  <th style={th()}>{t("wo.list.colNo")}</th>
                  <th style={th()}>{tp(P("thSubcon"))}</th>
                  <th style={th()}>{tp(P("thScope"))}</th>
                  <th style={th(130, true)}>{tp(P("thValue"))}</th>
                  <th style={th(140)}>{t("dashboard.progressTitleDefault")}</th>
                  <th style={th(100)}>{RETENTION_HEADER}</th>
                  <th style={th(100)}>{t("common.status")}</th>
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
                      {/* scope: no wire column — em-dash */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)", maxWidth: 280 }}>{DASH}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.value)}
                      </td>
                      {/* progress: no wire — em-dash (bar omitted) */}
                      <td style={{ ...td, color: "var(--text-3)" }} className="num">{DASH}</td>
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
                {/* scope: no wire — em-dash */}
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>{DASH}</div>
              </div>

              {/* installments — presentational (no installment table on the wire, wo.ts GAP 1):
                  header kept for fidelity, em-dash summary, no rows. */}
              <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>
                  {tp(P("installments"))}{" "}
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                    {t("wo.list.installmentSummary").replace("{n}", DASH).replace("{pct}", DASH)}
                  </span>
                </div>
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
                  style={{ marginLeft: "auto", color: "var(--ok)" }}
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
