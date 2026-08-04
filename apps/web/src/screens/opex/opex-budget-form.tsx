/*
 * OpexBudgetForm — the "set a dept OPEX budget" modal body for OpexBudget. money = SERVER.
 *
 * The prototype (opex-budget.jsx) has NO faithful create-budget form — its next-year-budget
 * action is a MOCK confirm that copies the current structure +5% (a dropped mock, §0 rule 3),
 * and its OpexTransferForm targets an inter-dept transfer with no endpoint. This form is the
 * HONEST wiring of the one real write the backend exposes: POST /opex/budgets, whose contract
 * is exactly { dept, year, months[12] } (opex.ts). It collects those three fields and nothing
 * else: money = SERVER — the client never sends currency_code (the server forces THB) and
 * computes no total/JV; a duplicate (dept, year) is the server's 409, surfaced by the caller.
 *
 * Design fidelity: field controls reuse the shared Field + the jv-create-form headInput style
 * (as ap-deposit-form / billing-form). i18n (§0 rule 2): the dept label is org.unitDept, the
 * year label + the amount-group label + each month header are EXISTING i18n phrases
 * (opex-strings.json, tp), and the footer actions are common.cancel / common.save (t). NO
 * Thai/baht literal sits in this .tsx (B-073) — the baht glyph lives only inside the
 * amountLabel phrase in the .json sidecar.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import {
  MONTHS_IN_YEAR,
  emptyOpexDraft,
  draftSubmittable,
  type OpexDraft,
} from "./opex-rows";
import opexStrings from "./opex-strings.json" with { type: "json" };

/** Map an opex-strings.json id to its PhraseKey (the verbatim Thai value). */
const P = (k: keyof typeof opexStrings): PhraseKey => opexStrings[k] as PhraseKey;

/** The 12 month-header phrase ids, in Jan..Dec order. */
const MONTH_KEYS = Array.from(
  { length: MONTHS_IN_YEAR },
  (_, i) => `m${i + 1}` as keyof typeof opexStrings,
);

/** Header field input style (jv-create-form headInput, as ap-deposit-form). */
const headInput: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/** Digits-only sanitiser (budget figures are whole THB, opex-budget.jsx transfer input). */
const digits = (v: string): string => v.replace(/[^\d]/g, "");

export function OpexBudgetForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (draft: OpexDraft) => void;
}) {
  const { t, tp } = useI18n();
  const [draft, setDraft] = useState<OpexDraft>(emptyOpexDraft());

  const setMonth = (i: number, v: string) =>
    setDraft((d) => {
      const months = d.months.slice();
      months[i] = digits(v);
      return { ...d, months };
    });

  const submittable = draftSubmittable(draft);
  const submit = () => {
    if (!submittable) return;
    onSubmit(draft);
  };

  return (
    <div>
      {/* dept + year — the two identity fields the unique(company_id, dept, year) keys on. */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12, marginBottom: 14 }}>
        <Field label={t("org.unitDept")} required>
          <input
            value={draft.dept}
            onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}
            style={headInput}
          />
        </Field>
        <Field label={tp(P("yearLabel"))} required>
          <input
            value={draft.year}
            onChange={(e) => setDraft((d) => ({ ...d, year: digits(e.target.value) }))}
            inputMode="numeric"
            className="num"
            style={headInput}
          />
        </Field>
      </div>

      {/* the 12 monthly budget figures — the opex_budget months[] planning input. */}
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
        {tp(P("amountLabel"))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 4,
        }}
      >
        {MONTH_KEYS.map((mk, i) => (
          <Field key={mk} label={tp(P(mk))}>
            <input
              value={draft.months[i] ?? ""}
              onChange={(e) => setMonth(i, e.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="num"
              style={{ ...headInput, height: 34, textAlign: "right" }}
            />
          </Field>
        ))}
      </div>

      {/* footer actions. */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!submittable}>
          {t("common.save")}
        </Btn>
      </div>
    </div>
  );
}
