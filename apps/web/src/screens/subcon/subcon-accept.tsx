/*
 * SubconAccept — the subcontractor period-acceptance money-flow screen (work
 * periods & acceptance), ported from pototype/subcon-accept2.jsx SubconAccept (L5-142). Route
 * subcon.accept (registry EXTRA_ROUTES, file subcon-accept2.jsx, mod "subcon"). The
 * Wave-2 acceptance screen: a contract's work periods, the acceptance form (inspect
 * -> approve-payment), and the delivered-work KPIs.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb + title (with the
 * method chip) + subtitle, the contract selector + "delivery docs" header actions,
 * the 4-card MiniKpi strip, the method-conditional tracker card, the 7-column period
 * table with its per-status action control, and the DMS card are the prototype's.
 * Selecting a contract navigates subcon.accept with { wo } exactly like the prototype;
 * the "acceptance certificate" action navigates subcon.handover.
 *
 * Data (rule 3): the contract list is GET /subcon-contracts (reusing
 * useSubconContractList); the periods are GET /subcon-contracts/{id}/periods
 * (useContractPeriods) — resolved from the route's `wo` (the contract `no`) to the
 * contract `id`. The subcontractor NAME resolves from vendor_id via GET /vendors; the
 * project NAME from project_id via GET /projects. Pure logic (period narrowing /
 * method derivation / status mapping / KPI aggregates / cumulative markers / money)
 * lives in subcon-accept-rows.ts (unit-tested, G3).
 *
 * ACCEPT flow (B-107a): the AcceptForm sends the trigger only — inspect(pass) then
 * approve-payment (EMPTY body); the toast money is the approve-payment response.
 * %-GATE (B-107c): the prototype's hard-block "cannotAccept" modal is DROPPED — accept
 * is never blocked; the server `warning` flag drives the non-blocking advisory banner
 * below the header. Progress % is NEVER fabricated.
 *
 * WIRE GAPS (reported honestly, never fabricated) — periodWire is only
 * { id, contract_id, seq, basis, target, pct, amount, currency_code, status }; the
 * periods-list handler enriches each row with a real `defect` (META-1, P2-BE-43),
 * while the contractWire still carries NO scope/po:
 *   - subtitle scope + the WO/PO PO sub-line: no wire -> em-dash.
 *   - period detail (label), doc (GR), distance/unit `unit` label: none on the wire
 *     -> em-dash. The rejected-period DEFECT text is now REAL (row.defect).
 *   - percent tracker: the cumulative-% markers are REAL (periods[].pct), but the
 *     project's actual-progress feed is not on the wire -> no bar fill, em-dash legend.
 *   - distance/unit tracker: accSurvey/doneQty/totalQty/ratePerUnit are not on the wire
 *     -> the card shell renders with em-dash values (B-107 DEFAULT).
 *   - DMS card: there is no DMS/documents endpoint in scope -> em-dash file count +
 *     the honest empty state; upload is a toast, open-center navigates.
 *   - the re-inspect control (reinspect) has NO wire transition (rejected cannot
 *     return to delivered) -> rendered DISABLED for fidelity, wired to nothing (FLAG).
 *
 * i18n (rule 2): every string is a subcon.* / common.* dict key (t). Tokens back every
 * colour (rule 6). No Thai literal (and no baht glyph) sits in this source; the "%" /
 * "✓" quantity markers + the "·" separator are language-invariant symbols.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
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
  mapPeriodStatus,
  statusTone,
  acceptedValue,
  acceptedCount,
  pendingReviewCount,
  retentionHeld,
  cumMap,
  formatMoney,
  millionsValue,
  type PeriodRow,
  type PeriodBadge,
} from "./subcon-accept-rows";
import { useSubconContractList, useContractPeriods } from "./use-subcon";
import { AcceptForm } from "./accept-form";

const DASH = "—";
/** Language-invariant quantity markers (subcon-accept2.jsx L88/99). */
const PERCENT_SIGN = "%";
const TICK = "✓";

