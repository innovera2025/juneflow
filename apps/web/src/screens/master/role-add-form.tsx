/*
 * RoleAddForm - the add-role modal body, ported 1:1 from pototype/master.jsx
 * RoleAddForm (L1056-1116). Opened by UsersPermissions via ctx.openModal (xl size).
 *
 * Design fidelity (PLAN.md rule 1): the 2fr/1fr/1fr field grid (name / approval limit /
 * approval level), the INTERACTIVE 11x5 permission matrix (a scrollable table of toggle
 * buttons - this is the ONLY editable matrix; the main screen's is read-only), and the
 * cancel/save footer are the prototype's, verbatim. Every visible string is a role.* /
 * perm.* / users.* / common.* dict key or a phrase key (perm columns 2-5); the 11 module
 * labels are English ASCII literals (role-matrix.ts). Tokens back every colour (rule 6);
 * the only literals are the prototype-verbatim white check "#fff" and px geometry.
 *
 * Mock mechanics dropped (rule 3): the prototype's ctx.notify-only submit becomes a real
 * POST /roles (useCreateRole) - body { name, approval_limit, currency_code: "THB",
 * approval_level, perms } - that invalidates the role list, then fires the add toast.
 * The prototype's Input `suffix="baht"` chrome is not ported (no such ui primitive; the
 * role.fieldLimit label already carries the "(baht)" unit) - same native-control precedent
 * as org-add-form's parent <select>. This modal has no visual-gate reference.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import type { ShellCtx } from "../../shell/shell-context";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import {
  MODULE_LABELS,
  buildPermMatrix,
  serializePermMatrix,
  togglePerm,
  approvalLevelLabel,
  formatMoney,
} from "./role-matrix";
import { useCreateRole } from "./use-users";
import usersStrings from "./users-strings.json" with { type: "json" };

export interface RoleAddFormProps {
  ctx: ShellCtx;
  onClose: () => void;
}

/** Input style, ported from the sibling forms' fieldStyle (org-add-form / model-add-form). */
function fieldStyle(): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
  };
}

/** Table header cell style - ported verbatim from ds.jsx th() (214-219). */
function th(width?: number): CSSProperties {
  return {
    textAlign: "start",
    padding: "8px 10px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(width ? { width } : {}),
  };
}

export function RoleAddForm({ ctx, onClose }: RoleAddFormProps) {
  const { t, tp } = useI18n();
  const createRole = useCreateRole();

  const [name, setName] = useState("");
  const [limit, setLimit] = useState("200000"); // master.jsx:1060 default
  const [level, setLevel] = useState(1); // master.jsx:1061 default
  const [perms, setPerms] = useState<number[][]>(() => buildPermMatrix([]));

  const permCols = [
    t("perm.view"),
    tp(usersStrings.permCreate as PhraseKey),
    tp(usersStrings.permEdit as PhraseKey),
    tp(usersStrings.permApprove as PhraseKey),
    tp(usersStrings.permCancel as PhraseKey),
  ];

  const canSave = name.trim().length > 0; // master.jsx:1064

  const submit = () => {
    if (!canSave) return;
    const parsed = Number.parseInt(limit.replace(/[, ]/g, ""), 10);
    const limitNum = Number.isFinite(parsed) ? parsed : null;
    createRole.mutate(
      {
        name: name.trim(),
        approval_limit: limitNum,
        currency_code: "THB",
        approval_level: level,
        perms: serializePermMatrix(perms),
      },
      {
        onSuccess: () =>
          ctx.notify(
            t("role.notifyAdded")
              .replace("{name}", name.trim())
              .replace("{limit}", formatMoney(limitNum ?? 0)),
          ),
      },
    );
    onClose();
  };

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Field label={t("role.fieldName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("role.phName")}
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("role.fieldLimit")}>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
            className="num"
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("role.fieldLevel")}>
          <select
            value={String(level)}
            onChange={(e) => setLevel(Number.parseInt(e.target.value, 10))}
            style={fieldStyle()}
          >
            {[0, 1, 2, 3, 4].map((l) => (
              <option key={l} value={l}>
                {t(approvalLevelLabel(l) as DictKey)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
        {t("role.permHeader")}{" "}
        <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
          {`· ${t("role.permHint")}`}
        </span>
      </div>

      <div
        style={{
          maxHeight: 320,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
          marginBottom: 14,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)" }}>
            <tr style={{ color: "var(--text-3)" }}>
              <th style={th()}>{t("users.moduleCol")}</th>
              {permCols.map((p, i) => (
                <th key={i} style={{ ...th(70), textAlign: "center" }}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_LABELS.map((label, i) => (
              <tr key={label} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 10px", fontWeight: 500 }}>{label}</td>
                {perms[i].map((v, j) => (
                  <td key={j} style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => setPerms((cur) => togglePerm(cur, i, j))}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: v ? "var(--ok)" : "var(--surface-3)",
                        border: v ? "none" : "1px solid var(--border-strong)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {v ? <Icon name="check" size={12} color="#fff" /> : null}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          disabled={!canSave}
          onClick={submit}
        >
          {t("role.saveBtn")}
        </Btn>
      </div>
    </div>
  );
}
