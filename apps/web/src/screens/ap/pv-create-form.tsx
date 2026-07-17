/*
 * PVCreateForm — the "create a payment voucher" modal body, ported from
 * pototype/ap.jsx PVCreateForm (L236-315). Opened by APPaymentVoucher via
 * ctx.openModal.
 *
 * Design fidelity (Juneflow §0): the header fields (select-AP · payee), the
 * payment-method picker (cash · transfer · cheque · deposit), the conditional cheque
 * detail box, the net-payable calculation box, and the footer actions keep the
 * prototype's shape.
 *
 * Data: this is a REAL POST /ap/pv (use-ap.ts). The AP picker is the REAL billing
 * catalogue (GET /ap/billing -> billing_ids); the payee + gross + WHT + retention are
 * DERIVED from the selected billing's real wire figures (vendor_name, amount + vat,
 * wht, retention) — pv-rows.impliedWhtPct / pvNet. The server re-computes the net via
 * @juneflow/tax-engine and owns status ("pending").
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the prototype's PV-number + pay-date + accounting-period fields are DROPPED: pv
 *     has no doc-number column (ap.ts) and no create-body counterpart for the dates
 *     (server owns created_at) — jv-create-form precedent.
 *   - the payee is a DERIVED read-only display (server resolves billing -> vendor),
 *     not a free-text picker (a foreign id would fail tenant scope).
 *   - the transfer detail box (from/to account, txn ref) is DROPPED: POST /ap/pv only
 *     persists cheque_* fields, so collecting transfer fields would gather data that
 *     cannot persist (jv-create-form precedent). The cheque box maps to cheque_no /
 *     cheque_bank / cheque_date.
 *   - the net-calc box is a live CLIENT PREVIEW (pvNet) off the selected billing; the
 *     STORED net is the server's tax-engine result (system of record).
 *   - attach-receipt + print-50-bis have no endpoints -> the prototype's client-intent
 *     toasts (the export-toast stand-in).
 *
 * i18n: every string is a pv-strings.json phrase (tp) or common.cancel (t). Missing
 * keys are flagged (pv-strings.json._missing). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { toBillingRow } from "./billing-rows";
import {
  METHOD_OPTIONS,
  impliedWhtPct,
  pvNet,
  pvSubmittable,
  buildPvBody,
  formatMoney,
  type MethodKey,
  type PvDraft,
} from "./pv-rows";
import { useApBillingList, useCreateApPv } from "./use-ap";
import pvStrings from "./pv-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof pvStrings): PhraseKey => pvStrings[k] as PhraseKey;

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

/** The four payment-method option labels (pv-strings.json). */
function methodOptionLabel(tp: (k: PhraseKey) => string, key: Exclude<MethodKey, "">): string {
  switch (key) {
    case "cash":
      return tp(P("methodCash"));
    case "transfer":
      return tp(P("methodTransfer"));
    case "cheque":
      return tp(P("methodCheque"));
    case "deposit":
      return tp(P("methodDeposit"));
  }
}

export function PVCreateForm({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const billingQ = useApBillingList();
  const createPv = useCreateApPv();

  const [billingId, setBillingId] = useState("");
  const [method, setMethod] = useState<MethodKey>("cheque");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeDate, setChequeDate] = useState("");

  const billings = useMemo(() => (billingQ.data ?? []).map(toBillingRow), [billingQ.data]);
  const selected = billings.find((b) => b.id === billingId);

  // Derive the payable figures from the selected billing (all real wire data).
  const gross = selected ? selected.amount + selected.vat : 0;
  const whtPct = selected ? impliedWhtPct(selected.wht, gross) : 0;
  const retention = selected?.retention ?? 0;
  const net = pvNet(gross, whtPct, retention);

  const draft: PvDraft = {
    billingId,
    gross,
    whtPct,
    retention,
    method,
    chequeNo,
    chequeBank,
    chequeDate,
  };

  const submit = () => {
    if (!pvSubmittable(draft)) return;
    createPv.mutate(buildPvBody(draft), {
      onSuccess: () => onClose(), // list invalidates -> the new PV appears (honest).
      onError: (err) => {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || DASH, "danger");
      },
    });
  };

  const baht = tp(P("baht"));

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={tp(P("fSelectAp"))} required>
          <select value={billingId} onChange={(e) => setBillingId(e.target.value)} style={headInput}>
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {billings.map((b) => (
              <option key={b.id} value={b.id}>
                {[b.vendorName, `${formatMoney(b.amount + b.vat)} ${baht}`].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </Field>
        {/* payee: DERIVED read-only from the selected billing's vendor (server join). */}
        <Field label={tp(P("fPayee"))}>
          <input value={selected?.vendorName ?? ""} placeholder={DASH} readOnly style={{ ...headInput, background: "var(--surface-2)" }} />
        </Field>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {tp(P("methodSectionTitle"))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
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
                  {methodOptionLabel(tp, o.key)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {method === "cheque" && (
        <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{tp(P("chequeBoxTitle"))}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label={tp(P("fBank"))}>
              <input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} style={headInput} />
            </Field>
            <Field label={tp(P("fChequeNo"))}>
              <input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className="num" style={headInput} />
            </Field>
            <Field label={tp(P("fChequeDate"))}>
              <input value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} style={headInput} />
            </Field>
          </div>
        </div>
      )}

      {/* Net-payable — live CLIENT PREVIEW off the selected billing (pvNet); the
          server stores the authoritative tax-engine result. */}
      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{tp(P("netBoxTitle"))}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 18px", fontSize: 12.5 }}>
          <span style={{ color: "var(--text-2)" }}>{tp(P("netGrossLabel"))}</span>
          <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>
            {formatMoney(net.gross)} {baht}
          </span>
          <span style={{ color: "var(--text-2)" }}>{tp(P("netWhtLabel"))}</span>
          <span className="num" style={{ textAlign: "right", color: "var(--info)", fontWeight: 600 }}>
            -{formatMoney(net.wht)} {baht}
          </span>
          <span style={{ color: "var(--text-2)" }}>{tp(P("netRetentionLabel"))}</span>
          <span className="num" style={{ textAlign: "right", color: "var(--warn)", fontWeight: 600 }}>
            -{formatMoney(net.retention)} {baht}
          </span>
          <span style={{ fontWeight: 700, paddingTop: 6, borderTop: "1px solid var(--brand)", fontSize: 13 }}>
            {tp(P("netTotalLabel"))}
          </span>
          <span
            className="num"
            style={{
              textAlign: "right",
              fontWeight: 800,
              fontSize: 16,
              color: "var(--brand)",
              paddingTop: 6,
              borderTop: "1px solid var(--brand)",
            }}
          >
            {formatMoney(net.net)} {baht}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="paperclip" onClick={() => ctx.notify(tp(P("attachToast")))}>
          {tp(P("attachBtn"))}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(tp(P("printToast")))}>
          {tp(P("printBtn"))}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!pvSubmittable(draft) || createPv.isPending}
        >
          {tp(P("saveBtn"))}
        </Btn>
      </div>
    </>
  );
}
