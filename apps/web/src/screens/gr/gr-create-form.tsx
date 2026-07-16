/*
 * GRCreateForm — the Goods Receipt "create" modal body, ported from
 * pototype/forms.jsx GRCreateForm (L381-517). Opened by GRList via ctx.openModal
 * (size "lg").
 *
 * Design fidelity (PLAN.md §0 rule 1): the po/wo/other segmented tabs, the PO/WO
 * radio picker, the 2-column meta field grid (date / warehouse / receiver /
 * delivery-note, + vendor/note on "other"), the received-items panel with its
 * partial checkbox + condition column, the partial warning, and the
 * cancel/attach/save footer are the prototype's. Every string is a gr.create.* /
 * gr.list.* / common.* dict key (t) or a gr-strings.json phrase (tp) — no Thai
 * literal in source (rule 2). Tokens back every colour (rule 6); the active-tab
 * #fff-ish surface + shadow are prototype-verbatim (B-037(a)).
 *
 * Mock mechanics dropped + WIRE GAPS (rule 3, reported honestly):
 *   - The picker rows come from GET /po + GET /wo (openAnchors: only "approved"/open
 *     docs may be received against; POST /gr 409s otherwise) — real, replacing the
 *     PO_FOR_GR mock. Each row shows the real { no, amount }; the prototype's vendor
 *     name + remaining-balance have NO wire source (vendor_id is a UUID; no
 *     ordered-qty is exposed), so those sub-lines are omitted, not fabricated.
 *   - date / warehouse / receiver / delivery-note are presentational: the gr wire
 *     has no such columns, so the POST body carries only { po_id|wo_id, lines }.
 *     These inputs are kept for fidelity but do NOT persist (flagged).
 *   - The gr wire has NO per-line item table (gr.ts GAP 1), and PO/WO carry no line
 *     quantities, so the prototype's 4 hardcoded item rows collapse into ONE
 *     aggregate accepted-qty (qty_ok) entry — the only quantity POST /gr consumes.
 *     Ordered / unit render an em-dash; qty_rejected is not collected (the
 *     prototype form has no rejected column) and defaults to 0.
 *   - The receive-others (no PO) tab has no wire path (POST /gr requires exactly one
 *     of po_id / wo_id), so its submit is disabled + flagged.
 *   - attach delivery-note/photos is a STUB (no multipart route) — notify only.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { usePoList, useWoList, useCreateGr } from "./use-gr";
import { toAnchorDoc, openAnchors, formatMoney, buildLines, type AnchorDoc } from "./gr-rows";
import grStrings from "./gr-strings.json" with { type: "json" };

const P = (k: keyof typeof grStrings) => grStrings[k] as PhraseKey;

/** Input style, mirrored from new-boq-form.tsx fieldStyle (prototype pr-form Input). */
function fieldStyle(): CSSProperties {
  return {
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
}

type Kind = "po" | "wo" | "other";

export interface GRCreateFormProps {
  onClose: () => void;
}

export function GRCreateForm({ onClose }: GRCreateFormProps) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const poQ = usePoList();
  const woQ = useWoList();
  const createGr = useCreateGr();

  const poOpts = useMemo<AnchorDoc[]>(
    () => openAnchors((poQ.data ?? []).map(toAnchorDoc)),
    [poQ.data],
  );
  const woOpts = useMemo<AnchorDoc[]>(
    () => openAnchors((woQ.data ?? []).map(toAnchorDoc)),
    [woQ.data],
  );

  const [kind, setKind] = useState<Kind>("po");
  const [refId, setRefId] = useState("");
  const [qtyOk, setQtyOk] = useState("");
  const [partial, setPartial] = useState(false);

  const opts = kind === "po" ? poOpts : kind === "wo" ? woOpts : [];
  const effectiveRefId = refId || opts[0]?.id || "";
  const selected = opts.find((o) => o.id === effectiveRefId);

  const KIND_TABS: readonly { v: Kind; l: string }[] = [
    { v: "po", l: tp(P("tabPo")) },
    { v: "wo", l: tp(P("tabWo")) },
    { v: "other", l: t("gr.create.tabOther") },
  ];

  const qtyOkNum = Number.parseFloat(qtyOk);
  const canSubmit =
    kind !== "other" && !!selected && Number.isFinite(qtyOkNum) && qtyOkNum > 0 && !createGr.isPending;

  const submit = () => {
    if (!selected) return;
    const body = {
      ...(kind === "po" ? { po_id: selected.id } : { wo_id: selected.id }),
      lines: buildLines(qtyOkNum, 0),
    };
    createGr.mutate(body, {
      onSuccess: (created) => {
        const c = created as Record<string, unknown>;
        const newNo = typeof c.no === "string" && c.no ? c.no : String(c.id ?? "");
        onClose();
        ctx.notify(
          t("gr.create.savedToast").replace("{no}", newNo).replace("{ref}", selected.no),
        );
        ctx.navigate("gr.list");
      },
    });
  };

  return (
    <>
      {/* po / wo / other segmented tabs (forms.jsx L396-410) */}
      <div
        style={{
          display: "flex",
          padding: 3,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        {KIND_TABS.map((o) => {
          const on = kind === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => {
                setKind(o.v);
                setRefId("");
              }}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 6,
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--brand)" : "var(--text-2)",
                fontSize: 12.5,
                fontWeight: on ? 700 : 500,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: on ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
              }}
            >
              {o.l}
            </button>
          );
        })}
      </div>

      {/* PO / WO picker (real, openAnchors) */}
      {kind !== "other" && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
            {t("gr.create.selectRef").replace("{docType}", kind === "po" ? "PO" : "WO")}
          </div>
          {opts.length === 0 ? (
            <div
              style={{
                padding: "18px 14px",
                textAlign: "center",
                fontSize: 12,
                color: "var(--text-3)",
                background: "var(--surface-2)",
                borderRadius: 8,
              }}
            >
              <Icon name="info" size={22} color="var(--text-3)" style={{ opacity: 0.5 }} />
              <div style={{ marginTop: 6 }}>{t("common.all")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {opts.map((p) => {
                const on = p.id === effectiveRefId;
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 12,
                      borderRadius: 8,
                      cursor: "pointer",
                      background: on ? "var(--brand-soft)" : "var(--surface-2)",
                      border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                    }}
                  >
                    <input
                      type="radio"
                      name="ref"
                      checked={on}
                      onChange={() => setRefId(p.id)}
                      style={{ accentColor: "var(--brand)" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                        <span className="num" style={{ color: "var(--brand)" }}>
                          {p.no}
                        </span>
                      </div>
                    </div>
                    <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>
                      {formatMoney(p.amount)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* meta grid — presentational (no gr wire columns), kept for fidelity */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}
      >
        <Field label={tp(P("dateReceived"))} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("gr.create.receiveToWarehouse")} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("gr.list.receivedBy")} required>
          <input style={fieldStyle()} />
        </Field>
        <Field label={t("gr.create.deliveryNoteNo")}>
          <input className="num" style={fieldStyle()} />
        </Field>
        {kind === "other" && (
          <>
            <Field label={tp(P("vendor"))} required>
              <input style={fieldStyle()} />
            </Field>
            <Field label={tp(P("note"))} style={{ gridColumn: "span 2" }}>
              <input style={fieldStyle()} />
            </Field>
          </>
        )}
      </div>

      {/* items — one aggregate receive entry (GAP 1: no per-line wire) */}
      <div
        style={{ background: "var(--surface-2)", borderRadius: 10, padding: 12, marginBottom: 16 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("gr.list.receivedItems")}</div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              color: partial ? "var(--warn)" : "var(--text-2)",
            }}
          >
            <input
              type="checkbox"
              checked={partial}
              onChange={(e) => setPartial(e.target.checked)}
              style={{ accentColor: "var(--warn)" }}
            />
            {t("gr.create.partialCheckbox")}
          </label>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th style={{ ...thCell(80, true) }}>{t("gr.create.colOrdered")}</th>
              <th style={{ ...thCell(90, true) }}>{t("gr.create.colReceived")}</th>
              <th style={{ ...thCell(70) }}>{tp(P("thUnit"))}</th>
              <th style={{ ...thCell(90) }}>{t("gr.create.colCondition")}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              {/* ordered has no wire — em-dash, never fabricated */}
              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text-3)" }}>—</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                <input
                  value={qtyOk}
                  onChange={(e) => setQtyOk(e.target.value)}
                  inputMode="numeric"
                  className="num"
                  style={{
                    width: 80,
                    padding: "4px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                    textAlign: "right",
                    outline: "none",
                    background: "var(--surface)",
                    fontFamily: "var(--font-num)",
                    color: "var(--text)",
                    fontWeight: 600,
                  }}
                />
              </td>
              <td style={{ padding: "8px 10px", color: "var(--text-3)" }}>—</td>
              <td style={{ padding: "8px 10px" }}>
                <select style={{ ...fieldStyle(), height: 30, fontSize: 12 }}>
                  <option>{t("gr.create.conditionGood")}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
        {partial && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "var(--warn-soft)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--warn)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name="warn" size={13} />
            {t("gr.create.partialWarning")}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn
          kind="ghost"
          size="md"
          icon="paperclip"
          onClick={() => ctx.notify(t("gr.create.attachBtn"), "info")}
        >
          {t("gr.create.attachBtn")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("gr.create.saveBtn")}
        </Btn>
      </div>
    </>
  );
}

/** Items-table header cell (forms.jsx th() at 6px/10px padding). */
function thCell(w: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "6px 10px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    width: w,
  };
}
