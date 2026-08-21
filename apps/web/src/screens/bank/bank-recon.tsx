/*
 * BankReconciliation — the Bank Reconciliation (krathob-yod) screen, ported from
 * pototype/bank.jsx BankReconciliation (L83-156). Route bank.recon (docs/extract/
 * NAV-ROUTES.md L80, component BankReconciliation, section "bank"), visual-gate
 * reference tests/visual/reference/gallery/g2/15-s.jpg.
 *
 * Design fidelity (Juneflow §0): the three-part breadcrumb, the title/subtitle, the
 * import + close-reconciliation header actions, the 4-card MiniKpi strip, the statement
 * header (period · row count), and the 6-column line table (checkbox · date · statement
 * line · amount · matched-doc · status) are the prototype's.
 *
 * Data: GET /bank/statements (recon KPIs) + GET /bank/statements/{id}/lines per
 * statement (use-bank.ts), via the generated client. The seed models one statement per
 * line all sharing a period, so the view aggregates the newest period's statements back
 * into the prototype's single-statement recon table (recon-rows.ts: activePeriod +
 * reconKpis, unit-tested G3).
 *
 * The prototype's per-line match was a DECORATIVE hand-toggle; here it is REAL: each
 * UNMATCHED line carries the server's F-BANK1 `suggestions` (exact-amount + date-window
 * auto-match). The "match" affordance opens a picker of that line's suggestions; a
 * confirm fires POST /bank/lines/{id}/match (manual confirm), then the list re-queries
 * and the line flips to matched.
 *
 *   HONEST GAPS (em-dashed, never fabricated) — the statement wire (bank.ts):
 *   - `book_balance` (book balance) + `difference` are honest null (no ledger
 *     cash-balance source) -> both KPI values em-dash; the difference sub still shows
 *     the REAL unmatched count.
 *   - `bank_balance` (bank balance) is the SIGNED sum of the period's line movements — real,
 *     but a net movement, NOT a full closing balance, so it will not equal the
 *     prototype's illustrative 18.42 M.
 *   - a matched line's linked-doc ref em-dashes for a pv/rv (no doc-number) or an RV with
 *     no seeded row (matched_doc null); a cheque match shows its real no.
 *   - import is REAL since this round (that "not implemented" note was stale — the API
 *     registers 7 ops, import at bank.ts:1207 and reconcile at :1223). The header button
 *     opens a hidden file input, reads the file as text and posts it; the handler parses
 *     CSV itself, so no object storage is involved. The prototype's dropzone modal and
 *     its fabricated "42 lines / 38 matched" summary are NOT ported — none of that copy
 *     has a key, and the real counts arrive in the refreshed table (B-421).
 *   - close-reconciliation stays a client-intent toast ON PURPOSE. It LOCKS the period
 *     and the prototype guards it with a confirm dialog whose copy has no key, so wiring
 *     it today would mean locking the books unconfirmed or inventing Thai (B-421).
 *   - the row checkbox is presentational (bulk-reconcile is not wired), checked=matched.
 *   - an unmatched line with NO server suggestion shows no match affordance (there is no
 *     arbitrary-doc manual picker in scope) — it stays unmatched.
 *
 * i18n: every string is a recon-strings.json phrase (tp) or an existing DICT key
 * (t: common.status). Missing keys are flagged (recon-strings.json._missing). Tokens
 * back every colour. NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useRef } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toReconStatement,
  toReconLine,
  activePeriodStatements,
  reconKpis,
  sortLinesByDateDesc,
  matchBodyFor,
  formatMillions,
  formatSignedMoney,
  formatDate,
  amountColor,
  type ReconLine,
  type DocRef,
} from "./recon-rows";
import {
  useBankStatements,
  useBankStatementLinesMulti,
  useMatchBankLine,
  useImportStatement,
} from "./use-bank";
import { formatMoney as formatDocMoney } from "./cheque-rows";
import reconStrings from "./recon-strings.json" with { type: "json" };

const DASH = "—";

/** Server/browser error message, if the error carries one (mirrors wo-detail). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

const P = (k: keyof typeof reconStrings): PhraseKey => reconStrings[k] as PhraseKey;

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

/** MiniKpi card, inlined from ds.jsx MiniKpi (value + unit + sub, same as ap-billing). */
function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** A one-line label for an auto-match / matched doc ("PV · ref" or "PV · —"). */
function docLabel(doc: DocRef): string {
  const type = doc.type.toUpperCase();
  return `${type} · ${doc.ref || DASH}`;
}

