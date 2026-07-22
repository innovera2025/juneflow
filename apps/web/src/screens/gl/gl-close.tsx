/*
 * GLPeriodClose — the GL Period Close screen, ported from pototype/gl.jsx GLPeriodClose (L741-842).
 * Route gl.close (docs/extract/NAV-ROUTES.md L67, section "acct"). Mirrors the just-merged same-
 * module gl-inbox.tsx pattern (t() dict keys, generated client + unwrap, honest em-dash, tokens).
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module, Period
 * Close screen), the title/subtitle, the danger "close period" header action, the two-column layout
 * (checklist card 1fr + a 380px rail of history + note cards), the numbered checklist with the
 * progress bar, the close-history list, and the warning note card are the prototype's.
 *
 * This screen is an HONEST SHELL — one action is REAL, the rest is presentational-where-no-wire:
 *
 *   CLOSE ACTION (real): the danger button -> a reason-required confirm modal -> POST
 *     /gl/close-period { period }. The period is DERIVED from GET /gl/periods (the earliest still-
 *     open, CE-valid period), NEVER the prototype's mock Buddhist-Era month (gl.jsx L759). A 409
 *     (already locked) and a 403 (no finance approve) are surfaced honestly (error toast). On
 *     success the periods query invalidates, so the just-closed period drops out of the open target
 *     and into the history. NOTE: the modal's reason is a UI-only danger-confirmation gate — the
 *     server's body is { period } ONLY, so the reason is NOT persisted (drop-not-collect; flagged).
 *     The prototype's success toast (gl.jsx L768) has NO Wave-A key, so it is OMITTED (no minting)
 *     — the list refresh IS the honest success feedback.
 *
 *   CLOSE HISTORY (real): the LOCKED periods from GET /gl/periods (newest first). The wire has no
 *     locked_by / locked_at, so the actor em-dashes and the date shows created_at (the only wire
 *     date). Honest-empty when nothing is locked.
 *
 *   CHECKLIST (presentational, except step5's real count): the 10 steps are STATIC labels
 *     (gl.close.step1..step10). There is NO per-step completion wire, so every step renders as
 *     PENDING — the prototype's per-step done flags + notes are fabricated mock data and are dropped
 *     (rule 3, never fabricate). The per-step action (gl.close.actionBtn) is presentational (a
 *     toast). The progress bar reflects the (0) done-count, NOT a real signal. The CLOSE BUTTON is
 *     gated on real close-ability (an open CE period exists), NOT on the mock all-checklist-done —
 *     an honest gate.
 *     STEP5 REAL COUNT: the "check Posting-Inbox pending items" step (gl.close.step5) carries a note
 *     showing the REAL pending count from useBadgeCount("gl.inbox") — the SAME live GET /counts
 *     value that drives the sidebar gl.inbox badge. It renders honestly: the real number when
 *     loaded, em-dash when absent/zero (useBadgeCount folds 0 -> undefined, matching the sidebar's
 *     no-pill state). The prototype's baht half ("832K baht") has NO wire, so it em-dashes (never a
 *     fabricated figure). The prototype's remaining-{n}-items phrasing has no matching dict key
 *     (consume-only i18n; the sole "{n} items" key is boq.* domain with the wrong wording) — so the
 *     bare count renders until a sacred round adds gl.close.step5Note (reported for Wave-C).
 *
 * MISSING-KEY BLOCKER (STOP+report): gl.close.step3 (the FA-depreciation step) is ABSENT from the
 * Wave-A i18n batch, so the checklist renders 9 of the prototype's 10 steps until a sacred i18n
 * round adds it. See gl-close-rows.ts STEP_KEYS for the full note + the one-line completion.
 *
 * i18n (rule 2): every string resolves via t() from the DICT layer — the gl.close.* keys (Wave-A)
 * plus reused existing keys (fin.breadcrumbFinance, common.cancel). Tokens back every colour
 * (rule 6). ZERO Thai/baht in this .tsx (B-073) — every glyph lives only in i18n-full.json.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toPeriodRow,
  deriveOpenPeriod,
  lockedHistory,
  formatPeriodDate,
  computeProgress,
  splitBold,
  STEP_KEYS,
  type PeriodRow,
} from "./gl-close-rows";
import { useGlPeriods, useCloseGlPeriod } from "./use-gl-close";
import { useBadgeCount } from "../../shell/use-shell-data";

const DASH = "—";

/** Extract an error message off an unknown mutation error (gl-inbox/wo-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** Reason textarea style (jv-create-form headInput geometry, textarea variant). */
const reasonStyle: CSSProperties = {
  width: "100%",
  minHeight: 80,
  padding: "10px 12px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
  resize: "vertical",
};

