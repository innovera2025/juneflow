/*
 * SubconProgress — the subcontractor progress console, ported from
 * pototype/subcon.jsx SubconProgress (L27-264) + CheckRow (L266-281). Route
 * subcon.progress (registry mod "subcon", file subcon.jsx). THIN-HONEST read
 * (Wei B-229 thin-honest ruling): the layout is the prototype's 100%, but only the live-backed
 * data is rendered — every un-backed value is an honest em-dash, nothing is minted.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb, the title/subtitle,
 * the two header actions, the 5-card MiniKpi strip, the 340px subcon list + the
 * right-hand detail (vendor header + DiffStat grid, the active-contract payment
 * timeline, the Variation Orders card + the closing checklist) are the prototype's.
 *
 * Data (rule 3, real-wire-over-mock): the prototype's SUBCONS / PROGRESS_PAYMENTS /
 * VARIATIONS mocks are dropped for the live feeds (use-subcon-progress.ts):
 *   GET /vendors?kind=subcon            -> the left subcon list.
 *   GET /subcon-contracts               -> grouped by vendor_id (subcon-progress-rows)
 *                                          for the per-vendor COUNT + Σ VALUE + the
 *                                          active contract.
 *   GET /subcon-contracts/{id}/periods  -> the selected contract's payment timeline
 *                                          (status -> the REAL enum badge, not the
 *                                          mock's labels; via subcon-accept-rows).
 * Pure narrowing / grouping / KPI-derivation / seq-sort / Σ live in
 * subcon-progress-rows.ts (unit-tested, G3). Money is DISPLAY-ONLY: KPI-2, the
 * per-vendor total, the contract value, and the timeline Σ are display sums of
 * server money values — never a JV/compute (money=NONE for this read).
 *
 * WIRE GAPS (reported honestly, never fabricated) — the thin-honest em-dashes:
 *   - KPI-3 paid / KPI-4 retention-held / KPI-5 pending-periods: no single feed
 *     sums them (paid/pending need an N+1 fan-out over every contract's periods;
 *     retention needs /dashboard/contractors) -> em-dash value, labels/units kept.
 *   - Vendor work-scope/type, contact, "since", and the work-lifecycle status chip
 *     (active/closing/pending) have NO wire field (vendors.ts) -> em-dash.
 *   - DiffStat paid / remaining / retention / variation: need the paid/retention
 *     fan-out or a variation feed -> em-dash (only statContractTotal is REAL).
 *   - Timeline paid / retention / GR-date columns: the period wire carries no
 *     paid amount, no period retention, no GR doc/date -> em-dash.
 *   - Variation Orders card: a variation_order attaches to a po_id only, never a
 *     subcon -> whole card honest-empty (header + disabled add + em-dash total).
 *   - Closing checklist: there is no "closed" concept beyond a period `paid`, so the
 *     flags render honest-static (done=false, no fabricated ✓); the netPayable line
 *     uses the REAL composite key subcon.closingRemainingInfo with em-dash amounts.
 *   - Report modal + Add form + approve/close: this is a THIN READ, so those write
 *     affordances are honest-DISABLED for fidelity (never a half-baked write).
 *
 * i18n (rule 2): every string is a subcon.* / common.* dict key (t), consume-only —
 * nothing minted (the netPayable composite is the existing subcon.closingRemainingInfo).
 * Tokens back every colour (rule 6); the two literal hexes (#0B2A4A avatar, /1000 "K"
 * magnitude) are prototype-verbatim. No Thai literal (and no baht glyph) sits here;
 * "·" / "%" / "K" / "—" are language-invariant symbols and the baht glyph comes from
 * the subcon.unitBaht key.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Avatar } from "../../ui/avatar";
import { Page } from "../../shell/page";
import { toContractRow, totalValue, millionsValue, formatMoney } from "./subcon-rows";
import { mapPeriodStatus, statusTone, type PeriodBadge } from "./subcon-accept-rows";
import {
  toSubconVendor,
  subconVendors,
  filterVendorsByName,
  vendorContractCount,
  vendorTotalValue,
  activeContractFor,
  workingVendorCount,
  toProgressPeriod,
  sortPeriodsBySeq,
  periodsTotal,
} from "./subcon-progress-rows";
import {
  useSubconVendors,
  useSubconContracts,
  useProgressPeriods,
} from "./use-subcon-progress";

const DASH = "—";
/** Language-invariant symbols (subcon.jsx) — never translated. */
const PERCENT_SIGN = "%";
const THOUSANDS_SUFFIX = "K";
/** Avatar seed colour (subcon.jsx:105), a prototype-verbatim hex (no token). */
const AVATAR_COLOR = "#0B2A4A";

