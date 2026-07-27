/*
 * SalesDown — the down-payment register + receive screen (route sales.down), ported
 * from pototype/sales-process.jsx SalesDown (L362-457) + DownPaymentReceiveForm
 * (L459-487). Section module sales_re (registry.ts L167). Precedent: ar-rv (a
 * server-computed receipt screen with money authority).
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (sales root crumb /
 * sales.down.breadcrumb), the title + subtitle, the Export + receive header actions, the
 * 5-card MiniKpi strip, the 4-tab TabBar over the 8-column per-unit register, and the
 * receive modal keep the prototype's shape. The receive action opens DownReceiveForm (a
 * REAL POST /sales/downs).
 *
 * DATA (rule 3): GET /sales/downs (use-sales-down.ts) via the generated client — the
 * prototype's hardcoded per-unit array becomes the real server catalogue. That wire
 * gives ONE row per instalment { sales_unit_id, unit_id, seq, amount, paid_at,
 * currency_code }; aggregateByUnit (sales-down-rows.ts, unit-tested G3) folds it into
 * the per-unit register.
 *
 * money = SERVER (rule: this is a WRITE screen with money authority): the register is a
 * pure read; the receive modal POSTs ONLY { sales_unit_id, amount, paid_at? } — the
 * server auto-assigns the instalment seq (existing + 1), posts + balances the receipt
 * JV (Dr 1020 bank / Cr 2040 advance-received = amount), and returns jv_no. The client
 * NEVER sends a seq, a Dr/Cr line, or a JV/RV number (buildDownBody enforces this). A
 * duplicate seq answers 409 (idempotent replay), surfaced honestly by the form.
 *
 * REAL vs em-dash (honest, never fabricated) — see sales-down-rows.ts:
 *   - customer name  -> the /sales/downs wire has NO customer_id -> em-dash (the modal
 *                       picker resolves a name via /sales/contracts + /customers, which
 *                       the register wire cannot).
 *   - unit code      -> the wire's unit_id is the project_node UUID, not the human "B-12"
 *                       code -> em-dash (ap-pv "ref" precedent: a bare UUID FK is not a
 *                       meaningful label).
 *   - plan schedule  -> no plan definition on the wire ("10 instalments · 47,350") -> em-dash.
 *   - progress       -> `done` (instalment count) is REAL; the plan TOTAL is not -> the
 *                       cell shows "{done}/—" (no fabricated fraction, no bar).
 *   - total / remaining / next / status -> all need the plan total or a due schedule the
 *                       wire lacks -> em-dash (the status/next-due keys stay consume-only
 *                       unused, like sales-crm's warm/cold — never minted).
 *   REAL: `paid` (Σ instalment amounts) per unit; the paying-units KPI (register row
 *   count) and the cumulative-down KPI (Σ every instalment amount). The three KPIs
 *   needing a month window / due-schedule / plan total are em-dashed (ar-rv precedent);
 *   the mock KPI sub-captions are dropped.
 *
 * Export (rule 8): no server endpoint -> the prototype's client-intent toast
 * (sales.down.notifyExport), the blessed presentational-action pattern (ar-rv export).
 *
 * i18n (rule 2): every string resolves via t() from the DICT (i18n-full.json) — the
 * sales.down.* keys plus reused common.all (the "all" tab) / common.status / common.cancel.
 * CONSUME-ONLY: no key is minted here. sales.down.notifyReceiveSaved is genuinely ABSENT
 * (and the prototype toast names a mock RV number the server does not return — it returns
 * jv_no), so the receive success is signalled by the honest register refresh, NOT a
 * fabricated toast (gl.close precedent). Tokens back every colour (rule 6); ZERO Thai/baht
 * in this .tsx (B-073) — every glyph lives only in i18n-full.json.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useCustomerList } from "../master/use-master-customer";
import { useSalesDowns, useSalesContracts, useCreateSalesDown } from "./use-sales-down";
import {
  toDownRow,
  aggregateByUnit,
  cumulativeDown,
  formatMoney,
  toContractUnit,
  toCustomerRef,
  customerNameById,
  downSubmittable,
  buildDownBody,
  type UnitDownRow,
  type DownDraft,
} from "./sales-down-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
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

/** Header field input style (ar-rv-form / jv-create-form headInput). */
const headInput: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/** Extract an error message off an unknown mutation error (ar-rv-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as ar-rv / sales-crm). No mock sub. */
function MiniKpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
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
      </div>
    </div>
  );
}

