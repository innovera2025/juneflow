/*
 * ModelAddForm — the add-model modal body, ported 1:1 from pototype/master.jsx
 * ModelAddForm (L434-505). Opened by MasterModel via ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 1fr/2fr field grid (code · type · area ·
 * price), the 1fr/1fr/1fr room grid (bed/bath/parking, defaults 3/2/1), the validation
 * (required code + dup check, required type, required area, optional-but-valid price),
 * the dashed info box and the cancel/submit footer are the prototype's, verbatim. Every
 * user-visible string is a model.* / common.* dict key (rule 2); tokens back every
 * colour (rule 6).
 *
 * Mock mechanics dropped (rule 3): the prototype's client MODEL_COLORS array + the
 * count:0 / status:"draft" fields are NOT sent — the server assigns colour + status on
 * create (B-050). The form emits a ModelDraft with `price` in MILLIONS (the field unit);
 * MasterModel scales it ×1_000_000 to FULL baht for the POST. The add modal has no
 * visual-gate reference (g2/33 shows only the loaded grid).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";

/**
 * The values the form emits. `price` is in MILLIONS of baht (the price field's unit is
 * millions of baht) — MasterModel converts to FULL baht for POST /models.
 */
export interface ModelDraft {
  code: string;
  type: string;
  area: number;
  bed: number;
  bath: number;
  parking: number;
  /** Starting price in MILLIONS of baht (0 when the optional field is blank). */
  price: number;
}

export interface ModelAddFormProps {
  /** Existing model codes (uppercased) for the dup check (master.jsx:454). */
  existingCodes: readonly string[];
  onSubmit: (draft: ModelDraft) => void;
  onClose: () => void;
}

/** Input style, ported from ModelAddForm.fieldStyle (master.jsx:444-448). */
function fieldStyle(bad: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: `1px solid ${bad ? "var(--danger)" : "var(--border)"}`,
    borderRadius: 7,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
  };
}

export function ModelAddForm({ existingCodes, onSubmit, onClose }: ModelAddFormProps) {
  const { t } = useI18n();

  const [code, setCode] = useState("");
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [bed, setBed] = useState("3");
  const [bath, setBath] = useState("2");
  const [parking, setParking] = useState("1");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<{ code?: string; type?: string; area?: string; price?: string }>({});

  const takenCodes = new Set(existingCodes.map((c) => c.toUpperCase()));

  // Validation, verbatim master.jsx:451-461 (existing model.err* keys, rule 2).
  const submit = () => {
    const e: typeof err = {};
    if (!code.trim()) e.code = t("model.errCodeRequired");
    else if (takenCodes.has(code.trim().toUpperCase())) e.code = t("model.errCodeDup");
    if (!type.trim()) e.type = t("model.errTypeRequired");
    const a = Number.parseInt(area, 10);
    if (!area || Number.isNaN(a) || a < 1) e.area = t("model.errAreaRequired");
    const p = Number.parseFloat(price);
    if (price && (Number.isNaN(p) || p <= 0)) e.price = t("model.errPriceInvalid");
    setErr(e);
    if (Object.keys(e).length) return;

    onSubmit({
      code: code.trim().toUpperCase(),
      type: type.trim(),
      area: a,
      bed: Number.parseInt(bed, 10) || 0,
      bath: Number.parseInt(bath, 10) || 0,
      parking: Number.parseInt(parking, 10) || 0,
      price: p || 0,
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
        <Field label={t("model.fieldCode")} required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("model.phCode")}
            className="num"
            style={{ ...fieldStyle(!!err.code), textTransform: "uppercase" }}
          />
          {err.code && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.code}</div>}
        </Field>

        <Field label={t("model.fieldType")} required>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder={t("model.phType")}
            style={fieldStyle(!!err.type)}
          />
          {err.type && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.type}</div>}
        </Field>

        <Field label={t("model.fieldArea")} required>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value.replace(/\D/g, ""))}
            placeholder="0"
            className="num"
            style={fieldStyle(!!err.area)}
          />
          {err.area && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.area}</div>}
        </Field>

        <Field label={t("model.fieldPrice")}>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.00"
            className="num"
            style={fieldStyle(!!err.price)}
          />
          {err.price && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.price}</div>}
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Field label={t("model.fieldBed")}>
          <input
            value={bed}
            onChange={(e) => setBed(e.target.value.replace(/\D/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("model.fieldBath")}>
          <input
            value={bath}
            onChange={(e) => setBath(e.target.value.replace(/\D/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("model.fieldParking")}>
          <input
            value={parking}
            onChange={(e) => setParking(e.target.value.replace(/\D/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          background: "var(--surface-2)",
          border: "1px dashed var(--border-strong)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        <Icon name="info" size={15} color="var(--accent)" />
        <span>{t("model.addInfo")}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("model.addBtn")}
        </Btn>
      </div>
    </div>
  );
}
