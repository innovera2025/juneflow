/*
 * MasterCompany — the Company / Organization structure screen, ported 1:1 from
 * pototype/master.jsx MasterCompany (L116-234). Route master.company (NAV-ROUTES.md
 * L96), visual-gate reference tests/visual/reference/gallery/g2/28.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb (master
 * data > Company/Org), title/subtitle, the add-company action, the card header with the
 * live company/department count + SAP-sync line, and the collapsible level-nested tree
 * (level-0 brand-soft card, level-1 surface-2, level-2 transparent) with the per-row
 * kebab (edit / add sub-unit / delete) — is the prototype's, verbatim. Every string is
 * an org.* / common.* dict key, the company-unit phrase (org-strings.json), or opaque row
 * data (rule 2); tokens back every colour (rule 6).
 *
 * Mock mechanics dropped (rule 3): the prototype's ORG_SEED local state becomes the real
 * server tree (GET /org-units, use-org-units.ts); add/edit/delete are POST/PUT/DELETE that
 * invalidate the query so the list re-renders in the server's pre-order (the prototype's
 * in-array insert/splice is server-side now). Parent links move from the mock `code` to the
 * real `id`. Toasts (ctx.notify) fire from the dict TEMPLATES with {name}/{code} interpolated.
 */
import { useMemo, useState } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toOrgNode,
  hasChildren,
  childCount,
  orgCounts,
  visibleRows,
  type OrgNode,
} from "./org-tree";
import {
  useOrgUnits,
  useCreateOrgUnit,
  useUpdateOrgUnit,
  useDeleteOrgUnit,
} from "./use-org-units";
import { OrgAddForm, type OrgPreset } from "./org-add-form";
import orgStrings from "./org-strings.json" with { type: "json" };

