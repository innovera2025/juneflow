/*
 * BlockAddForm — the add phase/block modal body, ported 1:1 from
 * pototype/master.jsx BlockAddForm (L247-309). Opened by MasterProject via
 * ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 2fr/1fr field grid (name · code · model ·
 * units), the validation (required name/code, dup code, 1..200 units) and the
 * info-box + submit label are the prototype's, verbatim. Every user-visible string is
 * a block.* / common.* dict key or a project-strings.json phrase (rule 2); tokens back
 * every colour (rule 6).
 *
 * Mock mechanics dropped (rule 3): the prototype's `model` string + client-picked
 * `color` become a real model_id sent to POST /projects/{id}/nodes — the server
 * creates the block + N empty unit nodes and derives colour from the model. The full
 * ds.jsx Dropdown popover is a shared primitive not yet ported, so the model picker
 * uses a native <select> (behaviour-equivalent, same choice as org-add-form.tsx); the
 * add modal has no visual-gate reference (g2/32 shows only the loaded grid).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import type { ModelLite } from "./project-blocks";

/** The POST /projects/{id}/nodes body the form composes (opaque Entity on the wire). */
export interface BlockBody {
  name: string;
  code: string;
  units: number;
  model_id?: string;
}

export interface BlockAddFormProps {
  /** Existing block codes (uppercased) for the dup check (master.jsx:264). */
  existingCodes: readonly string[];
  /** Model catalogue for the picker (GET /models). */
  models: readonly ModelLite[];
  /** Target phase display name for the info line (server attaches under the 1st phase). */
  phaseName: string;
  onSubmit: (body: BlockBody, unitLabel: string) => void;
  onClose: () => void;
}

/** Input style, ported from BlockAddForm.fieldStyle (master.jsx:254-258). */
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

const MAX_UNITS = 200;

export function BlockAddForm({ existingCodes, models, phaseName, onSubmit, onClose }: BlockAddFormProps) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [units, setUnits] = useState("");
  const [err, setErr] = useState<{ name?: string; code?: string; units?: string }>({});

  const takenCodes = new Set(existingCodes.map((c) => c.toUpperCase()));

  const submit = () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = t("block.errNameReq");
    if (!code.trim()) e.code = t("block.errCodeReq");
    else if (takenCodes.has(code.trim().toUpperCase())) e.code = t("block.errCodeDup");
    const u = Number.parseInt(units, 10);
    if (!units || Number.isNaN(u) || u < 1) e.units = t("block.errUnitsReq");
    else if (u > MAX_UNITS) e.units = t("block.errUnitsMax");
    setErr(e);
    if (Object.keys(e).length) return;

    const body: BlockBody = { name: name.trim(), code: code.trim().toUpperCase(), units: u };
    if (modelId) body.model_id = modelId;
    onSubmit(body, name.trim());
  };

  // Info line: "add into <phase> · all units start 'empty', bound to the chosen model"
  // (master.jsx:301). block.infoLine is a {phase} template; the phase segment is bold,
  // reproduced by splitting the resolved string on the interpolated phase.
  const infoLine = t("block.infoLine").replace("{phase}", phaseName);
  const infoParts = infoLine.split(phaseName);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
        <Field label={t("block.fieldName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("block.phName")}
            style={fieldStyle(!!err.name)}
          />
          {err.name && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.name}</div>}
        </Field>

        <Field label={t("block.fieldCode")} required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("block.phCode")}
            className="num"
            style={{ ...fieldStyle(!!err.code), textTransform: "uppercase" }}
          />
          {err.code && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.code}</div>}
        </Field>

        <Field label={t("block.fieldModel")} required>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={fieldStyle(false)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.code} · ${m.type}`}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("block.fieldUnits")} required>
          <input
            value={units}
            onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))}
            placeholder="0"
            className="num"
            style={fieldStyle(!!err.units)}
          />
          {err.units && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.units}</div>}
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
        <span>
          {infoParts[0]}
          <b style={{ color: "var(--text)" }}>{phaseName}</b>
          {infoParts.slice(1).join(phaseName)}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("block.addBtn")}
        </Btn>
      </div>
    </div>
  );
}
