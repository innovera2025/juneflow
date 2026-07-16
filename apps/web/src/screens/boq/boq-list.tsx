/*
 * BOQList — the BOQ List screen, ported 1:1 from pototype/boq-list.jsx BOQList (L64-211).
 * Route boq.list (docs/extract/NAV-ROUTES.md L22), visual-gate reference
 * tests/visual/reference/gallery/g1/08.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the two header actions (import-Excel / create-BOQ), the 4-card KPI strip
 * (all · filtered value · approved · draft+pending), the toolbar (search + project/phase/
 * status filters + the show-count), the full-width table (code · name · project-scope ·
 * right-aligned value · status badge · version · owner · updated · manage), the totals
 * tfoot, and the empty state — is the prototype's, verbatim. The row "open" + "…" menu and
 * the "create BOQ" modal (new-boq-form.tsx) reproduce the prototype's actions.
 *
 * Data (rule 8): GET /boq (use-boq.ts) via the generated client — the prototype's local
 * BOQStore becomes the server catalogue. Each doc's real fields
 * { id, no, name, scope, project_id, version, status, currency_code, total } drive the row;
 * the project NAME resolves from project_id via GET /projects (§0 rule 3). Pure logic
 * (filter / KPI aggregates / status tone / money format) lives in boq-rows.ts (unit-tested,
 * gate G3).
 *
 * WIRE GAP (reported honestly, not fabricated): the prototype's `owner` (responsible person) and
 * `updated` (last-updated) columns have NO source on the /boq wire (boq_doc has no owner
 * column; updatedAt exists but is not exposed), and there is no phase column, so those two
 * cells render an em-dash and the phase filter carries only its "all" option — no invented
 * data. The row duplicate/print/delete actions have no backend endpoint yet (no
 * DELETE/duplicate/print /boq route), so they are deferred stubs (B-066 precedent);
 * open/edit navigate to the BOQ editor route (real).
 *
 * i18n (rule 2): every string is a boq.list* / common. / nav.sec.boq dict key (t), the
 * "BOQ List" nav label (tn), or a boq-strings.json phrase (tp). Tokens back every colour
 * (rule 6); the status dot hexes are prototype-verbatim (B-037(a), in boq-rows.ts).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
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
  millionsValue,
  filterBoqRows,
  sumTotal,
  countByStatuses,
  projectNameById,
  type BoqRow,
} from "./boq-rows";
import { NewBOQForm } from "./new-boq-form";
import boqStrings from "./boq-strings.json" with { type: "json" };

const P = (k: keyof typeof boqStrings) => boqStrings[k] as PhraseKey;

/** Table header cell style, ported from ds.jsx th() (L214-219) — same as master-cc/docnum. */
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

/** Filter pill (native <select> styled like ds.jsx Dropdown mode="filter", muted). */
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

