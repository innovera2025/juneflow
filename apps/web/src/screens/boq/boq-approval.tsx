/*
 * BOQApproval — the BOQ-approval screen, ported 1:1 from pototype/boq.jsx BOQApproval
 * (L1108-1371) + FileListBody (L1373-1419) + DiffStat/NotifyRow (L1421-1448). Route
 * boq.approval (docs/extract/NAV-ROUTES.md L26); visual-gate reference gallery/g1/12-s.jpg
 * (tests/visual/reference-index.md L40).
 *
 * Design fidelity (§0 rule 1): the layout is the prototype's, verbatim — the two-crumb
 * breadcrumb (BOQ section + the approval nav label), the title + Revise-compare subtitle, the
 * 360px pending-queue rail (count badge + sort note + selectable cards), and the diff
 * panel (doc header with Revise chip + status + files/print actions, the 4-card
 * old/new/net/changed strip, the inc/dec/all diff tabs + 7-column diff table, and the
 * approval-action card: the 4-node approval chain, the 3-channel notification block, the
 * reason box, the ≥500K escalate note, and the reject/revise/approve controls).
 *
 * Data (§0 rule 3 + rule 8, C10): the prototype's APPROVAL_LIST / DIFF_ROWS mock is
 * dropped. The pending queue is the REAL server catalogue filtered to status "pending"
 * (GET /boq -> pendingDocs; GET /boq has no status-filter param, so the subset is derived
 * client-side); the selected doc's identity (no/name/version/status/total) + its project
 * name (GET /projects) are real; approve WRITES through POST /boq/{id}/approve (pending ->
 * approved LOCK, MD-tier, NO baht threshold — every BOQ/revise is approved regardless of
 * amount, flows.html MATRIX "BOQ / Revise"). Pure logic is in boq-approval-agg.ts (gate
 * G3); the hooks are in use-boq-approval.ts.
 *
 * WIRE GAPS (reported honestly, never fabricated — the server has no version-diff engine):
 *  1. The per-line version diff (DIFF_ROWS: before/after price, change kind, delta) has NO
 *     source on the wire — the diff table renders an honest em-dash empty state, and the
 *     old-value / net-diff / changed-count stat cards + the tab counts + the compare-dates
 *     render em-dashes. Only the NEW-value card (= doc.total) and the version arithmetic
 *     (v{n-1} -> v{n}, real: a revise to N came from N-1) are populated.
 *  2. boq_doc exposes no submitted-at timestamp on the wire, so each queue card's "age"
 *     is an em-dash (never invented).
 *  3. boq_doc has no per-tier approval_step (apps/api/src/routes/boq.ts header), so the
 *     approval-chain node states (done/current/pending) + the notification channels are
 *     the prototype's STATIC design copy (identical for every doc — fidelity-first, §0
 *     B-037(a): rule 1 > rule 3 on conflict), rendered from i18n keys and flagged, not a
 *     per-doc claim.
 *  4. No attachments endpoint exists, so the files button shows an em-dash count and the
 *     file modal is an empty state; add-file / download-all are keyed notify stubs.
 *  5. The contract has NO reject / request-edit action for a pending BOQ (only
 *     submit/approve/revise) and no reason-persistence field, so those two buttons are
 *     keyed notify-only stubs mirroring the prototype's own pure-notify mock; the inline
 *     reason is NOT persisted. There is also no Thai approve/error toast key, so approve
 *     success uses the action-label key and failures surface the server's message.
 *
 * i18n (§0 rule 2): every string is a boq.apr* / common.* dict key (t), the approval
 * nav label (tn), or a boq-approval-strings.json phrase (tp) verified present in
 * i18n-full.json. Comments are English-only (CLAUDE.md); Thai lives only in the keys.
 * Tokens back every colour (rule 6); the status-dot hexes are prototype-verbatim (B-037(a)).
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { TopBar } from "../../shell/topbar";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { statusTone } from "./boq-rows";
import {
  useBoqList,
  useApproveBoq,
} from "./use-boq-approval";
import {
  toBoqRows,
  pendingDocs,
  selectedDoc,
  isFirstEdition,
  prevVersionLabel,
  versionLabel,
  versionTransition,
  formatMoney,
} from "./boq-approval-agg";
import approvalStrings from "./boq-approval-strings.json" with { type: "json" };

/** Phrase-key accessor for boq-approval-strings.json (Thai phrase IS the key -> tp). */
const P = (k: keyof typeof approvalStrings) => approvalStrings[k] as PhraseKey;

