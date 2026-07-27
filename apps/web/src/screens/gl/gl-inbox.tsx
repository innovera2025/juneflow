/*
 * GLPostingInbox — the GL Posting Inbox screen, ported from pototype/gl.jsx GLPostingInbox
 * (L236-427) + PostingInboxFilter (L438-510) + FilterChip (L429-437). Route gl.inbox
 * (docs/extract/NAV-ROUTES.md L61, section "acct"). First Phase-3 GL screen; mirrors the
 * SAME-MODULE precedent gl-jv.tsx (the i18n phrase-file pattern) and po-wo/wo-list.tsx
 * (list + KPI strip + TabBar + table structure, inlined th/td/MiniKpi/TabBar/StatusBadge).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the three-part breadcrumb (finance section, GL
 * module, Posting Inbox screen), the title/subtitle, the filter + post-all header actions, the
 * 5-card MiniKpi strip, the TabBar (all / pending / posted / scheduled / error), the filter-chip
 * toolbar, the checkbox-select list table (source / doc-no / description / value / creator / time /
 * status-JV), and the filter modal are the prototype's.
 *
 * Data (rule 3): GET /gl/posting-inbox (use-gl-inbox.ts) via the generated client — the
 * prototype's local POST_INBOX becomes the real server catalogue. The wire row is
 * { source, id, doc_no, amount, currency_code, posted, jv_no, created_at } (apps/api/src/routes/
 * gl-posting.ts InboxRow); pure narrowing/derive/filter/format logic lives in gl-inbox-rows.ts
 * (unit-tested, G3).
 *
 * REAL vs em-dash (honest, never fabricated) — see gl-posting.ts + gl-inbox-rows.ts:
 *   - source  -> REAL wire kind (pv/rv/gr/payroll), mapped to the PV/RV colour tag (gr/payroll ->
 *                accent, unknown -> neutral).
 *   - doc-no  -> REAL where present (gr.no); em-dash on null (pv/rv/payroll have none).
 *   - value   -> REAL where present; em-dash on null (gr carries a quantity, not money).
 *   - status/JV -> posted ? posted-tag + jv_no : pending badge.
 *   - description + creator -> NO wire field -> em-dash (the error sub-line has no wire -> omitted).
 *   - time    -> REAL created_at (formatted UTC "YYYY-MM-DD HH:mm", the same honest treatment as
 *                gl-jv's date cell — the prototype's Thai mock time is dropped).
 *   HONEST-EMPTY POSTED TAB (decision C10): the seed never writes a "table:uuid" jv.source_doc,
 *   so on the current data NO doc is posted -> every row is PENDING, the posted tab + KPI render a
 *   legitimate 0/empty. This is correct, NOT a bug.
 *   KPIs: pending (count + Sigma amount) and posted (count + Sigma amount) are REAL C10 metrics;
 *   scheduled + error are mock-only statuses with NO wire -> value em-dash, static descriptive
 *   sub kept. Sync SAP is fully PRESENTATIONAL (no SAP-sync wire) -> value em-dash and the mock
 *   "last 5 min" caption is a fabricated metric, so it is dropped (rule: never fabricate).
 *
 * Post button (rule 8): "Post all passed (n)" -> useGlPost() -> POST /gl/post with the selected
 * PENDING rows' ids. The op is DECLARED in the contract but its HANDLER IS NOT LIVE YET (B-122) ->
 * Wei's ruling: the button is DISABLED + honest until the handler lands (GL_POST_HANDLER_READY =
 * false gates it; flip to true when the handler merges). The useGlPost() mutation stays wired so
 * flipping the flag makes it live with no further change, and onError still surfaces a real failure
 * honestly (never a fabricated JV). The checkbox selection + select-all-pending logic is real
 * client state (all pending checked by default, matching the prototype). On success the list
 * invalidates -> the posted rows flip to their real posted/jv_no state.
 *
 * Filter modal (PostingInboxFilter): source (distinct wire kinds) + minimum amount are REAL,
 * client-side over the loaded rows. The prototype's period + creator fields have NO wire field and
 * are OMITTED honestly (the blessed drop-not-collect pattern, jv-create-form) — so the creator
 * chip is never shown either. The apply toast reuses gl.inbox.applyFilterToast; its {period} slot
 * resolves to common.all since no period is narrowed (honest "all periods", no fabrication).
 *
 * i18n (rule 2): every string resolves via t() from the DICT layer (i18n-full.json) — the gl.inbox.*
 * keys for this screen (i18n Wave-A) plus reused existing keys for common values (fin.breadcrumbFinance,
 * fin.statusPending, subcon.colValueBaht, docnum.thReset, boq.arcApplyFilter, common.all/cancel).
 * The temporary gl-inbox-strings.json phrase file (tp) has been DELETED. Tokens back every colour
 * (rule 6). ZERO Thai/baht in this .tsx (B-073) — every glyph lives only in i18n-full.json.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toInboxRow,
  sourceTag,
  filterByTab,
  tabCount,
  countByStatus,
  sumAmountByStatus,
  applyFilter,
  isFilterActive,
  parseMinAmount,
  distinctSources,
  formatMoney,
  formatTime,
  EMPTY_FILTER,
  type InboxRow,
  type InboxTab,
  type InboxFilter,
} from "./gl-inbox-rows";
import { useGlInboxList, useGlPost } from "./use-gl-inbox";

const DASH = "—";
/** The prototype's verbatim ASCII posted-tag text (gl.jsx L415; not i18n copy). */
const POSTED_TAG = "posted";
/**
 * POST /gl/post handler readiness (B-122). The op is DECLARED in the contract (postGl) but its
 * HANDLER IS LIVE as of Phase-3 round-A (POST /gl/post merged - B-122/P2-BE-48). The Post button
 * is now enabled by real selection; the useGlPost() mutation posts the selected pending doc ids.
 */
