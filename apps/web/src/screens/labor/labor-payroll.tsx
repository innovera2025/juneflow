/*
 * LaborPayroll — the period payroll summary + post-to-GL screen, ported from
 * pototype/labor.jsx LaborPayroll (L191-256) + its PAYROLL_SEED (L188-190) and the shared
 * ds.jsx Kpi (dashboard.jsx L93-115) / StatusBadge (ds.jsx L93-108). Route labor.payroll
 * (registry.ts, mod "labor", section "main"). Modelled 1:1 on the merged sibling
 * labor-attendance.tsx (Page/Kpi/th()/td()/skeleton/empty-state/worker-join house style).
 *
 * DATA (section 0 rule 3): GET /labor/payroll (use-labor.ts) via the generated client — the
 * prototype's local PAYROLL_SEED becomes the real server run catalogue. Each wire row is
 *   { id, worker_id, period, amount, currency_code, cc_id, created_at }
 * The row has NO name/team/day_rate: worker_id is FK-resolved to a WorkerRow via
 * GET /labor/workers (workerById, labor-payroll-rows.ts) — an unresolved id em-dashes, the
 * raw uuid is never rendered. Pure narrowing / join / Sigma-net / period-selection live in
 * labor-payroll-rows.ts (unit-tested, gate G3).
 *
 * money = SERVER (this is a WRITE screen with money authority): the list is a pure read; the
 * pay button posts each run via POST /labor/payroll/{id}/post — the server posts + balances a
 * JV (Dr 1140 WIP-labor / Cr 1020 bank = the STORED amount) and returns jv_no. The client
 * NEVER supplies the amount, a Dr/Cr line, or a JV/PV number. If multiple runs exist the
 * screen loops the POST per run id (each is an independent JV). A double-post / no-amount /
 * missing-COA answers 409 — surfaced honestly (danger toast), never a fabricated success.
 *
 * HONEST DIVERGENCES (flagged, never fabricated):
 *   - EMPTY BY SEED: the tenant seed carries zero payroll runs (NO_RECORD), so the list is
 *     honest-empty (icon only, no minted copy — same as labor-attendance L288-295) and every
 *     KPI computes to 0 / em-dash. The pay button has nothing to act on until a run exists
 *     (creating a run is POST /labor/payroll, out of this round) -> honest-disabled at 0 rows.
 *   - BREAKDOWN NOT PERSISTED: the wire stores only the SERVER net `amount`; it carries no
 *     days / ot / base-wage / ot-pay. So the thDays / thOtHours / thWage / thOtPay columns +
 *     the kpiDays / kpiOt totals have no wire source -> EM-DASH (never re-derived client-side —
 *     splitting the server-authoritative net is forbidden money math). Only thNet (= amount)
 *     + kpiTotal (= Sigma amount) are shown.
 *   - PAID STATE EPHEMERAL: the read carries no posted flag, so per-row status defaults to
 *     stUnpaid; it flips to the paid label (subcon.colPaid) only from local state after ALL
 *     posts succeed (mirrors the mock's ephemeral `paid` boolean, L192). A reload reverts to
 *     stUnpaid — honest, no server flag.
 *   - {period}: no single authoritative period on the wire -> the latest period present
 *     (latestPeriod), em-dash when none. {site}: no site field on any labor wire -> em-dash.
 *   - Export: openExportModal is a dropped mock with no export endpoint -> honest-disabled
 *     (labor-workers precedent).
 *
 * i18n (rule 2, ZERO-sacred consume round): every static string resolves to an existing
 * labor.payroll.* key or a cross-key BORROW whose `th` byte-matches — labor.thWorker /
 * labor.team / labor.thOtHours / common.status / subcon.colPaid (the paid label; there is no
 * labor.payroll.stPaid key) / subcon.unitBaht / labor.unitDayPerson / labor.unitHours /
 * labor.unitBahtDay / vendor.btnExport / nav.sec.main / labor.crumbSection / common.cancel.
 * Nothing is minted. Server data (name/team) renders raw (rule 3). Tokens back every colour;
 * the OT accent #B45309 is prototype-verbatim (labor.jsx L214). Numeric cells carry class num.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { toWorkerRow, fmt, type WorkerRow } from "./labor-workers-rows";
import { toPayrollRow, workerById, netTotal, latestPeriod, type PayrollRow } from "./labor-payroll-rows";
import { useLaborWorkers, useLaborPayroll, usePostLaborPayroll } from "./use-labor";

/** The literal em-dash for a missing worker / unpersisted breakdown / absent period. */
const DASH = "—";

