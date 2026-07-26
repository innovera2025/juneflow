/*
 * AssetDetail — the asset-detail modal body, opened by FARegister when a register row is clicked
 * (ctx.openModal, size "lg"). Ported from pototype/fa.jsx AssetDetail (L339-437): the info grid,
 * the three cost/accum/book stat cards, the yearly depreciation schedule, the change-history
 * block, and the close/attach/print/edit action row are the prototype's.
 *
 * Design fidelity (rule 1): the two-column info grid, the three colour-banded stat cards, the
 * scrollable schedule table, and the action row match the prototype. Every string is a fa.* /
 * common.* dict key (t) — no Thai/baht literal in source (rule 2); tokens back every colour.
 *
 * REAL vs em-dash (reported honestly, never fabricated) — the AssetRow comes from GET /fa/assets:
 *   - REAL: acquired_date (shown ISO — the wire stores a `date`; the prototype's Thai Buddhist-Era
 *     format was a mock), depr_method (or fa.methodNone when blank), life_years, cost,
 *     accumulated_depr, book_value, status, and the Cost Center (cc_id RESOLVED to its code via
 *     GET /cost-centers).
 *   - em-dash (NO wire column): the asset `code` and `category` and `location` cells.
 *   - SCHEDULE: a client-side straight-line PROJECTION from the real columns (buildSchedule) — the
 *     posted/pending per-year marker is an APPROXIMATION from accumulated_depr (there is no
 *     per-period schedule endpoint). A non-depreciable asset (no positive life) shows the empty
 *     state.
 *   - HISTORY: an in-service asset shows the real "registered on {date}" line; a written-off asset
 *     em-dashes (the detailed revalue/write-off history lives on GET /fa/adjustments, not wired in
 *     this port).
 *   - ACTIONS: close is real; print toasts (presentational); attach is PRESENTATIONAL (the
 *     prototype's attach modal is out of this port's scope); EDIT is REAL — the "edit" button
 *     opens the AssetForm pre-filled for this asset (fa.jsx AssetDetail -> openAssetEditForm ->
 *     the shared AssetForm), which submits a partial-merge PUT /fa/assets/{id} (use-fa.ts).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useCostCenterList } from "../master/use-cost-centers";
import { toCostCenterRow } from "../master/cc-rows";
import { AssetForm } from "./asset-form";
import {
  buildSchedule,
  isNoDepr,
  formatMoney,
  statusTone,
  type AssetRow,
} from "./fa-register-rows";

const DASH = "—";

/** Schedule table header cell style. */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "6px 10px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** An info-grid cell (small label over value). */
function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

/** A colour-banded stat card (cost / accum / book). */
function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div
      style={{
        padding: 12,
        background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
        borderRadius: 8,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 800, color: tone }}>
        {value}
      </div>
    </div>
  );
}

export interface AssetDetailProps {
  asset: AssetRow;
  onClose: () => void;
}

