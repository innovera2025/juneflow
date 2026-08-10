/*
 * MasterProjectType — the Project Type catalogue screen, ported 1:1 from
 * pototype/project-type-screen.jsx MasterProjectType (L15-108) + MODULE_LABELS (L5-12).
 * Route master.ptype, visual-gate reference tests/visual/reference/gallery/g2/29.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the add-type action, and the two-column type-card grid (colour-topped
 * card; icon-box header with name + nameEn + desc + edit action; the WBS chevron chips,
 * the cost-type tag chips, the enabled-module check-chips, and the project-usage footer)
 * — is the prototype's, verbatim.
 *
 * Mock mechanics dropped (rule 3): the prototype's PROJECT_TYPE_LIST local state becomes
 * the real platform-global reference table (GET /project-types, useProjectTypes) whose
 * rows carry {id, key, name, hierarchy, modules[]}; the project-usage footer counts the
 * real GET /projects rows whose `type` equals the card key (useProjects). The 5
 * presentation fields the server omits (nameEn / desc / icon / color / costTypes) come
 * from client meta (ptype-meta.json), keyed by `key`. The enabled-module chips render in
 * the FIXED ALL_MODULES order (ptype-cards.ts) so PM renders last, exactly like the
 * reference, even though the seed lists `pm` mid-array.
 *
 * i18n (rule 2): every chrome string is a master./ptype./common. dict key (t), the
 * breadcrumb crumb-2 is the ptype navCrumb nav key (tn, ptype-strings.json), and the 16
 * module labels split 7 DICT (t, MOD_DICT -> ptype.mod.*) + 9 PHRASE (tp,
 * ptype-strings.json `mod`). Data values (row.name / row.hierarchy / meta.* / project
 * names) render raw. §9 verified ZERO residual keys.
 *
 * Write-path DEFERRED — but CORRECTED 2026-08-10: "no backend route yet" was FALSE.
 * project-types.ts:117 mounts POST and :168 mounts PUT; both validate name + hierarchy,
 * 409 on a duplicate key across the tenant's visible set, force-set company_id so a custom
 * type can never be global, and 404 a platform-global default. B-065 was answered and
 * shipped. The 26 ptype.* form keys (editTitle / fldNameTh / fldNameEn / fldIcon / secWbs /
 * secCostTypes / secModules / hints / placeholders / toastAdd / toastEdit) are all minted
 * and all unconsumed.
 *
 * The real blocker is a SCHEMA gap needing a ruling (B-352): project_type stores only
 * { key, name, hierarchy, modules } (packages/db project.ts:113-134), while the prototype
 * form (project-type-screen.jsx:114-190) also collects nameEn, icon, color, desc and
 * costTypes — five fields the handler drops (project-types.ts:161-163). This screen already
 * knows it: those five are read from a CLIENT meta file (ptype-meta.json, keyed by `key`),
 * so a user-created type falls through to DEFAULT_META and renders with a borrowed icon and
 * colour. Options are add-columns (a sacred migration), render the five disabled, or keep
 * deferring — a ruling, not a port decision.
 *
 * The header add button + per-card edit button RENDER (they are in g2/29) but have NO
 * onClick — render-only stubs, mirroring master-project.tsx createBtn + master-model.tsx
 * edit (B-050). Worth naming plainly: an enabled control that does nothing on click is its
 * own small lie; whether this three-screen family should become honest-disabled is the
 * cross-screen ruling B-347. tokens back every colour except the per-type meta.color hex,
 * which is prototype-verbatim (B-037), same precedent as the sibling screens.
 */
import { Fragment, useMemo, type CSSProperties } from "react";
import type { DictKey, NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useProjects } from "../../shell/use-shell-data";
import { useProjectTypes } from "./use-project-hierarchy";
import {
  toTypeCard,
  enabledModules,
  projectsByType,
  MOD_DICT,
  type TypeCard,
} from "./ptype-cards";
import ptypeStrings from "./ptype-strings.json" with { type: "json" };
import ptypeMeta from "./ptype-meta.json" with { type: "json" };

/** Client presentation meta the server omits (project-types.jsx PROJECT_TYPES). */
interface TypeMeta {
  nameEn: string;
  desc: string;
  icon: string;
  color: string;
  costTypes: string[];
}

/** meta keyed by type key; the JSON also carries a string `_source` note (skipped). */
const META = ptypeMeta as Record<string, TypeMeta | string | undefined>;

/**
 * Defensive fallback when a server type key has no client meta (never fires for the 4
 * fixed platform-global types) — token colour only, no invented hex/copy.
 */
const FALLBACK_META: TypeMeta = {
  nameEn: "",
  desc: "",
  icon: "grid",
  color: "var(--brand)",
  costTypes: [],
};

/** Resolve the presentation meta for a type key. */
function metaFor(key: string): TypeMeta {
  const m = META[key];
  return m && typeof m === "object" ? m : FALLBACK_META;
}

/** Section label (WBS / Cost Types / Modules) — uppercase muted caption (project-type-screen.jsx:65). */
const SEC_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 7,
};

