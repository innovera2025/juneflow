/*
 * PkgBuilderForm + openPkgBuilder — the Platform-owner create/edit PACKAGE builder modal
 * (route admin.plans), ported 1:1 from pototype/pkg-builder.jsx PkgBuilderForm (L71-184) +
 * openPkgBuilder (L62-68). Mirrors the master-vendor create/edit form-in-modal idiom
 * (master-vendor.tsx dispatch + vendor-form.tsx body + use-vendors.ts POST/PUT).
 *
 * Design fidelity (PLAN.md §0 rule 1): the 4 size-preset buttons (S/M/L/Full, each re-seeding
 * the menu set + auto-naming a new plan), the 6-field quota grid (name / price / projects /
 * users / storage / ai), the contact-price checkbox, the 2-level menu tree (group checkbox with
 * .indeterminate + per-item checkboxes, from the live NAV registry) with its selected-count
 * header, and the hidden-menu note + cancel/save footer are the prototype's, verbatim. The size
 * badge / preset hexes are reconstructed from size (B-037(a)); tokens back every other colour.
 *
 * money = SERVER (the #1 trap): the form NEVER computes a yearly/price_y — it sends price_m only
 * and the door derives price_y = price_m×10 (a client yearly is ignored). The card then displays
 * the server-returned price_y. Create sends NO id (the door strips it); edit carries the id in
 * the PATH, not the body, and preserves the color/tagline/popular columns the form has no inputs
 * for (buildPackageBody, admin-rows.ts). NO delete affordance (B-196). All wiring decisions live
 * in the pure, unit-tested admin-rows.ts (pkgNavGroups / presetMenuIds / validatePackageForm /
 * buildPackageBody) so this screen stays declarative (G3).
 *
 * i18n (rule 2): every visible string is an admin.plans.* / admin.common.* dict key (t); the
 * menu-tree group + item labels are NAV-registry keys (tn) — never minted. The auto-plan names
 * (Starter / Professional / Business / Enterprise) are ASCII proper nouns, not translatable
 * copy (prototype-verbatim). No Thai literal in source (B-073). Numeric cells carry class `num`.
 *
 * Enterprise wildcard note (honest, never fabricated): the server stores the Full plan's menus
 * as the ["*"] wildcard (seed/packages.ts). Editing it seeds the tree from ["*"] verbatim, so no
 * item checkbox matches and the header reads 1/total — an honest consequence of the wildcard
 * representation (a saved-unedited Full round-trips ["*"] faithfully). Clicking any size preset
 * re-seeds the tree from presetMenuIds (explicit ids), matching the prototype.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { components } from "@juneflow/contracts";
import { useI18n, buildTranslators, langStore } from "../../i18n";
import { useShellCtx, type ShellCtx } from "../../shell/shell-context";
import { NAV_TREE, NAV_SECTIONS } from "../../shell/nav-tree";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import {
  pkgNavGroups,
  presetMenuIds,
  validatePackageForm,
  buildPackageBody,
  type PackageRow,
  type PackageFormValues,
  type PackageFormErrors,
  type PkgNavItem,
} from "./admin-rows";
import { useCreatePackage, useUpdatePackage } from "./use-admin";

type Entity = components["schemas"]["Entity"];

/** Auto plan-name per size (pkg-builder.jsx L87) — ASCII proper nouns, not translatable copy. */
const AUTO_NAME: Record<string, string> = {
  S: "Starter",
  M: "Professional",
  L: "Business",
  Full: "Enterprise",
};

/** The 4 size-preset buttons (pkg-builder.jsx L119) — size + its admin.plans preset label key. */
const SIZE_PRESETS: readonly {
  size: string;
  labelKey: "admin.plans.presetS" | "admin.plans.presetM" | "admin.plans.presetL" | "admin.plans.presetFull";
}[] = [
  { size: "S", labelKey: "admin.plans.presetS" },
  { size: "M", labelKey: "admin.plans.presetM" },
  { size: "L", labelKey: "admin.plans.presetL" },
  { size: "Full", labelKey: "admin.plans.presetFull" },
];

/** Input style, verbatim pkg-builder.jsx fld (L85) — only the border differs on error. */
function fieldStyle(bad: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: `1px solid ${bad ? "var(--danger)" : "var(--border)"}`,
    borderRadius: 8,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
  };
}

export interface PkgBuilderFormProps {
  /** The package being edited, or null for a new one (pkg-builder.jsx L72). */
  preset?: PackageRow | null;
  onClose: () => void;
}

