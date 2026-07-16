/*
 * POCreateForm — the "create PO" modal body, opened by POList via ctx.openModal
 * (size "lg"). Focused real port of pototype/forms.jsx POCreateForm (L140-257):
 * the mock's VAT/WHT math, vendor-compare + attach helpers, and hardcoded line
 * summary are dropped (§0 rule 3) — the create path is wired to the real contract.
 *
 * Design fidelity (rule 1): the approved-PR radio picker (each row = pr no + total),
 * the vendor select, the 2-column meta field grid, and the cancel/submit footer are
 * the prototype's. Every string is a po.form* / po.list* / common.* dict key (t) or
 * a po-wo-strings.json phrase (tp) — no Thai literal in source (rule 2).
 *
 * Data (rule 3): the PR options come from GET /pr (approvedPrs — only approved PRs
 * may raise a PO, POST /po 409s otherwise); the vendor options from GET /vendors.
 * "create + send-for-approval" runs the real two-step the prototype implied: POST /po (draft,
 * server seeds the total from the source PR's priced lines) then POST /po/{id}/submit
 * (draft -> pending). On success the PO list is invalidated + the screen navigates to
 * po.list.
 *
 * WIRE GAPS (reported honestly): POST /po's body is only { pr_id, vendor_id }
 * (credit_term / vat optional). The prototype's delivery date / payment terms /
 * down-payment% / VAT-WHT inputs have no create-body counterpart that this focused
 * port sends (deposit is not persisted at all — po.ts GAP 2), so they are shown for
 * fidelity but do NOT persist (flagged). The PO amount is derived server-side from
 * the source PR — never entered here.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { usePrList, useCreatePo, useSubmitPo } from "./use-po-wo";
import { toPrRef, toVendorRef, approvedPrs, vendorNameById, formatMoney } from "./po-wo-rows";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
/** THAI BAHT SIGN (U+0E3F) via unicode escape (i18n-guard-safe, master/user-add-form.tsx). */
const BAHT = "\u0E3F";

/** Input style, mirrored from gr-create-form fieldStyle. */
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

export interface POCreateFormProps {
  onClose: () => void;
}

export function POCreateForm({ onClose }: POCreateFormProps) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const prQ = usePrList();
  const vendorQ = useVendorList();
  const createPo = useCreatePo();
  const submitPo = useSubmitPo();

  const prOpts = useMemo(() => approvedPrs((prQ.data ?? []).map(toPrRef)), [prQ.data]);
  const vendors = useMemo(() => (vendorQ.data ?? []).map(toVendorRef), [vendorQ.data]);
  const vendorNames = useMemo(() => vendorNameById(vendors), [vendors]);

  const [prId, setPrId] = useState("");
  const [vendorId, setVendorId] = useState("");

  const effectivePrId = prId || prOpts[0]?.id || "";
  const effectiveVendorId = vendorId || vendors[0]?.id || "";
  const selectedPr = prOpts.find((p) => p.id === effectivePrId);

  const busy = createPo.isPending || submitPo.isPending;
  const canSubmit = !!effectivePrId && !!effectiveVendorId && !busy;

  const submit = () => {
    if (!effectivePrId || !effectiveVendorId) return;
    createPo.mutate(
      { pr_id: effectivePrId, vendor_id: effectiveVendorId },
      {
        onSuccess: (created) => {
          const c = created as Record<string, unknown>;
          const id = typeof c.id === "string" ? c.id : "";
          const done = () => {
            onClose();
            ctx.notify(t("po.form.createdToast"));
            ctx.navigate("po.list");
          };
          if (id) submitPo.mutate(id, { onSuccess: done, onError: done });
          else done();
        },
      },
    );
  };

  return (
    <>
      {/* Pick an approved PR (real, approvedPrs) */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {t("po.list.colRefPr")}
        </div>
        {prOpts.length === 0 ? (
          <div
            style={{
              padding: "18px 14px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-3)",
              background: "var(--surface-2)",
              borderRadius: 8,
            }}
          >
            <Icon name="info" size={22} color="var(--text-3)" style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 6 }}>{t("common.all")}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {prOpts.map((p) => {
              const on = p.id === effectivePrId;
              return (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 12,
                    borderRadius: 8,
                    cursor: "pointer",
                    background: on ? "var(--brand-soft)" : "var(--surface-2)",
                    border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  }}
                >
                  <input
                    type="radio"
                    name="pr"
                    checked={on}
                    onChange={() => setPrId(p.id)}
                    style={{ accentColor: "var(--brand)" }}
                  />
                  <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>
                    <span className="num" style={{ color: "var(--brand)" }}>{p.no}</span>
                  </div>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
                    {formatMoney(p.amount)} {BAHT}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Meta grid — vendor is real; the rest are presentational (flagged) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <Field label={tp(P("vendorField"))} required>
          <select
            value={effectiveVendorId}
            onChange={(e) => setVendorId(e.target.value)}
            style={fieldStyle()}
          >
            {vendors.length === 0 && <option value="">{t("common.all")}</option>}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {vendorNames.get(v.id)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("po.form.deliveryDate")} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("po.form.paymentTerms")}>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("po.form.downPmt")}>
          <input className="num" style={fieldStyle()} />
        </Field>
        <Field label={t("po.form.vatWht")} style={{ gridColumn: "span 2" }}>
          <input style={fieldStyle()} />
        </Field>
      </div>

      {/* Items note — the amount is derived server-side from the source PR */}
      {selectedPr && (
        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 10, marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "var(--text-2)",
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="link" size={13} />
            {t("po.form.itemsTitle")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("po.form.itemsNote")}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("common.submit")}
        </Btn>
      </div>
    </>
  );
}
