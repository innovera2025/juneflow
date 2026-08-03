/*
 * APDepositForm — the "create a vendor deposit" modal body, ported from
 * pototype/ap.jsx APDepositForm (L452-483). Opened by APDeposit via ctx.openModal.
 *
 * Design fidelity (Juneflow §0): the 2-col Field grid (vendor · PO/WO ref · pct
 * · deposit-amount), the GL auto-posting info line, and the footer actions
 * (cancel · save-deposit) keep the prototype's shape.
 *
 * Data: this is a REAL POST /ap/deposit (use-ap.ts). The vendor picker is the REAL
 * active-vendor catalogue (GET /vendors); the PO/WO ref picker is the REAL
 * purchase/work orders (GET /po + GET /wo -> po_id | wo_id). The prototype's free-text
 * ref + static Select mocks are dropped (§0 rule 3, divergence #5): a typed id would
 * fail the server's tenant-ownership check.
 *
 * MONEY = SERVER (gate-4.5): the client sends only { vendor_id, amount, po_id? | wo_id?,
 * pct? }. `amount` is the user-typed deposit cost; `pct` is a stored LABEL that NEVER
 * derives amount; the server owns the doc number, the computed balance/status, and posts
 * the balanced JV (Dr 1160 / Cr 1010) from the STORED amount. The web does no money math.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the doc-number field (readOnly auto DP-no) + the date field are DROPPED: the
 *     server allocates `no` and owns created_at (ap-deposit.ts), so there is nothing to
 *     collect (billing-form precedent — drop rather than fabricate).
 *   - the vendor hint shows only the tax id (billing-form precedent); the prototype's
 *     credit-term + bank suffix is omitted (no format-faithful wire mapping) — honest.
 *   - the GL info line is PROTOTYPE-ILLUSTRATIVE standard-template copy (one static
 *     string, no amounts) — the real JV is posted server-side.
 *
 * i18n: every string is an ap-deposit-strings.json phrase (tp) or common.cancel (t).
 * Missing keys are flagged (._missing). NO Thai/baht in this .tsx (B-073).
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
import { usePoList, useWoList } from "../po-wo/use-po-wo";
import { useCreateApDeposit } from "./use-ap";
import {
  emptyDepositDraft,
  depositSubmittable,
  buildDepositBody,
  type DepositDraft,
} from "./deposit-rows";
import depositStrings from "./ap-deposit-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof depositStrings): PhraseKey => depositStrings[k] as PhraseKey;

/** Header field input style (jv-create-form headInput, as ap/billing-form). */
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

/** Read the display no off an opaque /po or /wo row (id + no only). */
function docNo(row: Record<string, unknown>): string {
  const no = row.no ?? row.id;
  return typeof no === "string" ? no : String(no ?? "");
}

export function APDepositForm({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const vendorsQ = useVendorList();
  const poQ = usePoList();
  const woQ = useWoList();
  const createDeposit = useCreateApDeposit();

  const [draft, setDraft] = useState<DepositDraft>(emptyDepositDraft());

  // Only ACTIVE vendors are payable (ap.jsx APDepositForm vendorPool filter, L453).
  const vendors = useMemo(
    () => (vendorsQ.data ?? []).map(toVendorRow).filter((v) => v.status === "active"),
    [vendorsQ.data],
  );
  const pos = useMemo(() => (poQ.data ?? []) as Record<string, unknown>[], [poQ.data]);
  const wos = useMemo(() => (woQ.data ?? []) as Record<string, unknown>[], [woQ.data]);
  const selectedVendor = vendors.find((v) => v.id === draft.vendorId);

  const upd = (k: keyof DepositDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    if (!depositSubmittable(draft)) return;
    createDeposit.mutate(buildDepositBody(draft), {
      onSuccess: () => onClose(), // list invalidates -> the new deposit appears (honest).
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
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
          {/* Optional po_id | wo_id ref — the REAL purchase/work orders (GET /po + /wo).
              value is encoded "po:<id>" | "wo:<id>"; decoded in buildDepositBody. */}
          <select value={draft.refSel} onChange={(e) => upd("refSel", e.target.value)} style={headInput}>
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {pos.map((p) => (
              <option key={`po:${String(p.id)}`} value={`po:${String(p.id)}`}>
                {docNo(p)}
              </option>
            ))}
            {wos.map((w) => (
              <option key={`wo:${String(w.id)}`} value={`wo:${String(w.id)}`}>
                {docNo(w)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("fPct"))}>
          {/* Stored LABEL only — never derives amount (ap-deposit.ts L319-321). Digits only. */}
          <input
            value={draft.pct}
            onChange={(e) => upd("pct", e.target.value.replace(/[^\d]/g, ""))}
            className="num"
            style={headInput}
          />
        </Field>
        <Field label={tp(P("fAmount"))} required style={{ gridColumn: "span 2" }}>
          <input
            value={draft.amount}
            onChange={(e) => upd("amount", e.target.value.replace(/[^\d]/g, ""))}
            className="num"
            style={headInput}
          />
        </Field>
      </div>

      {/* GL auto-posting info — PROTOTYPE-ILLUSTRATIVE standard-template copy (no amounts). */}
      <div
        style={{
          padding: 12,
          background: "var(--brand-soft)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 11.5,
          color: "var(--text-2)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Icon name="info" size={14} color="var(--brand)" />
        {tp(P("glInfo"))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!depositSubmittable(draft) || createDeposit.isPending}
        >
          {tp(P("saveBtn"))}
        </Btn>
      </div>
    </>
  );
}
