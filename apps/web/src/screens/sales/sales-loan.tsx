/*
 * SalesLoan — the loan & transfer register screen (route sales.loan), ported from
 * pototype/sales-process.jsx SalesLoan (L493-598). Section module sales_re (registry.ts
 * L168). The port: a 5-KPI strip over a tabbed loan-application table (the 5-status
 * lifecycle submitted | approved | partial | rejected | transfer), driven by the real
 * loan register.
 *
 * Design fidelity (PLAN.md section 0 rule 1): the two-crumb breadcrumb
 * (sales.common.breadcrumbRoot / sales.loan.breadcrumb), the title + subtitle, the two
 * header actions (sales.loan.btnStatusAll / sales.loan.btnRecordTransfer), the 5 MiniKpi
 * cards, the TabBar (all / submitted / approved / transfer / rejected), and the 8-column
 * table (customer-unit / bank / requested / approved / term / submit-result / transfer-due
 * / status) are the prototype's. MiniKpi + TabBar + StatusBadge are inlined from the
 * wo-list / po-list precedents (ds.jsx).
 *
 * Data (rule 3): GET /sales/loans (use-sales-loan.ts) via the generated client — the
 * prototype's local mock array (L542-548) becomes the server register. Each row is the
 * opaque wire { id, sales_unit_id, bank, ask_amt, approved_amt, currency_code, term,
 * submit_date, result_date, status, created_at } (land-sales.ts loanWire). Pure
 * narrowing / status grouping / tab partition / KPI counts (toLoanRow / filterLoanByTab /
 * countByStatus / statusTone / statusLabelKind / formatMoney) live in sales-loan-rows.ts
 * (unit-tested, G3). The tabs filter the real rows client-side (the prototype's onChange
 * was a mock no-op; the counts here are real, C10).
 *
 * WRITE — every write affordance is honest-disabled (reported, never faked):
 *   - "record transfer" (sales.loan.btnRecordTransfer, header primary): the prototype's
 *     TransferForm is a GL-posting ownership-transfer that belongs to the DEFERRED
 *     sales.transfer screen (its endpoint is out of scope) -> DISABLED.
 *   - status filter (sales.loan.btnStatusAll, header): the prototype's per-status filter
 *     is a mock notify; the real filtering is the TabBar, so this redundant button ->
 *     DISABLED (sales-crm precedent).
 *   - CREATE LOAN: POST /sales/loans exists on the API, but the prototype's SalesLoan
 *     screen has NO create-loan form and B-153 minted no create-form i18n keys.
 *     Consume-only forbids minting (missing key -> em-dash/omit + report), fidelity
 *     forbids inventing a form not in the prototype -> no create form is surfaced. This
 *     is the port's one open decision (see the port report): wiring create requires a
 *     sacred i18n round to mint the form keys first.
 *
 * HONEST DIVERGENCES (rule 4 — never fabricated):
 *   - customer/unit cell: the wire returns only sales_unit_id (a raw uuid); there is no
 *     clean 1-hop path to the buyer name / unit code, so the cell is em-dashed (the uuid
 *     is never leaked). Its header reuses sales.down.thCustomerUnit (identical text; the
 *     sales.loan namespace has no own header key — consume-only, no mint).
 *   - transfer-due column: no wire column at all -> em-dashed for every row.
 *   - approved amount: null (not yet approved) or 0 (declined limit) -> em-dash; a real
 *     figure is tone-coded (== requested -> ok, 0 -> danger, else warn), per the prototype.
 *   - KPI values: submitted-total / approved / waiting / rejected-or-reduced are REAL
 *     counts (C10). "transfer this week" carries a time-window the wire cannot supply ->
 *     em-dashed. KPI sub-captions: kpiSubCustBank + kpiSubFindOther are real keys;
 *     kpiSubNormalDays is genuinely ABSENT from i18n-full.json -> em-dashed (reported,
 *     never minted); the two fabricated money sub-captions (no key) are omitted.
 *   - the prototype's per-row "note" and the "today" transfer highlight have no wire
 *     signal and are omitted (no invented data).
 *
 * i18n (rule 2): every visible string is a sales.loan.* / sales.down.thCustomerUnit /
 * common.* dict key (t) — consume-only (no key minted here). No Thai literal lives in
 * source (rule 2); tokens back every colour (rule 6).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useSalesLoans } from "./use-sales-loan";
import {
  LOAN_TABS,
  toLoanRow,
  filterLoanByTab,
  loanTabCount,
  countByStatus,
  countRejectedOrReduced,
  statusTone,
  statusLabelKind,
  formatMoney,
  type LoanRow,
  type LoanTab,
} from "./sales-loan-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Table header cell style (ds.jsx th(), same as po-list/gr-list). */
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
const td: CSSProperties = { padding: "14px", verticalAlign: "middle", fontSize: 12.5 };

/** MiniKpi, inlined from wo-list.tsx (ds.jsx MiniKpi) — the KPI-strip card. */
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
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}>
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

