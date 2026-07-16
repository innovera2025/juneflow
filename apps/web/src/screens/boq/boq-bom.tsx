/*
 * BOMTemplates — the BOM Templates screen (per-house material/labour formula), ported 1:1 from
 * pototype/bom.jsx BOMTemplates (L59-216). Route boq.bom (docs/extract/NAV-ROUTES.md L24,
 * component BOMTemplates in bom.jsx — NOT boq.jsx), visual-gate reference
 * tests/visual/reference/gallery/g1/10-s.jpg.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout is the prototype's, verbatim — the
 * two-crumb breadcrumb + title/subtitle, the two header actions (import / generate-BOQ),
 * the 260px "house model" rail (code badge + type + area·units meta + draft badge), the
 * 4-card KPI strip (cost-per-house + Material/Subcon/Labor %), the BOM line Card (header +
 * updated + Export/Edit + the M/S/L category-banded table + footer total + info-formula),
 * and the empty state for a model with no BOM.
 *
 * Data (rule 8, C10): the model rail is the REAL server catalogue — GET /models
 * (reused useModelList/toModelCard/hasBom/statusActive from ../master, same as
 * master.model). Each rail card's code / type / area / units(unit_count) / draft-status /
 * colour is a real row field, never bom.jsx's hard-coded BOM_MODELS (B-1..D-1). The KPI
 * item-count is the real bom_item_count.
 *
 * WIRE GAP (reported honestly, never fabricated — boq-overview GR precedent):
 *   • BOM LINE DETAIL — the per-house line items (cat/code/name/qty/price) live in the
 *     boms.items jsonb (packages/db `bom`, keyed by unit_type = model code), but NO endpoint
 *     returns them: GET /models exposes only bom_item_count (the length), and there is no
 *     GET /models/{id}/bom · GET /bom in the contract. There is also NO model↔boq-doc link
 *     in the schema, so the line detail CANNOT be sourced from GET /boq items either (that
 *     would fabricate a relationship — §0 rule 3). So every line-level figure is honestly
 *     em-dashed: the cost-per-house KPI value, the three category %/amount subs, every table
 *     row (the M/S/L bands render from a real BomLine[] that is empty until such an endpoint
 *     lands — boq-bom-agg.ts, unit-tested for that day), the footer total, and the
 *     info-formula total/grand. Only the units multiplier in the formula/gen-dialog is real
 *     (unit_count). Flagged to Wei: expose boms.items to light the table up.
 *   • model version ("v4") + updated-date — mock decoration with no column on `model`; the
 *     KPI version tail and the "updated {date}" line render an em-dash (never the mock string).
 *
 * i18n (rule 2): every string is a boq.bom* DICT key (t), nav.sec.boq / block.fieldModel /
 * vendor.btnExport / common.edit / boq.edCardMaterial / boq.bomCatSubcon / boq.edCardLabor
 * reused DICT keys (t), or a boq-bom-strings.json phrase (tp) — the 7 table headers, the
 * "draft" badge, the "million baht" unit. Nothing is translated anew (§0 rule 2). Comments
 * are English-only (CLAUDE.md); the Thai copy lives only in i18n-full.json / the .json sibling.
 * Tokens back every colour (rule 6); the CAT chip/KPI hexes are prototype-verbatim literals
 * with no @juneflow/tokens equivalent (B-037(a), same as boq-overview CAT).
 *
 * Deferred (not ported this round, honest no-op — boq-overview Export stub precedent): the
 * import modal (bom.jsx window.openImportBOQ) and the line-item edit form
 * (bom.jsx openLineItemForm) have no ported host yet, so their buttons are inert; the Export
 * / copy toasts + the generate-BOQ confirm ARE wired (real ctx.notify / ctx.confirm).
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useModelList } from "../master/use-models";
import { toModelCard, hasBom, statusActive, type ModelCard } from "../master/model-cards";
import { formatMoney } from "./boq-overview-agg";
import {
  BOM_CAT_ORDER,
  groupByCat,
  bomTotal,
  bomCatTotal,
  bomCatPct,
  millions2,
  lineAmount,
  type BomCat,
  type BomLine,
} from "./boq-bom-agg";
import bomStrings from "./boq-bom-strings.json" with { type: "json" };

const P = (k: keyof typeof bomStrings) => bomStrings[k] as PhraseKey;

/** Em-dash for any figure the wire cannot yet source (§0: honest em-dash, never fabricated). */
const DASH = "—";