/** The i18n label key for each acceptance badge (PERIOD_STATE, subcon-accept.jsx). */
const BADGE_LABEL: Record<PeriodBadge, DictKey> = {
  notReached: "subcon.statusNotReached",
  requested: "subcon.statusRequested",
  accepted: "subcon.kpiAccepted",
  rejected: "subcon.rejectBtn",
};

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the optional unit span). */
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
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}>
          {label}
        </span>
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

/** DiffStat, inlined from boq.jsx DiffStat (L1421): label + tone-coloured value + pct. */
function DiffStat({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: string;
  tone?: "danger" | "ok" | "strong" | "muted";
  pct?: string;
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "ok"
        ? "var(--ok)"
        : tone === "strong"
          ? "var(--text)"
          : "var(--text-2)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color }}>
        {value}
      </div>
      {pct && (
        <div
          style={{
            fontSize: 10.5,
            color: tone === "danger" ? "var(--danger)" : "var(--text-3)",
            fontWeight: 600,
            marginTop: 2,
          }}
        >
          {pct}
        </div>
      )}
    </div>
  );
}

/** StatusBadge (ds.jsx L91-108, size sm), tone from the mapped period display. */
function StatusBadge({ tone, label }: { tone: Parameters<typeof statusTone>[0]; label: string }) {
  const s = statusTone(tone);
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
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** CheckRow, inlined from subcon.jsx CheckRow (L266-281). done=false renders no ✓. */
function CheckRow({ label, done, note }: { label: string; done: boolean; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          background: done ? "var(--ok)" : "var(--surface)",
          border: done ? "none" : "1.5px solid var(--border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done && <Icon name="check" size={11} color="#fff" />}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: done ? "var(--text-3)" : "var(--text)",
            textDecoration: done ? "line-through" : "none",
          }}
        >
          {label}
        </div>
        {note && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

export function SubconProgress() {
  const { t } = useI18n();

  const vendorsQ = useSubconVendors();
  const contractsQ = useSubconContracts();

  const vendors = useMemo(
    () => subconVendors((vendorsQ.data ?? []).map(toSubconVendor)),
    [vendorsQ.data],
  );
  const contracts = useMemo(() => (contractsQ.data ?? []).map(toContractRow), [contractsQ.data]);

  // Left-list search — a pure client filter over the REAL subcon rows (no mock).
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterVendorsByName(vendors, query), [vendors, query]);

  // Selection: keep the picked vendor if still present, else fall back to the list head.
  const [selId, setSelId] = useState<string>("");
  const selected = vendors.find((v) => v.id === selId) ?? shown[0] ?? vendors[0];
  const selVendorId = selected?.id ?? "";

  // The active contract (first of the vendor — the wire has no status) + its periods.
  const activeContract = useMemo(
    () => activeContractFor(contracts, selVendorId),
    [contracts, selVendorId],
  );
  const activeContractId = activeContract?.id ?? "";
  const periodsQ = useProgressPeriods(activeContractId);
  const periods = useMemo(
    () => sortPeriodsBySeq((periodsQ.data ?? []).map(toProgressPeriod)),
    [periodsQ.data],
  );

  // KPI-1/2 (REAL, money-safe): subcon count + working count + Σ contract value.
  const subconCount = vendors.length;
  const workingCount = useMemo(() => workingVendorCount(vendors, contracts), [vendors, contracts]);
  const totalValueAll = useMemo(() => totalValue(contracts), [contracts]);

  // Per-vendor aggregates (REAL): contract count + Σ value.
  const perVendorCount = useMemo(
    () => vendorContractCount(contracts, selVendorId),
    [contracts, selVendorId],
  );
  const perVendorTotal = useMemo(
    () => vendorTotalValue(contracts, selVendorId),
    [contracts, selVendorId],
  );

  return (
    <Page
      breadcrumbs={[t("subcon.subcontractor"), t("subcon.progressBreadcrumb")]}
      title={t("subcon.progressTitle")}
      subtitle={t("subcon.progressSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* THIN READ: the report is mock-only -> honest-disabled (no half-baked write). */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("subcon.reportAllBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("subcon.addBtn")}
          </Btn>
        </div>
      }
    >
      {/* Top KPI strip (5): count + total value are REAL; paid / retention / pending
          have no single feed -> em-dash value, labels + units kept. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("subcon.kpiTotalLabel")}
          value={String(subconCount)}
          sub={t("subcon.kpiTotalSub").replace("{n}", String(workingCount))}
          tone="var(--brand)"
          icon="users"
        />
        <MiniKpi
          label={t("subcon.statContractTotal")}
          value={millionsValue(totalValueAll)}
          unit={t("subcon.unitMBaht")}
          sub={t("subcon.kpiAllProjects")}
          tone="var(--accent)"
          icon="ledger"
        />
        <MiniKpi
          label={t("subcon.kpiPaidLabel")}
          value={DASH}
          unit={t("subcon.unitMBaht")}
          sub={t("subcon.kpiPctOfTotal").replace("{pct}", DASH)}
          tone="var(--ok)"
          icon="cash"
        />
        <MiniKpi
          label={t("subcon.statRetention")}
          value={DASH}
          unit={t("subcon.unitMBaht")}
          sub={t("subcon.retentionReturn12mo")}
          tone="var(--info)"
          icon="paperclip"
        />
        <MiniKpi
          label={t("subcon.kpiPendingLabel")}
          value={DASH}
          sub={t("subcon.kpiPendingSubValue").replace("{value}", DASH)}
          tone="var(--warn)"
          icon="clock"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: subcon list (GET /vendors?kind=subcon). */}
        <Card pad={0}>
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("subcon.searchPh")}
              style={{ flex: 1, border: "none", outline: "none", fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          <div>
            {vendorsQ.isLoading ? (
              <div style={{ padding: 12 }}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    style={{
                      height: 64,
                      marginBottom: 8,
                      borderRadius: 8,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                    }}
                  />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                <Icon name="users" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                <div style={{ marginTop: 10, fontSize: 12.5 }}>{DASH}</div>
              </div>
            ) : (
              shown.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => setSelId(s.id)}
                  style={{
                    padding: 12,
                    borderTop: i ? "1px solid var(--border)" : "none",
                    background: s.id === selVendorId ? "var(--brand-soft)" : "transparent",
                    borderLeft: s.id === selVendorId ? "3px solid var(--brand)" : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{s.name}</div>
                    {/* Work-lifecycle status (active/closing/pending) has no wire field -> em-dash chip. */}
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--surface-3)",
                        color: "var(--text-3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {DASH}
                    </span>
                  </div>
                  {/* work-scope/type has no wire field -> em-dash; contract count is REAL. */}
                  <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 6 }}>
                    {DASH}
                    {" · "}
                    <span className="num">{vendorContractCount(contracts, s.id)}</span> {t("subcon.unitContract")}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                    <span className="num" style={{ fontWeight: 700, color: "var(--text)" }}>
                      {formatMoney(vendorTotalValue(contracts, s.id) / 1000)}
                      {THOUSANDS_SUFFIX} {t("subcon.unitBaht")}
                    </span>
                    {/* completion % has no wire field (would need the periods fan-out) -> em-dash. */}
                    <span style={{ color: "var(--text-3)" }}>{t("subcon.pctDone").replace("{pct}", DASH)}</span>
                  </div>
                  {/* progress bar: no completion source -> honest-empty track (0 fill). */}
                  <div
                    style={{
                      height: 4,
                      background: "var(--surface-3)",
                      borderRadius: 999,
                      marginTop: 5,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: "0%", height: "100%", background: "var(--accent)" }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Right: contract detail for the selected subcon. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {selected ? (
            <>
              {/* Header */}
              <Card pad={20}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <Avatar name={selected.name} color={AVATAR_COLOR} size={32} />
                      <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selected.name}</h2>
                        {/* type / contact / since have no wire field -> em-dash. */}
                        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                          {DASH} · {DASH} · {t("subcon.startedWork")} {DASH}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {/* THIN READ: contract-drilldown + contact have no backed target -> disabled
                        (the contract COUNT in the label is REAL). */}
                    <Btn kind="ghost" size="sm" icon="doc" disabled>
                      {t("subcon.contractsBtn").replace("{n}", String(perVendorCount))}
                    </Btn>
                    <Btn kind="ghost" size="sm" icon="user" disabled>
                      {t("subcon.contactBtn")}
                    </Btn>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: 12,
                    marginTop: 16,
                    padding: 14,
                    background: "var(--surface-2)",
                    borderRadius: 10,
                  }}
                >
                  {/* Only the per-vendor Σ contract value is REAL; the rest need the
                      paid/retention fan-out or a variation feed -> em-dash. */}
                  <DiffStat label={t("subcon.statContractTotal")} value={formatMoney(perVendorTotal)} tone="strong" />
                  <DiffStat label={t("subcon.statPaid")} value={DASH} tone="ok" pct={DASH} />
                  <DiffStat label={t("subcon.statRemaining")} value={DASH} tone="muted" />
                  <DiffStat
                    label={t("subcon.statRetention")}
                    value={DASH}
                    tone="muted"
                    pct={t("subcon.retentionReturn12mo")}
                  />
                  <DiffStat
                    label={t("subcon.statVariation")}
                    value={DASH}
                    tone="danger"
                    pct={t("subcon.itemsCount").replace("{n}", DASH)}
                  />
                </div>
              </Card>

              {/* Active contract + payment timeline */}
              <Card pad={0}>
                {activeContract ? (
                  <>
                    <div
                      style={{
                        padding: "14px 18px",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                          {t("subcon.activeContractTitle")}
                          <span
                            className="num"
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: "var(--brand-soft)",
                              color: "var(--brand)",
                            }}
                          >
                            {activeContract.no || DASH}
                          </span>
                        </div>
                        {/* work-scope has no wire field -> em-dash; start/end are REAL. */}
                        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                          {t("subcon.contractMeta")
                            .replace("{desc}", DASH)
                            .replace("{start}", activeContract.start || DASH)
                            .replace("{due}", activeContract.end || DASH)}
                        </div>
                      </div>
                      <span className="num" style={{ fontSize: 14, fontWeight: 700, color: "var(--brand)" }}>
                        {formatMoney(activeContract.value)} {t("subcon.unitBaht")}
                      </span>
                    </div>

                    <div style={{ padding: 18 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--text-2)",
                          marginBottom: 10,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Icon name="cash" size={14} />
                        {t("subcon.paymentPlanTitle")}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: "var(--text-3)" }}>
                            <th scope="col" style={th(36)}>{t("subcon.colPeriod")}</th>
                            <th scope="col" style={th()}>{t("subcon.colDetail")}</th>
                            <th scope="col" style={th(60)}>{PERCENT_SIGN}</th>
                            <th scope="col" style={th(110, true)}>{t("subcon.colValue")}</th>
                            <th scope="col" style={th(110, true)}>{t("subcon.colPaid")}</th>
                            <th scope="col" style={th(90, true)}>{t("subcon.colRetention")}</th>
                            <th scope="col" style={th(100)}>{t("subcon.colGrDate")}</th>
                            <th scope="col" style={th(110)}>{t("common.status")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periodsQ.isLoading ? (
                            [0, 1, 2, 3].map((n) => (
                              <tr key={n} style={{ borderTop: "1px solid var(--border)" }}>
                                <td colSpan={8} style={td}>
                                  <div style={{ height: 24, borderRadius: 6, background: "var(--surface-2)" }} />
                                </td>
                              </tr>
                            ))
                          ) : periods.length === 0 ? (
                            <tr>
                              <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                                <Icon name="cash" size={24} color="var(--text-3)" style={{ opacity: 0.5 }} />
                                <div style={{ marginTop: 8, fontSize: 12.5 }}>{DASH}</div>
                              </td>
                            </tr>
                          ) : (
                            periods.map((p) => {
                              const disp = mapPeriodStatus(p.status);
                              return (
                                <tr
                                  key={p.id}
                                  style={{
                                    borderTop: "1px solid var(--border)",
                                    background: disp.rowWarn ? "var(--warn-soft)" : "transparent",
                                  }}
                                >
                                  <td style={{ ...td, fontWeight: 700 }} className="num">
                                    {p.seq === 0 ? t("subcon.rowDp") : p.seq}
                                  </td>
                                  <td style={{ ...td, fontWeight: 500 }}>{p.title || DASH}</td>
                                  <td style={{ ...td, color: "var(--text-3)" }} className="num">
                                    {p.pct}
                                    {PERCENT_SIGN}
                                  </td>
                                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                                    {formatMoney(p.amount)}
                                  </td>
                                  {/* period paid amount has no wire field -> em-dash. */}
                                  <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
                                    {DASH}
                                  </td>
                                  {/* period retention has no wire field -> em-dash. */}
                                  <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
                                    {DASH}
                                  </td>
                                  {/* GR doc + date have no wire field -> em-dash. */}
                                  <td style={{ ...td, fontSize: 10.5, color: "var(--text-3)" }}>{DASH}</td>
                                  <td style={td}>
                                    <StatusBadge tone={disp.tone} label={t(BADGE_LABEL[disp.badge])} />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                        <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                          <tr>
                            <td colSpan={3} style={{ ...td, fontWeight: 700, textAlign: "right" }}>
                              {t("common.total")}
                            </td>
                            {/* Σ period value is REAL; paid + retention totals -> em-dash. */}
                            <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                              {formatMoney(periodsTotal(periods))}
                            </td>
                            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--text-3)" }} className="num">
                              {DASH}
                            </td>
                            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--text-3)" }} className="num">
                              {DASH}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="doc" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 12.5 }}>{DASH}</div>
                  </div>
                )}
              </Card>

              {/* Variations + closing */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
                {/* Variation Orders: no subcon-level variation feed -> honest-empty card. */}
                <Card pad={18}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{t("subcon.variationTitle")}</div>
                    <Btn kind="ghost" size="sm" icon="plus" disabled>
                      {t("subcon.addVrBtn")}
                    </Btn>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: "var(--text-3)" }}>
                        <th scope="col" style={th(90)}>{t("subcon.colNo")}</th>
                        <th scope="col" style={th(90)}>{t("subcon.colDate")}</th>
                        <th scope="col" style={th()}>{t("subcon.colReason")}</th>
                        <th scope="col" style={th(100, true)}>{t("subcon.colValue")}</th>
                        <th scope="col" style={th(80)}>{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                          {DASH}
                        </td>
                      </tr>
                      {/* adjusted contract value needs the variation Σ -> em-dash. */}
                      <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--surface-2)" }}>
                        <td colSpan={3} style={{ ...td, fontWeight: 700, textAlign: "right" }}>
                          {t("subcon.contractValueAdjusted")}
                        </td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--brand)" }} className="num">
                          {DASH}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </Card>

                {/* Closing checklist: no "closed" concept beyond a paid period -> honest-static. */}
                <Card pad={18}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("subcon.closingTitle")}</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <CheckRow label={t("subcon.checkAllPeriods")} done={false} />
                    <CheckRow label={t("subcon.checkHandover")} done={false} />
                    <CheckRow label={t("subcon.checkRetentionHandover")} done={false} />
                    <CheckRow label={t("subcon.checkRetentionWarranty")} done={false} />
                  </div>

                  {/* netPayable composite: the REAL subcon.closingRemainingInfo key, amounts
                      em-dashed (they need the paid/retention fan-out). */}
                  <div
                    style={{
                      marginTop: 14,
                      padding: 10,
                      background: "var(--info-soft)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "var(--info)",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <Icon name="info" size={14} />
                    <span>
                      {t("subcon.closingRemainingInfo").replace("{value}", DASH).replace("{value2}", DASH)}
                    </span>
                  </div>

                  {/* THIN READ: approve/close are writes -> honest-disabled. */}
                  <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                    <Btn kind="primary" size="sm" icon="check" disabled>
                      {t("subcon.approvePeriodBtn").replace("{n}", DASH)}
                    </Btn>
                    <Btn kind="ghost" size="sm" icon="flag" disabled>
                      {t("subcon.statusClosing")}
                    </Btn>
                  </div>
                </Card>
              </div>
            </>
          ) : (
            <Card pad={40}>
              <div style={{ textAlign: "center", color: "var(--text-3)" }}>
                <Icon name="users" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                <div style={{ marginTop: 10, fontSize: 13 }}>{DASH}</div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
