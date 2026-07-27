/*
 * SalesProcess — the "sell a unit" screen (route sales.process), ported from
 * pototype/sales-process.jsx SalesProcess (L21-217) + its three modals QuoteForm
 * (L219-264) / BookingForm (L266-307) / ContractForm (L309-356) + CustomerPicker
 * (L8-19). SalesDown / SalesLoan / TransferForm in the same .jsx are SEPARATE routes
 * (sales.down / sales.loan) and are intentionally NOT ported here.
 *
 * Design fidelity (PLAN.md sec.0 rule 1): the two-crumb breadcrumb + title/subtitle,
 * the project/phase filter chips + the create-QO header action, the left unit-grid Card
 * (14-col plan + 5-state legend + count line), the right unit-detail Card (code +
 * status badge + spec grid + promo + 4 actions), and the QO-list Card are the
 * prototype's. Every visible string is a sales.process/quote/booking/contract.* /
 * sales.common.* / common.* / ar.fldCustomer / fin.glAutoTitle / gl.stmt.* dict key
 * (t) — consume-only, NO key minted here. No Thai/baht literal lives in source
 * (rule 2, B-073); tokens back every colour.
 *
 * Data (rule 3): the 84-cell mock grid + CUSTOMER_SEED are dropped. The grid derives
 * from GET /projects/{id}/hierarchy (unit nodes; SA-3 source), with "booked"/"sold"
 * overlaid from GET /sales/bookings + /sales/contracts (matched by node id). Counts
 * RECOMPUTE from the real cells (C10). Pure narrowing/overlay/count logic lives in
 * sales-process-rows.ts (unit-tested, G3).
 *
 * MONEY = SERVER (the load-bearing rule): the BookingForm posts POST /sales/bookings
 * with ONLY {unit_id, amount, customer_id} — the SERVER posts the balanced JV
 * (Dr 1020 / Cr 2040 = amount) and returns jv_no; the client NEVER sends Dr/Cr,
 * account codes, or a JV/RV number. The GL panel is a presentational PREVIEW of that
 * posting (the entered amount on both legs). The ContractForm posts POST
 * /sales/contracts {sales_unit_id, amount} — NO JV (contract = unit metadata).
 *
 * HONEST DIVERGENCES (rule 4 — never fabricated; reported in the handoff):
 *  - QuoteForm + QO-list are SA-4 honest-empty: there is NO /sales/quotes endpoint, so
 *    the form is presentational/print-only (send-to-customer disabled) and the QO
 *    table renders an em-dash empty row (no wire). Its price-summary / payment-plan
 *    values are em-dashed (no wire); the plan's down-instalment row is OMITTED (no key).
 *  - Unit-detail spec grid (start-price / price-per-sqm / bed-bath / parking /
 *    construction / delivery) + the subtitle + the promo list have NO wire column in
 *    the hierarchy node -> em-dash / honest-empty (only code + status are real).
 *  - The booking/contract GL-preview account labels have no sales.* key; the closest
 *    existing COA keys are consumed (gl.stmt.rowCash for 1020, gl.stmt.rowAdvance for
 *    2040) + fin.glAutoTitle — the codes 1020/2040 are verbatim literals matching what
 *    the server posts (honest preview, never sent).
 *  - Presentational form fields with no wire/endpoint (dates, doc numbers, sales owner,
 *    receive method, down plan, bank loan) are readOnly; print / attach / view-history
 *    actions have no endpoint -> disabled. The contract customer select is informational
 *    (POST /sales/contracts takes no customer_id).
 *  - The make-contract action is disabled until the selected unit has a booking (the
 *    contract needs the sales_unit ROW id, which only a booking creates). Book-and-
 *    receive is enabled for any selected unit; the server 409s an already-booked unit
 *    and 403s a
 *    caller without finance.create. The returned jv_no surfaces as a toast (no success
 *    key to mint).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import {
  useProjectHierarchy,
  useSalesBookings,
  useSalesContracts,
  useSalesCustomers,
  useCreateSalesBooking,
  useCreateSalesContract,
} from "./use-sales-process";
import {
  toHierNode,
  toCustomerOption,
  unitCells,
  unitCounts,
  unitIdSet,
  salesUnitIdByUnitId,
  findCell,
  defaultSelectedId,
  cellShortLabel,
  parseAmount,
  formatMoney,
  str,
  type UnitCell,
  type UnitStatus,
  type CustomerOption,
} from "./sales-process-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Booking receipt JV posting accounts (verbatim COA literals — what the server posts). */
const ACCT_BANK = "1020";
const ACCT_ADVANCE = "2040";

