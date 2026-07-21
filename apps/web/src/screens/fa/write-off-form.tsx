/*
 * WriteOffForm — the "write off an asset" modal body, ported from pototype/fa.jsx WriteOffForm
 * (L709-775).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the asset selector and the read-only book value are
 * the prototype's.
 *
 * Honest wiring (rule 8 + gate-4.5): the selectable assets + the book value are REAL
 * (GET /fa/assets); confirm -> POST /fa/write-off { asset_id } (useWriteOff). The SERVER derives
 * book_value = cost - accumulated_depr and posts the disposal JV (fa.ts writeOff).
 *   DROPPED (never fabricated) — the endpoint accepts ONLY { asset_id }:
 *   - the sale-vs-writeoff toggle: the server has no `sale` mode / sale-price -> omitted.
 *   - the sale-price input + the gain/loss banner: no wire field (the server computes the amount)
 *     -> omitted (a client-entered price the server ignores would fabricate a gain/loss).
 *   - the reason textarea: the server generates the memo -> omitted.
 *   - the GL double-entry preview: the real posting is Dr 5100 / Cr 1210 (fa.ts), not the
 *     prototype's disposal-entry mock -> omitted. All reported.
 *   The success toast (fa.writeoff.toast) is filled with the real removed carrying amount
 *   (result = "loss", since a write-off removes the whole book value); its "post to GL" suffix
 *   is honest when book_value > 0 (a JV posts) and reported for the zero-book deferred edge.
 *
 * i18n (rule 2): fa.writeoff.* + fa.statusWriteoff + fa.revalue.fieldAsset (reused "select asset")
 * + subcon.unitBaht + common.cancel. ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { useShellCtx } from "../../shell/shell-context";
import { formatMoney, toFaAsset, type FaAsset } from "./fa-depr-rows";
import { useFaAssetList, useWriteOff } from "./use-fa-depr";

const DASH = "—";

/** Native-select / input style (shared with revalue-form). */
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

export function WriteOffForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = useFaAssetList();
  const writeOff = useWriteOff();

  // Any not-yet-written-off asset can be disposed.
  const assets = useMemo<FaAsset[]>(
    () => (assetsQ.data ?? []).map(toFaAsset).filter((a) => a.status !== "written_off"),
    [assetsQ.data],
  );

  const [assetId, setAssetId] = useState("");
  const selected = assets.find((a) => a.id === assetId) ?? assets[0];
  const book = selected ? selected.bookValue : 0;
  const canSave = selected != null && !writeOff.isPending;

  const submit = () => {
    if (!selected) return;
    writeOff.mutate(
      { asset_id: selected.id },
      {
        onSuccess: () => {
          ctx.notify(
            t("fa.writeoff.toast")
              .replace("{kind}", t("fa.statusWriteoff"))
              .replace("{code}", selected.name || selected.id)
              .replace("{result}", t("fa.writeoff.wordLoss"))
              .replace("{amount}", formatMoney(book)),
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
        <Field label={t("fa.writeoff.fieldBook")}>
          <input value={`${formatMoney(book)} ${t("subcon.unitBaht")}`} readOnly style={{ ...controlStyle, fontFamily: "var(--font-num)" }} />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="danger" size="md" icon="check" disabled={!canSave} onClick={submit}>
          {t("fa.writeoff.btnConfirmWo")}
        </Btn>
      </div>
    </>
  );
}
