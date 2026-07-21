/*
 * ARCNForm — the "create a credit note" modal body, ported from pototype/accounting-extra2.jsx
 * ARCNForm (L182-223). Opened by ARCreditNote via ctx.openModal.
 *
 * Design fidelity (Juneflow §0): the field stack (customer · invoice-ref + amount · reason), the
 * live VAT-split preview box, and the footer actions (cancel · create) keep the prototype's shape.
 *
 * Data: this is a REAL POST /ar/cn (use-ar-cn.ts). The prototype's static Selects are dropped
 * (§0 rule 3, billing-form precedent):
 *   - the customer picker is the REAL customer catalogue (GET /customers -> customer_id); the
 *     prototype's static name list + its free-text "other" option (ar.cn.optCustomerOther, unused)
 *     are dropped — a free-text customer would fail the server's tenant-ownership check.
 *   - the invoice reference is the REAL AR invoices (GET /ar/invoices -> ref_invoice_id). The
 *     prototype left it an OPTIONAL free-text input, but POST /ar/cn REJECTS a missing ref_invoice_id
 *     (ar.ts createCn 400) -> the ported picker is REQUIRED (red border on a submit attempt).
 *
 * MONEY (B-121 · SERVER authority): `amount` is the VAT-INCLUSIVE gross the user types; the split
 * box is a CLIENT PREVIEW only (preVatBase / vatPreview — ar-cn-rows.ts). The server derives + posts
 * the authoritative VAT on approve; nothing here posts a JV.
 *
 * `no`: ar_credit_note.no is NOT NULL and there is NO server allocator, so the client generates a
 * unique CN number (like the prototype's client-side generation, accounting-extra2.jsx L193). A
 * duplicate is a server 409 surfaced honestly via onError.
 *
 * i18n: every string resolves via t() from the DICT (ar.cn.* Wave-B + common.cancel). NO Thai/baht
 * in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import {
  buildCreateCnBody,
  cnFormValid,
  formatMoney,
  parseAmount,
  preVatBase,
  vatPreview,
  type CnDraft,
} from "./ar-cn-rows";
import { useArInvoicesList, useCreateArCn, useCustomersList } from "./use-ar-cn";

const DASH = "—";

/** The six reason options (ar.cn.reason* dict keys), in the prototype's order (ARCN_REASONS). */
const REASON_KEYS = [
  "ar.cn.reasonDiscount",
  "ar.cn.reasonCancelBooking",
  "ar.cn.reasonVariationOrder",
  "ar.cn.reasonTransferDiscount",
  "ar.cn.reasonDefect",
  "ar.cn.reasonOther",
] as const;

/** Field input style, ported 1:1 from the prototype's `fld` (accounting-extra2.jsx L188). */
function fld(bad: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: `1px solid ${bad ? "var(--danger)" : "var(--border)"}`,
    borderRadius: 8,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
    color: "var(--text)",
  };
}

/** Read a display field off an opaque picker row. */
function pick(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Client-generated CN number — ar_credit_note.no is NOT NULL with no server allocator (ar.ts). The
 * year prefix + a millisecond suffix keeps it unique in practice; a genuine collision is a server
 * 409 surfaced honestly.
 */
function newCnNo(): string {
  const year = new Date().getUTCFullYear();
  return `CN-${year}-${Date.now().toString().slice(-6)}`;
}

export function ARCNForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const customersQ = useCustomersList();
  const invoicesQ = useArInvoicesList();
  const createCn = useCreateArCn();

  const [draft, setDraft] = useState<CnDraft>({
    customerId: "",
    refInvoiceId: "",
    reason: t("ar.cn.reasonDiscount"),
    amount: "",
  });
  const [err, setErr] = useState<{ customer?: boolean; ref?: boolean; amount?: boolean }>({});

  const customers = useMemo(
    () => (customersQ.data ?? []) as Record<string, unknown>[],
    [customersQ.data],
  );
  const invoices = useMemo(
    () => (invoicesQ.data ?? []) as Record<string, unknown>[],
    [invoicesQ.data],
  );

  const upd = (k: keyof CnDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const amountValue = parseAmount(draft.amount);

  const save = () => {
    const e: { customer?: boolean; ref?: boolean; amount?: boolean } = {};
    if (!draft.customerId) e.customer = true;
    if (!draft.refInvoiceId) e.ref = true;
    if (amountValue <= 0) e.amount = true;
    setErr(e);
    if (!cnFormValid(draft)) return;

    createCn.mutate(buildCreateCnBody(newCnNo(), draft), {
      onSuccess: (created) => {
        onClose();
        const row = (created ?? {}) as Record<string, unknown>;
        ctx.notify(
          t("ar.cn.toastCreated")
            .replace("{docNo}", pick(row, "no"))
            .replace("{amount}", formatMoney(Number(row.amount ?? amountValue))),
        );
      },
      onError: (error) => {
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || DASH, "danger");
      },
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gap: 12, marginBottom: 4 }}>
        <Field label={t("ar.fldCustomer")} required>
          <select
            value={draft.customerId}
            onChange={(ev) => upd("customerId", ev.target.value)}
            style={fld(Boolean(err.customer))}
          >
            <option value="">{t("ar.cn.phCustomer")}</option>
            {customers.map((c) => (
              <option key={pick(c, "id")} value={pick(c, "id")}>
                {pick(c, "name")}
              </option>
            ))}
          </select>
          {err.customer && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
              {t("ar.cn.errCustomer")}
            </div>
          )}
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("ar.cn.thRef")} required>
            {/* Real AR invoices (GET /ar/invoices) — required (server rejects a missing ref). */}
            <select
              value={draft.refInvoiceId}
              onChange={(ev) => upd("refInvoiceId", ev.target.value)}
              className="num"
              style={fld(Boolean(err.ref))}
            >
              <option value="">{t("ar.cn.phInvoiceRef")}</option>
              {invoices.map((inv) => (
                <option key={pick(inv, "id")} value={pick(inv, "id")}>
                  {pick(inv, "no")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ar.cn.fldAmount")} required>
            <input
              value={draft.amount}
              onChange={(ev) => upd("amount", ev.target.value.replace(/[^\d]/g, ""))}
              className="num"
              style={fld(Boolean(err.amount))}
            />
          </Field>
        </div>

        <Field label={t("ar.cn.fldReason")}>
          <select
            value={draft.reason}
            onChange={(ev) => upd("reason", ev.target.value)}
            style={fld(false)}
          >
            {REASON_KEYS.map((k) => (
              <option key={k} value={t(k)}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>

        {amountValue > 0 && (
          <div
            style={{
              padding: "9px 12px",
              background: "var(--surface-2)",
              borderRadius: 8,
              fontSize: 11.5,
              color: "var(--text-2)",
            }}
          >
            {t("ar.cn.calcLine")
              .replace("{amount}", formatMoney(preVatBase(amountValue)))
              .replace("{vat}", formatMoney(vatPreview(amountValue)))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={save}
          disabled={createCn.isPending}
        >
          {t("ar.cn.btnNew")}
        </Btn>
      </div>
    </div>
  );
}
