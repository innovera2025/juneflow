/*
 * AcceptForm — the acceptance-decision modal body opened by SubconAccept via
 * ctx.openModal (size "lg"). Ported from pototype/subcon-accept2.jsx AcceptForm
 * (L153-240) + the openAccept opener (L22-33).
 *
 * Design fidelity (PLAN.md §0 rule 1): the basis-conditional measure banner, the
 * 5-item acceptance checklist (none -> pass -> fail cycle), the 3 photo widgets, the
 * attach-docs section, the fail warning, the payment-breakdown footer, and the
 * reject / "pass -> issue acceptance" action row are the prototype's. The accept
 * button stays disabled until every checklist item is checked and none failed (the
 * prototype gate, KEPT). Every string is a subcon.* / common.* dict key (t); tokens
 * back every colour. No Thai (and no baht glyph) sits in this source.
 *
 * ACCEPT = 2 chained server ops, client sends the trigger only (B-107a):
 *   POST /periods/{id}/inspect {result:"pass"} THEN POST /periods/{id}/approve-payment
 *   (EMPTY body). The toast (subcon.acceptToast) is filled from the approve-payment
 *   RESPONSE net/retention (the server is the money authority), NOT client-computed.
 * REJECT = POST /periods/{id}/inspect {result:"reject", defects:[{item: failed label}]}.
 * %-GATE (B-107c) — the prototype's hard-block "cannotAccept" modal is DROPPED: accept
 *   is never blocked; the server `warning` flag drives a non-blocking advisory banner
 *   raised on the SubconAccept screen (onWarning). This form never fabricates a
 *   progress %.
 *
 * WIRE GAPS / DIVERGENCES (reported honestly — see the SubconAccept view header):
 *   - the basis measure banner is PRESENTATIONAL — the measured qty is NOT sent
 *     (B-107a: the server computes the money from the stored period columns).
 *   - the photo widgets + the attach-docs section are PRESENTATIONAL — inspect does
 *     not accept photos/docs, so nothing is uploaded.
 *   - the payment-breakdown footer is a CLIENT PREVIEW (period.amount + retention_pct);
 *     the authoritative gross/retention/net are the approve-payment response.
 */
import { useState } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { useShellCtx } from "../../shell/shell-context";
import { useAcceptPeriod } from "./use-subcon";
import { formatMoney } from "./subcon-accept-rows";

const DASH = "—";

/** The 5 acceptance-checklist items (subcon-accept.jsx ACCEPT_CHECKLIST L57-63). */
const CHECKLIST: readonly DictKey[] = [
  "subcon.checkItemQty",
  "subcon.checkItemMaterial",
  "subcon.checkItemWorkmanship",
  "subcon.checkItemSafety",
  "subcon.checkItemDocs",
];

/** The 3 photo widgets (subcon-accept.jsx L204). The prototype's GPS glyph "pin" is
 *  not in the shared ds.jsx set (renders blank), so the off state carries no icon. */
const PHOTOS: readonly { labelKey: DictKey; offIcon: IconName | null }[] = [
  { labelKey: "subcon.photoBefore", offIcon: "doc" },
  { labelKey: "subcon.photoAfter", offIcon: "doc" },
  { labelKey: "subcon.photoGps", offIcon: null },
];

/** One checklist item's tri-state (subcon-accept.jsx cycle none -> pass -> fail). */
type Check = "none" | "pass" | "fail";

function nextCheck(v: Check): Check {
  return v === "none" ? "pass" : v === "pass" ? "fail" : "none";
}

