/*
 * MasterCC — the Cost Center screen, ported 1:1 from pototype/master.jsx MasterCC
 * (L666-731). Route master.cc, visual-gate reference tests/visual/reference/gallery/g2/34.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the add-cost-center action, and the full-width table (code · name ·
 * type pill · link · owner avatar+name · right-aligned budget · status badge; NO edit
 * column) — is the prototype's, verbatim. The status badge reproduces ds.jsx <StatusBadge
 * size="sm"> inline (there is no shared StatusBadge in web): tokened bg/fg + the prototype-
 * verbatim dot hex (B-037(a)). The code cell is right-aligned inline because the web
 * base.css `.num` rule omits the prototype styles.css `td.num { text-align:right }`
 * (matching the g2/34 reference; scoped here to stay within this screen).
 *
 * Mock mechanics dropped (rule 3): the prototype's CC_SEED local state + window.__ccExtra
 * become the real server catalogue (GET /cost-centers, use-cost-centers.ts); create is
 * POST /cost-centers (server forces status="draft" + THB, so the body omits them; B-059)
 * that invalidates the list. The POST body's budget is FULL baht (NOT ×1e6 — that is a
 * models-only scaling) and project_id comes from the active project (resolveActiveProject);
 * without an active project the add button is disabled (the POST 400s without project_id).
 *
 * i18n (rule 2): navTitle is the "Cost Center" nav_i18n key (tn), sourced from
 * cc-strings.json so no Thai literal sits in this .tsx (i18n-guard). statusDraft/
 * statusApproved are cc-strings.json phrases (tp); the type-pill label is the raw server
 * `type` (Project/Overhead/Dept — data, not i18n). Tokens back every colour (rule 6).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import {
  toCostCenterRow,
  typeBadgeTone,
  statusTone,
  formatMoney,
  type CostCenterRow,
} from "./cc-rows";
import { useCostCenterList, useCreateCostCenter } from "./use-cost-centers";
import { CCAddForm, type CcDraft } from "./cc-add-form";
import ccStrings from "./cc-strings.json" with { type: "json" };

/** Table header cell style, ported from ds.jsx th() (L214-219). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "left",
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

export function MasterCC() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const ccQ = useCostCenterList();
  const createCC = useCreateCostCenter();
  const projectsQ = useProjects();

  const rows = useMemo<CostCenterRow[]>(
    () => (ccQ.data ?? []).map(toCostCenterRow),
    [ccQ.data],
  );

  // Active project (ProjectSwitcher selection) — the POST needs project_id (B-059). No
  // active project -> the add button is disabled (the POST 400s without it).
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);

  const navTitle = tn(ccStrings.navTitle as NavKey);
  const draftWord = tp(ccStrings.statusDraft as PhraseKey);
  const approvedWord = tp(ccStrings.statusApproved as PhraseKey);

  // add cost center (master.jsx:669-681): open the form modal; on submit fire the create
  // mutation (server forces status="draft" + THB) + the add toast, then close.
  const openAdd = () => {
    if (!active) return; // guarded by the disabled add button; keeps project_id present
    ctx.openModal({
      title: t("cc.modalTitle"),
      subtitle: t("cc.modalSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <CCAddForm
          existingCodes={rows.map((r) => r.code)}
          onClose={close}
          onSubmit={(draft: CcDraft) => {
            // Compose the opaque POST /cost-centers body: budget FULL baht (comma-stripped),
            // project_id from the active project; status/currency_code are server-forced.
            createCC.mutate(
              {
                code: draft.code,
                name: draft.name,
                type: draft.type,
                link: draft.link,
                owner: draft.owner,
                budget: Number((draft.budget || "0").replace(/,/g, "")),
                project_id: active.id,
              },
              {
                onSuccess: () =>
                  ctx.notify(t("cc.toastAdd").replace("{code}", draft.code)),
              },
            );
            close();
          }}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), navTitle]}
      title={t("cc.title")}
      subtitle={t("cc.subtitle")}
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={openAdd} disabled={!active}>
          {t("cc.addBtn")}
        </Btn>
      }
    >
      <Card pad={0}>
        {ccQ.isLoading ? (
          // Loading skeleton — token blocks, no invented copy (mirror master-company).
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
                <th style={th()}>{t("cc.thCode")}</th>
                <th style={th()}>{t("cc.fldName")}</th>
                <th style={th(140)}>{t("cc.fldType")}</th>
                <th style={th(180)}>{t("cc.thLink")}</th>
                <th style={th(110)}>{t("cc.thOwner")}</th>
                <th style={{ ...th(140), textAlign: "right" }}>{t("cc.thBudget")}</th>
                <th style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            {/* Empty tbody when the catalogue is empty = the table's empty state (no
                invented copy), mirroring master-model's empty grid. */}
            <tbody>
              {rows.map((r) => {
                const tt = typeBadgeTone(r.type);
                const st = statusTone(r.status);
                const approved = r.status === "approved";
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* code — right-aligned inline (styles.css td.num; web base.css omits it). */}
                    <td style={{ ...td, fontWeight: 600, textAlign: "right" }} className="num">
                      <span style={{ color: "var(--brand)" }}>{r.code}</span>
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: tt.bg,
                          color: tt.fg,
                        }}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{r.link}</td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {/* #0F766E owner avatar — prototype-verbatim (B-037(a), Avatar default). */}
                        <Avatar name={r.owner} size={20} color="#0F766E" />
                        <span style={{ fontSize: 11.5 }}>{r.owner}</span>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                      {formatMoney(r.budget)}
                    </td>
                    <td style={td}>
                      {/* Inline StatusBadge (ds.jsx L93, size="sm"): tokened bg/fg + the
                          prototype-verbatim dot hex (B-037(a)). */}
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
                        <span
                          style={{ width: 6, height: 6, borderRadius: 999, background: st.dot }}
                        />
                        {approved ? approvedWord : draftWord}
                      </span>
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
