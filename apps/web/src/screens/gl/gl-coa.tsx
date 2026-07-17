/*
 * GLChartOfAccounts — the Chart of Accounts screen, ported from pototype/accounting-extra.jsx
 * GLChartOfAccounts (L40-121). Route gl.coa (docs/extract/NAV-ROUTES.md L59, section "acct"),
 * visual-gate reference tests/visual/reference/gallery/g5/08-s.jpg.
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module,
 * chart-of-accounts screen), the title/subtitle, the Export + add-account header actions,
 * the 3-card KPI strip, the
 * toolbar (search + class dropdown + count), and the class-grouped table (code · name · group ·
 * Dr/Cr tag · balance · status · edit) are the prototype's. The class GROUP headers, the code
 * colour, and the Dr/Cr tag are all derived from the code's leading digit (COA_CLASSES).
 *
 * Data (rule 8): GET /gl/coa (use-gl.ts) via the generated client — the prototype's local
 * COA_SEED becomes the real server chart. The wire is only { id, code, name, parent_id,
 * created_at } (apps/api/src/routes/gl.ts coaWire), so:
 *   WIRE GAPS (em-dashed, never fabricated):
 *   - the account group has no wire column -> the group cell em-dashes.
 *   - the balance has no wire column -> the balance cell em-dashes.
 *   - the active/status flag has no wire column -> the status cell em-dashes.
 *   NO WRITE ENDPOINT: there is no POST/PUT /gl/coa (only the GET read is in scope). Wiring a
 *   create/edit would fabricate a flow (C10), so the add-account + per-row edit buttons render
 *   (structural fidelity with g5/08) but are DISABLED — the honest analogue of an em-dashed
 *   field for a write action (po-list.tsx cancel-PO "shows but cannot persist" precedent).
 *   Export has no server endpoint either -> it fires the prototype's export toast (client
 *   intent), the same stand-in gr-list/po-list use.
 *   DERIVED (honest, not from a missing wire field): the class (code[0]) + Dr/Cr nature +
 *   the account-count / class-count KPI values.
 *
 * i18n (rule 2): breadcrumb/labels are coa-strings.json phrases (tp) or existing DICT keys
 * (t: vendor.btnExport / common.status / common.edit). gl.coa is a NEW screen, so several
 * keys are not yet in i18n-full.json (coa-strings.json._missing) — they render honest Thai
 * and are flagged for the Wave-2 i18n round. Tokens back every colour (rule 6); the class
 * colours are prototype-verbatim (B-037(a), coa-rows.ts). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toCoaRow,
  filterCoa,
  groupByClass,
  natureOf,
  COA_CLASSES,
  type CoaRow,
} from "./coa-rows";
import { useCoaList } from "./use-gl";
import coaStrings from "./coa-strings.json" with { type: "json" };

const DASH = "—";

/** Phrase-key accessor for the verbatim-Thai strings kept out of this .tsx (B-073). */
const P = (k: keyof typeof coaStrings): PhraseKey => coaStrings[k] as PhraseKey;

