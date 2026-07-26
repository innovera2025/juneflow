/*
 * APRetention — the retention register screen (ap.retention), ported from
 * pototype/accounting-extra2.jsx APRetention (L20-104). Route ap.retention
 * (docs/extract/NAV-ROUTES.md L72, section "acct"). Mirrors the finance-lane precedents ar-cn.tsx
 * (same prototype file: list + KPI strip + inlined Kpi/StatusBadge + generated-client/unwrap) and
 * gl-close.tsx (custom-footer confirm modal that consumes its own confirm-label key).
 *
 * Design fidelity (Juneflow section 0 rule 1): the three-part breadcrumb (finance section / AP side /
 * retention screen), the title/subtitle, the Export header action, the 4-card KPI strip, the register
 * table, the tfoot totals row, the info footnote, and the return-confirm dialog are the prototype's.
 *
 * Data (rule 3): GET /retention (use-ap-retention.ts) via the generated client — the prototype's local
 * RETENTION_SEED becomes the real server register. Pure narrowing / KPI sums / status-tone map /
 * releasable+settled predicates / SERVER release-amount reader live in ap-retention-rows.ts
 * (unit-tested, G3).
 *
 * COLUMN SCOPE (honest — only the KEYED wire-backed columns are rendered): the 5 columns with an
 * orch-B header key (contract-vendor / withheld-cum / returned / outstanding / due-date) + the status
 * badge (common.status header) + the return action. The prototype's rate and contract-value
 * columns are DROPPED: neither has a header i18n key (no thRate / thContractValue). rate +
 * contract_value ARE on the wire but are not surfaced without a blessed header key (no minting)
 * — flagged for the orchestrator.
 *
 * HONEST GAPS (never fabricated) — see ap-retention-rows.ts:
 *   - the contract/vendor cell shows vendor_name (JOINED, em-dash when unresolved); the WO number
 *     em-dashes (the wire carries only wo_id, a UUID — no human WO number).
 *   - due_date is the DERIVED ISO date (dueDate ?? created_at + 12mo, B-125), em-dash when null.
 *   - the settled ("complete") action cell renders an icon-only check: the prototype's inline
 *     complete-marker text has NO orch-B key, so it is not shown (no literal, no minting) — flagged.
 *
 * MONEY AUTHORITY (B-131 / gate-4.5): the release body carries ONLY { ledger_id } — never an amount.
 * The modal preview amount is the row's SERVER `remaining`; the success toast amount is the SERVER
 * response `amount` (releaseAmount). No client subtraction feeds a money display here.
 *
 * i18n (rule 2): every visible string resolves via t() from the DICT — ap.retention.* (orch-B
 * Wave-D, consume-only) plus reused shared keys (fin.breadcrumbFinance, common.export/cancel/status,
 * subcon.unitBaht/unitContract). The AP-side crumb reuses the ASCII "AP" literal exactly like the
 * sibling ap-billing/ap-pv (no DICT key for the AP-side crumb). Tokens back every colour (rule 6).
 * ZERO Thai/baht in this source (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toRetentionRow,
  formatMoney,
  millionsValue,
  sumRemaining,
  sumWithheld,
  sumReturned,
  contractCount,
  dueCount,
  statusMeta,
  isReleasable,
  isSettled,
  releaseAmount,
  type RetentionRow,
  type StatusMeta,
  type StatusTone,
} from "./ap-retention-rows";
import { useRetentionList, useReleaseRetention } from "./use-ap-retention";

const DASH = "—";

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** KPI card, inlined from ds.jsx Kpi (dashboard.jsx): label / value+unit / sub, accent. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  accent: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}
        >
          {value}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>
    </Card>
  );
}

/** Status-tone token map (prototype ds.jsx StatusBadge tones). */
const TONE: Readonly<Record<StatusTone, { bg: string; fg: string }>> = {
  pending: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  draft: { bg: "var(--surface-3)", fg: "var(--text-2)" },
  rejected: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  approved: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  neutral: { bg: "var(--surface-3)", fg: "var(--text-2)" },
};

