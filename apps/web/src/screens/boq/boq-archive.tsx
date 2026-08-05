/*
 * BOQArchive — the BOQ Archive screen, ported 1:1 from pototype/boq.jsx BOQArchive
 * (L1468-1631). Route boq.archive (docs/extract/NAV-ROUTES.md L27), visual-gate reference
 * tests/visual/reference/gallery/g1/13. B-070 ruling: archive = read-view, match-prototype.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout is the prototype's, verbatim — the
 * two-crumb breadcrumb, the title/subtitle, the two header actions (filter / export), the
 * toolbar (search + project/status/year filters), and the full-width table (chevron · BOQ no ·
 * details · version chip · right-aligned value · latest approver · approve date · status badge ·
 * file+revise counts · row actions copy/view).
 *
 * Data (rule 8, C10): the archive is the SAME server catalogue as BOQList — GET /boq
 * (use-boq.ts) through the generated client — so the prototype's local ARCHIVE mock array is
 * dropped (§0 rule 3). The LIST payload is { id, no, name, scope, project_id, version, status,
 * currency_code, total, approved_by, approved_by_name, approved_at } (boq.ts docWire, pinned
 * by boq.test.ts's exact-key assertion). Those REAL fields drive the row; the project NAME
 * resolves from project_id via GET /projects. Row logic (search / status tone / version label /
 * money format / approval narrowing) reuses the unit-tested boq-rows.ts + boq-archive-rows.ts
 * (gate G3).
 *   - REAL (B-278 re-wire): the latest-approver cell = approved_by_name (resolved server-side
 *     from `users`, B-081/F4 + migration 0021); the approve-date cell = approved_at, rendered
 *     ISO/UTC per the house formatApprovedAt. A doc with no approval carries null for both and
 *     keeps its em-dash — the unapproved state is shown, never filled in.
 *
 * WIRE GAPS (reported honestly, never fabricated — B-066 / boq-list precedent):
 *   1. file + revise counts (the "paperclip N · history N" cell) — there is no attachments
 *      table, and the revise/version log (`version_history`) exists only on the DETAIL payload
 *      (GET /boq/{id}), not on the list rows this screen reads, so both counts render an
 *      em-dash. The version chip column is the real doc.version.
 *   2. revise-history timeline (the prototype's expandable per-doc "Revise history" panel) is
 *      likewise detail-only AND its row labels/reasons carry no i18n key, so the row is NOT
 *      expandable here — the chevron is a static structural marker. Flagged.
 *   3. the year filter stays a display-only pill (em-dash value): approved_at is the only date
 *      on the payload and it is null for every unapproved doc, so filtering by it would
 *      silently hide drafts — that needs a filter-semantics ruling, not a guess (B-279). The
 *      header filter button + the row "copy to new BOQ" action have no backend endpoint (no
 *      server filter-persist, no BOQ copy/duplicate route), so they are deferred no-op stubs
 *      (boq-overview export / boq-list duplicate precedent). The row "view" action navigates
 *      to the BOQ editor route (real).
 *
 * i18n (rule 2): every string is a boq.arc* / common. dict key (t), the boq-archive-strings.json
 * (details / value / year) or boq-strings.json (status labels) phrase (tp), or the boq.archive
 * nav label chain. The prototype's mock "grong · 1" active-filter count is dropped (§0 rule 2).
 * Tokens back every colour (rule 6); the status dot hexes are prototype-verbatim (B-037(a), in
 * boq-rows.ts). Comments are English-only (Juneflow CLAUDE.md language rule); the Thai copy
 * lives only in the i18n keys / .json sidecars.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useBoqList } from "./use-boq";
import {
  toBoqRow,
  statusTone,
  statusStringName,
  versionLabel,
  formatMoney,
  projectNameById,
  type BoqRow,
} from "./boq-rows";
import { filterArchiveRows, archiveApprovalById, formatApprovedAt } from "./boq-archive-rows";
import boqStrings from "./boq-strings.json" with { type: "json" };
import arcStrings from "./boq-archive-strings.json" with { type: "json" };

const S = (k: keyof typeof boqStrings) => boqStrings[k] as PhraseKey;
const A = (k: keyof typeof arcStrings) => arcStrings[k] as PhraseKey;

/** Table header cell style (boq-list.tsx th / ds.jsx th). */
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

/** Table body cell style (boq-list.tsx td / ds.jsx td). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Filter pill: native <select> styled like ds.jsx Dropdown mode="filter" (boq-list FilterSelect). */
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
        height: 32,
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

/**
 * Static display-only filter pill (ds.jsx Filter) — label + value + chevron. Used for the year
 * filter, which has no date source on the wire, so its value is an em-dash (WIRE GAP, header).
 */
function DisplayFilterPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
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
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600 }}>{value}</span>
      <Icon name="chevD" size={12} color="var(--text-3)" />
    </div>
  );
}

