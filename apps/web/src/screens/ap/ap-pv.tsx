/*
 * APPaymentVoucher — the Payment Voucher (bai-samkan-jai) screen, ported from
 * pototype/ap.jsx APPaymentVoucher (L167-234). Route ap.pv (docs/extract/
 * NAV-ROUTES.md L69, component APPaymentVoucher, section "acct"), visual-gate
 * reference tests/visual/reference/gallery/g2/08-s.jpg.
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb (finance section, AP
 * module, PV screen), the title/subtitle, the Export-Excel + create-PV header
 * actions, the 4-card MiniKpi strip, and the 9-column table (PV no · payee · ref ·
 * method · cheque no · amount · WHT · net · status) are the prototype's. The create
 * action opens the PVCreateForm modal (a real POST /ap/pv).
 *
 * Data: GET /ap/pv (use-ap.ts) via the generated client — the prototype's local
 * PV_LIST becomes the real server catalogue. Row narrowing / method tone / KPIs /
 * status tone live in pv-rows.ts (unit-tested, G3). `wht` + `net` are the server's
 * tax-engine results (system of record).
 *   HONEST GAPS (em-dashed, never fabricated) — the pv wire (ap.ts pvWire):
 *   - `no` is an honest null on EVERY row (pv has no doc-number column) -> the "PV
 *     number" cell em-dashes.
 *   - the prototype's "ref-from" column is the source AP's doc-number, which is ALSO null
 *     (ap_billing has no doc-number) -> the ref cell em-dashes (the wire only carries
 *     billing_ids UUIDs, not a meaningful AP number).
 *   - `method` / `cheque_no` are nullable -> null em-dashes.
 *   - the "PV this month" KPI needs a month partition the label implies but the
 *     screen cannot honestly derive -> em-dash (gl-jv precedent); the pending count +
 *     WHT/Retention totals ARE real derivations off the loaded rows.
 *   - the mock KPI money sub-captions (unkeyed fabricated figures) are omitted
 *     (po-list precedent).
 *   - the server-enforced PV approval ladder (POST /pv/{id}/approve) is WIRED as a
 *     typed hook (use-ap.ts useApprovePv) but NOT surfaced here: the prototype list
 *     has no approve affordance (only a status badge, ap.jsx L226) and adding a
 *     button would violate design fidelity (flagged for a future approval flow).
 *   - Export has no server endpoint -> the prototype's export toast (client intent).
 *
 * i18n: every string is a pv-strings.json phrase (tp) or an existing DICT key
 * (t: common.status). Missing keys are flagged (pv-strings.json._missing). Tokens
 * back every colour; the STATUS dot hexes are prototype-verbatim (B-037(a),
 * pv-rows.ts). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toPvRow,
  pvKpis,
  formatMoney,
  formatThousands0,
  formatDate,
  methodKey,
  methodTone,
  statusTone,
  statusLabelKind,
  type MethodKey,
  type PvRow,
} from "./pv-rows";
import { useApPvList } from "./use-ap";
import { PVCreateForm } from "./pv-create-form";
import pvStrings from "./pv-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof pvStrings): PhraseKey => pvStrings[k] as PhraseKey;

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

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as ap-billing). */
function MiniKpi({
  label,
  value,
  unit,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
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
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
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

/** Method pill (ap.jsx L214-221): tokened tint by method, cheque_bank sub-line. */
function MethodCell({ label, bank, tone }: { label: ReactNode; bank: string; tone: { bg: string; fg: string } }) {
  return (
    <>
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
      {bank && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{bank}</div>}
    </>
  );
}

export function APPaymentVoucher() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const pvQ = useApPvList();
  const rows = useMemo<PvRow[]>(() => (pvQ.data ?? []).map(toPvRow), [pvQ.data]);
  const kpis = useMemo(() => pvKpis(rows), [rows]);

  const statusLabel = (status: string): string => {
    switch (statusLabelKind(status)) {
      case "pending":
        return tp(P("statusPending"));
      case "approved":
        return tp(P("statusApproved"));
      case "rejected":
        return tp(P("statusRejected"));
      default:
        return tp(P("statusDraft"));
    }
  };

  const methodLabel = (key: MethodKey): string => {
    switch (key) {
      case "cash":
        return tp(P("methodCash"));
      case "transfer":
        return tp(P("methodListTransfer"));
      case "cheque":
        return tp(P("methodCheque"));
      case "deposit":
        return tp(P("methodDeposit"));
      default:
        return DASH;
    }
  };

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("modalTitle")),
      subtitle: tp(P("modalSubtitle")),
      icon: "cash",
      iconTone: "var(--brand)",
      size: "xl",
      body: ({ close }: { close: () => void }) => <PVCreateForm onClose={close} />,
    });
  };

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "AP", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {tp(P("exportBtn"))}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("addBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): "this month" needs a month partition -> em-dash (gl-jv
          precedent); pending count + WHT/Retention totals are real derivations. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={tp(P("kpiMonthLabel"))} value={DASH} tone="var(--brand)" icon="cash" />
        <MiniKpi label={tp(P("kpiPendingLabel"))} value={String(kpis.pendingCount)} tone="var(--warn)" icon="clock" />
        <MiniKpi
          label={tp(P("kpiWhtLabel"))}
          value={formatThousands0(kpis.whtTotal)}
          unit={tp(P("unitK"))}
          tone="var(--info)"
          icon="paperclip"
        />
        <MiniKpi
          label={tp(P("kpiRetentionLabel"))}
          value={formatThousands0(kpis.retentionTotal)}
          unit={tp(P("unitK"))}
          tone="var(--accent)"
          icon="ledger"
        />
      </div>

      <Card pad={0}>
        {pvQ.isLoading ? (
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
                <th style={th(130)}>{tp(P("thNo"))}</th>
                <th style={th()}>{tp(P("thPayee"))}</th>
                <th style={th(130)}>{tp(P("thRef"))}</th>
                <th style={th(110)}>{tp(P("thMethod"))}</th>
                <th style={th(120)}>{tp(P("thCheque"))}</th>
                <th style={th(120, true)}>{tp(P("thAmount"))}</th>
                <th style={th(90, true)}>{tp(P("thWht"))}</th>
                <th style={th(110, true)}>{tp(P("thNet"))}</th>
                <th style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mk = methodKey(r.method);
                const date = formatDate(r.createdAt);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* PV no: honest null on the wire -> em-dash (ap.ts GAP). */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    <td style={td}>
                      {r.payee || DASH}
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{date || DASH}</div>
                    </td>
                    {/* ref: the source AP doc-number is also null on the wire -> em-dash. */}
                    <td style={{ ...td, color: "var(--brand)" }} className="num">
                      {DASH}
                    </td>
                    <td style={td}>
                      {mk === "" ? (
                        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                      ) : (
                        <MethodCell label={methodLabel(mk)} bank={r.chequeBank} tone={methodTone(mk)} />
                      )}
                    </td>
                    {/* cheque no: nullable -> em-dash. */}
                    <td style={{ ...td, fontSize: 11.5 }} className="num">
                      {r.chequeNo ? r.chequeNo : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "var(--info)" }} className="num">
                      -{formatMoney(r.wht)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.net)}
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
