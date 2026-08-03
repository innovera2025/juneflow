/*
 * SubconHandover — the printable work-delivery & acceptance certificate, ported from
 * pototype/subcon-accept2.jsx SubconHandover (L245-311). Route subcon.handover
 * (registry EXTRA_ROUTES, file subcon-accept2.jsx, mod "subcon"). A read-only
 * certificate reached from the subcon.accept header ("delivery docs") action: a single
 * centered card with the doc header, a 2-column meta grid, the accepted-periods table
 * with its money summary (total / retention / net), the warranty note, and the three
 * signature blocks.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb + title + subtitle, the
 * back-to-periods + print header actions, the maxWidth-760 card, the brand-underlined
 * doc header, the 6-row meta grid, the 4-column accepted-periods table + its 3-row
 * foot, the info-soft warranty note (with the partial-doc warning), and the 3-column
 * signature grid are the prototype's. Back navigates subcon.accept with { wo } exactly
 * like the prototype; print raises the prototype's toast (no server print in scope).
 *
 * Data (rule 3): the contract header is GET /subcon-contracts (useSubconContractList),
 * resolved from the route's `wo` (the contract `no`) to a contract row — there is no
 * single-contract endpoint, so the list is the header source (identical to
 * subcon-accept.tsx). The accepted periods are GET /subcon-contracts/{id}/periods
 * (useContractPeriods) narrowed to status ∈ {passed, paid} via acceptedPeriods. The
 * subcontractor NAME resolves from vendor_id via GET /vendors; the project NAME from
 * project_id via GET /projects. Every derivation (accepted narrowing / accepted value /
 * retention held / method) is the unit-tested pure logic in subcon-accept-rows.ts (G3).
 *
 * money = NONE (read-only certificate). No mutation, no POST. The displayed total /
 * retention / net are pure client arithmetic over already-server-owned values
 * (acceptedValue + retentionHeld, both unit-tested) — no new money path, no server
 * compute added.
 *
 * WIRE GAPS (reported honestly, never fabricated) — the contractWire carries no
 * po/scope and the enriched periodWire carries no acceptance date or per-period work
 * label (subcon.ts enrichPeriodRow), so:
 *   - fieldPoRef (PO ref): no `po` column -> em-dash.
 *   - fieldScope + the subtitle scope (work scope): no `scope` column -> em-dash
 *     (the same gap subcon-accept.tsx em-dashes in its subtitle).
 *   - colAcceptDate (acceptance date): acceptance.signed_at is not joined into the
 *     periods wire -> em-dash every accepted row.
 *   - colDelivered (delivered-item label): no per-period work label on the wire, and
 *     the "period {seq}" ordinal has no i18n key (B-116) -> em-dash. colPeriod (seq) is REAL.
 *   - REAL: vendor name, project name, fieldMethod (derived from periods[].basis), the
 *     seq + value cells, and the whole money summary (total/retention/net).
 *
 * i18n (rule 2): every string is a subcon.* / common.* dict key (t). The retention
 * label carries {pct}; the partial-doc warning carries {n}/{count} — the same .replace()
 * contract the sibling subcon screens use; the warn / middot / baht glyphs are baked
 * into the dict values byte-for-byte and are never re-emitted here. The "−" (U+2212) retention prefix,
 * the "·" (U+00B7) subtitle separator, and the ":" meta colon are language-invariant
 * symbols (mirrors subcon-accept.tsx). No Thai literal sits in this source. Tokens back
 * every colour (rule 6).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { useProjects } from "../../shell/use-shell-data";
import {
  toContractRow,
  toVendorRef,
  vendorNameById,
  projectNameById,
  type ContractRow,
} from "./subcon-rows";
import {
  toPeriodRow,
  deriveMethod,
  acceptedPeriods,
  acceptedValue,
  retentionHeld,
  formatMoney,
  type PeriodRow,
} from "./subcon-accept-rows";
import { useSubconContractList, useContractPeriods } from "./use-subcon";

const DASH = "—";
/** Language-invariant retention-deduct prefix (subcon-accept2.jsx L288, U+2212). */
const MINUS = "−";
/** The three signature blocks, in the prototype's order (L299). */
const SIG_KEYS: readonly DictKey[] = [
  "subcon.sigDeliverer",
  "subcon.sigInspector",
  "subcon.sigApprover",
];

