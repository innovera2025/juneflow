/*
 * LandPlotForm — the add-plot modal body, ported from pototype/land.jsx LandPlotForm
 * (L223-276). Opened by LandBank via ctx.openModal (land.jsx LandBank openAdd, L149-153).
 *
 * Design fidelity (§0 rule 1): the field grid is the prototype's — the title row, the
 * deed + tenure row, the tambon/amphoe/prov row, the rai/ngan/wa row, the gps + price row,
 * the required-red-border validation (title + rai + price), and the cancel/save footer.
 * Every user-visible string is a land.* / common.* dict key (t); no Thai literal sits in
 * this source (§0 rule 2); tokens back every colour (§0 rule 6); the numeric inputs
 * (rai/ngan/wa/gps/price) carry class `num` (§0 rule 7).
 *
 * Mock mechanics dropped (§0 rule 3):
 *   - THE CLIENT `id`: the prototype seeded an editable "L-<random>" plot code and sent it
 *     in the row. POST /land/plots does NOT accept a code/id — the SERVER generates the plot
 *     id (land-sales.ts createLandPlot returns plotWire(created).id). So the editable id
 *     field is dropped entirely and no client id is emitted; the title takes its row.
 *   - THE DEFAULT PROVINCE: the prototype defaulted prov to a hardcoded Thai place name; a
 *     Thai literal is forbidden here (§0 rule 2) and the value is mock seed data (not UI
 *     copy, so it has no i18n key), so prov starts empty (user-entered).
 *   - THE GPS / PRICE PLACEHOLDERS: the prototype's example-value placeholders ("13.9182,
 *     100.4023" / "4200000") are numeric data hints with no i18n key, so they are omitted
 *     (the title / deed placeholders keep their real dict keys).
 *
 * The ds.jsx <Dropdown> popover is a shared primitive not ported — tenure uses a native
 * <select> (vendor-form.tsx precedent). The form emits a PlotDraft; LandBank composes the
 * opaque POST /land/plots body (money=SERVER: price_per_rai is a plain attribute, area_sqm
 * is a rai->sqm unit conversion — neither is a JV amount).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";

/** The values the form emits; LandBank composes the opaque POST /land/plots body. */
export interface PlotDraft {
  title: string;
  deed: string;
  /** Tenure code (buy | lease | negotiate | study), from the dropdown. */
  tenure: string;
  tambon: string;
  amphoe: string;
  prov: string;
  /** Digits-only strings (the view converts rai/ngan/wa to area_sqm; price to price_per_rai). */
  rai: string;
  ngan: string;
  wa: string;
  gps: string;
  price: string;
}

export interface LandPlotFormProps {
  onSubmit: (draft: PlotDraft) => void;
  onClose: () => void;
}

/** Tenure dropdown options (land.jsx LandPlotForm, L254): value + land.tenure.* label. */
const TENURE_OPTIONS: readonly { value: string; labelKey: DictKey }[] = [
  { value: "buy", labelKey: "land.tenure.buy" },
  { value: "lease", labelKey: "land.tenure.lease" },
  { value: "negotiate", labelKey: "land.tenure.negotiate" },
  { value: "study", labelKey: "land.tenure.study" },
];

/** Input style, verbatim land.jsx LandPlotForm fld() (only the error border differs). */
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

/** Keep digits only (land.jsx rai/ngan/wa/price inputs, `.replace(/[^\d]/g, "")`). */
function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "");
}

export function LandPlotForm({ onSubmit, onClose }: LandPlotFormProps) {
  const { t } = useI18n();

  const [title, setTitle] = useState("");
  const [deed, setDeed] = useState("");
  const [tenure, setTenure] = useState("buy"); // land.jsx LandPlotForm default (L233).
  const [tambon, setTambon] = useState("");
  const [amphoe, setAmphoe] = useState("");
  const [prov, setProv] = useState(""); // prototype's Thai default dropped (§0 rule 2 / 3).
  const [rai, setRai] = useState("");
  const [ngan, setNgan] = useState("0"); // land.jsx defaults (L230).
  const [wa, setWa] = useState("0");
  const [gps, setGps] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<{ title?: boolean; rai?: boolean; price?: boolean }>({});

  // Validation parity (land.jsx LandPlotForm save, L237-243): title + rai + price required.
  const save = () => {
    const e: { title?: boolean; rai?: boolean; price?: boolean } = {};
    if (!title.trim()) e.title = true;
    if (!rai) e.rai = true;
    if (!price) e.price = true;
    setErr(e);
    if (Object.keys(e).length > 0) return;
    onSubmit({
      title: title.trim(),
      deed: deed.trim(),
      tenure,
      tambon: tambon.trim(),
      amphoe: amphoe.trim(),
      prov: prov.trim(),
      rai,
      ngan: ngan || "0",
      wa: wa || "0",
      gps: gps.trim(),
      price,
    });
  };

  return (
    <div>
      {/* Title row (land.jsx L248-251, the client-id field dropped — server owns the id). */}
      <div style={{ marginBottom: 12 }}>
        <Field label={t("land.form.fieldTitle")} required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("land.form.fieldTitlePh")}
            style={fieldStyle(!!err.title)}
          />
        </Field>
      </div>

      {/* Deed + tenure (land.jsx L252-255). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label={t("land.field.deed")}>
          <input
            value={deed}
            onChange={(e) => setDeed(e.target.value)}
            placeholder={t("land.form.fieldDeedPh")}
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("land.bank.filterTenureHint")}>
          <select value={tenure} onChange={(e) => setTenure(e.target.value)} style={fieldStyle(false)}>
            {TENURE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Tambon / amphoe / prov (land.jsx L256-260). */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}
      >
        <Field label={t("land.form.fieldTambon")}>
          <input value={tambon} onChange={(e) => setTambon(e.target.value)} style={fieldStyle(false)} />
        </Field>
        <Field label={t("land.form.fieldAmphoe")}>
          <input value={amphoe} onChange={(e) => setAmphoe(e.target.value)} style={fieldStyle(false)} />
        </Field>
        <Field label={t("land.form.fieldProv")}>
          <input value={prov} onChange={(e) => setProv(e.target.value)} style={fieldStyle(false)} />
        </Field>
      </div>

      {/* Rai / ngan / wa (land.jsx L261-265) — digits-only, class num, rai required. */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}
      >
        <Field label={t("land.unit.rai")} required>
          <input
            value={rai}
            onChange={(e) => setRai(digitsOnly(e.target.value))}
            className="num"
            style={fieldStyle(!!err.rai)}
          />
        </Field>
        <Field label={t("land.unit.ngan")}>
          <input
            value={ngan}
            onChange={(e) => setNgan(digitsOnly(e.target.value))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("land.unit.wa")}>
          <input
            value={wa}
            onChange={(e) => setWa(digitsOnly(e.target.value))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      {/* GPS + price (land.jsx L266-269) — both class num, price digits-only + required. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <Field label={t("land.bank.colGps")}>
          <input
            value={gps}
            onChange={(e) => setGps(e.target.value)}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("land.bank.colPricePerRai")} required>
          <input
            value={price}
            onChange={(e) => setPrice(digitsOnly(e.target.value))}
            className="num"
            style={fieldStyle(!!err.price)}
          />
        </Field>
      </div>

      {/* Footer (land.jsx L270-273). */}
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
        <Btn kind="primary" size="md" icon="check" onClick={save}>
          {t("land.bank.addBtn")}
        </Btn>
      </div>
    </div>
  );
}
