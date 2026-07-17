/*
 * BOQEditor — the BOQ Editor screen, ported 1:1 from pototype/boq.jsx BOQEditor (L362-848),
 * BOQEditorRow (L857-919), BOQItemForm (L922-1035) + boq-extra.jsx BudgetControlBar
 * (L201-258) / BOQLockedBanner (L183-196). Route boq.editor (docs/extract/NAV-ROUTES.md
 * L25). No named visual-gate reference exists for this screen (gallery is numbered); the
 * prototype JSX is the authoritative fidelity source (§0 rule 1).
 *
 * Design fidelity (§0 rule 1): the layout is the prototype's, verbatim — the three-crumb
 * breadcrumb (section · "BOQ Editor" · doc-no), the topbar actions (BOQ List · edit-history ·
 * print · {save-draft + send-approve | create-revise}), the full-bleed doc header (no + status
 * badge + lock/revise/fresh chips + name + the BOM/by-Model/by-Block level toggle), the
 * locked banner, the 4-card M/S/L + group-total summary strip, the CBS Budget-Control bar,
 * the groups panel (left) + item editor (right) with its toolbar (group·count + search + the
 * MAT/SUB/LAB category chips + Template/Import/add), the bulk-action bar, the 11-column item
 * table + group-total tfoot, and the fresh-doc empty state.
 *
 * Data (§0 rule 3 + rule 8, C10): the prototype's INITIAL_GROUPS / INITIAL_ROWS_BY_GROUP /
 * CBS_BUDGET mock is dropped — the editor reads the REAL server document through the
 * generated client (GET /boq -> resolve the active doc by ctx.params.no else first; GET
 * /boq/{id} -> groups + per-group CBS; GET /boq/{id}/items -> priced lines) and derives every
 * figure (M/S/L totals, group values, all-groups total, CBS available). Pure logic is in
 * boq-editor-agg.ts (unit-tested, gate G3); the hooks are in use-boq-editor.ts. It WRITES
 * through the real endpoints: add-item + duplicate = POST /boq/{id}/items; generate-PR =
 * POST /boq/{id}/generate-pr (M/S split + cut-remain, server-side); send-approve =
 * POST /boq/{id}/submit; create-revise = POST /boq/{id}/revise.
 *
 * WIRE GAPS (reported honestly, never fabricated):
 *  1. boq_item has NO `detail` column, so the detail cell renders an em-dash and the
 *     toolbar search runs over name+code only.
 *  2. the wire returns only `cc_id` (no cost-center name); the "Cost Name" cell resolves
 *     cc_id -> {code,name} via GET /cost-centers when present, else an em-dash.
 *  3. POST /boq/{id}/items persists only { group_id, code, name, cat, qty, unit, price,
 *     currency_code }; the add-modal's Cost-Center + detail inputs do NOT persist (shown for
 *     fidelity, boq-list NewBOQForm precedent). The unit preset dropdown is simplified to a
 *     free-text input (no Thai unit literals fabricated in source).
 *  4. no update/delete/group-CRUD endpoint exists: edit-item, delete-item(s), move-group,
 *     add/rename/delete group, and the empty-state start-from options are deferred stubs
 *     (add + duplicate are real creates). The edit-history drawer + Template/Import have no
 *     backend, so they are deferred stubs too. save-draft + print are keyed notify-only
 *     (matching the prototype, which is also a pure notify).
 *  5. the per-row "opened-PR" badge is set from the generate-pr response for the session; on
 *     reload a partially-PR'd item (remain_qty < qty) is not badged (no per-item PR-no on the
 *     items wire) — never invented.
 *
 * i18n (§0 rule 2): every string is a boq.ed* / boq.list* / boq.ov* / common. / nav.sec.boq
 * dict key (t), a nav label (tn), or a boq-editor-strings.json phrase (tp) verified present
 * in i18n-full.json. Comments are English-only (CLAUDE.md); Thai lives only in the keys.
 * Tokens back every colour (rule 6); the CAT chip hexes are prototype-verbatim (B-037(a)).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey, NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { TopBar } from "../../shell/topbar";
import { useShellCtx } from "../../shell/shell-context";
import { toCostCenterRow } from "../master/cc-rows";
import {
  useBoqList,
  useBoqDetail,
  useBoqItems,
  useCostCenterList,
  useAddBoqItem,
  useGeneratePr,
  useSubmitBoq,
  useReviseBoq,
} from "./use-boq-editor";
import {
  toBoqRow,
  toEditorItem,
  toEditorGroups,
  groupItemsByGroup,
  sumLineTotals,
  categoryTotals,
  filterEditorRows,
  cbsRows,
  cbsTotals,
  ccNameById,
  resolveDoc,
  isReadOnly,
  canSubmitItem,
  buildAddItemBody,
  buildDuplicateBody,
  buildGeneratePrBody,
  generatedPrNos,
  formatMoney,
  formatDec,
  bahtK,
  versionLabel,
  pct1,
  lineTotal,
  type EditorItem,
  type EditorGroup,
  type ItemCat,
} from "./boq-editor-agg";
import editorStrings from "./boq-editor-strings.json" with { type: "json" };

const S = (k: keyof typeof editorStrings) => editorStrings[k] as PhraseKey;

/** Baht glyph (U+0E3F) — a currency SYMBOL, not translatable copy (boq-overview precedent). */
const BAHT = String.fromCharCode(0x0e3f);