/**
 * TabBar (ds.jsx TabBar). PRESENTATIONAL: `active` is fixed to "all" and the tabs do not
 * partition the list (the prototype's own onChange is a no-op), matching ap-billing.
 * Only the "all" count is derivable (the register row count); the due-7 / overdue /
 * complete counts need a due schedule + plan total the wire lacks -> em-dash.
 */
function TabBar({ tabs }: { tabs: readonly { id: string; label: string; count: string }[] }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = tab.id === "all";
        return (
          <div
            key={tab.id}
            style={{
              padding: "15px 14px",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {tab.label}
            <span
              className="num"
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
          </div>
        );
      })}
    </div>
  );
}

/**
 * DownReceiveForm — the receive-down-payment modal body (sales-process.jsx
 * DownPaymentReceiveForm), inlined like the prototype keeps it in sales-process.jsx.
 *
 * WIRED: a REAL POST /sales/downs. money=SERVER — the client supplies ONLY the unit,
 * the received amount, and an optional receive date; the server assigns the seq, posts +
 * balances the JV, and returns jv_no.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the prototype's instalment-no field is DROPPED: the server owns the seq
 *     (existing + 1) — collecting it would gather data the client must not send.
 *   - the prototype's payment-method field is DROPPED: the POST body has NO
 *     method counterpart (ar-rv-form drop-not-collect precedent).
 *   - the prototype's auto-GL box (Dr 1101 / Cr 2151, RV-2026-0096) is DROPPED: posting a
 *     JV client-side is forbidden — the server posts it and returns jv_no.
 *   - the customer/unit picker resolves a real customer name via /sales/contracts +
 *     /customers; an unresolved buyer em-dashes (the uuid is never leaked).
 *   - on success there is NO toast (sales.down.notifyReceiveSaved is absent + names a mock
 *     RV number the server does not return) — the register refresh is the honest feedback.
 *   - print-receipt has no endpoint -> the prototype's client-intent toast.
 */
function DownReceiveForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const contractsQ = useSalesContracts();
  const customersQ = useCustomerList();
  const createDown = useCreateSalesDown();

  const [salesUnitId, setSalesUnitId] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [paidAt, setPaidAt] = useState("");

  const units = useMemo(
    () => (contractsQ.data ?? []).map(toContractUnit),
    [contractsQ.data],
  );
  const custMap = useMemo(
    () => customerNameById((customersQ.data ?? []).map(toCustomerRef)),
    [customersQ.data],
  );

  const amount = Number.parseFloat(amountRaw);
  const amountNum = Number.isFinite(amount) ? amount : 0;
  const draft: DownDraft = { salesUnitId, amount: amountNum, paidAt };

  const submit = () => {
    if (!downSubmittable(draft)) return;
    // money=SERVER: only { sales_unit_id, amount, paid_at? } — the server owns the seq +
    // the JV; a duplicate seq (409) is surfaced honestly below.
    createDown.mutate(buildDownBody(draft), {
      // No success toast (the notifyReceiveSaved key is absent + names a mock RV number
      // the server does not return): the register refresh (the hook invalidates the list)
      // is the honest success feedback (gl.close precedent).
      onSuccess: () => onClose(),
      onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Unit picker: contracted sales units (real customer name via /customers). */}
        <Field label={t("sales.down.fieldCustomerUnit")} required style={{ gridColumn: "1 / -1" }}>
          <select value={salesUnitId} onChange={(e) => setSalesUnitId(e.target.value)} style={headInput}>
            <option value="">{DASH}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {custMap.get(u.customerId) || DASH}
              </option>
            ))}
          </select>
        </Field>
        {/* Amount received — the real cash the client supplies (required, finite > 0). */}
        <Field label={t("sales.down.fieldAmount")} required>
          <input
            type="number"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            className="num"
            style={{ ...headInput, fontFamily: "var(--font-num)" }}
          />
        </Field>
        {/* Receive date -> the optional paid_at (server defaults to today when omitted). */}
        <Field label={t("sales.down.fieldReceiveDate")}>
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="num"
            style={{ ...headInput, fontFamily: "var(--font-num)" }}
          />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("sales.down.notifyPrintReceipt"))}>
          {t("sales.down.btnPrintReceipt")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!downSubmittable(draft) || createDown.isPending}
        >
          {t("sales.down.btnSaveGl")}
        </Btn>
      </div>
    </>
  );
}

