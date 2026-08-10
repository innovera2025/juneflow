/*
 * PMWorkOrderDetail — the Maxtech-style WO detail (route pm.wo with ctx.params.wo),
 * ported from pototype/pm3.jsx PMWorkOrderDetail (L111-259) + PhotoChip (L260-268) +
 * NoteField (L269-278). Hosted by wo-list.tsx (PMWorkOrders returns this when
 * params.wo is set). The left column is check-in + checklist + maintenance log; the
 * right column is the WO info + time summary + close action.
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-crumb breadcrumb, the title (WO no +
 * StatusBadge) / subtitle, the two header actions (back / close), the "1fr 320px"
 * split, the check-in card (map thumbnail + site/zone/GPS + check-in), the checklist
 * card (pick + per-line result pill + before/after photo chips + empty state), the
 * maintenance-log notes, the WO-info + time-summary panels, and the close+signature
 * modal are the prototype's.
 *
 * Data (rules 3/4): the WO row is resolved from the same three reads as the list
 * (useWorkOrderList + usePmAssetList + usePmContractList) via the pure wo-rows.ts
 * (join + status). The three actions run the real endpoints (use-pm.ts):
 *   - check-in : POST /pm/workorders/{id}/checkin {gps}
 *   - checklist: PUT  /pm/workorders/{id}/checklist {items}  (autosave, DEFAULT 3)
 *   - close    : POST /pm/workorders/{id}/close {cause,fix,advice[,signature]}
 *
 * HONEST DEFAULTS / GAPS (never fabricated — flagged for Wei / B-106):
 *   - DEFAULT 1 status: derived from real columns (wo-rows deriveStatus).
 *   - DEFAULT 2 check-in GPS: captured LIVE via navigator.geolocation; on denial /
 *     unavailability the WO is NOT checked in and an honest danger toast shows the
 *     browser's own error (message || em-dash) — coordinates are NEVER fabricated.
 *   - DEFAULT 3 checklist: no Save button — each result tap autosaves via PUT (the
 *     full item list is sent positionally so the server preserves the labels).
 *   - DEFAULT 4 WO number: the id is a uuid (no wo_no column) -> em-dash everywhere.
 *   - DEFAULT 5: type / service-zone / check-in time / time-summary (start/end/total)
 *     have NO wire -> em-dash; the photo chips are presentational (no upload endpoint).
 *     cause/fix/advice ARE real, persisted on close.
 *   - CLOSE SIGNATURE (B-331): the pad is REAL. It captures strokes and close sends
 *     them as the stroke JSON Wei ruled for `customer_sign` (BLOCKERS.md B-331), so a
 *     signed close now genuinely flips the WO to "done" — "done" is derived from that
 *     column (wo-rows.ts deriveStatus L206). The previous FLAG here recorded the
 *     opposite ("the decorative pad captures no signature, so close sends only
 *     cause/fix/advice"); it is removed because it is now false, not because the
 *     concern lapsed. What REPLACES it is narrower and still enforced: a signature is
 *     never FABRICATED. An empty pad — or one carrying only stray clicks — sends no
 *     `signature` key at all (postCloseWorkorder), because the handler stores
 *     `str(...).trim() || null` and any non-empty value is read as the customer's
 *     consent by every surface without being inspected.
 *   - CHECKLIST PICKER (B-117): the "pick checklist" button opens the FUNCTIONAL
 *     template picker (checklist-picker.tsx) over the live GET /pm/checklist-templates.
 *     Picked item labels are appended to the local checklist AND persisted via PUT
 *     /pm/workorders/{id}/checklist (new rows carry a label so the server snapshots
 *     them). The picker's "template settings" is a modal-defer stub (no manager built).
 *
 * i18n (rule 2): every visible string is a pm.* / common.* dict key (t). No Thai
 * literal in source; tokens back every colour (rule 6). "GPS" is a prototype-verbatim
 * ASCII abbreviation (no dict key, like wo-list's "Retention" / pm-dashboard's "%").
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toWoRaw,
  toWoAssetRef,
  toWoContractRef,
  buildAssetMap,
  buildContractMap,
  resolveWoRow,
  statusToneKind,
  cycleResult,
  doneCount,
  allChecked,
  todayISO,
  type WoRow,
  type WoStatus,
  type ChecklistItem,
} from "./wo-rows";
import {
  useWorkOrderList,
  usePmAssetList,
  usePmContractList,
  useCheckinWorkorder,
  useUpdateChecklist,
  useCloseWorkorder,
  closeToastText,
  createSignatureCapture,
  clearSignatureCapture,
  readSignatureCapture,
  signatureCaptureHasInk,
  signaturePadCancel,
  signaturePadDown,
  signaturePadMove,
  signaturePadUp,
  type SignatureCapture,
} from "./use-pm";
import { ChecklistPicker } from "./checklist-picker";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** Prototype-verbatim ASCII abbreviation (no dict key — like "Retention" / "%"). */
const GPS_LABEL = "GPS";

