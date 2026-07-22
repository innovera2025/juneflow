/*
 * AdjustDetail — the adjustment-detail modal body, ported from pototype/fa.jsx AdjustDetail
 * (L778-810).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the header info grid (no / asset / kind / date /
 * reason), the before / after / difference cards, and the close / print / view-JV actions are the
 * prototype's.
 *
 * Honest wiring (rule 8): every field is the REAL /fa/adjustments row (fa-adjust-rows). The wire
 * carries ONE `amount` and no before-value / difference columns, so:
 *   - "no" shows the real record id (there is no document-number column).
 *   - "after" shows the real amount; "before" + "difference" em-dash (no wire).
 *   - "view JV" navigates to the GL journal screen; a revalue's JV is deferred (jv_id empty) so
 *     the affordance is a plain navigation to the JV list (honest, no fabricated JV link).
 *
 * i18n (rule 2): reused column keys (subcon.colNo / fa.breadcrumbAssets / subcon.colType /
 * subcon.colDate / subcon.colReason) + fa.adjust.* + fa.adjDetail.* + pm.btnClose + common.print +
 * subcon.unitBaht. ZERO Thai/baht in this .tsx (B-073).
 */
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { useShellCtx } from "../../shell/shell-context";
import { adjustKindMeta, formatDate, formatMoney, type FaAdjustment } from "./fa-adjust-rows";

const DASH = "—";

/** Map an adjustment kind to its blessed label key (data-safe raw kind for the unknown branch). */
function kindLabel(t: ReturnType<typeof useI18n>["t"], kind: string): string {
  switch (adjustKindMeta(kind).badge) {
    case "revalue":
      return t("fa.adjust.btnRevalue");
    case "writeoff":
      return t("fa.statusWriteoff");
    case "sale":
      return t("fa.adjust.tabSale");
    default:
      return kind || DASH;
  }
}

/** A label/value pair in the header info grid. */
function Info({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <div style={span ? { gridColumn: "1 / 3" } : undefined}>
      <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function AdjustDetail({ row, onClose }: { row: FaAdjustment; onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const date = formatDate(row.createdAt);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
          padding: 14,
          background: "var(--surface-2)",
          borderRadius: 10,
        }}
      >
        <Info label={t("subcon.colNo")}>
          <span className="num" style={{ fontWeight: 700, color: "var(--brand)" }}>{row.id}</span>
        </Info>
        <Info label={t("fa.breadcrumbAssets")}>
          <span className="num">{row.assetId || DASH}</span>
        </Info>
        <Info label={t("subcon.colType")}>{kindLabel(t, row.kind)}</Info>
        <Info label={t("subcon.colDate")}>{date || DASH}</Info>
        <Info label={t("subcon.colReason")} span>
          {row.memo || DASH}
        </Info>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        {/* before + difference have no wire column -> em-dash; after is the real amount. */}
        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("fa.adjust.colBefore")}</div>
          <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-3)" }}>{DASH}</div>
        </div>
        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("fa.adjust.colAfter")}</div>
          <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>
            {`${formatMoney(row.amount)} ${t("subcon.unitBaht")}`}
          </div>
        </div>
        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("fa.adjust.colGainLoss")}</div>
          <div className="num" style={{ fontSize: 16, fontWeight: 800, color: "var(--text-3)" }}>{DASH}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("pm.btnClose")}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("fa.adjDetail.toastPrint"))}>
          {t("common.print")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="ghost" size="md" icon="link" onClick={() => ctx.navigate("gl.jv")}>
          {t("fa.adjDetail.btnJv")}
        </Btn>
      </div>
    </>
  );
}
