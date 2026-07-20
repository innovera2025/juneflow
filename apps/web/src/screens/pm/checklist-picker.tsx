/*
 * ChecklistPicker — the "pick checklist items from a template" modal body, opened from
 * the WO detail (wo-detail.tsx) via ctx.openModal (size "lg"). Ported from
 * pototype/pm-checklist.jsx openChecklistPicker + ChecklistPicker (L42-110); B-117.
 *
 * Design fidelity (PLAN.md section 0 rule 1): the top-right template-settings launcher,
 * the collapsible template list (chevron toggle · name · "{kind} · {n} items" meta ·
 * "use whole set" action), the per-item checkbox rows, and the footer (picked-count /
 * hint on the left, cancel + "add selected ({n})" on the right) are the prototype's.
 *
 * Data (rules 3/4): the templates are the LIVE server catalogue — GET
 * /pm/checklist-templates (use-pm.ts useChecklistTemplateList) narrowed to
 * ChecklistTemplate. The prototype's local PM_CHECKLIST_TEMPLATES mock is dropped. The
 * picker emits the picked item LABELS to its caller (onInsert), which appends + persists
 * them onto the WO's checklist (PUT /pm/workorders/{id}/checklist; wo-detail.tsx).
 *
 * SCOPE (honest, flagged): the "template settings" button opens a modal-defer stub — a
 * placeholder modal, NOT the full template manager (pototype/pm-checklist.jsx
 * ChecklistManager, whose create/edit/delete needs write endpoints that are out of
 * scope). This mirrors the B-065/066 deferred-write precedent (master-docnum.tsx): the
 * action stays present for fidelity but no manager is built and no template is mutated.
 *
 * i18n (rule 2): every static string is a pm.* / common.* dict key (t). Template
 * name/kind/item labels are REAL server data (rendered verbatim, never re-translated).
 * No Thai literal lives in source; tokens back every colour (rule 6). The middot
 * separator "·" is the shared non-Thai glyph (wo-list.tsx MIDDOT precedent).
 */
import { useState } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useChecklistTemplateList, toChecklistTemplate, type ChecklistTemplate } from "./use-pm";

/** Middot separator (U+00B7, non-Thai) — matches wo-list.tsx's MIDDOT. */
const MIDDOT = "·";

export interface ChecklistPickerProps {
  /** Dismiss the picker modal (the shell's modal close). */
  onClose: () => void;
  /** Emit the picked item labels (>= 1). The caller appends + persists them. */
  onInsert: (labels: string[]) => void;
}

/** The picked-item key ("templateId::itemIndex") — unique across templates. */
function pickKey(templateId: string, idx: number): string {
  return `${templateId}::${idx}`;
}

export function ChecklistPicker({ onClose, onInsert }: ChecklistPickerProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const templatesQ = useChecklistTemplateList();
  const templates: ChecklistTemplate[] = (templatesQ.data ?? []).map(toChecklistTemplate);

  // Which template is expanded (single-open accordion, pm-checklist.jsx openId).
  const [openId, setOpenId] = useState<string | null>(null);
  // Picked individual items keyed by "templateId::idx" (pm-checklist.jsx picked map).
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const toggleItem = (templateId: string, idx: number) =>
    setPicked((prev) => {
      const k = pickKey(templateId, idx);
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = true;
      return next;
    });

  /** Gather the labels of every checked item, in template + item order. */
  const pickedItems = (): string[] => {
    const out: string[] = [];
    for (const tpl of templates) {
      tpl.items.forEach((it, i) => {
        if (picked[pickKey(tpl.id, i)]) out.push(it.label);
      });
    }
    return out;
  };

  const nPicked = Object.keys(picked).length;

  /** "Use whole set" — emit every item label of one template (pm-checklist.jsx useWhole). */
  const useWholeSet = (tpl: ChecklistTemplate) => onInsert(tpl.items.map((it) => it.label));

  /**
   * "Template settings" — modal-defer stub (B-065/066 precedent). Close the picker then
   * open a placeholder modal titled by pm.templateSettingsBtn with an icon-only body.
   * The full manager (create/edit/delete templates) is intentionally NOT built.
   */
  const openTemplateSettings = () => {
    onClose();
    ctx.openModal({
      title: t("pm.templateSettingsBtn"),
      icon: "settings",
      iconTone: "var(--brand)",
      size: "md",
      body: () => (
        // Icon-only placeholder (no invented copy — rule 2), matching the empty-state
        // pattern used elsewhere (wo-list.tsx / pm-dashboard.tsx panel empties).
        <div style={{ padding: "40px 18px", textAlign: "center" }}>
          <Icon name="settings" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
        </div>
      ),
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Btn kind="ghost" size="sm" icon="settings" onClick={openTemplateSettings}>
          {t("pm.templateSettingsBtn")}
        </Btn>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 380,
          overflow: "auto",
        }}
      >
        {templates.length === 0 ? (
          // Honest empty/loading state — icon-only (no fabricated templates).
          <div style={{ padding: "40px 18px", textAlign: "center" }}>
            <Icon name="check" size={26} color="var(--text-3)" style={{ opacity: 0.4 }} />
          </div>
        ) : (
          templates.map((tpl) => {
            const open = openId === tpl.id;
            return (
              <div
                key={tpl.id}
                style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px 13px",
                    background: "var(--surface-2)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : tpl.id)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: "none",
                      background: "var(--surface)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={open ? "chevD" : "chevR"} size={14} color="var(--text-2)" />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {tpl.kind} {MIDDOT}{" "}
                      {t("pm.countUnit").replace("{n}", String(tpl.items.length))}
                    </div>
                  </div>
                  <Btn kind="soft" size="sm" icon="plus" onClick={() => useWholeSet(tpl)}>
                    {t("pm.useWholeSet")}
                  </Btn>
                </div>
                {open && (
                  <div style={{ padding: "6px 13px 10px" }}>
                    {tpl.items.map((it, i) => {
                      const on = !!picked[pickKey(tpl.id, i)];
                      return (
                        <label
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 9,
                            padding: "6px 0",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            onClick={() => toggleItem(tpl.id, i)}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 5,
                              flexShrink: 0,
                              border: `1.5px solid ${on ? "var(--brand)" : "var(--border-strong)"}`,
                              background: on ? "var(--brand)" : "var(--surface)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {on && <Icon name="check" size={12} color="#fff" />}
                          </span>
                          <span style={{ fontSize: 12.5 }}>{it.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {nPicked > 0 ? t("pm.pickedCount").replace("{count}", String(nPicked)) : t("pm.pickHint")}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Btn>
          <Btn
            kind="primary"
            size="md"
            icon="plus"
            disabled={nPicked === 0}
            onClick={() => onInsert(pickedItems())}
          >
            {t("pm.addSelectedBtn").replace("{count}", String(nPicked))}
          </Btn>
        </div>
      </div>
    </div>
  );
}
