/*
 * PMAssets — the PM Asset-Registry screen (route pm.assets), ported from
 * pototype/pm.jsx PMAssets (L155-221) + PMAssetForm (L223-257) + openAssetDetail
 * (L259-277) + openPMExport (L279-291). Registry mod "pm" (routes/registry.ts
 * L121). The "light" list port: a single Card with a search/kind/count toolbar over
 * a 9-column table, a row-click detail modal, an add-asset modal, and an export
 * modal.
 *
 * Design fidelity (PLAN.md section 0 rule 1): the two-crumb breadcrumb (PM ·
 * maintenance / asset-registry), the title (+ the active project TypeBadge) and
 * subtitle, the two header actions (Export / add-asset), the toolbar (search box +
 * kind filter pill + "{n}" count), and the 9-column table (code · name · kind ·
 * site · cycle · last-PM · next-PM · status · contract) are the prototype's. The
 * inlined th()/td()/Tag primitives mirror wo-list.tsx (ds.jsx th/td/Tag).
 *
 * Data (rule 3): GET /pm/assets (use-pm.ts) via the generated client — the
 * prototype's local PM_ASSETS_BY_TYPE mock becomes the server catalogue. Each row
 * is the opaque Entity { id, contract_id, kind, site, cycle, next_due }
 * (apps/api/src/routes/pm.ts assetWire). Pure narrowing/filter logic (toAssetRow /
 * distinctKinds / filterAssets) lives in pm-rows.ts (unit-tested, G3). The search
 * box + kind filter operate client-side over the loaded rows; the "{n}" count is
 * the filtered length.
 *
 * WIRE GAPS (reported honestly, never fabricated) — the assetWire is only
 * { id, contract_id, kind, site, cycle, next_due }:
 *   - name (colName "asset name / model"): NO such column on pm_asset. This is a
 *     real BACKEND GAP worth reporting (the mock's asset name is the single most
 *     prominent list field) — the list name cell + the detail title's name half
 *     render an em-dash; the code (id) alone identifies the row.
 *   - last (colLastPm): NO last-service column — em-dash (list + detail).
 *   - status (common.status badge): NO status column. NO status is derived or
 *     guessed (that would violate rule 4) — the list status cell renders an em-dash
 *     and the detail's top status badge is omitted. There is no KPI strip on this
 *     screen, so only the status cell/badge are affected.
 *   - contract (colContract): the wire gives contract_id (a uuid), but /pm/contracts
 *     is Wave-2 GATED (404, pm.ts) so the contract CODE cannot be resolved — the
 *     cell renders an em-dash and NEVER leaks the raw uuid.
 *   - next-PM (colNextPm) IS the real next_due column (em-dash only when blank).
 *   - The loading skeleton + the icon-only empty state are additions for the real
 *     data path (the mock always had rows, so rendered neither) — no invented text.
 *
 * Create path (partially Wave-2-blocked): POST /pm/assets requires contract_id +
 * kind; /pm/contracts is gated so there is no contract picker — the add-asset form
 * (pm-asset-form.tsx) collects the contract id as raw text and flags the block.
 *
 * i18n (rule 2): every visible string is a pm.* / common.* dict key (t). No Thai
 * literal lives in source (rule 2); tokens back every colour (rule 6).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { TypeBadge } from "../../shell/type-badge";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import { toAssetRow, distinctKinds, filterAssets, type AssetRow } from "./pm-rows";
import { usePmAssetList } from "./use-pm";
import { PMAssetForm } from "./pm-asset-form";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Table header cell style (ds.jsx th()). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "left",
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

/** Tag pill, inlined from ds.jsx Tag() (L273-281) — the kind chip. */
function Tag({ children, tone = "var(--text-2)" }: { children: ReactNode; tone?: string }) {
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

/**
 * Kind filter pill (native <select> styled like ds.jsx Dropdown mode="filter",
 * muted — the popover mechanics are a mock detail, rule 3). Shows the `hint`
 * (pm.colKind) above the current value; the options are the "all" sentinel
 * (common.all) plus the distinct kinds present in the data.
 */
function KindFilter({
  hint,
  allLabel,
  value,
  onChange,
  kinds,
}: {
  hint: string;
  allLabel: string;
  value: string;
  onChange: (v: string) => void;
  kinds: readonly string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 34,
        padding: "0 10px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      <div style={{ lineHeight: 1.1, flex: 1, textAlign: "left", minWidth: 0 }}>
        <div style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 600 }}>{hint}</div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-3)",
            cursor: "pointer",
            padding: 0,
            margin: 0,
            maxWidth: 160,
          }}
        >
          <option value="">{allLabel}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <Icon name="chevD" size={12} color="var(--text-3)" />
    </div>
  );
}

