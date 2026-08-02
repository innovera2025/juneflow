/*
 * AcceptanceCenter — the acceptance center, ported from
 * pototype/company-accept.jsx AcceptanceCenter (L121-222) + the ACCEPT_TYPES config
 * (L102-107). Route `accept` (docs/extract/NAV-ROUTES.md L41, registry.ts L113,
 * parent —, prototype file company-accept.jsx). The sibling CompanySwitcher chrome in
 * the same prototype file is a DIFFERENT route and is NOT ported here.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb, title/subtitle, the
 * Export header action, the 5-card KPI strip, the tab bar (all · subcon · gr · pm ·
 * handover · rejected) + search, the 8-column queue table with the per-type badge,
 * the read-only footer notice, and the row-click detail modal are the prototype's.
 *
 * Data (§0 rule 8): GET /acceptance-center (use-accept.ts) via the generated client —
 * the single mock ACCEPT_ITEMS array becomes FOUR real typed feeds (?type=period|house|
 * pm|gr). There is no merged "all" endpoint, so the four GETs are fanned in and unioned
 * client-side; per-type KPI counts are each feed's length. Pure narrowing / rejected
 * derivation / money format live in accept-rows.ts (unit-tested, gate G3).
 *
 * WIRE GAPS (reported honestly, never fabricated — see accept-rows.ts for the full map):
 *   - wait + due columns + the overdue row-highlight/red styling + the KPI "overdue {n}"
 *     count: NO wire source -> em-dash / 0 (never fabricated mock days).
 *   - value: only period/house carry `amount` -> pm/gr rows em-dash.
 *   - owner: real only on pm (=tech) -> other feeds em-dash.
 *   - doc#/descriptive split: period/house/gr show a doc number alone; pm shows the
 *     composed asset title and has NO doc number (em-dash primary).
 *   - attachments (clip count / DMS doc list): NO docs field -> the badge is omitted and
 *     the modal's DMS section is honest-empty.
 *   - `seq` work-period ordinal suffix: NO i18n key (B-116) -> the suffix is OMITTED (the
 *     doc number renders alone); never minted, never mis-borrowed.
 *   - Export / row-nav / modal-nav / DMS-open: NO endpoint -> honest toast / read-only
 *     ctx.navigate to the source module (subcon.contracts / gr.list / pm.wo / sales.loan).
 *
 * i18n (§0 rule 2): every visible string is an `accept.*` / `common.all` dict key (t),
 * except the standalone baht glyph in the modal value which reuses `subcon.unitBaht`
 * (the sanctioned cross-module borrow, gr-list/inv.items policy). No Thai/baht literal
 * sits in this source (B-073). Tokens back every colour (§0 rule 6); the per-type badge
 * / KPI accent hexes (#0F766E / #1D4ED8 / #B45309 / #6D28D9) are prototype-verbatim
 * (company-accept.jsx L102-107 / L170-174, B-037(a) precedent, like land-bank accents).
 * Numeric cells carry class `num` (§0 rule 7).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toAcceptRow,
  isRejected,
  rejectedCount,
  filterByQuery,
  defectText,
  formatMoney,
  type AcceptKind,
  type AcceptRow,
} from "./accept-rows";
import { useAcceptCenter } from "./use-accept";

/** The literal em-dash the screen renders for every column with no wire field. */
const DASH = "—";

/** Table header cell style, ported from ds.jsx th() (L214-219 — same as gr-list). */
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

/** Table body cell style, ported from ds.jsx td() (L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/**
 * The per-type config (company-accept.jsx ACCEPT_TYPES L102-107): the badge colour,
 * icon, and read-only source-module route per work-type. Colours are prototype-verbatim
 * hexes (no matching token, B-037(a)). Labels resolve via {@link AcceptanceCenter}'s
 * typeLabel (literal `accept.type*` keys, so no Thai lives here).
 */
