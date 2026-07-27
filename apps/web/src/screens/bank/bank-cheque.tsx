/*
 * BankCheque — the Cheque Register (ta-bian cheque) screen, ported from
 * pototype/bank.jsx BankCheque (L3-81). Route bank.cheque (docs/extract/
 * NAV-ROUTES.md L79, component BankCheque, section "bank"), visual-gate reference
 * tests/visual/reference/gallery/g2/14-s.jpg.
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb (finance section, bank
 * module, cheque screen), the title/subtitle, the filter + create-cheque header
 * actions, the 5-card MiniKpi strip, the TabBar (out · in · wait · return), and the
 * 8-column table (cheque no · bank/account · payee · PV/RV ref · amount · cheque-date ·
 * status · overflow) are the prototype's.
 *
 * Data: GET /bank/cheque (use-bank.ts) via the generated client — the prototype's local
 * cheque array becomes the real server catalogue. Row narrowing / by-status KPIs / tab
 * counts / status tone live in cheque-rows.ts (unit-tested, G3). The payee is resolved
 * from GET /ap/pv (pv_id -> pv.payee) where the back-linked PV is one of the seeded rows.
 *   HONEST GAPS (em-dashed, never fabricated) — the cheque wire (bank.ts chequeWire):
 *   - `pv_no` is an honest null on EVERY row (the pv table has no doc-number column) ->
 *     the "PV/RV ref" cell em-dashes.
 *   - the wire carries NO bank/account and NO cleared-date column -> the "bank/account"
 *     cell em-dashes and the per-row wait-days / cleared-date sub-lines are omitted.
 *   - the wire carries NO out/in direction and NO issue-month partition -> the "issued
 *     this month" + "received" KPIs em-dash, and the TabBar "received" count is 0
 *     (no in-direction rows identifiable). The waiting / cleared / returned counts +
 *     amounts and the status badge ARE real derivations off the loaded rows.
 *   - the payee em-dashes when the cheque's pv_id is null / outside the seeded PVs.
 *   - the filter action fires the prototype toast (client intent — no server filter).
 *
 * i18n: every string is a cheque-strings.json phrase (tp) or an existing DICT key
 * (t: common.status). Missing keys are flagged (cheque-strings.json._missing). Tokens
 * back every colour. NO Thai/baht in this .tsx (B-073).
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
  toChequeRow,
  chequeKpis,
  chequeTabCounts,
  chequeStatusKind,
  chequeStatusTone,
  formatMoney,
  formatMillions,
  type ChequeRow,
} from "./cheque-rows";
import { useBankCheque } from "./use-bank";
import { useApPvList } from "../ap/use-ap";
import { toPvRow } from "../ap/pv-rows";
import chequeStrings from "./cheque-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof chequeStrings): PhraseKey => chequeStrings[k] as PhraseKey;

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
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
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
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/**
 * TabBar (ds.jsx TabBar). PRESENTATIONAL: `active` is fixed to "out" and the tabs do
 * not partition the list (the prototype's own onChange is a no-op, bank.jsx L30), but
 * every tab carries its real count. Kept for structural fidelity with the reference.
 */
function TabBar({ tabs }: { tabs: readonly { id: string; label: string; count: number }[] }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = tab.id === "out";
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

/** Cheque status pill (bank.jsx L66-70): tokened bg/fg by status. */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = chequeStatusTone(status);
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
      }}
    >
      {label}
    </span>
  );
}

