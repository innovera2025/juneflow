/*
 * SubconContracts — the subcontractor contract register, ported from
 * pototype/subcon-accept.jsx SubconContracts (L72-114). Route subcon.contracts
 * (registry mod "subcon", file subcon-accept.jsx), a "light" list port.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (subcontractor ·
 * contract register), the title/subtitle, the two header actions (Export /
 * create-contract), the 4-card MiniKpi strip, and the 6-column table (WO/PO ·
 * subcon+work · method · value · progress · acceptance) are the prototype's. Each
 * row navigates to subcon.accept with { wo } exactly like the prototype.
 *
 * Data (rule 3): GET /subcon-contracts (use-subcon.ts) via the generated client —
 * the prototype's local SUBC_CONTRACTS array becomes the server register. The
 * subcontractor NAME resolves from vendor_id via GET /vendors; the project NAME
 * from project_id via GET /projects. Pure logic (row narrowing / KPI count+sum /
 * money+millions / name maps / next-no) lives in subcon-rows.ts (unit-tested, G3).
 *
 * WIRE GAPS (reported honestly, never fabricated) — the contractWire is only
 * { id, no, vendor_id, project_id, value, currency_code, retention_pct, start, end }
 * (apps/api/src/routes/subcon.ts):
 *   - NO po sub-line: the WO/PO cell's secondary PO line em-dashes.
 *   - NO scope column: the subcon+work cell's scope half em-dashes (project half is
 *     the real resolved name).
 *   - NO method column: a period's basis lives per-work-period, so the whole method
 *     cell em-dashes (KPI-4 "by-distance" count therefore has no source -> em-dash).
 *   - NO inline periods (GET /subcon-contracts/{id}/periods is a SEPARATE call): the
 *     progress bar/percent cell em-dashes (bar omitted), and the acceptance
 *     "periods pending review" badge has no source -> em-dash (KPI-3 pending-accept
 *     value therefore em-dashes too). StatusBadge is consequently never rendered on
 *     this list, so it is not inlined here.
 *   - KPI values: KPI-1 (active-contract count = rows.length) + KPI-2 (total value
 *     in millions = sum(value)) are REAL; KPI-3 (pending-accept) + KPI-4 (by-distance)
 *     have no wire metric -> em-dash value, static descriptive sub-captions kept.
 *
 * i18n (rule 2): every string is a subcon.* / common.* dict key (t). Tokens back
 * every colour (rule 6). The empty-state placeholder mirrors the wo-list template's
 * t("common.all"). No Thai literal (and no baht glyph) sits in this source.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
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
  contractCount,
  totalValue,
  formatMoney,
  millionsValue,
  type ContractRow,
} from "./subcon-rows";
import { useSubconContractList } from "./use-subcon";
import { SubconContractForm } from "./subcon-contract-form";

const DASH = "—";

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
        <span
          style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}
        >
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

export function SubconContracts() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const subconQ = useSubconContractList();
  const vendorQ = useVendorList();
  const projectsQ = useProjects();

  const rows = useMemo<ContractRow[]>(() => (subconQ.data ?? []).map(toContractRow), [subconQ.data]);
  const vendorNames = useMemo(
    () => vendorNameById((vendorQ.data ?? []).map(toVendorRef)),
    [vendorQ.data],
  );
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  const subconName = (id: string): string => vendorNames.get(id) ?? "";
  const projectName = (id: string): string => projectNames.get(id) ?? "";

  const openCreate = () => {
    ctx.openModal({
      title: t("subcon.modalTitle"),
      subtitle: t("subcon.modalSubtitle"),
      icon: "doc",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <SubconContractForm onClose={close} existingNos={rows.map((r) => r.no)} />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("subcon.subcontractor"), t("subcon.contractsBreadcrumb")]}
      title={t("subcon.contractsTitle")}
      subtitle={t("subcon.contractsSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("subcon.toastExport"))}>
            {t("common.export")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("subcon.createContractBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — count + total value are real; pending-accept + by-distance
          have no wire metric (need the periods endpoint) -> em-dash. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <MiniKpi
          label={t("subcon.kpiActiveLabel")}
          value={String(contractCount(rows))}
          unit={t("subcon.unitContract")}
          tone="var(--brand)"
          icon="doc"
        />
        <MiniKpi
          label={t("subcon.kpiTotalValueLabel")}
          value={millionsValue(totalValue(rows))}
          unit={t("subcon.unitMBaht")}
          tone="var(--text)"
          icon="cash"
        />
        <MiniKpi
          label={t("subcon.kpiPendingAccept")}
          value={DASH}
          sub={t("subcon.kpiPendingSub")}
          tone="var(--warn)"
          icon="clock"
        />
        <MiniKpi
          label={t("subcon.kpiDistanceLabel")}
          value={DASH}
          unit={t("subcon.unitContract")}
          sub={t("subcon.kpiDistanceSub")}
          tone="var(--ok)"
          icon="ruler"
        />
      </div>

      <Card pad={0}>
        {subconQ.isLoading ? (
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
                <th style={th(140)}>{t("subcon.colWoPo")}</th>
                <th style={th()}>{t("subcon.colSubconWork")}</th>
                <th style={th(150)}>{t("subcon.colMethod")}</th>
                <th style={th(120, true)}>{t("subcon.colValueBaht")}</th>
                <th style={{ ...th(140), textAlign: "center" }}>{t("subcon.colProgressLong")}</th>
                <th style={th(120)}>{t("subcon.colAccept")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const proj = projectName(r.projectId);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => ctx.navigate("subcon.accept", { wo: r.no })}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      {/* WO/PO no (real) + PO sub-line (no wire -> em-dash) */}
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: "var(--brand)" }} className="num">{r.no}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="num">{DASH}</div>
                      </td>
                      {/* subcon NAME (real) + scope(em-dash) · project NAME (real) */}
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{subconName(r.vendorId) || DASH}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {DASH}
                          {proj ? ` · ${proj}` : ""}
                        </div>
                      </td>
                      {/* method: no wire column -> whole cell em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      {/* value: real (formatMoney) */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(r.value)}
                      </td>
                      {/* progress: no inline periods -> em-dash (bar omitted) */}
                      <td style={{ ...td, textAlign: "center", color: "var(--text-3)" }} className="num">{DASH}</td>
                      {/* acceptance: needs the periods endpoint -> em-dash */}
                      <td style={td}>
                        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</span>
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
