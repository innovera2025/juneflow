/*
 * ARInvoiceForm — the "create invoice / interim billing" modal body, opened by
 * ARInvoice via ctx.openModal (size "lg"). Focused real port of pototype/ar.jsx
 * ARInvoiceForm (L110-147).
 *
 * Design fidelity (§0 rule 1): the 3-column meta field grid (invoice-no · date · due ·
 * customer(span 2) · unit/project · bill-type · ref-phase · bill-method), the brand-soft
 * summary panel, and the cancel / print / submit footer are the prototype's. Every
 * string is an ar.invoice.* / ar.fldCustomer / common.* / subcon.* / boq.* dict key (t)
 * — no Thai literal in source (§0 rule 2, B-073).
 *
 * Data (§0 rule 3): the customer options come from GET /customers (real). Submit runs
 * POST /ar/invoices. MONEY AUTHORITY (B-107a · Wei C-176): the server computes amount =
 * Σ(line.qty × price) + vat (7%); the client sends ONLY the line items and never a
 * client total — the brand-soft panel is a LIVE PREVIEW (previewSubtotal/Vat/Total),
 * explicitly non-authoritative. etax_status defaults 'queued' server-side.
 *
 * FORCED DIVERGENCE (reported): POST /ar/invoices REQUIRES a non-empty lines[] but the
 * prototype form has NO line editor (its submit was a pure mock toast). This port ADDS a
 * minimal line-items editor (description · qty · unit price → line total) so the create
 * call can succeed — the wire forces it, exactly like wo-create-form added a PR picker.
 * WIRE GAPS: `no` has no AR doc-number endpoint → it is an editable required input (the
 * prototype's readOnly mock number is dropped); the date / due / unit-project / ref-phase
 * fields have no wire column → presentational (shown for fidelity, not persisted); the
 * customer tax-id line's {project} slot has no customer.project column → em-dash. The
 * prototype's auto-GL Dr/Cr panel is RESTORED (orch-B gate C-195) as a presentational
 * live preview (fin.glAutoTitle + gl.stmt.rowAr/rowHouseSales + the real selected
 * customer + the previewTotal figure on both legs) — it is NEVER sent; money stays
 * server-authoritative (the server posts the real balanced entry with the VAT split).
 * No create-success toast key exists → the modal closes and the invalidated list
 * surfaces the new invoice (honest).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useCustomerList, useCreateArInvoice, type CreateArInvoiceBody } from "./use-ar-invoice";
import {
  toCustomerRef,
  customerById,
  parseAmount,
  lineTotal,
  previewSubtotal,
  previewVat,
  previewTotal,
  toWireLines,
  formatMoney,
  isLineComplete,
  type LineDraft,
} from "./ar-invoice-rows";

const DASH = "—";

/** Input / select style, mirrored from wo-create-form fieldStyle. */
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

