/*
 * CCAddForm — the add-cost-center modal body, ported 1:1 from pototype/master.jsx
 * CCAddForm (L603-663). Opened by MasterCC via ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 1fr/1fr field grid (code · type, name span2,
 * link · owner, budget span2), the validation (required code + "CC-" guard + dup check,
 * required name, optional-but-numeric budget), and the cancel/submit footer are the
 * prototype's, verbatim. Every user-visible string is a cc.* / common.* dict key (rule 2);
 * tokens back every colour (rule 6).
 *
 * Mock mechanics dropped (rule 3): the prototype's status:"draft" field + window.__ccExtra
 * dup tracking are NOT emitted — the form emits a CcDraft and MasterCC composes the opaque
 * POST /cost-centers body (project_id from the active project; server forces status/THB,
 * B-059). The dup check is a client UX pre-check against the loaded codes; the server's
 * 409 DUPLICATE_CODE is authoritative. The full ds.jsx Dropdown popover is a shared
 * primitive not ported; the type field uses a native <select> (org-add-form.tsx precedent).
 * The add modal has no visual-gate reference (g2/34 shows only the loaded table).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";

/**
 * The values the form emits. `budget` is the raw input string (digits/commas, blank ->
 * treated as 0) — MasterCC parses it to a FULL-baht Number for POST /cost-centers.
 */
export interface CcDraft {
  code: string;
  name: string;
  type: string;
  link: string;
  owner: string;
  /** Raw budget input (digits/commas); MasterCC parses it to a FULL-baht Number. */
  budget: string;
}

export interface CCAddFormProps {
  /** Existing cost-center codes for the client dup pre-check (master.jsx:621). */
  existingCodes: readonly string[];
  onSubmit: (draft: CcDraft) => void;
  onClose: () => void;
}

/** Type options (master.jsx:641): value = server enum, label = the cc.opt* dict key. */
const TYPE_OPTIONS: readonly [string, "cc.optProject" | "cc.optOverhead" | "cc.optDept"][] = [
  ["Project", "cc.optProject"],
  ["Overhead", "cc.optOverhead"],
  ["Dept", "cc.optDept"],
];

/** Input style, ported from CCAddForm.fieldStyle (master.jsx:612-616). */
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

/** Inline field-error style, ported from CCAddForm (master.jsx:638). */
const errStyle: CSSProperties = { fontSize: 11, color: "var(--danger)", marginTop: 4 };

export function CCAddForm({ existingCodes, onSubmit, onClose }: CCAddFormProps) {
  const { t } = useI18n();

  const [code, setCode] = useState("CC-");
  const [name, setName] = useState("");
  const [type, setType] = useState("Project");
  const [link, setLink] = useState("");
  const [owner, setOwner] = useState("");
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState<{ code?: string; name?: string; budget?: string }>({});

  const takenCodes = new Set(existingCodes);

  // Validation, verbatim master.jsx:618-625 (cc.err* keys, rule 2). The dup check is a
  // client UX pre-check against the loaded codes; the server (409 DUPLICATE_CODE) is
  // authoritative.
  const submit = () => {
    const e: typeof err = {};
    const codeT = code.trim();
    if (!codeT || codeT === "CC-") e.code = t("cc.errCodeRequired");
    else if (takenCodes.has(codeT)) e.code = t("cc.errCodeDup");
    if (!name.trim()) e.name = t("cc.errNameRequired");
    if (budget && Number.isNaN(Number(budget.replace(/,/g, "")))) e.budget = t("cc.errBudgetNumber");
    setErr(e);
    if (Object.keys(e).length) return;

    onSubmit({
      code: codeT,
      name: name.trim(),
      type,
      link: link.trim() || "—",
      owner: owner.trim() || "—",
      budget: budget.trim(),
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={t("cc.fldCode")} required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("cc.phCode")}
            className="num"
            style={fieldStyle(!!err.code)}
          />
          {err.code && <div style={errStyle}>{err.code}</div>}
        </Field>

        <Field label={t("cc.fldType")} required>
          <select value={type} onChange={(e) => setType(e.target.value)} style={fieldStyle(false)}>
            {TYPE_OPTIONS.map(([v, labelKey]) => (
              <option key={v} value={v}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("cc.fldName")} required style={{ gridColumn: "span 2" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("cc.phName")}
            style={fieldStyle(!!err.name)}
          />
          {err.name && <div style={errStyle}>{err.name}</div>}
        </Field>

        <Field label={t("cc.fldLink")}>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t("cc.phLink")}
            style={fieldStyle(false)}
          />
        </Field>

        <Field label={t("cc.fldOwner")}>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder={t("cc.phOwner")}
            style={fieldStyle(false)}
          />
        </Field>

        <Field label={t("cc.fldBudget")} style={{ gridColumn: "span 2" }}>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="0"
            className="num"
            style={fieldStyle(!!err.budget)}
          />
          {err.budget && <div style={errStyle}>{err.budget}</div>}
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("cc.addBtn")}
        </Btn>
      </div>
    </div>
  );
}