/**
 * Category chip palette — prototype-verbatim (boq.jsx CAT, L3-7); these hexes have no
 * @juneflow/tokens equivalent, so they are copied literally (B-037(a)).
 */
const CAT: Record<ItemCat, { short: string; color: string; soft: string }> = {
  M: { short: "MAT", color: "#0F766E", soft: "#E6F4F2" },
  S: { short: "SUB", color: "#1D4ED8", soft: "#E5ECFB" },
  L: { short: "LAB", color: "#B45309", soft: "#FEF3C7" },
};

/** Category chip (boq.jsx CatChip L9-20). */
function CatChip({ cat, small = false }: { cat: ItemCat; small?: boolean }) {
  const c = CAT[cat];
  return (
    <span
      style={{
        fontSize: small ? 9.5 : 10.5,
        fontWeight: 700,
        padding: small ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        background: c.soft,
        color: c.color,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {c.short}
    </span>
  );
}

/** Table header cell style, ported from ds.jsx th() (L214-219) — the shared helper the
 *  prototype's BOQEditor table uses (uppercase + 0.05em tracking; gallery g1/11 headers). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    whiteSpace: "nowrap",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td() (L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Row "…" popover menu item (boq.jsx menuItem L850-854). */
const menuItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  fontSize: 12,
  cursor: "pointer",
  borderRadius: 5,
  fontWeight: 500,
};

/** Native-input style (new-boq-form fieldStyle). */
function fieldStyle(bad = false): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: `1px solid ${bad ? "var(--danger)" : "var(--border)"}`,
    borderRadius: 7,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
  };
}

/* ── CBS Budget-Control bar (boq-extra.jsx BudgetControlBar L201-258) ─────────── */

