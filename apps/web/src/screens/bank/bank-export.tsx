/*
 * BankExport — the Bank File Export (sang-file-jai-ngoen) screen, ported from
 * pototype/bank.jsx BankExport (L158-253). Route bank.export (docs/extract/
 * NAV-ROUTES.md L81, component BankExport, section "bank"), visual-gate reference
 * tests/visual/reference/gallery/g2/16-s.jpg.
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb, the title/subtitle, the
 * filter + export header actions, the two-column layout (left: the ready-to-send PV
 * table; right: the Export-settings card + the Export-history card), and the settings
 * fields + lock note are the prototype's.
 *
 * Data: GET /ap/pv filtered to the export-eligible set (approved + transfer, exactly the
 * server's POST /bank/export-batch eligibility) + GET /vendors (resolve the beneficiary
 * bank/account from the payee vendor's stored bank string) — export-rows.ts (unit-tested,
 * G3). The prototype's decorative openBatchConfirm becomes a REAL POST /bank/export-batch:
 * the selected PVs are sent, the server builds the KBANK batch file (mock-first
 * FakeBankFileFormatter by default), and the returned { file_name, content, ... } is shown.
 *
 *   HONEST GAPS (em-dashed, never fabricated):
 *   - `no` (PV number) is an honest null on every pv row (pv has no doc-number column) ->
 *     the "PV no" cell em-dashes; a PV is identified here by payee + amount.
 *   - the pv wire carries no beneficiary bank/account column -> the account + bank cells
 *     are resolved from the payee vendor's free-text `bank` string (the same source the
 *     export-batch handler uses) and em-dash when the vendor has no bank.
 *   - the value shown/summed is the pv `net` (the cash the batch file pays), a real figure.
 *   - the settings-card fields are the prototype's illustrative STATIC display: the server
 *     owns the file format (env-selected, fake default) and defaults the value date, so the
 *     fields are non-interactive (matching the prototype's own static Select/Input).
 *   - the lock note is prototype copy; the current export-batch handler is a pure
 *     build+return and does NOT persist a post-export lock (flagged).
 *   - the Export-history card has no wire source (the export is stateless) -> an honest
 *     empty state, never fabricated rows.
 *   - the filter action fires a client-intent toast (no server filter).
 *
 * i18n: every string is an export-strings.json phrase (tp) or an existing DICT key
 * (t: common.cancel). Missing keys are flagged (export-strings.json._missing). Tokens
 * back every colour. NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useApPvList } from "../ap/use-ap";
import { useVendorList } from "../master/use-vendors";
import { toVendorRow } from "../master/vendor-rows";
import { useExportBankBatch } from "./use-bank";
import {
  eligibleExportPvs,
  exportSelection,
  buildExportBody,
  toExportResult,
  formatMoney,
  formatMillions,
  type ExportPv,
  type ExportResult,
} from "./export-rows";
import exportStrings from "./export-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof exportStrings): PhraseKey => exportStrings[k] as PhraseKey;

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

/**
 * A static display field (ds.jsx Field + Select/Input). The prototype's settings are
 * NON-INTERACTIVE (static <Select value>/<Input value>), so this renders a read-only
 * bordered box; `select` adds the chevron the prototype's Select shows.
 */
function StaticField({ label, value, select }: { label: string; value: string; select?: boolean }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>
        {label}
      </label>
      <div
        style={{
          height: 36,
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "var(--surface)",
          color: "var(--text)",
        }}
      >
        <span>{value}</span>
        {select && <Icon name="chevD" size={14} color="var(--text-3)" />}
      </div>
    </div>
  );
}

/** The real export-batch result view (batch file), shown in a modal after export. */
function ExportResultModal({
  result,
  labels,
  onClose,
}: {
  result: ExportResult;
  labels: { rowsUnit: string; baht: string; close: string };
  onClose: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Icon name="doc" size={16} color="var(--brand)" />
        <div style={{ flex: 1 }}>
          <div className="num" style={{ fontSize: 13, fontWeight: 700 }}>
            {result.fileName || DASH}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }} className="num">
            {result.pvCount} {labels.rowsUnit} · {formatMoney(result.totalAmount)} {labels.baht}
          </div>
        </div>
      </div>
      <pre
        className="num"
        style={{
          margin: 0,
          padding: 12,
          maxHeight: 260,
          overflow: "auto",
          fontSize: 11,
          lineHeight: 1.5,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {result.content}
      </pre>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn kind="primary" size="md" onClick={onClose}>
          {labels.close}
        </Btn>
      </div>
    </div>
  );
}

