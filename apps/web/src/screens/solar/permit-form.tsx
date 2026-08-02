/*
 * PermitForm — the add-permit-step modal body, ported 1:1 from pototype/real-forms2.jsx
 * RF2Permit (L312-330). Opened by SolarPermit via ctx.openModal; the screen owns the
 * POST /solar/permit-steps mutation (the modal unmounts on submit, so the toast fires off the
 * settled promise — fireWithToast — in the screen).
 *
 * Design fidelity (PLAN.md §0 rule 1): the required name input + placeholder, the 6-option
 * agency dropdown, and the cancel/submit footer are the prototype's, verbatim. The prototype's
 * ds.jsx <Dropdown> popover is a shared primitive not ported — the agency picker uses a native
 * <select> styled by tokens (vendor-form / cc-add-form precedent).
 *
 * Data (rules 3/4): the step defaults to `pending` SERVER-side (solar.ts createSolarPermitStep,
 * B-212 — no advance-step), so the form NEVER sends a status. `org` is stored as its display
 * string (the seed stores a Thai agency label, and the permit list renders org raw), resolved
 * from the picked option via t() — locale-stable (th=en=zh=ar) consume-only, no Thai literal in
 * source (B-073). money = NONE (no client money, no JV, no client-derived date).
 *
 * i18n (rule 2): every visible string is an existing dict key (t) — consume-only, no key minted.
 * The submit label reuses solar.warranty.actionAdd (the generic "add-item" string) — the
 * prototype's permit modal primary is that exact same string, and no solar.permit key holds it
 * (recon gap; solar.permit.addBtn is the header's "add-permit" string, a different one). Tokens
 * back every colour (rule 6).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";

/** The values the form emits; SolarPermit composes the opaque POST /solar/permit-steps body. */
export interface PermitDraft {
  name: string;
  /** Agency display string for the wire + toast (resolved from the picked option, locale-stable). */
  org: string;
}

export interface PermitFormProps {
  onSubmit: (draft: PermitDraft) => void;
  onClose: () => void;
}

/** Agency options (real-forms2.jsx L322): a stable code + its display-label key. */
const ORG_OPTIONS: readonly { code: string; labelKey: DictKey }[] = [
  { code: "pea", labelKey: "solar.permit.orgPea" },
  { code: "mea", labelKey: "solar.permit.orgMea" },
  { code: "snp", labelKey: "solar.permit.orgSnp" },
  { code: "factory", labelKey: "solar.permit.orgFactory" },
  { code: "local", labelKey: "solar.permit.orgLocal" },
  { code: "land", labelKey: "solar.permit.orgLand" },
];

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

export function PermitForm({ onSubmit, onClose }: PermitFormProps) {
  const { t } = useI18n();

  // Defaults verbatim real-forms2.jsx L313-314: blank name, org = PEA (solar.permit.orgPea).
  const [name, setName] = useState("");
  const [org, setOrg] = useState("pea");
  const [err, setErr] = useState(false);

  // Validation verbatim real-forms2.jsx L326: the name is the only required field.
  const submit = () => {
    if (!name.trim()) {
      setErr(true);
      return;
    }
    const opt = ORG_OPTIONS.find((o) => o.code === org) ?? ORG_OPTIONS[0]!;
    onSubmit({ name: name.trim(), org: t(opt.labelKey) });
  };

  return (
    <div>
      {/* Permit name (real-forms2.jsx L318-320). */}
      <Field label={t("solar.permit.fieldName")} required style={{ marginBottom: 12 }}>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErr(false);
          }}
          placeholder={t("solar.permit.namePlaceholder")}
          style={fieldStyle(err)}
        />
      </Field>

      {/* Agency (real-forms2.jsx L321-323). */}
      <Field label={t("solar.permit.fieldOrg")}>
        <select value={org} onChange={(e) => setOrg(e.target.value)} style={fieldStyle(false)}>
          {ORG_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </Field>

      {/* Footer (real-forms2.jsx L324-327). */}
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