export function BankCheque() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const chequeQ = useBankCheque();
  const pvQ = useApPvList();

  const rows = useMemo<ChequeRow[]>(() => (chequeQ.data ?? []).map(toChequeRow), [chequeQ.data]);
  const kpis = useMemo(() => chequeKpis(rows), [rows]);
  const tabs = useMemo(() => chequeTabCounts(rows), [rows]);

  // Resolve a cheque's payee via its issuing PV (pv_id -> pv.payee); "" when the pv_id
  // is null or the PV is outside the seeded set (honest em-dash in the table).
  const payeeByPvId = useMemo(() => {
    const map = new Map<string, string>();
    for (const raw of pvQ.data ?? []) {
      const pv = toPvRow(raw);
      if (pv.id) map.set(pv.id, pv.payee);
    }
    return map;
  }, [pvQ.data]);

  const statusLabel = (status: string): string => {
    switch (chequeStatusKind(status)) {
      case "cleared":
        return tp(P("statusCleared"));
      case "returned":
        return tp(P("statusReturned"));
      default:
        return tp(P("statusWait"));
    }
  };

  const TABS = [
    { id: "out", label: tp(P("tabOut")), count: tabs.out },
    { id: "in", label: tp(P("tabIn")), count: tabs.received },
    { id: "wait", label: tp(P("tabWait")), count: tabs.wait },
    { id: "return", label: tp(P("tabReturn")), count: tabs.returned },
  ];

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), tp(P("crumbModule")), tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="filter" onClick={() => ctx.notify(tp(P("filterToast")))}>
            {tp(P("filterBtn"))}
          </Btn>
          {/* Create-cheque: no create endpoint in this task's scope -> prototype toast
              (client intent), the stand-in the ap/gl ports use. */}
          <Btn kind="primary" size="md" icon="plus" onClick={() => ctx.notify(tp(P("addBtn")))}>
            {tp(P("addBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5): "issued this month" + "received" need a direction/month
          partition the wire lacks -> em-dash; waiting/cleared/returned are real. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={tp(P("kpiMonthLabel"))} value={DASH} tone="var(--brand)" icon="paperclip" />
        <MiniKpi
          label={tp(P("kpiWaitLabel"))}
          value={String(kpis.waitCount)}
          sub={`${formatMillions(kpis.waitAmount)} ${tp(P("unitM"))}`}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={tp(P("kpiClearedLabel"))}
          value={String(kpis.clearedCount)}
          sub={`${formatMillions(kpis.clearedAmount)} ${tp(P("unitM"))}`}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi
          label={tp(P("kpiReturnedLabel"))}
          value={String(kpis.returnedCount)}
          sub={`${formatMoney(kpis.returnedAmount)} ${tp(P("baht"))}`}
          tone="var(--danger)"
          icon="warn"
        />
        <MiniKpi label={tp(P("kpiReceivedLabel"))} value={DASH} tone="var(--info)" icon="cash" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} />

        {chequeQ.isLoading ? (
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
                <th scope="col" style={th(120)}>{tp(P("thNo"))}</th>
                <th scope="col" style={th(140)}>{tp(P("thBank"))}</th>
                <th scope="col" style={th()}>{tp(P("thPayee"))}</th>
                <th scope="col" style={th(130)}>{tp(P("thRef"))}</th>
                <th scope="col" style={th(130, true)}>{tp(P("thAmount"))}</th>
                <th scope="col" style={th(110)}>{tp(P("thDate"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
                <th scope="col" style={th(36)} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const returned = chequeStatusKind(r.status) === "returned";
                const payee = r.pvId ? payeeByPvId.get(r.pvId) ?? "" : "";
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: returned ? "var(--danger-soft)" : "transparent",
                    }}
                  >
                    <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    {/* bank/account: no wire column -> em-dash (bank.ts GAP). */}
                    <td style={td}>{DASH}</td>
                    {/* payee: resolved via pv_id -> pv.payee; else honest em-dash. */}
                    <td style={td}>{payee || DASH}</td>
                    {/* PV/RV ref: pv_no honest null on the wire -> em-dash. */}
                    <td style={{ ...td, fontSize: 11.5 }} className="num">
                      <span style={{ color: "var(--brand)" }}>{r.pvNo || DASH}</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    {/* cheque date: real; wait-days / cleared-date sub-lines omitted (no wire field). */}
                    <td style={{ ...td, fontSize: 11.5 }}>{r.dueDate || DASH}</td>
                    <td style={td}>
                      <StatusBadge status={r.status} label={statusLabel(r.status)} />
                    </td>
                    <td style={td}>
                      <Icon name="more" size={14} color="var(--text-3)" />
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
