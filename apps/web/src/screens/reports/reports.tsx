/*
 * ReportsHub — the all-module report launcher, ported from
 * pototype/extra-screens.jsx ReportsHub (L65-96). Route id "reports"
 * (docs/extract/NAV-ROUTES.md), no module gate.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (reports · hub),
 * the title/subtitle, the outline "schedule" header action, and the 3-column grid
 * of 7 category cards (colored top border + icon square + item count + per-item
 * rows with a routable/launcher-only distinction + PDF/XLS export pills) are the
 * prototype's, 1:1.
 *
 * Data (rule 8): NONE. This is a static launcher — the 7-category catalogue is UI
 * config (reports-cats.ts), not server data. GET /reports/hub exists in the
 * contract but has no backend handler (would 404), so nothing is fetched. The
 * PDF/XLS/schedule actions are honest toast-only: POST /reports/{id}/export is
 * typed but unimplemented, and there is no schedule endpoint anywhere — the
 * prototype was toast-only too, so the toasts are faithful, not a degraded stub.
 *
 * i18n (rule 2): every label is a reports.* / borrowed dict key (t); "PDF"/"XLS"
 * button text + title="PDF"/"Excel" tooltips are ASCII literals verbatim from the
 * prototype (B-073-safe — ASCII is not Thai, is not minting). Tokens back every
 * color; the 5 non-brand category accents are prototype-verbatim hexes (B-037(a),
 * in reports-cats.ts).
 */
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { REPORT_CATS } from "./reports-cats";

const exportPill: CSSProperties = {
  border: "none",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 10.5,
  fontWeight: 700,
  background: "var(--surface-2)",
  cursor: "pointer",
  fontFamily: "inherit",
};

export function ReportsHub() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  return (
    <Page
      breadcrumbs={[t("reports.crumbRoot"), t("reports.crumbScreen")]}
      title={t("reports.title")}
      subtitle={t("reports.subtitle")}
      actions={
        <Btn
          kind="outline"
          size="md"
          icon="calendar"
          onClick={() => ctx.notify(t("reports.toastSchedule"))}
        >
          {t("reports.btnSchedule")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {REPORT_CATS.map((c) => (
          <Card
            key={c.labelKey}
            pad={0}
            style={{ overflow: "hidden", borderTop: `3px solid ${c.color}` }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `color-mix(in srgb, ${c.color} 14%, white)`,
                  color: c.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={c.icon} size={17} />
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t(c.labelKey)}</div>
              <span
                className="num"
                style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}
              >
                {c.items.length}
              </span>
            </div>
            <div style={{ padding: 8 }}>
              {c.items.map((it) => {
                const label = t(it.key);
                return (
                  <div
                    key={it.key}
                    onClick={() => it.route && ctx.navigate(it.route)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: 12.5,
                      cursor: it.route ? "pointer" : "default",
                      background: it.route ? "var(--brand-soft)" : "transparent",
                    }}
                  >
                    <Icon
                      name={it.route ? "arrowR" : "doc"}
                      size={14}
                      color={it.route ? "var(--brand)" : "var(--text-3)"}
                    />
                    <span style={{ flex: 1, fontWeight: it.route ? 600 : 400 }}>
                      {label}
                      {it.route && (
                        <span
                          style={{
                            fontSize: 9.5,
                            color: "var(--brand)",
                            marginLeft: 6,
                            fontWeight: 700,
                          }}
                        >
                          {t("reports.openScreen")}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      title="PDF"
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.notify(t("reports.toastExportPdf").replace("{name}", label));
                      }}
                      style={{ ...exportPill, color: "var(--danger)" }}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      title="Excel"
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.notify(t("reports.toastExportXls").replace("{name}", label));
                      }}
                      style={{ ...exportPill, color: "var(--ok)" }}
                    >
                      XLS
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}