/** Period method metadata (subcon-accept.jsx SUBC_METHOD L44-49): label key + icon + tone. */
function methodMeta(m: string): { labelKey: DictKey; icon: IconName; tone: string } | undefined {
  switch (m) {
    case "percent":
      return { labelKey: "subcon.methodPercent", icon: "trend", tone: "var(--brand)" };
    case "distance":
      return { labelKey: "subcon.methodDistance", icon: "ruler", tone: "var(--ok)" };
    case "unit":
      return { labelKey: "subcon.methodUnit", icon: "building", tone: "var(--info)" };
    case "milestone":
      return { labelKey: "subcon.methodMilestone", icon: "flag", tone: "var(--warn)" };
    default:
      return undefined;
  }
}

/** The i18n label key for each acceptance badge (PERIOD_STATE, subcon-accept.jsx L50-53). */
const BADGE_LABEL: Record<PeriodBadge, DictKey> = {
  notReached: "subcon.statusNotReached",
  requested: "subcon.statusRequested",
  accepted: "subcon.kpiAccepted",
  rejected: "subcon.rejectBtn",
};

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

/** Contract-selector <select> style (subcon-accept2.jsx Dropdown, native port). */
const selectStyle: CSSProperties = {
  width: 240,
  height: 34,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-md)",
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the optional unit span). */
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
  sub?: string;
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
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}>
          {label}
        </span>
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