export function PkgBuilderForm({ preset = null, onClose }: PkgBuilderFormProps) {
  const { t, tn } = useI18n();
  const ctx = useShellCtx();
  const isEdit = preset != null;

  const create = useCreatePackage();
  const update = useUpdatePackage(preset?.id ?? "");

  // Menu tree + denominator from the live NAV registry (pkg-builder pkgNavGroups / pkgAllIds).
  const groups = useMemo(() => pkgNavGroups(NAV_TREE, NAV_SECTIONS), []);
  const allNavIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);
  const total = allNavIds.length;

  const [size, setSize] = useState(preset?.size ?? "S");
  const [name, setName] = useState(preset?.name ?? "");
  const [price, setPrice] = useState(preset?.priceM != null ? String(preset.priceM) : "");
  const [contact, setContact] = useState(preset ? preset.priceM == null : false);
  const [projects, setProjects] = useState(preset ? String(preset.projects) : "2");
  const [users, setUsers] = useState(preset ? String(preset.users) : "5");
  const [storage, setStorage] = useState(preset ? String(preset.storageGb) : "20");
  const [ai, setAi] = useState(preset ? String(preset.aiPerMonth) : "10");
  const [menus, setMenus] = useState<Set<string>>(
    () => new Set(preset?.menus ?? presetMenuIds("S", allNavIds)),
  );
  const [err, setErr] = useState<PackageFormErrors>({});

  // applyPreset (pkg-builder.jsx L87): set size, RE-SEED menus from the preset (even on edit — a
  // fidelity trap, kept), and auto-name only a NEW, still-unnamed plan.
  const applyPreset = (s: string) => {
    setSize(s);
    setMenus(new Set(presetMenuIds(s, allNavIds)));
    if (!isEdit && !name) setName(AUTO_NAME[s] ?? "");
  };
  const toggle = (id: string) =>
    setMenus((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleGroup = (items: readonly PkgNavItem[]) =>
    setMenus((p) => {
      const n = new Set(p);
      const allOn = items.every((i) => n.has(i.id));
      for (const i of items) {
        if (allOn) n.delete(i.id);
        else n.add(i.id);
      }
      return n;
    });

  // save (pkg-builder.jsx L96-113): validate → compose the money=SERVER body → fire the create
  // (POST) or edit (PUT) mutation. onClose() runs BEFORE mutateAsync (the modal unmounts on close
  // before the write settles, W1a pattern), so the toast fires off the SETTLED promise, not a
  // mutate-scoped onSuccess; the B-200(a) error toast fires on rejection.
  const save = () => {
    const form: PackageFormValues = { size, name, price, contact, projects, users, storage, ai, menus: [...menus] };
    const e = validatePackageForm(form);
    setErr(e);
    if (Object.keys(e).length > 0) {
      if (e.m) ctx.notify(t("admin.plans.needMenuToast"), "warn");
      return;
    }
    const body = buildPackageBody(form, isEdit, preset) as Entity;
    const actionLabel = t(isEdit ? "admin.plans.saveBtn" : "admin.plans.createBtn");
    const rawName = name;
    const releasedCount = String(menus.size);
    const totalStr = String(total);
    onClose();
    const settled = isEdit ? update.mutateAsync(body) : create.mutateAsync(body);
    settled
      .then(() =>
        ctx.notify(
          t("admin.plans.savedToast")
            .replace("{action}", actionLabel)
            .replace("{name}", rawName)
            .replace("{count}", releasedCount)
            .replace("{total}", totalStr),
        ),
      )
      .catch(() => ctx.notify(t("admin.common.actionFailedToast"), "danger"));
  };

  return (
    <div>
      {/* size presets (pkg-builder.jsx L118-130) */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {SIZE_PRESETS.map(({ size: s, labelKey }) => {
          const on = size === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => applyPreset(s)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
                border: `1.5px solid ${on ? "var(--brand)" : "var(--border)"}`,
                background: on ? "var(--brand-soft)" : "var(--surface)",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: on ? "var(--brand)" : "var(--text-2)" }}>{s}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{t(labelKey)}</div>
              <div
                className="num"
                style={{ fontSize: 10, color: on ? "var(--brand)" : "var(--text-3)", marginTop: 3, fontWeight: 700 }}
              >
                {presetMenuIds(s, allNavIds).length} {t("admin.plans.menuUnit")}
              </div>
            </button>
          );
        })}
      </div>

      {/* quota grid (pkg-builder.jsx L132-141) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr .8fr .8fr .8fr .8fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Field label={t("admin.plans.fieldName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("admin.plans.namePlaceholder")}
            style={fieldStyle(!!err.n)}
          />
        </Field>
        <Field label={t("admin.plans.fieldPrice")} required={!contact}>
          <input
            value={contact ? "" : price}
            disabled={contact}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={contact ? t("admin.plans.priceContact") : "7900"}
            className="num"
            style={{ ...fieldStyle(!!err.p), opacity: contact ? 0.55 : 1 }}
          />
        </Field>
        <Field label={t("admin.plans.fieldProjects")}>
          <input
            value={projects}
            onChange={(e) => setProjects(e.target.value.replace(/[^\d-]/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("admin.plans.fieldUsers")}>
          <input
            value={users}
            onChange={(e) => setUsers(e.target.value.replace(/[^\d-]/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("admin.plans.fieldStorage")}>
          <input
            value={storage}
            onChange={(e) => setStorage(e.target.value.replace(/[^\d-]/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
        <Field label={t("admin.plans.fieldAi")}>
          <input
            value={ai}
            onChange={(e) => setAi(e.target.value.replace(/[^\d-]/g, ""))}
            className="num"
            style={fieldStyle(false)}
          />
        </Field>
      </div>

      {/* contact-price checkbox (pkg-builder.jsx L142-144) */}
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          color: "var(--text-2)",
          marginBottom: 14,
          cursor: "pointer",
        }}
      >
        <input type="checkbox" checked={contact} onChange={() => setContact(!contact)} />
        {t("admin.plans.contactCheckbox")}
      </label>

      {/* menu-tree header (pkg-builder.jsx L147-150) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{t("admin.plans.menuTreeHeading")}</div>
        <div className="num" style={{ fontSize: 12, fontWeight: 700, color: menus.size ? "var(--brand)" : "var(--danger)" }}>
          {menus.size}/{total} {t("admin.plans.menuUnit")}
        </div>
      </div>

      {/* menu tree (pkg-builder.jsx L151-173) */}
      <div
        style={{
          maxHeight: 320,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "4px 14px 12px",
          background: "var(--surface)",
        }}
      >
        {groups.map((g) => {
          const on = g.items.filter((i) => menus.has(i.id)).length;
          const allOn = on === g.items.length;
          const groupLabel = g.labelKey === null ? t("admin.plans.menuGroupGeneral") : tn(g.labelKey);
          return (
            <div key={g.labelKey ?? "__general__"} style={{ marginTop: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && !allOn;
                  }}
                  onChange={() => toggleGroup(g.items)}
                />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: "var(--text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {groupLabel}
                </span>
                <span className="num" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  {on}/{g.items.length}
                </span>
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "4px 12px",
                  paddingLeft: 24,
                  marginTop: 2,
                }}
              >
                {g.items.map((i) => (
                  <label
                    key={i.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: menus.has(i.id) ? "var(--text)" : "var(--text-3)",
                      padding: "3px 0",
                    }}
                  >
                    <input type="checkbox" checked={menus.has(i.id)} onChange={() => toggle(i.id)} />
                    {tn(i.label)}
                    {i.subs > 0 && (
                      <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>
                        ({i.subs})
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* footer (pkg-builder.jsx L175-181) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("admin.plans.menuHiddenNote")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" onClick={onClose}>
            {t("admin.plans.cancelBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="check" onClick={save}>
            {isEdit ? t("admin.plans.saveBtn") : t("admin.plans.createBtn")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/**
 * Open the builder modal (pkg-builder.jsx openPkgBuilder, L62-68). A standalone dispatcher (not a
 * hook) — it resolves the title/subtitle from the current language via a langStore snapshot (the
 * modal title is set once at open, like the prototype's static title); the form body re-renders
 * on language change via its own useI18n().
 */
export function openPkgBuilder(ctx: ShellCtx, preset: PackageRow | null): void {
  const { t } = buildTranslators(langStore.getLang());
  ctx.openModal({
    title: preset ? `${t("admin.plans.builderTitleEdit")} ${preset.name}` : t("admin.plans.builderTitleNew"),
    subtitle: t("admin.plans.builderSubtitle"),
    icon: "grid",
    iconTone: "var(--brand)",
    size: "xl",
    body: ({ close }: { close: () => void }) => <PkgBuilderForm preset={preset} onClose={close} />,
  });
}
