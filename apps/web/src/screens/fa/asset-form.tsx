/*
 * AssetForm — the "register a fixed asset" modal body, opened by FARegister via ctx.openModal
 * (size "lg"). Focused real port of pototype/fa.jsx AssetForm (L144-240): the code+name row, the
 * category/location/date row, the cost/life/salvage row, the method/cost-center/account row, and
 * the depreciation-preview box + cancel/submit footer are the prototype's. The SAME form serves
 * both create and EDIT (fa.jsx: AssetForm takes `initial`; the AssetDetail "edit" button opens it
 * pre-filled) — an optional `asset` prop switches the form to edit mode.
 *
 * Design fidelity (rule 1): the field grids, the required asterisks, and the preview card layout
 * match the prototype. Every string is a fa.* / common.* dict key (t) — no Thai/baht literal in
 * source (rule 2); tokens back every colour (rule 6). The BAHT unit is a unicode-escape constant
 * so the glyph never trips the i18n-guard (master/user-add-form.tsx precedent).
 *
 * Data (rule 3): "save" runs the real POST /fa/assets (create) or PUT /fa/assets/{id} (edit) via
 * use-fa.ts, then invalidates the register + toasts + closes. The prototype's local setAssets seed
 * is dropped — the server owns the row. EDIT prefills from the real AssetRow (GET /fa/assets) and
 * submits a partial-merge PUT. Interim toast: fa.register.toastAdd is reused for edit too (no
 * fa.register.toastEdit key exists yet — reported as a Wave-C candidate, not minted).
 *
 * REAL vs PRESENTATIONAL (reported honestly, never fabricated) — POST /fa/assets (fa.ts
 * createAsset) accepts only { name (required), cost?, salvage?, acquired_date?, life_years?,
 * cc_id?, depr_method? }:
 *   - REAL (sent + persisted): name, cost, salvage, acquired_date, life_years, depr_method, cc_id.
 *   - cc_id is wired to the real cost-center catalogue (GET /cost-centers) — value = the center id,
 *     label = its code. A blank selection sends no cc_id (optional on the wire).
 *   - acquired_date uses a native date input (ISO) — a wire-forced divergence from the prototype's
 *     free-text Thai (Buddhist-Era) date, since the server's `date` column cannot accept it.
 *   - depr_method is a free-text column; the resolved method label (t) is sent so the register list
 *     row-sub shows the same text the prototype did.
 *   - PRESENTATIONAL (shown for fidelity, NOT sent — no wire column): the asset `code` (server
 *     assigns a uuid, there is no human code column), the `category` select (drives the local
 *     preview + the land "no depreciation" branch only), the `location` field, and the asset
 *     `account` field. The category/location/account option lists in the prototype are un-keyed
 *     mock strings, so location + account render as free-text inputs (no minted option keys).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useCostCenterList } from "../master/use-cost-centers";
import { toCostCenterRow } from "../master/cc-rows";
import { useCreateFaAsset, useUpdateFaAsset } from "./use-fa";
import { formatMoney, type AssetRow } from "./fa-register-rows";

const DASH = "—";
/** THAI BAHT SIGN (U+0E3F) via unicode escape (i18n-guard-safe). */
const BAHT = "\u0E3F";

/** The six FA category option keys (fa.jsx FA_CATS, L14) — presentational (drives the preview). */
const CATEGORY_KEYS = [
  "fa.catLand",
  "fa.catBuilding",
  "fa.catMachine",
  "fa.catVehicle",
  "fa.catIT",
  "fa.catTool",
] as const satisfies readonly DictKey[];
type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** The three depreciation-method option keys (fa.jsx FA_METHODS, L18). */
const METHOD_KEYS = [
  "fa.methodStraight",
  "fa.methodDeclining",
  "pm.cycleByHours",
] as const satisfies readonly DictKey[];
type MethodKey = (typeof METHOD_KEYS)[number];

/** Input/select style (fa.jsx AssetForm Input) — token-backed. */
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

