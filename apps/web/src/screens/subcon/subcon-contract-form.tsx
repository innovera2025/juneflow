/*
 * SubconContractForm — the "create subcon contract / WO" modal body, opened by
 * SubconContracts via ctx.openModal (size "lg"). Ported from
 * pototype/subcon-accept.jsx SubcContractForm (L123-166) + openSubcContractForm
 * (L116-122).
 *
 * Design fidelity (PLAN.md §0 rule 1): the 1fr/1fr subcontractor + contract-value
 * row, the 3-column method picker (4 basis buttons — percent / distance / unit /
 * milestone), the conditional distance section (unit / total-qty / per-period /
 * rate + the auto-split calc hint), the retention input, and the cancel/create
 * footer are the prototype's, verbatim. Every user-visible string is a subcon.* /
 * common.* dict key (t); tokens back every colour (rule 6). The method-button
 * `white` and the calc baht sign are prototype-verbatim (B-037(a)); the baht
 * glyph itself lives only inside the subcon.distanceCalcHint dict value.
 *
 * Data (rule 3): the subcontractor options come from GET /vendors; the create
 * anchors on the active project (project_id, resolveActiveProject) — POST
 * /subcon-contracts (use-subcon.ts). The prototype's SUBC_METHOD / mock defaults
 * are dropped; the inputs start empty (no fabricated seed).
 *
 * WIRE GAP / DIVERGENCE (reported honestly): the CORE create persists only
 * project_id, vendor_id, no, value, retention_pct, currency_code (subcon.ts
 * contractWire). The method picker + the whole distance section (unit / qty /
 * per-period / rate + the "split into N periods" hint) are Wave-2 autosplit —
 * they do NOT persist here; they are shown for fidelity and are purely
 * presentational (the created contract carries no periods). The auto-split calc
 * hint's baht sign lives inside the subcon.distanceCalcHint dict value, not this
 * source, so no literal currency glyph sits here. POST /subcon-contracts REQUIRES a
 * non-empty `no`, but the prototype form has no doc-number field, so the next
 * running WO number is generated (nextContractNo) — a divergence forced by the wire,
 * never a user-visible field.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { useCreateSubconContract } from "./use-subcon";
import { toVendorRef, vendorNameById, formatMoney, nextContractNo } from "./subcon-rows";

/** Period-basis method (subcon-accept.jsx SUBC_METHOD): label key + icon + tone. */
type MethodKey = "percent" | "distance" | "unit" | "milestone";
const METHODS: readonly { key: MethodKey; labelKey: DictKey; icon: IconName; tone: string }[] = [
  { key: "percent", labelKey: "subcon.methodPercent", icon: "trend", tone: "var(--brand)" },
  { key: "distance", labelKey: "subcon.methodDistance", icon: "ruler", tone: "var(--ok)" },
  { key: "unit", labelKey: "subcon.methodUnit", icon: "building", tone: "var(--info)" },
  { key: "milestone", labelKey: "subcon.methodMilestone", icon: "flag", tone: "var(--warn)" },
];

/** Distance-section unit options (subcon-accept.jsx L151): value id -> label key. */
type UnitKey = "meter" | "sqm" | "cbm" | "tree" | "point";
const UNIT_OPTIONS: readonly { key: UnitKey; labelKey: DictKey }[] = [
  { key: "meter", labelKey: "subcon.unitMeter" },
  { key: "sqm", labelKey: "subcon.unitSqm" },
  { key: "cbm", labelKey: "subcon.unitCbm" },
  { key: "tree", labelKey: "subcon.unitTree" },
  { key: "point", labelKey: "subcon.unitPoint" },
];

/** Input style, ported from SubcContractForm.fld (subcon-accept.jsx:129). */
function fieldStyle(): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
    color: "var(--text)",
  };
}

