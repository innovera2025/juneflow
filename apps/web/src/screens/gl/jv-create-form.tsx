/*
 * JVCreateForm — the "record a JV" modal body, ported from pototype/gl.jsx JVCreateForm
 * (L111-213). Opened by GLJournalVoucher via ctx.openModal.
 *
 * Design fidelity (PLAN.md §0 rule 1): the header fields (JV no + description), the editable
 * lines table (account · cost centre · debit · credit · remove), the add-line action, and the
 * balance footer (✓ Dr = Cr / ⚠ difference, with the Σ dr / Σ cr totals) are the prototype's.
 * The double-entry guard is reproduced verbatim: the submit is enabled only when Σ dr === Σ cr
 * AND Σ dr > 0 (gl.jsx L118) — the same invariant apps/api/src/routes/gl.ts createJv enforces
 * (a 400 otherwise, surfaced here as an error toast).
 *
 * Data (rule 8): the account picker is the REAL chart of accounts (GET /gl/coa) and the cost
 * centre picker is the REAL catalogue (GET /cost-centers) — the prototype's hardcoded COA list
 * + free-text CC input are dropped (§0 rule 3), because a free-text id would fail the server's
 * tenant-ownership check. Create is POST /gl/jv (use-gl.ts) with the opaque balanced body.
 *
 * WIRE GAPS (honest, never fabricated): jv_line has no per-line description column, so the
 * prototype's per-line description input + the attach-document action (no endpoint) are dropped
 * rather than collect data that cannot persist (gr-list precedent). `no` is a required text
 * input the user fills (there is no JV doc-number service to auto-generate it). The prototype's
 * date + entry-type header fields have no create-body counterpart and are omitted. On success
 * the modal closes and the JV list
 * invalidates (the new row appears) — the prototype's specific success toast (which embeds an
 * auto-generated JV number) is not reproduced (no key / no fabrication).
 *
 * i18n (rule 2): every string is a jv-strings.json phrase (tp) or an existing DICT key
 * (t: common.cancel). Several keys are new (jv-strings.json._missing) -> honest Thai, flagged
 * for the Wave-2 i18n round. Tokens back every colour (rule 6). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { useCoaList, useCostCenters, useCreateJv } from "./use-gl";
import { toCoaRow } from "./coa-rows";
import { jvTotals, buildJvBody, formatMoney, type JvLineDraft } from "./jv-rows";
import jvStrings from "./jv-strings.json" with { type: "json" };

const P = (k: keyof typeof jvStrings): PhraseKey => jvStrings[k] as PhraseKey;

/** A blank line (account/cc unset, zero dr/cr). */
const emptyLine = (): JvLineDraft => ({ accountId: "", ccId: "", dr: "", cr: "" });

/** Field/cell input style (gl.jsx L162-165 line-cell inputs). */
function cellInput(align: "left" | "right" = "left"): CSSProperties {
  return {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 11.5,
    outline: "none",
    background: "var(--surface)",
    color: "var(--text)",
    textAlign: align,
    fontFamily: "inherit",
  };
}

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

/** Read a display string off an opaque cost-centre row (code preferred, then name/id). */
function ccLabel(cc: Record<string, unknown>): string {
  const code = cc.code ?? cc.name ?? cc.id;
  return typeof code === "string" ? code : String(code ?? "");
}

export function JVCreateForm({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const coaQ = useCoaList();
  const ccQ = useCostCenters();
  const createJv = useCreateJv();

  const [no, setNo] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<JvLineDraft[]>([emptyLine(), emptyLine()]);

  const accounts = useMemo(() => (coaQ.data ?? []).map(toCoaRow), [coaQ.data]);
  const costCenters = useMemo(
    () => (ccQ.data ?? []) as Record<string, unknown>[],
    [ccQ.data],
  );
  const totals = jvTotals(lines);

  const upd = (i: number, k: keyof JvLineDraft, v: string) =>
    setLines((arr) => arr.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((arr) => [...arr, emptyLine()]);
  const rmLine = (i: number) => setLines((arr) => arr.filter((_, j) => j !== i));

  const submit = () => {
    if (!no.trim()) return; // no (JV number) is required (server also enforces).
    if (!totals.balanced) {
      ctx.notify(tp(P("unbalancedToast")), "danger");
      return;
    }
    createJv.mutate(buildJvBody(no, memo, lines), {
      onSuccess: () => onClose(), // list invalidates -> the new JV appears (honest feedback).
      onError: (err) => {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || tp(P("unbalancedToast")), "danger");
      },
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
        <Field label={tp(P("thNo"))} required>
          <input value={no} onChange={(e) => setNo(e.target.value)} className="num" style={headInput} />
        </Field>
        <Field label={tp(P("thDesc"))}>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} style={headInput} />
        </Field>
      </div>

      <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {tp(P("linesTitle"))}{" "}
            <span className="num" style={{ color: "var(--text-3)", fontWeight: 500 }}>
              · {lines.length}
            </span>
          </div>
          <Btn kind="ghost" size="sm" icon="plus" onClick={addLine}>
            {tp(P("addLineBtn"))}
          </Btn>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th style={{ textAlign: "start", padding: "6px 8px", fontWeight: 600 }}>{tp(P("lineHeaderAccount"))}</th>
              <th style={{ textAlign: "start", padding: "6px 8px", width: 150, fontWeight: 600 }}>{tp(P("filterCC"))}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", width: 120, fontWeight: 600 }}>{tp(P("lineHeaderDr"))}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", width: 120, fontWeight: 600 }}>{tp(P("lineHeaderCr"))}</th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <select value={l.accountId} onChange={(e) => upd(i, "accountId", e.target.value)} style={cellInput()}>
                    <option value="">{tp(P("selectPlaceholder"))}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <select value={l.ccId} onChange={(e) => upd(i, "ccId", e.target.value)} style={cellInput()}>
                    <option value="">{tp(P("selectPlaceholder"))}</option>
                    {costCenters.map((cc) => (
                      <option key={String(cc.id)} value={String(cc.id)}>
                        {ccLabel(cc)}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <input
                    type="number"
                    value={l.dr}
                    onChange={(e) => upd(i, "dr", e.target.value)}
                    style={{ ...cellInput("right"), fontFamily: "var(--font-num)", fontWeight: Number(l.dr) > 0 ? 700 : 400 }}
                  />
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <input
                    type="number"
                    value={l.cr}
                    onChange={(e) => upd(i, "cr", e.target.value)}
                    style={{ ...cellInput("right"), fontFamily: "var(--font-num)", fontWeight: Number(l.cr) > 0 ? 700 : 400 }}
                  />
                </td>
                <td style={{ padding: "6px 4px" }}>
                  <button
                    type="button"
                    onClick={() => rmLine(i)}
                    aria-label="remove"
                    style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot style={{ background: totals.balanced ? "var(--ok-soft)" : "var(--warn-soft)" }}>
            <tr>
              <td
                colSpan={2}
                style={{ padding: "10px 8px", fontWeight: 700, textAlign: "right", color: totals.balanced ? "var(--ok)" : "var(--warn)" }}
              >
                {totals.balanced
                  ? tp(P("balancedOk"))
                  : `${tp(P("unbalancedPrefix"))} ${formatMoney(totals.diff)} ${tp(P("baht"))}`}
              </td>
              <td className="num" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700 }}>
                {formatMoney(totals.dr)}
              </td>
              <td className="num" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700 }}>
                {formatMoney(totals.cr)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!totals.balanced || !no.trim() || createJv.isPending}
        >
          {tp(P("submitBtn"))}
        </Btn>
      </div>
    </>
  );
}
