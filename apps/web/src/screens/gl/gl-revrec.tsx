/*
 * gl.revrec — Revenue Recognition & WIP (accounting-extra.jsx GLRevenueWIP L291-443 +
 * WIPTransferForm L444-472). Route gl.revrec (docs/extract/NAV-ROUTES.md, section "acct",
 * parent gl, component GLRevenueWIP).
 *
 * WHAT CHANGED FROM THE PROTOTYPE (§0 rule 3 — mocks out, real system of record in):
 *   - REVREC_SEED / WIP_SEED are dropped; both tables read the server (use-gl-revrec.ts).
 *   - Posting no longer edits local state. `postJV` calls POST /gl/revrec/{id}/post and the
 *     amount is SERVER-computed — the figure on the button is display only. `transferCOGS`
 *     calls POST /gl/wip/{id}/transfer with the operator's amount, which the server
 *     re-validates against the remaining balance (over-transfer 409).
 *   - A failed post shows the failure. The prototype could not fail, so it had no path for
 *     one; here a 409 ("nothing left to recognise", "more than the balance") reaches the
 *     operator as a danger toast and NOTHING on screen moves — never a fabricated success.
 *
 * THE METHOD COLUMN IS AN EM-DASH ON PURPOSE (B-432). rev_rec.method is a bare `text` column
 * with no enum anywhere in the repo, and the seed writes one invented code into all four rows
 * while the prototype states four different methods. Rendering a guessed label would put a
 * fabricated accounting policy on screen, so the cell shows the honest-unknown marker until
 * Wei rules. The header, the column and its width stay exactly where the prototype has them.
 *
 * Export is a no-op stub: openExportModal is a dropped mock and no export endpoint exists
 * (gl-cashflow / boq-archive precedent) — never a fabricated toast.
 *
 * i18n (§0 rule 2): every visible string is a gl-revrec-strings.json phrase (tp) or a
 * gl.revrec.* / shared dict key (t). "GL" and "Unbilled" are the prototype's verbatim ASCII
 * labels, following gl-jv.tsx:217. Tokens back every colour (§0 rule 6). No Thai/baht literal
 * in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { PhraseKey } from "@juneflow/i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  dueCount,
  dueRev,
  isValidTransfer,
  methodMeta,
  sumRecognized,
  sumTransferred,
  sumUnbilledAsset,
  sumWipBalance,
  toRevRec,
  toWip,
  wipTotals,
  type RevRecVM,
  type WipVM,
} from "./gl-revrec-rows";
import {
  useGlRevRec,
  useGlRevRecPost,
  useGlWip,
  useTransferGlWip,
} from "./use-gl-revrec";
import strings from "./gl-revrec-strings.json" with { type: "json" };

/** The screen's honest-unknown marker. */
const DASH = "—";

/** The prototype's verbatim ASCII module crumb and column label (gl-jv.tsx:217 precedent). */
const CRUMB_GL = "GL";
const LABEL_UNBILLED = "Unbilled";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/** ds.jsx th() / td() — the prototype's shared table cell metrics. */
const th = (w?: number): CSSProperties => ({
  padding: "10px 12px",
  textAlign: "start",
  fontWeight: 600,
  fontSize: 11,
  ...(w ? { width: w } : {}),
});
const TD: CSSProperties = { padding: "12px", verticalAlign: "middle" };

/** Thousands-separated integer baht, the prototype's fmt(). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Millions to one decimal — the prototype's (x / 1e6).toFixed(1) KPI scaling. */
function millions(n: number): string {
  return (n / 1e6).toFixed(1);
}

/** KPI card, inlined from dashboard.jsx Kpi — the props this screen uses. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Progress bar, inlined from ds.jsx Bar — the percent-complete cell. */
function Bar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)", borderRadius: 3 }} />
    </div>
  );
}

/** Method pill, inlined from ds.jsx Tag. */
function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: "var(--info)", background: "color-mix(in srgb, var(--info) 12%, var(--surface))" }}>
      {children}
    </span>
  );
}