/** StatusBadge pill: tokened bg/fg from the derived status tone. */
function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  const s = TONE[tone];
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** Extract an error message off an unknown mutation error (ar-cn / billing-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/**
 * The return-confirm dialog (prototype ctx.confirm at accounting-extra2.jsx L25-34), rendered as a
 * custom-footer modal so the confirm button can carry the ap.retention.modalReturnConfirm label
 * (the shared ConfirmDialog hardcodes common.confirm) — the gl-close.tsx pattern.
 *
 * MONEY: the preview amount is the SERVER `remaining`; the success toast amount is the SERVER
 * response `amount`. The body carries ONLY { ledger_id } (release mutation) — never an amount.
 */
function ReturnRetentionConfirm({ row, onClose }: { row: RetentionRow; onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const release = useReleaseRetention();

  // Preview: split the message on {amount} so the outstanding figure renders bold + mono (num),
  // matching the prototype's <b className="num"> around the amount. The trailing part carries the
  // baht glyph + JV note straight from the i18n value.
  const parts = t("ap.retention.modalReturnMessage").split("{amount}");

  const submit = () => {
    if (release.isPending) return; // defensive: the confirm button is disabled while pending.
    release.mutate(
      { ledger_id: row.id },
      {
        onSuccess: (res) => {
          const amt = releaseAmount(res);
          const amtStr = amt == null ? DASH : formatMoney(amt);
          const vendor = row.vendorName || DASH;
          ctx.notify(
            t("ap.retention.toastReturnDone")
              .replace("{amount}", amtStr)
              .replace("{vendor}", vendor),
          );
          onClose();
        },
        // 409 not-yet-due / already-released, 403 no-permission -> surface the server message
        // honestly and keep the modal open. Never a fabricated release.
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        {parts[0]}
        {parts.length > 1 && (
          <>
            <b className="num">{formatMoney(row.remaining)}</b>
            {parts[1]}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" disabled={release.isPending} onClick={submit}>
          {t("ap.retention.modalReturnConfirm")}
        </Btn>
      </div>
    </div>
  );
}

export function APRetention() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const retQ = useRetentionList();
  const rows = useMemo<RetentionRow[]>(() => (retQ.data ?? []).map(toRetentionRow), [retQ.data]);

  const held = sumRemaining(rows);
  const due = dueCount(rows);
  const withheld = sumWithheld(rows);
  const returned = sumReturned(rows);
  const contracts = contractCount(rows);

  const statusLabel = (meta: StatusMeta): string => {
    switch (meta.badge) {
      case "withholding":
        return t("ap.retention.stWithholding");
      case "holding":
        return t("ap.retention.stHolding");
      case "due":
        return t("ap.retention.stDue");
      case "partial":
        return t("ap.retention.stPartial");
      case "done":
        return t("ap.retention.stDone");
      default:
        return DASH;
    }
  };

  const openReturn = (r: RetentionRow) => {
    ctx.openModal({
      title: t("ap.retention.modalReturnTitle"),
      subtitle: r.vendorName || undefined,
      icon: "cash",
      iconTone: "var(--ok)",
      size: "sm",
      body: ({ close }: { close: () => void }) => <ReturnRetentionConfirm row={r} onClose={close} />,
    });
  };

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "AP", t("ap.retention.breadcrumbRetention")]}
      title={t("ap.retention.title")}
      subtitle={t("ap.retention.subtitle")}
      actions={
        <Btn
          kind="outline"
          size="md"
          icon="download"
          onClick={() => ctx.notify(t("ap.retention.exportName"))}
        >
          {t("common.export")}
        </Btn>
      }
    >
      {/* KPI strip (4) — all real from the register, MIXED scale (prototype accounting-extra2.jsx
          L44-47): held (Σremaining) + withheld (Σwithheld) shown in millions (÷1e6, pm.unitMillion);
          due = count of 'due' rows (unitContract); returned (Σreturned) in full baht (unitBaht). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("ap.retention.kpiHeldLabel")}
          value={millionsValue(held)}
          unit={t("pm.unitMillion")}
          sub={t("ap.retention.kpiHeldSub")}
          accent="var(--brand)"
        />
        <Kpi
          label={t("ap.retention.kpiDueLabel")}
          value={String(due)}
          unit={t("subcon.unitContract")}
          sub={t("ap.retention.kpiDueSub")}
          accent="var(--danger)"
        />
        <Kpi
          label={t("ap.retention.kpiWithheldLabel")}
          value={millionsValue(withheld)}
          unit={t("pm.unitMillion")}
          sub={t("ap.retention.kpiWithheldSub").replace("{n}", String(contracts))}
          accent="var(--text)"
        />
        <Kpi
          label={t("ap.retention.kpiReturnedLabel")}
          value={formatMoney(returned)}
          unit={t("subcon.unitBaht")}
          sub={t("ap.retention.kpiReturnedSub")}
          accent="var(--ok)"
        />
      </div>

      <Card pad={0}>
        {retQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th()}>{t("ap.retention.thContractVendor")}</th>
                <th style={th(120, true)}>{t("ap.retention.thWithheldCum")}</th>
                <th style={th(110, true)}>{t("ap.retention.thReturned")}</th>
                <th style={th(120, true)}>{t("ap.retention.thOutstanding")}</th>
                <th style={th(140)}>{t("ap.retention.thDueDate")}</th>
                <th style={th(140)}>{t("common.status")}</th>
                <th style={th(120)} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="cash" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{DASH}</div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const meta = statusMeta(r.status);
                  const releasable = isReleasable(r);
                  const settled = isSettled(r);
                  const isDue = r.status === "due";
                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: "1px solid var(--border)",
                        background: isDue
                          ? "color-mix(in srgb, var(--danger-soft) 45%, white)"
                          : "transparent",
                      }}
                    >
                      {/* contract / vendor: vendor_name (real, JOINED) + WO number em-dash (wire has
                          only wo_id, a UUID). */}
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>
                          {r.vendorName || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="num">
                          {DASH}
                        </div>
                      </td>
                      {/* withheld cumulative: real (formatMoney). */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.withheld)}
                      </td>
                      {/* returned: real; em-dash when nothing returned yet (prototype). */}
                      <td style={{ ...td, textAlign: "right", color: "var(--ok)" }} className="num">
                        {r.returned > 0 ? formatMoney(r.returned) : DASH}
                      </td>
                      {/* outstanding: SERVER remaining; em-dash (text-3) when fully returned. */}
                      <td
                        style={{
                          ...td,
                          textAlign: "right",
                          fontWeight: 800,
                          color: r.remaining > 0 ? "var(--brand)" : "var(--text-3)",
                        }}
                        className="num"
                      >
                        {r.remaining > 0 ? formatMoney(r.remaining) : DASH}
                      </td>
                      {/* due date: DERIVED ISO date (em-dash when null); a due row reads danger. */}
                      <td
                        style={{
                          ...td,
                          fontSize: 11.5,
                          color: isDue ? "var(--danger)" : "var(--text-2)",
                          fontWeight: isDue ? 700 : 500,
                        }}
                        className="num"
                      >
                        {r.dueDate || DASH}
                      </td>
                      {/* status: DERIVED display status -> tokened badge. */}
                      <td style={td}>
                        <StatusBadge tone={meta.tone} label={statusLabel(meta)} />
                      </td>
                      {/* action: releasable -> return button; settled -> icon-only complete mark
                          (the prototype's inline complete text has no key); else nothing. */}
                      <td style={{ ...td, textAlign: "right" }}>
                        {releasable ? (
                          <Btn kind="primary" size="sm" icon="cash" onClick={() => openReturn(r)}>
                            {t("ap.retention.btnReturn")}
                          </Btn>
                        ) : settled ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              color: "var(--ok)",
                            }}
                          >
                            <Icon name="check" size={15} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                <tr>
                  <td style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                    {t("ap.retention.footerTotal").replace("{n}", String(contracts))}
                  </td>
                  <td style={{ padding: 12, textAlign: "right", fontWeight: 700 }} className="num">
                    {formatMoney(withheld)}
                  </td>
                  <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "var(--ok)" }} className="num">
                    {formatMoney(returned)}
                  </td>
                  <td style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }} className="num">
                    {formatMoney(held)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/* Info footnote (prototype accounting-extra2.jsx L98-100). */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-3)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="info" size={13} />
          {t("ap.retention.infoLine")}
        </div>
      </Card>
    </Page>
  );
}