const ACCEPT_TYPES: Record<AcceptKind, { color: string; icon: IconName; route: string }> = {
  subcon: { color: "#0F766E", icon: "hardhat", route: "subcon.contracts" },
  gr: { color: "#1D4ED8", icon: "box", route: "gr.list" },
  pm: { color: "#B45309", icon: "wrench", route: "pm.wo" },
  handover: { color: "#6D28D9", icon: "handshake", route: "sales.loan" },
};

/** The six tab ids (company-accept.jsx L179 — subcon/handover map to period/house feeds). */
type AcceptTab = "all" | "subcon" | "gr" | "pm" | "handover" | "rejected";

/**
 * Kpi card, ported 1:1 from ds.jsx Kpi (dashboard.jsx L93-115) — the label/value/unit/
 * sub/accent slots the acceptance-center KPIs use (delta/foot are unused here).
 */
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function AcceptanceCenter() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  // Fan in the four typed feeds (one per ?type) — no merged "all" endpoint.
  const periodQ = useAcceptCenter("period");
  const grQ = useAcceptCenter("gr");
  const pmQ = useAcceptCenter("pm");
  const houseQ = useAcceptCenter("house");

  const [tab, setTab] = useState<AcceptTab>("all");
  const [q, setQ] = useState("");

  const subconRows = useMemo<AcceptRow[]>(
    () => (periodQ.data ?? []).map((e) => toAcceptRow(e, "subcon")),
    [periodQ.data],
  );
  const grRows = useMemo<AcceptRow[]>(() => (grQ.data ?? []).map((e) => toAcceptRow(e, "gr")), [grQ.data]);
  const pmRows = useMemo<AcceptRow[]>(() => (pmQ.data ?? []).map((e) => toAcceptRow(e, "pm")), [pmQ.data]);
  const houseRows = useMemo<AcceptRow[]>(
    () => (houseQ.data ?? []).map((e) => toAcceptRow(e, "handover")),
    [houseQ.data],
  );

  // "all" fans the four feeds in (grouped by feed — no single endpoint defines a global
  // order); "rejected" = the period-rejected rows ∪ the whole gr return/defect feed.
  const allRows = useMemo(
    () => [...subconRows, ...grRows, ...pmRows, ...houseRows],
    [subconRows, grRows, pmRows, houseRows],
  );
  const rejectedRows = useMemo(
    () => [...subconRows.filter(isRejected), ...grRows],
    [subconRows, grRows],
  );

  const tabRows = useMemo<AcceptRow[]>(() => {
    switch (tab) {
      case "all":
        return allRows;
      case "subcon":
        return subconRows;
      case "gr":
        return grRows;
      case "pm":
        return pmRows;
      case "handover":
        return houseRows;
      case "rejected":
        return rejectedRows;
    }
  }, [tab, allRows, subconRows, grRows, pmRows, houseRows, rejectedRows]);

  const rows = useMemo(() => filterByQuery(tabRows, q), [tabRows, q]);

  // The active tab is loading while any feed it needs is still pending.
  const loadingByTab: Record<AcceptTab, boolean> = {
    all: periodQ.isLoading || grQ.isLoading || pmQ.isLoading || houseQ.isLoading,
    subcon: periodQ.isLoading,
    gr: grQ.isLoading,
    pm: pmQ.isLoading,
    handover: houseQ.isLoading,
    rejected: periodQ.isLoading || grQ.isLoading,
  };
  const loading = loadingByTab[tab];

  // KPI aggregates (client-derived from the fanned-in feeds — no server aggregate).
  const total = allRows.length;
  const rejCount = rejectedCount(allRows);
  // overdue has NO wire source -> honest 0 (never a fabricated mock overdue count).
  const overdue = 0;

  /** accept.type* label for a row's work-type (literal keys, so no Thai here). */
  const typeLabel = (kind: AcceptKind): string => {
    switch (kind) {
      case "subcon":
        return t("accept.typeSubcon");
      case "gr":
        return t("accept.typeGr");
      case "pm":
        return t("accept.typePm");
      case "handover":
        return t("accept.typeHandover");
    }
  };

  const TABS: readonly { id: AcceptTab; label: string }[] = [
    { id: "all", label: t("common.all") },
    { id: "subcon", label: t("accept.typeSubcon") },
    { id: "gr", label: t("accept.typeGr") },
    { id: "pm", label: t("accept.typePm") },
    { id: "handover", label: t("accept.typeHandover") },
    { id: "rejected", label: t("accept.tabRejected") },
  ];

  /** Row-click detail modal (company-accept.jsx openDetail L128-160), read-only. */
  const openDetail = (r: AcceptRow) => {
    const T = ACCEPT_TYPES[r.kind];
    const money = r.hasValue && r.value > 0 ? `${formatMoney(r.value)} ${t("subcon.unitBaht")}` : DASH;
    ctx.openModal({
      title: r.doc || r.descr || DASH,
      subtitle: `${typeLabel(r.kind)} · ${r.project || DASH}`,
      icon: T.icon,
      iconTone: T.color,
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{r.descr || r.doc || DASH}</div>
          {(
            [
              [t("accept.modalOwner"), r.owner || DASH],
              [t("accept.modalValue"), money],
              // wait + due have NO wire source -> em-dash (never a fabricated mock value).
              [t("accept.modalWaited"), DASH],
              [t("accept.colDue"), DASH],
            ] as const
          ).map(([l, v]) => (
            <div
              key={l}
              style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}
            >
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{l}</span>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                {v}
              </span>
            </div>
          ))}
          {/* DMS section (company-accept.jsx L141-152) — no docs field on the wire -> the
              count is honest-0 and no doc rows render; the "open DMS" nav is preserved. */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="paperclip" size={12} />
              {t("accept.dmsHeader").replace("{n}", "0")}
            </div>
            <button
              type="button"
              onClick={() => {
                close();
                ctx.navigate("dms");
              }}
              style={{
                border: "1px dashed var(--border-strong)",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-2)",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "inherit",
                borderRadius: 8,
                padding: "6px 12px",
                width: "100%",
              }}
            >
              {t("accept.openDmsBtn")}
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("accept.closeBtn")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="arrowR"
              onClick={() => {
                close();
                ctx.navigate(T.route);
              }}
            >
              {t("accept.gotoModuleBtn")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("accept.crumbMain"), t("accept.crumbSelf")]}
      title={t("accept.pageTitle")}
      subtitle={t("accept.subtitle")}
      actions={
        // Export has no endpoint (mock export modal) -> honest toast naming the subject
        // (gr-list precedent), keeping the button active for fidelity.
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("accept.exportTitle"))}>
          {t("accept.exportBtn")}
        </Btn>
      }
    >
      {/* KPI strip (5) — each value is its feed's row count; overdue/rejected are derived. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("accept.kpiTotalLabel")}
          value={String(total)}
          unit={t("accept.unitItems")}
          sub={t("accept.kpiTotalSub").replace("{n}", String(overdue)).replace("{count}", String(rejCount))}
          accent="var(--brand)"
        />
        <Kpi
          label={t("accept.typeSubcon")}
          value={String(subconRows.length)}
          unit={t("accept.unitPhase")}
          sub={t("accept.kpiSubconSub")}
          accent="#0F766E"
        />
        <Kpi
          label={t("accept.kpiGrLabel")}
          value={String(grRows.length)}
          unit={t("accept.unitItems")}
          sub={t("accept.kpiGrSub")}
          accent="#1D4ED8"
        />
        <Kpi
          label={t("accept.typePm")}
          value={String(pmRows.length)}
          unit={t("accept.unitSheet")}
          sub={t("accept.kpiPmSub")}
          accent="#B45309"
        />
        <Kpi
          label={t("accept.typeHandover")}
          value={String(houseRows.length)}
          unit={t("accept.unitJob")}
          sub={t("accept.kpiHandoverSub")}
          accent="#6D28D9"
        />
      </div>

      <Card pad={0}>
        {/* Tab bar + search (company-accept.jsx L178-186). */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {TABS.map((tb) => {
            const on = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  background: on ? "var(--brand)" : "var(--surface-2)",
                  color: on ? "#fff" : "var(--text-2)",
                }}
              >
                {tb.label}
              </button>
            );
          })}
          <div
            style={{
              marginInlineStart: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--surface)",
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("accept.searchPh")}
              style={{ border: "none", outline: "none", width: 180, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(150)}>{t("accept.colType")}</th>
                  <th scope="col" style={th()}>{t("accept.colDoc")}</th>
                  <th scope="col" style={th(170)}>{t("accept.colProject")}</th>
                  <th scope="col" style={th(150)}>{t("accept.colOwner")}</th>
                  <th scope="col" style={th(110, true)}>{t("accept.colValue")}</th>
                  <th scope="col" style={th(80)}>{t("accept.colWait")}</th>
                  <th scope="col" style={th(130)}>{t("accept.colDue")}</th>
                  <th scope="col" style={th(90)} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  // Honest empty state (no invented copy) — mirrors gr-list / master-vendor.
                  <tr>
                    <td colSpan={8} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="info" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                      <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const T = ACCEPT_TYPES[r.kind];
                    const rejected = isRejected(r);
                    const defect = defectText(r);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => openDetail(r)}
                        style={{
                          borderTop: "1px solid var(--border)",
                          cursor: "pointer",
                          // overdue highlight is dropped (no wire source); only the
                          // return/defect set gets the danger tint (prototype 60%).
                          background: rejected ? "color-mix(in srgb, var(--danger-soft) 60%, white)" : "transparent",
                        }}
                      >
                        {/* type badge pill (company-accept.jsx L199). */}
                        <td style={td}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 9px",
                              borderRadius: 999,
                              background: `color-mix(in srgb, ${T.color} 13%, white)`,
                              color: T.color,
                            }}
                          >
                            <Icon name={T.icon} size={12} />
                            {typeLabel(r.kind)}
                          </span>
                        </td>
                        {/* doc# + descriptive line + rejected defect line (company-accept.jsx L200-204). */}
                        <td style={td}>
                          <div style={{ fontWeight: 700, color: "var(--brand)" }} className="num">
                            {r.doc || DASH}
                          </div>
                          {r.descr && <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{r.descr}</div>}
                          {rejected && defect && (
                            <div style={{ fontSize: 10.5, color: "var(--danger)", fontWeight: 700, marginTop: 2 }}>
                              {t("accept.rejectDefectLine").replace("{name}", defect)}
                            </div>
                          )}
                        </td>
                        {/* project — server data (§0 rule 3). */}
                        <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{r.project || DASH}</td>
                        {/* owner — pm only (=tech); em-dash otherwise. */}
                        <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{r.owner || DASH}</td>
                        {/* value — period/house only; pm/gr em-dash. */}
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                          {r.hasValue && r.value > 0 ? formatMoney(r.value) : DASH}
                        </td>
                        {/* wait — NO wire source -> em-dash (prototype's "center" arg is a ds.jsx no-op). */}
                        <td style={{ ...td, fontWeight: 700 }} className="num">
                          {DASH}
                        </td>
                        {/* due — NO wire source -> em-dash, no overdue emphasis. */}
                        <td style={{ ...td, fontSize: 11.5, fontWeight: 500, color: "var(--text-2)" }}>{DASH}</td>
                        {/* row action -> read-only nav to the source module (stopPropagation so the
                            row modal does not also open; pr-list precedent). */}
                        <td style={{ ...td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <Btn kind="soft" size="sm" icon="arrowR" onClick={() => ctx.navigate(T.route)}>
                            {rejected ? t("accept.followFixBtn") : t("accept.gotoInspectBtn")}
                          </Btn>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Read-only footer notice (company-accept.jsx L216-218). */}
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
          {t("accept.footerInfo")}
        </div>
      </Card>
    </Page>
  );
}