export function MasterProjectType() {
  const { t, tn, tp } = useI18n();

  const typesQ = useProjectTypes();
  const projectsQ = useProjects();

  const cards = useMemo<TypeCard[]>(
    () => (typesQ.data ?? []).map(toTypeCard),
    [typesQ.data],
  );
  const projects = projectsQ.data ?? [];

  const navCrumb = tn(ptypeStrings.navCrumb as NavKey);

  // Module label: 7 keys are stable DICT keys (t via MOD_DICT); the other 9 are PHRASE
  // keys (tp via ptype-strings.json). Every enabled module is one of the 16 ALL_MODULES,
  // so this always resolves; the raw-key fallback is unreachable (defensive only).
  const moduleLabel = (key: string): string => {
    const dictKey = MOD_DICT[key];
    if (dictKey) return t(dictKey as DictKey);
    const phraseKey = (ptypeStrings.mod as Record<string, string>)[key];
    return phraseKey ? tp(phraseKey as PhraseKey) : key;
  };

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), navCrumb]}
      title={t("ptype.title")}
      subtitle={t("ptype.subtitle")}
      actions={
        // Add-type deferred on the SCHEMA gap (B-352), not on a missing route:
        // POST /project-types is mounted (project-types.ts:117). Render-only stub —
        // no onClick (present in g2/29); see B-347 on that convention.
        <Btn kind="primary" size="md" icon="plus">
          {t("ptype.addBtn")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {typesQ.isLoading
          ? // Loading skeleton (2x2 grid) — token blocks, no invented copy.
            [0, 1, 2, 3].map((n) => (
              <div
                key={n}
                style={{
                  height: 300,
                  borderRadius: "var(--r-lg)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))
          : cards.map((card) => {
              const meta = metaFor(card.key);
              const onMods = enabledModules(card.modules);
              const projs = projectsByType(projects, card.key);
              // ptype.projUsage = "…{n}…{names}"; split so the count renders bold+num
              // and the joined project names render raw (project-type-screen.jsx:96-97).
              const usage = t("ptype.projUsage");
              const [usagePre, afterN] = usage.split("{n}");
              const [usageMid, usagePost] = (afterN ?? "").split("{names}");
              const projectNames = projs.map((p) => p.name).join(", ");
              return (
                <Card key={card.id} pad={0} style={{ overflow: "hidden" }}>
                  {/* Header — icon-box + name/nameEn/desc + edit stub */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      padding: 18,
                      borderBottom: "1px solid var(--border)",
                      borderTop: `3px solid ${meta.color}`,
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 11,
                        flexShrink: 0,
                        background: `color-mix(in srgb, ${meta.color} 14%, white)`,
                        color: meta.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={meta.icon as IconName} size={23} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{card.name}</span>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{meta.nameEn}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5 }}>
                        {meta.desc}
                      </div>
                    </div>
                    {/* Per-card edit — PUT /project-types/{id} is mounted (:168); deferred on
                        the schema gap B-352. Render-only stub, no onClick (see B-347). */}
                    <Btn kind="ghost" size="sm" icon="edit">
                      {t("common.edit")}
                    </Btn>
                  </div>

                  {/* Body — WBS / Cost Types / Modules / usage footer */}
                  <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* WBS hierarchy chips (chevron-separated) */}
                    <div>
                      <div style={SEC_LABEL}>{t("ptype.secWbs")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {card.hierarchy.map((h, i) => (
                          <Fragment key={i}>
                            {i > 0 && <Icon name="chevR" size={12} color="var(--text-3)" />}
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 600,
                                padding: "3px 9px",
                                borderRadius: 6,
                                background: "var(--surface-2)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {h}
                            </span>
                          </Fragment>
                        ))}
                      </div>
                    </div>

                    {/* Cost-type tag chips — inline ds.jsx Tag (tone = meta.color); no ui/Tag primitive. */}
                    <div>
                      <div style={SEC_LABEL}>{t("ptype.secCostTypes")}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {meta.costTypes.map((c, i) => (
                          <span
                            key={i}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "3px 9px",
                              borderRadius: 6,
                              background: `color-mix(in srgb, ${meta.color} 13%, white)`,
                              color: meta.color,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Enabled-module check-chips — FIXED ALL_MODULES order (PM last). */}
                    <div>
                      <div style={SEC_LABEL}>
                        {t("ptype.modUsed").replace("{n}", String(onMods.length))}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {onMods.map((m) => (
                          <span
                            key={m}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: "var(--ok-soft)",
                              color: "var(--ok)",
                            }}
                          >
                            <Icon name="check" size={11} />
                            {moduleLabel(m)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Project-usage footer (count bold+num / no-projects fallback) */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingTop: 12,
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                        {projs.length > 0 ? (
                          <>
                            {usagePre}
                            <b className="num" style={{ color: "var(--text)" }}>
                              {projs.length}
                            </b>
                            {usageMid}
                            {projectNames}
                            {usagePost}
                          </>
                        ) : (
                          t("ptype.noProjects")
                        )}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
      </div>
    </Page>
  );
}
