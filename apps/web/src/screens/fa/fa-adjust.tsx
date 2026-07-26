/*
 * FAAdjust — the "revalue / write-off" screen, ported from pototype/fa.jsx FAAdjust (L583-661).
 * Route fa.adjust (docs/extract/NAV-ROUTES.md L87, section "acct"). Mirrors the just-merged
 * gl-inbox.tsx (dict t() keys, generated client + unwrap, inlined primitives, honest wiring).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the three-part breadcrumb (finance section, assets
 * module, adjust screen), the title/subtitle, the Revalue + Write-Off header actions, the TabBar
 * (all / revalue / write-off / sale), and the history table (no / kind / asset / reason /
 * before / after / gain-loss / date / status) are the prototype's.
 *
 * Data (rule 8): GET /fa/adjustments (use-fa-depr.ts) via the generated client — the prototype's
 * local ADJ_ROWS becomes the real server history. Create flows -> POST /fa/revalue /
 * POST /fa/write-off (revalue-form.tsx / write-off-form.tsx); each creates the (approved)
 * adjustment AND posts in ONE call (there is no draft->approve step — the server owns the posting).
 *
 * REAL vs em-dash (honest, never fabricated) — see fa-adjust-rows.ts:
 *   - "no" -> the real record id (no document-number column on the wire).
 *   - kind -> the real wire kind (revalue / write_off) as a coloured badge; the server writes no
 *     'sale' kind, so the sale tab is always 0 (honest empty, mirrors gl.inbox scheduled/error).
 *   - reason -> the real memo (em-dash when empty).
 *   - before / after -> the single wire `amount` placed by kind (adjustColumns): a revalue's amount
 *     is the NEW value -> "after" (before em-dashes); a write_off's amount is the REMOVED book value
 *     -> "before" (after em-dashes). gain/loss -> NO wire figure -> always em-dash (never a 0).
 *   - date -> the real created_at (UTC); status -> the real 'approved' badge.
 *   The TabBar is PRESENTATIONAL (active fixed to "all"; the counts are real per kind) — the
 *   prototype's tabs did not filter either (onChange noop, fa.jsx L621).
 *
 * i18n (rule 2): reused column keys (subcon.colNo / fa.breadcrumbAssets / subcon.colType /
 * subcon.colReason / subcon.colDate / common.status) + fa.adjust.* / fa.statusWriteoff /
 * fin.statusApproved / subcon.unitBaht / fin.breadcrumbFinance / common.all. Tokens back every
 * colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  adjustColumns,
  adjustKindMeta,
  countByKind,
  formatDate,
  formatMoney,
  toFaAdjustment,
  type AdjustTab,
  type FaAdjustment,
} from "./fa-adjust-rows";
import { useFaAdjustments } from "./use-fa-depr";
import { RevalueForm } from "./revalue-form";
import { WriteOffForm } from "./write-off-form";
import { AdjustDetail } from "./adjust-detail";

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

/** Map an adjustment kind to its blessed label key (raw kind for the unknown branch). */
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

/** Kind pill (ds.jsx tag): soft token background + tone from the wire kind. */
function KindBadge({ kind, label }: { kind: string; label: string }) {
  const meta = adjustKindMeta(kind);
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {label}
    </span>
  );
}

/** Status pill. The server writes 'approved' (ok tone); an unknown status is neutral surface. */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const approved = status === "approved";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: approved ? "var(--ok-soft)" : "var(--surface-3)",
        color: approved ? "var(--ok)" : "var(--text-2)",
      }}
    >
      {label}
    </span>
  );
}