export function MasterCompany() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const query = useOrgUnits();
  const createMut = useCreateOrgUnit();
  const updateMut = useUpdateOrgUnit();
  const deleteMut = useDeleteOrgUnit();

  const rows = useMemo<OrgNode[]>(() => (query.data ?? []).map(toOrgNode), [query.data]);
  const { companies, depts } = orgCounts(rows);
  const companyUnit = tp(orgStrings.companyUnit as PhraseKey);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const vis = visibleRows(rows, collapsed);

  // create/edit — fire the mutation and the matching toast template (rule 3).
  const handleSubmit = (body: Record<string, unknown>, preset: OrgPreset | null) => {
    if (preset?.id) {
      updateMut.mutate(
        { id: preset.id, body },
        {
          onSuccess: () =>
            ctx.notify(t("org.toastEdit").replace("{name}", String(body.name ?? preset.name ?? ""))),
        },
      );
      return;
    }
    createMut.mutate(body, {
      onSuccess: () => {
        const tmpl = body.kind === "company" ? t("org.toastAddCompany") : t("org.toastAddDept");
        ctx.notify(
          tmpl.replace("{name}", String(body.name ?? "")).replace("{code}", String(body.code ?? "")),
        );
      },
    });
  };

  const removeRow = (r: OrgNode) => {
    setMenuFor(null);
    deleteMut.mutate(r.id, {
      onSuccess: () => ctx.notify(t("org.toastDelete").replace("{name}", r.name), "danger"),
    });
  };

  // Header keys on a REAL edit (preset.id present), not mere preset truthiness. The
  // prototype's `preset ? edit-title(preset.name) : add-title` renders an "<edit> undefined"
  // title for the add-sub preset ({level,parent_id} — no id/name), while its own form treats
  // add-sub as an ADD (editing = has code). We key the header the same way the form does, so
  // add-sub shows the ADD header. The prototype's undefined-name title is an internal
  // inconsistency, not intended copy (PLAN §0 rule 4: not reproduced, not silently improved).
  const openAdd = (preset?: OrgPreset) =>
    ctx.openModal({
      title: preset?.id ? `${t("common.edit")} ${preset.name ?? ""}` : t("org.addBtn"),
      subtitle: preset?.id ? t("org.editSubtitle") : t("org.addSubtitle"),
      icon: preset?.id ? "edit" : "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <OrgAddForm
          rows={rows}
          preset={preset}
          onClose={close}
          onSubmit={(bd, ps) => {
            handleSubmit(bd, ps);
            close();
          }}
        />
      ),
    });

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), tn("Company / Org")]}
      title={t("org.pageTitle")}
      subtitle={t("org.subtitle")}
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={() => openAdd()}>
          {t("org.addBtn")}
        </Btn>
      }
    >
      <Card pad={0}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {t("org.orgStructure")}{" "}
            <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
              {`· ${companies} ${companyUnit} · ${depts} ${t("org.unitDept")}`}
            </span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ok)" }} />
            {t("org.syncStatus")}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {query.isLoading
            ? // Loading skeleton (top-level loading state) — token blocks, no invented copy.
              [0, 1, 2].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 46,
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))
            : vis.map(({ r, i }) => {
                const kids = hasChildren(rows, i);
                const isCollapsed = collapsed.has(r.id);
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      marginLeft: r.level * 28,
                      borderRadius: 8,
                      marginBottom: 4,
                      background:
                        r.level === 0
                          ? "var(--brand-soft)"
                          : r.level === 1
                            ? "var(--surface-2)"
                            : "transparent",
                      border: r.level === 0 ? "1px solid var(--brand)" : "1px solid var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => kids && toggle(r.id)}
                      style={{
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        border: "none",
                        background: "transparent",
                        cursor: kids ? "pointer" : "default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                      }}
                    >
                      {kids && (
                        <Icon
                          name="chevR"
                          size={14}
                          color="var(--text-3)"
                          style={{
                            transform: isCollapsed ? "none" : "rotate(90deg)",
                            transition: "transform .15s",
                          }}
                        />
                      )}
                    </button>
                    <Icon
                      name={r.icon as IconName}
                      size={16}
                      color={r.level === 0 ? "var(--brand)" : "var(--text-2)"}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: r.level === 0 ? 700 : 600 }}>
                        {r.name}
                        <span
                          className="num"
                          style={{
                            marginLeft: 8,
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "var(--surface)",
                            color: "var(--text-3)",
                          }}
                        >
                          {r.code}
                        </span>
                        {kids && isCollapsed && (
                          <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-3)" }}>
                            {`· ${childCount(rows, r.id)} ${t("org.unitSub")}`}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{r.note}</div>
                    </div>
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          background: "var(--surface)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="more" size={14} color="var(--text-3)" />
                      </button>
                      {menuFor === r.id && (
                        <>
                          <div
                            onClick={() => setMenuFor(null)}
                            style={{ position: "fixed", inset: 0, zIndex: 20 }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              top: 32,
                              right: 0,
                              zIndex: 30,
                              width: 150,
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 4,
                              boxShadow: "0 8px 24px rgba(15,23,42,0.16)",
                            }}
                          >
                            <div
                              onClick={() => {
                                setMenuFor(null);
                                openAdd(r);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 9,
                                padding: "8px 10px",
                                borderRadius: 6,
                                cursor: "pointer",
                                fontSize: 12.5,
                              }}
                            >
                              <Icon name="edit" size={13} color="var(--text-2)" /> {t("common.edit")}
                            </div>
                            {r.level !== 0 && (
                              <div
                                onClick={() => {
                                  setMenuFor(null);
                                  openAdd({ level: 1, parent_id: r.id });
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 9,
                                  padding: "8px 10px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  fontSize: 12.5,
                                }}
                              >
                                <Icon name="plus" size={13} color="var(--text-2)" /> {t("org.menuAddSub")}
                              </div>
                            )}
                            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                            <div
                              onClick={() => removeRow(r)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 9,
                                padding: "8px 10px",
                                borderRadius: 6,
                                cursor: "pointer",
                                fontSize: 12.5,
                                color: "var(--danger)",
                              }}
                            >
                              {/* ds.jsx has no "trash" glyph — the prototype renders it blank
                                  (paths["trash"]||null); we reproduce the blank rather than
                                  invent a glyph (PLAN.md §0). */}
                              <svg width={13} height={13} viewBox="0 0 24 24" aria-hidden="true" />{" "}
                              {t("common.delete")}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      </Card>
    </Page>
  );
}
