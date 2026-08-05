/*
 * PRList — the Purchase Requisition list screen, ported 1:1 from pototype/pr-list.jsx
 * PRList (L54-267). Route pr.list (docs/extract/NAV-ROUTES.md L29), visual-gate reference
 * tests/visual/reference/gallery/g1/15.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (procurement › purchase-request), the
 * two header actions (import-Excel / create-PR), the title/subtitle, the 4-card KPI strip,
 * the 5 view tabs (all · awaiting-approval · mine · draft · referenced) + the search /
 * filter-count / Export toolbar, the active-filter row, the full-width table (checkbox ·
 * no · type · detail · position · right-aligned amount · requester · status+approval-step ·
 * date · row-menu) and the pagination footer are the prototype's, verbatim. TypeChip /
 * StatusBadge / ApprovalSteps / KpiCard / th() / td() reproduce the ds.jsx + pr-list.jsx
 * primitives inline; color-mix + #fff literals and the type/status hexes are
 * prototype-verbatim (B-037(a)). Numeric cells carry class `num` (rule 7).
 *
 * Data (rule 3): the prototype's local PR_ROWS demo array becomes the real server
 * catalogue — GET /pr (use-pr.ts) via the generated client. The LIST wire doc
 * { id, no, type, project_id, need_date, status, approval_step, currency_code, amount,
 *   title, phase, vendor_id, requester_id, submitted_at, approved_at, vendor, requester }
 * drives each row (shape pinned by apps/api/src/routes/pr.test.ts L267-287); `amount` is
 * the server SUM of the doc's priced lines and (approval_step + amount) drives the tiered
 * stepper (total tiers derived with the same B-070 thresholds the backend approve-gate
 * enforces — pr-rows.requiredTierCount).
 *
 * STALE-COMMENT CORRECTION: this header previously declared title / vendor / requester /
 * phase and the approval timestamps absent from the wire. That was true before migration
 * 0022 (B-075) and is now false — they are real pr columns, prWire returns them, and the
 * LIST handler additionally resolves the vendor + requester display NAMES. They are wired
 * here; nothing is invented, and a null column still renders an honest em-dash.
 *
 * REMAINING WIRE GAPs (reported honestly, never fabricated): `budget %` (the work-position
 * progress bar) and the `urgent` flag have no column anywhere, so the bar / badge stay
 * omitted. The over-budget KPI (kpiOverBudget) needs that same budget %, so its value stays
 * an em-dash; likewise the pr.list.kpiAvgImprove sub-line asserts a month-over-month
 * IMPROVEMENT, a claim the list cannot make honestly (no business clock on the web —
 * apps/api/src/business-clock.ts is server-side), so it keeps its em-dash. The referenced
 * tab (tabRef) needs a PR↔user mention relation that does not exist, so its count is an
 * em-dash and selecting it yields an empty list. The mine tab (tabMine) IS wired now
 * (requester_id === /me user id) and falls back to an em-dash only when /me is unresolved.
 * The date column shows `submitted_at` (the document's entry into the flow — the exact
 * instant the seed stores per PR); a never-submitted draft has none → em-dash. There is
 * still no created_at on the LIST payload, and no per-row detail fetch is made to fill any
 * of this in. The active-filter row is implemented as REAL project + type selects (the axes
 * with honest backing); the mock's decorative period/amount pills are omitted.
 *
 * i18n (rule 2): navPr is the PR nav key (tn); every other string is a pr.list.* /
 * common.* / vendor.* / nav.sec.proc dict key (t) or a phrase (tp) sourced from
 * pr-strings.json — no Thai literal sits in this source.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useMe, useProjects, entityStr } from "../../shell/use-shell-data";
import { usePrList } from "./use-pr";
import {
  toPrRow,
  prTypeMeta,
  prTypeStringName,
  statusTone,
  statusStringName,
  requiredTierCount,
  approvalBars,
  approvalStepLabel,
  formatMoney,
  formatDate,
  firstName,
  millionsValue,
  monthKey,
  approvedInMonth,
  avgApprovalDays,
  filterPrRows,
  countByStatus,
  countByRequester,
  sumAmount,
  activeFilterCount,
  type PrRow,
} from "./pr-rows";
import prStrings from "./pr-strings.json" with { type: "json" };

const P = (k: keyof typeof prStrings) => prStrings[k] as PhraseKey;
/** Honest placeholder for any field with no wire source (rule 3 / C10). */
const DASH = "—";

/** Table header cell style, ported from ds.jsx th() (L214-219) — same as boq-list/vendor. */
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

/** Filter pill (native <select> styled like ds.jsx Dropdown mode="filter"), from boq-list. */
function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 30,
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--surface)",
        color: "var(--text-2)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {children}
    </select>
  );
}