/** Extract an error message off an unknown mutation error (gl-inbox precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export interface ARInvoiceFormProps {
  onClose: () => void;
}

export function ARInvoiceForm({ onClose }: ARInvoiceFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const customerQ = useCustomerList();
  const createInvoice = useCreateArInvoice();

  const customers = useMemo(() => (customerQ.data ?? []).map(toCustomerRef), [customerQ.data]);
  const customerMap = useMemo(() => customerById(customers), [customers]);

  const [no, setNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [drafts, setDrafts] = useState<LineDraft[]>([{ description: "", qty: "", price: "" }]);

  const effectiveCustomerId = customerId || customers[0]?.id || "";
  const selectedCustomer = customerMap.get(effectiveCustomerId);

  const subtotal = previewSubtotal(drafts);
  const vat = previewVat(subtotal);
  const total = previewTotal(subtotal);
  // Auto-GL preview leg figure — mirrors the prototype's equal 2-line presentation;
  // "—" until there are line drafts (honest), never sent (server is money authority).
  const glPreview = total > 0 ? formatMoney(total) : DASH;

  const wireLines = toWireLines(drafts);
  const busy = createInvoice.isPending;
  const canSubmit = !!effectiveCustomerId && no.trim() !== "" && wireLines.length > 0 && !busy;

  const addLine = () => setDrafts((prev) => [...prev, { description: "", qty: "", price: "" }]);
  const removeLine = (index: number) =>
    setDrafts((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const updateLine = (index: number, field: keyof LineDraft, value: string) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));

  const submit = () => {
    if (!canSubmit) return;
    // MONEY AUTHORITY: send ONLY the line items; the server computes amount/vat.
    const body: CreateArInvoiceBody = {
      customer_id: effectiveCustomerId,
      no: no.trim(),
      lines: wireLines,
    };
    createInvoice.mutate(body, {
      // No create-success toast key exists (no minting) — close + list invalidation
      // surfaces the new invoice honestly.
      onSuccess: () => onClose(),
      onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
    });
  };

  return (
    <>
      {/* Meta grid — customer + invoice-no are wired; the rest are presentational (no wire). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* invoice no — editable (no AR doc-number endpoint), required + mono. */}
        <Field label={t("ar.invoice.fldNo")} required>
          <input
            className="num"
            value={no}
            onChange={(e) => setNo(e.target.value)}
            style={{ ...fieldStyle(), fontFamily: "var(--font-num)" }}
          />
        </Field>
        {/* date / due — presentational (no wire column). */}
        <Field label={t("subcon.colDate")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("ar.invoice.thDue")}>
          <input style={fieldStyle()} readOnly />
        </Field>

        {/* customer — REAL dropdown from GET /customers (span 2). */}
        <Field label={t("ar.fldCustomer")} required style={{ gridColumn: "span 2" }}>
          <select
            value={effectiveCustomerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={fieldStyle()}
          >
            {customers.length === 0 && <option value="">{DASH}</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCustomer && (
            <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }} className="num">
              {/* tax-id real; {project} has no customer column -> em-dash. */}
              {t("ar.invoice.taxIdLine")
                .replace("{taxId}", selectedCustomer.taxId || DASH)
                .replace("{project}", DASH)}
            </div>
          )}
        </Field>
        {/* unit/project — presentational (no wire column). */}
        <Field label={t("ar.invoice.fldUnitProject")}>
          <input style={fieldStyle()} readOnly />
        </Field>

        {/* bill type / ref phase / bill method — presentational (not persisted). */}
        <Field label={t("ar.invoice.fldBillType")}>
          <select style={fieldStyle()}>
            <option>{t("ar.invoice.optBillTypeInstallment")}</option>
          </select>
        </Field>
        <Field label={t("ar.invoice.fldRefPhase")}>
          <input style={fieldStyle()} readOnly />
        </Field>
        <Field label={t("ar.invoice.fldBillMethod")}>
          <select style={fieldStyle()}>
            <option>{t("ar.invoice.optBillMethodTransferTax")}</option>
          </select>
        </Field>
      </div>

      {/* Line items editor (FORCED DIVERGENCE — required by POST /ar/invoices lines[]). */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {t("accept.unitItems")}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th scope="col" style={{ textAlign: "start", padding: "0 8px 6px 0", fontSize: 10.5, fontWeight: 600 }}>
                {t("subcon.colDetail")}
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0 8px 6px", fontSize: 10.5, fontWeight: 600, width: 90 }}>
                {t("boq.edFldQty")}
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0 8px 6px", fontSize: 10.5, fontWeight: 600, width: 130 }}>
                {t("boq.edFldPriceUnit")}
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "0 0 6px 8px", fontSize: 10.5, fontWeight: 600, width: 120 }}>
                {t("subcon.colValue")}
              </th>
              <th scope="col" style={{ width: 34 }} />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => (
              <tr key={i}>
                <td style={{ padding: "3px 8px 3px 0" }}>
                  <input
                    value={d.description}
                    onChange={(e) => updateLine(i, "description", e.target.value)}
                    style={fieldStyle()}
                  />
                </td>
                <td style={{ padding: "3px 8px" }}>
                  <input
                    className="num"
                    value={d.qty}
                    inputMode="numeric"
                    onChange={(e) => updateLine(i, "qty", e.target.value)}
                    style={{ ...fieldStyle(), textAlign: "right", fontFamily: "var(--font-num)" }}
                  />
                </td>
                <td style={{ padding: "3px 8px" }}>
                  <input
                    className="num"
                    value={d.price}
                    inputMode="numeric"
                    onChange={(e) => updateLine(i, "price", e.target.value)}
                    style={{ ...fieldStyle(), textAlign: "right", fontFamily: "var(--font-num)" }}
                  />
                </td>
                <td
                  className="num"
                  style={{ padding: "3px 0 3px 8px", textAlign: "right", fontWeight: 700, color: "var(--text-2)" }}
                >
                  {isLineComplete(d) ? formatMoney(lineTotal(parseAmount(d.qty), parseAmount(d.price))) : DASH}
                </td>
                <td style={{ padding: "3px 0", textAlign: "center" }}>
                  <button
                    type="button"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    onClick={() => removeLine(i)}
                    disabled={drafts.length <= 1}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: drafts.length <= 1 ? "default" : "pointer",
                      color: "var(--text-3)",
                      opacity: drafts.length <= 1 ? 0.4 : 1,
                      padding: 4,
                      display: "inline-flex",
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <Btn kind="ghost" size="sm" icon="plus" onClick={addLine}>
            {t("boq.aiqAddRow")}
          </Btn>
        </div>
      </div>

      {/* Live preview summary (UX only — the server is the money authority). */}
      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>{t("subcon.colValue")}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(subtotal)}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>{t("ar.invoice.thVat")}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(vat)}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text)", fontWeight: 700 }}>{t("common.total")}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand)" }}>
                {formatMoney(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Auto-GL posting preview (RESTORED — orch-B gate C-195). Presentational LIVE
          preview only: the same previewTotal figure on both legs mirrors the prototype's
          simplified equal-2-line presentation; it is NEVER sent — the server posts the
          real balanced journal entry (with the VAT split). Account codes 1201 / 4101 are
          verbatim COA literals; Dr / Cr are verbatim labels. */}
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
              <td>{`1201 ${t("gl.stmt.rowAr")} · ${selectedCustomer ? selectedCustomer.name : DASH}`}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>
                {glPreview}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>Cr</td>
              <td>{`4101 ${t("gl.stmt.rowHouseSales")}`}</td>
              <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>
                {glPreview}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("ar.invoice.toastPrint"))}>
          {t("ar.invoice.btnPrint")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("ar.invoice.btnSubmit")}
        </Btn>
      </div>
    </>
  );
}