/** StatusBadge (ds.jsx L91-108, size sm), tone from the mapped period display. */
function StatusBadge({ tone, label }: { tone: Parameters<typeof statusTone>[0]; label: string }) {
  const s = statusTone(tone);
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

export function SubconAccept() {
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

  const subconName = (id: string): string => vendorNames.get(id) ?? "";

  // The active contract: the route's `wo` param (the contract `no`) resolved to a row,
  // falling back to the first contract (subcon-accept2.jsx L6-7 SUBC_CONTRACT).
  const paramWo = typeof ctx.params.wo === "string" ? ctx.params.wo : "";
  const selectedNo = paramWo || contracts[0]?.no || "";
  const contract = contracts.find((c) => c.no === selectedNo) ?? contracts[0];
  const contractId = contract?.id ?? "";

  const periodsQ = useContractPeriods(contractId);
  const periods = useMemo<PeriodRow[]>(() => (periodsQ.data ?? []).map(toPeriodRow), [periodsQ.data]);

  const method = deriveMethod(periods);
  const meta = methodMeta(method);

  // The non-blocking %-gate advisory (B-107c) — raised strictly from the server
  // `warning` flag returned by the accept flow; never blocks, never fabricates a %.
  const [advisory, setAdvisory] = useState(false);

  const openAccept = (period: PeriodRow) => {
    if (!contract) return;
    ctx.openModal({
      title: t("subcon.acceptModalTitle").replace("{no}", String(period.seq)),
      subtitle: `${contract.no} · ${subconName(contract.vendorId) || DASH}`,
      iconTone: "var(--ok)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <AcceptForm
          onClose={close}
          contractId={contract.id}
          periodId={period.id}
          periodSeq={period.seq}
          periodBasis={period.basis}
          periodAmount={period.amount}
          retentionPct={contract.retentionPct}
          onWarning={setAdvisory}
        />
      ),
    });
  };

  // Empty / not-yet-loaded contract catalogue — the header still renders (fidelity).
  if (!contract) {
    return (
      <Page
        breadcrumbs={[t("subcon.subcontractor"), t("subcon.acceptTitle")]}
        title={t("subcon.acceptTitle")}
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

  const projectName = projectNames.get(contract.projectId) ?? "";
  const acceptedVal = acceptedValue(periods);
  const cumPoints = cumMap(periods);

  return (
    <Page
      breadcrumbs={[t("subcon.subcontractor"), t("subcon.acceptTitle")]}
      title={
        meta ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {t("subcon.acceptTitle")}
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: meta.tone,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon name={meta.icon} size={14} />
              {t(meta.labelKey)}
            </span>
          </span>
        ) : (
          t("subcon.acceptTitle")
        )
      }
      subtitle={`${contract.no} · ${subconName(contract.vendorId) || DASH} · ${DASH}`}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedNo}
            onChange={(e) => ctx.navigate("subcon.accept", { wo: e.target.value })}
            style={selectStyle}
          >
            {contracts.map((c) => (
              <option key={c.id} value={c.no}>
                {`${c.no} · ${subconName(c.vendorId) || DASH}`}
              </option>
            ))}
          </select>
          <Btn
            kind="outline"
            size="md"
            icon="doc"
            onClick={() => ctx.navigate("subcon.handover", { wo: selectedNo })}
          >
            {t("subcon.handoverDoc")}
          </Btn>
        </div>
      }
    >
      {/* %-gate advisory (non-blocking, server-warning driven) */}
      {advisory && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "var(--warn-soft)",
            borderRadius: 9,
            marginBottom: 16,
            fontSize: 12.5,
            color: "var(--warn)",
          }}
        >
          <Icon name="warn" size={16} color="var(--warn)" />
          <span>{t("subcon.thresholdNotMet")}</span>
        </div>
      )}

      {/* KPI strip (4) — all REAL, derived from the period rows */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <MiniKpi
          label={t("subcon.kpiContractValue")}
          value={millionsValue(contract.value)}
          unit={t("subcon.unitMBaht")}
          tone="var(--brand)"
          icon="doc"
        />
        <MiniKpi
          label={t("subcon.kpiAccepted")}
          value={formatMoney(acceptedVal)}
          unit={t("subcon.unitBaht")}
          sub={t("subcon.kpiPeriodsCount")
            .replace("{n}", String(acceptedCount(periods)))
            .replace("{count}", String(periods.length))}
          tone="var(--ok)"
          icon="check"
        />
        <MiniKpi
          label={t("subcon.kpiRetentionHeld")}
          value={formatMoney(retentionHeld(acceptedVal, contract.retentionPct))}
          unit={t("subcon.unitBaht")}
          sub={t("subcon.kpiRetentionSub").replace("{pct}", String(contract.retentionPct))}
          tone="var(--info)"
          icon="paperclip"
        />
        <MiniKpi
          label={t("subcon.kpiPendingAccept")}
          value={String(pendingReviewCount(periods))}
          sub={t("subcon.kpiPendingSub")}
          tone="var(--warn)"
          icon="clock"
        />
      </div>

      {/* percent tracker — real cumulative-% markers; the actual-progress feed is not
          on the wire (never fabricated), so there is no bar fill + an em-dash legend. */}
      {method === "percent" && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="trend" size={16} color="var(--brand)" />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t("subcon.progressRefTitle")}</span>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
              {projectName || DASH}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 30,
              background: "var(--surface-3)",
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 8,
            }}
          >
            {cumPoints.map((pt) => (
              <div
                key={pt.seq}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pt.cum}%`,
                  width: 2,
                  background: "rgba(148,163,184,.7)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
            <span className="num" style={{ color: "var(--brand)", fontWeight: 700 }}>
              {t("subcon.actualProgress").replace("{pct}", DASH)}
            </span>
            <span className="num" style={{ color: "var(--text-3)" }}>{t("subcon.progressLegend")}</span>
          </div>
        </Card>
      )}

      {/* distance/unit tracker — the shell for fidelity; every metric is a wire gap
          (accSurvey/doneQty/totalQty/ratePerUnit), so the values em-dash (B-107 DEFAULT). */}
      {(method === "distance" || method === "unit") && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="ruler" size={16} color="var(--ok)" />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>
              {t(method === "unit" ? "subcon.progressByUnit" : "subcon.progressByDistance")}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }} className="num">
              {DASH}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 30,
              background: "var(--surface-3)",
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
            <span className="num" style={{ color: "var(--ok)", fontWeight: 700 }}>{DASH}</span>
            <span className="num" style={{ color: "var(--text-3)" }}>{DASH}</span>
          </div>
        </Card>
      )}

      {/* Period acceptance table */}
      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
          {t("subcon.periodFlowTitle")}
        </div>
        {periodsQ.isLoading ? (
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
                <th style={th(50)}>{t("subcon.colPeriod")}</th>
                <th style={th()}>{t("subcon.colDetail")}</th>
                <th style={th(110, true)}>
                  {method === "distance" || method === "unit"
                    ? t("subcon.colQty")
                    : method === "percent"
                      ? PERCENT_SIGN
                      : t("subcon.colMilestone")}
                </th>
                <th style={th(120, true)}>{t("subcon.colValueBaht")}</th>
                <th style={th(120)}>{t("subcon.colDoc")}</th>
                <th style={th(130)}>{t("common.status")}</th>
                <th style={th(110, true)}>{t("subcon.colAccept")}</th>
              </tr>
            </thead>
            <tbody>
              {periods.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                  </td>
                </tr>
              ) : (
                periods.map((p) => {
                  const disp = mapPeriodStatus(p.status);
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderTop: "1px solid var(--border)",
                        background: disp.rowWarn ? "var(--warn-soft)" : "transparent",
                      }}
                    >
                      <td style={{ ...td, fontWeight: 700 }} className="num">
                        {p.seq}
                      </td>
                      {/* detail: the period label is a wire gap (em-dash); the
                          rejected-period DEFECT text is REAL (row.defect, META-1) and
                          renders below as the prototype's red sub-line (L88). */}
                      <td style={{ ...td, color: "var(--text-3)" }}>
                        {DASH}
                        {p.status === "rejected" && p.defect && (
                          <div style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 2 }}>
                            {t("subcon.defectLabel").replace("{value}", p.defect)}
                          </div>
                        )}
                      </td>
                      {/* qty / % / milestone marker per basis */}
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        {p.basis === "distance" || p.basis === "unit"
                          ? `${formatMoney(p.target)} ${DASH}`
                          : p.basis === "percent"
                            ? `${formatMoney(p.pct)}${PERCENT_SIGN}`
                            : TICK}
                      </td>
                      {/* value: real (formatMoney) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(p.amount)}
                      </td>
                      {/* doc (GR): no wire -> em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }}>
                        <span style={{ fontSize: 11 }}>{DASH}</span>
                      </td>
                      <td style={td}>
                        <StatusBadge tone={disp.tone} label={t(BADGE_LABEL[disp.badge])} />
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {disp.action === "accept" ? (
                          <Btn kind="primary" size="sm" onClick={() => openAccept(p)}>
                            {t("subcon.colAccept")}
                          </Btn>
                        ) : disp.action === "cert" ? (
                          <Btn
                            kind="ghost"
                            size="sm"
                            icon="eye"
                            onClick={() => ctx.navigate("subcon.handover", { wo: contract.no })}
                          >
                            {t("subcon.acceptCertBtn")}
                          </Btn>
                        ) : disp.action === "reinspect" ? (
                          // FLAG (B-107 DEFAULT): rejected has no wire path back to
                          // delivered — the control is kept for fidelity but DISABLED.
                          <Btn kind="soft" size="sm" icon="sync" disabled>
                            {t("subcon.reinspectBtn")}
                          </Btn>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("subcon.waitForPeriod")}</span>
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

      {/* DMS card — no DMS/documents endpoint in scope: em-dash file count + the honest
          empty state; upload toasts, open-center navigates. Info line is real (contract no). */}
      <Card pad={0} style={{ marginTop: 16 }}>
        <div
          style={{
            padding: "13px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="paperclip" size={15} color="var(--brand)" />
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t("subcon.dmsCardTitle")}</span>
          <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {t("subcon.fileCount").replace("{n}", DASH)}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Btn
              kind="ghost"
              size="sm"
              icon="upload"
              onClick={() => ctx.notify(t("subcon.uploadToast").replace("{no}", contract.no))}
            >
              {t("subcon.uploadBtn")}
            </Btn>
            <Btn kind="soft" size="sm" icon="arrowR" onClick={() => ctx.navigate("dms")}>
              {t("subcon.openDmsBtn")}
            </Btn>
          </div>
        </div>
        <div style={{ padding: 8 }}>
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
        <div
          style={{
            padding: "9px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-3)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="info" size={13} />
          {t("subcon.dmsInfoLine").replace("{no}", contract.no)}
        </div>
      </Card>
    </Page>
  );
}
