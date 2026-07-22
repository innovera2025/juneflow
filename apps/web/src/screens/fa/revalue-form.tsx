/*
 * RevalueForm — the "revalue an asset" modal body, ported from pototype/fa.jsx RevalueForm
 * (L663-706).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the asset selector, the read-only book value, the
 * new-value input, and the signed difference banner are the prototype's.
 *
 * Honest wiring (rule 8 + gate-4.5): the selectable assets + the "before" book value are REAL
 * (GET /fa/assets); confirm -> POST /fa/revalue { asset_id, new_value } (useRevalue). The SERVER
 * records the (approved) adjustment; its GL posting is DEFERRED (no revaluation-surplus account
 * in COA_SEED, fa.ts revalue).
 *   DROPPED (never fabricated) — the endpoint accepts ONLY { asset_id, new_value }:
 *   - the revalue-date input has no wire field -> omitted (drop-not-collect, gl-inbox precedent).
 *   - the reason textarea has no wire field (the server generates the memo) -> omitted.
 *   - the GL double-entry preview listed a mock 1501/3301 pair; the real posting is DEFERRED, so
 *     showing those lines would fabricate an entry that never posts -> omitted. All reported.
 *   The success toast (fa.revalue.toast) is filled from the SERVER RESPONSE: {amount} = the server's
 *   recorded new value (ActionOk.amount = round2(new_value)), NOT the client-typed input; {diff} is
 *   derived from that server amount minus the REAL loaded before book value (both server data). Its
 *   static "post to GL" suffix is part of the blessed key and reads optimistically for a revalue
 *   whose GL posting is deferred (the key has no JV placeholder, so the response's null jv_no is not
 *   surfaced) — reported (same treatment as gl-inbox's applyFilterToast).
 *
 * i18n (rule 2): fa.revalue.* keys + reused keys (subcon.unitBaht / common.cancel). ZERO Thai/baht
 * in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { formatMoney, round2, toFaAsset, type FaAsset } from "./fa-depr-rows";
import { faActionNum, useFaAssetList, useRevalue } from "./use-fa-depr";

const DASH = "—";

/** Native-select / input style (jv-create-form headInput, as reused in gl-inbox). */
const controlStyle: CSSProperties = {
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

/** Extract an error message off an unknown mutation error (gl-inbox precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export function RevalueForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = useFaAssetList();
  const revalue = useRevalue();

  // Only active assets can be revalued (a written-off asset has no carrying value to adjust).
  const assets = useMemo<FaAsset[]>(
    () => (assetsQ.data ?? []).map(toFaAsset).filter((a) => a.status === "active"),
    [assetsQ.data],
  );

  const [assetId, setAssetId] = useState("");
  const [after, setAfter] = useState("");

  const selected = assets.find((a) => a.id === assetId) ?? assets[0];
  const before = selected ? selected.bookValue : 0;
  const afterNum = Number.parseFloat(after);
  const hasAfter = Number.isFinite(afterNum) && afterNum > 0;
  const diff = hasAfter ? round2(afterNum - before) : 0;
  const canSave = selected != null && hasAfter && !revalue.isPending;

  const submit = () => {
    if (!selected || !hasAfter) return;
    revalue.mutate(
      { asset_id: selected.id, new_value: afterNum },
      {
        onSuccess: (res) => {
          // SERVER-authoritative new carrying value (fa.ts revalue -> ActionOk.amount = round2(new_value)),
          // never the client-typed afterNum. The response carries no before/diff field, so the signed
          // difference is derived from the server amount and the REAL loaded before book value (both
          // server data, not optimistic). Absent amount -> em-dash (honest, no fabricated value).
          const amount = faActionNum(res, "amount");
          const amountStr = amount == null ? DASH : formatMoney(amount);
          const serverDiff = amount == null ? null : round2(amount - before);
          const diffStr =
            serverDiff == null ? DASH : `${serverDiff > 0 ? "+" : ""}${formatMoney(serverDiff)}`;
          ctx.notify(
            t("fa.revalue.toast")
              .replace("{code}", selected.name || selected.id)
              .replace("{amount}", amountStr)
              .replace("{diff}", diffStr),
          );
          onClose();
        },
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("fa.revalue.fieldAsset")} required>
          <select
            value={selected?.id ?? ""}
            onChange={(e) => setAssetId(e.target.value)}
            style={controlStyle}
            disabled={assets.length === 0}
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fa.revalue.fieldBefore")}>
          <input value={`${formatMoney(before)} ${t("subcon.unitBaht")}`} readOnly style={{ ...controlStyle, fontFamily: "var(--font-num)" }} />
        </Field>
        <Field label={t("fa.revalue.fieldAfter")} required>
          <input
            type="number"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            style={{ ...controlStyle, fontFamily: "var(--font-num)" }}
          />
        </Field>
      </div>

      {/* Signed difference banner (ok when up, danger when down). */}
      <div
        style={{
          padding: 14,
          background: diff >= 0 ? "var(--ok-soft)" : "var(--danger-soft)",
          borderRadius: 10,
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("fa.revalue.diffLabel")}</span>
        <span className="num" style={{ fontSize: 22, fontWeight: 800, color: diff >= 0 ? "var(--ok)" : "var(--danger)" }}>
          {`${diff > 0 ? "+" : ""}${formatMoney(diff)} ${t("subcon.unitBaht")}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" disabled={!canSave} onClick={submit}>
          {t("fa.revalue.btnConfirm")}
        </Btn>
      </div>
    </>
  );
}
