/*
 * WOCreateForm — the "create WO" modal body, opened by WOList via ctx.openModal
 * (size "lg"). Focused real port of pototype/forms.jsx WOCreateForm (L268-...):
 * the mock's milestone-percentage editor + late-penalty field are dropped (§0 rule
 * 3, no wire) — the create path is wired to the real contract.
 *
 * Design fidelity (rule 1): the subcontractor select, the contract-value +
 * retention inputs, the 2-column meta field grid, and the cancel/submit footer are
 * the prototype's. Every string is a wo.form* / po.list* / common.* dict key (t) or a
 * po-wo-strings.json phrase (tp) — no Thai literal in source (rule 2).
 *
 * Data (rule 3): the vendor options come from GET /vendors; the approved-PR options
 * from GET /pr. "create + send-for-approval" runs POST /wo (draft) then POST /wo/{id}/submit
 * (draft -> pending). On success the WO list is invalidated + the screen navigates to
 * wo.list.
 *
 * WIRE GAP / DIVERGENCE (reported honestly): POST /wo REQUIRES an approved pr_id (a
 * WO is raised from an approved PR — wo.ts), but the prototype's WO create form has
 * NO PR picker. This focused port ADDS an approved-PR picker (a divergence forced by
 * the wire) so the create call can succeed. The contract value + retention_pct are
 * real body fields; the start/deliver dates, scope, and warranty inputs are shown for
 * fidelity but do NOT persist (wo.ts GAP 1 — no such columns), flagged.
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
import { usePrList, useCreateWo, useSubmitWo } from "./use-po-wo";
import { toPrRef, toVendorRef, approvedPrs, vendorNameById, formatMoney } from "./po-wo-rows";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
/** The prototype's verbatim ASCII "Retention" field label (no Thai key). */
const RETENTION_LABEL = "Retention";
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

/** Parse a grouped/decimal money input ("2,150,000") to a finite number (0 fallback). */
function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface WOCreateFormProps {
  onClose: () => void;
}

export function WOCreateForm({ onClose }: WOCreateFormProps) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const prQ = usePrList();
  const vendorQ = useVendorList();
  const createWo = useCreateWo();
  const submitWo = useSubmitWo();

  const prOpts = useMemo(() => approvedPrs((prQ.data ?? []).map(toPrRef)), [prQ.data]);
  const vendors = useMemo(() => (vendorQ.data ?? []).map(toVendorRef), [vendorQ.data]);
  const vendorNames = useMemo(() => vendorNameById(vendors), [vendors]);

  const [prId, setPrId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [value, setValue] = useState("");
  const [retentionPct, setRetentionPct] = useState("");

  const effectivePrId = prId || prOpts[0]?.id || "";
  const effectiveVendorId = vendorId || vendors[0]?.id || "";

  const busy = createWo.isPending || submitWo.isPending;
  const canSubmit = !!effectivePrId && !!effectiveVendorId && !busy;

  const submit = () => {
    if (!effectivePrId || !effectiveVendorId) return;
    const retention = Number.parseFloat(retentionPct);
    createWo.mutate(
      {
        pr_id: effectivePrId,
        vendor_id: effectiveVendorId,
        value: parseAmount(value),
        retention_pct: Number.isFinite(retention) && retention >= 0 ? retention : 0,
      },
      {
        onSuccess: (created) => {
          const c = created as Record<string, unknown>;
          const id = typeof c.id === "string" ? c.id : "";
          const done = () => {
            onClose();
            ctx.notify(t("wo.form.createdToast"));
            ctx.navigate("wo.list");
          };
          if (id) submitWo.mutate(id, { onSuccess: done, onError: done });
          else done();
        },
      },
    );
  };

  return (
    <>
      {/* Pick an approved PR (added — required by the wire, absent in the mock) */}
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
                    name="wo-pr"
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

      {/* Meta grid — subcon / value / retention are real; the rest presentational */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <Field label={tp(P("thSubcon"))} required>
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
        <Field label={tp(P("startWork"))} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("wo.form.deliverWork")} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={tp(P("thScope"))}>
          <input style={fieldStyle()} />
        </Field>
        <Field label={tp(P("contractValue"))} required>
          <input
            className="num"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            style={fieldStyle()}
          />
        </Field>
        <Field label={RETENTION_LABEL}>
          <input
            className="num"
            value={retentionPct}
            onChange={(e) => setRetentionPct(e.target.value)}
            inputMode="numeric"
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("wo.form.warrantyPeriod")}>
          <input className="num" style={fieldStyle()} />
        </Field>
      </div>

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