/** Parse a grouped/decimal money input ("2,150,000") to a finite number (0 fallback). */
function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Parse a digits-only field to a non-negative integer (0 fallback). */
function parseInt0(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface SubconContractFormProps {
  onClose: () => void;
  /** Existing contract numbers (the wire-forced next-no is drawn from these). */
  existingNos: readonly string[];
}

export function SubconContractForm({ onClose, existingNos }: SubconContractFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const vendorQ = useVendorList();
  const projectsQ = useProjects();
  const createContract = useCreateSubconContract();

  const vendors = useMemo(() => (vendorQ.data ?? []).map(toVendorRef), [vendorQ.data]);
  const vendorNames = useMemo(() => vendorNameById(vendors), [vendors]);

  // The create anchors on the active project (subcon.ts 400s without project_id).
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);

  const [vendorId, setVendorId] = useState("");
  const [value, setValue] = useState("");
  const [retentionPct, setRetentionPct] = useState("");
  const [method, setMethod] = useState<MethodKey>("percent");
  const [unit, setUnit] = useState<UnitKey>("meter");
  const [totalQty, setTotalQty] = useState("");
  const [perPeriod, setPerPeriod] = useState("");
  const [rate, setRate] = useState("");

  const effectiveVendorId = vendorId || vendors[0]?.id || "";
  const unitLabel = t(UNIT_OPTIONS.find((u) => u.key === unit)!.labelKey);
  const methodLabel = t(METHODS.find((m) => m.key === method)!.labelKey);

  // Distance auto-split preview (presentational — subcon-accept.jsx:130/156).
  const nPeriods = method === "distance" ? Math.ceil(parseInt0(totalQty) / (parseInt0(perPeriod) || 1)) : 0;

  const canSubmit = !!active && !!effectiveVendorId && !createContract.isPending;

  const submit = () => {
    if (!active || !effectiveVendorId) return;
    const retention = Number.parseFloat(retentionPct);
    createContract.mutate(
      {
        project_id: active.id,
        vendor_id: effectiveVendorId,
        no: nextContractNo(existingNos),
        value: parseAmount(value),
        retention_pct: Number.isFinite(retention) && retention >= 0 ? retention : 0,
        currency_code: "THB",
      },
      {
        onSuccess: () => {
          onClose();
          ctx.notify(t("subcon.toastCreated").replace("{name}", methodLabel));
        },
      },
    );
  };

  return (
    <div>
      {/* subcontractor + contract value */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("subcon.subcontractor")}>
          <select value={effectiveVendorId} onChange={(e) => setVendorId(e.target.value)} style={fieldStyle()}>
            {vendors.length === 0 && <option value="">{"—"}</option>}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {vendorNames.get(v.id)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("subcon.fieldContractValue")}>
          <input
            className="num"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            style={fieldStyle()}
          />
        </Field>
      </div>

      {/* method picker (presentational — the basis autosplit is Wave-2) */}
      <Field label={t("subcon.fieldMethod")} style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {METHODS.map((m) => {
            const on = method === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                  padding: "11px 12px",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "start",
                  border: `1.5px solid ${on ? m.tone : "var(--border)"}`,
                  background: on ? `color-mix(in srgb, ${m.tone} 8%, white)` : "var(--surface)",
                }}
              >
                <Icon name={m.icon} size={17} color={m.tone} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>{t(m.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* distance section (presentational — Wave-2 autosplit, does NOT persist) */}
      {method === "distance" && (
        <div style={{ padding: 14, background: "var(--ok-soft)", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ok)", marginBottom: 10 }}>
            {t("subcon.distanceSectionTitle")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <Field label={t("subcon.fieldUnit")}>
              <select value={unit} onChange={(e) => setUnit(e.target.value as UnitKey)} style={fieldStyle()}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {t(u.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("subcon.fieldTotalQty")}>
              <input
                className="num"
                value={totalQty}
                onChange={(e) => setTotalQty(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                style={fieldStyle()}
              />
            </Field>
            <Field label={t("subcon.fieldPerPeriod").replace("{unit}", unitLabel)}>
              <input
                className="num"
                value={perPeriod}
                onChange={(e) => setPerPeriod(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                style={fieldStyle()}
              />
            </Field>
            <Field label={t("subcon.fieldRatePerUnit").replace("{unit}", unitLabel)}>
              <input
                className="num"
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                style={fieldStyle()}
              />
            </Field>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)" }}>
            {t("subcon.distanceCalcHint")
              .replace("{n}", String(nPeriods))
              .replace("{value}", formatMoney(parseInt0(perPeriod) * parseInt0(rate)))
              .replace("{qty}", perPeriod || "0")
              .replace("{unit}", unitLabel)}
          </div>
        </div>
      )}

      {/* retention (real body field) */}
      <Field label={t("subcon.fieldRetention")}>
        <input
          className="num"
          value={retentionPct}
          onChange={(e) => setRetentionPct(e.target.value)}
          inputMode="numeric"
          style={{ ...fieldStyle(), width: 100 }}
        />
      </Field>

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
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("subcon.createBtn")}
        </Btn>
      </div>
    </div>
  );
}