/**
 * ClosePeriodConfirm — the reason-required danger confirmation body (gl.jsx ctx.confirm L762-769).
 * The shell's shared ConfirmDialog carries no reason input, so this is a custom modal body (like
 * PostingInboxFilter) that renders its own warning + reason field + action buttons. The reason is a
 * UI-only gate (the POST body is { period } only), so it is NOT sent — flagged in the screen header.
 */
function ClosePeriodConfirm({ period, onClose }: { period: string; onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const closePeriod = useCloseGlPeriod();
  const [reason, setReason] = useState("");

  const canConfirm = reason.trim() !== "" && !closePeriod.isPending;

  const submit = () => {
    if (!canConfirm) return; // defensive: the confirm button is disabled in this state.
    closePeriod.mutate(
      { period },
      {
        // Success feedback is the periods refresh (the closed period moves into history). The
        // prototype's success toast (gl.jsx L768) has no Wave-A key -> omitted (no minting).
        onSuccess: () => onClose(),
        // 409 already-locked / 403 no-permission / 400 bad period -> surface the server message
        // honestly, keep the modal open so the user sees it failed. Never a fabricated close.
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Warning — reuses gl.close.noteBody (the irreversibility warning); the prototype's exact
          confirm message has no Wave-A key. splitBold renders its <b> run without innerHTML. */}
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        {splitBold(t("gl.close.noteBody")).map((seg, i) =>
          seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>,
        )}
      </div>
      <textarea
        value={reason}
        placeholder={t("gl.close.reasonPlaceholder")}
        onChange={(e) => setReason(e.target.value)}
        style={reasonStyle}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="danger" size="md" icon="flag" disabled={!canConfirm} onClick={submit}>
          {t("gl.close.confirmLabel")}
        </Btn>
      </div>
    </div>
  );
}

/**
 * A single checklist row (gl.jsx L785-804). Presentational — done is always false (no wire). The
 * optional `note` sub-line carries a real sub-value for the one wired step (step5's Posting-Inbox
 * count); every other row passes it undefined and stays label-only.
 */
function ChecklistRow({ label, done, actionLabel, onAction, note }: {
  label: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        background: done ? "var(--ok-soft)" : "var(--surface-2)",
        border: `1px solid ${done ? "var(--ok)" : "var(--border)"}`,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: done ? "var(--ok)" : "var(--surface)",
          border: done ? "none" : "2px solid var(--border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {done && <Icon name="check" size={12} color="#fff" />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: done ? "var(--ok)" : "var(--text)" }}>
          {label}
        </div>
        {note != null && (
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>{note}</div>
        )}
      </div>
      {!done && (
        <Btn kind="ghost" size="sm" icon="arrowR" onClick={onAction}>
          {actionLabel}
        </Btn>
      )}
    </div>
  );
}

export function GLPeriodClose() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const periodsQ = useGlPeriods();

  // step5 ("check Posting-Inbox pending items") carries the REAL pending count — the SAME live
  // /counts value that drives the sidebar gl.inbox badge (useBadgeCount folds 0/absent -> undefined,
  // so a not-loaded or zero count em-dashes exactly like the sidebar's no-pill state).
  const inboxCount = useBadgeCount("gl.inbox");
  // Honest step5 note: real count when loaded (else em-dash) · baht em-dash (the prototype's
  // "832K baht" value half has NO wire, so it is never fabricated). No dict key matches the
  // prototype's remaining-{n}-items phrasing (consume-only i18n) -> bare count until gl.close.step5Note.
  const step5Note = `${inboxCount ?? DASH} · ${DASH}`;

  const rows = useMemo<PeriodRow[]>(() => (periodsQ.data ?? []).map(toPeriodRow), [periodsQ.data]);
  const openPeriod = useMemo(() => deriveOpenPeriod(rows), [rows]);
  const history = useMemo(() => lockedHistory(rows), [rows]);

  // Done-states are presentational (no per-step wire): every step renders as pending -> completed 0.
  const progress = computeProgress(0, STEP_KEYS.length);

  // The close button gates on real close-ability (an open CE period exists), NOT the mock checklist.
  const canClose = openPeriod != null;

  const openConfirm = () => {
    if (!openPeriod) return; // defensive: the button is disabled without an open period.
    ctx.openModal({
      // The prototype's confirm title (gl.jsx L763) has no Wave-A key -> compose the screen name +
      // the derived CE period (honest; the same "{crumbScreen} . {period}" shape as the page title).
      title: `${t("gl.close.crumbScreen")} · ${openPeriod}`,
      icon: "flag",
      iconTone: "var(--danger)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <ClosePeriodConfirm period={openPeriod} onClose={close} />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", t("gl.close.crumbScreen")]}
      title={`${t("gl.close.crumbScreen")} · ${openPeriod ?? DASH}`}
      subtitle={t("gl.close.subtitle")}
      actions={
        <Btn kind="danger" size="md" icon="flag" disabled={!canClose} onClick={openConfirm}>
          {t("gl.close.confirmLabel")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>
        {/* Checklist (presentational — all steps pending, no per-step wire). */}
        <Card pad={20}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t("gl.close.checklistTitle")}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                {t("gl.close.progress")
                  .replace("{completed}", String(progress.completed))
                  .replace("{total}", String(progress.total))}
              </div>
            </div>
            <div style={{ width: 130, height: 8, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${progress.pct}%`,
                  height: "100%",
                  background: progress.pct === 100 ? "var(--ok)" : "var(--accent)",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STEP_KEYS.map((key) => (
              <ChecklistRow
                key={key}
                label={t(key)}
                done={false}
                actionLabel={t("gl.close.actionBtn")}
                onAction={() => ctx.notify(t("gl.close.actionToast"))}
                // Only step5 (Posting-Inbox pending items) gets the real count note; the rest stay
                // label-only (presentational, no per-step wire).
                note={key === "gl.close.step5" ? step5Note : undefined}
              />
            ))}
          </div>
        </Card>

        {/* Right rail: close history + the warning note. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card pad={18}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{t("gl.close.historyTitle")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.length === 0 ? (
                <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11.5 }}>{DASH}</div>
              ) : (
                history.map((p) => {
                  const date = formatPeriodDate(p.createdAt);
                  return (
                    <div
                      key={p.id || p.period}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 10px",
                        background: "var(--surface-2)",
                        borderRadius: 6,
                        fontSize: 11.5,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.period}</span>
                      {/* actor: no locked_by wire -> em-dash. date: created_at (only wire date). */}
                      <span style={{ color: "var(--text-3)" }}>
                        {DASH} · {date || DASH}
                      </span>
                      <Icon name="check" size={12} color="var(--ok)" />
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card pad={18} style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Icon name="warn" size={16} color="var(--warn)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warn)" }}>{t("gl.close.noteTitle")}</div>
                <div style={{ fontSize: 11.5, color: "var(--text)", marginTop: 4, lineHeight: 1.5 }}>
                  {splitBold(t("gl.close.noteBody")).map((seg, i) =>
                    seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>,
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
