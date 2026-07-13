/*
 * ForgotForm — ported 1:1 from pototype/extra-screens.jsx ForgotForm(). Rendered
 * inside the Login screen's modal host (the prototype opens it via ctx.openModal).
 * All copy comes from the login.* keys added in BLOCKERS.md B-035; the dynamic
 * "sent" toast interpolates {email} into login.forgotSent with the
 * login.forgotEmailFallback key when the field is blank (no invented strings).
 */
import { useState } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";

export interface ForgotFormProps {
  /** Pre-fill from the login email input (prototype `initial`). */
  initial?: string;
  /** Close the hosting modal. */
  onClose: () => void;
  /** Fire the success toast (prototype ctx.notify). */
  onNotify: (msg: string) => void;
}

const fieldStyle = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  fontSize: 14,
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
} as const;

export function ForgotForm({ initial, onClose, onNotify }: ForgotFormProps) {
  const { t } = useI18n();
  const [em, setEm] = useState(initial ?? "");

  const send = () => {
    onClose();
    const target = em.trim() || t("login.forgotEmailFallback");
    onNotify(t("login.forgotSent").replace("{email}", target));
  };

  return (
    <div>
      <Field label={t("login.forgotEmail")} required>
        <input
          value={em}
          onChange={(e) => setEm(e.target.value)}
          style={fieldStyle}
        />
      </Field>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 16,
        }}
      >
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="mail" onClick={send}>
          {t("login.forgotSubmit")}
        </Btn>
      </div>
    </div>
  );
}
