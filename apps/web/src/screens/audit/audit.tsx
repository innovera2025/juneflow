/*
 * AuditLog — the cross-module activity feed, ported from
 * pototype/exec-audit.jsx AuditLog (L182-229). Route id "audit"
 * (docs/extract/NAV-ROUTES.md), no module gate.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb (system · audit),
 * the title/subtitle, the outline "export" header action, the filter bar + count,
 * and the day-grouped feed rows (icon square + time + who/what/where line) keep
 * the prototype's layout 1:1.
 *
 * Data (rule 8): LIVE GET /audit-log (use-audit.ts) via the generated client. The
 * server row is deliberately THINNER than the prototype mock, so the following
 * honest divergences are intentional (Wei ruling 2026-07-19 — see audit-rows.ts),
 * NOT fidelity breaks; the chrome/layout stay faithful, only real fields render:
 *   - role / detail (2nd line) / module Tag / per-row tone: OMITTED (no server
 *     field — never fabricated). The icon square uses a single neutral tone.
 *   - entity: rendered OPAQUE (no display-mapping layer).
 *   - day grouping: by ABSOLUTE date (no relative "N days ago" label — B-160).
 *   - module filter: DROPPED (the thin row has no module field). Only the action
 *     filter remains, backed by ?action=.
 *
 * i18n (rule 2): every string is an audit.* / borrowed dict key (t). Export +
 * schedule are honest toast-only (no backend). Tokens back every color; the
 * color-mix "white" is a prototype-verbatim literal (B-037(a)).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useAuditLog } from "./use-audit";
import { AUDIT_ACT, AUDIT_ACTIONS, DASH, groupByDay, toAuditRow } from "./audit-rows";

/** Single neutral tone for the row icon square — no per-row color is fabricated. */
const TONE = "var(--text-2)";

/**
 * Action filter — a native <select> styled like ds.jsx Dropdown mode="filter"
 * muted (the popover mechanics are a mock detail, rule 3). Options = the "all"
 * sentinel plus the AUDIT_ACT actions; the value drives the backed ?action= query.
 */
function ActionFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
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
      <div style={{ lineHeight: 1.1, flex: 1, textAlign: "start", minWidth: 0 }}>
        <div style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 600 }}>
          {t("audit.filterAction")}
        </div>
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
          <option value="">{t("common.all")}</option>
          {AUDIT_ACTIONS.map((a) => {
            const lk = AUDIT_ACT[a]?.labelKey;
            return (
              <option key={a} value={a}>
                {lk ? t(lk) : a}
              </option>
            );
          })}
        </select>
      </div>
      <Icon name="chevD" size={12} color="var(--text-3)" />
    </div>
  );
}

const dayHeader: CSSProperties = {
  padding: "8px 18px 4px",
  fontSize: 11,
  fontWeight: 800,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export function AuditLog() {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [act, setAct] = useState("");

  const q = useAuditLog(act);
  const rows = useMemo(() => (q.data ?? []).map(toAuditRow), [q.data]);
  const groups = useMemo(() => groupByDay(rows), [rows]);

  return (
    <Page
      breadcrumbs={[t("nav.sec.sys"), t("audit.crumb")]}
      title={t("audit.title")}
      subtitle={t("audit.subtitle")}
      actions={
        <Btn
          kind="outline"
          size="md"
          icon="download"
          onClick={() => ctx.notify(t("audit.exportToast"))}
        >
          {t("common.export")}
        </Btn>
      }
    >
      <Card pad={0}>
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
          <ActionFilter value={act} onChange={setAct} />
          <span
            className="num"
            style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}
          >
            {rows.length} {t("accept.unitItems")}
          </span>
        </div>

        {q.isLoading ? (
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
          <div style={{ padding: "8px 0" }}>
            {groups.map((group) => (
              <div key={group.day}>
                <div style={dayHeader}>{group.day}</div>
                {group.rows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 18px",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        background: `color-mix(in srgb, ${TONE} 14%, white)`,
                        color: TONE,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={r.actionIcon} size={14} />
                    </div>
                    <div style={{ width: 52, flexShrink: 0 }}>
                      <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>
                        {r.time}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700 }}>
                          {r.userName ?? t("nav.sec.sys")}
                        </span>{" "}
                        ·{" "}
                        <span style={{ fontWeight: 600, color: "var(--text-2)" }}>
                          {r.actionLabelKey ? t(r.actionLabelKey) : r.action}
                        </span>{" "}
                        {r.entity || DASH}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {rows.length === 0 && (
              <div
                style={{
                  padding: 36,
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "var(--text-3)",
                }}
              >
                {t("audit.empty")}
              </div>
            )}
          </div>
        )}
      </Card>
    </Page>
  );
}
