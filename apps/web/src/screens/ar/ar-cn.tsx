/*
 * ARCreditNote — the AR Credit Note register screen (ar.cn), ported from
 * pototype/accounting-extra2.jsx ARCreditNote (L114-181) + ARCNForm (L182-223, in ar-cn-form.tsx).
 * Route ar.cn (docs/extract/NAV-ROUTES.md L77, section "acct"). Mirrors the finance-lane precedents
 * gl-inbox.tsx (list + KPI strip + generated-client/unwrap + inlined primitives) and ap-pv.tsx
 * (StatusBadge tokens, MiniKpi family, create-modal + approve wiring).
 *
 * Design fidelity (§0 rule 1): the three-part breadcrumb (finance · AR · credit-note), the
 * title/subtitle, the Export + create header actions, the 3-card KPI strip, the credit-note table
 * (CN no / customer / invoice ref / reason tag / amount / VAT / date / status / action), and the
 * approve-confirm dialog are the prototype's.
 *
 * Data (rule 3): GET /ar/cn (use-ar-cn.ts) via the generated client — the prototype's local
 * ARCN_SEED becomes the real server catalogue. Pure narrowing/derive/sum logic lives in
 * ar-cn-rows.ts (unit-tested, G3). Customer names + invoice refs resolve from GET /customers +
 * GET /ar/invoices (real).
 *
 * MONEY AUTHORITY (B-121 · SERVER owns the VAT):
 *   - the table VAT column reads the wire's DERIVED `vat` (ar.ts cnWire = round2(amount × 7/107)) —
 *     never a client computation. The create form's split box is a CLIENT PREVIEW only (ar-cn-rows).
 *   - approve -> POST /ar/cn/{id}/approve posts the balanced reversal JV (Dr revenue + Dr vat / Cr
 *     AR) through the POSTING-INBOX (source_doc 'cn:<id>'); nothing here posts a JV client-side. A
 *     re-approve is idempotent -> the server 409 is surfaced honestly (never a double post).
 *
 * REAL vs em-dash (honest, never fabricated) — see ar.ts cnWire + ar-cn-rows.ts:
 *   - CN no / amount / VAT / status -> REAL wire fields (amount gross, vat derived).
 *   - customer / invoice-ref -> the wire carries UUIDs; the name / invoice no are RESOLVED via the
 *     customers / invoices maps -> em-dash an unresolved (or null) id.
 *   - reason -> REAL where present; em-dash on null.
 *   - date -> REAL note_date, else created_at (stored UTC) formatted YYYY-MM-DD; em-dash if absent.
 *   HONEST STATUS GAP (reported): ar.ts NEITHER sets `status` on create NOR flips it on approve, so a
 *   freshly-created CN is status="" (renders "draft" per the prototype else-branch) and stays that
 *   way even after a successful approve (the approve marker is the JV source_doc, not this column).
 *   The KPI approved/pending counts + the approved-VAT sum reflect the REAL stored status honestly.
 *
 * i18n (rule 2): every string resolves via t() from the DICT (ar.cn.* Wave-B) plus reused existing
 * keys for shared values (fin.breadcrumbFinance, ar.breadcrumbArSide, ar.fldCustomer, subcon.colReason,
 * subcon.colDate, subcon.unitBaht, common.status/approve/print, fin.statusApproved/Pending/Draft, and
 * the pm.export* export-modal family — cross-namespace value-identical reuse, gl-inbox precedent).
 * Tokens back every colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx, type ShellCtx } from "../../shell/shell-context";
import {
  toCnRow,
  statusKind,
  statusTone,
  reasonTone,
  formatMoney,
  formatDate,
  cnCount,
  countStatus,
  sumAmount,
  sumVatApproved,
  type CnRow,
  type CnStatusKind,
} from "./ar-cn-rows";
import {
  useApproveArCn,
  useArCnList,
  useArInvoicesList,
  useCustomersList,
} from "./use-ar-cn";
import { ARCNForm } from "./ar-cn-form";

const DASH = "—";
/** Minus sign (U+2212) prefix on the credit amount (prototype accounting-extra2.jsx L164). */
const MINUS = "−";

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** KPI card, inlined from ds.jsx Kpi (dashboard.jsx L93-115): label / value+unit / sub, accent. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  accent: string;
}) {
  return (
    <Card pad={18}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}
        >
          {value}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>
    </Card>
  );
}

