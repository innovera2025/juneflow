/*
 * WarehouseAddForm — the add-warehouse modal body, ported from pototype/inventory.jsx
 * WarehouseAddForm (L498-521). Opened by InventoryStock via ctx.openModal, mirroring
 * the prototype's own header action on that same screen (inventory.jsx:125-131).
 *
 * Design fidelity (PLAN.md §0 rule 1): the 1fr/2fr top row (code · name), the 1fr/1fr
 * grid below it, the required-field gating that keeps the save control disabled until
 * the form can be saved, and the cancel/save footer are the prototype's. The field
 * layout follows cc-add-form.tsx, which ported the same ds.jsx primitives.
 *
 * TWO PROTOTYPE ELEMENTS ARE DELIBERATELY ABSENT, and neither is an oversight:
 *
 *   1. THE PROJECT DROPDOWN. The prototype's fourth field is a required project
 *      picker. It has no key in i18n-full.json — no inv.whAdd.fieldProject exists —
 *      and `warehouse` has no project column either (the wire is code · name · type ·
 *      owner · capacity · location). Rendering it would mean inventing both a Thai
 *      label and a column. PLAN.md §0 rule 2 says a string with no key becomes a
 *      blocker, so it did: B-422.
 *
 *   2. ONE OF THE FOUR TYPE OPTIONS. inv.whType has site / central / temp; the
 *      prototype's fourth option (tools) has no key. Three are offered, not four,
 *      rather than minting the fourth. Same blocker.
 *
 * MOCK MECHANICS DROPPED (rule 3): the prototype seeds the code field with
 * "WH-" + Math.random(). A random default is not a code the server or anyone else
 * agreed to, and it changes on every open, so the field starts empty and the person
 * creating the warehouse types the code. The prototype's toast interpolates the name
 * and code it just invented; here it interpolates what the SERVER returned.
 *
 * The type VALUE sent to the server is a stable code ("site"/"central"/"temp"), never
 * the Thai label — same shape as cc-add-form's TYPE_OPTIONS. Measured on the live
 * staging box: every seeded warehouse has type null, so nothing depends on the old
 * shape and this is the first writer to set the column.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import type { WarehouseDraft } from "./use-inventory";

/**
 * Type options: value = the code stored in warehouse.type, label = its dict key.
 * The prototype's fourth option (tools) is missing from inv.whType — B-422.
 */
const WH_TYPE_OPTIONS: readonly (readonly [string, DictKey])[] = [
  ["site", "inv.whType.site" as DictKey],
  ["central", "inv.whType.central" as DictKey],
  ["temp", "inv.whType.temp" as DictKey],
];

/** Input style, shared with cc-add-form (ported from ds.jsx field styling). */
const fieldStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
};

export interface WarehouseAddFormProps {
  /** True while the create is in flight — both footer controls lock. */
  saving: boolean;
  onSubmit: (draft: WarehouseDraft) => void;
  onClose: () => void;
}

export function WarehouseAddForm({ saving, onSubmit, onClose }: WarehouseAddFormProps) {
  const { t } = useI18n();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("site");
  const [owner, setOwner] = useState("");
  const [capacity, setCapacity] = useState("");

  /**
   * The prototype's own gate (inventory.jsx:497): code && name && type && owner.
   * Kept as a DISABLED save rather than inline error text, because the prototype
   * gates the same way and because no inv.whAdd.err* key exists to render with.
   * The server is still authoritative — it 400s a blank code or name on its own.
   */
  const canSave = code.trim() !== "" && name.trim() !== "" && owner.trim() !== "";

  /** Capacity is optional; a non-numeric entry is dropped rather than sent as NaN. */
  const capacityNumber = (): number | undefined => {
    const raw = capacity.replace(/,/g, "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const submit = () => {
    if (!canSave || saving) return;
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      type,
      owner: owner.trim(),
      capacity: capacityNumber(),
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("inv.whAdd.fieldCode")} required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="num"
            style={fieldStyle}
          />
        </Field>

        <Field label={t("inv.whAdd.fieldName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("inv.whAdd.namePlaceholder")}
            style={fieldStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={t("inv.whAdd.fieldType")} required>
          <select value={type} onChange={(e) => setType(e.target.value)} style={fieldStyle}>
            {WH_TYPE_OPTIONS.map(([value, labelKey]) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("inv.whAdd.fieldOwner")} required>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder={t("inv.whAdd.ownerPlaceholder")}
            style={fieldStyle}
          />
        </Field>

        <Field label={t("inv.whAdd.fieldCapacity")}>
          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="num"
            style={fieldStyle}
          />
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn kind="outline" size="md" disabled={saving} onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" disabled={!canSave || saving} onClick={submit}>
          {t("inv.whAdd.btnSave")}
        </Btn>
      </div>
    </div>
  );
}
