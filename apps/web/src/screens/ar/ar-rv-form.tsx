/*
 * RVCreateForm — the "create a receive voucher" modal body, ported from
 * pototype/ar.jsx RVCreateForm (L300-336). Opened by ARReceiveVoucher via
 * ctx.openModal.
 *
 * Design fidelity (Juneflow §0): the invoice-to-settle picker, the payment-method
 * picker, and the footer actions (cancel · print receipt · save) keep the
 * prototype's shape.
 *
 * Data: this is a REAL POST /ar/rv (use-ar-rv.ts) — the B-121 frozen SINGLE-invoice
 * contract { invoice_id, amount, method? }. The picker is the tenant's unpaid
 * invoices (GET /ar/invoices, each carrying the server-computed `outstanding`);
 * `amount` is the real cash RECEIVED (a legitimate client value, NOT a client
 * total). The server validates amount <= outstanding and REJECTS an over-payment
 * with a 409 (never clamped) — the form shows the outstanding as a preview and
 * flags an over-allocation informationally, but never clamps/blocks the submit: the
 * 409 is surfaced honestly (error toast). On success the server flips the invoice to
 * `paid` when Σ rv >= amount + vat and the rv rides the GL posting inbox — no
 * client-side JV is posted.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the prototype's RV-number + receipt-date + accounting-period + receiving-
 *     account fields are DROPPED: the POST body has no counterpart for them (the
 *     server owns `no`/created_at/currency, and there is no bank-account write) —
 *     collecting them would gather data that cannot persist (jv-create-form /
 *     pv-create-form drop-not-collect precedent).
 *   - the prototype's separate payer/customer picker is DROPPED: the real receipt
 *     keys off a single invoice_id, and the invoice implies its customer (the
 *     invoice wire carries only a customer_id UUID, no resolvable payer name).
 *   - an `amount` input is ADDED (the prototype implied the full invoice amount):
 *     the real contract needs the cash actually received, which the client legitimately
 *     supplies (B-121). Its label reuses ar.rv.thNet (the "net received" label).
 *   - the prototype's auto-GL box (Dr/Cr) is DROPPED: posting a JV client-side is
 *     forbidden (B-121) — the rv rides the server posting inbox (source 'rv:').
 *   - print-receipt has no endpoint -> the prototype's client-intent toast.
 *
 * i18n: every string resolves via t() from the DICT (i18n-full.json) — the ar.rv.*
 * keys plus reused keys (fin.method*, gr.create.balanceRemaining for the outstanding
 * preview, subcon.unitBaht for the baht glyph, common.cancel). Tokens back every
 * colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import {
  METHOD_OPTIONS,
  buildRvBody,
  formatMoney,
  isOverAllocated,
  rvSubmittable,
  toInvoiceOption,
  unpaidInvoices,
  type MethodKey,
  type RvDraft,
} from "./ar-rv-rows";
import { useArInvoiceList, useCreateArRv } from "./use-ar-rv";

const DASH = "—";

/** Header field input style (jv-create-form / pv-create-form headInput). */
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

/** Extract an error message off an unknown mutation error (pv-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export function RVCreateForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const invoiceQ = useArInvoiceList();
  const createRv = useCreateArRv();

  const [invoiceId, setInvoiceId] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<MethodKey>("transfer");

  const options = useMemo(
    () => unpaidInvoices((invoiceQ.data ?? []).map(toInvoiceOption)),
    [invoiceQ.data],
  );
  const selected = options.find((o) => o.id === invoiceId);
  const outstanding = selected?.outstanding ?? 0;

  const amount = Number.parseFloat(amountRaw);
  const amountNum = Number.isFinite(amount) ? amount : 0;
  const overAllocated = selected != null && isOverAllocated(amountNum, outstanding);

  const draft: RvDraft = { invoiceId, amount: amountNum, method };
  const baht = t("subcon.unitBaht");

  /** The three method-picker option labels (DICT fin.method*). */
  const methodLabel = (key: Exclude<MethodKey, "">): string => {
    switch (key) {
      case "transfer":
        return t("fin.methodTransfer");
      case "cheque":
        return t("fin.methodCheque");
      case "cash":
        return t("fin.methodCash");
    }
  };

  const submit = () => {
    if (!rvSubmittable(draft)) return;
    // No client-side clamp/block on over-allocation (B-121): the server validates
    // the amount against the outstanding and answers a 409, surfaced honestly here.
    createRv.mutate(buildRvBody(draft), {
      onSuccess: () => onClose(), // both lists invalidate -> the rv appears + the invoice paid-flip.
      onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Invoice-to-settle picker: the tenant's unpaid invoices (real outstanding). */}
        <Field label={t("ar.rv.fldInvoiceRef")} required>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} style={headInput}>
            <option value="">{DASH}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {[o.no, `${formatMoney(o.outstanding)} ${baht}`].join(" · ")}
              </option>
            ))}
          </select>
        </Field>
        {/* Amount received — the real cash the client supplies (B-121). */}
        <Field label={t("ar.rv.thNet")} required>
          <input
            type="number"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            className="num"
            style={{ ...headInput, fontFamily: "var(--font-num)" }}
          />
        </Field>
      </div>

      {/* Outstanding preview (real): the selected invoice's remaining balance. An
          over-allocation is flagged in danger tone, but the submit stays enabled —
          the server is the authority and answers a 409 honestly (no client clamp). */}
      {selected && (
        <div
          style={{
            padding: 14,
            background: overAllocated ? "var(--danger-soft)" : "var(--brand-soft)",
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 12.5,
            fontWeight: 600,
            color: overAllocated ? "var(--danger)" : "var(--text-2)",
          }}
          className="num"
        >
          {t("gr.create.balanceRemaining").replace(
            "{balance}",
            `${formatMoney(outstanding)} ${baht}`,
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {t("ar.rv.fldMethod")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {METHOD_OPTIONS.map((o) => {
            const on = method === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setMethod(o.key)}
                style={{
                  padding: "10px 8px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: on ? "var(--brand-soft)" : "var(--surface)",
                  border: `1.5px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "inherit",
                }}
              >
                <Icon name={o.icon as IconName} size={18} color={on ? "var(--brand)" : "var(--text-3)"} />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: on ? 700 : 500,
                    color: on ? "var(--brand)" : "var(--text-2)",
                  }}
                >
                  {methodLabel(o.key)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("ar.rv.toastPrint"))}>
          {t("ar.rv.btnPrint")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!rvSubmittable(draft) || createRv.isPending}
        >
          {t("ar.rv.btnSubmit")}
        </Btn>
      </div>
    </>
  );
}
