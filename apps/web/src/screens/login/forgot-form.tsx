/*
 * ForgotForm — the design is ported 1:1 from pototype/extra-screens.jsx
 * ForgotForm() (rendered inside the Login screen's modal host, which the
 * prototype opens via ctx.openModal). Fields, labels, buttons, layout and
 * tokens are untouched; every string is a login.* / common.* / admin.* key from
 * i18n-full.json (rule 2 — nothing is translated here).
 *
 * MOCK MECHANIC REMOVED (PLAN.md §0 rule 3). The prototype's submit is
 * `ctx.notify(...)` alone: it closes the modal and claims a reset link was sent
 * WITHOUT any request (extra-screens.jsx:218). The port copied that verbatim, so
 * the screen honoured rule 1 by breaking rule 3 — it told a user their link was
 * on the way when nothing had ever been asked of the server. The submit now
 * POSTs /auth/forgot through the generated client (performForgot); the pixels
 * above it are unchanged.
 *
 * The three states below are dictated by what the handler really does
 * (apps/api/src/routes/auth.ts:300-372 — see forgot-submit.ts for the full read):
 *
 *   IN FLIGHT — the primary button is `disabled` (Btn's own 0.5-opacity /
 *     not-allowed treatment, the zone's transition affordance, same as
 *     pm/wo-form.tsx `disabled={busy}`) and a ref guards re-entry, because the
 *     throttle allows only 5 requests per address+IP per minute: a double-click
 *     that burned two of them would be the user's loss.
 *
 *   ACCEPTED (uniform 200) — close + the prototype's login.forgotSent toast. The
 *     server answers the SAME 200 for a known address, an unknown one and a
 *     malformed one, so this branch is taken identically in every case: the UI
 *     has nothing to branch on and must not appear to (auth.ts:296-299).
 *
 *   THROTTLED (429) / FAILED — the modal STAYS OPEN (the typed address survives
 *     so the user can retry) and one danger toast fires. 429 and a transport
 *     failure deliberately show the SAME message: i18n-full.json has no
 *     rate-limit copy (B-300), the nearest existing key is used rather than a
 *     new string, and one shared message is also the safer answer — nothing the
 *     user sees can vary with whether an address exists.
 *
 * Blank address: the submit is disabled while the field is empty rather than
 * sending and then claiming a link went to "your email". That retires
 * login.forgotEmailFallback, which existed only to fill the mock's toast on an
 * empty field — the one path where the old copy was false on its face.
 */
import { useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { ToastTone } from "../../shell/shell-context";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { performForgot, type ForgotResponse } from "./forgot-submit";

export interface ForgotFormProps {
  /** Pre-fill from the login email input (prototype `initial`). */
  initial?: string;
  /** Close the hosting modal. */
  onClose: () => void;
  /** Fire a toast (prototype ctx.notify(msg, tone), shell.jsx:82). */
  onNotify: (msg: string, tone?: ToastTone) => void;
  /** Bound generated client call: apiClient.POST("/auth/forgot", { body }). */
  forgot: (body: { email: string }) => Promise<ForgotResponse>;
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

export function ForgotForm({ initial, onClose, onNotify, forgot }: ForgotFormProps) {
  const { t } = useI18n();
  const [em, setEm] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  // Re-entry guard in a ref, not the `busy` state: two clicks in one tick both
  // read the pre-update state, and each request costs one of the 5 per-minute
  // slots the address gets. `busy` drives the disabled pixels only.
  const inFlight = useRef(false);

  const target = em.trim();

  const send = async () => {
    if (inFlight.current || !target) return;
    inFlight.current = true;
    setBusy(true);

    const outcome = await performForgot({ email: target, forgot });

    inFlight.current = false;
    setBusy(false);

    if (outcome.status === "accepted") {
      onClose();
      onNotify(t("login.forgotSent").replace("{email}", outcome.email));
      return;
    }
    if (outcome.status === "invalid") return;
    // "throttled" and "failed" share one message on purpose (see the header).
    onNotify(t("admin.common.actionFailedToast"), "danger");
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
        <Btn
          kind="primary"
          size="md"
          icon="mail"
          onClick={send}
          disabled={busy || !target}
        >
          {t("login.forgotSubmit")}
        </Btn>
      </div>
    </div>
  );
}