/**
 * The baht glyph (U+0E3F) the prototype appends to the category KPI amount (bom.jsx L139-141,
 * amount + baht symbol). Built from a char code so no Thai-block char sits in this source
 * (B-073 / i18n-guard); it is a currency SYMBOL, not translatable copy — the same glyph the
 * boq.bom* money templates already carry. Only reached once the line data is wired (else em-dash).
 */
const BAHT = String.fromCharCode(0x0e3f);

/**
 * Per-category chip/KPI palette + i18n keys (bom.jsx BOM_CAT L4-8). The hexes have no
 * @juneflow/tokens equivalent so they are prototype-verbatim literals (B-037(a)); `short`
 * is the chip label key, `full` the band label key, `kpi` the KPI card label key.
 */
const CAT_META: Record<BomCat, { color: string; soft: string; short: DictKey; full: DictKey; kpi: DictKey }> = {
  M: { color: "#0F766E", soft: "#E6F4F2", short: "boq.bomCatShortMat", full: "boq.edCardMaterial", kpi: "boq.bomKpiCatMaterial" },
  S: { color: "#1D4ED8", soft: "#E5ECFB", short: "boq.bomCatShortSub", full: "boq.bomCatSubcon", kpi: "boq.bomKpiCatSubcon" },
  L: { color: "#B45309", soft: "#FEF3C7", short: "boq.bomCatShortLab", full: "boq.edCardLabor", kpi: "boq.bomKpiCatLabor" },
};

