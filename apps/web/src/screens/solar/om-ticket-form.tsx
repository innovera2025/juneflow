/*
 * RF2OMForm — the open-O&M-ticket create modal body, ported 1:1 from
 * pototype/real-forms2.jsx RF2OMForm (L258-286). Opened by SolarMonitoring via ctx.openModal
 * (real-forms2.jsx openOMTicketForm L251-256); the screen owns the POST /solar/om-tickets
 * mutation (the modal unmounts on submit, so the toast fires off the settled promise —
 * fireWithToast — in the screen).
 *
 * Design fidelity (PLAN.md §0 rule 1): the asset dropdown, the two-up priority + team
 * dropdowns, the required symptom textarea, and the cancel/submit footer are the prototype's,
 * verbatim. The prototype's ds.jsx <Dropdown> popover is a shared primitive not ported — each
 * picker uses a native <select> styled by tokens (permit-form / warranty-form precedent).
 *
 * Data (rules 3/4): the prototype's 5 mock asset options are DROPPED (§0 rule 3); the asset
 * dropdown sources the REAL inverter register (GET /solar/inverters), option value = the
 * inverter's id (the FK the door checks in-tenant), label = the same "<id> · <zone>" string
 * the read table + view modal show (omAssetLabel; the wire has no human inverter code, so the
 * id IS the identifier — established divergence). priority + team are stored as their t()-
 * resolved display labels (the backend columns are free text; the read screen renders the
 * stored string as-is — the same "store the display label" pattern permit-form used for org),
 * so the draft emits the resolved label, not a raw option code. money = NONE (no client money,
 * no JV, no client-derived date); NO assignee (the prototype form has no assignee field).
 *
 * i18n (rule 2): every visible string is an existing dict key (t) — consume-only, no key
 * minted; the priority/team labels resolve at runtime so NO Thai literal lives in source
 * (B-073). The 4th team option borrows land.surveyForm.surveyorExternal (the external-
 * contractor label; the O&M-team keys hold the first three). Tokens back every colour (rule 6).
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { toInverterRow, omAssetLabel, type InverterRow } from "./solar-monitor-rows";
import { useSolarInverters } from "./use-solar";

/** The values the form emits; SolarMonitoring composes the opaque POST /solar/om-tickets body. */
export interface OmTicketDraft {
  /** Selected inverter's id → POST inverter_id (the real in-tenant FK) + toast {asset} (the code). */
  inverterId: string;
  /** t()-resolved priority display label → POST priority (free text) + toast {pri}. */
  priority: string;
  /** t()-resolved team display label → POST team (free text) + toast {team}. */
  team: string;
  /** Symptom / work text → POST title (the only required field). */
  desc: string;
}

export interface OmTicketFormProps {
  onSubmit: (draft: OmTicketDraft) => void;
  onClose: () => void;
}

/** Priority options (real-forms2.jsx L274): a stable code + its display-label key. */
const PRIORITY_OPTIONS: readonly { code: string; labelKey: DictKey }[] = [
  { code: "urgent", labelKey: "solar.monitor.omPriUrgent" },
  { code: "high", labelKey: "solar.monitor.omPriHigh" },
  { code: "normal", labelKey: "solar.monitor.omPriNormal" },
];

/** Team options (real-forms2.jsx L275): the three O&M-team keys + the borrowed external label. */
const TEAM_OPTIONS: readonly { code: string; labelKey: DictKey }[] = [
  { code: "oma", labelKey: "solar.monitor.omTeamOmA" },
  { code: "omb", labelKey: "solar.monitor.omTeamOmB" },
  { code: "cleaning", labelKey: "solar.monitor.omTeamCleaning" },
  { code: "external", labelKey: "land.surveyForm.surveyorExternal" },
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

export function RF2OMForm({ onSubmit, onClose }: OmTicketFormProps) {
  const { t } = useI18n();

  // Asset source (real-forms2.jsx L259 mock array dropped, §0 rule 3): the real inverter
  // register. Shared React Query cache — the screen has already fetched it, so it is present.
  const invertersQ = useSolarInverters();
  const inverters = useMemo<InverterRow[]>(
    () => (invertersQ.data ?? []).map(toInverterRow),
    [invertersQ.data],
  );

  // Defaults (real-forms2.jsx L259-262): asset = the first inverter (set once the list loads),
  // priority = urgent (first), team = O&M A (first), blank symptom.
  const [asset, setAsset] = useState("");
  const [pri, setPri] = useState("urgent");
  const [team, setTeam] = useState("oma");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState(false);

  // Seed the asset default from the first inverter once the register is available; never
  // overrides a user's pick (the prototype opens with a default asset selected).
  useEffect(() => {
    if (!asset && inverters.length > 0) setAsset(inverters[0]!.id);
  }, [asset, inverters]);

  // Validation verbatim real-forms2.jsx L265: the symptom is the only required field. Emit the
  // resolved priority/team display labels (locale-stable free-text) + the selected inverter id.
  const submit = () => {
    if (!desc.trim()) {
      setErr(true);
      return;
    }
    const priOpt = PRIORITY_OPTIONS.find((o) => o.code === pri) ?? PRIORITY_OPTIONS[0]!;
    const teamOpt = TEAM_OPTIONS.find((o) => o.code === team) ?? TEAM_OPTIONS[0]!;
    onSubmit({
      inverterId: asset,
      priority: t(priOpt.labelKey),
      team: t(teamOpt.labelKey),
      desc: desc.trim(),
    });
  };

  return (
    <div>
      {/* Asset (real-forms2.jsx L270-272). Options from the live inverter register. */}
      <Field label={t("pm.fieldAsset")} style={{ marginBottom: 12 }}>
        <select value={asset} onChange={(e) => setAsset(e.target.value)} style={fieldStyle(false)}>
          {inverters.map((iv) => (
            <option key={iv.id} value={iv.id}>
              {omAssetLabel(iv.id, inverters)}
            </option>
          ))}
        </select>
      </Field>

      {/* Priority + team (real-forms2.jsx L273-276). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label={t("solar.monitor.omFieldPriority")}>
          <select value={pri} onChange={(e) => setPri(e.target.value)} style={fieldStyle(false)}>
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("solar.monitor.omFieldTeam")}>
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={fieldStyle(false)}>
            {TEAM_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Symptom / work text (real-forms2.jsx L277-279), required. */}
      <Field label={t("solar.monitor.omFieldDesc")} required>
        <textarea
          value={desc}
          onChange={(e) => {
            setDesc(e.target.value);
            setErr(false);
          }}
          placeholder={t("solar.monitor.omDescPlaceholder")}
          style={{ ...fieldStyle(err), height: 64, padding: 10, resize: "vertical" }}
        />
      </Field>

      {/* Footer (real-forms2.jsx L280-283). */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("solar.monitor.omSaveBtn")}
        </Btn>
      </div>
    </div>
  );
}
