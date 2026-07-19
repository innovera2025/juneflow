/*
 * PMAssetForm — the "add asset to the PM registry" modal body, opened by PMAssets
 * via ctx.openModal (size "lg"). Ported from pototype/pm.jsx PMAssetForm
 * (L223-257): the code/name/kind/cycle/site/contract field grid + the cancel/submit
 * footer are the prototype's.
 *
 * Design fidelity (rule 1): the 140px/1fr code+name row, the kind+cycle row, and
 * the site+contract row match the prototype's three field grids; code + name keep
 * their required asterisks (pm.jsx `required`). Every string is a pm.* / common.*
 * dict key (t) — no Thai literal in source (rule 2); tokens back every colour.
 *
 * Data (rule 3): "add" runs the real POST /pm/assets (use-pm.ts) then invalidates
 * the asset list + toasts pm.toastAdded {id} + closes. The prototype's kind
 * <SelectOther> (pick a known kind OR type another) is reproduced with a native
 * <input list> + <datalist> of the distinct kinds — kind is a free-text column so
 * a typed value is valid; this uses the same pm.phKindOther placeholder and needs
 * no new i18n key.
 *
 * WIRE GAPS / DIVERGENCE (reported honestly) — POST /pm/assets (apps/api/src/routes/
 * pm.ts) accepts only { contract_id, kind, site, cycle, next_due } and REQUIRES
 * contract_id + kind:
 *   - CREATE IS PARTIALLY WAVE-2-BLOCKED: the contract picker source /pm/contracts
 *     is Wave-2 GATED (404), so this form CANNOT offer a contract browser — the
 *     contract id is entered as raw text (pm.phContract) and a foreign/absent id
 *     resolves to 404. contract_id is NEVER fabricated. Because the wire requires
 *     it, the submit guards contract_id + kind (red border when blank) on top of
 *     the prototype's code/name guard.
 *   - code (pm.fieldCode) + name (pm.colName): pm_asset has NO id-code column (id is
 *     server-generated) and NO name column (backend gap). They are shown with the
 *     prototype's required asterisks for fidelity but are NOT sent / do NOT persist.
 *   - next_due is not collected (the prototype has no such field) — omitted.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useCreatePmAsset } from "./use-pm";

/** Input style (pm.jsx PMAssetForm fld()) — token-backed; red border when invalid. */
function fieldStyle(bad?: boolean): CSSProperties {
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
    color: "var(--text)",
  };
}

/** The five PM cycle option keys (pm.jsx cycle Dropdown, L245). */
const CYCLE_KEYS = [
  "pm.cycleMonthly",
  "pm.cycle3Month",
  "pm.cycle6Month",
  "pm.cycleYearly",
  "pm.cycleByHours",
] as const;

/** datalist id for the kind combobox. */
const KIND_LIST_ID = "pm-asset-kinds";

interface FormErr {
  id?: boolean;
  name?: boolean;
  contract?: boolean;
  kind?: boolean;
}

export interface PMAssetFormProps {
  /** Distinct kinds present in the registry (seed the kind combobox datalist). */
  kinds: readonly string[];
  onClose: () => void;
}

export function PMAssetForm({ kinds, onClose }: PMAssetFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const createAsset = useCreatePmAsset();

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [cycle, setCycle] = useState(t(CYCLE_KEYS[0]));
  const [site, setSite] = useState("");
  const [contract, setContract] = useState("");
  const [err, setErr] = useState<FormErr>({});

  const busy = createAsset.isPending;

  const save = () => {
    // Prototype guard (code + name required) — visual/interaction fidelity — plus
    // the wire's real requirements (contract_id + kind) since the create is
    // partially Wave-2-blocked (no contract picker).
    const e: FormErr = {};
    if (!id.trim()) e.id = true;
    if (!name.trim()) e.name = true;
    if (!contract.trim()) e.contract = true;
    if (!kind.trim()) e.kind = true;
    setErr(e);
    if (Object.keys(e).length > 0) return;

    createAsset.mutate(
      {
        contract_id: contract.trim(),
        kind: kind.trim(),
        ...(site.trim() ? { site: site.trim() } : {}),
        cycle,
      },
      {
        onSuccess: (created) => {
          const c = created as Record<string, unknown>;
          const newId = typeof c.id === "string" && c.id ? c.id : id.trim();
          onClose();
          ctx.notify(t("pm.toastAdded").replace("{id}", newId));
        },
      },
    );
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginBottom: 12 }}>
        <Field label={t("pm.fieldCode")} required>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={t("pm.phCode")}
            className="num"
            style={fieldStyle(err.id)}
          />
        </Field>
        <Field label={t("pm.colName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("pm.phName")}
            style={fieldStyle(err.name)}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label={t("pm.colKind")}>
          <input
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder={t("pm.phKindOther")}
            list={KIND_LIST_ID}
            style={fieldStyle(err.kind)}
          />
          <datalist id={KIND_LIST_ID}>
            {kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </Field>
        <Field label={t("pm.colCycle")}>
          <select value={cycle} onChange={(e) => setCycle(e.target.value)} style={fieldStyle(false)}>
            {CYCLE_KEYS.map((k) => (
              <option key={k} value={t(k)}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("pm.colSite")}>
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder={t("pm.phSite")}
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("pm.fieldContract")}>
          <input
            value={contract}
            onChange={(e) => setContract(e.target.value)}
            placeholder={t("pm.phContract")}
            className="num"
            style={fieldStyle(err.contract)}
          />
        </Field>
      </div>

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
        <Btn kind="primary" size="md" icon="check" onClick={save} disabled={busy}>
          {t("pm.addAssetBtn")}
        </Btn>
      </div>
    </div>
  );
}
