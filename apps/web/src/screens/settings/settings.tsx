/*
 * SettingsCompany — the system Settings screen (route "settings"), ported 1:1 in
 * LAYOUT from pototype/extra-screens.jsx SettingsCompany (L99-156): a Page with the
 * [system > settings] breadcrumb, a save action, and a Card holding a 3-tab strip
 * (company profile / system / notifications) over a padded body.
 *
 * HONEST-EMPTY divergence (B-220, Wei-approved honest-empty): SettingsCompany has no
 * tenant-settings backend — no GET/PUT endpoint exists — so it is rendered honest-empty.
 * The layout is faithful, but the data is not fabricated: text inputs are blank (the
 * prototype's Thai sample defaultValues are dropped), the save + logo-upload buttons are
 * disabled (nothing to write to, so no toast is ever fired), the currency/fiscal/date/
 * language dropdowns render their options but are disabled (nothing to persist), and the
 * six notification toggles render inert at the prototype's default on/off states (the
 * prototype toggles are themselves static — no state hook, no handler). Tab switching stays
 * interactive because it is pure client UI state, not a write.
 *
 * The static structure (tabs, field labels/borrows, dropdown options, notif defaults) lives
 * in settings-config.ts and is locked by settings-config.test.ts — this file only renders
 * it. Every label is an i18n dict key or a byte-verified borrow (PLAN.md §0 rule 2); tokens
 * plus the prototype-verbatim literals (#fff active-tab text, var(--brand-soft) /
 * var(--brand-line)) back every colour (rule 6).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { Page } from "../../shell/page";
import {
  COMPANY_FIELDS,
  NOTIF_ROWS,
  SETTINGS_PAGE,
  SETTINGS_TABS,
  SYSTEM_FIELDS,
  type SelectOption,
} from "./settings-config";

// Field-control style — verbatim from the prototype's local `fld` (extra-screens.jsx L101).
const fld: CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 11px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
};

export function SettingsCompany() {
  const { t } = useI18n();
  const [tab, setTab] = useState("company");

  const optText = (o: SelectOption) => (o.labelKey ? t(o.labelKey) : o.label);

  // A disabled native <select> stands in for the prototype's Dropdown mode="select"
  // primitive (the same substitution org-add-form.tsx makes). `defaultValue` keeps it
  // uncontrolled so a disabled, non-persisting control needs no onChange handler.
  const inertSelect = (defaultValue: string, options: readonly SelectOption[]) => (
    <select defaultValue={defaultValue} disabled style={fld}>
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {optText(o)}
        </option>
      ))}
    </select>
  );

  return (
    <Page
      breadcrumbs={SETTINGS_PAGE.breadcrumb.map((k) => t(k))}
      title={t(SETTINGS_PAGE.titleKey)}
      subtitle={t(SETTINGS_PAGE.subtitleKey)}
      actions={
        // Honest-empty (B-220): no backend to save to, so the save action is disabled and
        // fires no toast (the prototype's ctx.notify onClick is dropped).
        <Btn kind="primary" size="md" icon="check" disabled>
          {t(SETTINGS_PAGE.saveKey)}
        </Btn>
      }
    >
      <Card pad={0}>
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {SETTINGS_TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 14px",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: tab === tb.id ? 700 : 500,
                background: tab === tb.id ? "var(--brand)" : "transparent",
                color: tab === tb.id ? "#fff" : "var(--text-2)",
              }}
            >
              <Icon name={tb.icon} size={14} />
              {t(tb.labelKey)}
            </button>
          ))}
        </div>
        <div style={{ padding: 22 }}>
          {tab === "company" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                gap: 22,
                alignItems: "start",
              }}
            >
              <div>
                <div
                  style={{
                    width: 110,
                    height: 110,
                    borderRadius: 14,
                    background: "var(--brand-soft)",
                    border: "2px dashed var(--brand-line)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--brand)",
                    gap: 6,
                  }}
                >
                  <Icon name="building" size={30} />
                  <span style={{ fontSize: 10.5, fontWeight: 700 }}>
                    {t(SETTINGS_PAGE.logoLabelKey)}
                  </span>
                </div>
                {/* Honest-empty (B-220): no upload backend, so the button is disabled. */}
                <Btn
                  kind="ghost"
                  size="sm"
                  icon="upload"
                  disabled
                  style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
                >
                  {t(SETTINGS_PAGE.uploadKey)}
                </Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* Inputs render blank — no defaultValue (honest-empty: no data to prefill). */}
                {COMPANY_FIELDS.map((f) => (
                  <Field
                    key={f.labelKey}
                    label={t(f.labelKey)}
                    style={f.span ? { gridColumn: "span 2" } : undefined}
                  >
                    <input className={f.num ? "num" : undefined} style={fld} />
                  </Field>
                ))}
              </div>
            </div>
          )}
          {tab === "system" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                maxWidth: 620,
              }}
            >
              {SYSTEM_FIELDS.map((f) => (
                <Field key={f.labelKey} label={t(f.labelKey)}>
                  {f.options ? (
                    inertSelect(f.defaultValue ?? "", f.options)
                  ) : (
                    <input className={f.num ? "num" : undefined} style={fld} />
                  )}
                </Field>
              ))}
            </div>
          )}
          {tab === "notif" && (
            <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 4 }}>
              {/* Inert toggles — static display at the prototype's default states (the
                  prototype rows carry no handler either), so nothing here persists. */}
              {NOTIF_ROWS.map((row) => (
                <label
                  key={row.labelKey}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "11px 4px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {t(row.labelKey)}
                  <span
                    style={{
                      width: 38,
                      height: 22,
                      borderRadius: 999,
                      background: row.on ? "var(--brand)" : "var(--border-strong)",
                      position: "relative",
                      transition: ".15s",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: row.on ? 18 : 2,
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        background: "#fff",
                        transition: ".15s",
                      }}
                    />
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
}
