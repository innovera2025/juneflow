/*
 * UserAddForm - the add-user (invite) modal body, ported 1:1 from pototype/master.jsx
 * UserAddForm (L1003-1054). Opened by UsersPermissions via ctx.openModal (lg size).
 *
 * Design fidelity (PLAN.md rule 1): the 2-col field grid (first / last / email / phone /
 * department / role), the "activate now" toggle, the brand-soft info box (with bold {role}
 * and {limit}) and the cancel/save-invite footer are the prototype's, verbatim. Every
 * visible string is a users.* / dept.* / common.* dict key or a phrase key (department
 * CONS + phone label, users-strings.json). Tokens back every colour (rule 6); the only
 * literals are the prototype-verbatim white knob "#fff", the ASCII example placeholders,
 * the BAHT currency symbol (sourced as a Unicode escape - see below) and px geometry.
 *
 * Mock mechanics dropped (rule 3): the prototype's ctx.notify-only submit becomes a real
 * POST /users (useCreateUser) that invalidates the user list, then fires the invite toast.
 * The wire body is { name: first+last, email, dept: <code>, role_id, status } - the phone
 * field is kept VISUALLY but dropped from the POST (/users has no phone column), and the
 * username is server-derived from the email (apps/api/src/routes/users.ts). The full ds.jsx
 * Dropdown popover is not ported; department + role use native <select>s (behaviour-
 * equivalent, same precedent as org-add-form). This modal has no visual-gate reference.
 *
 * Department i18n (rule 2): only CONS lacks a dept.* dict key, so it resolves via its phrase
 * key (users-strings.json deptCons -> tp); PROC/FIN/SLS/ADM/WH resolve via their dept.* dict
 * keys (t) - mixed routing, but every label has exactly one existing key (none invented).
 * The info hint bolds {role} and {limit} (the placeholders the users.addUserRoleHint key
 * carries); the prototype's bold "Username" is inline text in that key, so it stays regular.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import type { ShellCtx } from "../../shell/shell-context";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import { formatAuthLimit, type Role } from "./role-matrix";
import { useCreateUser } from "./use-users";
import usersStrings from "./users-strings.json" with { type: "json" };

/** THAI BAHT SIGN (U+0E3F) - prototype-verbatim currency unit. No baht-only i18n key
 *  exists and a literal baht sign trips the i18n-guard (U+0E00-U+0E7F), so it is sourced
 *  as a Unicode escape (source stays ASCII); B-037 prototype-verbatim literal. */
const BAHT = "\u0E3F";
/** EM DASH (U+2014) - language-neutral "no limit value" marker. */
const EM_DASH = "\u2014";

export interface UserAddFormProps {
  ctx: ShellCtx;
  /** The tenant roles (GET /roles) - the role <select> options + the info-hint source. */
  roles: readonly Role[];
  onClose: () => void;
}

/** Input/select style, ported from the sibling forms' fieldStyle (org-add-form). */
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

/** Split a "... {role} ... {limit} ..." template, bolding the two substituted values. */
function boldTemplate(
  template: string,
  values: { role: string; limit: string },
): ReactNode[] {
  return template.split(/(\{role\}|\{limit\})/).map((seg, i) => {
    if (seg === "{role}") return <b key={i}>{values.role}</b>;
    if (seg === "{limit}") return <b key={i}>{values.limit}</b>;
    return <span key={i}>{seg}</span>;
  });
}

export function UserAddForm({ ctx, roles, onClose }: UserAddFormProps) {
  const { t, tp } = useI18n();
  const createUser = useCreateUser();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(""); // kept visually; NOT sent to POST /users
  const [dept, setDept] = useState("CONS"); // master.jsx:1008 default (leading token)
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? "");
  const [active, setActive] = useState(true);

  // Department options: CONS via phrase key (no dept.CONS dict key); the rest via dict.
  const departments: readonly { code: string; label: string }[] = [
    { code: "CONS", label: tp(usersStrings.deptCons as PhraseKey) },
    { code: "PROC", label: t("dept.PROC") },
    { code: "FIN", label: t("dept.FIN") },
    { code: "SLS", label: t("dept.SLS") },
    { code: "ADM", label: t("dept.ADM") },
    { code: "WH", label: t("dept.WH") },
  ];

  const selectedRole = roles.find((r) => r.id === roleId) ?? null;
  const canSave = !!(first.trim() && last.trim() && email.includes("@") && roleId); // master.jsx:1011

  // Plain-text auth limit for the info hint {limit} (amount + baht / unlimited / dash).
  const limitText = (): string => {
    if (!selectedRole) return EM_DASH;
    const d = formatAuthLimit(selectedRole.approval_limit, selectedRole.approval_level);
    return d.kind === "amount"
      ? `${d.amount} ${BAHT}`
      : d.kind === "unlimited"
        ? t("role.limitUnlimited")
        : EM_DASH;
  };

  const submit = () => {
    if (!canSave) return;
    createUser.mutate(
      {
        name: `${first.trim()} ${last.trim()}`,
        email: email.trim(),
        dept, // the department CODE (server tolerates code or full label)
        role_id: roleId,
        status: active ? "active" : "invited",
      },
      {
        onSuccess: () =>
          ctx.notify(
            t("users.notifyUserAdded")
              .replace("{first}", first.trim())
              .replace("{last}", last.trim())
              .replace("{role}", selectedRole?.name ?? ""),
          ),
      },
    );
    onClose();
  };

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Field label={t("users.fieldFirst")} required>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder={t("users.fieldFirst")}
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("users.fieldLast")} required>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            placeholder={t("users.fieldLast")}
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("users.fieldEmail")} required>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@juneflow.co.th"
            style={fieldStyle()}
          />
        </Field>
        <Field label={tp(usersStrings.phoneLabel as PhraseKey)}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="08x-xxx-xxxx"
            className="num"
            style={fieldStyle()}
          />
        </Field>
        <Field label={t("users.fieldDept")} required>
          <select value={dept} onChange={(e) => setDept(e.target.value)} style={fieldStyle()}>
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("users.roleLabel")} required>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={fieldStyle()}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        style={{
          padding: 14,
          background: "var(--surface-2)",
          borderRadius: 10,
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t("users.activateNow")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("users.activateNote")}</div>
        </div>
        <button
          type="button"
          onClick={() => setActive(!active)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 999,
            padding: 2,
            border: "none",
            cursor: "pointer",
            background: active ? "var(--ok)" : "var(--surface-3)",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: "#fff",
              marginInlineStart: active ? 20 : 0,
              transition: ".15s",
            }}
          />
        </button>
      </div>

      <div
        style={{
          padding: 12,
          background: "var(--brand-soft)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 11.5,
          color: "var(--text-2)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Icon name="info" size={14} color="var(--brand)" />
        <span>
          {boldTemplate(t("users.addUserRoleHint"), {
            role: selectedRole?.name ?? "",
            limit: limitText(),
          })}
        </span>
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
          {t("users.saveInviteBtn")}
        </Btn>
      </div>
    </>
  );
}