const GL_POST_HANDLER_READY = true;

/** Table header cell style (ds.jsx th(), as ported in gl-jv.tsx). */
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

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gl-jv). */
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

/** TabBar, inlined from ds.jsx TabBar (functional, as in wo-list). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: InboxTab; label: string; count: number }[];
  active: InboxTab;
  onChange: (id: InboxTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              background: "none",
              border: "none",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontFamily: "inherit",
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

/** Active-filter chip (gl.jsx FilterChip L429-437) — a brand-outlined pill. */
function FilterChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 999,
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--brand)",
      }}
    >
      {label}
    </span>
  );
}

/** Pending status badge (ds.jsx StatusBadge status="pending" size="sm"). */
function PendingBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: "var(--warn-soft)",
        color: "var(--warn)",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      {/* ds.jsx STATUS.pending dot #D97706 (prototype-verbatim hex, B-037(a)). */}
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "#D97706" }} />
      {label}
    </span>
  );
}

/** Native-select style (jv-create-form headInput). */
const selectStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/**
 * PostingInboxFilter — the filter modal body (gl.jsx L438-510). Client-side over the loaded rows.
 * Only the WIRE-BACKED axes are kept: source kind (distinct sources) + minimum amount. The
 * prototype's period + creator selects have no wire field and are OMITTED honestly (drop-not-
 * collect), so this shows two fields instead of four.
 */
function PostingInboxFilter({
  initial,
  sources,
  onClose,
  onApply,
}: {
  initial: InboxFilter;
  sources: readonly string[];
  onClose: () => void;
  onApply: (next: InboxFilter) => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [source, setSource] = useState(initial.source);
  const [minAmount, setMinAmount] = useState(initial.minAmount);

  const submit = () => {
    onApply({ source, minAmount });
    onClose();
    const sourceLabel = source === "" ? t("common.all") : sourceTag(source).label;
    // gl.inbox.applyFilterToast carries a {source} + {period} template (dict, i18n-full.json). The
    // ported filter drops the period axis (drop-not-collect: no wire field), so no period is
    // narrowed -> the honest {period} value is common.all ("all periods"). Dict keys only; no
    // minting, no fabricated period. (Reported: applyFilterToast assumes a period the port dropped.)
    ctx.notify(
      t("gl.inbox.applyFilterToast").replace("{source}", sourceLabel).replace("{period}", t("common.all")),
    );
  };
  const reset = () => {
    setSource("");
    setMinAmount("");
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("gl.inbox.filterFieldSource")}>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
            <option value="">{t("common.all")}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {sourceTag(s).label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("gl.inbox.filterFieldMinAmount")} hint={t("gl.inbox.filterMinAmountHint")}>
          <input
            type="number"
            value={minAmount}
            placeholder={t("gl.inbox.filterMinAmountPlaceholder")}
            onChange={(e) => setMinAmount(e.target.value)}
            style={{ ...selectStyle, fontFamily: "var(--font-num)" }}
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" onClick={reset}>
          {t("docnum.thReset")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit}>
          {t("boq.arcApplyFilter")}
        </Btn>
      </div>
    </>
  );
}

