/*
 * PMWOForm — the "create a PM work order" modal body, opened by PMWorkOrders via
 * ctx.openModal (size "md"). Ported from pototype/pm3.jsx PMWOForm (L279-319): the
 * asset dropdown + the type/date row + the tech field + the contract info line + the
 * cancel/create footer are the prototype's.
 *
 * Design fidelity (rule 1): the single-column field stack (asset · type+date · tech ·
 * info line) matches the prototype; the asset field keeps its required asterisk. Every
 * string is a pm.* / common.* dict key (t) — no Thai literal in source (rule 2); tokens
 * back every colour (rule 6).
 *
 * Data (rule 3): "create" runs the real POST /pm/workorders (use-pm.ts:
 * useCreateWorkorder) then invalidates the WO list + toasts pm.toastWoCreated + closes.
 * The asset dropdown is the live GET /pm/assets catalogue (a foreign/absent asset id
 * 404s server-side — never fabricated).
 *
 * WIRE GAPS / DIVERGENCE (reported honestly) — POST /pm/workorders (apps/api/src/
 * routes/pm.ts) stores only { asset_id (required), template_id?, tech? }:
 *   - type (pm.fieldWorkType, PM/CM): pm_workorder has NO type column — the dropdown
 *     is kept for fidelity but is NOT sent / does NOT persist (FLAG). It still tints
 *     nothing server-side; the mock's SLA/tag derivation from type is dropped.
 *   - scheduled date (pm.fieldScheduledDate): NO date column on the WO — the input is
 *     kept for fidelity but is NOT sent (FLAG); it also carries no seeded default (the
 *     mock's Thai date literal cannot be hardcoded, rule 2).
 *   - tech (pm.tech): a REAL stored column, but there is NO technician master/endpoint
 *     — the prototype's fixed 3-name dropdown is mock data (rule 3), so this is a
 *     free-text input (DIVERGENCE, FLAG). It IS sent when non-blank.
 *   - the created WO has no human number (id is a uuid, DEFAULT 4) so the success toast
 *     shows an em-dash for {no} (never the raw uuid).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { usePmAssetList, useCreateWorkorder } from "./use-pm";
import { toWoAssetRef, type WoAssetRef } from "./wo-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Input/select style (mirrors pm-asset-form fieldStyle) — token-backed. */
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

/** The two work-type option keys (pm3.jsx type Dropdown, presentational only). */
const TYPE_KEYS = ["pm.optPlanned", "pm.optCorrective"] as const;

export interface PMWOFormProps {
  onClose: () => void;
}

export function PMWOForm({ onClose }: PMWOFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const assetsQ = usePmAssetList();
  const createWo = useCreateWorkorder();

  const assets = useMemo<WoAssetRef[]>(
    () => (assetsQ.data ?? []).map(toWoAssetRef),
    [assetsQ.data],
  );

  const [asset, setAsset] = useState("");
  const [type, setType] = useState<string>(TYPE_KEYS[0]);
  const [date, setDate] = useState("");
  const [tech, setTech] = useState("");
  const [bad, setBad] = useState(false);

  // Default the asset selection to the first loaded asset (once available) without
  // clobbering a user pick.
  const selectedId = asset || assets[0]?.id || "";
  const selected = assets.find((a) => a.id === selectedId);

  const busy = createWo.isPending;

  const save = () => {
    if (!selectedId) {
      setBad(true);
      return;
    }
    setBad(false);
    createWo.mutate(
      { asset_id: selectedId, ...(tech.trim() ? { tech: tech.trim() } : {}) },
      {
        onSuccess: () => {
          onClose();
          // No human WO number on the wire (DEFAULT 4) — {no} is an em-dash.
          ctx.notify(t("pm.toastWoCreated").replace("{no}", DASH));
        },
        onError: (err) => {
          const message =
            typeof err === "object" && err !== null && "message" in err
              ? String((err as { message?: unknown }).message ?? "")
              : "";
          ctx.notify(message || DASH, "danger");
        },
      },
    );
  };

  return (
    <div>
      <div style={{ display: "grid", gap: 12, marginBottom: 4 }}>
        <Field label={t("pm.fieldAsset")} required>
          <select value={selectedId} onChange={(e) => setAsset(e.target.value)} style={fieldStyle(bad)}>
            {assets.length === 0 && <option value="">{DASH}</option>}
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.code || a.id} · ${a.name || DASH}`}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* type: presentational only (no type column) — kept for fidelity, not sent. */}
          <Field label={t("pm.fieldWorkType")}>
            <select value={type} onChange={(e) => setType(e.target.value)} style={fieldStyle(false)}>
              {TYPE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </Field>
          {/* date: presentational only (no WO date column) — kept for fidelity, not sent. */}
          <Field label={t("pm.fieldScheduledDate")}>
            <input value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle(false)} />
          </Field>
        </div>

        {/* tech: a real column, but no technician master exists -> free text (FLAG). */}
        <Field label={t("pm.tech")}>
          <input value={tech} onChange={(e) => setTech(e.target.value)} style={fieldStyle(false)} />
        </Field>

        <div
          style={{
            padding: "9px 12px",
            background: "var(--surface-2)",
            borderRadius: 8,
            fontSize: 11.5,
            color: "var(--text-2)",
          }}
        >
          {/* contract has no human code column (em-dash); site is the real asset site. */}
          {t("pm.formContractInfo")
            .replace("{contract}", DASH)
            .replace("{site}", selected?.site || DASH)}
        </div>
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
          {t("pm.createBtn")}
        </Btn>
      </div>
    </div>
  );
}