/** The two tab pills above the tables (the prototype's own inline buttons). */
function Tabs({
  tab,
  setTab,
  labels,
}: {
  tab: "rev" | "wip";
  setTab: (t: "rev" | "wip") => void;
  labels: { rev: string; wip: string };
}) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
      {(["rev", "wip"] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          aria-pressed={tab === id}
          style={{
            padding: "9px 18px", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 700,
            background: tab === id ? "var(--brand)" : "var(--surface)",
            color: tab === id ? "var(--on-brand)" : "var(--text-2)",
            boxShadow: tab === id ? "none" : "inset 0 0 0 1px var(--border)",
          }}
        >
          {labels[id]}
        </button>
      ))}
    </div>
  );
}

/**
 * The WIP -> COGS transfer form (prototype WIPTransferForm).
 *
 * The bound check is the prototype's, and it stays a courtesy: the server re-validates the
 * amount against the remaining balance and 409s an over-transfer. `pending` disables the
 * confirm so a double click cannot send the same transfer twice.
 */
function WipTransferForm({
  row,
  onClose,
  onSave,
  pending,
}: {
  row: WipVM;
  onClose: () => void;
  onSave: (amount: number) => void;
  pending: boolean;
}) {
  const { t, tp } = useI18n();
  const [amt, setAmt] = useState("");
  const [err, setErr] = useState(false);
  const bal = row.balance;

  const save = (): void => {
    const v = Number.parseFloat(amt);
    if (!isValidTransfer(v, bal)) {
      setErr(true);
      return;
    }
    onSave(v);
  };

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "var(--brand-soft)", borderRadius: 9, marginBottom: 14, fontSize: 12, color: "var(--text-2)" }}>
        {t("gl.revrec.transferInfo").replace("{amount}", fmt(bal))}
      </div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>
        {tp(P("transferAmountLabel"))}
        <input
          value={amt}
          onChange={(e) => {
            setAmt(e.target.value.replace(/[^\d.]/g, ""));
            setErr(false);
          }}
          placeholder={String(bal)}
          className="num"
          style={{ width: "100%", height: 40, padding: "0 12px", fontSize: 15, fontWeight: 700, border: `1px solid ${err ? "var(--danger)" : "var(--border)"}`, borderRadius: 8, background: "var(--surface)", outline: "none", fontFamily: "inherit", marginTop: 6 }}
        />
      </label>
      {err && (
        <div role="alert" style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
          {t("gl.revrec.transferError")}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn kind="ghost" size="sm" onClick={() => setAmt(String(bal))}>{tp(P("transferAll"))}</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setAmt(String(Math.round(bal / 2)))}>{tp(P("transferHalf"))}</Btn>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <Btn kind="outline" size="md" onClick={onClose}>{tp(P("cancel"))}</Btn>
        <Btn kind="primary" size="md" icon="check" disabled={pending} onClick={save}>
          {tp(P("transferConfirm"))}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The recognition confirm descriptor, exported so the wiring can be tested without a DOM
 * (timeline.tsx taskModalDescriptor precedent — a click handler is unreachable from
 * renderToStaticMarkup, and the properties worth protecting live in this object).
 *
 * `onConfirm` is passed in rather than built here on purpose: the caller is the only place
 * that knows the mutation, and keeping it out of this function is what lets a test assert
 * that the POST receives the row id and nothing else.
 */
export function postConfirmDescriptor(args: {
  row: RevRecVM;
  title: string;
  confirmLabel: string;
  /** The gl.revrec.confirmMessage template, still carrying {amount} and {pct}. */
  message: string;
  drCr: string;
  onConfirm: () => void;
}): Record<string, unknown> {
  const { row, title, confirmLabel, message, drCr, onConfirm } = args;
  return {
    title,
    subtitle: row.projectName || DASH,
    icon: "check",
    iconTone: "var(--ok)",
    confirmLabel,
    message: (
      <>
        {message.replace("{amount}", fmt(dueRev(row))).replace("{pct}", String(row.pct))}
        <br />
        {drCr}
      </>
    ),
    onConfirm,
  };
}

export function GLRevenueWIP() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const [tab, setTab] = useState<"rev" | "wip">("rev");

  const revQuery = useGlRevRec();
  const wipQuery = useGlWip();
  const postJv = useGlRevRecPost();
  const transfer = useTransferGlWip();

  const revRows: RevRecVM[] = useMemo(
    () => (revQuery.data ?? []).map((e) => toRevRec(e)),
    [revQuery.data],
  );
  const wipRows: WipVM[] = useMemo(
    () => (wipQuery.data ?? []).map((e) => toWip(e)),
    [wipQuery.data],
  );

  const totRecognized = sumRecognized(revRows);
  const totUnbilled = sumUnbilledAsset(revRows);
  const totWip = sumWipBalance(wipRows);
  const totTransferred = sumTransferred(wipRows);
  const totals = wipTotals(wipRows);

  /**
   * Surface the server's own outcome — a 409 is a real refusal, never a silent no-op.
   *
   * The key is BORROWED, not minted: admin.common.actionFailedToast already carries exactly this
   * value, and the mint rule is to borrow rather than duplicate a string under a second key. Its
   * namespace is historical (it was first needed on the admin screens), not a scope.
   */
  const failed = (): void => ctx.notify(t("admin.common.actionFailedToast"), "danger");

  const onPost = (r: RevRecVM): void =>
    ctx.confirm(
      postConfirmDescriptor({
        row: r,
        title: tp(P("confirmPostTitle")),
        confirmLabel: t("gl.revrec.confirmBtn"),
        message: t("gl.revrec.confirmMessage"),
        drCr: t("gl.revrec.confirmDrCr"),
        onConfirm: () => {
          postJv.mutate(r.id, {
            onSuccess: () =>
              ctx.notify(t("gl.revrec.toastPostJv").replace("{amount}", fmt(dueRev(r)))),
            onError: failed,
          });
        },
      }),
    );

  const onTransfer = (r: WipVM): void =>
    ctx.openModal({
      title: tp(P("transferModalTitle")),
      subtitle: r.projectName || DASH,
      icon: "arrowR",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <WipTransferForm
          row={r}
          onClose={close}
          pending={transfer.isPending}
          onSave={(amount) => {
            transfer.mutate(
              { id: r.id, amount },
              {
                onSuccess: () => {
                  close();
                  ctx.notify(t("gl.revrec.toastTransfer").replace("{amount}", fmt(amount)));
                },
                onError: () => {
                  close();
                  failed();
                },
              },
            );
          }}
        />
      ),
    });

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), CRUMB_GL, tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        /* Export = no-op stub (no ported export modal, no export endpoint; gl-cashflow
           precedent) — never a fabricated toast. */
        <Btn kind="outline" size="md" icon="download">
          {t("common.export")}
        </Btn>
      }
    >
      <Tabs tab={tab} setTab={setTab} labels={{ rev: tp(P("tabRev")), wip: tp(P("tabWip")) }} />

      {tab === "rev" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
            <Kpi
              label={tp(P("kpiRecognized"))}
              value={millions(totRecognized)}
              unit={tp(P("unitMillion"))}
              sub={t("gl.revrec.kpiRecognizedSub").replace("{count}", String(revRows.length))}
              accent="var(--ok)"
            />
            <Kpi
              label={tp(P("kpiUnbilled"))}
              value={millions(totUnbilled)}
              unit={tp(P("unitMillion"))}
              sub={t("gl.revrec.kpiUnbilledSub")}
              accent="var(--warn)"
            />
            <Kpi
              label={tp(P("kpiDue"))}
              value={String(dueCount(revRows))}
              unit={tp(P("unitProject"))}
              sub={t("gl.revrec.kpiDueSub")}
              accent="var(--brand)"
            />
          </div>

          <Card pad={0}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th()}>{tp(P("colProject"))}</th>
                  <th scope="col" style={th(170)}>{tp(P("colMethod"))}</th>
                  <th scope="col" style={{ ...th(130), textAlign: "end" }}>{tp(P("colContract"))}</th>
                  <th scope="col" style={th(140)}>{tp(P("colPct"))}</th>
                  <th scope="col" style={{ ...th(130), textAlign: "end" }}>{tp(P("colRecognized"))}</th>
                  <th scope="col" style={{ ...th(130), textAlign: "end" }}>{tp(P("colBilled"))}</th>
                  <th scope="col" style={{ ...th(120), textAlign: "end" }}>{LABEL_UNBILLED}</th>
                  <th scope="col" style={th(150)} />
                </tr>
              </thead>
              <tbody>
                {revRows.map((r) => {
                  const due = dueRev(r);
                  const method = methodMeta(r.method);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...TD, fontWeight: 600 }}>{r.projectName || DASH}</td>
                      <td style={TD}>{method.known ? <Tag>{method.code}</Tag> : DASH}</td>
                      <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.contractAmount)}</td>
                      <td style={TD}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ flex: 1 }}><Bar value={r.pct} /></div>
                          <span className="num" style={{ fontSize: 11, fontWeight: 700, width: 32 }}>{r.pct}%</span>
                        </div>
                      </td>
                      <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 700, color: "var(--ok)" }}>{fmt(r.recognized)}</td>
                      <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.billed)}</td>
                      <td
                        className="num"
                        style={{ ...TD, textAlign: "end", fontWeight: 600, color: r.unbilled > 0 ? "var(--warn)" : r.unbilled < 0 ? "var(--info)" : "var(--text-3)" }}
                      >
                        {r.unbilled === 0 ? DASH : (r.unbilled > 0 ? "+" : "") + fmt(r.unbilled)}
                      </td>
                      <td style={{ ...TD, textAlign: "end" }}>
                        {due > 0 ? (
                          <Btn kind="primary" size="sm" icon="check" disabled={postJv.isPending} onClick={() => onPost(r)}>
                            {`${t("gl.revrec.confirmBtn")} (${millions(due)}M)`}
                          </Btn>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ok)", fontWeight: 700 }}>
                            <Icon name="check" size={13} />
                            {tp(P("fullyRecognized"))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
            <Kpi label={tp(P("kpiWip"))} value={millions(totWip)} unit={tp(P("unitMillion"))} sub={t("gl.revrec.kpiWipSub")} accent="var(--brand)" />
            <Kpi label={tp(P("kpiTransferred"))} value={millions(totTransferred)} unit={tp(P("unitMillion"))} sub={t("gl.revrec.kpiTransferredSub")} accent="var(--ok)" />
            <Kpi label={tp(P("kpiWipProjects"))} value={String(wipRows.length)} unit={tp(P("unitProject"))} sub={t("gl.revrec.kpiWipProjSub")} />
          </div>

          <Card pad={0}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th()}>{tp(P("unitProject"))}</th>
                  <th scope="col" style={{ ...th(130), textAlign: "end" }}>{tp(P("colMaterial"))}</th>
                  <th scope="col" style={{ ...th(130), textAlign: "end" }}>{t("gl.revrec.colSubcon")}</th>
                  <th scope="col" style={{ ...th(120), textAlign: "end" }}>{tp(P("colOverhead"))}</th>
                  <th scope="col" style={{ ...th(140), textAlign: "end" }}>{tp(P("colTransferred"))}</th>
                  <th scope="col" style={{ ...th(140), textAlign: "end" }}>{tp(P("colBalance"))}</th>
                  <th scope="col" style={th(140)} />
                </tr>
              </thead>
              <tbody>
                {wipRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...TD, fontWeight: 600 }}>{r.projectName || DASH}</td>
                    <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.material)}</td>
                    <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.subcon)}</td>
                    <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.overhead)}</td>
                    <td className="num" style={{ ...TD, textAlign: "end", color: "var(--ok)" }}>{r.transferred > 0 ? fmt(r.transferred) : DASH}</td>
                    <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 800, color: "var(--brand)" }}>{fmt(r.balance)}</td>
                    <td style={{ ...TD, textAlign: "end" }}>
                      <Btn kind="soft" size="sm" icon="arrowR" disabled={transfer.isPending} onClick={() => onTransfer(r)}>
                        {tp(P("btnTransfer"))}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                <tr>
                  <td style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>{tp(P("totalRow"))}</td>
                  <td className="num" style={{ padding: 12, textAlign: "end", fontWeight: 700 }}>{fmt(totals.material)}</td>
                  <td className="num" style={{ padding: 12, textAlign: "end", fontWeight: 700 }}>{fmt(totals.subcon)}</td>
                  <td className="num" style={{ padding: 12, textAlign: "end", fontWeight: 700 }}>{fmt(totals.overhead)}</td>
                  <td className="num" style={{ padding: 12, textAlign: "end", fontWeight: 700, color: "var(--ok)" }}>{fmt(totals.transferred)}</td>
                  <td className="num" style={{ padding: 12, textAlign: "end", fontWeight: 800, color: "var(--brand)" }}>{fmt(totals.balance)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}