export function PMAssets() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = usePmAssetList();

  // Active project type (ProjectSwitcher selection) — the header TypeBadge, mirrors
  // dashboard.tsx (useProjects + resolveActiveProject).
  const projectsQ = useProjects();
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const typeKey = active?.type ?? null;

  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");

  const rows = useMemo<AssetRow[]>(() => (assetsQ.data ?? []).map(toAssetRow), [assetsQ.data]);
  const kinds = useMemo(() => distinctKinds(rows), [rows]);
  const filtered = useMemo(() => filterAssets(rows, q, kind), [rows, q, kind]);

  // Add-asset modal (pm.jsx openAdd -> PMAssetForm). The available kinds seed the
  // form's kind combobox datalist.
  const openAdd = () => {
    ctx.openModal({
      title: t("pm.modalAddTitle"),
      subtitle: t("pm.modalAddSubtitle"),
      icon: "wrench",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <PMAssetForm kinds={kinds} onClose={close} />,
    });
  };

  // Export modal (pm.jsx openPMExport) — the three format options each fire a
  // download toast (pm.toastDownloading {name},{fmt}); no real export endpoint.
  const openExport = () => {
    const what = t("pm.assetsTitle");
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
                ctx.notify(
                  t("pm.toastDownloading").replace("{name}", what).replace("{fmt}", o.l),
                );
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
                textAlign: "left",
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
  };

  // Detail modal (pm.jsx openAssetDetail) — kind/cycle/next-PM are real; last-PM +
  // contract are wire gaps (em-dash); the mock's top status badge is omitted (no
  // status column). The two actions navigate to the schedule / work-order screens.
  const openDetail = (a: AssetRow) => {
    const detailRow = (label: string, value: ReactNode, mono?: boolean) => (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "9px 0",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
        <span className={mono ? "num" : ""} style={{ fontSize: 12.5, fontWeight: 600 }}>
          {value}
        </span>
      </div>
    );
    ctx.openModal({
      // The mock title was `${id} · ${name}`; name is a wire gap, so the code alone
      // identifies the asset (never a fabricated name).
      title: a.id || DASH,
      subtitle: a.site || DASH,
      icon: "wrench",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <div>
          {detailRow(t("pm.colKind"), a.kind || DASH)}
          {detailRow(t("pm.colCycle"), a.cycle || DASH)}
          {detailRow(t("pm.colLastPm"), DASH, true)}
          {detailRow(t("pm.colNextPm"), a.nextDue || DASH, true)}
          {detailRow(t("pm.colContract"), DASH, true)}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <Btn
              kind="outline"
              size="md"
              icon="calendar"
              onClick={() => {
                close();
                ctx.navigate("pm.schedule");
              }}
            >
              {t("pm.detailViewPlanBtn")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="wrench"
              onClick={() => {
                close();
                ctx.notify(t("pm.toastAssetWoCreated").replace("{id}", a.id));
                ctx.navigate("pm.wo");
              }}
            >
              {t("pm.detailCreateWoBtn")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("pm.breadcrumbRoot"), t("pm.assetsTitle")]}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {t("pm.assetsTitleFull")}
          {typeKey && <TypeBadge type={typeKey} size="sm" />}
        </span>
      }
      subtitle={t("pm.assetsSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={openExport}>
            {t("pm.exportBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openAdd}>
            {t("pm.addAssetBtn")}
          </Btn>
        </div>
      }
    >
      <Card pad={0}>
        {/* Toolbar: search + kind filter + count (pm.jsx L182-189). */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--surface)",
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("pm.searchPh")}
              style={{
                border: "none",
                outline: "none",
                width: 220,
                fontSize: 12,
                background: "transparent",
                color: "var(--text)",
              }}
            />
          </div>
          <KindFilter
            hint={t("pm.colKind")}
            allLabel={t("common.all")}
            value={kind}
            onChange={setKind}
            kinds={kinds}
          />
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
            {t("pm.countUnit").replace("{n}", String(filtered.length))}
          </span>
        </div>

        {assetsQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  height: 44,
                  marginBottom: 4,
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th style={th(110)}>{t("pm.colCode")}</th>
                  <th style={th()}>{t("pm.colName")}</th>
                  <th style={th(120)}>{t("pm.colKind")}</th>
                  <th style={th(150)}>{t("pm.colSite")}</th>
                  <th style={th(100)}>{t("pm.colCycle")}</th>
                  <th style={th(100)}>{t("pm.colLastPm")}</th>
                  <th style={th(100)}>{t("pm.colNextPm")}</th>
                  <th style={th(120)}>{t("common.status")}</th>
                  <th style={th(120)}>{t("pm.colContract")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    {/* Icon-only empty state (no invented text — see header). */}
                    <td colSpan={9} style={{ padding: 60, textAlign: "center" }}>
                      <Icon name="wrench" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  filtered.map((a) => (
                    <tr
                      key={a.id}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      onClick={() => openDetail(a)}
                    >
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {a.id || DASH}
                      </td>
                      {/* name: no wire column (backend gap) — em-dash */}
                      <td style={{ ...td, fontWeight: 600, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={td}>{a.kind ? <Tag tone="var(--text-2)">{a.kind}</Tag> : DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{a.site || DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{a.cycle || DASH}</td>
                      {/* last-PM: no wire column — em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }} className="num">{DASH}</td>
                      {/* next-PM: real next_due column */}
                      <td style={{ ...td, fontWeight: 600 }} className="num">{a.nextDue || DASH}</td>
                      {/* status: no wire column — em-dash (no derived status) */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      {/* contract: contract_id uuid unresolvable (/pm/contracts gated) — em-dash */}
                      <td style={{ ...td, color: "var(--text-3)" }} className="num">{DASH}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