function BudgetControlBar({
  groups,
  t,
  tp,
}: {
  groups: readonly EditorGroup[];
  t: (k: DictKey) => string;
  tp: (k: PhraseKey) => string;
}) {
  const rows = cbsRows(groups);
  const tot = cbsTotals(rows);
  const totals: [string, number, string][] = [
    [t("boq.edCbsBudget"), tot.budget, "var(--text)"],
    [t("boq.ovThUsed"), tot.used, "var(--brand)"],
    [t("boq.edCbsCommitted"), tot.committed, "var(--warn)"],
    [tp(S("cbsRemain")), tot.available, tot.available < 0 ? "var(--danger)" : "var(--ok)"],
  ];
  return (
    <Card pad={0}>
      <div
        style={{
          padding: "13px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Icon name="pie" size={16} color="var(--brand)" />
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t("boq.edCbsTitle")}</div>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("boq.edCbsSubtitle")}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11.5 }}>
          {totals.map(([l, v, c]) => (
            <span key={l} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ color: "var(--text-3)", fontSize: 10 }}>{l}</span>
              <span className="num" style={{ fontWeight: 700, color: c }}>
                {formatMoney(v)}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ padding: "8px 18px 14px" }}>
        {rows.map((r) => (
          <div key={r.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 5,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                {r.label}
                {r.over && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--danger-soft)",
                      color: "var(--danger)",
                    }}
                  >
                    <Icon name="alert" size={10} /> {tp(S("cbsOver"))}
                  </span>
                )}
              </span>
              <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
                {t("boq.edCbsDetail")
                  .replace("{used}", bahtK(r.used))
                  .replace("{committed}", bahtK(r.committed))
                  .replace("{budget}", bahtK(r.budget))
                  .replace("{available}", bahtK(r.available))}
              </span>
            </div>
            <div style={{ display: "flex", height: 12, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(r.usedPct, 100)}%`, background: "var(--brand)" }} />
              <div
                style={{
                  width: `${Math.min(r.commPct, Math.max(0, 100 - r.usedPct))}%`,
                  background: "var(--warn)",
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.35) 3px, rgba(255,255,255,0.35) 6px)",
                }}
              />
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: "var(--brand)", borderRadius: 2 }} />
            {t("boq.edCbsLegUsed")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: "var(--warn)", borderRadius: 2 }} />
            {t("boq.edCbsLegCommit")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: "var(--surface-3)", borderRadius: 2 }} />
            {tp(S("cbsRemainUsable"))}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ── Item row (boq.jsx BOQEditorRow L857-919) ────────────────────────────────── */

function ItemRow({
  row,
  costName,
  costCode,
  prNo,
  readOnly,
  selected,
  onToggle,
  onDup,
  onDel,
  t,
  tp,
}: {
  row: EditorItem;
  costName: string | null;
  costCode: string | null;
  prNo: string | undefined;
  readOnly: boolean;
  selected: boolean;
  onToggle: () => void;
  onDup: () => void;
  onDel: () => void;
  t: (k: DictKey) => string;
  tp: (k: PhraseKey) => string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const c = CAT[row.cat];
  const total = lineTotal(row);
  return (
    <tr
      style={{
        borderTop: "1px solid var(--border)",
        borderLeft: `3px solid ${c.color}`,
        background: selected
          ? "var(--brand-soft)"
          : prNo
            ? "color-mix(in srgb, var(--ok-soft) 45%, white)"
            : "transparent",
      }}
    >
      <td style={td}>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td style={{ ...td, color: "var(--text-3)" }} className="num">
        {row.code}
      </td>
      <td style={td}>
        <CatChip cat={row.cat} small />
      </td>
      <td style={{ ...td, fontWeight: 500 }}>
        {row.name}
        {prNo && (
          <span
            className="num"
            style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 4,
              background: "var(--ok-soft)",
              color: "var(--ok)",
            }}
          >
            {t("boq.edPrMarked").replace("{prNo}", prNo)}
          </span>
        )}
      </td>
      {/* WIRE GAP 1: boq_item has no `detail` column -> honest em-dash. */}
      <td style={{ ...td, color: "var(--text-2)", fontSize: 11.5 }}>—</td>
      {/* WIRE GAP 2: cost NAME resolved from cc_id via GET /cost-centers (else em-dash). */}
      <td style={td}>
        {costName ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{costName}</span>
            {costCode && <span className="num" style={{ fontSize: 9.5, color: "var(--text-3)" }}>{costCode}</span>}
          </div>
        ) : (
          <span style={{ color: "var(--text-3)" }}>—</span>
        )}
      </td>
      <td style={{ ...td, textAlign: "right" }} className="num">
        {formatMoney(row.qty)}
      </td>
      <td style={{ ...td, color: "var(--text-3)" }}>{row.unit || "—"}</td>
      <td style={{ ...td, textAlign: "right" }} className="num">
        {formatDec(row.price)}
      </td>
      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
        {formatMoney(total)}
      </td>
      <td style={{ ...td, position: "relative" }}>
        {readOnly ? (
          <Icon name="lock" size={13} color="var(--text-3)" style={{ opacity: 0.5 }} />
        ) : (
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              width: 24,
              height: 24,
              border: "none",
              background: menuOpen ? "var(--surface-3)" : "transparent",
              cursor: "pointer",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="more" size={14} color="var(--text-3)" />
          </button>
        )}
        {menuOpen && !readOnly && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
            <div
              style={{
                position: "absolute",
                top: 30,
                right: 6,
                zIndex: 30,
                width: 140,
                background: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 4,
                boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
                textAlign: "left",
              }}
            >
              {/* WIRE GAP 4: no update endpoint — edit is a deferred stub. */}
              <div onClick={() => setMenuOpen(false)} style={menuItem}>
                <Icon name="edit" size={12} /> {t("common.edit")}
              </div>
              {/* Duplicate = a REAL create (POST /boq/{id}/items with a -COPY code). */}
              <div
                onClick={() => {
                  setMenuOpen(false);
                  onDup();
                }}
                style={menuItem}
              >
                <Icon name="plus" size={12} /> {tp(S("duplicate"))}
              </div>
              {/* WIRE GAP 4: no delete endpoint — deferred stub. */}
              <div
                onClick={() => {
                  setMenuOpen(false);
                  onDel();
                }}
                style={{ ...menuItem, color: "var(--danger)" }}
              >
                <Icon name="x" size={12} color="var(--danger)" /> {tp(S("deleteItem"))}
              </div>
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

/* ── Add-item modal body (boq.jsx BOQItemForm L922-1035; add-mode only) ───────── */

function ItemFormModal({
  docId,
  groupId,
  groupLabel,
  onClose,
}: {
  docId: string;
  groupId: string;
  groupLabel: string;
  onClose: () => void;
}) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();
  const addItem = useAddBoqItem(docId);
  const ccQ = useCostCenterList();
  const costCenters = useMemo(() => (ccQ.data ?? []).map(toCostCenterRow), [ccQ.data]);

  const [cat, setCat] = useState<ItemCat>("M");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [ccId, setCcId] = useState("");
  const [detail, setDetail] = useState("");
  const [unit, setUnit] = useState("");
  const [qtyStr, setQtyStr] = useState("1");
  const [priceStr, setPriceStr] = useState("0");

  const qty = Number.parseFloat(qtyStr) || 0;
  const price = Number.parseFloat(priceStr) || 0;
  const total = qty * price;
  const canSubmit = canSubmitItem(code, name, qty) && !addItem.isPending;

  const catWord =
    cat === "M" ? tp(S("catWordMaterial")) : cat === "S" ? t("boq.edCatShortSubcon") : tp(S("catWordLabor"));

  const submit = () => {
    if (!canSubmit) return;
    const body = buildAddItemBody(groupId, { cat, code, name, unit, qty, price, currencyCode: "THB" });
    addItem.mutate(body, {
      onSuccess: () => {
        ctx.notify(t("boq.edItemAddToast"));
        onClose();
      },
    });
  };

  const CAT_LABEL: Record<ItemCat, DictKey> = {
    M: "boq.edCatMaterial",
    S: "boq.edCatSubcon",
    L: "boq.edCatLabor",
  };

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
          {t("boq.edItemTypeLabel")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {(Object.keys(CAT) as ItemCat[]).map((k) => {
            const c = CAT[k];
            const on = cat === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                style={{
                  padding: "10px 8px",
                  background: on ? c.soft : "var(--surface)",
                  border: `1.5px solid ${on ? c.color : "var(--border)"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }} />
                <span style={{ fontSize: 12, fontWeight: on ? 700 : 500, color: on ? c.color : "var(--text-2)" }}>
                  {t(CAT_LABEL[k])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("boq.edFldItemCode")} required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className="num" style={fieldStyle()} />
        </Field>
        <Field label={t("boq.edFldItemName")} required>
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle()} />
        </Field>
        {/* WIRE GAP 3: Cost Center does not persist through POST items — shown for fidelity. */}
        <Field label={t("boq.edFldCostCenter")} required style={{ gridColumn: "1 / 3" }}>
          <select value={ccId} onChange={(e) => setCcId(e.target.value)} style={fieldStyle()}>
            <option value="">{t("boq.edCostCenterPh")}</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.code} · {cc.name}
              </option>
            ))}
          </select>
        </Field>
        {/* WIRE GAP 3: detail has no wire column — shown for fidelity, not persisted. */}
        <Field label={tp(S("thDetail"))} style={{ gridColumn: "1 / 3" }}>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} style={fieldStyle()} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("boq.edFldQty")} required>
          <input value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} className="num" style={fieldStyle()} />
        </Field>
        {/* WIRE GAP 3: preset unit dropdown simplified to a free-text input (unit is free-text). */}
        <Field label={tp(S("fldUnit"))} required>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle()} />
        </Field>
        <Field label={t("boq.edFldPriceUnit")} required>
          <div style={{ position: "relative" }}>
            <input
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              className="num"
              style={{ ...fieldStyle(), paddingRight: 24 }}
            />
            <span style={{ position: "absolute", right: 10, top: 9, fontSize: 12, color: "var(--text-3)" }}>{BAHT}</span>
          </div>
        </Field>
      </div>

      <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>{t("boq.edItemTotalValue")}</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>
              {formatMoney(total)} {BAHT}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "right" }}>
            <div>{catWord}</div>
            <div>{t("boq.edAddToGroup").replace("{group}", groupLabel)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
          {t("boq.edAddItemUpdate")}
        </Btn>
      </div>
    </>
  );
}

