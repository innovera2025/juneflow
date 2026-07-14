/*
 * OrgAddForm — the add/edit company·department modal body, ported 1:1 from
 * pototype/master.jsx OrgAddForm (L20-114). Opened by MasterCompany via ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the kind toggle (company/dept), the 2-col field
 * grid, validation and the submit-button labels are the prototype's, verbatim. Every
 * user-visible string is an org.* / common.* dict key from i18n-full.json (rule 2); tokens
 * back every colour (rule 6). The prototype's mock parent link is the `code`; the server
 * links by `id`, so the parent <select> carries `id` and the composed create/edit body
 * sends `parent_id` (apps/api/src/routes/org-units.ts; the server computes level + icon).
 *
 * The full ds.jsx Dropdown popover is a shared primitive not yet ported; the parent
 * picker uses a native <select> (behaviour-equivalent) — the add/edit modal has no
 * visual-gate reference (g2/28 shows only the loaded list), so this is faithful to the
 * field row, not to the popover chrome.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import type { OrgNode } from "./org-tree";

type Entity = components["schemas"]["Entity"];

/** A preset carried into the modal: a full node (edit) or a partial (add sub-unit). */
export interface OrgPreset {
  id?: string;
  level?: number;
  parent_id?: string | null;
  name?: string;
  code?: string;
  note?: string;
}

export interface OrgAddFormProps {
  /** The whole current tree — parents (dropdown) + taken codes (dup check). */
  rows: readonly OrgNode[];
  /** Edit target (full node) or add-sub partial ({level, parent_id}); undefined = fresh add. */
  preset?: OrgPreset;
  onSubmit: (body: Entity, preset: OrgPreset | null) => void;
  onClose: () => void;
}

type Kind = "company" | "dept";

/** Input style, ported from OrgAddForm.fieldStyle (master.jsx:31-35). */
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

const KIND_TABS: readonly [Kind, "org.kindCompany" | "org.kindDept", IconName][] = [
  ["company", "org.kindCompany", "building"],
  ["dept", "org.kindDept", "users"],
];

export function OrgAddForm({ rows, preset, onSubmit, onClose }: OrgAddFormProps) {
  const { t } = useI18n();
  const editing = !!preset?.id;

  const [kind, setKind] = useState<Kind>(
    preset ? (preset.level === 0 ? "company" : "dept") : "company",
  );
  const [name, setName] = useState(preset?.name ?? "");
  const [code, setCode] = useState(preset?.code ?? "");
  const parentDefault = preset?.parent_id ?? rows.find((r) => !editing || r.id !== preset?.id)?.id ?? "";
  const [parent, setParent] = useState(parentDefault);
  const [head, setHead] = useState("");
  const [taxId, setTaxId] = useState("");
  const [count, setCount] = useState("");
  const [err, setErr] = useState<{ name?: string; code?: string; parent?: string; taxId?: string }>({});

  const isCompany = kind === "company";
  // Parents for the dropdown exclude the node being edited (no self-parent).
  const parents = rows.filter((r) => !editing || r.id !== preset?.id);
  const takenCodes = new Set(rows.map((r) => r.code.toUpperCase()));

  // Note builders — verbatim composition of master.jsx:51/56 via i18n keys.
  const withCount = (base: string): string =>
    count.trim() ? `${base} · ${count.trim()} ${t("org.noteCountUnit")}` : base;
  const companyNote = (): string => {
    let n = t("org.noteSubCompany");
    if (taxId.trim()) n += ` · ${t("company.taxLabel")} ${taxId.trim()}`;
    return withCount(n);
  };
  const headNote = (): string => withCount(`${t("org.noteHeadPrefix")} ${head.trim()}`);
  const newUnitNote = (): string => withCount(t("org.noteNewUnit"));

  const submit = () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = t("org.errNameReq");
    if (!code.trim()) e.code = t("org.errCodeReq");
    else if (!editing && takenCodes.has(code.trim().toUpperCase())) e.code = t("org.errCodeDup");
    if (!isCompany && !parent) e.parent = t("org.errParentReq");
    if (isCompany && taxId && !/^\d{10,13}$/.test(taxId.replace(/\D/g, ""))) e.taxId = t("org.errTaxInvalid");
    setErr(e);
    if (Object.keys(e).length) return;

    const body: Record<string, unknown> = { name: name.trim(), code: code.trim().toUpperCase() };
    if (!editing) body.kind = isCompany ? "company" : "dept";
    if (isCompany) {
      if (!editing) {
        body.note = companyNote();
        if (taxId.trim()) body.tax_id = taxId.trim();
      }
    } else {
      body.parent_id = parent;
      // head present -> recompose; else keep current (edit, partial-merge omit) or
      // fall to preset.note (add-sub: undefined) / newUnitNote (fresh add).
      const note = head.trim()
        ? headNote()
        : editing
          ? undefined
          : preset
            ? preset.note
            : newUnitNote();
      if (typeof note === "string") body.note = note;
    }
    onSubmit(body as Entity, editing ? (preset ?? null) : null);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          opacity: editing ? 0.55 : 1,
          pointerEvents: editing ? "none" : "auto",
        }}
      >
        {KIND_TABS.map(([v, labelKey, ic]) => (
          <button
            key={v}
            type="button"
            onClick={() => setKind(v)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 40,
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              border: `1px solid ${kind === v ? "var(--brand)" : "var(--border)"}`,
              background: kind === v ? "var(--brand-soft)" : "var(--surface)",
              color: kind === v ? "var(--brand)" : "var(--text-2)",
              fontFamily: "inherit",
            }}
          >
            <Icon name={ic} size={15} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field
          label={isCompany ? t("org.fieldNameCompany") : t("org.fieldNameDept")}
          required
          style={{ gridColumn: "span 2" }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCompany ? t("org.phNameCompany") : t("org.phNameDept")}
            style={fieldStyle(!!err.name)}
          />
          {err.name && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.name}</div>}
        </Field>

        <Field label={t("org.fieldCode")} required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={isCompany ? t("org.phCodeCompany") : t("org.phCodeDept")}
            className="num"
            style={{ ...fieldStyle(!!err.code), textTransform: "uppercase" }}
          />
          {err.code && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.code}</div>}
        </Field>

        {isCompany ? (
          <Field label={t("org.fieldTaxId")}>
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="0107565000123"
              className="num"
              style={fieldStyle(!!err.taxId)}
            />
            {err.taxId && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.taxId}</div>}
          </Field>
        ) : (
          <Field label={t("org.fieldParent")} required>
            <select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              style={fieldStyle(!!err.parent)}
            >
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${"— ".repeat(p.level)}${p.name}`}
                </option>
              ))}
            </select>
            {err.parent && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{err.parent}</div>}
          </Field>
        )}

        <Field label={isCompany ? t("org.fieldEmpCount") : t("org.fieldHead")}>
          {isCompany ? (
            <input
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="num"
              style={fieldStyle(false)}
            />
          ) : (
            <input
              value={head}
              onChange={(e) => setHead(e.target.value)}
              placeholder={t("org.phHead")}
              style={fieldStyle(false)}
            />
          )}
        </Field>

        {!isCompany && (
          <Field label={t("org.fieldCount")}>
            <input
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="num"
              style={fieldStyle(false)}
            />
          </Field>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {editing ? t("org.saveEditBtn") : isCompany ? t("org.addCompanyBtn") : t("org.addDeptBtn")}
        </Btn>
      </div>
    </div>
  );
}