export function BankExport() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const pvQ = useApPvList();
  const vendorsQ = useVendorList();
  const exportM = useExportBankBatch();

  // vendorId -> free-text bank string (resolves the beneficiary account/bank).
  const vendorBankById = useMemo(() => {
    const map = new Map<string, string>();
    for (const raw of vendorsQ.data ?? []) {
      const v = toVendorRow(raw);
      if (v.id) map.set(v.id, v.bank);
    }
    return map;
  }, [vendorsQ.data]);

  const eligible = useMemo<ExportPv[]>(
    () => eligibleExportPvs(pvQ.data ?? [], (id) => vendorBankById.get(id) ?? ""),
    [pvQ.data, vendorBankById],
  );

  // Selection: default = all eligible (null = uninitialised -> all selected).
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selectedSet = selected ?? new Set(eligible.map((e) => e.id));
  const summary = useMemo(() => exportSelection(eligible, selectedSet), [eligible, selectedSet]);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const openResult = (result: ExportResult) => {
    ctx.openModal({
      title: tp(P("batchModalTitle")),
      subtitle: result.fileName || undefined,
      icon: "download",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <ExportResultModal
          result={result}
          labels={{ rowsUnit: tp(P("rowsUnit")), baht: tp(P("baht")), close: t("common.cancel") }}
          onClose={close}
        />
      ),
    });
  };

  const doExport = () => {
    const ids = eligible.filter((e) => selectedSet.has(e.id)).map((e) => e.id);
    if (ids.length === 0) return;
    exportM.mutate(buildExportBody(ids), {
      onSuccess: (res) => openResult(toExportResult(res as Record<string, unknown>)),
      onError: (err) => {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        ctx.notify(message || DASH, "danger");
      },
    });
  };

  const lockNote: ReactNode = (
    <>
      {tp(P("lockNotePre"))} <b>{tp(P("lockNoteBold"))}</b> {tp(P("lockNotePost"))}
    </>
  );

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), tp(P("crumbModule")), tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="filter" onClick={() => ctx.notify(tp(P("filterToast")))}>
            {tp(P("filterBtn"))}
          </Btn>
          <Btn
            kind="primary"
            size="md"
            icon="download"
            onClick={doExport}
            disabled={summary.count === 0 || exportM.isPending}
          >
            {tp(P("exportBtn"))}
          </Btn>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
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
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{tp(P("cardTitle"))}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{tp(P("cardSub"))}</div>
            </div>
            {/* Real selection summary: selected / eligible · Σ net (millions). */}
            <span style={{ fontSize: 11, color: "var(--text-3)" }} className="num">
              {tp(P("selPrefix"))} {summary.count} / {summary.total} {tp(P("selDocUnit"))} ·{" "}
              {formatMillions(summary.amount)} {tp(P("unitM"))}
            </span>
          </div>

          {pvQ.isLoading ? (
            <div style={{ padding: 20 }}>
              {[0, 1, 2, 3].map((n) => (
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
                  <th style={th(28)} />
                  <th style={th(130)}>{tp(P("thPv"))}</th>
                  <th style={th()}>{tp(P("thPayee"))}</th>
                  <th style={th(140)}>{tp(P("thAccount"))}</th>
                  <th style={th(110)}>{tp(P("thBank"))}</th>
                  <th style={th(120, true)}>{tp(P("thAmount"))}</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>
                      {/* Controlled selection — drives the export pv_ids (real). */}
                      <input type="checkbox" checked={selectedSet.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    {/* PV no: honest null on the wire -> em-dash. */}
                    <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                      {r.no || DASH}
                    </td>
                    <td style={td}>{r.payee || DASH}</td>
                    {/* account/bank: resolved from the payee vendor's bank string; else em-dash. */}
                    <td style={{ ...td, fontSize: 11.5 }} className="num">
                      {r.account || DASH}
                    </td>
                    <td style={td}>
                      {r.bank ? (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "var(--info-soft)",
                            color: "var(--info)",
                          }}
                        >
                          {r.bank}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {formatMoney(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card pad={18}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>{tp(P("settingsTitle"))}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <StaticField label={tp(P("fBank"))} value={tp(P("fBankVal"))} select />
              <StaticField label={tp(P("fDate"))} value={tp(P("fDateVal"))} />
              <StaticField label={tp(P("fFormat"))} value={tp(P("fFormatVal"))} select />
              <StaticField label={tp(P("fMemo"))} value={tp(P("fMemoVal"))} />
            </div>
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "var(--brand-soft)",
                borderRadius: 8,
                fontSize: 11,
                color: "var(--text-2)",
                lineHeight: 1.5,
              }}
            >
              <Icon name="info" size={12} color="var(--brand)" strokeWidth={1.5} />{" "}
              {lockNote}
            </div>
          </Card>

          <Card pad={18}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{tp(P("historyTitle"))}</div>
            {/* No export-history wire source (the export is stateless) -> honest empty
                state, never fabricated rows. */}
            <div style={{ padding: "18px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              {DASH}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
