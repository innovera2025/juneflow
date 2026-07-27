/*
 * NewBOQForm — the "create new BOQ" modal body, ported 1:1 from pototype/boq-list.jsx
 * NewBOQForm (L226-386) + the inline Excel dropzone (ExcelImportInline L389-454). Opened by
 * BOQList via ctx.openModal (size "xl").
 *
 * Design fidelity (PLAN.md §0 rule 1): every section — the id row (no · name), the 4-column
 * scope cascade (project / phase / block / unit-model), the create-level segmented toggle,
 * the 2×2 start-from template radio, the per-template options, the 3+2 meta grid
 * (currency / start-date / owner · approver / note), and the cancel/create footer — is the
 * prototype's, verbatim. Every user-visible string is a boq.list* / common.* dict key (t),
 * a boq-strings.json phrase (tp: cascade hints, scope words, dup error), or the "BOQ List"
 * nav label — no Thai literal sits in this source (rule 2). Tokens back every colour (rule
 * 6); #fff on the active level segment is prototype-verbatim (B-037(a)).
 *
 * Mock mechanics dropped (rule 3): the prototype's BOQStore.add + the hardcoded
 * BOQ_PROJECTS cascade / BOQ_USERS list / per-template fake `value` become real data —
 *   POST /boq (use-boq.ts)              = create the draft (server owns status/version),
 *   GET /projects                       = the project selector (-> project_id),
 *   GET /projects/{id}/hierarchy        = the phase/block/unit cascade options (by kind),
 *   GET /users                          = the owner/approver selectors (display-only),
 *   GET /models                         = the BOM-template model selector (display-only).
 * The body sent to POST /boq is only { no, name, scope, project_id }: level/template/
 * currency/start-date/owner/approver/note do not persist on a BOQ doc (they are the
 * prototype's local-state decoration), and the per-template item population (BOM formula /
 * copy / Excel rows) belongs to the BOQ editor's POST /boq/{id}/items, not to create.
 *
 * Excel import is a STUB (flagged): there is no multipart import route on the backend, so
 * the dropzone's "select file" marks the form ready and shows the matched-file bar, but the
 * mock preview table (Thai sample rows) is intentionally NOT reproduced and no rows are
 * imported — a "excel" create yields an empty draft exactly like "scratch". The real import
 * lands with the editor's bulk-add path.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useProjectHierarchy, useModels } from "../master/use-project-hierarchy";
import { useUserList } from "../master/use-users";
import { useCreateBoq } from "./use-boq";
import { hierarchyNames, composeScope, nextBoqNo } from "./boq-rows";
import boqStrings from "./boq-strings.json" with { type: "json" };

const P = (k: keyof typeof boqStrings) => boqStrings[k] as PhraseKey;

/** Input style, ported verbatim from NewBOQForm.fld (boq-list.jsx:294). */
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

/** Inline field-error style (boq-list.jsx:302). */
const errStyle: CSSProperties = { fontSize: 11, color: "var(--danger)", marginTop: 4 };

/** Section eyebrow style (boq-list.jsx:311/331). */
const eyebrow: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--text-3)",
  marginBottom: 8,
};

export interface NewBOQFormProps {
  onClose: () => void;
  /** Preset start-from template (boq-list.jsx openNewBOQ presetTemplate); "excel" for import. */
  presetTemplate?: string;
  /** BOQ codes already taken (client next-no suggestion + dup pre-check). */
  existingNos: readonly string[];
  /** Existing docs for the "copy from" selector (display-only): { no, name }. */
  existingDocs: readonly { no: string; name: string }[];
}