/**
 * The per-line match picker (real POST /bank/lines/{id}/match). Opened for an unmatched
 * line that carries F-BANK1 suggestions; each candidate has a confirm affordance. On
 * success the modal closes and the statements + lines re-query (the line flips matched).
 */
function LineMatchModal({
  line,
  labels,
  onClose,
}: {
  line: ReconLine;
  labels: { confirm: string; close: string };
  onClose: () => void;
}) {
  const match = useMatchBankLine();
  const { notify } = useShellCtx();

  const confirm = (doc: DocRef) => {
    const body = matchBodyFor(doc);
    if (!body.pv_id && !body.cheque_id && !body.rv_id) return; // guard unknown type
    match.mutate(
      { lineId: line.id, body },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          const message =
            typeof err === "object" && err !== null && "message" in err
              ? String((err as { message?: unknown }).message ?? "")
              : "";
          notify(message || DASH, "danger");
        },
      },
    );
  };

  return (
    <div>
      {/* The statement line being matched (context header). */}
      <div style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 9, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{line.description}</div>
        <div className="num" style={{ fontSize: 12, color: amountColor(line.amount), fontWeight: 700, marginTop: 2 }}>
          {formatSignedMoney(line.amount)}
        </div>
      </div>

      {line.suggestions.map((doc) => (
        <div
          key={`${doc.type}:${doc.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 9,
            marginBottom: 8,
            background: "var(--surface)",
          }}
        >
          <Icon name="arrowR" size={14} color="var(--text-3)" />
          <span className="num" style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
            {docLabel(doc)}
          </span>
          <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>
            {formatDocMoney(doc.amount)}
          </span>
          <Btn kind="primary" size="sm" icon="check" onClick={() => confirm(doc)} disabled={match.isPending}>
            {labels.confirm}
          </Btn>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {labels.close}
        </Btn>
      </div>
    </div>
  );
}

export function BankReconciliation() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const statementsQ = useBankStatements();
  const statements = useMemo(
    () => (statementsQ.data ?? []).map(toReconStatement),
    [statementsQ.data],
  );
  const active = useMemo(() => activePeriodStatements(statements), [statements]);
  const kpis = useMemo(() => reconKpis(active.statements), [active.statements]);

  const statementIds = useMemo(() => active.statements.map((s) => s.id), [active.statements]);
  const linesQ = useBankStatementLinesMulti(statementIds);
  const lines = useMemo(
    () => sortLinesByDateDesc(linesQ.rows.map(toReconLine)),
    [linesQ.rows],
  );

  const loading = statementsQ.isLoading || linesQ.isLoading;

  /**
   * Statement import. The file never leaves the browser as a file: FileReader turns
   * it into text and the text is the request body (the handler parses CSV or
   * `lines[]` itself). The input is reset after every pick so choosing the SAME file
   * twice still fires a change event — otherwise a failed import could not be retried
   * without picking something else first.
   */
  const fileRef = useRef<HTMLInputElement>(null);
  const importM = useImportStatement();
  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => ctx.notify(DASH, "danger");
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (text.trim() === "") return;
      importM.mutate(text, {
        onSuccess: () => ctx.notify(tp(P("importToast"))),
        onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
      });
    };
    reader.readAsText(file);
  };

  const openMatch = (line: ReconLine) => {
    ctx.openModal({
      title: tp(P("matchModalTitle")),
      subtitle: line.description,
      icon: "link",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <LineMatchModal
          line={line}
          labels={{ confirm: tp(P("matchConfirmBtn")), close: tp(P("closeBtn")) }}
          onClose={close}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), tp(P("crumbModule")), tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Import — REAL since this round. The handler takes CSV TEXT in the JSON
              body (bank.ts:978), so the browser reads the chosen file and posts it;
              no object storage is involved and nothing waits on B-333.

              WHY A BARE FILE INPUT AND NOT THE PROTOTYPE'S DROPZONE MODAL: that modal
              (real-forms.jsx RFBankImport) is drag-drop copy plus a fabricated result
              summary — "42 lines, 38 auto-matched" is hardcoded in the prototype, and
              none of its phrases exist in i18n-full.json. Porting it would mean
              inventing Thai. A hidden input adds no visible copy and no pixels, and
              the real counts land in the refreshed table. The modal is B-421.

              The toast is the SAME phrase this button already fired, unchanged. It is
              really the prototype modal's subtitle rather than a success line; a
              proper one has no key either (B-421). What changed is that it now fires
              only after a 2xx. */}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            style={{ display: "none" }}
            onChange={onFilePicked}
          />
          <Btn
            kind="outline"
            size="md"
            icon="upload"
            disabled={importM.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {tp(P("importBtn"))}
          </Btn>
          {/* Close-reconciliation: the endpoint exists (bank.ts:1223) but stays a
              client-intent toast on purpose. It LOCKS the period — bank_statement
              .locked = true for every statement in it, after which a back-dated match
              is refused 409 — and the prototype puts a confirm dialog in front of it
              whose copy has no key. Wiring it now would either lock the books with no
              confirmation or invent Thai; both are worse than the honest stub. B-421. */}
          <Btn kind="primary" size="md" icon="check" onClick={() => ctx.notify(tp(P("reconcileToast")))}>
            {tp(P("reconcileBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): bank balance is real (Σ signed movement); book balance +
          difference are honest null; matched count/pct are real. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={tp(P("kpiBankLabel"))}
          value={formatMillions(kpis.bankBalance)}
          unit={tp(P("unitM"))}
          sub={tp(P("subBank"))}
          tone="var(--info)"
          icon="ledger"
        />
        <MiniKpi label={tp(P("kpiBookLabel"))} value={DASH} sub={tp(P("subBook"))} tone="var(--brand)" icon="ledger" />
        <MiniKpi
          label={tp(P("kpiDiffLabel"))}
          value={DASH}
          sub={`${kpis.unmatchedCount} ${tp(P("subDiffUnmatched"))}`}
          tone="var(--warn)"
          icon="warn"
        />
        <MiniKpi
          label={tp(P("kpiMatchedLabel"))}
          value={`${kpis.matchedCount}/${kpis.lineCount}`}
          sub={kpis.matchedPct == null ? DASH : `${kpis.matchedPct}%`}
          tone="var(--ok)"
          icon="check"
        />
      </div>

      <Card pad={0}>
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {tp(P("statementPrefix"))} {active.period || DASH}
          </div>
          {/* Real line count; the prototype's import-timestamp is a mock (no wire field). */}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {kpis.lineCount} {tp(P("rowsUnit"))}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
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
                <th scope="col" style={th(28)}>
                  {/* Presentational (bulk-reconcile is not wired), checked=matched. */}
                  <input type="checkbox" readOnly />
                </th>
                <th scope="col" style={th(100)}>{tp(P("thDate"))}</th>
                <th scope="col" style={th()}>{tp(P("thDesc"))}</th>
                <th scope="col" style={th(130, true)}>{tp(P("thAmount"))}</th>
                <th scope="col" style={th(160)}>{tp(P("thMatch"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: "1px solid var(--border)",
                    background: r.matched ? "transparent" : "var(--warn-soft)",
                  }}
                >
                  <td style={td}>
                    <input type="checkbox" readOnly checked={r.matched} />
                  </td>
                  <td style={{ ...td, color: "var(--text-3)" }}>{formatDate(r.lineDate) || DASH}</td>
                  <td style={td}>{r.description || DASH}</td>
                  <td
                    style={{ ...td, textAlign: "right", fontWeight: 700, color: amountColor(r.amount) }}
                    className="num"
                  >
                    {formatSignedMoney(r.amount)}
                  </td>
                  <td style={td}>
                    {r.matched ? (
                      <span className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>
                        {r.matchedDoc?.ref || DASH}
                      </span>
                    ) : r.suggestions.length > 0 ? (
                      <Btn kind="soft" size="sm" icon="link" onClick={() => openMatch(r)}>
                        {tp(P("matchBtn"))}
                      </Btn>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                    )}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: r.matched ? "var(--ok-soft)" : "var(--warn-soft)",
                        color: r.matched ? "var(--ok)" : "var(--warn)",
                      }}
                    >
                      {r.matched ? tp(P("statusMatched")) : tp(P("statusUnmatched"))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
