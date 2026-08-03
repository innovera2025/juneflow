/*
 * DMSCenter — the Document Management (DMS) center, ported from pototype/dms.jsx
 * DMSCenter (L31-145) + DMSUploadForm (L147-178). Route `dms` (docs/extract/
 * NAV-ROUTES.md, registry section "system", component DMSCenter, file dms.jsx).
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (system · document
 * center), the title/subtitle, the two header actions (Export / upload), the 4-card KPI strip,
 * the 230px category rail (all + the seven categories with per-category counts), the
 * documents card (search toolbar + count, the seven-column table, the info footer)
 * are the prototype's, styled with the ds.jsx th()/td()/Kpi/StatusBadge geometry.
 *
 * Data (rule 8): GET /documents (use-dms.ts) via the generated client — the
 * prototype's local DMS_SEED becomes the server catalogue. The handler resolves
 * project_id → project_name and by_user_id → the uploader NAME and returns rows
 * newest-first, so a display field never carries a raw uuid and no GET /users or
 * GET /projects lookup is needed. Pure logic (narrowing / category meta / status
 * tone / filter / counts / date) lives in dms-rows.ts (unit-tested, gate G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated):
 *  - Upload (dms.jsx openUpload → DMSUploadForm → POST /documents): GET-only this
 *    round — POST /documents is deferred, so the header upload button is honest-
 *    DISABLED (kept for fidelity, no write the backend won't serve; B-220). The
 *    upload modal is not ported.
 *  - Versions (dms.jsx openVersions v{n} button): no document_version table exists,
 *    so the version badge is a STATIC current-version display, not a clickable
 *    history modal (no fabricated per-version dates).
 *  - Download (dms.jsx ctx.notify): no file-download endpoint → an honest toast
 *    (dms.toastDownload) naming the file; the button is kept.
 *  - Module button (dms.jsx ctx.navigate(r.link)): link_module carries the source
 *    route id → navigate when it maps to a registered route, honest-disable when it
 *    does not (defensive for a future polymorphic "module:uuid" value). Omitted when
 *    the doc is unattached (link "").
 *  - KPI 2 (upload-this-month) + KPI 4 (storage-used): no month-aggregate and no
 *    storage/quota model on the wire → em-dash (never the mock "14" / "4.2 GB").
 *    Their mock subs are dropped. KPI 3's mock permit-detail sub is likewise dropped.
 *  - Per-row date: the wire's real created_at (a uniform seed time) is shown, not the
 *    prototype's varied Thai dates (§0 rule 3, real > mock).
 *  - Expiry subline: the raw `expiry` date is shown (there is no key/formatter for
 *    the prototype's Thai "expires on ..." phrase).
 *
 * i18n (rule 2): every visible string is a dedicated dms.* DICT key or a byte-exact
 * borrow (t()), verified present in packages/i18n/src/i18n-full.json — nothing is
 * minted here. "Export" is a prototype ASCII literal (ds.jsx openExportModal call).
 * Tokens back every colour (rule 6); the DMS_CATS hexes are prototype-verbatim
 * (B-037a, in dms-rows.ts). money=NONE.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { EXTRA_ROUTES, SIDEBAR_ROUTES } from "../../routes/registry";
import {
  toDmsRow,
  DMS_CATS,
  catById,
  statusTone,
  statusLabelKind,
  filterDocs,
  catCount,
  countByStatus,
  formatDocDate,
  type DmsRow,
  type DmsStatusKind,
} from "./dms-rows";
import { useDocuments } from "./use-dms";

const DASH = "—";

/** The registered route ids — the module button navigates only to one of these. */
const VALID_ROUTES: ReadonlySet<string> = new Set(
  [...SIDEBAR_ROUTES, ...EXTRA_ROUTES].map((r) => r.id),
);

/** Table header cell style (ds.jsx th(), L214-219 — always left-aligned, width w). */
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