/** Grid-cell background token per unit status (prototype bg ladder). */
const STATUS_BG: Record<UnitStatus, string> = {
  soldBuilt: "var(--ok)",
  sold: "var(--info)",
  booked: "var(--warn)",
  built: "var(--accent)",
  empty: "var(--surface-3)",
};

/** Legend rows (prototype order): label key + swatch token. */
const LEGEND: { key: DictKey; color: string; bordered: boolean }[] = [
  { key: "sales.process.legendDelivered", color: "var(--ok)", bordered: false },
  { key: "sales.process.legendSold", color: "var(--info)", bordered: false },
  { key: "sales.process.legendBooked", color: "var(--warn)", bordered: false },
  { key: "sales.process.legendBuilt", color: "var(--accent)", bordered: false },
  { key: "sales.process.legendAvailable", color: "var(--surface-3)", bordered: true },
];

/** Input / select style, mirrored from ar-invoice-form fieldStyle. */
function fieldStyle(): CSSProperties {
  return {
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
}

/** Extract an error message off an unknown mutation error (ar-invoice precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** The status-badge label key for a unit's final display status. */
function statusLabelKey(status: UnitStatus): DictKey {
  switch (status) {
    case "built":
      return "sales.process.statusReady";
    case "empty":
      return "sales.process.statusAvailablePending";
    case "sold":
      return "sales.process.statusSold";
    case "booked":
      return "sales.process.statusBooked";
    default:
      return "sales.process.statusDelivered";
  }
}

/** A presentational context chip (label + real value) — the prototype Filter, whose
 *  mock picker modal is dropped (rule 3). Non-interactive. */
function FilterChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 12px",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        background: "var(--surface)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/** A real customer <select> from GET /customers (replaces the mock CUSTOMER_SEED). */
function CustomerSelect({
  options,
  value,
  onChange,
}: {
  options: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle()}>
      {options.length === 0 && <option value="">{DASH}</option>}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// BookingForm — WIRED (POST /sales/bookings; money=SERVER)
// ---------------------------------------------------------------------------

function BookingForm({
  unitId,
  unitCode,
  onClose,
}: {
  unitId: string;
  unitCode: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const customerQ = useSalesCustomers();
  const createBooking = useCreateSalesBooking();

  const customers = useMemo(() => (customerQ.data ?? []).map(toCustomerOption), [customerQ.data]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");

  const effectiveCustomerId = customerId || customers[0]?.id || "";
  const amountNum = parseAmount(amount);
  const glPreview = amountNum > 0 ? formatMoney(amountNum) : DASH;
  const busy = createBooking.isPending;
  const canSubmit = amountNum > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    // MONEY AUTHORITY: send ONLY the trigger fields — the server posts the JV + jv_no.
    createBooking.mutate(
      {
        unit_id: unitId,
        amount: amountNum,
        customer_id: effectiveCustomerId || undefined,
      },
      {
        onSuccess: (res) => {
          // Surface the server-returned jv_no (no success key to mint); then close.
          const jvNo = str((res as Record<string, unknown>).jv_no);
          if (jvNo) ctx.notify(jvNo, "ok");
          onClose();
        },
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* customer — REAL dropdown from GET /customers. */}
        <Field label={t("ar.fldCustomer")} required>
          <CustomerSelect options={customers} value={effectiveCustomerId} onChange={setCustomerId} />
        </Field>
        {/* unit — the selected code (readOnly); the node id is sent, never shown. */}
        <Field label={t("sales.common.unit")} required>
          <input className="num" value={unitCode} readOnly style={{ ...fieldStyle(), fontFamily: "var(--font-num)" }} />
        </Field>
        {/* dates / doc-no / owner / method — presentational (no wire; not sent). */}
        <Field label={t("sales.booking.fieldBookDate")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.booking.fieldContractDue")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.booking.fieldBookNo")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.common.owner")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        {/* amount — THE client-supplied received figure (editable, required). */}
        <Field label={t("sales.booking.fieldBookAmount")} required>
          <input
            className="num"
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            style={{ ...fieldStyle(), textAlign: "right", fontFamily: "var(--font-num)" }}
          />
        </Field>
        <Field label={t("sales.booking.fieldReceiveMethod")}>
          <input style={fieldStyle()} readOnly />
        </Field>
      </div>

      {/* GL posting PREVIEW (never sent — server is the money authority). Codes 1020 /
          2040 are verbatim literals matching the server's real posting; the entered
          amount rides both legs. Account labels reuse the closest existing COA keys. */}
      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            marginBottom: 6,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {t("fin.glAutoTitle")}
        </div>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>Dr</td>
              <td>{`${ACCT_BANK} ${t("gl.stmt.rowCash")}`}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{glPreview}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>Cr</td>
              <td>{`${ACCT_ADVANCE} ${t("gl.stmt.rowAdvance")}`}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{glPreview}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Lock note (i18n phrase with the {unit} slot). */}
      <div
        style={{
          padding: 12,
          background: "var(--ok-soft)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 11.5,
          color: "var(--ok)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name="check" size={14} />
        <span>{t("sales.booking.lockNote").replace("{unit}", unitCode)}</span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        {/* print — no print pipeline / toast key -> disabled (honest). */}
        <Btn kind="ghost" size="md" icon="print" disabled>
          {t("sales.booking.btnPrintReceipt")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("sales.booking.btnSaveReceipt")}
        </Btn>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ContractForm — WIRED (POST /sales/contracts; NO JV)
// ---------------------------------------------------------------------------

function ContractForm({
  salesUnitId,
  unitCode,
  onClose,
}: {
  salesUnitId: string;
  unitCode: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const customerQ = useSalesCustomers();
  const createContract = useCreateSalesContract();

  const customers = useMemo(() => (customerQ.data ?? []).map(toCustomerOption), [customerQ.data]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");

  const effectiveCustomerId = customerId || customers[0]?.id || "";
  const amountNum = parseAmount(amount);
  const busy = createContract.isPending;
  const canSubmit = amountNum > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    // Contract = unit metadata (NO JV): send only {sales_unit_id, amount}.
    createContract.mutate(
      { sales_unit_id: salesUnitId, amount: amountNum },
      {
        onSuccess: () => onClose(),
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* contract-no — no doc-number endpoint -> presentational. */}
        <Field label={t("sales.contract.fieldContractNo")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        {/* customer — informational (POST /sales/contracts takes no customer_id). */}
        <Field label={t("ar.fldCustomer")}>
          <CustomerSelect options={customers} value={effectiveCustomerId} onChange={setCustomerId} />
        </Field>
        <Field label={t("sales.common.unit")}>
          <input className="num" value={unitCode} readOnly style={{ ...fieldStyle(), fontFamily: "var(--font-num)" }} />
        </Field>
        {/* agreed price — THE contract amount (editable, required). */}
        <Field label={t("sales.contract.fieldAgreedPrice")} required>
          <input
            className="num"
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            style={{ ...fieldStyle(), textAlign: "right", fontFamily: "var(--font-num)" }}
          />
        </Field>
        {/* the rest — presentational (no wire column). */}
        <Field label={t("sales.contract.fieldContractDate")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.contract.fieldTransferDue")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.contract.fieldDownPlan")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.contract.fieldDownRatio")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.contract.fieldBankLoan")}>
          <input style={fieldStyle()} readOnly />
        </Field>
      </div>

      {/* The prototype price-structure split (booking/contract/down/transfer) is a
          fabricated breakdown with no wire and a missing down-instalment label key ->
          OMITTED (honest; reported). */}

      <div
        style={{
          padding: 12,
          background: "var(--info-soft)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 11.5,
          color: "var(--info)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name="info" size={14} />
        <span>{t("sales.contract.infoAutoPlan")}</span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        {/* print / attach — no endpoint -> disabled (honest). */}
        <Btn kind="ghost" size="md" icon="print" disabled>
          {t("sales.contract.btnPrintContract")}
        </Btn>
        <Btn kind="ghost" size="md" icon="paperclip" disabled>
          {t("sales.contract.btnAttachId")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("sales.contract.btnSignContract")}
        </Btn>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// QuoteForm — presentational / print-only (SA-4 honest: no /sales/quotes endpoint)
// ---------------------------------------------------------------------------

function QuoteForm({ unitCode, onClose }: { unitCode: string; onClose: () => void }) {
  const { t } = useI18n();
  const customerQ = useSalesCustomers();
  const customers = useMemo(() => (customerQ.data ?? []).map(toCustomerOption), [customerQ.data]);
  const [customerId, setCustomerId] = useState("");
  const effectiveCustomerId = customerId || customers[0]?.id || "";

  const summaryRow = (labelKey: DictKey, strong?: boolean) => (
    <>
      <span style={{ color: "var(--text-2)", fontWeight: strong ? 700 : 400 }}>{t(labelKey)}</span>
      <span className="num" style={{ textAlign: "right", fontWeight: strong ? 800 : 600, color: strong ? "var(--brand)" : "var(--text)" }}>
        {DASH}
      </span>
    </>
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* QO no / date — no QO endpoint -> presentational. */}
        <Field label={t("sales.process.thQoNo")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.common.unit")}>
          <input className="num" value={unitCode} readOnly style={{ ...fieldStyle(), fontFamily: "var(--font-num)" }} />
        </Field>
        <Field label={t("sales.process.thDate")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("ar.fldCustomer")} style={{ gridColumn: "span 2" }}>
          <CustomerSelect options={customers} value={effectiveCustomerId} onChange={setCustomerId} />
        </Field>
        <Field label={t("sales.common.owner")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.quote.fieldExpiry")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("sales.quote.fieldPromoRef")} style={{ gridColumn: "span 2" }}>
          <input style={fieldStyle()} readOnly />
        </Field>
      </div>

      {/* Price summary — presentational (no wire) -> em-dash values. */}
      <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "6px 24px", fontSize: 12.5 }}>
          {summaryRow("sales.quote.priceCatalog")}
          {summaryRow("sales.quote.priceDiscount")}
          {summaryRow("sales.quote.priceFreeTransfer")}
          {summaryRow("sales.quote.priceNet", true)}
        </div>
      </div>

      {/* Proposed payment plan — presentational (no wire). The prototype's
          down-instalment row has no key -> OMITTED (reported). */}
      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t("sales.quote.paymentPlanTitle")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
          {(["sales.quote.planBooking", "sales.quote.planContract", "sales.quote.planTransfer"] as DictKey[]).map((k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t(k)}</span>
              <span className="num">{DASH}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        {/* print / send — no QO endpoint -> disabled (honest). */}
        <Btn kind="ghost" size="md" icon="print" disabled>
          {t("sales.quote.btnPrintQo")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" disabled>
          {t("sales.quote.btnSendCustomer")}
        </Btn>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SalesProcess — the screen
// ---------------------------------------------------------------------------

/** The QO-list column header keys (honest-empty body). */
const QO_COLUMNS: DictKey[] = [
  "sales.process.thQoNo",
  "sales.common.unit",
  "sales.process.thCustomerSales",
  "sales.process.thPrice",
  "sales.process.thDiscount",
  "sales.process.thDate",
  "common.status",
];

export function SalesProcess() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const hierarchyQ = useProjectHierarchy(active?.id);
  const bookingsQ = useSalesBookings();
  const contractsQ = useSalesContracts();

  const nodes = useMemo(() => (hierarchyQ.data ?? []).map(toHierNode), [hierarchyQ.data]);
  const bookedIds = useMemo(() => unitIdSet(bookingsQ.data), [bookingsQ.data]);
  const contractIds = useMemo(() => unitIdSet(contractsQ.data), [contractsQ.data]);
  const salesUnitIds = useMemo(() => salesUnitIdByUnitId(bookingsQ.data), [bookingsQ.data]);

  const cells = useMemo(
    () => unitCells(nodes, bookedIds, contractIds),
    [nodes, bookedIds, contractIds],
  );
  const counts = useMemo(() => unitCounts(cells), [cells]);

  const [selectedId, setSelectedId] = useState<string>("");
  const effectiveSelectedId = selectedId || defaultSelectedId(cells);
  const sel = findCell(cells, effectiveSelectedId);
  const selSalesUnitId = sel ? salesUnitIds.get(sel.id) ?? "" : "";

  const loading = hierarchyQ.isLoading || bookingsQ.isLoading || contractsQ.isLoading;

  const openQuote = (unitCode: string) =>
    ctx.openModal({
      title: t("sales.quote.modalTitle"),
      subtitle: unitCode,
      icon: "paperclip",
      size: "lg",
      body: ({ close }: { close: () => void }) => <QuoteForm unitCode={unitCode} onClose={close} />,
    });

  const openBooking = (cell: UnitCell) =>
    ctx.openModal({
      title: t("sales.booking.modalTitle"),
      subtitle: cell.code,
      icon: "check",
      iconTone: "var(--ok)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <BookingForm unitId={cell.id} unitCode={cell.code} onClose={close} />
      ),
    });

  const openContract = (cell: UnitCell, salesUnitId: string) =>
    ctx.openModal({
      title: t("sales.contract.modalTitle"),
      subtitle: cell.code,
      icon: "doc",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <ContractForm salesUnitId={salesUnitId} unitCode={cell.code} onClose={close} />
      ),
    });

  // Count line — recomputed numerals (C10), composed from consume-only labels.
  const countLine = [
    `${counts.total} ${t("sales.common.unit")}`,
    `${t("sales.process.legendSold")} ${counts.sold}`,
    `${t("sales.process.legendBooked")} ${counts.booked}`,
    `${t("sales.process.legendAvailable")} ${counts.available}`,
    t("sales.process.clickToSelect"),
  ].join(" · ");

  return (
    <Page
      breadcrumbs={[t("sales.common.breadcrumbRoot"), t("sales.process.breadcrumb")]}
      title={t("sales.process.title")}
      subtitle={t("sales.process.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <FilterChip label={t("sales.common.project")} value={active?.name || DASH} />
          {/* No single active-phase wire -> em-dash value (honest). */}
          <FilterChip label={t("sales.process.filterPhase")} value={DASH} />
          <Btn
            kind="primary"
            size="md"
            icon="plus"
            onClick={() => openQuote(sel?.code || DASH)}
          >
            {t("sales.process.btnCreateQo")}
          </Btn>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
        {/* Unit grid */}
        <Card pad={20}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t("sales.process.unitPlanTitle")}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{countLine}</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-2)" }}>
              {LEGEND.map((l) => (
                <span key={l.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: l.color,
                      borderRadius: 2,
                      border: l.bordered ? "1px solid var(--border-strong)" : "none",
                    }}
                  />
                  {t(l.key)}
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ height: 320, borderRadius: "var(--r-lg)", background: "var(--surface-2)", border: "1px solid var(--border)" }} />
          ) : cells.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>{DASH}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 6 }}>
              {cells.map((u) => {
                const bg = STATUS_BG[u.status];
                const fg = u.status === "empty" || u.status === "built" ? "var(--text-3)" : "#fff";
                const isSelected = u.id === effectiveSelectedId;
                return (
                  <button
                    key={u.id}
                    onClick={() => u.selectable && setSelectedId(u.id)}
                    style={{
                      aspectRatio: "1 / 1.15",
                      background: bg,
                      color: u.status === "built" ? "var(--text)" : fg,
                      border: isSelected
                        ? "2px solid var(--brand)"
                        : u.status === "empty"
                          ? "1px solid var(--border-strong)"
                          : "none",
                      borderRadius: 5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: u.selectable ? "pointer" : "not-allowed",
                      opacity: u.selectable ? 1 : 0.85,
                      boxShadow: isSelected ? "0 0 0 3px var(--brand-soft)" : "none",
                      fontFamily: "var(--font-num)",
                    }}
                  >
                    {cellShortLabel(u.code)}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Unit detail */}
        <Card pad={0}>
          <div style={{ padding: 18, borderBottom: "1px solid var(--border)", background: "var(--brand-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="num" style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>
                  {sel?.code || DASH}
                </div>
                {/* Unit spec subtitle has no wire column -> em-dash (honest). */}
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{DASH}</div>
              </div>
              {sel && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: sel.selectable ? "var(--ok-soft)" : "var(--surface-3)",
                    color: sel.selectable ? "var(--ok)" : "var(--text-3)",
                  }}
                >
                  {t(statusLabelKey(sel.status))}
                </span>
              )}
            </div>
          </div>

          <div style={{ padding: 18 }}>
            {/* Spec grid — labels via keys; values have no wire column -> em-dash. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12, marginBottom: 14 }}>
              {([
                "sales.process.detailStartPrice",
                "sales.process.detailPricePerSqm",
                "sales.process.detailBedBath",
                "sales.process.detailParking",
                "sales.process.detailConstructStatus",
                "sales.process.detailDeliveryDue",
              ] as DictKey[]).map((k) => (
                <div key={k}>
                  <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{t(k)}</span>
                  <div>{DASH}</div>
                </div>
              ))}
            </div>

            {/* Promotions — no wire -> honest-empty. */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
              {t("sales.process.currentPromo")}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 14 }}>{DASH}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Btn
                kind="primary"
                size="md"
                icon="paperclip"
                onClick={() => openQuote(sel?.code || DASH)}
              >
                {t("sales.process.btnCreateQuoteFull")}
              </Btn>
              <Btn
                kind="ok"
                size="md"
                icon="check"
                disabled={!sel}
                onClick={() => sel && openBooking(sel)}
              >
                {t("sales.process.btnBookReceive")}
              </Btn>
              {/* Contract needs the sales_unit ROW id -> only enabled once booked. */}
              <Btn
                kind="outline"
                size="md"
                icon="doc"
                disabled={!sel || !selSalesUnitId}
                onClick={() => sel && selSalesUnitId && openContract(sel, selSalesUnitId)}
              >
                {t("sales.process.btnMakeContract")}
              </Btn>
              {/* Interested-customer history has no endpoint -> disabled; {n} em-dashed. */}
              <Btn kind="ghost" size="md" icon="user" disabled>
                {t("sales.process.btnViewInterested").replace("{n}", DASH)}
              </Btn>
            </div>
          </div>
        </Card>
      </div>

      {/* QO list — SA-4 honest-empty (no /sales/quotes endpoint). */}
      <Card pad={0} style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t("sales.process.qoListTitle")}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              {QO_COLUMNS.map((k, i) => (
                <th
                  key={k}
                  style={{
                    textAlign: i === 3 || i === 4 ? "right" : "left",
                    padding: "10px 14px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* No dedicated empty-state i18n key exists (no minting) -> honest em-dash. */}
            <tr>
              <td colSpan={QO_COLUMNS.length} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                {DASH}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