/** StatusBadge (ds.jsx L84-108, size sm): tokened bg/fg + verbatim dot hex. */
function StatusBadge({ kind, label }: { kind: CnStatusKind; label: string }) {
  const s = statusTone(kind);
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

/** Reason tag, inlined from ds.jsx Tag (L273-281): color-mix tint by tone. */
function Tag({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Extract an error message off an unknown mutation error (billing-form precedent). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** Pre-resolved copy for the Export modal (avoids passing the DictKey-typed t() around). */
interface ExportStrings {
  title: string;
  what: string;
  excel: string;
  pdf: string;
  csv: string;
  toast: string;
}

/**
 * The Export modal (land.jsx openExportModal, mirrored from pm-dashboard.tsx) — PRESENTATIONAL: no
 * export endpoint exists, so it lists the three formats and toasts a client-intent "downloading"
 * (the report name is ar.cn.exportName; the modal chrome reuses the pm.export* family).
 */
function openExportModal(ctx: ShellCtx, s: ExportStrings): void {
  const opts: { ic: IconName; l: string }[] = [
    { ic: "grid", l: s.excel },
    { ic: "doc", l: s.pdf },
    { ic: "download", l: s.csv },
  ];
  ctx.openModal({
    title: s.title,
    subtitle: s.what,
    icon: "download",
    iconTone: "var(--brand)",
    size: "sm",
    body: ({ close }: { close: () => void }) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {opts.map((o) => (
          <button
            key={o.l}
            type="button"
            onClick={() => {
              close();
              ctx.notify(s.toast.replace("{name}", s.what).replace("{fmt}", o.l));
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface)",
              cursor: "pointer",
              textAlign: "start",
              fontFamily: "inherit",
            }}
          >
            <Icon name={o.ic} size={18} color="var(--brand)" />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{o.l}</span>
            <Icon name="arrowR" size={15} color="var(--text-3)" />
          </button>
        ))}
      </div>
    ),
  });
}

export function ARCreditNote() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const cnQ = useArCnList();
  const customersQ = useCustomersList();
  const invoicesQ = useArInvoicesList();
  const approveCn = useApproveArCn();

  const rows = useMemo<CnRow[]>(() => (cnQ.data ?? []).map(toCnRow), [cnQ.data]);

  // Resolve customer_id -> name and ref_invoice_id -> invoice no (real, from the sibling reads).
  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (customersQ.data ?? []) as Record<string, unknown>[]) {
      const id = typeof c.id === "string" ? c.id : "";
      const name = typeof c.name === "string" ? c.name : "";
      if (id) m.set(id, name);
    }
    return m;
  }, [customersQ.data]);
  const invoiceNo = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of (invoicesQ.data ?? []) as Record<string, unknown>[]) {
      const id = typeof inv.id === "string" ? inv.id : "";
      const no = typeof inv.no === "string" ? inv.no : "";
      if (id) m.set(id, no);
    }
    return m;
  }, [invoicesQ.data]);

  const count = cnCount(rows);
  const approvedCount = countStatus(rows, "approved");
  const pendingCount = countStatus(rows, "pending");
  const totalAmount = sumAmount(rows);
  const approvedVat = sumVatApproved(rows);

  const cancelReason = t("ar.cn.reasonCancelBooking");

  const statusLabel = (kind: CnStatusKind): string => {
    switch (kind) {
      case "approved":
        return t("fin.statusApproved");
      case "pending":
        return t("fin.statusPending");
      default:
        return t("fin.statusDraft");
    }
  };

  const openForm = () => {
    ctx.openModal({
      title: t("ar.cn.modalTitle"),
      subtitle: t("ar.cn.modalSubtitle"),
      icon: "doc",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => <ARCNForm onClose={close} />,
    });
  };

  const approve = (r: CnRow) => {
    const customer = customerName.get(r.customerId) || DASH;
    const line1 = t("ar.cn.confirmLine1")
      .replace("{amount}", formatMoney(r.amount))
      .replace("{customer}", customer);
    ctx.confirm({
      title: t("ar.cn.confirmTitle"),
      subtitle: r.no,
      icon: "check",
      iconTone: "var(--ok)",
      message: (
        <>
          {line1}
          <br />
          {t("ar.cn.confirmLine2")}
        </>
      ),
      onConfirm: () =>
        approveCn.mutate(r.id, {
          // ar.cn.toastApproved carries the "approved {docNo} -> sent to GL" copy (dict). The CN
          // status is NOT flipped by the server (reported), so the badge stays — this only confirms
          // the post.
          onSuccess: () =>
            ctx.notify(t("ar.cn.toastApproved").replace("{docNo}", r.no)),
          // Idempotent re-approve -> 409 surfaced honestly (never a fabricated double post).
          onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
        }),
    });
  };

  const print = (r: CnRow) =>
    ctx.notify(t("ar.cn.toastPrint").replace("{docNo}", r.no));

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), t("ar.breadcrumbArSide"), t("ar.cn.breadcrumb")]}
      title={t("ar.cn.title")}
      subtitle={t("ar.cn.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            kind="outline"
            size="md"
            icon="download"
            onClick={() =>
              openExportModal(ctx, {
                title: t("pm.exportModalTitle"),
                what: t("ar.cn.exportName"),
                excel: t("pm.exportExcel"),
                pdf: t("pm.exportPdf"),
                csv: t("pm.exportCsv"),
                toast: t("pm.toastDownloading"),
              })
            }
          >
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openForm}>
            {t("ar.cn.btnNew")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (3): count + approved/pending sub · total credit (incl VAT) · approved-VAT sum. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={t("ar.cn.kpiMonth")}
          value={String(count)}
          unit={t("ar.cn.kpiUnitDocs")}
          sub={t("ar.cn.kpiMonthSub")
            .replace("{approved}", String(approvedCount))
            .replace("{pending}", String(pendingCount))}
          accent="var(--brand)"
        />
        <Kpi
          label={t("ar.cn.kpiTotal")}
          value={formatMoney(totalAmount)}
          unit={t("subcon.unitBaht")}
          sub={t("ar.cn.kpiTotalSub")}
          accent="var(--danger)"
        />
        <Kpi
          label={t("ar.cn.kpiVat")}
          value={formatMoney(approvedVat)}
          unit={t("subcon.unitBaht")}
          sub={t("ar.cn.kpiVatSub")}
          accent="var(--warn)"
        />
      </div>

      <Card pad={0}>
        {cnQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th(120)}>{t("ar.cn.thNo")}</th>
                <th scope="col" style={th()}>{t("ar.fldCustomer")}</th>
                <th scope="col" style={th(130)}>{t("ar.cn.thRef")}</th>
                <th scope="col" style={th(180)}>{t("subcon.colReason")}</th>
                <th scope="col" style={th(120, true)}>{t("ar.cn.thAmount")}</th>
                <th scope="col" style={th(100, true)}>{t("ar.cn.thVat")}</th>
                <th scope="col" style={th(100)}>{t("subcon.colDate")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
                <th scope="col" style={th(110)} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const kind = statusKind(r.status);
                  const customer = customerName.get(r.customerId) ?? "";
                  const ref = invoiceNo.get(r.refInvoiceId) ?? "";
                  const date = formatDate(r.noteDate, r.createdAt);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      {/* CN no: REAL wire field. */}
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {r.no || DASH}
                      </td>
                      {/* customer: RESOLVED name (customers map), em-dash on an unresolved id. */}
                      <td style={{ ...td, fontWeight: 600 }}>
                        {customer || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                      </td>
                      {/* invoice ref: RESOLVED no (invoices map), em-dash on an unresolved id. */}
                      <td style={{ ...td, color: "var(--text-2)" }} className="num">
                        {ref || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                      </td>
                      {/* reason: REAL where present, em-dash on null. */}
                      <td style={td}>
                        {r.reason ? (
                          <Tag tone={reasonTone(r.reason, cancelReason)}>{r.reason}</Tag>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                        )}
                      </td>
                      {/* amount: REAL gross credit (VAT-inclusive), rendered negative (a reduction). */}
                      <td
                        style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--danger)" }}
                        className="num"
                      >
                        {MINUS}
                        {formatMoney(r.amount)}
                      </td>
                      {/* VAT: REAL wire field (server-DERIVED round2(amount × 7/107)), never client math. */}
                      <td style={{ ...td, textAlign: "right", color: "var(--text-2)" }} className="num">
                        {formatMoney(r.vat)}
                      </td>
                      {/* date: REAL note_date/created_at (UTC), em-dash on missing/invalid. */}
                      <td style={{ ...td, color: "var(--text-2)" }} className="num">
                        {date || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                      </td>
                      {/* status: REAL stored status (honest gap: never flipped on approve). */}
                      <td style={td}>
                        <StatusBadge kind={kind} label={statusLabel(kind)} />
                      </td>
                      {/* action: approved -> print; else -> approve (POST /ar/cn/{id}/approve). */}
                      <td style={{ ...td, textAlign: "right" }}>
                        {kind === "approved" ? (
                          <Btn kind="ghost" size="sm" icon="print" onClick={() => print(r)}>
                            {t("common.print")}
                          </Btn>
                        ) : (
                          <Btn kind="soft" size="sm" icon="check" onClick={() => approve(r)}>
                            {t("common.approve")}
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
