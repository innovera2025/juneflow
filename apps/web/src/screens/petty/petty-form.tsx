/*
 * PettyClaimForm — the "new petty-cash claim" modal body, ported from
 * pototype/petty-alloc.jsx PettyClaimForm (L376-474). Opened by PettyCash via
 * ctx.openModal (the "new claim" header action).
 *
 * Design fidelity (Juneflow §0): the 3-button type selector, the category/amount/
 * date field grid, the project picker, the description textarea, the over-cap
 * warning, the GL auto-posting preview box, and the footer actions (cancel · attach ·
 * submit) keep the prototype's shape.
 *
 * Data: this is a REAL POST /petty (use-petty.ts). The category picker mirrors the
 * prototype's fixed option list; the project picker is the REAL projects catalogue
 * (GET /projects -> project_id) so a typed name can never fail the server's tenant-
 * ownership check.
 *
 * money=SERVER (§0 + money-post lessons): the web sends only { category, amount,
 * description, txn_date?, project_id? }. The server owns the running number, forces
 * THB, enforces the <= 10,000 cap (a client warning is a courtesy, not the gate), and
 * posts the balanced JV later through the GL inbox. The web does ZERO money math.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - the claimant field is DROPPED: the server sets by_user_id to the
 *     authenticated caller (petty.ts), so there is nothing to collect (jv-create-form
 *     precedent — drop rather than fabricate a server-owned value).
 *   - the CLEAR + ADVANCE type buttons are honest-DISABLED: POST /petty is claim-only
 *     (B-233 claim-MVP), so no clear/advance create path exists. Claim stays selected;
 *     the prototype's clear-only "clear PR" field never renders (unreachable).
 *   - the topup path (PettyTopupForm) has NO endpoint -> not implemented here (the
 *     page's topup action is honest-disabled).
 *   - the GL auto-posting preview box is PROTOTYPE-ILLUSTRATIVE: POST /petty returns
 *     no GL preview and the JV posts later via the inbox, so the two double-entry rows
 *     keep the prototype's static account labels but their AMOUNTS em-dash (billing-
 *     form precedent). The real posting is Dr 5100 / Cr 1010, server-side.
 *   - attach-file has no endpoint -> the prototype's attach toast (client intent).
 *
 * i18n: every string is a petty-strings.json phrase (tp) or common.cancel (t). NO
 * Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon, type IconName } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useCreatePettyClaim } from "./use-petty";
import {
  emptyPettyClaimDraft,
  pettyClaimSubmittable,
  isOverCap,
  buildPettyClaimBody,
  type PettyClaimDraft,
} from "./petty-rows";
import pettyStrings from "./petty-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof pettyStrings): PhraseKey => pettyStrings[k] as PhraseKey;

/** ASCII category codes (petty-alloc.jsx L420-422); the "other" option is appended from tp. */
const CATEGORY_CODES = ["Welfare", "Transport", "Vehicle", "Office", "Site"] as const;

/** Header field input style (jv-create-form headInput). */
const headInput: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/** Read the display name off an opaque /projects row (id + name). */
function projName(p: Record<string, unknown>): string {
  const n = p.name ?? p.id;
  return typeof n === "string" ? n : String(n ?? "");
}

