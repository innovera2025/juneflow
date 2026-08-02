/*
 * WarrantyForm — the add-warranty-item modal body, ported 1:1 from pototype/real-forms2.jsx
 * RF2Warranty (L338-355). Opened by SolarWarranty via ctx.openModal; the screen owns the
 * POST /solar/warranties mutation (the modal unmounts on submit, so the toast fires off the
 * settled promise — fireWithToast — in the screen). Add-only (no claim flow).
 *
 * Design fidelity (PLAN.md §0 rule 1): the required item input + placeholder, the 7-option
 * warranty-years dropdown, and the cancel/submit footer are the prototype's, verbatim. The
 * prototype's ds.jsx <Dropdown> popover is a shared primitive not ported — the years picker uses
 * a native <select> styled by tokens (vendor-form / cc-add-form precedent).
 *
 * Data (rules 3/4): the item defaults to `active` SERVER-side (solar.ts createSolarWarranty), so
 * the form NEVER sends a status; `years` is emitted as a number and the server stores
 * Math.trunc(years) (B-219). money = NONE (no client money, no JV, no client-derived date).
 *
 * i18n (rule 2): every visible string is an existing dict key (t) — consume-only, no key minted.
 * The years-option year-unit suffix reuses fa.lifeYears (the "{n}"-templated years label, the
 * byte-exact equivalent of the prototype's `v + <year-unit>`); the submit label is the warranty
 * screen's own solar.warranty.actionAdd. No Thai literal lives in source (B-073); tokens back
 * every colour (rule 6).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";

/** The values the form emits; SolarWarranty composes the opaque POST /solar/warranties body. */
export interface WarrantyDraft {
  item: string;
  /** Warranty duration in years, as the picked string ("10") — the caller Number()s it for the wire. */
  years: string;
}

export interface WarrantyFormProps {
  onSubmit: (draft: WarrantyDraft) => void;
  onClose: () => void;
}

/** Warranty-year options (real-forms2.jsx L348), verbatim. */
const YEARS_OPTIONS = ["1", "2", "3", "5", "10", "12", "25"] as const;

/** Input/select style, verbatim real-forms2.jsx RF2_fld (only the error border differs). */
function fieldStyle(bad: boolean): CSSProperties {
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
  };
}

export function WarrantyForm({ onSubmit, onClose }: WarrantyFormProps) {
  const { t } = useI18n();

  // Defaults verbatim real-forms2.jsx L339-340: blank item, years = "10".
  const [item, setItem] = useState("");
  const [years, setYears] = useState("10");
  const [err, setErr] = useState(false);

  // Validation verbatim real-forms2.jsx L352: the item is the only required field.
  const submit = () => {
    if (!item.trim()) {
      setErr(true);
      return;
    }
    onSubmit({ item: item.trim(), years });
  };

  return (
    <div>
      {/* Item / brand-model (real-forms2.jsx L344-346). */}
      <Field label={t("solar.warranty.fieldItem")} required style={{ marginBottom: 12 }}>
        <input
          value={item}
          onChange={(e) => {
            setItem(e.target.value);
            setErr(false);
          }}
          placeholder={t("solar.warranty.itemPlaceholder")}
          style={fieldStyle(err)}
        />
      </Field>

      {/* Warranty years (real-forms2.jsx L347-349). Year-unit suffix via fa.lifeYears (borrow). */}
      <Field label={t("solar.warranty.fieldYears")}>
        <select value={years} onChange={(e) => setYears(e.target.value)} style={fieldStyle(false)}>
          {YEARS_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {t("fa.lifeYears").replace("{n}", v)}
            </option>
          ))}
        </select>
      </Field>

      {/* Footer (real-forms2.jsx L350-353). */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("solar.warranty.actionAdd")}
        </Btn>
      </div>
    </div>
  );
}