/** Table body cell style (ds.jsx td(), L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** KPI card, inlined from dashboard.jsx Kpi (L93-115) — label / value+unit / sub. */
function DMSKpi({
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
  accent: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ status, label }: { status: string; label: string }) {
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
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

export function DMSCenter() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const docsQ = useDocuments();
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");

  const rows = useMemo<DmsRow[]>(() => (docsQ.data ?? []).map(toDmsRow), [docsQ.data]);
  const list = useMemo(() => filterDocs(rows, cat, q), [rows, cat, q]);

  /** The DICT key for a status label (active→borrow, review→dedicated, expiring→borrow). */
  const statusLabelKey = (kind: DmsStatusKind): DictKey => {
    switch (kind) {
      case "review":
        return "dms.statusReview";
      case "expiring":
        return "pm.kpiExpiring";
      case "active":
      default:
        return "fa.statusActive";
    }
  };

  return (
    <Page
      breadcrumbs={[t("nav.sec.sys"), t("dms.crumbCenter")]}
      title={t("dms.title")}
      subtitle={t("dms.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("dms.exportTitle"))}>
            Export
          </Btn>
          {/* POST /documents deferred → honest-disabled upload button (B-220). */}
          <Btn kind="primary" size="md" icon="upload" disabled>
            {t("dms.uploadTitle")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <DMSKpi
          label={t("dms.kpiTotalLabel")}
          value={String(rows.length)}
          unit={t("dms.unitFile")}
          sub={t("dms.kpiCategoriesSub").replace("{n}", String(DMS_CATS.length))}
          accent="var(--brand)"
        />
        {/* No month-aggregate on the wire — em-dash, never the mock "14". */}
        <DMSKpi label={t("dms.kpiUploadMonthLabel")} value={DASH} accent="var(--ok)" />
        <DMSKpi
          label={t("dms.kpiReviewExpiringLabel")}
          value={`${countByStatus(rows, "review")} / ${countByStatus(rows, "expiring")}`}
          unit={t("dms.unitFile")}
          accent="var(--danger)"
        />
        {/* No storage/quota model on the wire — em-dash, never the mock "4.2 GB". */}
        <DMSKpi label={t("dms.kpiStorageLabel")} value={DASH} accent="var(--warn)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 16, alignItems: "start" }}>
        {/* category rail */}
        <Card pad={8}>
          <div
            onClick={() => setCat("")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 10px",
              borderRadius: 8,
              cursor: "pointer",
              background: !cat ? "var(--brand-soft)" : "transparent",
              fontSize: 12.5,
              fontWeight: !cat ? 700 : 500,
            }}
          >
            <Icon name="grid" size={15} color={!cat ? "var(--brand)" : "var(--text-3)"} />
            {t("common.all")}
            <span className="num" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)" }}>
              {rows.length}
            </span>
          </div>
          {DMS_CATS.map((c) => (
            <div
              key={c.id}
              onClick={() => setCat(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 10px",
                borderRadius: 8,
                cursor: "pointer",
                background: cat === c.id ? "var(--brand-soft)" : "transparent",
                fontSize: 12.5,
                fontWeight: cat === c.id ? 700 : 500,
              }}
            >
              <Icon name={c.icon} size={15} color={c.color} />
              {t(c.labelKey)}
              <span className="num" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)" }}>
                {catCount(rows, c.id)}
              </span>
            </div>
          ))}
        </Card>

        {/* documents */}
        <Card pad={0}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
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
                flex: 1,
                maxWidth: 320,
              }}
            >
              <Icon name="search" size={13} color="var(--text-3)" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("dms.searchPlaceholder")}
                style={{ border: "none", outline: "none", flex: 1, fontSize: 12, background: "transparent", color: "var(--text)" }}
              />
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
              <span className="num">{list.length}</span> {t("dms.unitFile")}
            </span>
          </div>

          {docsQ.isLoading ? (
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
                  <th scope="col" style={th()}>{t("subcon.colDoc")}</th>
                  <th scope="col" style={th(150)}>{t("nav.master.project")}</th>
                  <th scope="col" style={th(60)}>{t("dms.colVersion")}</th>
                  <th scope="col" style={th(110)}>{t("subcon.uploadBtn")}</th>
                  <th scope="col" style={th(70)}>{t("dms.colSize")}</th>
                  <th scope="col" style={th(110)}>{t("common.status")}</th>
                  <th scope="col" style={th(150)} />
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  // Honest empty state (B-220): the read returned no docs / the filter
                  // matched none. Icon-only — there is no sanctioned "no documents"
                  // key and consume-only forbids minting one (the prototype always had
                  // mock rows, so no empty-state copy exists).
                  <tr>
                    <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="doc" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  list.map((r) => {
                    const c = catById(r.cat);
                    const catLabel = c ? t(c.labelKey) : r.cat;
                    const catColor = c?.color ?? "var(--text-3)";
                    const hasExpiry = r.expiry !== "";
                    const displayDate = formatDocDate(r.date);
                    const canNavigate = r.link !== "" && VALID_ROUTES.has(r.link);
                    return (
                      <tr
                        key={r.id}
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: r.status === "expiring" ? "color-mix(in srgb, var(--danger-soft) 45%, white)" : "transparent",
                        }}
                      >
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 7,
                                flexShrink: 0,
                                background: `color-mix(in srgb, ${catColor} 13%, white)`,
                                color: catColor,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Icon name={c?.icon ?? "doc"} size={14} />
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 12 }}>{r.name}</div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: hasExpiry ? "var(--danger)" : "var(--text-3)",
                                  fontWeight: hasExpiry ? 700 : 400,
                                }}
                              >
                                {catLabel}
                                {hasExpiry ? ` · ⚠ ${r.expiry}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{r.proj || DASH}</td>
                        {/* version: no history table → static current-version badge (no modal). */}
                        <td style={td}>
                          <span
                            className="num"
                            style={{
                              display: "inline-block",
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              borderRadius: 6,
                              padding: "2px 8px",
                              fontSize: 10.5,
                              fontWeight: 800,
                              color: "var(--brand)",
                            }}
                          >
                            v{r.ver}
                          </span>
                        </td>
                        {/* upload: resolved uploader name · real created_at (both em-dash when absent). */}
                        <td style={{ ...td, fontSize: 11, color: "var(--text-3)" }}>
                          {r.by || DASH} · <span className="num">{displayDate || DASH}</span>
                        </td>
                        <td style={{ ...td, fontSize: 11 }} className="num">{r.size || DASH}</td>
                        <td style={td}>
                          <StatusBadge status={r.status} label={t(statusLabelKey(statusLabelKind(r.status)))} />
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 4 }}>
                            <Btn
                              kind="ghost"
                              size="sm"
                              icon="download"
                              onClick={() => ctx.notify(t("dms.toastDownload").replace("{x}", r.name))}
                            >
                              {t("subcon.downloadBtn")}
                            </Btn>
                            {r.link !== "" &&
                              (canNavigate ? (
                                <Btn kind="soft" size="sm" icon="arrowR" onClick={() => ctx.navigate(r.link)}>
                                  {t("users.moduleCol")}
                                </Btn>
                              ) : (
                                // link_module is not a registered route (e.g. a future
                                // polymorphic "module:uuid") → honest-disabled, never a broken nav.
                                <Btn kind="soft" size="sm" icon="arrowR" disabled>
                                  {t("users.moduleCol")}
                                </Btn>
                              ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

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
            <Icon name="info" size={13} /> {t("dms.infoLine")}
          </div>
        </Card>
      </div>
    </Page>
  );
}