/** Table header cell style (ds.jsx th()). */
function th(w?: number, align: "left" | "center" | "right" = "left"): CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** Kpi card, inlined from dashboard.jsx Kpi (L93-115) — web has no shared Kpi. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Dr/Cr tag, inlined from ds.jsx Tag (L273-281). tone drives a soft tinted pill. */
function Tag({ children, tone }: { children: ReactNode; tone: string }) {
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

export function GLChartOfAccounts() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const coaQ = useCoaList();
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");

  const rows = useMemo<CoaRow[]>(() => (coaQ.data ?? []).map(toCoaRow), [coaQ.data]);
  const filtered = useMemo(() => filterCoa(rows, q, cls), [rows, q, cls]);
  const groups = useMemo(() => groupByClass(filtered, cls), [filtered, cls]);

  const className = (id: string): string =>
    tp(P(("cls" + id) as keyof typeof coaStrings));

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "GL", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(tp(P("exportToast")))}>
            {t("vendor.btnExport")}
          </Btn>
          {/* No POST /gl/coa endpoint -> add is present (fidelity) but disabled (honest, C10). */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {tp(P("addBtn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip: account count + class count are real/derived; the auto-linked-modules
          card has no wire metric -> em-dash value (never fabricated). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi
          label={tp(P("kpiAllLabel"))}
          value={String(rows.length)}
          unit={tp(P("unitCode"))}
          sub={DASH}
          accent="var(--brand)"
        />
        <Kpi
          label={tp(P("kpiCatLabel"))}
          value={String(COA_CLASSES.length)}
          unit={tp(P("unitCat"))}
          sub={tp(P("kpiCatSub"))}
        />
        <Kpi
          label={tp(P("kpiLinkLabel"))}
          value={DASH}
          accent="var(--ok)"
        />
      </div>

      <Card pad={0}>
        {/* Toolbar: search + class dropdown + result count. */}
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
              placeholder={tp(P("searchPh"))}
              style={{ border: "none", outline: "none", width: 230, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value)}
            style={{
              height: 32,
              padding: "0 8px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "transparent",
              color: "var(--text-2)",
              fontSize: 11.5,
              fontFamily: "inherit",
              outline: "none",
            }}
          >
            <option value="">{tp(P("filterAll"))}</option>
            {COA_CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {className(c.id)}
              </option>
            ))}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>
            {filtered.length} {tp(P("unitCode"))}
          </span>
        </div>

        {coaQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 40, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th(90)}>{tp(P("unitCode"))}</th>
                <th style={th()}>{tp(P("thName"))}</th>
                <th style={th(200)}>{tp(P("thGroup"))}</th>
                <th style={th(70, "center")}>Dr/Cr</th>
                <th style={th(150, "right")}>{tp(P("thBalance"))}</th>
                <th style={th(90)}>{t("common.status")}</th>
                <th style={th(80)} />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ cls: c, rows: items }) => {
                const nature = natureOf(c.id);
                const drTone = nature === "Dr" ? "var(--info)" : "var(--danger)";
                return (
                  <GroupBlock
                    key={`block-${c.id}`}
                    color={c.color}
                    header={
                      <>
                        <span style={{ fontSize: 12, fontWeight: 800, color: c.color }}>
                          {tp(P("unitCat"))} {c.id} · {className(c.id)}
                        </span>
                        <span style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 8 }}>
                          {tp(P("natureWord"))} {nature} · {items.length} {tp(P("unitCode"))}
                        </span>
                      </>
                    }
                    items={items}
                    drTone={drTone}
                    natureText={nature}
                    editLabel={t("common.edit")}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

/** One class group: a spanning header row + its account rows. */
function GroupBlock({
  color,
  header,
  items,
  drTone,
  natureText,
  editLabel,
}: {
  color: string;
  header: ReactNode;
  items: readonly CoaRow[];
  drTone: string;
  natureText: string;
  editLabel: string;
}) {
  return (
    <>
      <tr
        style={{
          background: `color-mix(in srgb, ${color} 8%, white)`,
          borderTop: `2px solid color-mix(in srgb, ${color} 30%, white)`,
        }}
      >
        <td colSpan={7} style={{ padding: "8px 14px" }}>
          {header}
        </td>
      </tr>
      {items.map((r) => (
        <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
          <td style={{ ...td, fontWeight: 700, color }} className="num">
            {r.code}
          </td>
          <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
          {/* group: no wire column -> em-dash */}
          <td style={{ ...td, color: "var(--text-3)", fontSize: 11.5 }}>{DASH}</td>
          <td style={{ ...td, textAlign: "center" }}>
            <Tag tone={drTone}>{natureText}</Tag>
          </td>
          {/* balance: no wire column -> em-dash */}
          <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">
            {DASH}
          </td>
          {/* active/status: no wire column -> em-dash */}
          <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
          <td style={td}>
            {/* No PUT /gl/coa -> edit is present (fidelity) but disabled (honest, C10). */}
            <Btn kind="ghost" size="sm" icon="edit" disabled>
              {editLabel}
            </Btn>
          </td>
        </tr>
      ))}
    </>
  );
}
