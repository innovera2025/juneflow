/*
 * VendorForm — the add/edit vendor modal body, ported 1:1 from pototype/master-party.jsx
 * VendorForm (L137-183). Opened by MasterVendor via ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 4-button type picker (material / contractor /
 * service / land, each an icon + label), the 120px/1fr code+name grid, the 1fr/1fr tax-id +
 * credit-term and bank + status grids, the full-width address field, the required-name
 * validation, and the cancel/submit footer are the prototype's, verbatim. Every user-visible
 * string is a vendor.* / common.* dict key (t), or a phrase (tp) sourced from
 * vendor-strings.json so no Thai literal sits in this source (rule 2); tokens back every
 * colour (rule 6). The prototype's ds.jsx <Dropdown> popover is a shared primitive not
 * ported — credit-term and status use native <select> (cc-add-form.tsx / org-add-form.tsx
 * precedent).
 *
 * Schema realities (rule 3, B-070 / B-071):
 *   - The 4-way type selection is mapped back to the 2-way `kind` on submit (typeToKind):
 *     contractor -> subcon, material/service/land -> supplier. Editing a supplier therefore
 *     always opens on "material" (its derived type); a service/land re-selection still
 *     persists as supplier — an honest consequence of the 2-way schema.
 *   - The credit-term dropdown value is mapped to an integer of DAYS (or null for the milestone
 *     option)
 *     for the wire; the display re-derives the label from those days (vendor-rows.creditTermKey).
 *   - spend is never collected/emitted — it has no wire field (B-071 honest gap).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import {
  displayType,
  typeToKind,
  type VendorKind,
  type VendorRow,
  type VendorStatus,
  type VendorTypeKey,
} from "./vendor-rows";
import vendorStrings from "./vendor-strings.json" with { type: "json" };

/** The values the form emits; MasterVendor composes the opaque POST/PUT /vendors body. */
export interface VendorDraft {
  code: string;
  name: string;
  /** 2-way wire kind, already mapped from the 4-way type selection (B-070). */
  kind: VendorKind;
  taxId: string;
  /** Credit term in DAYS, or null (milestone / none). */
  creditTerm: number | null;
  addr: string;
  bank: string;
  status: VendorStatus;
}

export interface VendorFormProps {
  /** The vendor being edited, or null for a new one (master-party.jsx:137). */
  preset?: VendorRow | null;
  onSubmit: (draft: VendorDraft) => void;
  onClose: () => void;
}

/** Type-picker buttons (master-party.jsx:156): discriminant + dict/phrase label + icon. */
const TYPE_BUTTONS: readonly {
  type: VendorTypeKey;
  labelKey: "vendor.typeMaterial" | "vendor.typeService" | "vendor.typeLand" | null;
  icon: IconName;
}[] = [
  { type: "material", labelKey: "vendor.typeMaterial", icon: "cart" },
  { type: "contractor", labelKey: null, icon: "hardhat" }, // label = tabContractor phrase
  { type: "service", labelKey: "vendor.typeService", icon: "wrench" },
  { type: "land", labelKey: "vendor.typeLand", icon: "landplot" },
];

/** Credit-term dropdown options (master-party.jsx:170): select value + wire days. */
const TERM_OPTIONS: readonly {
  value: string;
  days: number | null;
  labelKey: "vendor.term15" | "vendor.term30" | "vendor.term45" | "vendor.term60" | null;
}[] = [
  { value: "0", days: 0, labelKey: null }, // cash (termCash phrase)
  { value: "15", days: 15, labelKey: "vendor.term15" },
  { value: "30", days: 30, labelKey: "vendor.term30" },
  { value: "45", days: 45, labelKey: "vendor.term45" },
  { value: "60", days: 60, labelKey: "vendor.term60" },
  { value: "milestone", days: null, labelKey: null }, // milestone (termMilestone phrase)
];

/** Map a preset's credit-term days back to its dropdown value (default milestone/null). */
function daysToTermValue(days: number | null): string {
  const hit = TERM_OPTIONS.find((o) => o.days === days);
  return hit ? hit.value : "milestone";
}

/** Map a dropdown value to its wire day count (or null). */
function termValueToDays(value: string): number | null {
  return TERM_OPTIONS.find((o) => o.value === value)?.days ?? null;
}

/** Input style, verbatim master-party.jsx:51 partyFld (only the token/border differs on error). */
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

