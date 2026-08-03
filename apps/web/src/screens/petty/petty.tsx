/*
 * PettyCash — the petty-cash register + balance screen, ported from
 * pototype/petty-alloc.jsx PettyCash (L12-117). Route `petty` (docs/extract/
 * NAV-ROUTES.md L40, component PettyCash, mod `petty`).
 *
 * Design fidelity (Juneflow §0): the two-part breadcrumb (finance section, petty
 * screen), the title/subtitle, the topup + new-claim header actions, the balance card
 * + 3-KPI strip, the TabBar (all · claim · clear · topup · pending), and the 8-column
 * table (no · type · item · category · claimant · date · amount · status) are the
 * prototype's. The new-claim action opens the PettyClaimForm modal (a real POST
 * /petty).
 *
 * Data: GET /petty (use-petty.ts) via the generated client — the prototype's local
 * PETTY_TX becomes the real server catalogue. The row narrowing / type sign / KPI +
 * tab counts / status tone live in petty-rows.ts (unit-tested, G3).
 *
 * HONEST DIVERGENCES (em-dashed / disabled, never fabricated) — recorded in the
 * REVIEW-QUEUE evidence:
 *   - the fund-balance CARD (prototype 14,270 / float 50,000 / % used / progress bar)
 *     has NO backing endpoint. A client rollup off the loaded page would be both a
 *     forbidden money computation (money=SERVER) and a wrong number (the page is not
 *     the whole fund) -> the balance / float / % / spent are em-dashed and the
 *     progress bar reads empty. The card KEEPS its structure (design fidelity).
 *   - the topup action has NO endpoint (PettyTopupForm is mock) ->
 *     honest-DISABLED button (no modal).
 *   - the "below reorder level" KPI has no reorder wire -> em-dash value (its sub is
 *     the static reorder-level descriptor). The other two KPIs (claims this month,
 *     pending) ARE real derivations off the loaded rows.
 *   - `no` / claimant `by` are nullable on the wire -> em-dash; `ref` -> no sub-line.
 *   - the TabBar changes the active highlight but does NOT partition the table — the
 *     prototype maps all rows regardless of the active tab (L89), so filtering would
 *     be an un-faithful "improvement". Counts are real.
 *
 * i18n: every string is a petty-strings.json phrase (tp) or an existing DICT key
 * (t: common.status / common.cancel). Tokens back every colour; the STATUS dot hexes
 * are prototype-verbatim (ds.jsx STATUS, petty-rows.ts). NO Thai/baht in this .tsx
 * (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toPettyRow,
  formatMoney,
  pettyTypeKind,
  pettyTypeTone,
  pettyAmountCell,
  statusTone,
  statusLabelKind,
  pettyDateCell,
  pettyTabCounts,
  pettyKpis,
  type PettyRow,
} from "./petty-rows";
import { usePettyList } from "./use-petty";
import { PettyClaimForm } from "./petty-form";
import pettyStrings from "./petty-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof pettyStrings): PhraseKey => pettyStrings[k] as PhraseKey;

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
  value: ReactNode;
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
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/**
 * TabBar (ds.jsx TabBar). Interactive active highlight (faithful to the prototype's
 * setTab, L64-72) but NON-partitioning — the prototype maps all rows regardless of the
 * active tab (L89), so this does not filter the table. Every tab carries a real count.
 */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: string; label: string; count: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "inherit",
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
          </button>
        );
      })}
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

