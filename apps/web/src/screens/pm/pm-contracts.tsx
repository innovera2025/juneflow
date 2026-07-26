/*
 * PMContracts — the PM maintenance-contract register, ported from pototype/pm2.jsx
 * PMContracts (L8-100) under Wei ruling B-136 (LEAN). Route pm.contracts (mod
 * "pm", file pm2.jsx).
 *
 * Design fidelity (PLAN.md §0 rule 1) within the LEAN envelope: the two-crumb
 * breadcrumb (PM root · contracts), the title/subtitle, the 3-card PMKpi strip
 * (active count / near-expiry count / total value in millions), and the create
 * action are the prototype's. Every visible string is a pm.* / common.* / fa.* dict
 * key (t); tokens back every colour (rule 6). No Thai / baht literal sits in this
 * source (B-073).
 *
 * DIVERGENCES (reported honestly, never fabricated):
 *  - GROUPING: the prototype groups contracts BY PROJECT (each table row is a
 *    project, drilling into openProjectContracts / openAddProject / AddProjectPicker
 *    modals). Those drill-downs are mock-heavy and there is no project-grouping
 *    metadata cleanly on the wire, so the LEAN port (B-136) renders a FLAT
 *    per-contract table instead.
 *  - STATUS: the prototype `status` is a hardcoded mock field with NO wire column.
 *    It is DERIVED here from the real `end` date (pm-contracts-rows.statusFromEnd) —
 *    an absent/unparseable end has no basis and renders an em-dash badge.
 *  - WIRE GAPS -> em-dash (contractWire = { id, project_id, customer_id, mode,
 *    visits_per_year, sla, value, currency_code, end }, apps/api/src/routes/pm.ts):
 *    NO contract `no`, NO scope, NO site, NO cycle-label, NO start date. The
 *    customer NAME resolves from customer_id (GET /customers); the project NAME from
 *    project_id (GET /projects). Pure logic (row narrowing / status-from-end / KPI
 *    counts+sums / money+millions / name maps) lives in pm-contracts-rows.ts (G3).
 *  - EXPORT: reuses the PM module's presentational export modal (pm.exportModalTitle
 *    + pm.exportExcel/Pdf/Csv), identical to pm-assets/wo-list.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useCustomerList } from "../master/use-master-customer";
import {
  toPmContractRow,
  toCustomerRef,
  statusFromEnd,
  contractCount,
  totalValue,
  activeCount,
  expiringCount,
  customerNameById,
  projectNameById,
  formatMoney,
  millionsValue,
  type PmContractRow,
  type PmcStatus,
} from "./pm-contracts-rows";
import { usePmContractList } from "./use-pm-contracts";
import { PMContractForm } from "./pm-contract-form";

const DASH = "—";

/** Table header cell style (ds.jsx th(); pm2.jsx th()). */
function th(w?: number, align: "left" | "right" | "center" = "left"): CSSProperties {
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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** KPI card, inlined from pm.jsx PMKpi (L74-90). Accent tints the icon chip + value. */
function PMKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent: string;
  icon: IconName;
}) {
  return (
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Tone tokens for a derived contract status (mirrors wo-list statusTone). */
function statusTone(status: PmcStatus): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "active":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "expiring":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "expired":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
  }
}

