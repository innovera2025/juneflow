/*
 * APDeposit — the AP vendor-deposit register (Vendor Deposit), ported from
 * pototype/ap.jsx APDeposit (L388-448). Route ap.deposit (routes/registry.ts:145,
 * component APDeposit, section "acct").
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb (finance section · AP ·
 * deposit screen), the title/subtitle, the single create ("new deposit") header action
 * (no Export, unlike ap.billing), the 3-card MiniKpi strip, and the 7-column register
 * table (no · vendor/reason · po-wo ref · deposit · offset · balance · status) are the
 * prototype's. The create action opens the APDepositForm modal (a real POST /ap/deposit).
 *
 * Data: GET /ap/deposit (use-ap.ts) via the generated client — the prototype's local
 * mock array becomes the real server register. Row narrowing / KPI + status derivation /
 * money formatting live in deposit-rows.ts (unit-tested, G3).
 *   HONEST DIVERGENCES (§0 rule 3 — real-wire-over-mock):
 *   - the 3 KPIs are prototype-mock literals (ap.jsx L401-403); here they are REAL
 *     derivations off the loaded rows (outstanding balance / used / YTD amount) —
 *     never re-printed literals. The offset KPI has no per-offset date on the wire,
 *     so it is offset-to-date off the loaded rows, not month-scoped (deposit-rows.ts).
 *   - the register is EMPTY on a fresh seeded DB (no ap_deposit seed rows) -> the
 *     empty-state renders (apps/web/CLAUDE.md) + a loading skeleton until a POST lands.
 *   - `balance` is SERVER-computed (amount - used, read off the wire); a 0 balance
 *     renders an em-dash (prototype L433). The cleared/outstanding badge is DERIVED
 *     client-side from balance === 0 (the wire never ships a Thai UI string).
 *   - vendor_name / ref / reason are nullable joins -> honest em-dash, never fabricated.
 *
 * i18n: every string is an ap-deposit-strings.json phrase (tp) or an existing DICT key
 * (t: common.status). Missing compound keys are flagged (ap-deposit-strings.json
 * ._missing) -> honest Thai for the Wave-2 round. Tokens back every colour. NO Thai/baht
 * in this .tsx (B-073).
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
  toDepositRow,
  depositKpis,
  depositStatusKind,
  depositStatusTone,
  formatMoney,
  formatMillions,
  type DepositRow,
} from "./deposit-rows";
import { useApDepositList } from "./use-ap";
import { APDepositForm } from "./ap-deposit-form";
import depositStrings from "./ap-deposit-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof depositStrings): PhraseKey => depositStrings[k] as PhraseKey;

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
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
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
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** Deposit status badge (ap.jsx L435-439): binary cleared/outstanding, no dot. */
function DepositBadge({ balance, label }: { balance: number; label: string }) {
  const tone = depositStatusTone(balance);
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

export function APDeposit() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const depositQ = useApDepositList();
  const rows = useMemo<DepositRow[]>(
    () => (depositQ.data ?? []).map(toDepositRow),
    [depositQ.data],
  );
  const kpis = useMemo(() => depositKpis(rows), [rows]);

  const badgeLabel = (balance: number): string =>
    depositStatusKind(balance) === "cleared"
      ? tp(P("statusCleared"))
      : tp(P("statusOutstanding"));

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("modalTitle")),
      subtitle: tp(P("modalSubtitle")),
      icon: "cash",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => <APDepositForm onClose={close} />,
    });
  };

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "AP", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
          {tp(P("addBtn"))}
        </Btn>
      }
    >
      {/* KPI strip (3) — all derived from the loaded rows (balance / used / amount). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={tp(P("kpiOutstandingLabel"))}
          value={String(kpis.outstandingCount)}
          sub={`${formatMillions(kpis.outstandingSum)} ${tp(P("unitM"))}`}
          tone="var(--warn)"
          icon="cash"
        />
        <MiniKpi
          label={tp(P("kpiOffsetLabel"))}
          value={String(kpis.offsetCount)}
          sub={`${formatMillions(kpis.offsetSum)} ${tp(P("unitM"))}`}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi
          label={tp(P("kpiYtdLabel"))}
          value={formatMillions(kpis.ytdSum)}
          unit={tp(P("unitM"))}
          sub={`${kpis.ytdCount} ${tp(P("unitItems"))}`}
          tone="var(--brand)"
          icon="ledger"
        />
      </div>

      <Card pad={0}>
        {depositQ.isLoading ? (
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
                <th scope="col" style={th(140)}>{tp(P("thNo"))}</th>
                <th scope="col" style={th()}>{tp(P("thVendor"))}</th>
                <th scope="col" style={th(120)}>{tp(P("thRef"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thAmount"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thUsed"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thBalance"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
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
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* no: server-allocated DP-no (brand). */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    {/* vendor / reason: joined vendor_name + reason -> em-dash each when null. */}
                    <td style={td}>
                      <div>{r.vendorName || DASH}</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.reason || DASH}</div>
                    </td>
                    {/* po-wo ref: joined ref (po.no ?? wo.no) -> em-dash when unresolved. */}
                    <td style={td} className="num">
                      {r.ref ? <span style={{ color: "var(--brand)" }}>{r.ref}</span> : DASH}
                    </td>
                    {/* deposit amount: stored amount. */}
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    {/* offset (used): 0 renders "0" (prototype L432). */}
                    <td style={{ ...td, textAlign: "right", color: "var(--ok)" }} className="num">
                      {formatMoney(r.used)}
                    </td>
                    {/* balance: SERVER-computed; 0 -> em-dash (prototype L433). */}
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 700,
                        color: r.balance > 0 ? "var(--warn)" : "var(--text-3)",
                      }}
                      className="num"
                    >
                      {r.balance === 0 ? DASH : formatMoney(r.balance)}
                    </td>
                    {/* status: badge DERIVED client-side from balance === 0. */}
                    <td style={td}>
                      <DepositBadge balance={r.balance} label={badgeLabel(r.balance)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
