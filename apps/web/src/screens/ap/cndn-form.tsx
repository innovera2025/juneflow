/*
 * CNDNForm — the "create a credit / debit note" modal body, ported from pototype/ap.jsx CNDNForm
 * (L486-518). Opened by APCreditDebit via ctx.openModal for either kind ("CN" | "DN").
 *
 * Design fidelity (Juneflow §0): the field stack (vendor · referenced AP · amount · reason), the
 * kind-tinted GL-posting info box, and the footer actions (cancel · save) keep the prototype's shape.
 * The amount label, reason placeholder, info-box copy/colour, and the save button's kind/label all
 * switch on `kind` exactly as the prototype's `isCN` ternaries do.
 *
 * Data: this is a REAL POST /ap/cn | /ap/dn (use-ap-cndn.ts). The prototype's static Selects are
 * dropped (§0 rule 3, billing-form precedent):
 *   - the vendor picker is the REAL active-vendor catalogue (GET /vendors -> vendor_id); a free-text
 *     vendor would fail the server's tenant-ownership check (400).
 *   - the referenced-AP picker is the REAL ap_billing register (GET /ap/billing -> ref_ap_id); the
 *     prototype's free-text `apRef` input is replaced by this picker (server 404s a foreign id).
 *
 * DROPPED FIELDS (honest, never fabricated — billing-form precedent): the prototype's read-only
 * note-number and date fields are dropped — the SERVER allocates the note `no` (CN-/DN-<year>-<NNNN>)
 * and owns created_at, so there is nothing real to show pre-submit and the prototype's "CN-2026-00xx"
 * / its mock date are mock literals (rule 3). The new row (with its real server number) appears in the
 * register on list-invalidate.
 *
 * MONEY (B-231 · money=SERVER): the body carries ONLY { vendor_id, ref_ap_id, amount, reason }
 * (buildCreateNoteBody). The server owns the note number, the status, and — only on approve — the
 * balanced Model-A JV; nothing here posts a JV or computes a balance. On success the modal closes and
 * the list invalidates (billing-form precedent — no fabricated toast); a server 4xx is surfaced
 * honestly via ctx.notify.
 *
 * i18n: every string is an ap-cn-dn-strings.json phrase (tp) or the shared common.cancel DICT key
 * (t). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { toVendorRow } from "../master/vendor-rows";
import { useApBillingList } from "./use-ap";
import { useCreateApCn, useCreateApDn } from "./use-ap-cndn";
import {
  apBillingLabel,
  buildCreateNoteBody,
  emptyNoteDraft,
  noteFormValid,
  parseAmount,
  toApBillingPick,
  type NoteDraft,
  type NoteKind,
} from "./ap-cn-dn-rows";
import strings from "./ap-cn-dn-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/** Field input style (ar-cn-form fld / billing-form headInput). */
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

/** Extract an error message off an unknown mutation error (billing-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export function CNDNForm({ kind, onClose }: { kind: NoteKind; onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const isCN = kind === "CN";

  const vendorsQ = useVendorList();
  const billingQ = useApBillingList();
  const createCn = useCreateApCn();
  const createDn = useCreateApDn();
  const create = isCN ? createCn : createDn;

  const [draft, setDraft] = useState<NoteDraft>(emptyNoteDraft());
  const [err, setErr] = useState<{ vendor?: boolean; ref?: boolean; amount?: boolean; reason?: boolean }>({});

  // Only ACTIVE vendors are billable (ap.jsx CNDNForm vendorPool filter, L487).
  const vendors = useMemo(
    () => (vendorsQ.data ?? []).map(toVendorRow).filter((v) => v.status === "active"),
    [vendorsQ.data],
  );
  const billings = useMemo(
    () => (billingQ.data ?? []).map((e) => toApBillingPick(e as Record<string, unknown>)),
    [billingQ.data],
  );
  const selectedVendor = vendors.find((v) => v.id === draft.vendorId);

  const upd = (k: keyof NoteDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    const e = {
      vendor: draft.vendorId === "",
      ref: draft.refApId === "",
      amount: parseAmount(draft.amount) <= 0,
      reason: draft.reason.trim() === "",
    };
    setErr(e);
    if (!noteFormValid(draft)) return;

    create.mutate(buildCreateNoteBody(draft), {
      // list invalidates -> the new note (with its real server number) appears (honest, no toast).
      onSuccess: () => onClose(),
      onError: (error) => ctx.notify(errMessage(error) || DASH, "danger"),
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gap: 12, marginBottom: 4 }}>
        <Field
          label={tp(P("fldVendor"))}
          required
          hint={
            selectedVendor && selectedVendor.taxId
              ? `${tp(P("vendorTaxPrefix"))} ${selectedVendor.taxId}`
              : undefined
          }
        >
          <select
            value={draft.vendorId}
            onChange={(ev) => upd("vendorId", ev.target.value)}
            style={fld(Boolean(err.vendor))}
          >
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.code, v.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={tp(P("fldRefAp"))} required>
            {/* Real ap_billing register (GET /ap/billing) — required (server 404s a foreign id). */}
            <select
              value={draft.refApId}
              onChange={(ev) => upd("refApId", ev.target.value)}
              className="num"
              style={fld(Boolean(err.ref))}
            >
              <option value="">{tp(P("selectPlaceholder"))}</option>
              {billings.map((b) => (
                <option key={b.id} value={b.id}>
                  {apBillingLabel(b) || b.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tp(P(isCN ? "fldAmountCn" : "fldAmountDn"))} required>
            <input
              value={draft.amount}
              onChange={(ev) => upd("amount", ev.target.value.replace(/[^\d]/g, ""))}
              className="num"
              style={fld(Boolean(err.amount))}
            />
          </Field>
        </div>

        <Field label={tp(P("fldReason"))} required>
          <input
            value={draft.reason}
            onChange={(ev) => upd("reason", ev.target.value)}
            placeholder={tp(P(isCN ? "phReasonCn" : "phReasonDn"))}
            style={fld(Boolean(err.reason))}
          />
        </Field>

        {/* GL-posting info box (ap.jsx L508-510) — kind-tinted; the note posts its JV on approve. */}
        <div
          style={{
            padding: 12,
            background: isCN ? "var(--ok-soft)" : "var(--danger-soft)",
            borderRadius: 8,
            fontSize: 11.5,
            color: isCN ? "var(--ok)" : "var(--danger)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Icon name="info" size={14} />
          {tp(P(isCN ? "glInfoCn" : "glInfoDn"))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind={isCN ? "primary" : "danger"}
          size="md"
          icon="check"
          onClick={save}
          disabled={create.isPending}
        >
          {tp(P(isCN ? "saveCn" : "saveDn"))}
        </Btn>
      </div>
    </div>
  );
}