/** KPI card, ported 1:1 from pr-list.jsx (L94-113). color-mix + white are prototype-verbatim. */
function KpiCard({
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
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 12%, white)`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

/** Type chip, ported 1:1 from pr-list.jsx TypeChip (L24-32); soft/color are verbatim hexes. */
function TypeChip({ type, label }: { type: string; label: string }) {
  const m = prTypeMeta(type);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 5,
        background: m.soft,
        color: m.color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** StatusBadge size="sm", ported 1:1 from ds.jsx StatusBadge (L93-135); dot hex verbatim. */
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
        letterSpacing: "-0.005em",
        alignSelf: "flex-start",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** Approval stepper, ported 1:1 from pr-list.jsx ApprovalSteps (L34-52). */
function ApprovalSteps({ step, total, status }: { step: number; total: number; status: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {approvalBars(step, total, status).map((bg, i) => (
        <div key={i} style={{ width: 18, height: 4, borderRadius: 2, background: bg }} />
      ))}
      <span
        className="num"
        style={{ fontSize: 10.5, color: "var(--text-3)", marginInlineStart: 6, fontWeight: 600 }}
      >
        {approvalStepLabel(step, total, status)}
      </span>
    </div>
  );
}

/**
 * How a tab narrows the catalogue:
 *   status — by the doc `status` column ("" = every doc)
 *   mine   — by requester_id === the /me user id (real column since migration 0022)
 *   unwired — no wire predicate exists (tabRef needs a PR↔user mention relation)
 */
type TabScope = "status" | "mine" | "unwired";

/**
 * The 5 view tabs (pr-list.jsx L56-62). `strKey` null = the "all" tab (labelled via
 * common.all).
 */
const TABS: readonly {
  id: string;
  strKey: keyof typeof prStrings | null;
  status: string;
  scope: TabScope;
}[] = [
  { id: "all", strKey: null, status: "", scope: "status" },
  { id: "approve", strKey: "tabApprove", status: "pending", scope: "status" },
  { id: "mine", strKey: "tabMine", status: "", scope: "mine" },
  { id: "draft", strKey: "tabDraft", status: "draft", scope: "status" },
  { id: "ref", strKey: "tabRef", status: "", scope: "unwired" },
];

export function PRList() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const prQ = usePrList();
  const projectsQ = useProjects();
  const meQ = useMe();
  /** The signed-in user id (GET /me user.id) — the "tabMine" predicate; "" when unresolved. */
  const myUserId = entityStr(meQ.data?.user, "id");

  const [tabId, setTabId] = useState("approve"); // prototype default (pr-list.jsx L55)
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  const docs = useMemo<PrRow[]>(() => (prQ.data ?? []).map(toPrRow), [prQ.data]);

  const activeTab = TABS.find((tab) => tab.id === tabId) ?? TABS[0]!;
  // A tab with no wire predicate (referenced), or the mine tab before /me resolves, cannot be
  // answered honestly — it shows an empty list rather than an unfiltered one.
  const unanswerableTab =
    activeTab.scope === "unwired" || (activeTab.scope === "mine" && !myUserId);

  const list = useMemo(
    () =>
      unanswerableTab
        ? []
        : filterPrRows(docs, {
            status: activeTab.status,
            projectId,
            type,
            q,
            requesterId: activeTab.scope === "mine" ? myUserId : "",
          }),
    [docs, unanswerableTab, activeTab.status, activeTab.scope, myUserId, projectId, type, q],
  );

  // KPI 1 (awaiting approval) — count + Σ value in M, from real status + amount.
  const pendingCount = countByStatus(docs, "pending");
  const pendingMillions = millionsValue(sumAmount(docs.filter((d) => d.status === "pending")));

  // KPI 2 (kpiApprovedMonth) — the label names the current month, so the cohort is keyed on
  // the real approved_at stamp falling in this UTC month. No frozen business clock exists
  // on the web, so this is the wall-clock month by construction.
  const approvedMonth = useMemo(
    () => approvedInMonth(docs, monthKey(new Date().toISOString())),
    [docs],
  );

  // KPI 4 (kpiAvgTime) — mean submitted_at → approved_at over every doc with both
  // stamps; null (→ em-dash) when no doc has a complete approval cycle.
  const avgDays = avgApprovalDays(docs);

  const tabLabel = (tab: (typeof TABS)[number]): string =>
    tab.strKey === null ? t("common.all") : tp(P(tab.strKey));

  const tabCount = (tab: (typeof TABS)[number]): string => {
    if (tab.scope === "unwired") return DASH; // no wire relation for this view
    if (tab.scope === "mine") return myUserId ? String(countByRequester(docs, myUserId)) : DASH;
    if (tab.status === "") return String(docs.length);
    return String(countByStatus(docs, tab.status));
  };

  const filterCount = activeFilterCount({ projectId, type, q });
  const clearFilters = () => {
    setProjectId("");
    setType("");
    setQ("");
    setTabId("all");
  };

  // Row / create-PR both open the PR form screen (pr.form — not yet ported → Placeholder).
  const openForm = (row?: PrRow) =>
    ctx.navigate("pr.form", row ? { id: row.id, no: row.no } : {});

  return (
    <Page
      breadcrumbs={[t("nav.sec.proc"), tn(prStrings.navPr as NavKey)]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            kind="outline"
            size="md"
            icon="upload"
            onClick={() => ctx.notify(t("pr.list.importExcelToast"))}
          >
            {tp(P("importExcel"))}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => openForm()}>
            {tp(P("createPr"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (pr-list.jsx L88-114). Three of the four cards are wire-computable from
          real columns (status/amount + the migration-0022 approval stamps); only the over-budget card
          needs a budget % that exists nowhere → its value stays an honest em-dash. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <KpiCard
          label={tp(P("kpiPending"))}
          value={String(pendingCount)}
          sub={t("pr.list.kpiValueMillion").replace("{value}", pendingMillions)}
          tone="var(--warn)"
          icon="clock"
        />
        <KpiCard
          label={tp(P("kpiApprovedMonth"))}
          value={String(approvedMonth.length)}
          sub={t("pr.list.kpiValueMillion").replace(
            "{value}",
            millionsValue(sumAmount(approvedMonth)),
          )}
          tone="var(--ok)"
          icon="check"
        />
        {/* WIRE GAP: the over-budget card counts PRs over their budget line — no budget % / budget link
            exists on the pr wire, so the value stays an honest em-dash. */}
        <KpiCard
          label={tp(P("kpiOverBudget"))}
          value={DASH}
          sub={t("pr.list.kpiOverBudgetSub")}
          tone="var(--danger)"
          icon="warn"
        />
        {/* The value is real (submitted_at → approved_at); the sub-line asserts an
            IMPROVEMENT vs last month — a claim no wire field supports → em-dash. */}
        <KpiCard
          label={tp(P("kpiAvgTime"))}
          value={avgDays == null ? DASH : avgDays.toFixed(1)}
          unit={t("pr.list.unitDay")}
          sub={t("pr.list.kpiAvgImprove").replace("{days}", DASH)}
          tone="var(--accent)"
          icon="trend"
        />
      </div>

      <Card pad={0} style={{ overflow: "hidden" }}>
        {/* Tabs + toolbar (pr-list.jsx L118-153). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            {TABS.map((tab) => {
              const on = tabId === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTabId(tab.id)}
                  style={{
                    padding: "14px 12px",
                    background: "none",
                    border: "none",
                    borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
                    marginBottom: -1,
                    fontFamily: "inherit",
                    fontSize: 12.5,
                    fontWeight: on ? 600 : 500,
                    color: on ? "var(--text)" : "var(--text-2)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {tabLabel(tab)}
                  <span
                    className="num"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: on ? "var(--brand)" : "var(--surface-3)",
                      color: on ? "#fff" : "var(--text-2)",
                    }}
                  >
                    {tabCount(tab)}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--surface)",
              }}
            >
              <Icon name="search" size={13} color="var(--text-3)" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tp(P("searchPr"))}
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  width: 130,
                  fontSize: 12,
                  color: "var(--text)",
                }}
              />
            </div>
            <Btn
              kind="outline"
              size="sm"
              icon="filter"
              onClick={() =>
                ctx.notify(t("pr.list.filterCount").replace("{count}", String(filterCount)))
              }
            >
              {t("pr.list.filterCount").replace("{count}", String(filterCount))}
            </Btn>
            <Btn
              kind="ghost"
              size="sm"
              icon="download"
              onClick={() => ctx.notify(tp(P("notifyExport")))}
            >
              {t("vendor.btnExport")}
            </Btn>
          </div>
        </div>

        {/* Active filters (pr-list.jsx L156-163): real project + type selects (the axes with
            honest backing); the mock's decorative period/amount pills are omitted (flagged). */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>
            {tp(P("filterLabel"))}
          </span>
          <FilterSelect value={projectId} onChange={setProjectId}>
            <option value="">{tp(P("filterProject"))}</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={type} onChange={setType}>
            <option value="">{tp(P("filterType"))}</option>
            <option value="material">{tp(P("typeMaterial"))}</option>
            <option value="subcon">{tp(P("typeSubcon"))}</option>
            <option value="expense">{tp(P("typeExpense"))}</option>
            <option value="advance">{tp(P("typeAdvance"))}</option>
          </FilterSelect>
          <button
            type="button"
            onClick={clearFilters}
            style={{
              fontSize: 11,
              color: "var(--brand)",
              border: "none",
              background: "none",
              fontWeight: 600,
              marginInlineStart: "auto",
              cursor: "pointer",
            }}
          >
            {tp(P("clearAll"))}
          </button>
        </div>

        {prQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror boq-list / master-vendor).
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
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(36)}>
                    <input type="checkbox" />
                  </th>
                  <th scope="col" style={th()}>{tp(P("thPrNo"))}</th>
                  <th scope="col" style={th()}>{tp(P("filterType"))}</th>
                  <th scope="col" style={th()}>{tp(P("thDetail"))}</th>
                  <th scope="col" style={th()}>{tp(P("thPosition"))}</th>
                  <th scope="col" style={th(undefined, true)}>{tp(P("thAmount"))}</th>
                  <th scope="col" style={th()}>{tp(P("thRequester"))}</th>
                  <th scope="col" style={th()}>{tp(P("thStatusStep"))}</th>
                  <th scope="col" style={th()}>{tp(P("thDate"))}</th>
                  <th scope="col" style={th(36)} />
                </tr>
              </thead>
              {/* Empty tbody when the (filtered) catalogue is empty = the table's empty state
                  (no invented copy), mirroring master-vendor. */}
              <tbody>
                {list.map((r) => {
                  const total = requiredTierCount(r.amount);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openForm(r)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" />
                      </td>
                      <td style={td}>
                        {/* WIRE GAP: no `urgent` flag on the wire — the "urgent" badge is omitted. */}
                        <span
                          className="num"
                          style={{ fontWeight: 600, color: "var(--brand)" }}
                        >
                          {r.no}
                        </span>
                      </td>
                      <td style={td}>
                        <TypeChip type={r.type} label={tp(P(prTypeStringName(r.type)))} />
                      </td>
                      {/* Detail = the real title + (when the PR has one) the resolved vendor
                          name, exactly like pr-list.jsx L201-208 (which also hides the
                          vendor sub-line when there is none). */}
                      <td style={td}>
                        <div style={{ maxWidth: 320 }}>
                          <div style={{ color: "var(--text)", fontWeight: 500 }}>
                            {r.title ?? DASH}
                          </div>
                          {r.vendor && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                              {r.vendor}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Work position = the real phase column. WIRE GAP: the mock's budget
                          % bar has no column anywhere, so the bar is omitted (the prototype
                          also omits it whenever budget is 0). */}
                      <td style={td}>
                        <div style={{ fontSize: 12 }}>{r.phase ?? DASH}</div>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.amount)}
                      </td>
                      {/* Requester = the display name the LIST handler resolves from users;
                          the prototype prints the avatar + the first name token only. */}
                      <td style={td}>
                        {r.requester ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Avatar name={r.requester} size={22} color="#0F766E" />
                            <span style={{ fontSize: 12 }}>{firstName(r.requester)}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <StatusBadge
                            status={r.status}
                            label={tp(P(statusStringName(r.status)))}
                          />
                          <ApprovalSteps step={r.approvalStep} total={total} status={r.status} />
                        </div>
                      </td>
                      {/* Document date = submitted_at (the instant the PR entered the flow —
                          the exact date the seed carries per PR). A never-submitted draft
                          has none → em-dash. need_date stays out of this column: it is the
                          need-by date, not the document date. */}
                      <td style={{ ...td, color: "var(--text-3)" }} className="num">
                        {formatDate(r.submittedAt) || DASH}
                      </td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        <Icon name="more" size={16} color="var(--text-3)" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination (pr-list.jsx L246-262). GET /pr returns one full page (B-014 envelope),
            so the range is real and the page nav collapses to the single current page — the
            mock's ‹1 2 3 … 25› numbers are decorative demo state (flagged). */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          <span>
            {t("pr.list.paginationRange")
              .replace("{from}", String(list.length ? 1 : 0))
              .replace("{to}", String(list.length))
              .replace("{total}", String(docs.length))}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {["‹", "1", "›"].map((pg, i) => {
              const active = pg === "1";
              return (
                <button
                  key={i}
                  type="button"
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid " + (active ? "var(--brand)" : "var(--border)"),
                    background: active ? "var(--brand)" : "var(--surface)",
                    color: active ? "#fff" : "var(--text-2)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "default",
                  }}
                >
                  {pg}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
    </Page>
  );
}
