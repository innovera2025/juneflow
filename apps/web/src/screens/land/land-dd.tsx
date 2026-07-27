/*
 * LandDueDiligence — the Due Diligence & buy/lease screen, ported from pototype/land2.jsx
 * LandDueDiligence (L140-275) + DealField (L277-284). Route land.dd (docs/extract/
 * NAV-ROUTES.md L20, parent `land`, prototype file land2.jsx).
 *
 * Design fidelity (§0 rule 1): the layout is the prototype's — the TypeBadge subtitle, the
 * DD checklist card (7 legal-check rows with a status control + a progress header), the
 * Cost-Center card, and the buy/lease tab card with its DealField grid + action row.
 *
 * HONEST reads / no fabrication (§0 rule 3):
 *   - DD CHECKLIST (READ): the 7 item labels are static UI structure (land.dd.check* keys).
 *     Their pass/issue/wait STATUS has NO wire (no DD-status endpoint is merged), so every
 *     row renders a NEUTRAL em-dash status — never a fabricated pass/issue — and the
 *     click-to-cycle control is honest-DISABLED (it is a mock local write, §0 rule 3). With
 *     no confirmed status, 0 of 7 checks are "passed" and the progress bar sits at 0.
 *   - DEAL TERMS: the buy tab's four price fields (total / 10% deposit / 2% transfer fee /
 *     3.3% SBT) are derived CLIENT-SIDE from a REAL plot (GET /land/plots, pickDealPlot ->
 *     dealTerms), replacing the prototype's hardcoded 'L-071' mock. The buy contract-type +
 *     transfer-appointment and the ENTIRE lease tab were hardcoded mock figures with no
 *     wire (land2.jsx L239/242/255-260), so those values render an em-dash. No plot in the
 *     register -> the deal is honest-empty (all em-dash).
 *   - COST CENTER: the selector reads REAL centers (GET /cost-centers, ccOptionsForProject)
 *     scoped to the active project; the "manage" button navigates to master.cc (nav only).
 *   - DEAL WRITES DISABLED (Wei: deal actions await backend): view-draft, make-PV (deposit /
 *     rent) and confirm-transfer / save-lease are all honest-disabled — no deal / PV /
 *     contract endpoint is merged, so no action opens a mock modal or hits a 404.
 *
 * i18n (§0 rule 2): every visible string is a land.dd.* dict key (t, minted B-153) or a
 * reuse of land.bc.root (the breadcrumb root, same land.* prototype family). CONSUME-ONLY:
 * nothing is minted here. Keys tied to unbuilt surfaces are intentionally not consumed —
 * the neutral status skips stPass/stIssue/stWait + cycleTitle, and the disabled writes skip
 * the whole PV-modal key set (pvModalTitle, pvRow[Item/Cc/Amount/...], pvToast, ...). No
 * Thai/baht literal sits in this source (B-073); tokens back every colour (§0 rule 6);
 * numeric deal values carry class `num` via DealField (§0 rule 7); loading = token
 * skeleton; no plot = honest-empty.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { TypeBadge } from "../../shell/type-badge";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { toPlotRow, formatMoney, type PlotRow } from "./land-bank-rows";
import { dealTerms, pickDealPlot, ccOptionsForProject, type DealTerms } from "./land-dd-rows";
import { useLandPlots } from "./use-land-bank";
import { useCostCenterList } from "../master/use-cost-centers";

/** The literal em-dash rendered for every value with no wire (mirrors land-bank DASH). */
const DASH = "—";

/**
 * The 7 DD checklist items, in prototype order (land2.jsx DD_ITEMS, L129-137). Each is a
 * static UI label (a land.dd.check* dict key). The prototype's per-item note is per-item
 * mock status detail (e.g. an "encumbered by BAAC" note for the mortgage row) with no wire,
 * so it is not rendered; the status is neutral (see the checklist card below).
 */
const DD_ITEM_KEYS: readonly DictKey[] = [
  "land.dd.checkDeed",
  "land.dd.checkEncumbrance",
  "land.dd.checkMortgage",
  "land.dd.checkZoning",
  "land.dd.checkEIA",
  "land.dd.checkAccessRight",
  "land.dd.checkExpropriation",
];