export function VendorForm({ preset, onSubmit, onClose }: VendorFormProps) {
  const { t, tp } = useI18n();

  // New-vendor code default, verbatim master-party.jsx:138 (mock suggestion; the code column
  // is free text with no format rule — vendors.ts — so a client suggestion is faithful).
  const [code, setCode] = useState(
    preset?.code || "V-00" + String(Math.floor(60 + Math.random() * 39)),
  );
  const [name, setName] = useState(preset?.name || "");
  const [type, setType] = useState<VendorTypeKey>(
    preset ? displayType(preset.kind) : "material",
  );
  const [taxId, setTaxId] = useState(preset?.taxId || "");
  const [term, setTerm] = useState<string>(
    preset ? daysToTermValue(preset.creditTerm) : "30",
  );
  const [addr, setAddr] = useState(preset?.addr || "");
  const [bank, setBank] = useState(preset?.bank || "");
  const [status, setStatus] = useState<VendorStatus>(
    preset?.status === "inactive" ? "inactive" : "active",
  );
  const [err, setErr] = useState<{ name?: boolean }>({});

  const isContractor = type === "contractor";

  // Validation, verbatim master-party.jsx:147-149: name is the only required field.
  const submit = () => {
    if (!name.trim()) {
      setErr({ name: true });
      return;
    }
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      kind: typeToKind(type),
      taxId: taxId.trim(),
      creditTerm: termValueToDays(term),
      addr: addr.trim(),
      bank: bank.trim(),
      status,
    });
  };

  const contractorLabel = tp(vendorStrings.tabContractor as PhraseKey);

  return (
    <div>
      {/* Type picker (master-party.jsx:153-163). */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 7 }}
        >
          {t("vendor.formTypeLabel")} <span style={{ color: "var(--danger)" }}>*</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {TYPE_BUTTONS.map((b) => {
            const on = type === b.type;
            return (
              <button
                key={b.type}
                type="button"
                onClick={() => setType(b.type)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  padding: "11px 6px",
                  borderRadius: 10,
                  border: `1.5px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  background: on ? "var(--brand-soft)" : "var(--surface)",
                  // --brand-ink is not in @juneflow/tokens (only the prototype's fiori HTML
                  // theme defines it); use the prototype's own fallback (accounting-extra2.jsx)
                  // so the token is honoured if added, else falls back to --brand — no hardcode.
                  color: on ? "var(--brand-ink, var(--brand))" : "var(--text-2)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Icon name={b.icon} size={18} color={on ? "var(--brand)" : "var(--text-3)"} />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}
                >
                  {b.labelKey ? t(b.labelKey) : contractorLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Code + name (master-party.jsx:164-167). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Field label={tp(vendorStrings.thCode as PhraseKey)}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field
          label={t(isContractor ? "vendor.fieldNameContractor" : "vendor.fieldNameSupplier")}
          required
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(isContractor ? "vendor.phNameContractor" : "vendor.phNameSupplier")}
            style={fieldStyle(!!err.name)}
          />
        </Field>
      </div>

      {/* Tax id + credit term (master-party.jsx:168-171). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Field label={t("vendor.thTaxId")}>
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder={t("vendor.phTaxId")}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("vendor.thTerm")}>
          <select value={term} onChange={(e) => setTerm(e.target.value)} style={fieldStyle(false)}>
            {TERM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.labelKey
                  ? t(o.labelKey)
                  : o.value === "0"
                    ? tp(vendorStrings.termCash as PhraseKey)
                    : tp(vendorStrings.termMilestone as PhraseKey)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Address (master-party.jsx:172). */}
      <Field label={t("vendor.fieldAddr")} style={{ marginBottom: 12 }}>
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder={t("vendor.phAddr")}
          style={fieldStyle(false)}
        />
      </Field>

      {/* Bank + status (master-party.jsx:173-176). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("vendor.fieldBank")}>
          <input
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder={t("vendor.phBank")}
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("common.status")}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value === "inactive" ? "inactive" : "active")}
            style={fieldStyle(false)}
          >
            <option value="active">{tp(vendorStrings.statusActive as PhraseKey)}</option>
            <option value="inactive">{t("vendor.statusInactive")}</option>
          </select>
        </Field>
      </div>

      {/* Footer (master-party.jsx:177-180). */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {preset
            ? t("common.save")
            : isContractor
              ? t("vendor.btnAddContractor")
              : t("vendor.btnAddVendor")}
        </Btn>
      </div>
    </div>
  );
}