export function AssetDetail({ asset, onClose }: AssetDetailProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const ccQ = useCostCenterList();

  const ccCode = useMemo(() => {
    if (!asset.ccId) return "";
    const found = (ccQ.data ?? []).map(toCostCenterRow).find((c) => c.id === asset.ccId);
    return found ? found.code : "";
  }, [ccQ.data, asset.ccId]);

  const schedule = useMemo(() => buildSchedule(asset), [asset]);
  const noDepr = isNoDepr(asset);
  const tone = statusTone(asset.status);
  const methodLabel = asset.deprMethod || t("fa.methodNone");
  const ageLabel = asset.lifeYears != null ? t("fa.lifeYears").replace("{n}", String(asset.lifeYears)) : DASH;

  // Detail -> edit (fa.jsx AssetDetail L434 openAssetEditForm): the "edit" button REPLACES this
  // detail modal with the shared AssetForm pre-filled for this asset (a partial-merge PUT). No
  // dedicated fa.register.editTitle/editSubtitle key exists yet, so the modal reuses common.edit as
  // the title + the asset name as the subtitle (both existing) — reported as Wave-C candidates.
  const openEdit = () => {
    ctx.openModal({
      title: t("common.edit"),
      subtitle: asset.name,
      icon: "edit",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <AssetForm asset={asset} onClose={close} />,
    });
  };

  return (
    <>
      {/* Info grid — real where the wire has it, em-dash where it does not. */}
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
        {/* code: no wire column -> em-dash */}
        <Info label={t("cc.thCode")}>
          <span className="num" style={{ fontWeight: 700, color: "var(--text-3)" }}>{DASH}</span>
        </Info>
        {/* category: no wire column -> em-dash */}
        <Info label={t("fa.fieldCat")}><span style={{ color: "var(--text-3)" }}>{DASH}</span></Info>
        <Info label={t("fa.form.fieldAcqDate")}>
          {asset.acquiredDate ? (
            <span className="num">{asset.acquiredDate}</span>
          ) : (
            <span style={{ color: "var(--text-3)" }}>{DASH}</span>
          )}
        </Info>
        {/* location: no wire column -> em-dash */}
        <Info label={t("fa.fieldLoc")}><span style={{ color: "var(--text-3)" }}>{DASH}</span></Info>
        <Info label={t("fa.form.fieldMethod")}>{methodLabel}</Info>
        <Info label={t("fa.detail.fieldLife")}>{ageLabel}</Info>
        <Info label={t("fa.fieldCostCenter")}>
          {ccCode ? (
            <span className="num" style={{ color: "var(--brand)" }}>{ccCode}</span>
          ) : (
            <span style={{ color: "var(--text-3)" }}>{DASH}</span>
          )}
        </Info>
        <Info label={t("common.status")}>{t(tone.labelKey)}</Info>
      </div>

      {/* Cost / accum / book stat cards (real). */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}
      >
        <StatCard label={t("fa.fieldCostShort")} value={formatMoney(asset.cost)} tone="var(--brand)" />
        <StatCard label={t("fa.accumDepr")} value={formatMoney(asset.accumulatedDepr)} tone="var(--warn)" />
        <StatCard label={t("fa.detail.cardBookFull")} value={formatMoney(asset.bookValue)} tone="var(--ok)" />
      </div>

      {/* Yearly straight-line depreciation schedule (client-side projection). */}
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{t("fa.detail.scheduleTitle")}</div>
      <div
        style={{
          maxHeight: 220,
          overflow: "auto",
          marginBottom: 14,
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              <th style={th(50)}>{t("fa.detail.colYearNo")}</th>
              <th style={th(undefined, true)}>{t("fa.detail.colDepr")}</th>
              <th style={th(undefined, true)}>{t("fa.detail.colCum")}</th>
              <th style={th(undefined, true)}>{t("fa.colBook")}</th>
              <th style={th(80)}>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {noDepr ? (
              <tr>
                <td colSpan={5} style={{ padding: 30, textAlign: "center", color: "var(--text-3)" }}>
                  {t("fa.detail.noDeprEmpty")}
                </td>
              </tr>
            ) : (
              schedule.map((s) => (
                <tr
                  key={s.year}
                  style={{
                    borderTop: "1px solid var(--border)",
                    background: s.posted ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <td style={{ padding: "6px 10px", fontWeight: 600 }} className="num">
                    {t("fa.detail.rowYear").replace("{n}", String(s.year))}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }} className="num">
                    {formatMoney(s.annual)}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--warn)" }} className="num">
                    {formatMoney(s.cumulative)}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }} className="num">
                    {formatMoney(s.book)}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {s.posted ? (
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--ok-soft)",
                          color: "var(--ok)",
                          fontWeight: 700,
                        }}
                      >
                        {t("fa.detail.badgePosted")}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--surface-3)",
                          color: "var(--text-3)",
                          fontWeight: 600,
                        }}
                      >
                        {t("fa.detail.badgePending")}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Change history — real "registered on {date}" for an in-service asset; em-dash otherwise. */}
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{t("fa.detail.historyTitle")}</div>
      <div
        style={{
          padding: "8px 10px",
          background: "var(--surface-2)",
          borderRadius: 6,
          fontSize: 11.5,
          color: "var(--text-2)",
          marginBottom: 16,
        }}
      >
        {asset.status === "active" && asset.acquiredDate ? (
          <>
            <Icon
              name="check"
              size={12}
              color="var(--ok)"
              style={{ verticalAlign: "middle", marginInlineEnd: 4 }}
            />
            {t("fa.detail.historyNone").replace("{date}", asset.acquiredDate)}
          </>
        ) : (
          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
        )}
      </div>

      {/* Actions — close (real) / attach + edit (presentational) / print (toast). */}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("pm.btnClose")}
        </Btn>
        <Btn kind="ghost" size="md" icon="paperclip">
          {t("fa.detail.btnAttach")}
        </Btn>
        <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("fa.detail.toastPrint"))}>
          {t("common.print")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="edit" onClick={openEdit}>
          {t("common.edit")}
        </Btn>
      </div>
    </>
  );
}
