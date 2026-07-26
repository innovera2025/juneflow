/*
 * ARReceiveVoucher — the Receive Voucher (RV) screen, ported from
 * pototype/ar.jsx ARReceiveVoucher (L230-299) + RVCreateForm (L300-336, in
 * ar-rv-form.tsx). Route ar.rv (docs/extract/NAV-ROUTES.md L76, component
 * ARReceiveVoucher, section "acct").
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb (finance section, AR
 * module, RV screen), the title/subtitle, the Export + create-RV header actions, the
 * 4-card MiniKpi strip, and the 7-column table (RV no · payer · settled-AR · method ·
 * net received · date · status) are the prototype's. The create action opens the
 * RVCreateForm modal (a real POST /ar/rv).
 *
 * Data (rule 3): GET /ar/rv (use-ar-rv.ts) via the generated client — the
 * prototype's local RV array becomes the real server catalogue. Row narrowing /
 * method tone / KPI counts / status tone live in ar-rv-rows.ts (unit-tested, G3).
 *
 * REAL vs em-dash (honest, never fabricated) — see ar.ts rvWire + ar-rv-rows.ts:
 *   - RV no   -> REAL where present; em-dash on null (ar.ts createArRv sets no `no`).
 *   - payer   -> NO wire field (the rv row carries only an invoice_id FK, not a
 *                resolved customer/payer name) -> em-dash.
 *   - AR ref  -> the wire carries only the opaque invoice_id UUID, NOT the human
 *                invoice number the prototype shows -> em-dash (ap-pv "ref"
 *                precedent: a bare UUID FK is not a meaningful doc number). A
 *                retention-refund rv carries a null invoice_id -> also em-dashed.
 *   - method  -> REAL badge (transfer/cheque/cash) where present; em-dash on null.
 *   - net     -> REAL amount received (server system of record).
 *   - date    -> REAL receipt_date, falling back to created_at (both UTC); em-dash
 *                on missing/invalid.
 *   - status  -> REAL lifecycle: 'open' (recorded, awaiting GL post -> the pending
 *                treatment the posting inbox gives these rows) | 'posted'.
 *   EMPTY BY DESIGN (C10, gl-inbox honest-empty parallel): no rv rows are seeded
 *   (seed L1531 "no seeded rv (AR Phase-5-deferred)") -> the list renders empty and
 *   the method KPIs count a legitimate 0. A real rv is minted through the create
 *   form against a seeded unpaid invoice. This is correct, NOT a bug.
 *   KPIs: transfer / cheque / retention-refund counts are REAL derivations; "RV this
 *   month" needs a month partition the label implies but cannot be honestly derived
 *   (the wire carries an ambiguous receipt_date + created_at) -> value em-dash
 *   (ap-pv/gl-jv precedent). The mock KPI money sub-captions are omitted.
 *
 * Export (rule 8): no server endpoint -> the prototype's client-intent toast
 * (fin.toastExportExcel), the blessed presentational-action pattern (ap-pv export).
 *
 * i18n (rule 2): every string resolves via t() from the DICT (i18n-full.json) — the
 * ar.rv.* keys for this screen plus reused keys (fin.breadcrumbFinance, fin.method*
 * for the transfer KPI + method badges, fin.statusPending/fin.statusDraft for the
 * status labels, subcon.colDate for the date column, pm.exportBtn + fin.toastExportExcel
 * for Export, common.status). Tokens back every colour (rule 6); the StatusBadge dot
 * hexes are prototype-verbatim (B-037(a), ar-rv-rows.ts). ZERO Thai/baht in this
 * .tsx (B-073) — every glyph lives only in i18n-full.json.
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toRvRow,
  rvKpis,
  formatMoney,
  formatDate,
  methodKey,
  methodTone,
  statusKind,
  statusTone,
  type MethodKey,
  type RvRow,
} from "./ar-rv-rows";
import { useArRvList } from "./use-ar-rv";
import { RVCreateForm } from "./ar-rv-form";

const DASH = "—";
/** The prototype's verbatim ASCII posted-tag text (gl-inbox precedent; no Thai key). */
const POSTED_TAG = "posted";

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

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gl-inbox / ap-pv). */
function MiniKpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** Method pill (ar.jsx L282-286): tokened tint by method. */
function MethodBadge({ label, tone }: { label: ReactNode; tone: { bg: string; fg: string } }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {label}
    </span>
  );
}

export function ARReceiveVoucher() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const rvQ = useArRvList();
  const rows = useMemo<RvRow[]>(() => (rvQ.data ?? []).map(toRvRow), [rvQ.data]);
  const kpis = useMemo(() => rvKpis(rows), [rows]);

  const statusLabel = (status: string): string => {
    switch (statusKind(status)) {
      case "posted":
        return POSTED_TAG;
      case "open":
        return t("fin.statusPending");
      default:
        return t("fin.statusDraft");
    }
  };

  const methodLabel = (key: Exclude<MethodKey, "">): string => {
    switch (key) {
      case "transfer":
        return t("fin.methodTransfer");
      case "cheque":
        return t("fin.methodCheque");
      case "cash":
        return t("fin.methodCash");
    }
  };

  const openCreate = () => {
    ctx.openModal({
      title: t("ar.rv.modalTitle"),
      subtitle: t("ar.rv.modalSubtitle"),
      icon: "cash",
      iconTone: "var(--ok)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <RVCreateForm onClose={close} />,
    });
  };

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "AR", t("ar.rv.breadcrumb")]}
      title={t("ar.rv.title")}
      subtitle={t("ar.rv.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("fin.toastExportExcel"))}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("ar.rv.btnNew")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): "RV this month" -> em-dash (month partition not honestly
          derivable); transfer / cheque / retention-refund counts are real. The mock
          money sub-captions are omitted (po-list precedent). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={t("ar.rv.kpiMonth")} value={DASH} tone="var(--ok)" icon="cash" />
        <MiniKpi label={t("fin.methodTransfer")} value={String(kpis.transferCount)} tone="var(--info)" icon="sync" />
        <MiniKpi label={t("ar.rv.kpiCheque")} value={String(kpis.chequeCount)} tone="var(--warn)" icon="paperclip" />
        <MiniKpi label={t("ar.rv.kpiRetention")} value={String(kpis.retentionCount)} tone="var(--accent)" icon="ledger" />
      </div>

      <Card pad={0}>
        {rvQ.isLoading ? (
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
                <th scope="col" style={th(140)}>{t("ar.rv.thNo")}</th>
                <th scope="col" style={th()}>{t("ar.rv.thPayer")}</th>
                <th scope="col" style={th(140)}>{t("ar.rv.thArRef")}</th>
                <th scope="col" style={th(110)}>{t("ar.rv.thMethod")}</th>
                <th scope="col" style={th(120, true)}>{t("ar.rv.thNet")}</th>
                <th scope="col" style={th(110)}>{t("subcon.colDate")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mk = methodKey(r.method);
                const date = formatDate(r.receiptDate, r.createdAt);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* RV no: nullable on the wire -> em-dash. */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    {/* payer: no wire field -> em-dash. */}
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                    {/* AR ref: only the opaque invoice_id UUID on the wire -> em-dash. */}
                    <td style={{ ...td, color: "var(--text-3)" }} className="num">
                      {DASH}
                    </td>
                    <td style={td}>
                      {mk === "" ? (
                        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                      ) : (
                        <MethodBadge label={methodLabel(mk)} tone={methodTone(mk)} />
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                      {date || DASH}
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