/** Table header cell style, ported from ds.jsx th(). */
function th(w?: number, align: "left" | "center" | "right" = "left"): CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td(). */
function td(align: "left" | "center" | "right" = "left"): CSSProperties {
  return { padding: "14px", verticalAlign: "middle", textAlign: align };
}

/** Kpi, ported from dashboard.jsx Kpi (L93-115) — the label/value/unit/sub/accent subset. */
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
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot (labor-workers precedent). */
function StatusBadge({ kind, label }: { kind: "approved" | "pending"; label: string }) {
  const s =
    kind === "approved"
      ? { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" }
      : { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
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
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

/** Extract an error message off an unknown mutation error (sales-down errMessage). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/**
 * PayrollPostConfirm — the pay-confirm modal body (labor.jsx L196-202), inlined like the
 * prototype keeps it. Renders the 2-line explainer (confirmMsg1 with the bold-num amount +
 * count, confirmMsg2 with the site) and the prototype's own confirm button label
 * (labor.payroll.confirmBtn); on confirm it triggers the parent's post-all then closes.
 * (The shared ConfirmDialog hardcodes common.confirm and cannot render the confirmBtn label,
 * so this uses the openModal custom-body precedent — sales-down / ap-retention.)
 */
function PayrollPostConfirm({
  total,
  count,
  onConfirm,
  onClose,
}: {
  total: number;
  count: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const msg1 = t("labor.payroll.confirmMsg1");
  const at = msg1.indexOf("{amount}");
  const before = at >= 0 ? msg1.slice(0, at) : msg1;
  const after = at >= 0 ? msg1.slice(at + "{amount}".length).replace("{count}", String(count)) : "";
  const msg2 = t("labor.payroll.confirmMsg2").replace("{site}", DASH);
  return (
    <>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, marginBottom: 16 }}>
        {before}
        <b className="num">{fmt(total)}</b>
        {after}
        <br />
        {msg2}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn
          kind="primary"
          size="md"
          icon="check"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {t("labor.payroll.confirmBtn")}
        </Btn>
      </div>
    </>
  );
}

export function LaborPayroll() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const workersQ = useLaborWorkers();
  const payrollQ = useLaborPayroll();
  const postMut = usePostLaborPayroll();

  // Ephemeral period paid flag (mock's `paid` boolean, L192): no posted flag on the read, so
  // it flips only after ALL runs post successfully; a reload reverts to stUnpaid (honest).
  const [paid, setPaid] = useState(false);

  const workers = useMemo<WorkerRow[]>(() => (workersQ.data ?? []).map(toWorkerRow), [workersQ.data]);
  const rows = useMemo<PayrollRow[]>(() => (payrollQ.data ?? []).map(toPayrollRow), [payrollQ.data]);
  const wmap = useMemo(() => workerById(workers), [workers]);

  const total = netTotal(rows);
  const count = rows.length;
  const period = latestPeriod(rows);

  const unitBaht = t("subcon.unitBaht"); // BORROW: baht symbol
  const unitBahtDay = t("labor.unitBahtDay");

  const isLoading = workersQ.isLoading || payrollQ.isLoading;

  const subtitle = t("labor.payroll.subtitle")
    .replace("{period}", period || DASH)
    .replace("{site}", DASH);

  // money=SERVER: post each run by id (each an independent JV). Flip `paid` + fire the toast
  // only when every post settles fulfilled; any 409 surfaces honestly (never a fake success).
  const postAll = () => {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    void Promise.allSettled(ids.map((id) => postMut.mutateAsync(id))).then((results) => {
      const failed = results.find((r) => r.status === "rejected");
      if (failed) {
        ctx.notify(errMessage((failed as PromiseRejectedResult).reason) || DASH, "danger");
        return;
      }
      setPaid(true);
      ctx.notify(t("labor.payroll.toastPost").replace("{amount}", fmt(total)));
    });
  };

  const openPay = () => {
    ctx.openModal({
      title: t("labor.payroll.confirmTitle"),
      subtitle: t("labor.payroll.confirmSubtitle").replace("{period}", period || DASH),
      icon: "cash",
      iconTone: "var(--ok)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <PayrollPostConfirm total={total} count={count} onConfirm={postAll} onClose={close} />
      ),
    });
  };

  const statusValue = paid ? t("subcon.colPaid") : t("labor.payroll.stUnpaid");

  return (
    <Page
      breadcrumbs={[t("nav.sec.main"), t("labor.crumbSection"), t("labor.payroll.crumb")]}
      title={t("labor.payroll.title")}
      subtitle={subtitle}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Honest-DISABLED: no export endpoint / the export modal is a dropped mock. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("vendor.btnExport")}
          </Btn>
          {/* Pay: REAL POST /labor/payroll/{id}/post (money=SERVER). Hidden when paid
              (prototype L209); disabled with no run to post or while a post is in flight. */}
          {!paid && (
            <Btn kind="primary" size="md" icon="cash" onClick={openPay} disabled={count === 0 || postMut.isPending}>
              {t("labor.payroll.btnPay")}
            </Btn>
          )}
        </div>
      }
    >
      {/* KPI strip (4): net total (Sigma amount) + status are REAL; the days / OT totals are not
          persisted on the wire -> em-dash (never a re-derived split). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("labor.payroll.kpiTotalLabel")}
          value={fmt(total)}
          unit={unitBaht}
          sub={t("labor.payroll.kpiTotalSub").replace("{count}", String(count))}
          accent="var(--brand)"
        />
        <Kpi label={t("labor.payroll.kpiDaysLabel")} value={DASH} unit={t("labor.unitDayPerson")} sub={t("labor.payroll.kpiDaysSub")} />
        <Kpi label={t("labor.payroll.kpiOtLabel")} value={DASH} unit={t("labor.unitHours")} sub={t("labor.payroll.kpiOtSub")} accent="#B45309" />
        <Kpi
          label={t("labor.payroll.kpiStatusLabel")}
          value={statusValue}
          sub={paid ? t("labor.payroll.kpiStatusSubPaid") : t("labor.payroll.kpiStatusSubUnpaid")}
          accent={paid ? "var(--ok)" : "var(--warn)"}
        />
      </div>

      <Card pad={0}>
        {isLoading ? (
          // Loading skeleton — token blocks, no invented copy.
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 48, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                    <th scope="col" style={th()}>{t("labor.thWorker")}</th>
                    <th scope="col" style={th(150)}>{t("labor.team")}</th>
                    <th scope="col" style={th(90, "center")}>{t("labor.payroll.thDays")}</th>
                    <th scope="col" style={th(80, "center")}>{t("labor.thOtHours")}</th>
                    <th scope="col" style={th(110, "right")}>{t("labor.payroll.thWage")}</th>
                    <th scope="col" style={th(100, "right")}>{t("labor.payroll.thOtPay")}</th>
                    <th scope="col" style={th(120, "right")}>{t("labor.payroll.thNet")}</th>
                    <th scope="col" style={th(100)}>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    // Honest empty state — icon only, no minted / semantically-wrong copy
                    // (no labor-scoped "no data" dict key exists to reuse); labor-attendance precedent.
                    <tr>
                      <td colSpan={8} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                        <Icon name="users" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const w = wmap.get(r.workerId);
                      return (
                        <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                          {/* worker: name + [code · day-rate + per-day unit] subline (FK-resolved). */}
                          <td style={td()}>
                            <div style={{ fontWeight: 600 }}>{w?.name || DASH}</div>
                            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                              <span className="num">{w?.code || DASH}</span>
                              {" · "}
                              <span className="num">{w?.dayRate != null ? fmt(w.dayRate) : DASH}</span> {unitBahtDay}
                            </div>
                          </td>
                          {/* team — server data, raw. */}
                          <td style={{ ...td(), fontSize: 11.5, color: "var(--text-2)" }}>{w?.team || DASH}</td>
                          {/* days — not persisted on the wire -> em-dash (never re-derived). */}
                          <td style={{ ...td("center"), fontWeight: 700 }} className="num">{DASH}</td>
                          {/* OT hours — not persisted -> em-dash. */}
                          <td style={td("center")} className="num">{DASH}</td>
                          {/* base wage — not persisted -> em-dash. */}
                          <td style={td("right")} className="num">{DASH}</td>
                          {/* OT pay — not persisted -> em-dash. */}
                          <td style={{ ...td("right"), color: "var(--text-2)" }} className="num">{DASH}</td>
                          {/* net — the SERVER-authoritative amount. */}
                          <td style={{ ...td("right"), fontWeight: 800, color: "var(--brand)" }} className="num">{fmt(r.amount)}</td>
                          {/* status — ephemeral: stUnpaid until every run posts (no server flag on the read). */}
                          <td style={td()}>
                            <StatusBadge kind={paid ? "approved" : "pending"} label={statusValue} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                    <tr>
                      <td colSpan={6} style={{ padding: 12, fontWeight: 700, fontSize: 12 }}>
                        {t("labor.payroll.footer").replace("{count}", String(count))}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", fontWeight: 800, color: "var(--brand)" }} className="num">
                        {fmt(total)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {/* Info footer (labor.jsx L250-252): the Dr 1140 / Cr bank explainer. */}
            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--text-3)",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              <Icon name="info" size={13} /> {t("labor.payroll.infoLine")}
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
