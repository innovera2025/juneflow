/*
 * ScreenLogin — ported 1:1 from pototype/extra-screens.jsx ScreenLogin() (P1-WEB-01).
 *
 * Standalone screen rendered full-bleed BEFORE the app shell (shell.jsx renders it
 * for route "login" with its own modal + toast hosts, lines 104-119). This port
 * reproduces that harness locally: the two-panel layout, the ForgotForm modal
 * (ctx.openModal) and the transient success toast (ctx.notify) all live here since
 * the global shell host (chrome.jsx/shell.jsx) is P0-WEB-05.
 *
 * Design fidelity (PLAN.md §0 rule 1): every user-visible string is a login.* /
 * common.* i18n key from i18n-full.json (B-035/B-036 rulings — the login screen is
 * Thai in all languages, verbatim from the prototype), colors/radius come from
 * @juneflow/tokens, and the fixed geometry is literal exactly as the prototype
 * defines it so the screenshot matches reference gallery/g4/01.
 *
 * Mock mechanics dropped (rule 3): the prototype's ctx.setTweak("authed", true) is
 * replaced by the real bearer-JWT flow — performLogin() POSTs /auth/login through
 * the generated client and persists the token (setAuthToken), then we navigate.
 * The auth-failure branch stays silent: the prototype mock always succeeds, so
 * i18n-full.json carries no "wrong credentials" copy — inventing one is forbidden.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Icon } from "../../ui/icon";
import { Modal } from "../../ui/modal";
import { apiClient } from "../../api-client";
import { setAuthToken } from "../../auth-token";
import { performLogin } from "./login-submit";
import { ForgotForm } from "./forgot-form";

/** Toast auto-dismiss delay — shell.jsx notify() (2400ms). */
const TOAST_MS = 2400;

/** Input field style, ported from ScreenLogin.fld(bad) — red border on error. */
function fieldStyle(bad: boolean): CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    fontSize: 14,
    border: `1px solid ${bad ? "var(--danger)" : "var(--border-strong)"}`,
    borderRadius: 10,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
  };
}

export function LoginScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("somchai@rungrueang.co.th");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // ctx.notify equivalent (shell.jsx) — success/reset toasts are the "ok" tone.
  const notify = (msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  // ScreenLogin.login() — validate, then the real bearer-JWT flow (rule 3).
  const login = async () => {
    const outcome = await performLogin({
      email,
      password: pw,
      login: (body) => apiClient.POST("/auth/login", { body }),
      setToken: setAuthToken,
    });
    if (outcome.status === "invalid") {
      setErr(t("login.errRequired"));
      return;
    }
    if (outcome.status === "ok") {
      notify(t("login.success"));
      navigate({ to: "/dashboard" });
    }
    // status === "error": no auth-failure copy exists in i18n-full.json — stay silent.
  };

  // The "sign up free" link opens the signup wizard (subscription-flow.jsx
  // SignupWizard), a separate not-yet-ported screen. The prototype guards the call
  // (`window.openSignup && …`) and no-ops when it is absent — mirrored here.
  const openSignup = () => {};

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1, display: "flex", background: "var(--bg)" }}>
      {/* brand panel */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(140deg,var(--brand),var(--brand-2))",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 64px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "rgba(255,255,255,.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="building" size={26} color="#fff" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            Juneflow · {t("app.name")}
          </div>
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.3, maxWidth: 460 }}>
          {t("login.heroLine1")}
          <br />
          {t("login.heroLine2")}
        </div>
        <div style={{ fontSize: 14, opacity: 0.8, marginTop: 16, maxWidth: 420, lineHeight: 1.7 }}>
          {t("login.heroDesc")}
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 36, fontSize: 12.5, opacity: 0.75 }}>
          {(
            [
              ["82", t("login.statScreens")],
              ["4", t("login.statProjectTypes")],
              ["4", t("common.lang")],
            ] as const
          ).map(([n, l]) => (
            <div key={l}>
              <b className="num" style={{ fontSize: 22, display: "block" }}>
                {n}
              </b>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* form panel */}
      <div
        style={{
          width: 460,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 56px",
          background: "var(--surface)",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800 }}>{t("login.title")}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, marginBottom: 26 }}>
          {t("login.subtitle")}
        </div>
        {err && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              background: "var(--danger-soft)",
              borderRadius: 9,
              marginBottom: 14,
              fontSize: 12,
              color: "var(--danger)",
              fontWeight: 600,
            }}
          >
            <Icon name="warn" size={15} />
            {err}
          </div>
        )}
        <Field label={t("login.email")} required>
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErr("");
            }}
            style={fieldStyle(Boolean(err))}
          />
        </Field>
        <div style={{ height: 14 }} />
        <Field label={t("login.password")} required>
          <input
            type="password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setErr("");
            }}
            placeholder="••••••••"
            style={fieldStyle(Boolean(err))}
          />
        </Field>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 20px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" defaultChecked /> {t("login.remember")}
          </label>
          <a
            onClick={() => setForgotOpen(true)}
            style={{ fontSize: 12.5, color: "var(--brand)", fontWeight: 600, cursor: "pointer" }}
          >
            {t("login.forgot")}
          </a>
        </div>
        <Btn kind="primary" size="lg" icon="arrowR" style={{ width: "100%", justifyContent: "center" }} onClick={login}>
          {t("login.title")}
        </Btn>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-3)", marginTop: 18 }}>
          {t("login.noAccount")}{" "}
          <a onClick={openSignup} style={{ color: "var(--brand)", fontWeight: 600, cursor: "pointer" }}>
            {t("login.signupFree")}
          </a>
        </div>
      </div>

      {/* modal host — ctx.openModal({ ForgotForm }) */}
      {forgotOpen && (
        <Modal
          title={t("login.forgotTitle")}
          subtitle={t("login.forgotSubtitle")}
          icon="key"
          iconTone="var(--brand)"
          size="sm"
          onClose={() => setForgotOpen(false)}
        >
          <ForgotForm initial={email} onClose={() => setForgotOpen(false)} onNotify={notify} />
        </Modal>
      )}

      {/* toast host — shell.jsx notify() (ok tone) */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 18px",
            background: "var(--ok)",
            color: "#fff",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 6000,
          }}
        >
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