/** Honest placeholder for any figure the wire does not carry (§0 rule 3, never invented). */
const DASH = "—";

/** Table header cell (prototype th() — uppercase 0.05em, muted). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    whiteSpace: "nowrap",
    ...(w ? { width: w } : {}),
  };
}

/** One old/new/net/changed summary stat (prototype DiffStat, L1421-1430). */
function DiffStat({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: string;
  tone: "danger" | "ok" | "strong" | "muted";
  pct?: string;
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "ok"
        ? "var(--ok)"
        : tone === "strong"
          ? "var(--text)"
          : "var(--text-2)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color }}>
        {value}
      </div>
      {pct && (
        <div
          style={{
            fontSize: 10.5,
            color: tone === "danger" ? "var(--danger)" : "var(--text-3)",
            fontWeight: 600,
            marginTop: 2,
          }}
        >
          {pct}
        </div>
      )}
    </div>
  );
}

/**
 * One notification-channel row (prototype NotifyRow, L1432-1448). Static design copy: the
 * toggle is a display-only indicator (no backend preference source — WIRE GAP 3), so it is
 * non-interactive, mirroring the prototype's fixed on/on/off.
 */
function NotifyRow({ label, who, on }: { label: string; who: string; on: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 10px",
        background: "var(--surface-2)",
        borderRadius: 6,
      }}
    >
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{who}</div>
      </div>
      <div
        style={{
          width: 30,
          height: 18,
          borderRadius: 999,
          padding: 2,
          background: on ? "var(--ok)" : "var(--surface-3)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#fff",
            marginInlineStart: on ? 12 : 0,
            transition: "all .15s",
          }}
        />
      </div>
    </div>
  );
}

/**
 * File-attachments modal body (prototype FileListBody, L1373-1419). No attachments
 * endpoint exists (WIRE GAP 4) -> the list is an honest empty state; the cloud note is
 * real keyed copy; add-file / download-all are keyed notify stubs.
 */
function FileListBody({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          marginBottom: 14,
          border: "1px dashed var(--border)",
          borderRadius: 8,
          color: "var(--text-3)",
          fontSize: 20,
        }}
      >
        {DASH}
      </div>
      <div
        style={{
          padding: 12,
          background: "var(--surface-2)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name="info" size={13} color="var(--brand)" />
        {t("boq.aprFilesCloudNote")}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {tp(P("closeBtn"))}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="ghost"
          size="md"
          icon="upload"
          onClick={() => ctx.notify(t("boq.aprAddFileToast"))}
        >
          {tp(P("addFileBtn"))}
        </Btn>
        <Btn
          kind="primary"
          size="md"
          icon="download"
          onClick={() => ctx.notify(t("boq.aprDownloadAllToast").replace("{n}", DASH))}
        >
          {t("boq.aprDownloadAll")}
        </Btn>
      </div>
    </>
  );
}

/** Inline StatusBadge (ds.jsx L93, size sm): tokened bg/fg + prototype-verbatim dot. */
function StatusBadge({ label, status }: { label: string; status: string }) {
  const st = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: st.bg,
        color: st.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: st.dot }} />
      {label}
    </span>
  );
}