/** DealField, ported 1:1 from land2.jsx DealField (L277-284): label + emphasised value.
 *  `num` is applied when the value carries a digit (money terms) — never for the em-dash. */
function DealField({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className={/\d/.test(value) ? "num" : ""}
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: tone ?? (accent ? "var(--brand)" : "var(--text)"),
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Tab button, ported from land2.jsx L229-233 (active = brand fill + white). */
function TabBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: "handshake" | "doc";
  label: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12.5,
        fontWeight: 600,
        background: active ? "var(--brand)" : "transparent",
        color: active ? "#fff" : "var(--text-2)",
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

/** The 2x3 DealField grid style, ported from land2.jsx L238/L254. */
const dealGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 16,
  marginBottom: 18,
};

/** The right-aligned action row, ported from land2.jsx L246/L265. */
const dealActions: CSSProperties = { display: "flex", gap: 8, justifyContent: "flex-end" };

export function LandDueDiligence() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const plotsQ = useLandPlots();
  const projectsQ = useProjects();
  const ccQ = useCostCenterList();

  // Active project (ProjectSwitcher selection) — drives the header TypeBadge, the
  // deal-plot scoping, the cost-center scoping and the lease "recommended" hint.
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const typeKey = active?.type ?? null;
  const isSolar = typeKey === "solar";

  const [tab, setTab] = useState<"buy" | "lease">("buy");
  const [cc, setCc] = useState("");

  // The real deal plot + its client-side derived buy terms (null when the register is empty).
  const plots = useMemo<PlotRow[]>(() => (plotsQ.data ?? []).map(toPlotRow), [plotsQ.data]);
  const dealPlot = useMemo(() => pickDealPlot(plots, active?.id ?? ""), [plots, active?.id]);
  const terms = useMemo<DealTerms | null>(() => dealTerms(dealPlot), [dealPlot]);

  // Real cost centers for the active project (the inert selector the disabled make-PV binds).
  const ccOptions = useMemo(
    () => ccOptionsForProject(ccQ.data ?? [], active?.id ?? ""),
    [ccQ.data, active?.id],
  );
  const ccValue = cc || ccOptions[0]?.code || "";

  // No DD-status wire -> no check is confirmed-passed. The header reads 0/7 and the bar is 0.
  const passed = 0;
  const itemCount = DD_ITEM_KEYS.length;
  const passedPct = itemCount > 0 ? (passed / itemCount) * 100 : 0;

  /** A price term as a `num` money string, or the honest em-dash when no plot is available. */
  const money = (n: number | undefined): string => (n == null ? DASH : formatMoney(n));

  return (
    <Page
      breadcrumbs={[t("land.bc.root"), t("land.dd.title")]}
      title={t("land.dd.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {typeKey && <TypeBadge type={typeKey} size="sm" />}
          <span>{t("land.dd.subtitle")}</span>
        </span>
      }
    >
      {/* DD checklist card (READ) — labels are static; status is neutral (no wire). */}
      <Card pad={0} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t("land.dd.checklistHeader")}</div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>
              {t("land.dd.passedCount")
                .replace("{passed}", String(passed))
                .replace("{n}", String(itemCount))}
            </span>
            {/* Progress bar (ds.jsx Bar): surface-3 track + brand fill at the passed %. */}
            <div style={{ width: 120 }}>
              <div
                style={{
                  width: "100%",
                  height: 6,
                  background: "var(--surface-3)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${passedPct}%`,
                    height: "100%",
                    background: "var(--brand)",
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: "6px 18px 14px" }}>
          {plotsQ.isLoading ? (
            // Loading skeleton — token blocks, no invented copy (mirror land-bank).
            [0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  height: 44,
                  marginTop: 8,
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))
          ) : (
            DD_ITEM_KEYS.map((key, idx) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 0",
                  borderBottom:
                    idx < itemCount - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                {/* Status control — honest-DISABLED (the cycle is a mock local write) and
                    NEUTRAL (no wire): a token square with an em-dash, never a pass/issue. */}
                <button
                  type="button"
                  disabled
                  aria-label={DASH}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    flexShrink: 0,
                    background: "var(--surface-2)",
                    color: "var(--text-3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    cursor: "not-allowed",
                  }}
                >
                  {DASH}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t(key)}</div>
                </div>
                {/* Status badge — neutral em-dash (no confirmed pass/issue/wait). */}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: "var(--surface-2)",
                    color: "var(--text-3)",
                  }}
                >
                  {DASH}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Cost Center card — real centers (read) + functional manage-nav (nav only). */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "var(--brand-soft)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="ledger" size={16} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("land.dd.ccHeader")}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                {t("land.dd.ccSubtitle").replace("{project}", active?.name ?? DASH)}
              </div>
            </div>
          </div>
          <div style={{ minWidth: 280, marginLeft: "auto" }}>
            <select
              value={ccValue}
              onChange={(e) => setCc(e.target.value)}
              aria-label={t("land.dd.ccHeader")}
              style={{
                width: "100%",
                height: 34,
                padding: "0 10px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {ccOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
          </div>
          <Btn kind="ghost" size="sm" icon="grid" onClick={() => ctx.navigate("master.cc")}>
            {t("land.dd.ccManageBtn")}
          </Btn>
        </div>
      </Card>

      {/* Buy / Lease tab card. */}
      <Card pad={0}>
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <TabBtn
            active={tab === "buy"}
            icon="handshake"
            label={t("land.dd.tabBuy")}
            onClick={() => setTab("buy")}
          />
          <TabBtn
            active={tab === "lease"}
            icon="doc"
            label={
              <>
                {t("land.dd.tabLease")}
                {isSolar ? t("land.dd.tabRecommended") : ""}
              </>
            }
            onClick={() => setTab("lease")}
          />
        </div>

        {tab === "buy" ? (
          <div style={{ padding: 20 }}>
            <div style={dealGrid}>
              {/* contract-type + transfer-appointment: hardcoded mock in the prototype, no
                  wire -> em-dash. The four price fields are derived from the real plot. */}
              <DealField label={t("land.dd.buyContractType")} value={DASH} />
              <DealField label={t("land.dd.buyTotalPrice")} value={money(terms?.total)} accent />
              <DealField label={t("land.dd.buyDeposit")} value={money(terms?.deposit)} />
              <DealField label={t("land.dd.buyTransferAppt")} value={DASH} />
              <DealField label={t("land.dd.buyTransferFee")} value={money(terms?.transferFee)} />
              <DealField label={t("land.dd.buySbt")} value={money(terms?.sbt)} />
            </div>
            <div style={dealActions}>
              {/* Honest-DISABLED: no deal / PV / contract endpoint is merged. */}
              <Btn kind="outline" size="md" icon="doc" disabled>
                {t("land.dd.viewDraftBtn")}
              </Btn>
              <Btn kind="soft" size="md" icon="cash" disabled>
                {t("land.dd.pvDepositBtn")}
              </Btn>
              <Btn kind="primary" size="md" icon="check" disabled>
                {t("land.dd.confirmTransferBtn")}
              </Btn>
            </div>
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            {/* The entire lease tab was hardcoded mock figures (rent/rai, escalation,
                total, deposit, register) with no wire -> every value is an em-dash. The
                contract-type label reuses buyContractType (same "contract type" field). */}
            <div style={dealGrid}>
              <DealField label={t("land.dd.buyContractType")} value={DASH} />
              <DealField label={t("land.dd.leaseRentPerRai")} value={DASH} accent />
              <DealField label={t("land.dd.leaseEscalation")} value={DASH} />
              <DealField label={t("land.dd.leaseTotalRent")} value={DASH} />
              <DealField label={t("land.dd.leaseDeposit")} value={DASH} />
              <DealField label={t("land.dd.leaseRegister")} value={DASH} tone="var(--warn)" />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 9,
                background: "var(--info-soft)",
                marginBottom: 16,
                fontSize: 11.5,
                color: "var(--info)",
              }}
            >
              <Icon name="info" size={15} />
              {t("land.dd.leaseInfo")}
            </div>
            <div style={dealActions}>
              {/* Honest-DISABLED: no deal / PV / contract endpoint is merged. */}
              <Btn kind="outline" size="md" icon="doc" disabled>
                {t("land.dd.viewDraftBtn")}
              </Btn>
              <Btn kind="soft" size="md" icon="cash" disabled>
                {t("land.dd.pvRentBtn")}
              </Btn>
              <Btn kind="primary" size="md" icon="check" disabled>
                {t("land.dd.saveLeaseBtn")}
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}