export function BOQArchive() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const boqQ = useBoqList();
  const projectsQ = useProjects();

  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const docs = useMemo<BoqRow[]>(() => (boqQ.data ?? []).map(toBoqRow), [boqQ.data]);
  // The archive-only approval cells (approved_by_name / approved_at), keyed by doc id.
  const approvals = useMemo(() => archiveApprovalById(boqQ.data), [boqQ.data]);
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);
  const rows = useMemo(
    () => filterArchiveRows(docs, projectNames, { projectId: project, status, q }),
    [docs, projectNames, project, status, q],
  );

  const openEditor = (d: BoqRow) => {
    ctx.navigate("boq.editor", {
      no: d.no,
      name: d.name,
      scope: `${projectNames.get(d.projectId) ?? ""} · ${d.scope}`,
      status: d.status,
      ver: versionLabel(d.version),
    });
  };

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), t("boq.arcTitle")]}
      title={t("boq.arcTitle")}
      subtitle={t("boq.arcSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Filter / export: no server filter-persist + no export endpoint yet -> deferred
              no-op stubs (boq-overview export / boq-list stub precedent). The prototype's
              mock "· 1" active-filter count is dropped (§0 rule 2). */}
          <Btn kind="outline" size="md" icon="filter">
            {t("common.filter")}
          </Btn>
          <Btn kind="outline" size="md" icon="download">
            {t("common.export")}
          </Btn>
        </div>
      }
    >
      <Card pad={0}>
        {/* Toolbar */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
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
              placeholder={t("boq.arcSearchPh")}
              style={{
                border: "none",
                outline: "none",
                width: 280,
                fontSize: 12,
                background: "transparent",
                color: "var(--text)",
              }}
            />
          </div>
          <FilterSelect value={project} onChange={setProject}>
            <option value="">{tp(S("allProjects"))}</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={status} onChange={setStatus}>
            <option value="">{t("boq.listStatusAll")}</option>
            <option value="draft">{tp(S("statusDraft"))}</option>
            <option value="pending">{tp(S("statusPending"))}</option>
            <option value="approved">{tp(S("statusApproved"))}</option>
            <option value="revise">{tp(S("statusRevise"))}</option>
          </FilterSelect>
          {/* Year filter: no date source on the /boq wire -> display-only, em-dash value. */}
          <DisplayFilterPill label={tp(A("yearLabel"))} value="—" />
        </div>

        {boqQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (boq-list precedent).
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
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="doc" size={32} color="var(--text-3)" style={{ opacity: 0.5 }} />
            {/* boq.listEmptyText = "... {create}"; the create link is list-only, so only the
                lead sentence (before {create}) is reused for the archive empty state. */}
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {t("boq.listEmptyText").split("{create}")[0]}
            </div>
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--text-3)", background: "var(--surface-2)" }}>
                  <th scope="col" style={th(30)} />
                  <th scope="col" style={th(140)}>{t("boq.arcThCodeBoq")}</th>
                  <th scope="col" style={th()}>{tp(A("thDetails"))}</th>
                  <th scope="col" style={th(80)}>{t("boq.arcThVersion")}</th>
                  <th scope="col" style={th(130, true)}>{tp(A("thValue"))}</th>
                  <th scope="col" style={th(140)}>{t("boq.arcThApprover")}</th>
                  <th scope="col" style={th(140)}>{t("boq.arcThApproveDate")}</th>
                  <th scope="col" style={th(110)}>{t("common.status")}</th>
                  <th scope="col" style={th(100)}>{t("boq.arcThFileRevise")}</th>
                  <th scope="col" style={th(90, true)} />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const st = statusTone(d.status);
                  return (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                      {/* Chevron: static structural marker — no expansion (revise-history has
                          no backend source, WIRE GAP 3). */}
                      <td style={td}>
                        <Icon name="chevR" size={14} color="var(--text-3)" />
                      </td>
                      <td style={td}>
                        <span
                          className="num"
                          style={{ fontWeight: 700, color: "var(--brand)", cursor: "pointer" }}
                          onClick={() => openEditor(d)}
                        >
                          {d.no}
                        </span>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{d.name}</div>
                      </td>
                      <td style={td}>
                        <span
                          className="num"
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "var(--brand-soft)",
                            color: "var(--brand)",
                          }}
                        >
                          {versionLabel(d.version)}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <span className="num" style={{ fontWeight: 600 }}>
                          {formatMoney(d.total)}
                        </span>
                      </td>
                      {/* Real approver: GET /boq approved_by_name (server-resolved from
                          users, B-081/F4). Unapproved docs carry null -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-2)", fontSize: 11.5 }}>
                        {approvals.get(d.id)?.approverName || "—"}
                      </td>
                      {/* Real approval timestamp: GET /boq approved_at, ISO/UTC per the
                          house formatApprovedAt. Unapproved docs carry null -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-3)", fontSize: 11.5 }}>
                        {formatApprovedAt(approvals.get(d.id)?.approvedAt ?? "") || "—"}
                      </td>
                      <td style={td}>
                        {/* Inline StatusBadge (ds.jsx, size="sm"): tokened bg/fg + verbatim dot. */}
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 9px",
                            borderRadius: 4,
                            background: st.bg,
                            color: st.fg,
                            fontSize: 11,
                            fontWeight: 600,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            letterSpacing: "-0.005em",
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: st.dot }} />
                          {tp(S(statusStringName(d.status)))}
                        </span>
                      </td>
                      {/* WIRE GAP 2: no attachments table + no revise-history log — both counts em-dash. */}
                      <td style={{ ...td, color: "var(--text-2)", fontSize: 11.5 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginInlineEnd: 8 }}>
                          <Icon name="paperclip" size={12} color="var(--text-3)" />—
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icon name="history" size={12} color="var(--text-3)" />—
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          {/* Copy to new BOQ: no BOQ copy/duplicate endpoint — deferred no-op
                              stub (boq-list duplicate precedent, WIRE GAP 4). */}
                          <Btn kind="ghost" size="sm" icon="copy" />
                          <Btn kind="ghost" size="sm" icon="eye" onClick={() => openEditor(d)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