/**
 * The i18n label key for a period method basis (subcon-accept.jsx SUBC_METHOD
 * L44-49; the meta grid shows only the label, so this is the label-only slice of
 * subcon-accept.tsx's methodMeta). Unknown/empty basis -> undefined (em-dash).
 */
function methodLabelKey(basis: string): DictKey | undefined {
  switch (basis) {
    case "percent":
      return "subcon.methodPercent";
    case "distance":
      return "subcon.methodDistance";
    case "unit":
      return "subcon.methodUnit";
    case "milestone":
      return "subcon.methodMilestone";
    default:
      return undefined;
  }
}

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

export function SubconHandover() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const contractsQ = useSubconContractList();
  const vendorQ = useVendorList();
  const projectsQ = useProjects();

  const contracts = useMemo<ContractRow[]>(
    () => (contractsQ.data ?? []).map(toContractRow),
    [contractsQ.data],
  );
  const vendorNames = useMemo(
    () => vendorNameById((vendorQ.data ?? []).map(toVendorRef)),
    [vendorQ.data],
  );
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  // The active contract: the route's `wo` param (the contract `no`) resolved to a row,
  // falling back to the first contract (subcon-accept2.jsx L246 SUBC_CONTRACT).
  const paramWo = typeof ctx.params.wo === "string" ? ctx.params.wo : "";
  const selectedNo = paramWo || contracts[0]?.no || "";
  const contract = contracts.find((c) => c.no === selectedNo) ?? contracts[0];
  const contractId = contract?.id ?? "";

  const periodsQ = useContractPeriods(contractId);
  const periods = useMemo<PeriodRow[]>(() => (periodsQ.data ?? []).map(toPeriodRow), [periodsQ.data]);

  // Empty / not-yet-loaded contract catalogue — the header still renders (fidelity).
  if (!contract) {
    return (
      <Page
        breadcrumbs={[t("subcon.subcontractor"), t("subcon.handoverDoc")]}
        title={t("subcon.handoverTitle")}
      >
        <Card>
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
          </div>
        </Card>
      </Page>
    );
  }

  const vendorName = vendorNames.get(contract.vendorId) ?? "";
  const projectName = projectNames.get(contract.projectId) ?? "";
  const methodKey = methodLabelKey(deriveMethod(periods));

  // Accepted (passed|paid) periods = the certificate body rows + the money summary.
  const accepted = acceptedPeriods(periods);
  const acceptedVal = acceptedValue(periods);
  const retention = retentionHeld(acceptedVal, contract.retentionPct);
  const net = acceptedVal - retention;
  // Partial-doc warning when not every period is accepted (subcon-accept2.jsx L250/295).
  const isPartial = accepted.length !== periods.length;

  // The 6 meta rows (label key -> value). po/scope are contract-wire gaps -> em-dash;
  // method is derived (em-dash when there are no periods yet).
  const metaRows: ReadonlyArray<readonly [DictKey, string]> = [
    ["subcon.fieldWoNo", contract.no],
    ["subcon.fieldPoRef", DASH],
    ["subcon.subcontractor", vendorName || DASH],
    ["subcon.fieldProject", projectName || DASH],
    ["subcon.fieldScope", DASH],
    // The prototype meta label (subcon-accept2.jsx L264) is subcon.colMethod — the same
    // key the sibling acceptance table header uses (subcon-accept.jsx L89), NOT the
    // create-form's subcon.fieldMethod (whose value carries a trailing word the doc
    // meta label omits).
    ["subcon.colMethod", methodKey ? t(methodKey) : DASH],
  ];

  return (
    <Page
      breadcrumbs={[t("subcon.subcontractor"), t("subcon.handoverDoc")]}
      title={t("subcon.handoverTitle")}
      subtitle={`${contract.no} · ${vendorName || DASH} · ${DASH}`}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn
            kind="outline"
            size="md"
            icon="chevL"
            onClick={() => ctx.navigate("subcon.accept", { wo: contract.no })}
          >
            {t("subcon.backToPeriods")}
          </Btn>
          <Btn
            kind="primary"
            size="md"
            icon="print"
            onClick={() => ctx.notify(t("subcon.toastPrint"))}
          >
            {t("common.print")}
          </Btn>
        </div>
      }
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Card>
          {/* doc header (brand-underlined) */}
          <div
            style={{
              textAlign: "center",
              paddingBottom: 16,
              borderBottom: "2px solid var(--brand)",
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>
              {t("subcon.docTitle")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              {t("subcon.docSubtitle")}
            </div>
          </div>

          {/* 2-column meta grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 24px",
              fontSize: 12.5,
              marginBottom: 18,
            }}
          >
            {metaRows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "var(--text-3)", minWidth: 100 }}>{t(k)}:</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* accepted-periods table + money summary */}
          {periodsQ.isLoading ? (
            <div style={{ marginBottom: 16 }}>
              {[0, 1, 2].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 40,
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(50)}>{t("subcon.colPeriod")}</th>
                  <th scope="col" style={th()}>{t("subcon.colDelivered")}</th>
                  <th scope="col" style={th(110)}>{t("subcon.colAcceptDate")}</th>
                  <th scope="col" style={th(120, true)}>{t("subcon.colValueBaht")}</th>
                </tr>
              </thead>
              <tbody>
                {accepted.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                      <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                    </td>
                  </tr>
                ) : (
                  accepted.map((p) => (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 700 }} className="num">
                        {p.seq}
                      </td>
                      {/* delivered-item work label: no wire -> em-dash */}
                      <td style={td}>{DASH}</td>
                      {/* acceptance date: not joined into the periods wire -> em-dash */}
                      <td style={td} className="num">{DASH}</td>
                      {/* value: real (formatMoney over the period amount) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(p.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--surface-2)" }}>
                  <td colSpan={3} style={{ ...td, fontWeight: 700 }}>{t("subcon.totalAccepted")}</td>
                  <td
                    style={{ ...td, textAlign: "right", fontWeight: 800, color: "var(--brand)" }}
                    className="num"
                  >
                    {formatMoney(acceptedVal)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} style={{ ...td, color: "var(--text-2)" }}>
                    {t("subcon.retentionDeduct").replace("{pct}", String(contract.retentionPct))}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--danger)" }} className="num">
                    {MINUS}
                    {formatMoney(retention)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} style={{ ...td, fontWeight: 700 }}>{t("subcon.netPayable")}</td>
                  <td
                    style={{ ...td, textAlign: "right", fontWeight: 800, color: "var(--ok)" }}
                    className="num"
                  >
                    {formatMoney(net)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* warranty + retention note */}
          <div
            style={{
              padding: 12,
              background: "var(--info-soft)",
              borderRadius: 9,
              fontSize: 11.5,
              color: "var(--text-2)",
              lineHeight: 1.6,
              marginBottom: 20,
            }}
          >
            <b>{t("subcon.conditionLabel")}</b> {t("subcon.conditionText")}
            {isPartial && (
              <div style={{ marginTop: 6, color: "var(--warn)", fontWeight: 600 }}>
                {t("subcon.partialWarn")
                  .replace("{n}", String(accepted.length))
                  .replace("{count}", String(periods.length))}
              </div>
            )}
          </div>

          {/* signatures */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 20 }}>
            {SIG_KEYS.map((k) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ height: 50, borderBottom: "1px dotted var(--text-3)", marginBottom: 6 }} />
                <div style={{ fontSize: 11, color: "var(--text-2)" }}>{t(k)}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                  {t("subcon.sigDateLine")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