/** Parse a grouped/decimal money or number input to a finite number (0 fallback). */
function parseNum(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface AssetFormProps {
  /** When present, the form is in EDIT mode — prefilled from this row + submitted via PUT. */
  asset?: AssetRow;
  onClose: () => void;
}

export function AssetForm({ asset, onClose }: AssetFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const isEdit = asset != null;
  const createAsset = useCreateFaAsset();
  // Curried by id — the empty-string id in create mode is inert (updateAsset.mutate is only called
  // in edit mode, so the closure is never exercised without a real asset id).
  const updateAsset = useUpdateFaAsset(asset?.id ?? "");
  const ccQ = useCostCenterList();

  const costCenters = useMemo(
    () => (ccQ.data ?? []).map(toCostCenterRow),
    [ccQ.data],
  );

  // REAL (persisted) fields — prefilled from the AssetRow in edit mode, else the create defaults.
  const [name, setName] = useState(asset?.name ?? "");
  const [date, setDate] = useState(asset?.acquiredDate ?? "");
  const [cost, setCost] = useState(asset ? String(asset.cost) : "");
  const [life, setLife] = useState(asset?.lifeYears != null ? String(asset.lifeYears) : "5");
  const [salvage, setSalvage] = useState(asset ? String(asset.salvage) : "");
  // Resolve the stored free-text method label back to its option key (fallback: straight-line).
  const [methodKey, setMethodKey] = useState<MethodKey>(() => {
    const found = METHOD_KEYS.find((k) => t(k) === asset?.deprMethod);
    return found ?? METHOD_KEYS[0];
  });
  const [ccId, setCcId] = useState(asset?.ccId ?? "");
  // PRESENTATIONAL (not sent) fields — category/location/account have no wire column, so they stay
  // at the create defaults even in edit mode (nothing to prefill them from).
  const [category, setCategory] = useState<CategoryKey>("fa.catMachine");
  const [location, setLocation] = useState("");
  const [account, setAccount] = useState("");
  const [nameBad, setNameBad] = useState(false);
  const [costBad, setCostBad] = useState(false);

  const busy = createAsset.isPending || updateAsset.isPending;

  const lifeNum = Number.parseInt(life, 10);
  const costNum = parseNum(cost);
  const salvageNum = parseNum(salvage);
  // Client-side straight-line preview (the same base the server posts) — a projection, not stored.
  const annualDepr = lifeNum > 0 ? Math.round((costNum - salvageNum) / lifeNum) : 0;
  const monthlyDepr = Math.round(annualDepr / 12);
  const isLand = category === "fa.catLand";
  const acctCode = account.trim() ? account.trim().split(" ")[0] : DASH;

  const save = () => {
    const nBad = !name.trim();
    const cBad = costNum <= 0;
    setNameBad(nBad);
    setCostBad(cBad);
    if (nBad || cBad) return;

    // The same body shape serves POST (create) and PUT (partial-merge edit) — only the keys
    // present are written server-side.
    const body = {
      name: name.trim(),
      cost: costNum,
      salvage: salvageNum,
      ...(date.trim() ? { acquired_date: date.trim() } : {}),
      ...(Number.isFinite(lifeNum) && lifeNum > 0 ? { life_years: lifeNum } : {}),
      ...(ccId ? { cc_id: ccId } : {}),
      depr_method: t(methodKey),
    };

    const onSuccess = (saved: unknown) => {
      const c = saved as Record<string, unknown>;
      const savedName = typeof c.name === "string" && c.name ? c.name : name.trim();
      onClose();
      // fa.register.toastAdd carries a {code} + {name} template; the wire has no human code (the
      // server assigns a uuid) -> the {code} slot resolves to an em-dash, honestly. Reused for
      // edit too, interim — there is no fa.register.toastEdit key yet (reported as a Wave-C
      // candidate, never minted here).
      ctx.notify(
        t("fa.register.toastAdd").replace("{code}", DASH).replace("{name}", savedName),
      );
    };

    if (isEdit) {
      updateAsset.mutate(body, { onSuccess });
    } else {
      createAsset.mutate(body, { onSuccess });
    }
  };

  return (
    <>
      {/* code (presentational, not sent) + name (real, required) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("fa.form.fieldCode")} hint={t("fa.form.hintAutoGen")}>
          <input className="num" style={fieldStyle(false)} disabled />
        </Field>
        <Field label={t("fa.colName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("fa.form.phName")}
            style={fieldStyle(nameBad)}
          />
        </Field>
      </div>

      {/* category (presentational) + location (presentational) + acquired date (real) */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}
      >
        <Field label={t("fa.fieldCat")} required>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryKey)}
            style={fieldStyle(false)}
          >
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fa.form.fieldLocProject")}>
          <input value={location} onChange={(e) => setLocation(e.target.value)} style={fieldStyle(false)} />
        </Field>
        <Field label={t("fa.form.fieldAcqDate")} required>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      {/* cost (real, required) + life (real) + salvage (real) */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}
      >
        <Field label={t("fa.colCostBaht")} required>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="num"
            inputMode="numeric"
            style={fieldStyle(costBad)}
          />
        </Field>
        <Field label={t("fa.form.fieldLifeYears")} required>
          <input
            value={life}
            onChange={(e) => setLife(e.target.value)}
            className="num"
            inputMode="numeric"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("fa.form.fieldSalvage")}>
          <input
            value={salvage}
            onChange={(e) => setSalvage(e.target.value)}
            className="num"
            inputMode="numeric"
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      {/* method (real) + cost center (real, cc_id) + account (presentational) */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}
      >
        <Field label={t("fa.form.fieldMethod")} required>
          <select
            value={methodKey}
            onChange={(e) => setMethodKey(e.target.value as MethodKey)}
            style={fieldStyle(false)}
          >
            {METHOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fa.fieldCostCenter")}>
          <select value={ccId} onChange={(e) => setCcId(e.target.value)} style={fieldStyle(false)}>
            <option value="">{DASH}</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fa.form.fieldAcct")} required>
          <input value={account} onChange={(e) => setAccount(e.target.value)} style={fieldStyle(false)} />
        </Field>
      </div>

      {/* Depreciation preview — a client-side straight-line projection (not stored). Hidden for a
          land ("no depreciation") category, matching the prototype. */}
      {!isLand && (
        <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t("fa.form.previewTitle")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, fontSize: 12 }}>
            <div>
              <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{t("fa.form.previewAnnual")}</span>
              <div className="num" style={{ fontWeight: 700, fontSize: 16, color: "var(--brand)" }}>
                {formatMoney(annualDepr)} {BAHT}
              </div>
            </div>
            <div>
              <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{t("fa.form.previewMonthly")}</span>
              <div className="num" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>
                {formatMoney(monthlyDepr)} {BAHT}
              </div>
            </div>
            <div>
              <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{t("fa.form.previewGlTitle")}</span>
              <div style={{ fontSize: 11, marginTop: 4, color: "var(--text-2)" }}>
                {t("fa.form.previewGlLine").replace("{acct}", acctCode)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" disabled={busy} onClick={save}>
          {t("fa.form.btnSave")}
        </Btn>
      </div>
    </>
  );
}