export function BOQApproval() {
  const { t, tp, tn } = useI18n();
  const ctx = useShellCtx();
  const [diffTab, setDiffTab] = useState<"inc" | "dec" | "all">("inc");
  const [reason, setReason] = useState("");
  const [selectedNo, setSelectedNo] = useState("");

  const listQ = useBoqList();
  const projectsQ = useProjects();
  const queue = pendingDocs(toBoqRows(listQ.data ?? []));
  const projectNames = new Map((projectsQ.data ?? []).map((p) => [p.id, p.name] as const));
  const selected = selectedDoc(queue, selectedNo);
  const approve = useApproveBoq(selected?.id);

  // Approve (pending -> approved LOCK). No Thai approve-toast key exists (WIRE GAP 5), so
  // success uses the action-label key and failure surfaces the server's message (English
  // Error envelope — honest, not fabricated).
  const doApprove = () => {
    if (!selected) return;
    ctx.confirm({
      title: t("common.approve"),
      subtitle: selected.no + " · " + versionLabel(selected.version),
      icon: "check",
      iconTone: "var(--ok)",
      message: t("boq.aprApproveForward"),
      onConfirm: () => {
        approve.mutate(undefined, {
          onSuccess: () => ctx.notify(t("boq.aprApproveForward")),
          onError: (err) => {
            const msg = (err as { message?: string } | null)?.message;
            ctx.notify(msg && msg.length > 0 ? msg : t("common.reject"), "danger");
          },
        });
      },
    });
  };

  // Reject / request-edit: the contract exposes NO such action for a pending BOQ (WIRE
  // GAP 5) -> keyed notify-only stubs, mirroring the prototype's own pure-notify mock. The
  // inline reason is passed to the toast but NOT persisted (no reason field on the wire).
  const doReject = () => {
    if (!selected) return;
    ctx.confirm({
      title: t("common.reject"),
      subtitle: selected.no + " · " + versionLabel(selected.version),
      icon: "x",
      iconTone: "var(--danger)",
      danger: true,
      onConfirm: () => ctx.notify(t("common.reject"), "danger"),
    });
  };
  const doRevise = () => {
    if (!selected) return;
    ctx.confirm({
      title: tp(P("reviseBtn")),
      subtitle: selected.no + " · " + versionLabel(selected.version),
      icon: "edit",
      iconTone: "var(--info)",
      onConfirm: () => ctx.notify(tp(P("reviseBtn")), "info"),
    });
  };

  const openFiles = () => {
    if (!selected) return;
    ctx.openModal({
      title: t("boq.aprFilesTitle").replace("{no}", selected.no),
      subtitle: t("boq.aprFilesSubtitle")
        .replace("{n}", DASH)
        .replace("{ver}", versionTransition(selected.version)),
      icon: "paperclip",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => <FileListBody onClose={close} />,
    });
  };
  const printDoc = () => {
    if (!selected) return;
    ctx.confirm({
      title: t("boq.aprPrintTitle").replace("{no}", selected.no),
      subtitle: versionTransition(selected.version) + " · " + selected.name,
      icon: "print",
      iconTone: "var(--brand)",
      message: t("boq.aprPrintMsg"),
      onConfirm: () => ctx.notify(t("boq.aprPrintToast").replace("{no}", selected.no)),
    });
  };

  const crumbs: ReactNode[] = [t("nav.sec.boq"), tn(approvalStrings.navApproval as NavKey)];

  // Diff tabs — labels are keyed; the count badges are em-dashes (no version-diff source).
  const diffTabs: { id: "inc" | "dec" | "all"; label: string; color: string }[] = [
    { id: "inc", label: t("boq.aprTabInc"), color: "var(--danger)" },
    { id: "dec", label: t("boq.aprTabDec"), color: "var(--ok)" },
    { id: "all", label: t("common.all"), color: "var(--text-2)" },
  ];

  // Approval chain (WIRE GAP 3: static design copy — no approval_step on the wire).
  const chain: { label: string; s: "done" | "current" | "pending"; you?: boolean }[] = [
    { label: t("boq.aprChainRequester"), s: "done" },
    { label: t("boq.aprChainPurchasing"), s: "done" },
    { label: tp(P("chainProjectMgr")), s: "current", you: true },
    { label: t("boq.aprChainDirector"), s: "pending" },
  ];

  // Escalate note split around {tier} so the tier reads bold, verbatim to the prototype.
  const escalateParts = t("boq.aprEscalateInfo").split("{tier}");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar breadcrumbs={crumbs} />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            {t("boq.aprTitle")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4 }}>
            {t("boq.aprSubtitle")}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, alignItems: "start" }}>
          {/* Pending queue */}
          <Card pad={0}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                {tp(P("pendingHeader"))}
                <span
                  style={{
                    fontSize: 10.5,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "var(--warn-soft)",
                    color: "var(--warn)",
                    fontWeight: 700,
                  }}
                >
                  {queue.length}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                {t("boq.aprPendingSort")}
              </div>
            </div>
            <div>
              {queue.map((b, i) => {
                const isActive = selected?.no === b.no;
                return (
                  <div
                    key={b.id || b.no}
                    onClick={() => setSelectedNo(b.no)}
                    style={{
                      padding: 14,
                      borderTop: i ? "1px solid var(--border)" : "none",
                      background: isActive ? "var(--brand-soft)" : "var(--surface)",
                      borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 4,
                      }}
                    >
                      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)" }}>
                        {b.no}
                      </span>
                      {/* WIRE GAP 2: no submitted-at on the wire -> em-dash age. */}
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{DASH}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>{b.name}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }}>
                      {projectNames.get(b.projectId) ?? DASH}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 8,
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: isFirstEdition(b.version) ? "var(--info-soft)" : "var(--surface-3)",
                          color: isFirstEdition(b.version) ? "var(--info)" : "var(--text-2)",
                        }}
                      >
                        {versionTransition(b.version)}
                        {isFirstEdition(b.version) ? " " + t("boq.aprVerFirstSuffix") : ""}
                      </span>
                      {/* WIRE GAP 1: no version-diff delta on the wire -> em-dash. */}
                      <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-3)" }}>
                        {DASH}
                      </span>
                    </div>
                  </div>
                );
              })}
              {queue.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 20 }}>
                  {DASH}
                </div>
              )}
            </div>
          </Card>

          {/* Diff / approval panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {selected && (
              <>
                {/* Doc header */}
                <Card pad={20}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>
                          {selected.no}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 9px",
                            borderRadius: 4,
                            background: "var(--info-soft)",
                            color: "var(--info)",
                          }}
                        >
                          {t("boq.aprReviseVer").replace("{ver}", versionTransition(selected.version))}
                        </span>
                        <StatusBadge label={tp(P("pendingHeader"))} status={selected.status} />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-2)" }}>{selected.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {/* WIRE GAP 4: no attachments endpoint -> em-dash count, empty modal. */}
                      <Btn kind="ghost" size="md" icon="paperclip" onClick={openFiles}>
                        {t("boq.aprFilesBtn").replace("{n}", DASH)}
                      </Btn>
                      <Btn kind="ghost" size="md" icon="print" onClick={printDoc}>
                        {t("common.print")}
                      </Btn>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 12,
                      marginTop: 16,
                      padding: 14,
                      background: "var(--surface-2)",
                      borderRadius: 10,
                    }}
                  >
                    {/* WIRE GAP 1: prior-version total is not stored -> em-dash value. */}
                    <DiffStat
                      label={t("boq.aprDiffOldValue").replace("{ver}", prevVersionLabel(selected.version) || DASH)}
                      value={DASH}
                      tone="muted"
                    />
                    {/* Real: the new BOQ value is the server SUM of the doc's items. */}
                    <DiffStat
                      label={t("boq.aprDiffNewValue").replace("{ver}", versionLabel(selected.version))}
                      value={formatMoney(selected.total)}
                      tone="strong"
                    />
                    {/* WIRE GAP 1: no net delta / pct source. */}
                    <DiffStat label={t("boq.aprDiffNet")} value={DASH} tone="muted" />
                    <DiffStat label={t("boq.aprDiffChanged")} value={DASH} tone="muted" pct={DASH} />
                  </div>
                </Card>

                {/* Diff tabs + table */}
                <Card pad={0}>
                  <div
                    style={{
                      display: "flex",
                      borderBottom: "1px solid var(--border)",
                      padding: "0 16px",
                      alignItems: "center",
                    }}
                  >
                    {diffTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setDiffTab(tab.id)}
                        style={{
                          padding: "14px 14px",
                          background: "none",
                          border: "none",
                          borderBottom: diffTab === tab.id ? "2px solid " + tab.color : "2px solid transparent",
                          marginBottom: -1,
                          fontSize: 12.5,
                          fontWeight: diffTab === tab.id ? 700 : 500,
                          color: diffTab === tab.id ? tab.color : "var(--text-2)",
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          cursor: "pointer",
                        }}
                      >
                        {tab.label}
                        {/* WIRE GAP 1: no diff -> em-dash count. */}
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: diffTab === tab.id ? tab.color : "var(--surface-3)",
                            color: diffTab === tab.id ? "#fff" : "var(--text-2)",
                          }}
                        >
                          {DASH}
                        </span>
                      </button>
                    ))}
                    <span style={{ marginInlineStart: "auto", fontSize: 11, color: "var(--text-3)" }}>
                      {t("boq.aprCompareVer")
                        .replace("{vA}", prevVersionLabel(selected.version) || DASH)
                        .replace("{dateA}", DASH)
                        .replace("{vB}", versionLabel(selected.version))
                        .replace("{dateB}", DASH)}
                    </span>
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                        <th scope="col" style={th(54)}>{tp(P("thType"))}</th>
                        <th scope="col" style={th(110)}>{tp(P("thCode"))}</th>
                        <th scope="col" style={th()}>{t("boq.edCatMaterial")}</th>
                        <th scope="col" style={th(130)}>{t("boq.aprThEdit")}</th>
                        <th scope="col" style={th(110, true)}>{t("boq.aprThOldVal")}</th>
                        <th scope="col" style={th(110, true)}>{t("boq.aprThNewVal")}</th>
                        <th scope="col" style={th(130, true)}>{t("boq.aprThDeltaVal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* WIRE GAP 1: server has no version-diff engine -> honest empty state. */}
                      <tr>
                        <td
                          colSpan={7}
                          style={{ padding: "40px 14px", textAlign: "center", color: "var(--text-3)", fontSize: 20 }}
                        >
                          {DASH}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                      <tr>
                        <td colSpan={6} style={{ padding: "12px", textAlign: "right", fontSize: 12, fontWeight: 600 }}>
                          {t("boq.aprNetDiffFoot").replace("{inc}", DASH).replace("{dec}", DASH)}
                        </td>
                        <td
                          className="num"
                          style={{ padding: "12px", textAlign: "right", fontSize: 14, fontWeight: 700, color: "var(--text-3)" }}
                        >
                          {DASH}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </Card>

                {/* Approval action */}
                <Card pad={20}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("boq.aprChainTitle")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        {chain.map((a, i, arr) => (
                          <div key={i} style={{ display: "contents" }}>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 4,
                                flex: 1,
                              }}
                            >
                              <div
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 999,
                                  background:
                                    a.s === "done"
                                      ? "var(--ok)"
                                      : a.s === "current"
                                        ? "var(--warn)"
                                        : "var(--surface-3)",
                                  color: a.s === "pending" ? "var(--text-3)" : "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: a.s === "current" ? "0 0 0 4px var(--warn-soft)" : "none",
                                }}
                              >
                                <Icon name={a.s === "done" ? "check" : a.s === "current" ? "clock" : "user"} size={14} />
                              </div>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  textAlign: "center",
                                  color: a.you ? "var(--warn)" : "var(--text-2)",
                                }}
                              >
                                {a.label}
                                {a.you ? " ★" : ""}
                              </span>
                            </div>
                            {i < arr.length - 1 && (
                              <div style={{ width: 24, height: 2, background: i < 2 ? "var(--ok)" : "var(--surface-3)" }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("common.notif")}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
                        <NotifyRow label={t("boq.aprNotifyInApp")} who={t("boq.aprNotifyInAppWho")} on />
                        <NotifyRow label={t("boq.aprNotifyLine")} who={t("boq.aprNotifyLineWho")} on />
                        <NotifyRow label={tp(P("notifyEmail"))} who={t("boq.aprNotifyEmailWho")} on={false} />
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, padding: 14, background: "var(--surface-2)", borderRadius: 10 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>
                      {t("boq.aprReasonLabel")}{" "}
                      <span style={{ color: "var(--text-3)" }}>{t("boq.aprReasonHint")}</span>
                    </label>
                    {/* WIRE GAP 5: reason is captured but NOT persisted (no wire field). */}
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("boq.aprReasonPh")}
                      style={{
                        width: "100%",
                        marginTop: 6,
                        padding: 10,
                        minHeight: 60,
                        border: "1px solid var(--border)",
                        borderRadius: 7,
                        fontSize: 12.5,
                        fontFamily: "inherit",
                        resize: "vertical",
                        outline: "none",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 12,
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        <Icon name="info" size={12} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
                        {escalateParts[0]}
                        <b>{t("boq.aprTier4")}</b>
                        {escalateParts[1] ?? ""}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn kind="ghost" size="md" icon="x" style={{ color: "var(--danger)" }} onClick={doReject}>
                          {t("common.reject")}
                        </Btn>
                        <Btn kind="outline" size="md" icon="edit" onClick={doRevise}>
                          {tp(P("reviseBtn"))}
                        </Btn>
                        <Btn kind="ok" size="md" icon="check" onClick={doApprove} disabled={approve.isPending}>
                          {t("boq.aprApproveForward")}
                        </Btn>
                      </div>
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