/** Interpolate {placeholder} tokens in an i18n template (no new translation — §0 rule 2). */
function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Category chip (bom.jsx BomCatChip L10-19) — short label on the soft/colour pair. */
function BomCatChip({ cat, label, size = "md" }: { cat: BomCat; label: string; size?: "sm" | "md" }) {
  const c = CAT_META[cat];
  return (
    <span
      style={{
        fontSize: size === "sm" ? 9.5 : 10.5,
        fontWeight: 700,
        padding: size === "sm" ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        background: c.soft,
        color: c.color,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** KPI card (bom.jsx Kpi usage L138-141) — label + big value(+unit) + sub. */
function KpiCard({
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
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && (
        <div className="num" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

/** Table header cell (bom.jsx bomTh L218-222). */
function bomTh(w?: number, align: "left" | "right" = "left"): CSSProperties {
  return {
    padding: "10px 14px",
    textAlign: align,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell (bom.jsx bomTd L223). */
const bomTd: CSSProperties = { padding: "10px 14px", verticalAlign: "middle" };

/** List-card header with the (code) in muted mono (bom.jsx L146). Splits the template so
 *  only the {code} span is styled, keeping the Thai text verbatim from the i18n key. */
function ListHeader({ tpl, type, code }: { tpl: string; type: string; code: string }) {
  const [head, tail = ""] = tpl.split("{code}");
  return (
    <div style={{ fontSize: 13.5, fontWeight: 700 }}>
      {head.replace("{type}", type)}
      <span className="num" style={{ color: "var(--text-3)", fontWeight: 600 }}>
        {code}
      </span>
      {tail}
    </div>
  );
}

export function BOMTemplates() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  // Model rail — the real /models catalogue (reused hook + mappers from master.model).
  const modelsQ = useModelList();
  const models: ModelCard[] = (modelsQ.data ?? []).map(toModelCard);

  // Selected model code (bom.jsx `sel`, default the first model — prototype defaults "B-1").
  const [sel, setSel] = useState<string>("");
  const activeCode = sel || models[0]?.code || "";
  const selected = models.find((m) => m.code === activeCode);
  const modelHasBom = selected ? hasBom(selected) : false;

  // BOM line detail — WIRE GAP (header): no endpoint returns boms.items, so this stays
  // empty (the M/S/L bands + every money figure em-dash). When such an endpoint lands, feed
  // it here (parseBomLines) and the unit-tested agg lights the table up unchanged.
  const lines: BomLine[] = [];
  const linesAvailable = lines.length > 0;
  const groups = groupByCat(lines);

  const genBOQ = () => {
    if (!selected) return;
    ctx.confirm({
      title: fill(t("boq.bomGenTitle"), { code: selected.code }),
      icon: "budget",
      iconTone: "var(--brand)",
      message: (
        <span>
          {t("boq.bomGenMsgLine1")}
          <br />
          {fill(t("boq.bomGenMsgLine2"), {
            n: String(selected.bom_item_count),
            units: String(selected.unit_count),
            // total × units — total is unwired (no line prices), so the product em-dashes.
            value: linesAvailable ? formatMoney(bomTotal(lines) * selected.unit_count) : DASH,
          })}
        </span>
      ),
      onConfirm: () => ctx.notify(fill(t("boq.bomGenToast"), { code: selected.code })),
    });
  };

  return (
    <Page
      breadcrumbs={[t("nav.sec.boq"), t("boq.bomBreadcrumbLeaf")]}
      title={t("boq.bomTitle")}
      subtitle={t("boq.bomSubtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Import opens a modal not ported yet — inert (boq-overview Export stub precedent). */}
          <Btn kind="outline" size="md" icon="upload">
            {t("boq.bomImport")}
          </Btn>
          <Btn kind="primary" size="md" icon="budget" onClick={genBOQ} disabled={!modelHasBom}>
            {t("boq.bomGenBoq")}
          </Btn>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
        {/* Model rail */}
        <Card pad={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 700 }}>
            {t("block.fieldModel")}
          </div>
          <div style={{ padding: 8 }}>
            {models.map((m) => {
              const on = m.code === activeCode;
              return (
                <div
                  key={m.id || m.code}
                  onClick={() => setSel(m.code)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 11px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: on ? "var(--brand-soft)" : "transparent",
                    marginBottom: 2,
                    border: `1px solid ${on ? "var(--brand)" : "transparent"}`,
                  }}
                >
                  <span
                    className="num"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 7,
                      background: m.color || "var(--brand)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11.5,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {m.code}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: on ? 700 : 600,
                        color: on ? "var(--brand)" : "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.type}
                    </div>
                    <div className="num" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>
                      {fill(t("boq.bomModelMeta"), { area: String(m.area), units: String(m.unit_count) })}
                    </div>
                  </div>
                  {!statusActive(m) && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "var(--warn-soft)",
                        color: "var(--warn)",
                      }}
                    >
                      {tp(P("draft"))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* BOM detail */}
        <div>
          {!selected ? (
            <Card pad={0}>
              <div style={{ padding: 20 }}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    style={{ height: 40, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
                  />
                ))}
              </div>
            </Card>
          ) : !modelHasBom ? (
            <Card pad={0}>
              <div style={{ padding: 60, textAlign: "center" }}>
                <Icon name="grid" size={34} color="var(--text-3)" style={{ opacity: 0.5 }} />
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 12 }}>
                  {fill(t("boq.bomEmptyTitle"), { type: selected.type, code: selected.code })}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-3)",
                    marginTop: 6,
                    maxWidth: 360,
                    marginInline: "auto",
                    lineHeight: 1.6,
                  }}
                >
                  {t("boq.bomEmptyDesc")}
                </div>
                <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center" }}>
                  <Btn kind="outline" size="md" icon="copy" onClick={() => ctx.notify(t("boq.bomCopyToast"))}>
                    {t("boq.bomCopyOther")}
                  </Btn>
                  {/* Import modal not ported — inert (deferred). */}
                  <Btn kind="primary" size="md" icon="upload">
                    {t("boq.bomImport")}
                  </Btn>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* KPIs — cost-per-house + the three category shares. Every value/amount is a
                  line-level figure the wire does not expose (header), so it em-dashes; only
                  the item count (bom_item_count) is real. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
                <KpiCard
                  label={t("boq.bomKpiCostPerHouse")}
                  value={linesAvailable ? millions2(bomTotal(lines)) : DASH}
                  unit={tp(P("millionBaht"))}
                  sub={fill(t("boq.bomKpiItemsVer"), { n: String(selected.bom_item_count), ver: DASH })}
                  accent="var(--brand)"
                />
                {BOM_CAT_ORDER.map((cat) => (
                  <KpiCard
                    key={cat}
                    label={t(CAT_META[cat].kpi)}
                    value={linesAvailable ? `${bomCatPct(lines, cat)}%` : DASH}
                    sub={linesAvailable ? `${formatMoney(bomCatTotal(lines, cat))} ${BAHT}` : DASH}
                    accent={CAT_META[cat].color}
                  />
                ))}
              </div>

              <Card pad={0}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                  <ListHeader tpl={t("boq.bomListHeader")} type={selected.type} code={selected.code} />
                  {/* updated date — no `updated` column on `model`, so em-dash (never the mock). */}
                  <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {fill(t("boq.bomUpdatedAt"), { date: DASH })}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <Btn kind="ghost" size="sm" icon="download" onClick={() => ctx.notify(t("boq.bomExportToast"))}>
                      {t("vendor.btnExport" as DictKey)}
                    </Btn>
                    {/* Line-item edit form not ported — inert (deferred). */}
                    <Btn kind="soft" size="sm" icon="edit">
                      {t("common.edit" as DictKey)}
                    </Btn>
                  </div>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                      <th style={bomTh(54)}>{tp(P("thCat"))}</th>
                      <th style={bomTh(86)}>{tp(P("thCode"))}</th>
                      <th style={bomTh()}>{tp(P("thItem"))}</th>
                      <th style={bomTh(70, "right")}>{tp(P("thQty"))}</th>
                      <th style={bomTh(70)}>{tp(P("thUnit"))}</th>
                      <th style={bomTh(110, "right")}>{tp(P("thPrice"))}</th>
                      <th style={bomTh(130, "right")}>{tp(P("thTotal"))}</th>
                    </tr>
                  </thead>
                  {/* Category bands render from the real BomLine[] (empty until boms.items is
                      exposed — header). The band/row markup is the prototype's, so the table
                      lights up unchanged the day the endpoint lands. */}
                  {groups.map((g) => (
                    <tbody key={g.cat}>
                      <tr style={{ background: "var(--surface)" }}>
                        <td colSpan={7} style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <BomCatChip cat={g.cat} label={t(CAT_META[g.cat].short)} size="sm" />
                            <b style={{ fontSize: 11.5, color: "var(--text-2)" }}>{t(CAT_META[g.cat].full)}</b>
                            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
                              {fill(t("boq.bomCatGroupSummary"), { n: String(g.count), value: formatMoney(g.total) })}
                            </span>
                          </span>
                        </td>
                      </tr>
                      {g.rows.map((l, i) => (
                        <tr key={`${g.cat}-${l.code}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={bomTd}>
                            <BomCatChip cat={l.cat} label={t(CAT_META[l.cat].short)} size="sm" />
                          </td>
                          <td style={bomTd} className="num">
                            <span style={{ color: "var(--text-3)" }}>{l.code}</span>
                          </td>
                          <td style={bomTd}>
                            <div style={{ fontWeight: 600 }}>{l.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{l.detail}</div>
                          </td>
                          <td style={{ ...bomTd, textAlign: "right" }} className="num">
                            {formatMoney(l.qty)}
                          </td>
                          <td style={bomTd}>{l.unit}</td>
                          <td style={{ ...bomTd, textAlign: "right" }} className="num">
                            {formatMoney(l.price)}
                          </td>
                          <td style={{ ...bomTd, textAlign: "right", fontWeight: 700 }} className="num">
                            {formatMoney(lineAmount(l))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                  <tfoot>
                    <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--surface-2)" }}>
                      <td colSpan={6} style={{ padding: "12px 14px", fontWeight: 700, fontSize: 13 }}>
                        {fill(t("boq.bomFootTotal"), { type: selected.type })}
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        <span className="num" style={{ fontWeight: 800, fontSize: 15, color: "var(--brand)" }}>
                          {linesAvailable ? formatMoney(bomTotal(lines)) : DASH}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 16px",
                    background: "var(--surface-2)",
                    borderTop: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--text-2)",
                  }}
                >
                  <Icon name="info" size={15} color="var(--accent)" />
                  <span>{renderInfoFormula(t("boq.bomInfoFormula"), linesAvailable ? formatMoney(bomTotal(lines)) : DASH, String(selected.unit_count), linesAvailable ? formatMoney(bomTotal(lines) * selected.unit_count) : DASH)}</span>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

/**
 * Render the info-formula template (bom.jsx L207), bolding the {total}/{units}/{grand}
 * numbers like the prototype. The surrounding Thai text (including the baht currency glyph)
 * comes verbatim from the boq.bomInfoFormula key — no literal Thai/baht sits in this source.
 */
function renderInfoFormula(template: string, total: string, units: string, grand: string): ReactNode {
  // Split on the three placeholders in order, keeping the i18n text between them.
  const [a, restA = ""] = template.split("{total}");
  const [b, restB = ""] = restA.split("{units}");
  const [c, d = ""] = restB.split("{grand}");
  return (
    <>
      {a}
      <b className="num" style={{ color: "var(--text)" }}>{total}</b>
      {b}
      <b className="num">{units}</b>
      {c}
      <b className="num" style={{ color: "var(--brand)" }}>{grand}</b>
      {d}
    </>
  );
}