/** KPI card, inlined from dashboard.jsx Kpi (L93-115) — web has no shared Kpi component. */
function KpiCard({
  label,
  value,
  unit,
  sub,
  delta,
  deltaTone,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: string;
  deltaTone?: "ok" | "danger";
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}
      >
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
        {delta && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color:
                deltaTone === "danger" ? "var(--danger)" : deltaTone === "ok" ? "var(--ok)" : "var(--text-3)",
              background:
                deltaTone === "danger"
                  ? "var(--danger-soft)"
                  : deltaTone === "ok"
                    ? "var(--ok-soft)"
                    : "var(--surface-3)",
              padding: "2px 7px",
              borderRadius: 999,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Row "…" popover menu item (boq-list.jsx menuItem). */
const menuItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};

export function BOQList() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const boqQ = useBoqList();
  const projectsQ = useProjects();

  const [project, setProject] = useState("");
  const [phase, setPhase] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const docs = useMemo<BoqRow[]>(() => (boqQ.data ?? []).map(toBoqRow), [boqQ.data]);
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  const rows = useMemo(
    () => filterBoqRows(docs, { projectId: project, status, q }),
    [docs, project, status, q],
  );
  const totalValue = sumTotal(rows);

  const navTitle = tn(boqStrings.navBoqList as NavKey);

  const openEditor = (d: BoqRow) => {
    ctx.navigate("boq.editor", {
      no: d.no,
      name: d.name,
      scope: `${projectNames.get(d.projectId) ?? ""} · ${d.scope}`,
      status: d.status,
      ver: versionLabel(d.version),
    });
  };

  const openCreate = (preset?: string) => {
    ctx.openModal({
      title: tp(P("newBoq")),
      subtitle: t("boq.listNewSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "xl",
      body: ({ close }: { close: () => void }) => (
        <NewBOQForm
          onClose={close}
          presetTemplate={preset}
          existingNos={docs.map((d) => d.no)}
          existingDocs={docs.map((d) => ({ no: d.no, name: d.name }))}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), navTitle]}
      title={navTitle}
      subtitle={t("boq.listSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="upload" onClick={() => openCreate("excel")}>
            {tp(P("importExcel"))}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => openCreate()}>
            {tp(P("newBoq"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}
      >
        <KpiCard
          label={t("boq.listKpiAll")}
          value={String(docs.length)}
          unit={tp(P("unitDocs"))}
          sub={t("boq.listKpiMatchFilter").replace("{n}", String(rows.length))}
          accent="var(--brand)"
        />
        <KpiCard
          label={t("boq.listKpiValueFilter")}
          value={millionsValue(totalValue)}
          unit={tp(P("unitMillionBaht"))}
          sub={t("boq.listKpiValueSub")}
        />
        <KpiCard
          label={tp(P("statusApproved"))}
          value={String(countByStatuses(docs, ["approved"]))}
          unit={tp(P("unitDocs"))}
          delta="✓"
          deltaTone="ok"
          accent="var(--ok)"
        />
        <KpiCard
          label={t("boq.listKpiDraftPending")}
          value={String(countByStatuses(docs, ["draft", "pending", "revise"]))}
          unit={tp(P("unitDocs"))}
          delta={t("boq.listKpiPendingDelta")}
          deltaTone="danger"
          accent="var(--warn)"
        />
      </div>

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
              placeholder={t("boq.listSearchPh")}
              style={{
                border: "none",
                outline: "none",
                width: 240,
                fontSize: 12,
                background: "transparent",
                color: "var(--text)",
              }}
            />
          </div>
          <FilterSelect value={project} onChange={setProject}>
            <option value="">{tp(P("allProjects"))}</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FilterSelect>
          {/* Phase filter: no phase column on the /boq wire — present for fidelity, carries
              only its "all" option (WIRE GAP, flagged in the header). */}
          <FilterSelect value={phase} onChange={setPhase}>
            <option value="">{tp(P("allPhases"))}</option>
          </FilterSelect>
          <FilterSelect value={status} onChange={setStatus}>
            <option value="">{t("boq.listStatusAll")}</option>
            <option value="draft">{tp(P("statusDraft"))}</option>
            <option value="approved">{tp(P("statusApproved"))}</option>
            <option value="revise">{tp(P("statusRevise"))}</option>
            <option value="pending">{tp(P("statusPending"))}</option>
          </FilterSelect>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
            {t("boq.listShowCount")
              .replace("{shown}", String(rows.length))
              .replace("{total}", String(docs.length))}
          </span>
        </div>

        {boqQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror master-cc/docnum).
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
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {/* boq.listEmptyText = "... {create}"; {create} is the create-BOQ link. */}
              {t("boq.listEmptyText").split("{create}")[0]}
              <a
                onClick={() => openCreate()}
                style={{ color: "var(--brand)", cursor: "pointer", fontWeight: 600 }}
              >
                {tp(P("newBoq"))}
              </a>
            </div>
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--text-3)", background: "var(--surface-2)" }}>
                  <th style={th(140)}>{t("boq.listThCodeBoq")}</th>
                  <th style={th()}>{t("boq.listThNameBoq")}</th>
                  <th style={th(220)}>{t("boq.listThScope")}</th>
                  <th style={th(130, true)}>{tp(P("thValue"))}</th>
                  <th style={th(120)}>{t("common.status")}</th>
                  <th style={th(90)}>{tp(P("thVersion"))}</th>
                  <th style={th(140)}>{tp(P("thOwner"))}</th>
                  <th style={th(110)}>{tp(P("thUpdated"))}</th>
                  <th style={th(120, true)}>{tp(P("thManage"))}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const st = statusTone(d.status);
                  return (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
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
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: 12 }}>{projectNames.get(d.projectId) ?? ""}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{d.scope}</div>
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <span className="num" style={{ fontWeight: 700 }}>
                          {formatMoney(d.total)}
                        </span>
                      </td>
                      <td style={td}>
                        {/* Inline StatusBadge (ds.jsx L93, size="sm"): tokened bg/fg + verbatim dot. */}
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
                          {tp(P(statusStringName(d.status)))}
                        </span>
                      </td>
                      <td style={td}>
                        <span className="num" style={{ color: "var(--text-2)" }}>
                          {versionLabel(d.version)}
                        </span>
                      </td>
                      {/* WIRE GAP: no owner column on the /boq wire — em-dash, never fabricated. */}
                      <td style={{ ...td, color: "var(--text-2)" }}>—</td>
                      {/* WIRE GAP: updatedAt exists on the table but is not exposed on the wire. */}
                      <td style={{ ...td, color: "var(--text-3)", fontSize: 11.5 }}>—</td>
                      <td style={{ ...td, textAlign: "right", position: "relative" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          <Btn kind="soft" size="sm" icon="edit" onClick={() => openEditor(d)}>
                            {tp(P("openBtn"))}
                          </Btn>
                          <button
                            type="button"
                            onClick={() => setMenuFor(menuFor === d.id ? null : d.id)}
                            style={{
                              width: 28,
                              height: 28,
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              background: "var(--surface)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                          >
                            <Icon name="more" size={14} color="var(--text-3)" />
                          </button>
                        </div>
                        {menuFor === d.id && (
                          <>
                            <div
                              onClick={() => setMenuFor(null)}
                              style={{ position: "fixed", inset: 0, zIndex: 20 }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: 36,
                                right: 8,
                                zIndex: 30,
                                width: 168,
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: 4,
                                boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
                                textAlign: "left",
                              }}
                            >
                              <div
                                onClick={() => {
                                  setMenuFor(null);
                                  openEditor(d);
                                }}
                                style={menuItem}
                              >
                                <Icon name="edit" size={12} color="var(--text-2)" /> {t("boq.listEditInEditor")}
                              </div>
                              {/* Duplicate / print / delete — deferred stubs (no /boq endpoint yet). */}
                              <div onClick={() => setMenuFor(null)} style={menuItem}>
                                <Icon name="copy" size={12} color="var(--text-2)" /> {tp(P("duplicate"))}
                              </div>
                              <div onClick={() => setMenuFor(null)} style={menuItem}>
                                <Icon name="print" size={12} color="var(--text-2)" /> {t("common.print")}
                              </div>
                              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                              <div
                                onClick={() => setMenuFor(null)}
                                style={{ ...menuItem, color: "var(--danger)" }}
                              >
                                <Icon name="x" size={12} color="var(--danger)" /> {t("common.delete")}
                              </div>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                <tr>
                  <td colSpan={3} style={{ padding: 12, fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                    {t("boq.listFootTotal").replace("{n}", String(rows.length))}
                  </td>
                  <td
                    style={{ padding: 12, textAlign: "right", fontSize: 14, fontWeight: 700, color: "var(--brand)" }}
                    className="num"
                  >
                    {formatMoney(totalValue)}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