/** Presentational TabBar (ds.jsx TabBar). active fixed to "all"; counts are real per kind. */
function TabBar({ tabs }: { tabs: readonly { id: AdjustTab; label: string; count: number }[] }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = tab.id === "all";
        return (
          <div
            key={tab.id}
            style={{
              padding: "15px 14px",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {tab.label}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: on ? "var(--brand)" : "var(--surface-3)",
                color: on ? "#fff" : "var(--text-2)",
              }}
            >
              {tab.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A right-aligned money cell or an em-dash (honest gap). */
function moneyOrDash(value: number | null): ReactNode {
  if (value == null) return <span style={{ color: "var(--text-3)" }}>{DASH}</span>;
  return (
    <span className="num" style={{ fontWeight: 600 }}>
      {formatMoney(value)}
    </span>
  );
}

export function FAAdjust() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const adjQ = useFaAdjustments();
  const rows = useMemo<FaAdjustment[]>(() => (adjQ.data ?? []).map(toFaAdjustment), [adjQ.data]);

  const openRevalue = () => {
    ctx.openModal({
      title: t("fa.revalue.title"),
      subtitle: t("fa.revalue.subtitle"),
      icon: "trend",
      iconTone: "var(--ok)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <RevalueForm onClose={close} />,
    });
  };

  const openWriteOff = () => {
    ctx.openModal({
      title: t("fa.writeoff.title"),
      subtitle: t("fa.writeoff.subtitle"),
      icon: "x",
      iconTone: "var(--danger)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <WriteOffForm onClose={close} />,
    });
  };

  const openDetail = (row: FaAdjustment) => {
    ctx.openModal({
      title: `${row.id} · ${kindLabel(t, row.kind)}`,
      subtitle: `${row.assetId} · ${formatDate(row.createdAt) || DASH}`,
      icon: "doc",
      iconTone: adjustKindMeta(row.kind).fg,
      size: "md",
      body: ({ close }: { close: () => void }) => <AdjustDetail row={row} onClose={close} />,
    });
  };

  const TABS: readonly { id: AdjustTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: countByKind(rows, "all") },
    { id: "revalue", label: t("fa.adjust.btnRevalue"), count: countByKind(rows, "revalue") },
    { id: "write_off", label: t("fa.statusWriteoff"), count: countByKind(rows, "write_off") },
    { id: "sale", label: t("fa.adjust.tabSale"), count: countByKind(rows, "sale") },
  ];

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("fa.breadcrumbAssets"), t("fa.breadcrumbAdjust")]}
      title={t("fa.adjust.title")}
      subtitle={t("fa.adjust.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="trend" onClick={openRevalue}>
            {t("fa.adjust.btnRevalue")}
          </Btn>
          <Btn kind="danger" size="md" icon="x" onClick={openWriteOff}>
            {t("fa.adjust.btnWriteoffSale")}
          </Btn>
        </div>
      }
    >
      <Card pad={0}>
        <TabBar tabs={TABS} />

        {adjQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
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
                <th scope="col" style={th(140)}>{t("subcon.colNo")}</th>
                <th scope="col" style={th(100)}>{t("subcon.colType")}</th>
                <th scope="col" style={th(110)}>{t("fa.breadcrumbAssets")}</th>
                <th scope="col" style={th()}>{t("subcon.colReason")}</th>
                <th scope="col" style={th(120, true)}>{t("fa.adjust.colBefore")}</th>
                <th scope="col" style={th(120, true)}>{t("fa.adjust.colAfter")}</th>
                <th scope="col" style={th(110, true)}>{t("fa.adjust.colGainLoss")}</th>
                <th scope="col" style={th(110)}>{t("subcon.colDate")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("gl.inbox.emptyFiltered")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const date = formatDate(r.createdAt);
                  const cols = adjustColumns(r);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openDetail(r)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <td style={{ ...td, fontWeight: 600 }} className="num">
                        <span style={{ color: "var(--brand)" }}>{r.id}</span>
                      </td>
                      <td style={td}>
                        <KindBadge kind={r.kind} label={kindLabel(t, r.kind)} />
                      </td>
                      <td style={td} className="num">
                        <span style={{ color: "var(--brand)" }}>{r.assetId || DASH}</span>
                      </td>
                      <td style={td}>{r.memo || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}</td>
                      {/* before/after: the single wire amount placed by kind (write_off -> before, revalue -> after); the empty side em-dashes */}
                      <td style={{ ...td, textAlign: "right" }}>{moneyOrDash(cols.before)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{moneyOrDash(cols.after)}</td>
                      {/* gain/loss: no wire figure -> em-dash (never a fabricated 0) */}
                      <td style={{ ...td, textAlign: "right" }}>{moneyOrDash(null)}</td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                        {date || DASH}
                      </td>
                      <td style={td}>
                        <StatusBadge status={r.status} label={r.status === "approved" ? t("fin.statusApproved") : r.status || DASH} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