/* ── Create-Revise modal body (boq-extra.jsx BOQRevise; status-flip only) ─────── */

function ReviseForm({
  docId,
  no,
  nextVer,
  onClose,
}: {
  docId: string;
  no: string;
  nextVer: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const revise = useReviseBoq(docId);
  const [reason, setReason] = useState("");

  const submit = () => {
    revise.mutate(undefined, {
      onSuccess: () => {
        ctx.notify(t("boq.edReviseToast").replace("{no}", no).replace("{ver}", nextVer));
        onClose();
      },
    });
  };

  return (
    <>
      {/* The reason + scope inputs are shown for fidelity; boq_doc has no reason/scope-of-
          change column, so they do NOT persist (only the status flip is real). */}
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 14 }}>{t("boq.edReviseCopyNote")}</div>
      <Field label={t("boq.edReviseReasonLabel")} style={{ marginBottom: 16 }}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("boq.edReviseReasonPh")}
          rows={3}
          style={{ ...fieldStyle(), height: "auto", padding: 10, resize: "vertical" }}
        />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={revise.isPending}>
          {t("boq.edReviseSubmit").replace("{ver}", nextVer)}
        </Btn>
      </div>
    </>
  );
}

/* ── Main screen ─────────────────────────────────────────────────────────────── */