/** Extract an error message off an unknown mutation error (pm/wo-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

export function GLPostingInbox() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const inboxQ = useGlInboxList();
  const glPost = useGlPost();

  const [tab, setTab] = useState<InboxTab>("all");
  const [filter, setFilter] = useState<InboxFilter>(EMPTY_FILTER);
  // Selection keyed by row id. A pending row is checked by default (prototype seed) until the user
  // toggles it: selected[id] ?? true. Non-pending rows are never checked (disabled).
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const rows = useMemo<InboxRow[]>(() => (inboxQ.data ?? []).map(toInboxRow), [inboxQ.data]);
  const visible = useMemo(() => applyFilter(filterByTab(rows, tab), filter), [rows, tab, filter]);
  const sources = useMemo(() => distinctSources(rows), [rows]);

  const pendingRows = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const isChecked = (r: InboxRow): boolean => r.status === "pending" && (selected[r.id] ?? true);
  const pendingSelectedCount = pendingRows.filter(isChecked).length;
  const allPendingChecked = pendingRows.length > 0 && pendingRows.every(isChecked);

  const pendingCount = countByStatus(rows, "pending");
  const pendingValue = sumAmountByStatus(rows, "pending");
  const postedCount = countByStatus(rows, "posted");
  const postedValue = sumAmountByStatus(rows, "posted");

  const filterActive = isFilterActive(filter);

  const changeTab = (id: InboxTab) => setTab(id);

  const openFilter = () => {
    ctx.openModal({
      title: t("gl.inbox.filterModalTitle"),
      subtitle: t("gl.inbox.filterModalSubtitle"),
      icon: "filter",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <PostingInboxFilter initial={filter} sources={sources} onClose={close} onApply={setFilter} />
      ),
    });
  };

  const toggleAllPending = (v: boolean) =>
    setSelected((prev) => {
      const out = { ...prev };
      for (const r of pendingRows) out[r.id] = v;
      return out;
    });

  // Post -> POST /gl/post with the selected pending ids. Handler PENDING (B-122): 404s until it
  // lands -> the error is surfaced honestly, never a fabricated JV.
  const postSelected = () => {
    const doc_ids = pendingRows.filter(isChecked).map((r) => r.id);
    if (doc_ids.length === 0) return; // button is disabled in this case (defensive guard).
    glPost.mutate(
      { doc_ids },
      {
        // gl.inbox.postSuccessToast carries the "Post {count} ..." success copy (dict, i18n-full.json).
        onSuccess: () =>
          ctx.notify(t("gl.inbox.postSuccessToast").replace("{count}", String(doc_ids.length))),
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  const TABS: readonly { id: InboxTab; label: string; count: number }[] = [
    { id: "all", label: t("common.all"), count: rows.length },
    { id: "pending", label: t("gl.inbox.tabPending"), count: tabCount(rows, "pending") },
    { id: "posted", label: t("gl.inbox.tabPosted"), count: tabCount(rows, "posted") },
    { id: "scheduled", label: t("gl.inbox.tabScheduled"), count: tabCount(rows, "scheduled") },
    { id: "error", label: t("gl.inbox.tabError"), count: tabCount(rows, "error") },
  ];

  const postCountSuffix = pendingSelectedCount > 0 ? ` (${pendingSelectedCount})` : "";

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", t("gl.inbox.crumbScreen")]}
      title={t("gl.inbox.title")}
      subtitle={t("gl.inbox.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="filter" onClick={openFilter}>
            {filterActive ? t("gl.inbox.filterBtn") + t("gl.inbox.filterBtnActiveSuffix") : t("gl.inbox.filterBtn")}
          </Btn>
          {/* Post button: disabled + honest until the POST /gl/post handler lands (B-122). */}
          <Btn
            kind="ok"
            size="md"
            icon="check"
            disabled={!GL_POST_HANDLER_READY || pendingSelectedCount === 0 || glPost.isPending}
            onClick={postSelected}
          >
            {t("gl.inbox.postAllBtn")}
            {postCountSuffix}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5): pending + posted are REAL C10 metrics (posted 0/empty on the seed, honest);
          scheduled + error have no wire (value em-dash, static sub); Sync SAP is presentational. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("gl.inbox.kpiPending")}
          value={String(pendingCount)}
          sub={t("gl.inbox.kpiValueSub").replace("{amount}", formatMoney(pendingValue))}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={t("gl.inbox.kpiPostedToday")}
          value={String(postedCount)}
          sub={t("gl.inbox.kpiValueSub").replace("{amount}", formatMoney(postedValue))}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi label={t("gl.inbox.kpiScheduled")} value={DASH} sub={t("gl.inbox.kpiScheduledSub")} tone="var(--info)" icon="calendar" />
        <MiniKpi label={t("gl.inbox.kpiError")} value={DASH} sub={t("gl.inbox.kpiErrorSub")} tone="var(--danger)" icon="warn" />
        {/* Sync SAP: no SAP-sync wire -> value em-dash; the mock "last 5 min" caption is dropped. */}
        <MiniKpi label={t("gl.inbox.kpiSync")} value={DASH} tone="var(--brand)" icon="sync" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={changeTab} />

        {filterActive && (
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              fontSize: 11.5,
              color: "var(--text-2)",
              background: "var(--brand-soft)",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--brand)" }}>{t("gl.inbox.filterBarLabel")}</span>
            {filter.source !== "" && (
              <FilterChip label={t("gl.inbox.chipSource").replace("{source}", sourceTag(filter.source).label)} />
            )}
            {parseMinAmount(filter.minAmount) > 0 && (
              <FilterChip
                label={t("gl.inbox.chipMinAmount").replace("{amount}", formatMoney(parseMinAmount(filter.minAmount)))}
              />
            )}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setFilter(EMPTY_FILTER)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--brand)",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("gl.inbox.clearFilter")}
            </button>
          </div>
        )}

        {inboxQ.isLoading ? (
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
                <th scope="col" style={th(28)}>
                  <input
                    type="checkbox"
                    checked={allPendingChecked}
                    onChange={(e) => toggleAllPending(e.target.checked)}
                  />
                </th>
                <th scope="col" style={th(100)}>{t("gl.inbox.colSource")}</th>
                <th scope="col" style={th(140)}>{t("gl.inbox.colDocNo")}</th>
                <th scope="col" style={th()}>{t("gl.inbox.colDesc")}</th>
                <th scope="col" style={th(130, true)}>{t("subcon.colValueBaht")}</th>
                <th scope="col" style={th(140)}>{t("gl.inbox.colCreatedBy")}</th>
                <th scope="col" style={th(120)}>{t("gl.inbox.colTime")}</th>
                <th scope="col" style={th(130)}>{t("gl.inbox.colStatusJv")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("gl.inbox.emptyFiltered")}
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const tag = sourceTag(r.source);
                  const time = formatTime(r.createdAt);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          disabled={r.status !== "pending"}
                          checked={isChecked(r)}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                        />
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: tag.bg,
                            color: tag.fg,
                          }}
                        >
                          {tag.label}
                        </span>
                      </td>
                      {/* doc-no: REAL where present (gr.no), em-dash on null */}
                      <td style={{ ...td, fontWeight: 600 }} className="num">
                        {r.docNo ? <span style={{ color: "var(--brand)" }}>{r.docNo}</span> : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                      </td>
                      {/* description: no wire field -> em-dash (error sub-line omitted) */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      {/* value: REAL where present, em-dash on null (gr carries a quantity) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {r.amount != null ? formatMoney(r.amount) : <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                      </td>
                      {/* creator: no wire field -> em-dash */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                      {/* time: REAL created_at (UTC), em-dash on missing/invalid */}
                      <td style={{ ...td, fontSize: 11, color: "var(--text-3)" }} className="num">
                        {time || DASH}
                      </td>
                      {/* status / JV: posted -> tag + jv_no; pending -> badge */}
                      <td style={td}>
                        {r.status === "posted" ? (
                          <span style={{ fontSize: 11 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "var(--ok-soft)",
                                color: "var(--ok)",
                              }}
                            >
                              {POSTED_TAG}
                            </span>{" "}
                            {r.jvNo ? (
                              <span className="num" style={{ color: "var(--brand)" }}>
                                {r.jvNo}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                            )}
                          </span>
                        ) : (
                          <PendingBadge label={t("fin.statusPending")} />
                        )}
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