/** ds.jsx STATUS tone tokens for a derived WO status (mirrors wo-list statusTone). */
function statusTone(status: WoStatus): { bg: string; fg: string; dot: string } {
  switch (statusToneKind(status)) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** StatusBadge (ds.jsx L91-108). */
function StatusBadge({ status, label }: { status: WoStatus; label: string }) {
  const s = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** Photo chip (pm3.jsx PhotoChip L260-268) — PRESENTATIONAL: no upload endpoint, so
 *  `filled` is always false (before/after are string refs with no capture UI). */
function PhotoChip({ label, video }: { label: string; video?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        fontSize: 10.5,
        color: "var(--text-3)",
      }}
    >
      <Icon name={video ? "eye" : "doc"} size={12} color="var(--text-3)" />
      {t("pm.photoPrefix")}
      {label} +
    </div>
  );
}

/** NoteField (pm3.jsx NoteField L269-278) — a labelled textarea. */
function NoteField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 5 }}>
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          width: "100%",
          minHeight: 56,
          padding: 10,
          fontSize: 12.5,
          border: "1px solid var(--border)",
          borderRadius: 9,
          background: disabled ? "var(--surface-2)" : "var(--surface)",
          outline: "none",
          fontFamily: "inherit",
          resize: "vertical",
          lineHeight: 1.5,
          color: "var(--text)",
        }}
      />
    </div>
  );
}

/** Result-pill dict key (the four RESULT_OPTS labels). */
type ResultKey = "pm.resultNone" | "pm.resultNormal" | "pm.resultAdjust" | "pm.resultRepair";

/** The result pill's soft tokens per stored result (pm3.jsx RESULT_OPTS colours). */
function resultTone(result: ChecklistItem["result"]): { bg: string; c: string; key: ResultKey } {
  switch (result) {
    case "normal":
      return { bg: "var(--ok-soft)", c: "var(--ok)", key: "pm.resultNormal" };
    case "adjust":
      return { bg: "var(--info-soft)", c: "var(--info)", key: "pm.resultAdjust" };
    case "repair":
      return { bg: "var(--danger-soft)", c: "var(--danger)", key: "pm.resultRepair" };
    default:
      return { bg: "var(--surface-3)", c: "var(--text-3)", key: "pm.resultNone" };
  }
}

/** Info-panel row (label left / value right). */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        padding: "7px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{label}</span>
      <span className={mono ? "num" : ""} style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