/** StatusBadge (ds.jsx L91-108, size sm), inlined like wo-list. */
function StatusBadge({ status, label }: { status: PmcStatus; label: string }) {
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

export function PMContracts() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const contractsQ = usePmContractList();
  const projectsQ = useProjects();
  const customerQ = useCustomerList();

  const today = useMemo(() => new Date(), []);
  const rows = useMemo<PmContractRow[]>(
    () => (contractsQ.data ?? []).map(toPmContractRow),
    [contractsQ.data],
  );
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);
  const customerNames = useMemo(
    () => customerNameById((customerQ.data ?? []).map(toCustomerRef)),
    [customerQ.data],
  );

  const projectName = (id: string): string => projectNames.get(id) ?? "";
  const customerName = (id: string): string => customerNames.get(id) ?? "";

  const modeLabel = (mode: string): string =>
    mode === "per_visit" ? t("pm.svcScheduledLabel") : mode === "MA" ? t("pm.svcMaLabel") : DASH;

  const statusLabel = (status: PmcStatus): string => {
    switch (status) {
      case "active":
        return t("fa.statusActive");
      case "expiring":
        return t("pm.kpiExpiring");
      case "expired":
        return t("pm.statusExpired");
    }
  };

  const openCreate = () => {
    ctx.openModal({
      title: t("pm.titleCreateContract"),
      subtitle: t("pm.subtitleCreate"),
      icon: "doc",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <PMContractForm onClose={close} />,
    });
  };

  // Export (pm.jsx openPMExport, presentational — identical to pm-assets/wo-list).
  const openExport = () => {
    const what = t("pm.breadcrumbContracts");
    const opts: { ic: IconName; l: string }[] = [
      { ic: "grid", l: t("pm.exportExcel") },
      { ic: "doc", l: t("pm.exportPdf") },
      { ic: "download", l: t("pm.exportCsv") },
    ];
    ctx.openModal({
      title: t("pm.exportModalTitle"),
      subtitle: what,
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
                ctx.notify(t("pm.toastDownloading").replace("{name}", what).replace("{fmt}", o.l));
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
              <Icon name={o.ic} size={16} color="var(--brand)" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{o.l}</span>
            </button>
          ))}
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.breadcrumbContracts")]}
      title={t("pm.contractsPageTitle")}
      subtitle={t("pm.contractsSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={openExport}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("pm.btnCreateContract")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (3) — every value is REAL/derived (count / status-from-end / Σvalue). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
        <PMKpi
          label={t("pm.kpiActive")}
          value={String(activeCount(rows, today))}
          unit={t("pm.kpiUnitContract")}
          sub={t("pm.kpiActiveSub").replace("{n}", String(contractCount(rows)))}
          accent="var(--ok)"
          icon="doc"
        />
        <PMKpi
          label={t("pm.kpiExpiring")}
          value={String(expiringCount(rows, today))}
          unit={t("pm.kpiUnitContract")}
          sub={t("pm.kpiExpiringSub")}
          accent="var(--warn)"
          icon="clock"
        />
        <PMKpi
          label={t("pm.kpiValue")}
          value={millionsValue(totalValue(rows))}
          unit={t("pm.unitMillion")}
          sub={t("pm.kpiValueSub")}
          accent="#B45309"
          icon="cash"
        />
      </div>

      <Card pad={0}>
        {contractsQ.isLoading ? (
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
                <th style={th(150)}>{t("pm.colContract")}</th>
                <th style={th()}>{t("pm.colProject")}</th>
                <th style={th(180)}>{t("pm.rowCustomer")}</th>
                <th style={th(180)}>{t("pm.rowContractType")}</th>
                <th style={th(140)}>{t("pm.rowSlaResponse")}</th>
                <th style={th(110, "center")}>{t("pm.fieldVisitsPerYear")}</th>
                <th style={th(140, "right")}>{t("pm.colTotalValue")}</th>
                <th style={th(120, "right")}>{t("pm.rowEnd")}</th>
                <th style={th(130)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("pm.emptyContracts")}</div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const status = statusFromEnd(r.end, today);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      {/* contract no (no wire -> em-dash) + scope sub-line (no wire -> em-dash) */}
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: "var(--text-3)" }} className="num">{DASH}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{DASH}</div>
                      </td>
                      {/* project NAME (real) + site sub-line (no wire -> em-dash) */}
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: "var(--brand-ink)" }}>
                          {projectName(r.projectId) || DASH}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{DASH}</div>
                      </td>
                      {/* customer NAME (real) */}
                      <td style={td}>{customerName(r.customerId) || DASH}</td>
                      {/* mode (real) + cycle sub-line (no wire -> em-dash) */}
                      <td style={td}>
                        <div>{modeLabel(r.mode)}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{DASH}</div>
                      </td>
                      {/* sla (real or em-dash) */}
                      <td style={{ ...td, color: r.sla ? "var(--text)" : "var(--text-3)" }}>
                        {r.sla || DASH}
                      </td>
                      {/* visits/year (real or em-dash) */}
                      <td style={{ ...td, textAlign: "center" }} className="num">
                        {r.visitsPerYear != null ? String(r.visitsPerYear) : DASH}
                      </td>
                      {/* value/year (real) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(r.value)}
                      </td>
                      {/* end date (real or em-dash) + start sub-line (no wire -> em-dash) */}
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        <div>{r.end || DASH}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{DASH}</div>
                      </td>
                      {/* derived status badge (no basis -> em-dash) */}
                      <td style={td}>
                        {status ? (
                          <StatusBadge status={status} label={statusLabel(status)} />
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</span>
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