/** One type-selector chip (petty-alloc.jsx L399-414). Claim is the only enabled one. */
function TypeChip({
  label,
  icon,
  tone,
  active,
  disabled,
}: {
  label: string;
  icon: IconName;
  tone: string;
  active: boolean;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 8px",
        borderRadius: 8,
        fontFamily: "inherit",
        background: active ? `color-mix(in srgb, ${tone} 12%, var(--surface))` : "var(--surface)",
        border: `1.5px solid ${active ? tone : "var(--border)"}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "center",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "default",
      }}
    >
      <Icon name={icon} size={16} color={active ? tone : "var(--text-3)"} />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: active ? 700 : 500,
          color: active ? tone : "var(--text-2)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function PettyClaimForm({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const projectsQ = useProjects();
  const createClaim = useCreatePettyClaim();

  const [draft, setDraft] = useState<PettyClaimDraft>(emptyPettyClaimDraft());

  const projects = useMemo(
    () => (projectsQ.data ?? []) as Record<string, unknown>[],
    [projectsQ.data],
  );
  const overCap = isOverCap(draft);
  const canSave = pettyClaimSubmittable(draft);

  const upd = (k: keyof PettyClaimDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    if (!canSave) return;
    createClaim.mutate(buildPettyClaimBody(draft), {
      onSuccess: () => onClose(), // list invalidates -> the new claim appears (honest).
      onError: (err) => {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || DASH, "danger");
      },
    });
  };

  return (
    <>
      {/* Type selector — claim is the only wired kind (POST /petty is claim-only). */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {tp(P("typeRowLabel"))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <TypeChip
            label={tp(P("typeClaimBtn"))}
            icon="cart"
            tone="var(--brand)"
            active
            disabled={false}
          />
          <TypeChip
            label={tp(P("typeClearBtn"))}
            icon="check"
            tone="var(--info)"
            active={false}
            disabled
          />
          <TypeChip
            label={tp(P("typeAdvanceBtn"))}
            icon="ledger"
            tone="var(--warn)"
            active={false}
            disabled
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={tp(P("fCat"))} required>
          <select value={draft.category} onChange={(e) => upd("category", e.target.value)} style={headInput}>
            {CATEGORY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={tp(P("catOther"))}>{tp(P("catOther"))}</option>
          </select>
        </Field>
        <Field label={tp(P("fAmount"))} required>
          <input
            type="number"
            value={draft.amount}
            onChange={(e) => upd("amount", e.target.value)}
            className="num"
            style={headInput}
          />
        </Field>
        <Field label={tp(P("fDate"))} required>
          {/* Optional txn_date on the wire; a plain input (billing-form dueDate pattern). */}
          <input value={draft.txnDate} onChange={(e) => upd("txnDate", e.target.value)} style={headInput} />
        </Field>
        <Field label={tp(P("fProject"))} style={{ gridColumn: "1 / 4" }}>
          {/* Optional project_id — the real projects catalogue (GET /projects). */}
          <select value={draft.projectId} onChange={(e) => upd("projectId", e.target.value)} style={headInput}>
            <option value="">{tp(P("selectPlaceholder"))}</option>
            {projects.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {projName(p)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={tp(P("fDesc"))} required style={{ marginBottom: 14 }}>
        <textarea
          value={draft.description}
          onChange={(e) => upd("description", e.target.value)}
          placeholder={tp(P("descPlaceholder"))}
          style={{
            width: "100%",
            padding: 10,
            minHeight: 60,
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12.5,
            fontFamily: "inherit",
            resize: "vertical",
            outline: "none",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
      </Field>

      {overCap && (
        <div
          style={{
            padding: 12,
            background: "var(--warn-soft)",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 11.5,
            color: "var(--warn)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Icon name="warn" size={14} />
          {tp(P("overLimit"))}
        </div>
      )}

      {/* GL auto-posting preview — PROTOTYPE-ILLUSTRATIVE (see header): static account
          labels + em-dash amounts (no GL-preview wire; the JV posts server-side). */}
      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            marginBottom: 6,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {tp(P("glBoxTitle"))}
        </div>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>Dr</td>
              <td>
                {tp(P("glAcct1Prefix"))} {draft.category}
              </td>
              <td className="num" style={{ textAlign: "right", color: "var(--text-3)" }}>
                {DASH}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-2)" }}>Cr</td>
              <td>{tp(P("glAcct2"))}</td>
              <td className="num" style={{ textAlign: "right", color: "var(--text-3)" }}>
                {DASH}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="ghost" size="md" icon="paperclip" onClick={() => ctx.notify(tp(P("attachToast")))}>
          {tp(P("attachBtn"))}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={submit}
          disabled={!canSave || createClaim.isPending}
        >
          {tp(P("submitBtn"))}
        </Btn>
      </div>
    </>
  );
}