/** The type badge cell (petty-alloc.jsx L92-98). */
function TypeBadge({ type, label }: { type: string; label: string }) {
  const tone = pettyTypeTone(pettyTypeKind(type));
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

export function PettyCash() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const pettyQ = usePettyList();
  const rows = useMemo<PettyRow[]>(() => (pettyQ.data ?? []).map(toPettyRow), [pettyQ.data]);
  const kpis = useMemo(() => pettyKpis(rows), [rows]);
  const counts = useMemo(() => pettyTabCounts(rows), [rows]);

  const [tab, setTab] = useState("all");

  const baht = tp(P("baht"));

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

  const typeLabel = (type: string): string => {
    switch (pettyTypeKind(type)) {
      case "clear":
        return tp(P("typeClear"));
      case "topup":
        return tp(P("typeTopup"));
      default:
        return tp(P("typeClaim"));
    }
  };

  const openCreate = () => {
    ctx.openModal({
      title: tp(P("modalTitle")),
      subtitle: tp(P("modalSubtitle")),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => <PettyClaimForm onClose={close} />,
    });
  };

  const TABS = [
    { id: "all", label: tp(P("tabAll")), count: counts.all },
    { id: "claim", label: tp(P("tabClaim")), count: counts.claim },
    { id: "clear", label: tp(P("tabClear")), count: counts.clear },
    { id: "topup", label: tp(P("tabTopup")), count: counts.topup },
    { id: "pending", label: tp(P("tabPending")), count: counts.pending },
  ];

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Topup has no endpoint (PettyTopupForm is mock) -> honest-disabled. */}
          <Btn kind="outline" size="md" icon="upload" disabled>
            {tp(P("topupBtn"))}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {tp(P("addBtn"))}
          </Btn>
        </div>
      }
    >
      {/* Balance card (em-dashed: no fund-balance wire) + 3-KPI strip. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card pad={20} style={{ background: "var(--brand)", color: "#fff", border: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11.5, opacity: 0.85, marginBottom: 6 }}>{tp(P("balanceLabel"))}</div>
              <div className="num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
                {DASH}{" "}
                <span style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}>{baht}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                {tp(P("fundSetPrefix"))} {DASH} {baht} · {tp(P("usedPrefix"))} {DASH}%
              </div>
            </div>
            <Icon name="cash" size={28} style={{ opacity: 0.5 }} />
          </div>
          {/* Progress bar — empty (unknown % used, no fund-balance wire). */}
          <div
            style={{
              height: 6,
              background: "rgba(255,255,255,0.2)",
              borderRadius: 999,
              marginTop: 14,
              overflow: "hidden",
            }}
          >
            <div style={{ width: "0%", height: "100%", background: "#fff" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, opacity: 0.75 }}>
            <span>
              {tp(P("spentLabel"))} {DASH}
            </span>
            <span>
              {tp(P("fundLabel"))} {DASH}
            </span>
          </div>
        </Card>

        <MiniKpi
          label={tp(P("kpiClaimMonth"))}
          value={String(kpis.claimMonthCount)}
          sub={`${formatMoney(kpis.claimMonthSum)} ${baht}`}
          tone="var(--accent)"
          icon="cart"
        />
        <MiniKpi
          label={tp(P("kpiPending"))}
          value={String(kpis.pendingCount)}
          sub={`${formatMoney(kpis.pendingSum)} ${baht}`}
          tone="var(--warn)"
          icon="clock"
        />
        {/* No reorder-level wire -> value em-dash; sub is the static descriptor. */}
        <MiniKpi
          label={tp(P("kpiBelowLimit"))}
          value={DASH}
          sub={tp(P("reorderNote"))}
          tone="var(--ok)"
          icon="check"
        />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {pettyQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  height: 44,
                  marginBottom: 4,
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th(140)}>{tp(P("thNo"))}</th>
                <th scope="col" style={th(100)}>{tp(P("thType"))}</th>
                <th scope="col" style={th()}>{tp(P("thItem"))}</th>
                <th scope="col" style={th(120)}>{tp(P("thCat"))}</th>
                <th scope="col" style={th(100)}>{tp(P("thBy"))}</th>
                <th scope="col" style={th(130)}>{tp(P("thDate"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thAmount"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: "center", color: "var(--text-3)", padding: 40 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const amount = pettyAmountCell(r);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                        {r.no || DASH}
                      </td>
                      <td style={td}>
                        <TypeBadge type={r.type} label={typeLabel(r.type)} />
                      </td>
                      <td style={td}>
                        <div>{r.label || DASH}</div>
                        {r.ref && (
                          <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="num">
                            {tp(P("refPrefix"))} {r.ref}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{r.cat || DASH}</td>
                      <td style={{ ...td, fontSize: 11.5 }}>{r.by || DASH}</td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>
                        {pettyDateCell(r) || DASH}
                      </td>
                      <td
                        style={{ ...td, textAlign: "right", fontWeight: 700, color: amount.color }}
                        className="num"
                      >
                        {amount.text}
                      </td>
                      <td style={td}>
                        <StatusBadge status={r.status} label={statusLabel(r.status)} />
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