export function BOQEditor() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const paramNo = typeof ctx.params.no === "string" ? ctx.params.no : "";

  // Real data sources.
  const boqQ = useBoqList();
  const docs = useMemo(() => (boqQ.data ?? []).map(toBoqRow), [boqQ.data]);
  const doc = resolveDoc(docs, paramNo);
  const docId = doc?.id;

  const detailQ = useBoqDetail(docId);
  const itemsQ = useBoqItems(docId);
  const ccQ = useCostCenterList();
  const submitBoq = useSubmitBoq(docId);
  const generatePr = useGeneratePr(docId);
  // One shared mutation drives every row-level duplicate (a hook cannot be called per row);
  // it is a REAL create (POST /boq/{id}/items with a -COPY code), invalidating the same keys.
  const dupItem = useAddBoqItem(docId);

  const groups = useMemo(
    () => toEditorGroups((detailQ.data?.groups as Record<string, unknown>[]) ?? undefined),
    [detailQ.data],
  );
  const allItems = useMemo(() => (itemsQ.data ?? []).map(toEditorItem), [itemsQ.data]);
  const byGroup = useMemo(() => groupItemsByGroup(allItems), [allItems]);
  const ccMap = useMemo(() => ccNameById(ccQ.data), [ccQ.data]);

  // Local UI state (level = display-only toggle; matches the prototype).
  const [level, setLevel] = useState<string>(
    typeof ctx.params.level === "string" ? ctx.params.level : "byblock",
  );
  const [activeGroupId, setActiveGroupId] = useState("");
  const [catFilter, setCatFilter] = useState<Set<ItemCat>>(new Set());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prMarked, setPrMarked] = useState<Record<string, string>>({});
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);

  const effectiveGroupId = activeGroupId || groups[0]?.id || "";
  const activeGroup = groups.find((g) => g.id === effectiveGroupId) ?? groups[0];
  const activeRows = byGroup.get(effectiveGroupId) ?? [];
  const displayedRows = filterEditorRows(activeRows, catFilter, search);
  const totals = categoryTotals(activeRows);
  const allGroupsTotal = sumLineTotals(allItems);
  const readOnly = doc ? isReadOnly(doc.status) : false;
  const ver = doc ? versionLabel(doc.version) : "";
  const docNo = doc?.no ?? "";

  const loading = boqQ.isLoading || (!!docId && (detailQ.isLoading || itemsQ.isLoading));

  const toggleCat = (k: ItemCat) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allDisplayedSelected = displayedRows.length > 0 && displayedRows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allDisplayedSelected) setSelected(new Set());
    else setSelected(new Set(displayedRows.map((r) => r.id)));
  };

  const openItemModal = () => {
    if (!docId || !activeGroup) return;
    ctx.openModal({
      title: t("boq.edItemAddTitle"),
      subtitle: t("boq.edItemSubtitle").replace("{group}", activeGroup.name),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <ItemFormModal docId={docId} groupId={activeGroup.id} groupLabel={activeGroup.name} onClose={close} />
      ),
    });
  };

  const openReviseModal = () => {
    if (!docId || !doc) return;
    const nextVer = versionLabel(doc.version + 1);
    ctx.openModal({
      title: t("boq.edReviseTitle"),
      subtitle: t("boq.edReviseSubtitle").replace("{no}", docNo).replace("{ver}", ver),
      icon: "edit",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <ReviseForm docId={docId} no={docNo} nextVer={nextVer} onClose={close} />
      ),
    });
  };

  const duplicateRow = (row: EditorItem) => {
    if (!docId) return;
    dupItem.mutate(buildDuplicateBody(row), {
      onSuccess: () => ctx.notify(t("boq.edDupRowToast")),
    });
  };

  const doGeneratePr = () => {
    if (!docId || selected.size === 0) return;
    const ids = [...selected];
    generatePr.mutate(buildGeneratePrBody(ids), {
      onSuccess: (resp) => {
        const nos = generatedPrNos(resp);
        const prNo = nos[0] ?? "";
        if (prNo) {
          setPrMarked((prev) => {
            const next = { ...prev };
            for (const id of ids) next[id] = prNo;
            return next;
          });
          ctx.notify(t("boq.edPrMarked").replace("{prNo}", nos.join(" · ")));
        }
        setSelected(new Set());
      },
      // No generic error-toast key exists (i18n has none); the mutation error is non-fatal
      // (e.g. 409 when the doc is not yet approved) and the selection is retained.
    });
  };

  const doSendApprove = () => {
    if (!docId) return;
    ctx.confirm({
      title: t("boq.edSendApproveTitle"),
      subtitle: `${docNo} · ${ver}`,
      icon: "check",
      iconTone: "var(--brand)",
      message: t("boq.edSendApproveMsg").replace("{value}", formatMoney(allGroupsTotal)),
      onConfirm: () => {
        submitBoq.mutate(undefined, {
          onSuccess: () => {
            ctx.notify(t("boq.edSendApproveToast"));
            ctx.navigate("boq.approval");
          },
        });
      },
    });
  };

  // Breadcrumbs: section · "BOQ Editor" · doc-no (once resolved).
  const crumbs = [t("nav.sec.boq"), tn(editorStrings.navBoqEditor as NavKey)];
  if (docNo) crumbs.push(docNo);

  const actions = (
    <div style={{ display: "flex", gap: 8 }}>
      <Btn kind="ghost" size="md" icon="list" onClick={() => ctx.navigate("boq.list")}>
        {tn(editorStrings.navBoqList as NavKey)}
      </Btn>
      {/* Edit-history drawer has no backend audit source — deferred stub (WIRE GAP 4). */}
      <Btn kind="ghost" size="md" icon="history">
        {tp(S("auditHistory"))}
      </Btn>
      <Btn
        kind="ghost"
        size="md"
        icon="print"
        onClick={() => docNo && ctx.notify(t("boq.edPrintToast").replace("{docNo}", docNo))}
      >
        {t("common.print")}
      </Btn>
      {readOnly ? (
        <Btn kind="primary" size="md" icon="edit" onClick={openReviseModal}>
          {t("boq.edCreateRevise")}
        </Btn>
      ) : (
        <>
          <Btn kind="outline" size="md" onClick={() => ctx.notify(t("boq.edSaveDraftToast"))}>
            {t("common.saveDraft")}
          </Btn>
          <Btn kind="primary" size="md" icon="check" onClick={doSendApprove}>
            {t("common.submit")}
          </Btn>
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar breadcrumbs={crumbs} actions={actions} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 24 }}>
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                style={{ height: 64, marginBottom: 12, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : !doc ? (
          // No BOQ docs at all — nothing to edit; offer a route to the list.
          <div style={{ padding: 24 }}>
            <Card pad={40} style={{ textAlign: "center", maxWidth: 480, margin: "40px auto 0" }}>
              <Icon name="budget" size={32} color="var(--text-3)" style={{ opacity: 0.6 }} />
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700 }}>{t("boq.edEmptyTitle")}</div>
              <div style={{ marginTop: 14 }}>
                <Btn kind="primary" size="md" icon="list" onClick={() => ctx.navigate("boq.list")}>
                  {tn(editorStrings.navBoqList as NavKey)}
                </Btn>
              </div>
            </Card>
          </div>
        ) : (
          <>
            {/* Doc header (full-bleed) */}
            <div style={{ padding: "18px 24px", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <h1 className="num" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                      {docNo}
                    </h1>
                    <StatusBadge status={doc.status} ver={ver} tp={tp} />
                    {readOnly && (
                      <span style={{ fontSize: 11, color: "#7C5BBF", fontWeight: 600 }}>{t("boq.edLockBadge")}</span>
                    )}
                    {doc.status === "revise" && (
                      <span style={{ fontSize: 11, color: "var(--brand)", fontWeight: 600 }}>{t("boq.edReviseBadge")}</span>
                    )}
                    {groups.length === 0 && (
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("boq.edFreshBadge")}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>{doc.name}</div>
                </div>
                {/* Level toggle (display-only, boq.jsx L576-588). */}
                <div style={{ display: "inline-flex", borderRadius: 8, border: "1px solid var(--border)", padding: 3, background: "var(--surface)" }}>
                  {(
                    [
                      { id: "bom", l: t("boq.edLevelBomHouse") },
                      { id: "byunit", l: t("boq.listLevelByUnit") },
                      { id: "byblock", l: t("boq.listLevelByBlock") },
                    ] as const
                  ).map((lv) => (
                    <button
                      key={lv.id}
                      type="button"
                      onClick={() => setLevel(lv.id)}
                      style={{
                        padding: "8px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 6,
                        background: level === lv.id ? "var(--brand)" : "transparent",
                        color: level === lv.id ? "#fff" : "var(--text-2)",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {lv.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Locked banner (boq-extra.jsx BOQLockedBanner) */}
            {readOnly && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 18px",
                  margin: "16px 24px 0",
                  background: "#F3F0FB",
                  border: "1px solid #D9CEF2",
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "#E5DAF7",
                    color: "#6D28D9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="lock" size={17} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#5B21B6" }}>{t("boq.edLockTitle")}</div>
                  <div style={{ fontSize: 11.5, color: "#7C5BBF", marginTop: 1 }}>{t("boq.edLockDesc")}</div>
                </div>
                <Btn kind="primary" size="md" icon="edit" onClick={openReviseModal}>
                  {t("boq.edLockCreateRevise")}
                </Btn>
              </div>
            )}

            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              {groups.length === 0 ? (
                <EmptyState docNo={docNo} t={t} tp={tp} />
              ) : (
                <>
                  {/* M/S/L + group-total summary strip */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                    <SummaryCard
                      cat="M"
                      label={t("boq.edCardMaterial")}
                      value={totals.M}
                      count={totals.countM}
                      grand={totals.grand}
                      t={t}
                    />
                    <SummaryCard
                      cat="S"
                      label={t("boq.edCardSubcon")}
                      value={totals.S}
                      count={totals.countS}
                      grand={totals.grand}
                      t={t}
                    />
                    <SummaryCard
                      cat="L"
                      label={t("boq.edCardLabor")}
                      value={totals.L}
                      count={totals.countL}
                      grand={totals.grand}
                      t={t}
                    />
                    <Card pad={16} style={{ background: "var(--brand)", color: "#fff", border: "none" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>
                        {t("boq.edCardTotalGroup")}
                      </div>
                      <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>
                        {formatMoney(totals.grand)}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.75 }}>
                        {t("boq.edCardTotalSub").replace("{group}", activeGroup?.name ?? "")}
                      </div>
                    </Card>
                  </div>

                  <BudgetControlBar groups={groups} t={t} tp={tp} />

                  {/* Groups panel (left) + item editor (right) */}
                  <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
                    {/* Groups panel */}
                    <Card pad={0}>
                      <div
                        style={{
                          padding: "14px 16px",
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t("boq.edGroupsPanel")}</div>
                        {/* Add group — no endpoint; deferred stub (WIRE GAP 4). */}
                        <button
                          type="button"
                          style={{
                            width: 26,
                            height: 26,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--surface)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          <Icon name="plus" size={13} />
                        </button>
                      </div>
                      <div style={{ padding: 6 }}>
                        {groups.map((g) => {
                          const isActive = g.id === effectiveGroupId;
                          const v = sumLineTotals(byGroup.get(g.id) ?? []);
                          const count = (byGroup.get(g.id) ?? []).length;
                          return (
                            <div
                              key={g.id}
                              onClick={() => setActiveGroupId(g.id)}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 7,
                                cursor: "pointer",
                                background: isActive ? "var(--brand-soft)" : "transparent",
                                color: isActive ? "var(--brand)" : "var(--text)",
                                borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                                position: "relative",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                                <span style={{ fontSize: 12.5, fontWeight: isActive ? 700 : 600 }}>{g.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setGroupMenuFor(g.id === groupMenuFor ? null : g.id);
                                  }}
                                  style={{
                                    width: 22,
                                    height: 22,
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 4,
                                  }}
                                >
                                  <Icon name="more" size={13} color={isActive ? "var(--brand)" : "var(--text-3)"} />
                                </button>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}>
                                <span style={{ color: isActive ? "var(--brand)" : "var(--text-3)" }}>
                                  {t("boq.edGroupItems").replace("{n}", String(count))}
                                </span>
                                <span className="num" style={{ color: isActive ? "var(--brand)" : "var(--text-2)", fontWeight: 600 }}>
                                  {v > 0 ? formatMoney(v / 1000) + "K" : "—"}
                                </span>
                              </div>
                              {groupMenuFor === g.id && (
                                <>
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setGroupMenuFor(null);
                                    }}
                                    style={{ position: "fixed", inset: 0, zIndex: 20 }}
                                  />
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: 30,
                                      right: 8,
                                      zIndex: 30,
                                      width: 150,
                                      background: "var(--surface)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 8,
                                      padding: 4,
                                      boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {/* Rename / delete group — no endpoint; deferred stubs (WIRE GAP 4). */}
                                    <div onClick={() => setGroupMenuFor(null)} style={menuItem}>
                                      <Icon name="edit" size={12} color="var(--text-2)" /> {t("boq.edRename")}
                                    </div>
                                    <div
                                      onClick={() => setGroupMenuFor(null)}
                                      style={{ ...menuItem, color: "var(--danger)" }}
                                    >
                                      <Icon name="x" size={12} color="var(--danger)" /> {t("boq.edDelGroup")}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div
                        style={{
                          padding: "10px 14px",
                          borderTop: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11.5,
                        }}
                      >
                        <span style={{ color: "var(--text-3)" }}>{t("boq.edGroupsFooterTotal")}</span>
                        <span className="num" style={{ fontWeight: 700, color: "var(--brand)" }}>
                          {formatMoney(allGroupsTotal)} {BAHT}
                        </span>
                      </div>
                    </Card>

                    {/* Item editor */}
                    <Card pad={0}>
                      {/* Toolbar */}
                      <div
                        style={{
                          padding: "12px 16px",
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {activeGroup?.name ?? "—"}
                          <span style={{ color: "var(--text-3)", fontWeight: 500, marginLeft: 6 }}>· {activeRows.length}</span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            height: 30,
                            padding: "0 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 7,
                            background: "var(--surface)",
                            flexShrink: 1,
                            minWidth: 0,
                          }}
                        >
                          <Icon name="search" size={13} color="var(--text-3)" />
                          <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t("common.search")}
                            style={{ border: "none", outline: "none", width: 110, fontSize: 12, background: "transparent", color: "var(--text)" }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                          {(Object.keys(CAT) as ItemCat[]).map((k) => {
                            const c = CAT[k];
                            const on = catFilter.has(k);
                            const dim = catFilter.size > 0 && !on;
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => toggleCat(k)}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: 6,
                                  border: `1px solid ${on ? c.color : "var(--border)"}`,
                                  background: on ? c.color : c.soft,
                                  color: on ? "#fff" : c.color,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                  opacity: dim ? 0.5 : 1,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: 999, background: on ? "#fff" : c.color }} />
                                {c.short}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
                          {readOnly ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 11.5,
                                color: "#7C5BBF",
                                fontWeight: 600,
                                padding: "5px 10px",
                                background: "#F3F0FB",
                                borderRadius: 6,
                              }}
                            >
                              <Icon name="lock" size={13} /> {t("boq.edReadOnly")}
                            </span>
                          ) : (
                            <>
                              {/* Template / Import — no endpoint; deferred stubs (WIRE GAP 4). */}
                              <Btn kind="ghost" size="sm" icon="download">
                                {t("boq.edTemplateBtn")}
                              </Btn>
                              <Btn kind="soft" size="sm" icon="upload">
                                {t("boq.edImportBtn")}
                              </Btn>
                              <Btn kind="primary" size="sm" icon="plus" onClick={openItemModal}>
                                {tp(S("addItem"))}
                              </Btn>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Bulk-action bar */}
                      {selected.size > 0 && (
                        <div
                          style={{
                            padding: "10px 16px",
                            background: "var(--brand-soft)",
                            borderBottom: "1px solid var(--brand)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                            {selCountParts(t("boq.edSelectedCount"), selected.size)}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn kind="ghost" size="sm" icon="x" onClick={() => setSelected(new Set())}>
                              {t("common.cancel")}
                            </Btn>
                            <Btn kind="primary" size="sm" icon="cart" onClick={doGeneratePr} disabled={generatePr.isPending}>
                              {t("boq.edGenPr")}
                            </Btn>
                            {/* Move-group / delete-selected — no endpoint; deferred stubs (WIRE GAP 4). */}
                            {!readOnly && (
                              <Btn kind="ghost" size="sm" icon="link">
                                {t("boq.edMoveGroup")}
                              </Btn>
                            )}
                            {!readOnly && (
                              <Btn kind="danger" size="sm" icon="x">
                                {t("boq.edDelSelected")}
                              </Btn>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Item table */}
                      <div style={{ overflow: "auto", maxHeight: 560 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                          <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)" }}>
                            <tr style={{ color: "var(--text-3)" }}>
                              <th style={th(28)}>
                                <input type="checkbox" checked={allDisplayedSelected} onChange={toggleAll} />
                              </th>
                              <th style={th(100)}>{tp(S("thCode"))}</th>
                              <th style={th(54)}>{tp(S("thType"))}</th>
                              <th style={th()}>{t("boq.edThMaterialItem")}</th>
                              <th style={th()}>{tp(S("thDetail"))}</th>
                              <th style={th(130)}>{t("boq.edThCostName")}</th>
                              <th style={th(80, true)}>{t("boq.edThQty")}</th>
                              <th style={th(70)}>{t("boq.edThUnitEn")}</th>
                              <th style={th(110, true)}>{t("boq.edThPriceUnit")}</th>
                              <th style={th(120, true)}>{t("boq.edThTotal")}</th>
                              <th style={th(36)} />
                            </tr>
                          </thead>
                          <tbody>
                            {displayedRows.length === 0 ? (
                              <tr>
                                <td colSpan={11} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                                  <Icon name="info" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                                  <div style={{ marginTop: 8 }}>
                                    {activeRows.length === 0 ? t("boq.edEmptyRowsGroup") : t("boq.edEmptyRowsFilter")}
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              displayedRows.map((r) => {
                                const cc = r.ccId ? ccMap.get(r.ccId) : undefined;
                                return (
                                  <ItemRow
                                    key={r.id}
                                    row={r}
                                    costName={cc?.name ?? null}
                                    costCode={cc?.code ?? null}
                                    prNo={prMarked[r.id]}
                                    readOnly={readOnly}
                                    selected={selected.has(r.id)}
                                    onToggle={() => toggleOne(r.id)}
                                    onDup={() => duplicateRow(r)}
                                    onDel={() => {
                                      /* WIRE GAP 4: no delete endpoint — deferred stub. */
                                    }}
                                    t={t}
                                    tp={tp}
                                  />
                                );
                              })
                            )}
                          </tbody>
                          <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
                            <tr>
                              <td colSpan={9} style={{ padding: 12, textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                                {t("boq.edFootGroupTotal").replace("{group}", activeGroup?.name ?? "")}
                              </td>
                              <td style={{ padding: 12, textAlign: "right", fontSize: 14, fontWeight: 700, color: "var(--brand)" }} className="num">
                                {formatMoney(totals.grand)}
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </Card>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Doc-header status badge (boq.jsx L569): approved/draft show "· {ver}", else just {ver}. */
function StatusBadge({
  status,
  ver,
  tp,
}: {
  status: string;
  ver: string;
  tp: (k: PhraseKey) => string;
}) {
  const tone =
    status === "approved"
      ? { bg: "var(--ok-soft)", fg: "var(--ok)" }
      : status === "pending"
        ? { bg: "var(--warn-soft)", fg: "var(--warn)" }
        : status === "revise"
          ? { bg: "var(--info-soft)", fg: "var(--info)" }
          : { bg: "var(--draft-soft)", fg: "var(--draft)" };
  const label =
    status === "approved"
      ? `${tp(S("statusApproved"))} · ${ver}`
      : status === "draft"
        ? `${tp(S("statusDraft"))} · ${ver}`
        : ver;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 4,
        background: tone.bg,
        color: tone.fg,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** M/S/L summary card (boq.jsx L633-656). */
function SummaryCard({
  cat,
  label,
  value,
  count,
  grand,
  t,
}: {
  cat: ItemCat;
  label: string;
  value: number;
  count: number;
  grand: number;
  t: (k: DictKey) => string;
}) {
  return (
    <Card pad={16} style={{ borderLeft: `4px solid ${CAT[cat].color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <CatChip cat={cat} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>
        {formatMoney(value)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        {t("boq.edCardSub").replace("{count}", String(count)).replace("{pct}", grand > 0 ? pct1(value, grand) : "0")}
      </div>
    </Card>
  );
}

/** Fresh-doc empty state (boq.jsx L596-628); the start-from options are deferred stubs. */
function EmptyState({
  docNo,
  t,
  tp,
}: {
  docNo: string;
  t: (k: DictKey) => string;
  tp: (k: PhraseKey) => string;
}) {
  const options: { ic: "plus" | "grid" | "upload"; title: string; desc: string; primary?: boolean }[] = [
    { ic: "plus", title: t("boq.edStartManual"), desc: t("boq.edStartManualD"), primary: true },
    { ic: "grid", title: t("boq.edStartBom"), desc: t("boq.edStartBomD") },
    { ic: "upload", title: tp(S("startExcel")), desc: t("boq.edStartExcelD") },
  ];
  return (
    <Card pad={0}>
      <div style={{ padding: "64px 24px", textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "var(--brand-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon name="budget" size={28} color="var(--brand)" />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{t("boq.edEmptyTitle")}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>
          {t("boq.edEmptyDesc").replace("{docNo}", docNo)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 24 }}>
          {options.map((s) => (
            <button
              key={s.title}
              type="button"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
                textAlign: "left",
                padding: "16px 16px",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: "inherit",
                border: `1px solid ${s.primary ? "var(--brand)" : "var(--border)"}`,
                background: s.primary ? "var(--brand-soft)" : "var(--surface)",
              }}
            >
              <Icon name={s.ic} size={20} color="var(--brand)" />
              <span style={{ fontSize: 13, fontWeight: 700, color: s.primary ? "var(--brand)" : "var(--text)" }}>
                {s.title}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>{s.desc}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <Btn kind="ghost" size="sm" icon="download">
            {t("boq.edDownloadTplExcel")}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

/** Bold the {n} count inside the bulk-bar label (boq.jsx L779). */
function selCountParts(template: string, n: number) {
  const [head, tail = ""] = template.split("{n}");
  return (
    <>
      {head}
      <b className="num">{n}</b>
      {tail}
    </>
  );
}
