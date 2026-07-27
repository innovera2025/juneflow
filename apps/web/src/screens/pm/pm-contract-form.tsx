/*
 * PMContractForm — the "create PM maintenance contract" modal body, opened by
 * PMContracts via ctx.openModal (size "lg"). Ported LEAN from pototype/pm2.jsx
 * PMContractForm (L372-492) + PMContractWizard (L281-353) under Wei ruling
 * B-136.
 *
 * Design fidelity (PLAN.md §0 rule 1) within the LEAN envelope: the project +
 * customer selectors, the 2-option contract-mode radio cards (MA / per_visit), the
 * conditional visits/year section (per_visit), the SLA selector, and the value/end
 * row are the prototype's — reduced to only what the wire persists. Every visible
 * string is a pm.* / common.* dict key (t); tokens back every colour (rule 6). No
 * Thai / baht literal sits in this source (B-073) — the SLA option labels are
 * resolved from pm.sla* keys at runtime.
 *
 * DIVERGENCES (reported honestly — never fabricated). The prototype form collects
 * no / site / scope / cycle / start / a 3rd "other" service mode; NONE of those are
 * columns on contractWire (apps/api/src/routes/pm.ts), so they are dropped (LEAN,
 * B-136) rather than sent to a field that cannot persist. The wizard's project-
 * picker step becomes a single project <select>. The stored SLA value is the
 * resolved option label (matches the prototype, which stores the display string).
 *
 * Data (rule 3): projects come from GET /projects, customers from GET /customers;
 * the create is POST /pm/contracts (use-pm-contracts.ts) — project_id + mode are
 * required, the rest optional. value is a user-entered contract amount (the
 * contract's stated value, not a computed total — B-136).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useCustomerList } from "../master/use-master-customer";
import { toCustomerRef } from "./pm-contracts-rows";
import { useCreatePmContract, type CreatePmContractBody } from "./use-pm-contracts";

/** Contract mode option (pm2.jsx SVC, reduced to the 2 wire-backed modes). The
 *  values are the OpenAPI POST enum ('ma'|'visits'); the server maps them to the
 *  stored MA|per_visit. */
type ContractMode = "ma" | "visits";
const MODES: readonly { key: ContractMode; labelKey: DictKey; descKey: DictKey }[] = [
  { key: "ma", labelKey: "pm.svcMaLabel", descKey: "pm.svcMaDesc" },
  { key: "visits", labelKey: "pm.svcScheduledLabel", descKey: "pm.svcScheduledDesc" },
];

/** SLA option keys (pm2.jsx PMContractForm SLA SelectOther options). */
const SLA_OPTIONS: readonly DictKey[] = [
  "pm.sla4h",
  "pm.sla8h",
  "pm.sla12h",
  "pm.sla24h",
  "pm.sla48h",
];

/** Input style, ported from PMContractForm.fld (pm2.jsx:387). */
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

/** Parse a grouped/decimal money input ("144,000") to a finite number (0 fallback). */
function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Parse a digits-only field to a positive integer, or null (per_visit visits). */
function parsePositiveInt(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PMContractFormProps {
  onClose: () => void;
}

export function PMContractForm({ onClose }: PMContractFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const customerQ = useCustomerList();
  const createContract = useCreatePmContract();

  const projects = projectsQ.data ?? [];
  const customers = useMemo(() => (customerQ.data ?? []).map(toCustomerRef), [customerQ.data]);

  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<ContractMode | "">("");
  const [customerId, setCustomerId] = useState("");
  const [visits, setVisits] = useState("");
  const [slaKey, setSlaKey] = useState<DictKey | "">("");
  const [end, setEnd] = useState("");
  const [value, setValue] = useState("");

  const canSubmit = !!projectId && !!mode && !createContract.isPending;

  const submit = () => {
    if (!projectId || !mode) return;
    const visitsN = mode === "visits" ? parsePositiveInt(visits) : null;
    const valueN = parseAmount(value);
    const body: CreatePmContractBody = {
      project_id: projectId,
      mode,
      ...(customerId ? { customer_id: customerId } : {}),
      ...(visitsN != null ? { visits_per_year: visitsN } : {}),
      ...(slaKey ? { sla: t(slaKey) } : {}),
      ...(end ? { end } : {}),
      ...(value ? { value: valueN, currency_code: "THB" } : {}),
    };
    createContract.mutate(body, {
      onSuccess: () => {
        const projName = projects.find((p) => p.id === projectId)?.name ?? "";
        onClose();
        // No wire contract-number (B-136) -> the {no} slot references the project.
        ctx.notify(t("pm.toastContractCreated").replace("{no}", projName));
      },
    });
  };

  return (
    <div>
      {/* project + customer */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label={t("pm.colProject")} required>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={fieldStyle()}>
            <option value="">{"—"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("pm.rowCustomer")}>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={fieldStyle()}>
            <option value="">{"—"}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* contract mode (required) — 2 wire-backed radio cards */}
      <Field label={t("pm.fieldContractType")} required style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {MODES.map((m) => {
            const on = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  background: on ? "var(--brand-soft)" : "var(--surface)",
                  borderRadius: 9,
                  cursor: "pointer",
                  textAlign: "start",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    width: 17,
                    height: 17,
                    borderRadius: 999,
                    flexShrink: 0,
                    marginTop: 1,
                    border: `2px solid ${on ? "var(--brand)" : "var(--border-strong)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)" }} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: on ? "var(--brand-ink)" : "var(--text)",
                      display: "block",
                    }}
                  >
                    {t(m.labelKey)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t(m.descKey)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* visits/year — only meaningful for the visits mode (pm2.jsx conditional section) */}
      {mode === "visits" && (
        <div style={{ marginBottom: 12 }}>
          <Field label={t("pm.fieldVisitsPerYear")}>
            <input
              className="num"
              value={visits}
              onChange={(e) => setVisits(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              style={{ ...fieldStyle(), width: 140 }}
            />
          </Field>
        </div>
      )}

      {/* sla + end + value */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label={t("pm.fieldSlaResponse")}>
          <select
            value={slaKey}
            onChange={(e) => setSlaKey(e.target.value as DictKey | "")}
            style={fieldStyle()}
          >
            <option value="">{"—"}</option>
            {SLA_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("pm.rowEnd")}>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={fieldStyle()} />
        </Field>
        <Field label={t("pm.fieldValuePerYear")}>
          <input
            className="num"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="numeric"
            style={fieldStyle()}
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
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("pm.btnCreateContract")}
        </Btn>
      </div>
    </div>
  );
}