export function NewBOQForm({ onClose, presetTemplate, existingNos, existingDocs }: NewBOQFormProps) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const usersQ = useUserList();
  const modelsQ = useModels();
  const createBoq = useCreateBoq();

  const projects = projectsQ.data ?? [];
  const [no, setNo] = useState(() => nextBoqNo(existingNos));
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(() => projects[0]?.id ?? "");
  const [phase, setPhase] = useState("");
  const [block, setBlock] = useState("");
  const allUnitsLabel = tp(P("scopeAll"));
  const [unit, setUnit] = useState(allUnitsLabel);
  const [level, setLevel] = useState(presetTemplate === "excel" ? "byblock" : "byblock");
  const [template, setTemplate] = useState(presetTemplate || "scratch");
  const [bomModel, setBomModel] = useState("");
  const [copyFrom, setCopyFrom] = useState(existingDocs[0]?.no ?? "");
  const [currency, setCurrency] = useState("THB");
  const [startDate, setStartDate] = useState("");
  const [owner, setOwner] = useState("");
  const [approver, setApprover] = useState("");
  const [note, setNote] = useState("");
  const [excelReady, setExcelReady] = useState(false);
  const [err, setErr] = useState<{ no?: string; name?: string; excel?: string }>({});

  // First project resolves after the query settles — seed the selector once.
  const effectiveProjectId = projectId || projects[0]?.id || "";

  const hierarchyQ = useProjectHierarchy(effectiveProjectId || undefined);
  const nodes = hierarchyQ.data ?? [];
  const phaseOpts = useMemo(() => hierarchyNames(nodes, "phase"), [nodes]);
  const blockOpts = useMemo(() => hierarchyNames(nodes, "block"), [nodes]);
  const unitOpts = useMemo(() => hierarchyNames(nodes, "unit"), [nodes]);

  const userNames = useMemo(
    () => (usersQ.data ?? []).map((u) => (typeof u.name === "string" ? u.name : "")).filter(Boolean),
    [usersQ.data],
  );
  const models = modelsQ.data ?? [];
  const takenNos = new Set(existingNos);

  const TEMPLATES: readonly {
    v: string;
    label: string;
    desc: string;
    icon: "grid" | "copy" | "plus" | "upload";
  }[] = [
    { v: "bom", label: t("boq.listTplBom"), desc: t("boq.listTplBomD"), icon: "grid" },
    { v: "copy", label: t("boq.listTplCopy"), desc: t("boq.listTplCopyD"), icon: "copy" },
    { v: "scratch", label: t("boq.listTplScratch"), desc: t("boq.listTplScratchD"), icon: "plus" },
    { v: "excel", label: tp(P("excelTpl")), desc: t("boq.listTplExcelD"), icon: "upload" },
  ];

  const LEVELS: readonly { id: string; label: string }[] = [
    { id: "bom", label: t("boq.listLevelBomFormula") },
    { id: "byunit", label: t("boq.listLevelByUnit") },
    { id: "byblock", label: t("boq.listLevelByBlock") },
  ];

  const setProjectCascade = (v: string) => {
    setProjectId(v);
    setPhase("");
    setBlock("");
    setUnit(allUnitsLabel);
  };

  const submit = () => {
    // Validation, adapted from boq-list.jsx:271-278 (boq.listErr* keys). The dup check is a
    // client UX pre-check; the server's 409 DUPLICATE_CODE is authoritative.
    const e: typeof err = {};
    const noT = no.trim();
    if (!noT) e.no = t("boq.listErrCode");
    else if (takenNos.has(noT)) e.no = tp(P("errCodeDup"));
    if (!name.trim()) e.name = t("boq.listErrName");
    if (template === "excel" && !excelReady) e.excel = t("boq.listErrExcel");
    setErr(e);
    if (Object.keys(e).length) return;
    if (!effectiveProjectId) return; // guarded by the disabled submit; keeps project_id present

    const scope = composeScope(block, unit, allUnitsLabel, tp(P("scopeTotalSuffix")));

    createBoq.mutate(
      { no: noT, name: name.trim(), scope, project_id: effectiveProjectId },
      {
        onSuccess: () => {
          ctx.notify(t("boq.listCreateToast").replace("{no}", noT));
          onClose();
          // Prototype opens the editor on create (boq-list.jsx:291). boq.editor is a route
          // (renders the shell Placeholder until its screen lands).
          ctx.navigate("boq.editor", { no: noT, name: name.trim(), scope, status: "draft" });
        },
        onError: () => setErr({ no: tp(P("errCodeDup")) }),
      },
    );
  };

  const canSubmit = !!effectiveProjectId && !createBoq.isPending;

  return (
    <div>
      {/* identity */}
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14, marginBottom: 16 }}>
        <Field label={t("boq.listThCodeBoq")} required>
          <input value={no} onChange={(e) => setNo(e.target.value)} className="num" style={fieldStyle(!!err.no)} />
          {err.no && <div style={errStyle}>{err.no}</div>}
        </Field>
        <Field label={t("boq.listThNameBoq")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("boq.listNameBoqPh")}
            style={fieldStyle(!!err.name)}
          />
          {err.name && <div style={errStyle}>{err.name}</div>}
        </Field>
      </div>

      {/* scope cascade */}
      <div style={eyebrow}>{t("boq.listScopeSection")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Field label={tp(P("hintProject"))}>
          <select value={effectiveProjectId} onChange={(e) => setProjectCascade(e.target.value)} style={fieldStyle(false)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("hintPhase"))}>
          <select value={phase} onChange={(e) => setPhase(e.target.value)} style={fieldStyle(false)}>
            <option value="">{tp(P("allPhases"))}</option>
            {phaseOpts.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("blockField"))}>
          <select value={block} onChange={(e) => setBlock(e.target.value)} style={fieldStyle(false)}>
            <option value="">—</option>
            {blockOpts.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("boq.listFldUnitModel")}>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle(false)}>
            <option value={allUnitsLabel}>{allUnitsLabel}</option>
            {unitOpts.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* create level */}
      <div style={{ marginBottom: 16 }}>
        <Field label={t("boq.listFldLevel")}>
          <div
            style={{
              display: "inline-flex",
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: 3,
              background: "var(--surface)",
            }}
          >
            {LEVELS.map((lv) => {
              const on = level === lv.id;
              return (
                <button
                  key={lv.id}
                  type="button"
                  onClick={() => setLevel(lv.id)}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    background: on ? "var(--brand)" : "transparent",
                    color: on ? "#fff" : "var(--text-2)",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {lv.label}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      {/* start-from template radio */}
      <div style={eyebrow}>{t("boq.listStartFrom")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
        {TEMPLATES.map((tpl) => {
          const on = template === tpl.v;
          return (
            <div
              key={tpl.v}
              onClick={() => setTemplate(tpl.v)}
              style={{
                display: "flex",
                gap: 11,
                padding: "12px 14px",
                border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                background: on ? "var(--brand-soft)" : "var(--surface)",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  border: `2px solid ${on ? "var(--brand)" : "var(--border-strong)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)" }} />}
              </span>
              <div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: on ? "var(--brand)" : "var(--text)",
                  }}
                >
                  <Icon name={tpl.icon} size={14} /> {tpl.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, lineHeight: 1.4 }}>{tpl.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* template-specific options (display-only — item population is the editor's job) */}
      {template === "bom" && (
        <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 14 }}>
          <Field label={t("boq.listSelectBomModel")}>
            <select value={bomModel} onChange={(e) => setBomModel(e.target.value)} style={fieldStyle(false)}>
              <option value="">—</option>
              {models.map((m) => {
                const code = typeof m.code === "string" ? m.code : "";
                const type = typeof m.type === "string" ? m.type : "";
                return (
                  <option key={code} value={code}>
                    {code}
                    {type ? ` · ${type}` : ""}
                  </option>
                );
              })}
            </select>
          </Field>
        </div>
      )}
      {template === "copy" && (
        <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 14 }}>
          <Field label={t("boq.listCopyFromBoq")}>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={fieldStyle(false)}>
              {existingDocs.map((d) => (
                <option key={d.no} value={d.no}>
                  {d.no} · {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {template === "excel" && (
        <div style={{ marginBottom: 14 }}>
          {!excelReady ? (
            <div
              style={{
                border: "1.5px dashed var(--border-strong)",
                borderRadius: 10,
                padding: "26px 20px",
                textAlign: "center",
                background: "var(--surface-2)",
              }}
            >
              <Icon name="upload" size={28} color="var(--brand)" style={{ opacity: 0.8 }} />
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10 }}>{t("boq.listExcDropText")}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{t("boq.listExcSupport")}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{t("boq.listExcSkipRows")}</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                <Btn
                  kind="outline"
                  size="sm"
                  icon="download"
                  onClick={() =>
                    ctx.notify(t("boq.listDownloadToast").replace("{file}", "Template_BOM_And_BOQ.xlsx"))
                  }
                >
                  {t("boq.listExcDownloadTpl")}
                </Btn>
                {/* STUB: no multipart import route — marks the form ready without parsing a file. */}
                <Btn kind="primary" size="sm" icon="upload" onClick={() => setExcelReady(true)}>
                  {t("boq.listExcPickSample")}
                </Btn>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: "10px 14px",
                background: "var(--ok-soft)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="check" size={15} color="var(--ok)" />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
                Template_BOM_And_BOQ (M2-RM).xlsx
              </span>
              <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {t("boq.listExcMatched").replace("{group}", "GB202114")}
              </span>
              <button
                type="button"
                onClick={() => setExcelReady(false)}
                style={{
                  marginInlineStart: "auto",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-3)",
                  fontSize: 11.5,
                  textDecoration: "underline",
                }}
              >
                {t("boq.listExcChangeFile")}
              </button>
            </div>
          )}
          {err.excel && <div style={{ ...errStyle, marginTop: 6 }}>{err.excel}</div>}
        </div>
      )}

      {/* meta */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        <Field label={t("boq.listFldCurrency")}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={fieldStyle(false)}>
            <option value="THB">{t("boq.listCurBaht")}</option>
            <option value="USD">{t("boq.listCurUsd")}</option>
          </select>
        </Field>
        <Field label={t("boq.listFldStartDate")}>
          <input value={startDate} onChange={(e) => setStartDate(e.target.value)} style={fieldStyle(false)} />
        </Field>
        <Field label={t("boq.listFldOwnerUnit")}>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} style={fieldStyle(false)}>
            <option value="">—</option>
            {userNames.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Field label={t("boq.listFldApprover")}>
          <select value={approver} onChange={(e) => setApprover(e.target.value)} style={fieldStyle(false)}>
            <option value="">—</option>
            {userNames.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tp(P("note"))}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("boq.listOptionalPh")}
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("boq.listSubmitCreate")}
        </Btn>
      </div>
    </div>
  );
}

/** Re-export the nav label key so BOQList's breadcrumb/title share one source. */
export const BOQ_LIST_NAV = boqStrings.navBoqList as NavKey;