/** TabBar, inlined from po-list.tsx (ds.jsx TabBar L302-327). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: LoanTab; label: string; count: number }[];
  active: LoanTab;
  onChange: (id: LoanTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
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

/** StatusBadge (sales-process.jsx SalesLoan L572-588): tokened bg/fg, no dot. */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = statusTone(status);
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function SalesLoan() {
  const { t } = useI18n();

  const loansQ = useSalesLoans();
  const [tab, setTab] = useState<LoanTab>("all");

  const rows = useMemo<LoanRow[]>(() => (loansQ.data ?? []).map(toLoanRow), [loansQ.data]);
  const tabRows = useMemo(() => filterLoanByTab(rows, tab), [rows, tab]);

  /** The tab label (consume-only common.all + sales.loan.* keys). */
  const tabLabel = (id: LoanTab): string =>
    id === "all"
      ? t("common.all")
      : id === "submitted"
        ? t("sales.loan.tabSubmitted")
        : id === "approved"
          ? t("sales.loan.approved")
          : id === "transfer"
            ? t("sales.loan.transfer")
            : t("sales.loan.rejected");

  /** The status-badge label (sales-process.jsx SalesLoan L584-587). */
  const statusLabel = (status: string): string => {
    switch (statusLabelKind(status)) {
      case "transfer":
        return t("sales.loan.transfer");
      case "waiting":
        return t("sales.loan.statusWaiting");
      case "rejected":
        return t("sales.loan.rejected");
      case "partial":
        return t("sales.loan.statusPartial");
      case "ready":
        return t("sales.loan.statusReadyTransfer");
    }
  };

  /** The bank-result date colour (prototype L568): rejected -> danger, waiting -> warn, else ok. */
  const resultColor = (status: string): string =>
    status === "rejected" ? "var(--danger)" : status === "submitted" ? "var(--warn)" : "var(--ok)";

  return (
    <Page
      breadcrumbs={[t("sales.common.breadcrumbRoot"), t("sales.loan.breadcrumb")]}
      title={t("sales.loan.title")}
      subtitle={t("sales.loan.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Per-status filter is a mock notify in the prototype; the TabBar is the real
              filter, so this redundant button is disabled (sales-crm precedent). */}
          <Btn kind="outline" size="md" icon="filter" disabled>
            {t("sales.loan.btnStatusAll")}
          </Btn>
          {/* Record-transfer targets the deferred sales.transfer screen (GL-posting
              transfer endpoint out of scope) -> disabled (honest). */}
          <Btn kind="primary" size="md" icon="check" disabled>
            {t("sales.loan.btnRecordTransfer")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5) — submitted-total / approved / waiting / rejected-or-reduced are
          REAL counts; "transfer this week" needs a time-window the wire lacks -> em-dash.
          kpiSubNormalDays is absent from i18n -> em-dashed; the fabricated money subs are omitted. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("sales.loan.kpiSubmitted")}
          value={String(rows.length)}
          sub={t("sales.loan.kpiSubCustBank")}
          tone="var(--brand)"
          icon="paperclip"
        />
        <MiniKpi
          label={t("sales.loan.approved")}
          value={String(countByStatus(rows, "approved"))}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi
          label={t("sales.loan.kpiWaiting")}
          value={String(countByStatus(rows, "submitted"))}
          sub={DASH}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={t("sales.loan.kpiRejected")}
          value={String(countRejectedOrReduced(rows))}
          sub={t("sales.loan.kpiSubFindOther")}
          tone="var(--danger)"
          icon="x"
        />
        <MiniKpi
          label={t("sales.loan.kpiTransferThisWeek")}
          value={DASH}
          tone="var(--accent)"
          icon="calendar"
        />
      </div>

      <Card pad={0}>
        <TabBar
          tabs={LOAN_TABS.map((id) => ({ id, label: tabLabel(id), count: loanTabCount(rows, id) }))}
          active={tab}
          onChange={setTab}
        />

        {loansQ.isLoading ? (
          <div style={{ padding: 16, display: "grid", gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{ height: 44, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={th()}>{t("sales.down.thCustomerUnit")}</th>
                <th style={th(140)}>{t("sales.loan.thBank")}</th>
                <th style={th(130, true)}>{t("sales.loan.thRequested")}</th>
                <th style={th(130, true)}>{t("sales.loan.thApproved")}</th>
                <th style={th(90)}>{t("sales.loan.thTerm")}</th>
                <th style={th(120)}>{t("sales.loan.thSubmitResult")}</th>
                <th style={th(120)}>{t("sales.loan.thTransferDue")}</th>
                <th style={th(130)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {tabRows.map((r) => {
                const approvedText =
                  r.approvedAmt == null || r.approvedAmt === 0 ? DASH : formatMoney(r.approvedAmt);
                const approvedColor =
                  r.approvedAmt != null && r.approvedAmt === r.askAmt
                    ? "var(--ok)"
                    : r.approvedAmt === 0
                      ? "var(--danger)"
                      : "var(--warn)";
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: r.status === "rejected" ? "var(--danger-soft)" : "transparent",
                    }}
                  >
                    {/* customer/unit: wire has only sales_unit_id (uuid), no clean resolution -> em-dash. */}
                    <td style={td}>{DASH}</td>
                    <td style={td}>
                      {r.bank ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "var(--info-soft)",
                            color: "var(--info)",
                          }}
                        >
                          {r.bank}
                        </span>
                      ) : (
                        DASH
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="num">
                      {r.askAmt == null ? DASH : formatMoney(r.askAmt)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: approvedColor }} className="num">
                      {approvedText}
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }} className="num">
                      {r.term == null ? DASH : `${r.term} ${t("sales.loan.yearsSuffix")}`}
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }}>
                      <div style={{ color: "var(--text-3)" }}>{r.submitDate || DASH}</div>
                      <div style={{ color: resultColor(r.status), fontWeight: 600 }}>{r.resultDate || DASH}</div>
                    </td>
                    {/* transfer-due: no wire column -> em-dash. */}
                    <td style={{ ...td, fontSize: 11.5 }}>{DASH}</td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
                    </td>
                  </tr>
                );
              })}
              {tabRows.length === 0 && (
                <tr>
                  {/* No empty-state key exists in i18n-full.json for this screen (the
                      prototype always renders mock rows) -> em-dash, never minted. */}
                  <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                    {DASH}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
