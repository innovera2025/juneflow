/*
 * MasterProject — the Project / Phase / Block / Unit structure screen, ported 1:1
 * from pototype/master.jsx MasterProject (L311-420). Route master.project
 * (NAV-ROUTES.md L100), visual-gate reference tests/visual/reference/gallery/g2/32.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * hierarchy title/subtitle with the project-type badge, the three actions
 * (import-unit / create-project / add-phase-block), the card header (project + phase
 * scope pills + the units/sold/built summary), the phase·block section header, the
 * block cards (colour-striped, model label, count line, unit-view + edit actions) with
 * the 14-column unit grid, and the four-swatch legend — is the prototype's, verbatim.
 *
 * Mock mechanics dropped (rule 3): the prototype's BLOCK_SEED local state + the
 * hardcoded activeProject()/ptype.hierarchy globals become real server data —
 *   GET /projects (+ resolveActiveProject) = the active project + its phases,
 *   GET /project-types                     = the project-type WBS hierarchy labels (H),
 *   GET /projects/{id}/hierarchy           = the phase/block/unit tree (real counts),
 *   GET /models                            = the block model_id -> label/colour join,
 *   POST /projects/{id}/nodes              = add a block (server makes N empty units).
 * The unit-cell threshold algorithm (soldBuilt/sold/built/empty by index) is kept
 * verbatim so the grid renders exactly like the reference from the three real counts.
 *
 * Every string is a project./block./common. dict key, a project-strings.json phrase
 * (tp: addPrefix/unit/built), or opaque row/type-label data (rule 2); tokens back every
 * colour (rule 6). B-057 = residual keys pending (structureLabel / builtDoneLabel /
 * addPhaseBlockSubtitle / toastAddBlock / notifyImportUnit / block.infoLine).
 */
import { useMemo, useState } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { TypeBadge } from "../../shell/type-badge";
import { projectTypeIcon } from "../../shell/project-types";
import {
  toBlocks,
  modelsById,
  blockTotals,
  unitStatus,
  builtPct,
  unitCode,
  typeHierarchy,
  phaseHead,
  hierarchyLabels,
  type Block,
  type ModelLite,
  type UnitStatus,
} from "./project-blocks";
import {
  useProjectHierarchy,
  useModels,
  useProjectTypes,
  useCreateProjectNode,
} from "./use-project-hierarchy";
import { BlockAddForm, type BlockBody } from "./block-add-form";
import projStrings from "./project-strings.json" with { type: "json" };

/** Unit-cell fill colour by status (master.jsx:386-389). #fff is prototype-verbatim (B-037). */
function cellColor(status: UnitStatus): string {
  return status === "soldBuilt"
    ? "var(--ok)"
    : status === "sold"
      ? "var(--info)"
      : status === "built"
        ? "var(--accent)"
        : "var(--surface-3)";
}

/** ScopePill — the filter-style project/phase pill (ds.jsx Dropdown mode="filter",
 *  357-419). The full Dropdown popover primitive is not ported (same choice as
 *  org-add-form.tsx's native <select>); this reproduces the closed pill (hint + value
 *  + chevron, the only state in g2/32) with a lightweight option menu that fires the
 *  prototype's default onChange notify (label: value). Options are real data. */