/** Read a finite number off the opaque approve-payment Entity response; 0 fallback. */
function readNum(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** True when the response carries a %-gate advisory (accepted ahead of progress). */
function hasWarning(o: Record<string, unknown>): boolean {
  return o.warning != null && o.warning !== false;
}

export interface AcceptFormProps {
  onClose: () => void;
  /** Owning contract id (the accept/reject anchor + periods invalidation key). */
  contractId: string;
  /** The period being inspected. */
  periodId: string;
  periodSeq: number;
  /** Period basis (percent|distance|milestone|unit) — drives the measure banner. */
  periodBasis: string;
  /** Period money in FULL units (the client payment PREVIEW). */
  periodAmount: number;
  /** Contract retention hold-back rate (%) — the client payment PREVIEW. */
  retentionPct: number;
  /** Raise/clear the screen's non-blocking %-gate advisory from the server warning. */
  onWarning: (warned: boolean) => void;
}

export function AcceptForm({
  onClose,
  contractId,
  periodId,
  periodSeq,
  periodBasis,
  periodAmount,
  retentionPct,
  onWarning,
}: AcceptFormProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const decide = useAcceptPeriod();

  const [checks, setChecks] = useState<Check[]>(() => CHECKLIST.map(() => "none"));
  const [photos, setPhotos] = useState<boolean[]>([false, false, false]);

  const passN = checks.filter((c) => c === "pass").length;
  const failN = checks.filter((c) => c === "fail").length;
  const allChecked = checks.every((c) => c !== "none");
  const isMeasured = periodBasis === "distance" || periodBasis === "unit";

  // Client PREVIEW only (subcon-accept2.jsx L162-163). The authoritative money is the
  // approve-payment response (B-107a) — this drives the footer, never the persisted value.
  const retentionPreview = Math.round(periodAmount * (Number.isFinite(retentionPct) ? retentionPct : 0) / 100);
  const netPreview = periodAmount - retentionPreview;

  const cycle = (i: number) => setChecks((prev) => prev.map((v, idx) => (idx === i ? nextCheck(v) : v)));
  const togglePhoto = (i: number) => setPhotos((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  // ACCEPT = inspect(pass) -> approve-payment; the toast reads the response money.
  const doAccept = async () => {
    try {
      const resp = await decide.accept(periodId, contractId);
      onWarning(hasWarning(resp));
      onClose();
      ctx.notify(
        t("subcon.acceptToast")
          .replace("{no}", String(periodSeq))
          .replace("{value}", formatMoney(readNum(resp, "net")))
          .replace("{retention}", formatMoney(readNum(resp, "retention"))),
      );
    } catch {
      // The mutation error is held in TanStack Query state; keep the modal open so
      // the inspector can retry (no fabricated error copy — there is no i18n key).
    }
  };

  // REJECT = inspect(reject) with the failed-checklist labels as defect items.
  const doReject = async () => {
    const failLabels = CHECKLIST.filter((_, i) => checks[i] === "fail").map((k) => t(k));
    const items = failLabels.length ? failLabels : [t("subcon.defectDefault")];
    try {
      await decide.reject({ periodId, contractId, defects: items.map((item) => ({ item })) });
      onClose();
      ctx.notify(t("subcon.rejectToast").replace("{no}", String(periodSeq)), "warn");
    } catch {
      // Held in query state; keep the modal open for a retry.
    }
  };

  return (
    <div>
      {/* basis measure banner (PRESENTATIONAL — the measured qty is NOT sent, B-107a) */}
      {isMeasured && (
        <div
          style={{
            padding: 12,
            background: "var(--ok-soft)",
            borderRadius: 9,
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Icon name="ruler" size={18} color="var(--ok)" />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("subcon.measureOnSite")}</span>
          {/* the on-site measured qty is not captured/sent + the unit label is a wire
              gap (B-107a) -> em-dash; the money value (right) is the real period amount. */}
          <span className="num" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-3)" }}>{DASH}</span>
          <span style={{ marginInlineStart: "auto", fontSize: 12.5 }}>
            {t("subcon.equalsValue").replace("{value}", formatMoney(periodAmount))}
          </span>
        </div>
      )}

      {/* checklist (subcon-accept2.jsx L187-200) */}
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
        {t("subcon.checklistTitle").replace("{n}", String(passN)).replace("{count}", String(CHECKLIST.length))}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
        {CHECKLIST.map((labelKey, i) => {
          const v = checks[i] ?? "none";
          const meta = checkMeta(v, t);
          return (
            <div
              key={labelKey}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderTop: i ? "1px solid var(--border)" : "none",
              }}
            >
              <span className="num" style={{ fontSize: 11, color: "var(--text-3)", width: 16 }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{t(labelKey)}</span>
              <button
                type="button"
                onClick={() => cycle(i)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 11px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 700,
                  background: meta.bg,
                  color: meta.color,
                }}
              >
                <Icon name={meta.icon} size={12} />
                {meta.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* photos (PRESENTATIONAL — inspect does not accept photos) */}
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
        {t("subcon.photosTitle").replace("{n}", String(photos.filter(Boolean).length))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {PHOTOS.map((ph, i) => {
          const on = photos[i] ?? false;
          const icon: IconName | null = on ? "check" : ph.offIcon;
          return (
            <button
              key={ph.labelKey}
              type="button"
              onClick={() => togglePhoto(i)}
              style={{
                flex: 1,
                height: 76,
                borderRadius: 9,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                border: on ? "1.5px solid var(--ok)" : "1.5px dashed var(--border-strong)",
                background: on ? "var(--ok-soft)" : "var(--surface-2)",
                color: on ? "var(--ok)" : "var(--text-3)",
              }}
            >
              {icon && <Icon name={icon} size={17} />}
              <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500 }}>{t(ph.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {/* attach docs (PRESENTATIONAL — nothing is uploaded) */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>
          {t("subcon.attachDocsTitle").replace("{n}", "0")}
        </span>
        <span
          style={{
            marginInlineStart: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            borderRadius: 7,
            padding: "5px 11px",
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--brand)",
          }}
        >
          <Icon name="upload" size={13} />
          {t("subcon.attachDocBtn")}
        </span>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            padding: "12px 14px",
            border: "1.5px dashed var(--border-strong)",
            borderRadius: 9,
            fontSize: 11.5,
            color: "var(--text-3)",
            textAlign: "center",
          }}
        >
          {t("subcon.noDocsEmpty")}
        </div>
      </div>

      {/* fail warning (subcon-accept2.jsx L230) */}
      {failN > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            background: "var(--danger-soft)",
            borderRadius: 9,
            marginBottom: 14,
            fontSize: 11.5,
            color: "var(--danger)",
          }}
        >
          <Icon name="warn" size={14} />
          {t("subcon.failWarning").replace("{n}", String(failN))}
        </div>
      )}

      {/* payment breakdown (CLIENT PREVIEW) + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>
          {t("subcon.paymentBreakdown")
            .replace("{value}", formatMoney(periodAmount))
            .replace("{pct}", String(retentionPct))
            .replace("{retention}", formatMoney(retentionPreview))
            .replace("{net}", formatMoney(netPreview))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="danger" size="md" icon="x" disabled={decide.isPending} onClick={doReject}>
            {t("subcon.rejectBtn")}
          </Btn>
          {/* accept: icon "checkCircle" is blank in the shared ds.jsx set, so omitted */}
          <Btn kind="ok" size="md" disabled={!allChecked || failN > 0 || decide.isPending} onClick={doAccept}>
            {t("subcon.acceptSubmitBtn")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** Checklist-item chip style/label per tri-state (subcon-accept2.jsx L191). */
function checkMeta(
  v: Check,
  t: (key: DictKey) => string,
): { color: string; bg: string; label: string; icon: IconName } {
  if (v === "pass") return { color: "var(--ok)", bg: "var(--ok-soft)", label: t("subcon.checkPass"), icon: "check" };
  if (v === "fail") return { color: "var(--danger)", bg: "var(--danger-soft)", label: t("subcon.checkFail"), icon: "x" };
  return { color: "var(--text-3)", bg: "var(--surface-2)", label: t("subcon.checkNone"), icon: "clock" };
}
