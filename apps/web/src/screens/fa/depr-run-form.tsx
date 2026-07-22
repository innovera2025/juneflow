/*
 * DeprRunForm — the "run depreciation for the period" modal body, ported from pototype/fa.jsx
 * DeprRunForm (L521-568).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the amber warning banner, the 2x2 summary cards
 * (period / assets-to-depreciate / total / JV), and the confirm action are the prototype's.
 *
 * Honest wiring (rule 8 + gate-4.5 money-is-server-authority):
 *   - the summary is a REAL client PREVIEW computed from the loaded assets: the period is the
 *     current CE month the server will use, "assets to depreciate" is the eligible count, and the
 *     total is Sigma of the straight-line (cost - salvage)/life/12 over eligible assets
 *     (fa-depr-rows). The JV number is unknown until the server allocates it -> em-dash.
 *   - confirm -> POST /fa/run-depreciation (useRunDepreciation). The SERVER computes each amount
 *     and posts the JV; the success toast reports the REAL posted count from the response.
 *   - DROPPED (never fabricated): the prototype's GL double-entry preview table listed mock
 *     accounts (Dr 5301 / Cr 1502-1504) that DO NOT match the server's real posting (Dr 5100
 *     admin-expense / Cr 1210 PP&E, fa.ts runDepreciation). Showing fabricated accounting would
 *     violate rule 3 (no mock mechanics) + gate-4.5, so the preview table is omitted (reported).
 *
 * i18n (rule 2): every string resolves via t() from the DICT (i18n-full.json) — the fa.run.* keys
 * plus reused keys (subcon.colPeriod / subcon.unitBaht / common.cancel). The run success reuses
 * gl.inbox.postSuccessToast ("Post {count} ... -> auto JV"), whose meaning matches a depreciation
 * run exactly (fa.run.toastDone is a fixed-mock no-slot string and cannot carry the real count).
 * NO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import {
  currentCePeriod,
  eligibleCount,
  formatMoney,
  sumMonthly,
  summarizeRunResult,
  toFaAsset,
  type FaAsset,
} from "./fa-depr-rows";
import { useFaAssetList, useRunDepreciation } from "./use-fa-depr";

const DASH = "—";

/** Extract an error message off an unknown mutation error (gl-inbox precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** A summary card (ds.jsx surface-2 tile): a muted label over a numeric value. */
function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</div>
      <div
        className="num"
        style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: tone ?? "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

export function DeprRunForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = useFaAssetList();
  const runDepr = useRunDepreciation();

  const assets = useMemo<FaAsset[]>(() => (assetsQ.data ?? []).map(toFaAsset), [assetsQ.data]);
  const period = currentCePeriod();
  const count = eligibleCount(assets);
  const total = sumMonthly(assets);

  const submit = () => {
    runDepr.mutate(undefined, {
      onSuccess: (res) => {
        const { postedCount } = summarizeRunResult(res);
        // gl.inbox.postSuccessToast: "Post {count} docs to GL -> auto JV" — exact match for a
        // depreciation run (it posts {count} JVs). Real count from the server response.
        ctx.notify(t("gl.inbox.postSuccessToast").replace("{count}", String(postedCount)));
        onClose();
      },
      onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
    });
  };

  return (
    <>
      {/* Amber warning banner (fa.jsx L525-531). */}
      <div
        style={{
          padding: 14,
          background: "var(--warn-soft)",
          borderRadius: 10,
          marginBottom: 14,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <Icon name="warn" size={18} color="var(--warn)" style={{ marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warn)" }}>
            {t("fa.run.warnTitle")}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 2 }}>
            {t("fa.run.warnSub")}
          </div>
        </div>
      </div>

      {/* 2x2 summary cards — a REAL client preview (period / eligible count / total / JV). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <SummaryCard label={t("subcon.colPeriod")} value={period} />
        <SummaryCard label={t("fa.run.cardAssets")} value={String(count)} />
        <SummaryCard
          label={t("fa.run.cardTotal")}
          value={`${formatMoney(total)} ${t("subcon.unitBaht")}`}
          tone="var(--warn)"
        />
        {/* JV number is allocated by the server on post -> unknown here (em-dash). */}
        <SummaryCard label={t("fa.run.cardJv")} value={DASH} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          disabled={assetsQ.isLoading || runDepr.isPending}
          onClick={submit}
        >
          {t("fa.run.btnConfirm")}
        </Btn>
      </div>
    </>
  );
}