export function PMWorkOrderDetail({ woId }: { woId: string }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const wosQ = useWorkOrderList();
  const assetsQ = usePmAssetList();
  const contractsQ = usePmContractList();

  const today = todayISO();
  const wo = useMemo<WoRow | null>(() => {
    const rawWo = (wosQ.data ?? []).map(toWoRaw).find((r) => r.id === woId);
    if (!rawWo) return null;
    const assetMap = buildAssetMap((assetsQ.data ?? []).map(toWoAssetRef));
    const contractMap = buildContractMap((contractsQ.data ?? []).map(toWoContractRef));
    return resolveWoRow(rawWo, assetMap, contractMap, today);
  }, [wosQ.data, assetsQ.data, contractsQ.data, woId, today]);

  if (wosQ.isLoading) {
    return (
      <Page
        breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbWo"), DASH]}
        title={DASH}
        subtitle={t("pm.woSubtitle")}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
          {[0, 1].map((n) => (
            <div
              key={n}
              style={{ height: 220, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      </Page>
    );
  }

  if (!wo) {
    return (
      <Page
        breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbWo"), DASH]}
        title={DASH}
        subtitle={t("pm.woSubtitle")}
        actions={
          <Btn kind="outline" size="md" icon="chevL" onClick={() => ctx.navigate("pm.wo")}>
            {t("pm.backToList")}
          </Btn>
        }
      >
        <Card>
          <div style={{ padding: "40px 18px", textAlign: "center" }}>
            <Icon name="wrench" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
          </div>
        </Card>
      </Page>
    );
  }

  return <WoDetailBody key={wo.id} wo={wo} />;
}

/** The detail body — mounted only once a WO is resolved, so its local state (checklist
 *  edits + notes) seeds from real wire data (keyed by wo.id so switching WOs remounts). */
function WoDetailBody({ wo }: { wo: WoRow }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const checkin = useCheckinWorkorder();
  const updateChecklist = useUpdateChecklist();
  const closeWo = useCloseWorkorder();

  const [checks, setChecks] = useState<ChecklistItem[]>(wo.items);
  const [cause, setCause] = useState(wo.cause);
  const [fix, setFix] = useState(wo.fix);
  const [advice, setAdvice] = useState(wo.advice);

  // checkedIn + closed derive from the REAL wire (refresh after mutations).
  const checkedIn = wo.checkinGps !== "";
  const closed = wo.status === "done";
  const dCount = doneCount(checks);
  const total = checks.length;
  const everyDone = allChecked(checks);

  const label = (status: WoStatus): string => {
    switch (status) {
      case "open":
        return t("pm.tabOpen");
      case "inprogress":
        return t("pm.tabInprogress");
      case "overdue":
        return t("pm.tabOverdue");
      case "done":
        return t("pm.tabDone");
    }
  };

  // DEFAULT 3: each result tap autosaves the FULL positional item list (PUT). The
  // server preserves the captured labels positionally, so only the result is sent.
  const setResult = (i: number) => {
    const next = checks.map((c, idx) => (idx === i ? { ...c, result: cycleResult(c.result) } : c));
    setChecks(next);
    updateChecklist.mutate({ id: wo.id, items: next.map((c) => ({ result: c.result })) });
  };

  /**
   * B-117: append the picked template item labels onto the checklist and persist. The
   * new rows seed with an unfilled result (""), matching the prototype (pm3.jsx appends
   * `{ label, result: "none" }`). The FULL positional item list is PUT with a `label`
   * per row so the server snapshots the newly-appended rows (mergeChecklistRow uses the
   * sent label; existing rows keep their captured label either way). Optimistic like
   * setResult: the local list updates + the modal closes immediately, then the mutation
   * reports success/failure (an error toast + the WO refetch correct an unpersisted add).
   */
  const addPickedItems = (labels: string[], close: () => void) => {
    if (labels.length === 0) return;
    const added: ChecklistItem[] = labels.map((label) => ({ label, result: "" }));
    const next = [...checks, ...added];
    setChecks(next);
    close();
    updateChecklist.mutate(
      { id: wo.id, items: next.map((c) => ({ result: c.result, label: c.label })) },
      {
        onSuccess: () =>
          ctx.notify(t("pm.toastChecklistAdded").replace("{count}", String(labels.length))),
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      },
    );
  };

  /** Open the checklist-template picker (pm3.jsx openChecklistPicker; B-117). */
  const openChecklistPicker = () => {
    ctx.openModal({
      title: t("pm.pickChecklistBtn"),
      subtitle: t("pm.pickChecklistSubtitle"),
      icon: "check",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <ChecklistPicker onClose={close} onInsert={(labels) => addPickedItems(labels, close)} />
      ),
    });
  };

  // DEFAULT 2: capture a REAL GPS fix; never fabricate a coordinate.
  const doCheckin = () => {
    const geo = typeof navigator !== "undefined" ? (navigator.geolocation as Geolocation | undefined) : undefined;
    if (!geo) {
      ctx.notify(DASH, "danger");
      return;
    }
    geo.getCurrentPosition(
      (pos) => {
        const gps = `${pos.coords.latitude},${pos.coords.longitude}`;
        checkin.mutate(
          { id: wo.id, gps },
          {
            onSuccess: () => ctx.notify(t("pm.toastCheckedIn").replace("{time}", DASH)),
            onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
          },
        );
      },
      (err) => ctx.notify(err.message || DASH, "danger"),
    );
  };

  const closeWO = () => {
    ctx.openModal({
      title: t("pm.closeModalTitle"),
      // subtitle = "{no} · {assetName}" (no is an em-dash, DEFAULT 4).
      subtitle: `${DASH} · ${wo.assetName || DASH}`,
      icon: "check",
      iconTone: "var(--ok)",
      size: "md",
      // A COMPONENT, not inline JSX: the pad holds state, and modal-host calls this
      // render prop as a plain function on every host render (modal-host.tsx L57), so
      // hooks written inline here would belong to the host.
      body: ({ close }: { close: () => void }) => (
        <CloseWoModalBody
          everyDone={everyDone}
          done={dCount}
          total={total}
          onCancel={close}
          onConfirm={(signature) => {
            closeWo.mutate(
              { id: wo.id, cause, fix, advice, signature },
              {
                onSuccess: () => {
                  close();
                  // The report-send half of pm.toastClosed is DROPPED rather than
                  // rendered: lineNotifyStub is a verified no-op (B-108b) and no
                  // certificate exists, so this toast was telling the technician a
                  // report had gone to the customer while mobile's own sidecar test
                  // names this very key as the live example of a forbidden claim.
                  // See closeToastText (B-357/F5) — zero-mint, nothing re-translated.
                  ctx.notify(closeToastText(t("pm.toastClosed"), DASH));
                },
                onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
              },
            );
          }}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbWo"), DASH]}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {/* no: uuid, never rendered raw (DEFAULT 4) — em-dash. */}
          <span className="num">{DASH}</span>
          <StatusBadge status={wo.status} label={label(wo.status)} />
        </span>
      }
      subtitle={t("pm.detailSubtitle")
        .replace("{type}", DASH)
        .replace("{assetName}", wo.assetName || DASH)
        .replace("{contract}", DASH)}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="chevL" onClick={() => ctx.navigate("pm.wo")}>
            {t("pm.backToList")}
          </Btn>
          {!closed && (
            <Btn kind="primary" size="md" icon="check" onClick={closeWO} disabled={!checkedIn}>
              {t("pm.closeWoBtn")}
            </Btn>
          )}
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        {/* Left: check-in + checklist + notes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Check-in (pm3.jsx L161-182). */}
          <Card pad={0}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                fontSize: 13.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {/* the prototype's "pin" icon is not in the ds.jsx set -> blank (compass reads
                  as the closest map glyph); the header keeps the check-in label. */}
              <Icon name="compass" size={16} color="var(--brand)" />
              {t("pm.checkinTitle")}
            </div>
            <div style={{ padding: 16, display: "flex", gap: 16, alignItems: "center" }}>
              {/* Decorative map thumbnail (no map data). */}
              <div
                style={{
                  width: 150,
                  height: 96,
                  borderRadius: 10,
                  background: "linear-gradient(135deg,#E8EEF6,#D6E0EC)",
                  position: "relative",
                  overflow: "hidden",
                  flexShrink: 0,
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage:
                      "linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)",
                    backgroundSize: "20px 20px",
                    opacity: 0.5,
                  }}
                />
                <div style={{ position: "absolute", left: "46%", top: "40%", color: "var(--brand)" }}>
                  <Icon name="compass" size={26} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{wo.site || DASH}</div>
                {/* service zone: no wire column (DEFAULT 5) — em-dash. */}
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{DASH}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }} className="num">
                  {GPS_LABEL} {wo.checkinGps || DASH}
                </div>
                {checkedIn ? (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 8,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "var(--ok)",
                    }}
                  >
                    {/* check-in time: no timestamp column (DEFAULT 5) — em-dash. */}
                    <Icon name="check" size={14} />
                    {t("pm.checkedInAt").replace("{time}", DASH)}
                  </div>
                ) : (
                  <Btn
                    kind="primary"
                    size="sm"
                    icon="compass"
                    style={{ marginTop: 8 }}
                    onClick={doCheckin}
                    disabled={checkin.isPending}
                  >
                    {t("pm.checkinBtn")}
                  </Btn>
                )}
              </div>
            </div>
          </Card>

          {/* Checklist (pm3.jsx L185-219). */}
          <Card pad={0}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t("pm.checklistTitle")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* pick-checklist opens the FUNCTIONAL template picker (B-117). */}
                {!closed && (
                  <Btn kind="soft" size="sm" icon="plus" onClick={openChecklistPicker}>
                    {t("pm.pickChecklistBtn")}
                  </Btn>
                )}
                <span
                  className="num"
                  style={{ fontSize: 12, color: everyDone ? "var(--ok)" : "var(--text-2)", fontWeight: 700 }}
                >
                  {t("pm.checkProgress").replace("{n}", String(dCount)).replace("{count}", String(total))}
                </span>
              </div>
            </div>
            <div style={{ padding: "4px 0" }}>
              {checks.length === 0 && (
                <div style={{ padding: "30px 18px", textAlign: "center" }}>
                  <Icon name="check" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>{t("pm.emptyChecklist")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3, marginBottom: 14 }}>
                    {t("pm.emptyChecklistHint")}
                  </div>
                  {/* opens the FUNCTIONAL template picker (B-117). */}
                  {!closed && (
                    <Btn kind="primary" size="md" icon="plus" onClick={openChecklistPicker}>
                      {t("pm.pickChecklistBtn")}
                    </Btn>
                  )}
                </div>
              )}
              {checks.map((c, i) => {
                const r = resultTone(c.result);
                return (
                  <div
                    key={i}
                    style={{
                      padding: "13px 18px",
                      borderBottom: i < checks.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span
                        className="num"
                        style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", width: 18, flexShrink: 0 }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{c.label || DASH}</span>
                      <button
                        type="button"
                        onClick={() => setResult(i)}
                        disabled={closed}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 999,
                          border: "none",
                          cursor: closed ? "default" : "pointer",
                          fontFamily: "inherit",
                          fontSize: 11,
                          fontWeight: 700,
                          background: r.bg,
                          color: r.c,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t(r.key)}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 9, paddingInlineStart: 30 }}>
                      <PhotoChip label={t("pm.before")} />
                      <PhotoChip label={t("pm.after")} video={c.result === "repair"} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Maintenance log (pm3.jsx L222-229) — cause/fix/advice, persisted on close. */}
          <Card>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>{t("pm.maintLogTitle")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <NoteField
                label={t("pm.fieldCause")}
                value={cause}
                onChange={setCause}
                placeholder={t("pm.phCause")}
                disabled={closed}
              />
              <NoteField
                label={t("pm.fieldFix")}
                value={fix}
                onChange={setFix}
                placeholder={t("pm.phFix")}
                disabled={closed}
              />
              <NoteField
                label={t("pm.fieldAdvice")}
                value={advice}
                onChange={setAdvice}
                placeholder={t("pm.phAdvice")}
                disabled={closed}
              />
            </div>
          </Card>
        </div>

        {/* Right: WO info + time summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 0 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("pm.woInfoTitle")}</div>
            {/* type / contract-ref / zone have no wire (DEFAULT 5) -> em-dash; site/tech/
                due (asset next_due) / SLA (contract) are the real join. */}
            <InfoRow label={t("pm.type")} value={DASH} />
            <InfoRow label={t("pm.contractRef")} value={DASH} mono />
            <InfoRow label={t("pm.site")} value={wo.site || DASH} />
            <InfoRow label={t("pm.serviceZone")} value={DASH} />
            <InfoRow label={t("pm.tech")} value={wo.tech || DASH} />
            <InfoRow label={t("pm.due")} value={wo.nextDue || DASH} mono />
            <InfoRow label={t("pm.sla")} value={wo.sla || DASH} />
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("pm.timeSummaryTitle")}</div>
            {/* No time wire (DEFAULT 5) — start/end/total em-dash. */}
            <InfoRow label={t("pm.timeStart")} value={DASH} mono />
            <InfoRow label={t("pm.timeEnd")} value={DASH} mono />
            <InfoRow label={t("pm.timeTotal")} value={DASH} mono />
            {!closed ? (
              <Btn
                kind="primary"
                size="md"
                icon="check"
                style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
                onClick={closeWO}
                disabled={!checkedIn}
              >
                {t("pm.closeWithSignBtn")}
              </Btn>
            ) : (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  background: "var(--ok-soft)",
                  borderRadius: 9,
                  fontSize: 12,
                  color: "var(--ok)",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <Icon name="check" size={15} />
                {t("pm.closedNote")}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ===========================================================================
 * The close modal + its signature pad (B-331)
 * ===========================================================================
 * THIS PAD IS AN ADDITION BEYOND THE PROTOTYPE, and it is recorded rather than
 * shipped quietly because §0 rule 1 forbids inventing UI. pototype/pm3.jsx L137 is a
 * STATIC div rendering a cursive "ลงนาม ✓"; it has no canvas and no handler, so it
 * captures nothing. (The mobile prototype's pad is no better — mobile-pm.jsx L206 is
 * a tap toggle that paints a hardcoded customer name.) B-331 authorises a real pad:
 * Wei ruled the storage encoding for `customer_sign`, and the whole point of that
 * ruling was to make the signature capturable.
 *
 * What is kept EXACTLY from the prototype: the 90px box, radius 10, the 1.5px dashed
 * border over surface-2, and its position under pm.signatureLabel. What is dropped is
 * the cursive placeholder — pm.signHere reads "ลงนาม ✓", and that tick asserts an
 * ALREADY-COMPLETED signature. Printing it over an empty pad would state the customer
 * had signed when nothing has been drawn, which is the exact class of claim this
 * screen's other DEFAULTs em-dash. The empty pad is simply empty; the label above it
 * already says what it is, which also keeps this change ZERO-MINT.
 *
 * WHAT IS LEFT IN THIS FILE, AND WHY (B-357/F1). Only the PAINTING and the JSX. Every
 * rule between a pointer event and the wire — rect-to-CSS-px, clamping, thinning, the
 * capture viewport, stroke assembly, the encode — lives in use-pm.ts as pure functions
 * over a plain [SignatureCapture], because apps/web's test environment is node (no
 * canvas, no DOM, and no jsdom in the workspace — BLOCKERS.md B-358) and anything left
 * in JSX here is unreachable by a test. The gate demonstrated exactly that: mutating
 * the old `onChange` wiring to discard every stroke left the whole suite green.
 *
 * The pad therefore no longer TRANSFORMS anything on its way out — it mutates the very
 * object the confirm handler reads. There is no callback prop left to hand a
 * discarding function to, so that mutation no longer type-checks.
 */

/**
 * A real signature pad: pointer events into [capture], [capture] onto a canvas.
 *
 * It reports nothing. What may be SENT is read straight off the same capture at
 * confirm time (readSignatureCapture → encodeSignatureInk, the single place the
 * refusal rules live).
 */
function SignaturePad({ capture }: { capture: SignatureCapture }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Resolved `--text`, cached — see redraw(). */
  const inkColor = useRef<string | null>(null);
  /** Mirrors whether anything is drawn, so the clear affordance can render. */
  const [hasInk, setHasInk] = useState(false);

  /** Repaint every stroke. The canvas is the only render surface — strokes live in a
   *  ref so a 60 Hz pointer stream does not trigger a React render per point. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !ctx2d) return;
    const rect = canvas.getBoundingClientRect();
    // Back the canvas at device resolution so the ink is not blurry on HiDPI, while
    // every coordinate below stays in CSS px — the unit `w`/`h` are recorded in.
    // Resized only when it actually changed: assigning width/height reallocates the
    // backing store, and this runs on every pointermove.
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, rect.width, rect.height);
    // Canvas 2D cannot take `var(--text)` directly, so the token is RESOLVED rather
    // than a hex being hardcoded beside it (§0 rule 6 — tokens back every colour).
    // Cached: getComputedStyle forces a style flush, and this is a per-move path.
    if (inkColor.current === null) {
      inkColor.current =
        (typeof window === "undefined"
          ? ""
          : window.getComputedStyle(canvas).getPropertyValue("--text").trim()) || "#223548";
    }
    ctx2d.strokeStyle = inkColor.current;
    ctx2d.lineWidth = 2;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";
    const all = capture.active ? [...capture.strokes, capture.active] : capture.strokes;
    for (const stroke of all) {
      if (stroke.length === 0) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const p of stroke.slice(1)) ctx2d.lineTo(p.x, p.y);
      // A single point draws nothing as a path; a dot is drawn as a short segment so
      // the user SEES what they made (it still cannot close the WO — encodeSignatureInk
      // refuses a taps-only pad).
      if (stroke.length === 1) ctx2d.lineTo(stroke[0]!.x + 0.01, stroke[0]!.y);
      ctx2d.stroke();
    }
  }, [capture]);

  const clear = () => {
    clearSignatureCapture(capture);
    setHasInk(false);
    redraw();
  };

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        // Each handler is one call into the pure seam plus a repaint. Nothing decides
        // anything here: the rules are in use-pm.ts, where a node test can reach them
        // (B-357/F1). `React.PointerEvent<HTMLCanvasElement>` satisfies PadPointer
        // structurally, so no adapter object is built on a 60 Hz path.
        onPointerDown={(e) => {
          signaturePadDown(capture, e);
          redraw();
        }}
        onPointerMove={(e) => {
          signaturePadMove(capture, e);
          redraw();
        }}
        onPointerUp={() => {
          signaturePadUp(capture);
          setHasInk(signatureCaptureHasInk(capture));
          redraw();
        }}
        onPointerCancel={() => {
          signaturePadCancel(capture);
          setHasInk(signatureCaptureHasInk(capture));
          redraw();
        }}
        style={{
          display: "block",
          width: "100%",
          // pm3.jsx L137: 90px tall, radius 10, 1.5px dashed over surface-2.
          height: 90,
          border: "1.5px dashed var(--border-strong)",
          borderRadius: 10,
          background: "var(--surface-2)",
          // Without this a touch drag scrolls the modal instead of drawing.
          touchAction: "none",
          cursor: "crosshair",
        }}
      />
      {hasInk && (
        // Icon-only, so the pad needs no new i18n key (i18n-full.json is sacred).
        // Load-bearing rather than convenient: with no way to take back a mis-stroke
        // the technician's only options would be to submit a wrong mark or abandon
        // the close.
        <button
          type="button"
          onClick={clear}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
            borderRadius: 999,
            background: "var(--surface)",
            color: "var(--text-3)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * The close modal's body (pm3.jsx closeWO L128-147): the completeness banner, the
 * signature pad, and the two buttons.
 *
 * A component rather than inline JSX because it owns the CAPTURE: modal-host calls the
 * body render prop as a plain function on every host render, so a hook written inline
 * at the call site would belong to the host.
 *
 * The capture is a ref rather than state, and that is not an optimisation: the confirm
 * button is always enabled (the prototype's is, and a close genuinely records the
 * cause/fix/advice log with or without a signature), so nothing about the pad's
 * contents drives this component's rendering. Holding the encoded value in state
 * bought nothing and cost the seam its testability — see the pad's own header and
 * B-357/F1. `readSignatureCapture` returns null for an empty, taps-only or
 * never-travelled pad, and postCloseWorkorder then omits the key entirely.
 */
function CloseWoModalBody({
  everyDone,
  done,
  total,
  onCancel,
  onConfirm,
}: {
  everyDone: boolean;
  done: number;
  total: number;
  onCancel: () => void;
  onConfirm: (signature: string | undefined) => void;
}) {
  const { t } = useI18n();
  const capture = useRef(createSignatureCapture());

  return (
    <div>
      <div
        style={{
          padding: "10px 14px",
          background: everyDone ? "var(--ok-soft)" : "var(--warn-soft)",
          borderRadius: 9,
          marginBottom: 14,
          fontSize: 12,
          color: everyDone ? "var(--ok)" : "var(--warn)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name={everyDone ? "check" : "warn"} size={15} />
        {everyDone
          ? t("pm.readyToClose").replace("{count}", String(total))
          : t("pm.confirmIncomplete").replace("{n}", String(done)).replace("{count}", String(total))}
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>{t("pm.signatureLabel")}</div>
        <SignaturePad capture={capture.current} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onCancel}>
          {t("common.cancel")}
        </Btn>
        <Btn
          kind="primary"
          size="md"
          icon="check"
          // The prototype's confirm is always enabled and the close genuinely records
          // the cause/fix/advice log with or without a signature, so it stays enabled.
          // What is refused is a FABRICATED signature: readSignatureCapture returns
          // null for an empty, taps-only or never-travelled pad, and the key is then
          // omitted rather than sent blank (which would ERASE a stored signature).
          onClick={() => onConfirm(readSignatureCapture(capture.current) ?? undefined)}
        >
          {t("pm.confirmCloseBtn")}
        </Btn>
      </div>
    </div>
  );
}

/** Extract a server/browser error's message string (mirrors ap/pv-create-form). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}