export function SalesDown() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const downsQ = useSalesDowns();
  const flat = useMemo(() => (downsQ.data ?? []).map(toDownRow), [downsQ.data]);
  const register = useMemo<UnitDownRow[]>(() => aggregateByUnit(flat), [flat]);
  const cumulative = useMemo(() => cumulativeDown(flat), [flat]);

  const openReceive = () => {
    ctx.openModal({
      title: t("sales.down.receiveModalTitle"),
      subtitle: t("sales.down.receiveModalSubtitle"),
      icon: "cash",
      iconTone: "var(--ok)",
      size: "md",
      body: ({ close }: { close: () => void }) => <DownReceiveForm onClose={close} />,
    });
  };

  const TABS = [
    { id: "all", label: t("common.all"), count: String(register.length) },
    { id: "due", label: t("sales.down.tabDue7"), count: DASH },
    { id: "over", label: t("sales.down.overdue"), count: DASH },
    { id: "complete", label: t("sales.down.tabComplete"), count: DASH },
  ];

  return (
    <Page
      breadcrumbs={[t("sales.common.breadcrumbRoot"), t("sales.down.breadcrumb")]}
      title={t("sales.down.title")}
      subtitle={t("sales.down.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("sales.down.notifyExport"))}>
            {t("sales.down.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="cash" onClick={openReceive}>
            {t("sales.down.btnReceive")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5): paying-units (register row count) + cumulative-down (Σ instalment
          amounts) are REAL; the month / overdue / next-month-complete metrics need a due
          schedule + plan total the wire lacks -> em-dash (ar-rv precedent). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={t("sales.down.kpiPaying")} value={String(register.length)} tone="var(--brand)" icon="users" />
        <MiniKpi label={t("sales.down.kpiInstallmentsMonth")} value={DASH} tone="var(--ok)" icon="check" />
        <MiniKpi label={t("sales.down.overdue")} value={DASH} tone="var(--danger)" icon="warn" />
        <MiniKpi label={t("sales.down.kpiCumDown")} value={formatMoney(cumulative)} tone="var(--accent)" icon="ledger" />
        <MiniKpi label={t("sales.down.kpiCompleteNextMonth")} value={DASH} tone="var(--info)" icon="arrowR" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} />

        {downsQ.isLoading ? (
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
                <th scope="col" style={th()}>{t("sales.down.thCustomerUnit")}</th>
                <th scope="col" style={th(140)}>{t("sales.down.thPlan")}</th>
                <th scope="col" style={th(160)}>{t("sales.down.thProgress")}</th>
                <th scope="col" style={th(130, true)}>{t("sales.down.thTotalDown")}</th>
                <th scope="col" style={th(130, true)}>{t("sales.down.thPaid")}</th>
                <th scope="col" style={th(130, true)}>{t("sales.down.thRemaining")}</th>
                <th scope="col" style={th(130)}>{t("sales.down.thNextInstallment")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {register.length === 0 ? (
                <tr>
                  {/* No dedicated empty-state i18n key exists (no minting) -> honest em-dash. */}
                  <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                register.map((r) => (
                  <tr key={r.salesUnitId} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* customer + unit: neither is on the /sales/downs wire (no customer_id;
                        unit_id is a UUID) -> both em-dash (honest; the uuid is never leaked). */}
                    <td style={td}>
                      <div style={{ fontWeight: 500, color: "var(--text-3)" }}>{DASH}</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="num">{DASH}</div>
                    </td>
                    {/* plan schedule: no plan definition on the wire -> em-dash. */}
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                    {/* progress: `done` is REAL; the plan total is not -> "{done}/—", no bar. */}
                    <td style={td}>
                      <span className="num" style={{ fontSize: 11.5, fontWeight: 700 }}>{r.done}</span>
                      <span style={{ color: "var(--text-3)" }}> / {DASH}</span>
                    </td>
                    {/* total down: needs the plan total (absent) -> em-dash. */}
                    <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">{DASH}</td>
                    {/* paid: Σ this unit's instalment amounts -> REAL. */}
                    <td style={{ ...td, textAlign: "right", color: "var(--ok)", fontWeight: 600 }} className="num">
                      {formatMoney(r.paid)}
                    </td>
                    {/* remaining: total - paid; total is absent -> em-dash. */}
                    <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">{DASH}</td>
                    {/* next instalment: no due schedule on the wire -> em-dash. */}
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                    {/* status (overdue vs complete): needs a schedule + plan total -> em-dash. */}
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
