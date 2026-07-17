/*
 * BillingForm — the "create an AP billing" modal body, ported from pototype/ap.jsx
 * BillingForm (L101-154). Opened by APBilling via ctx.openModal.
 *
 * Design fidelity (Juneflow §0): the header field grid (vendor · reference · invoice
 * · due-date), the tax/withholding box (amount before VAT · VAT · WHT), the GL
 * auto-posting preview box, and the footer actions (cancel · attach · save) keep the
 * prototype's shape.
 *
 * Data: this is a REAL POST /ap/billing (use-ap.ts). The vendor picker is the REAL
 * active-vendor catalogue (GET /vendors) and the reference picker is the REAL goods
 * receipts (GET /gr -> gr_id) — the prototype's static mock Selects are dropped (§0
 * rule 3), because a free-text id would fail the server's tenant-ownership check.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the prototype's AP-number field is DROPPED: ap_billing has no doc-number
 *     column (ap.ts), so there is nothing to show or persist (jv-create-form
 *     precedent — drop rather than fabricate). Same for the billing-date + invoice-
 *     date + type fields (no create-body counterpart; server owns created_at).
 *   - the WHT-rate dropdown is dropped: the body takes a `wht` AMOUNT (optional); when
 *     omitted the server derives the leg via @juneflow/tax-engine at its default rate.
 *     The WHT baht input maps to that optional `wht`.
 *   - the GL auto-posting preview box is PROTOTYPE-ILLUSTRATIVE: POST /ap/billing
 *     returns no GL-preview and there is no GL-preview endpoint, so the four
 *     double-entry rows keep their standard-template account labels (static copy;
 *     glAcct3 drops the mock vendor suffix) but their AMOUNTS em-dash — the actual GL
 *     entries are posted server-side and not returned here (po-list payment-schedule
 *     precedent: static labels + em-dash amounts).
 *   - attach-invoice has no endpoint -> the prototype's attach toast (client intent).
 *
 * i18n: every string is a billing-strings.json phrase (tp) or common.cancel (t).
 * Missing keys are flagged (billing-strings.json._missing). NO Thai/baht in this
 * .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { toVendorRow } from "../master/vendor-rows";
import { useGrList } from "../gr/use-gr";
import { useCreateApBilling } from "./use-ap";
import {
  emptyBillingDraft,
  billingSubmittable,
  buildBillingBody,
  type BillingDraft,
} from "./billing-rows";
import billingStrings from "./billing-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof billingStrings): PhraseKey => billingStrings[k] as PhraseKey;

/** Header field input style (jv-create-form headInput). */
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

/** Read the gr display no off an opaque /gr row (id + no only). */
function grNo(g: Record<string, unknown>): string {
  const no = g.no ?? g.id;
  return typeof no === "string" ? no : String(no ?? "");
}

export function BillingForm({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const vendorsQ = useVendorList();
  const grQ = useGrList();
  const createBilling = useCreateApBilling();

  const [draft, setDraft] = useState<BillingDraft>(emptyBillingDraft());

  // Only ACTIVE vendors are billable (ap.jsx BillingForm vendorPool filter, L102).
  const vendors = useMemo(
    () => (vendorsQ.data ?? []).map(toVendorRow).filter((v) => v.status === "active"),
    [vendorsQ.data],
  );
  const grs = useMemo(
    () => (grQ.data ?? []) as Record<string, unknown>[],
    [grQ.data],
  );
  const selectedVendor = vendors.find((v) => v.id === draft.vendorId);

  const upd = (k: keyof BillingDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    if (!billingSubmittable(draft)) return;
    createBilling.mutate(buildBillingBody(draft), {
      onSuccess: () => onClose(), // list invalidates -> the new billing appears (honest).
      onError: (err) => {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || DASH, "danger");
      },
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field
          label={tp(P("fVendor"))}
          required
          style={{ gridColumn: "span 2" }}
          hint={
            selectedVendor && selectedVendor.taxId
              ? `${tp(P("vendorTaxPrefix"))} ${selectedVendor.taxId}`
              : undefined
          }
        >
          <select
            value={draft.vendorId}
            onChange={(e) => upd("vendorId", e.target.value)}
            style={headInput}
          >
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.code, v.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("fRef"))}>
          {/* Optional gr_id ref — the real goods-receipts (GET /gr). */}
          <select value={draft.grId} onChange={(e) => upd("grId", e.target.value)} style={headInput}>
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {grs.map((g) => (
              <option key={String(g.id)} value={String(g.id)}>
                {grNo(g)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("fInvoice"))}>
          <input
            value={draft.invoiceNo}
            onChange={(e) => upd("invoiceNo", e.target.value)}
            className="num"
            style={headInput}
          />
        </Field>
        <Field label={tp(P("fDue"))}>
          <input value={draft.dueDate} onChange={(e) => upd("dueDate", e.target.value)} style={headInput} />
        </Field>
      </div>

      <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{tp(P("taxBoxTitle"))}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label={tp(P("fAmount"))} required>
            <input
              type="number"
              value={draft.amount}
              onChange={(e) => upd("amount", e.target.value)}
              className="num"
              style={headInput}
            />
          </Field>
          <Field label={tp(P("fVat"))}>
            <input
              type="number"
              value={draft.vat}
              onChange={(e) => upd("vat", e.target.value)}
              className="num"
              style={headInput}
            />
          </Field>
          <Field label={tp(P("fWht"))}>
            <input
              type="number"
              value={draft.wht}
              onChange={(e) => upd("wht", e.target.value)}
              className="num"
              style={headInput}
            />
          </Field>
        </div>
      </div>

      {/* GL auto-posting preview — PROTOTYPE-ILLUSTRATIVE (see header): standard AP
          double-entry template labels + em-dash amounts (no GL-preview wire). */}
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
          {tp(P("glBoxTitle"))}
        </div>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            {[
              { side: "Dr", acct: tp(P("glAcct1")) },
              { side: "Dr", acct: tp(P("glAcct2")) },
              { side: "Cr", acct: tp(P("glAcct3")) },
              { side: "Cr", acct: tp(P("glAcct4")) },
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "4px 0", color: "var(--text-2)" }}>{r.side}</td>
                <td>{r.acct}</td>
                <td className="num" style={{ textAlign: "right", color: "var(--text-3)" }}>
                  {DASH}
                </td>
                <td className="num" style={{ textAlign: "right", color: "var(--text-3)" }}>
                  {DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="paperclip" onClick={() => ctx.notify(tp(P("attachToast")))}>
          {tp(P("attachBtn"))}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!billingSubmittable(draft) || createBilling.isPending}
        >
          {tp(P("saveBtn"))}
        </Btn>
      </div>
    </>
  );
}