function ScopePill({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: readonly string[];
}) {
  const ctx = useShellCtx();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 10px",
          background: "var(--surface)",
          border: `1px solid ${open ? "var(--brand)" : "var(--border)"}`,
          borderRadius: 7,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          color: "var(--text)",
        }}
      >
        <div style={{ lineHeight: 1.1, flex: 1, textAlign: "start", minWidth: 0 }}>
          <div style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
        </div>
        <Icon name="chevD" size={12} color="var(--text-3)" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
          <div
            style={{
              position: "absolute",
              top: 42,
              insetInlineStart: 0,
              zIndex: 30,
              minWidth: 200,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 4,
              boxShadow: "0 8px 24px rgba(15,23,42,0.16)",
            }}
          >
            {options.map((o) => (
              <div
                key={o}
                onClick={() => {
                  setOpen(false);
                  ctx.notify(`${label}: ${o}`);
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: o === value ? 700 : 500,
                  color: o === value ? "var(--brand)" : "var(--text)",
                }}
              >
                {o}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MasterProject() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const typesQ = useProjectTypes();
  const modelsQ = useModels();

  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const hierarchyQ = useProjectHierarchy(active?.id);
  const createNode = useCreateProjectNode(active?.id);

  const models = useMemo<Map<string, ModelLite>>(
    () => modelsById(modelsQ.data ?? []),
    [modelsQ.data],
  );
  const blocks = useMemo<Block[]>(
    () => toBlocks(hierarchyQ.data ?? [], models),
    [hierarchyQ.data, models],
  );
  const totals = blockTotals(blocks);

  const H = typeHierarchy(typesQ.data ?? [], active?.type);
  // Render once the active project + its WBS labels have resolved. The prototype pads
  // any missing slot (master.jsx:316-319 `H[i] || default`), so a project type with
  // fewer than four levels still renders — only an unresolved type (H empty) shows the
  // loading skeleton. Gating on a hardcoded depth of 4 blanked every <4-level type (B-087).
  const ready = !!active && H.length > 0;

  const addPrefix = tp(projStrings.addPrefix as PhraseKey);
  const unitWord = tp(projStrings.unit as PhraseKey);
  const builtWord = tp(projStrings.built as PhraseKey);

  // add phase/block (master.jsx:321-332): fire the create mutation + the add toast.
  const openAdd = (H4: string[]) => {
    const [, Lphase, Lblock, Lunit] = hierarchyLabels(H4, unitWord);
    const phaseName = phaseHead(active?.phases?.[0]?.name);
    ctx.openModal({
      title: `${addPrefix} ${Lphase} / ${Lblock}`,
      subtitle: t("project.addPhaseBlockSubtitle")
        .replace("{block}", Lblock)
        .replace("{phase}", Lphase)
        .replace("{unit}", Lunit),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <BlockAddForm
          existingCodes={blocks.map((b) => b.code)}
          models={[...models.values()]}
          phaseName={phaseName}
          onClose={close}
          onSubmit={(body: BlockBody, name: string) => {
            // Compose the opaque POST /projects/{id}/nodes body (Entity on the wire).
            const wire: Record<string, unknown> = {
              name: body.name,
              code: body.code,
              units: body.units,
            };
            if (body.model_id) wire.model_id = body.model_id;
            createNode.mutate(wire, {
              onSuccess: () =>
                ctx.notify(
                  t("project.toastAddBlock")
                    .replace("{name}", name)
                    .replace("{units}", String(body.units))
                    .replace("{unit}", Lunit),
                ),
            });
            close();
          }}
        />
      ),
    });
  };

  if (!ready) {
    // Loading state (top-level): project/type labels not resolved yet — token blocks.
    return (
      <Page breadcrumbs={[t("master.breadcrumb")]}>
        <Card pad={0}>
          <div style={{ padding: 20 }}>
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                style={{
                  height: 88,
                  marginBottom: 8,
                  borderRadius: 10,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        </Card>
      </Page>
    );
  }

  const [Lproject, Lphase, Lblock, Lunit] = hierarchyLabels(H, unitWord);
  const phaseValue = phaseHead(active?.phases?.[0]?.name);

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), H.join(" / ")]}
      title={H.join(" · ")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type={active.type} size="sm" />
          <span>
            {t("project.structureLabel")} {H.join(" → ")}
          </span>
        </span>
      }
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            kind="outline"
            size="md"
            icon="upload"
            onClick={() => ctx.notify(t("project.notifyImportUnit").replace("{unit}", Lunit))}
          >
            {`${t("common.import")}${Lunit}`}
          </Btn>
          {/* CreateProjectForm (master.jsx L1242-1344) — STILL DEFERRED, but NOT for the
              reason this comment used to give. "the backend create-project route is
              unimplemented" was FALSE as of 2026-08-10: apps/api projects.ts:200 mounts
              POST /projects, quota-gated 402 at :212, and it materializes the wizard's
              phase + unit nodes. ProjectInput (generated types.ts:3815) matches the wizard
              payload exactly, and the 12 createProj.* dict keys are minted (0 consumed),
              including createProj.quotaLabel for that 402.

              The REAL blocker is i18n (B-346): 11 of the wizard's visible strings have NO
              key in docs/extract/i18n-full.json — neither dict nor phrases — so the form
              cannot be rendered without minting, and minting is a Wei-approved sacred round.
              Verified missing, each grepped against all 3701 dict keys and 1108 phrases,
              cited by prototype line rather than quoted (comments stay English, CLAUDE.md):
                master.jsx L1288 step counter · L1270 the step-2 and step-3 step labels
                (2 strings) · L1305 step-2 field label · L1306 step-2 placeholder ·
                L1312 step-2 skip hint · L1315 step-3 field label · L1321 + L1322 the two
                summary bullet prefixes · L1304 the hierarchy prefix in the step-1 type
                preview · L1279 the created toast.
              (Present and reusable: createProj.* x12, common.cancel, common.back,
              project.createBtn, and pm.fieldProjectType for the L1296 type field label.)

              The button is a RENDER-ONLY STUB with no onClick — it is in g2/32 so it renders
              enabled, the same deliberate convention as master-project-type.tsx addBtn and
              master-model.tsx edit. It is worth naming plainly: an enabled control that does
              nothing on click is its own small lie, and whether this family should become
              honest-disabled is a cross-screen ruling (B-347), not a side effect of one port. */}
          <Btn kind="outline" size="md" icon="grid">
            {t("project.createBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => openAdd(H)}>
            {`${addPrefix} ${Lphase}/${Lblock}`}
          </Btn>
        </div>
      }
    >
      <Card pad={0} style={{ marginBottom: 16 }}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <ScopePill
            label={Lproject}
            value={active.name}
            options={(projectsQ.data ?? []).map((p) => p.name)}
          />
          <ScopePill
            label={Lphase}
            value={phaseValue}
            options={(active.phases ?? []).map((ph) => phaseHead(ph.name))}
          />
          <span style={{ flex: 1 }} />
          <span className="num" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {`${totals.units} ${Lunit} · ${t("project.legendSold")} ${totals.sold} · ${t(
              "project.builtDoneLabel",
            )} ${totals.built}`}
          </span>
        </div>

        <div style={{ padding: 18 }}>
          {/* Phase / Block section header */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-2)",
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name={projectTypeIcon(active.type)} size={14} />
            {`${Lphase} · ${Lblock}`}
          </div>

          {hierarchyQ.isLoading
            ? [0, 1, 2].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 120,
                    marginBottom: 8,
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))
            : blocks.map((b) => (
                <div
                  key={b.id}
                  style={{
                    padding: 14,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    marginBottom: 8,
                    borderLeft: `3px solid ${b.color || "var(--border-strong)"}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                        {b.name}
                        {b.model && (
                          <span style={{ color: "var(--text-3)", fontWeight: 500 }}>{` · ${b.model}`}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {`${b.units} ${unitWord} · ${t("project.legendSold")} ${b.sold} · ${builtWord} ${b.built} ${unitWord} (${builtPct(b)}%)`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn
                        kind="ghost"
                        size="sm"
                        icon="grid"
                        onClick={() => ctx.notify(t("project.notifyUnitGrid"))}
                      >
                        {t("project.unitViewBtn")}
                      </Btn>
                      {/* Edit action — no-op in the prototype (icon-only ghost button). */}
                      <Btn kind="ghost" size="sm" icon="edit" label={t("common.edit")} />
                    </div>
                  </div>

                  {/* Unit grid — 14 columns, cell colour by the threshold status. */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 4 }}>
                    {Array.from({ length: b.units }).map((_, j) => {
                      const status = unitStatus(j, b.sold, b.built);
                      return (
                        <div
                          key={j}
                          title={unitCode(b.code, j)}
                          style={{
                            aspectRatio: "1 / 1.1",
                            borderRadius: 4,
                            background: cellColor(status),
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: status === "empty" ? "var(--text-3)" : "#fff",
                            fontSize: 9,
                            fontWeight: 700,
                          }}
                        >
                          {j + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

          {/* Legend (master.jsx:403-415) */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, fontSize: 11 }}>
            {(
              [
                [t("project.legendSoldBuilt"), "var(--ok)"],
                [t("project.legendSold"), "var(--info)"],
                [t("project.legendBuilt"), "var(--accent)"],
                [t("project.legendEmpty"), "var(--surface-3)"],
              ] as const
            ).map(([lbl, c]) => (
              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, background: c, borderRadius: 2 }} />
                <span style={{ color: "var(--text-2)" }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Page>
  );
}
