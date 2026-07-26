/*
 * GLJournalVoucher — the Journal Voucher list screen, ported from pototype/gl.jsx
 * GLJournalVoucher (L17-98). Route gl.jv (docs/extract/NAV-ROUTES.md L60, section "acct"),
 * visual-gate reference tests/visual/reference/gallery/g2/02-s.jpg.
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module,
 * JV screen), the title/subtitle, the Export + record-JV header actions, the 4-card MiniKpi
 * strip, the TabBar (all · manual · auto · pending), the filter-chip toolbar, and the list
 * table (no · date · description · lines · value · source · status) are the prototype's. The
 * record-JV modal is a real POST /gl/jv (jv-create-form.tsx).
 *
 * Data (rule 8): GET /gl/jv (use-gl.ts) via the generated client — the prototype's local
 * JV_LIST becomes the real server catalogue. The wire is { id, no, source_doc, memo, amount
 * (= Σ dr), currency_code, line_count, period_id, status, created_at } (apps/api gl.ts listJv):
 *   HONEST DIVERGENCES (never fabricated):
 *   - `status` is an honest null on the wire (jv has no status column) -> the status cell
 *     em-dashes (no badge).
 *   - the date cell shows the real `created_at` (ISO), the only date on the wire; there is no
 *     separate business/posting-date column.
 *   - the TabBar (manual/auto) + the "this month"/"manual"/"pending" KPI values need a
 *     classification/month/status the wire does not carry -> those KPI values em-dash and the
 *     tabs are PRESENTATIONAL (active fixed to "all"; they do not partition — mirrors gr-list
 *     / po-list degraded filters). The "Dr = Cr" KPI is a real invariant: every JV is balanced
 *     by construction (createJv rejects an unbalanced JV), so it shows the check.
 *   - the 4 filter chips are presentational ("all" values; the wire has no filter applied here).
 *   - source is the free-text `source_doc` label (badge text — data, not i18n); empty -> em-dash.
 *
 * i18n (rule 2): every string is a jv-strings.json phrase (tp) or an existing DICT key
 * (t: common.all / common.status / vendor.btnExport). gl.jv is a NEW screen, so most compound
 * keys are absent (jv-strings.json._missing) -> honest Thai, flagged for the Wave-2 i18n round.
 * Tokens back every colour (rule 6); the FA-auto source amber is prototype-verbatim (B-037(a),
 * jv-rows.ts). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { toJvRow, sourceTone, formatMoney, formatDate, type JvRow } from "./jv-rows";
import { useJvList } from "./use-gl";
import { JVCreateForm } from "./jv-create-form";
import jvStrings from "./jv-strings.json" with { type: "json" };

const DASH = "—";
const CHECK = "✓";

const P = (k: keyof typeof jvStrings): PhraseKey => jvStrings[k] as PhraseKey;

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

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gr-list). */
function MiniKpi({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
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
 * TabBar (ds.jsx TabBar). PRESENTATIONAL here: `active` is fixed to "all" and the tabs do not
 * partition the list (the wire has no manual/auto/status classification), so only the active
 * tab carries a count (the total). Kept for structural fidelity with the reference.
 */
function TabBar({ tabs }: { tabs: readonly { id: string; label: string; count?: number }[] }) {
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
            {tab.count != null && (
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
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Presentational filter chip (ds.jsx Filter muted visual). */
function FilterChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: muted ? "transparent" : "var(--surface-2)",
        fontSize: 11.5,
        color: "var(--text)",
        height: 32,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "var(--text-3)" : "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

export function GLJournalVoucher() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const jvQ = useJvList();
  const rows = useMemo<JvRow[]>(() => (jvQ.data ?? []).map(toJvRow), [jvQ.data]);

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("modalTitle")),
      subtitle: tp(P("modalSubtitle")),
      icon: "ledger",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <JVCreateForm onClose={close} />,
    });
  };

  const TABS = [
    { id: "all", label: t("common.all"), count: rows.length },
    { id: "manual", label: tp(P("kpiManualLabel")) },
    { id: "auto", label: tp(P("tabAuto")) },
    { id: "pending", label: tp(P("kpiPendingLabel")) },
  ];

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "GL", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("vendor.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("saveBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip: manual/month/pending need classification/month/status the wire lacks ->
          em-dash; the balance KPI is the real invariant (every JV is balanced) -> check. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={tp(P("kpiMonthLabel"))} value={DASH} tone="var(--brand)" icon="ledger" />
        <MiniKpi label={tp(P("kpiManualLabel"))} value={DASH} tone="var(--accent)" icon="edit" />
        <MiniKpi label={tp(P("kpiPendingLabel"))} value={DASH} tone="var(--warn)" icon="clock" />
        <MiniKpi label={tp(P("kpiBalancedLabel"))} value={CHECK} tone="var(--ok)" icon="check" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} />

        {/* Presentational filter toolbar (no filter applied to the query here). */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <FilterChip label={tp(P("filterPeriod"))} value={t("common.all")} />
          <FilterChip label={tp(P("filterSource"))} value={tp(P("filterAllSources"))} muted />
          <FilterChip label={tp(P("filterAccount"))} value={t("common.all")} muted />
          <FilterChip label={tp(P("filterCC"))} value={t("common.all")} />
        </div>

        {jvQ.isLoading ? (
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
                <th scope="col" style={th(110)}>{tp(P("thDate"))}</th>
                <th scope="col" style={th()}>{tp(P("thDesc"))}</th>
                <th scope="col" style={th(60)}>{tp(P("thLines"))}</th>
                <th scope="col" style={th(130, true)}>{tp(P("thValue"))}</th>
                <th scope="col" style={th(110)}>{tp(P("filterSource"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stone = sourceTone(r.sourceDoc);
                const date = formatDate(r.createdAt);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600 }} className="num">
                      <span style={{ color: "var(--brand)" }}>{r.no}</span>
                    </td>
                    <td style={{ ...td, color: "var(--text-3)" }} className="num">
                      {date || DASH}
                    </td>
                    <td style={td}>{r.memo || DASH}</td>
                    <td style={{ ...td, color: "var(--text-3)" }} className="num">
                      {r.lineCount}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.amount)}
                    </td>
                    <td style={td}>
                      {r.sourceDoc ? (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: stone.bg,
                            color: stone.fg,
                          }}
                        >
                          {r.sourceDoc}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                      )}
                    </td>
                    {/* status: honest null on the wire -> em-dash (no badge). */}
                    <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
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
