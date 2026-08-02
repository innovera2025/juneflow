/*
 * InventoryItems — the Item Master screen, ported from pototype/inventory.jsx
 * InventoryItems (L14-111). Route inv.items (registry.ts L108, mod "inv").
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb (inv.navRoot · Item Master),
 * the title/subtitle, the three header actions (Export / import / add-item), the
 * 4-card MiniKpi strip, the toolbar (search + category/warehouse/stock-status chips),
 * and the 10-column table are the prototype's.
 *
 * Data (rule 8): GET /inventory/items (use-inventory.ts) via the generated client —
 * the prototype's local ITEMS becomes the server catalogue. GET /inventory/warehouses
 * resolves each row's warehouse_id -> name (§0 rule 3). Pure narrowing/derivation
 * lives in items-rows.ts + inv-shared.ts (unit-tested, gate G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated):
 *   - KPI-1 (total) is a real page count with the Material/Tool split (kpiTotalSub);
 *     KPI-2 (value) / KPI-3 (low) / KPI-4 (out) have NO aggregate endpoint -> em-dash
 *     (the ledger is UNSEEDED, so any derived value/low/out would be 0/all — the
 *     gr-list DASH precedent, never the mock 8.42 / 14 / 3).
 *   - STATUS badge is DERIVED client-side from on_hand vs low_point (inv-shared
 *     stockStatusKind); the wire `status` is a lifecycle value ("active"), not the
 *     stock-status enum. On the unseeded ledger every row derives inv.status.out (C10).
 *   - the warehouse cell resolves warehouse_id -> name (em-dash unresolved); price 0 ->
 *     em-dash (prototype L93); the checkbox + more-icon are bulk/row chrome with no
 *     endpoint (non-functional); the 3 header actions have no read-scope form ->
 *     honest-disabled; the category/warehouse/status filters are presentational (GET
 *     takes no filter params) — only the search is wired client-side (gr-list precedent).
 *
 * i18n (rule 2): every string is an inv.* dict key or a cross-module BORROW of an
 * existing exact-value key (org.fieldCode=code · sales.service.thCategory=category ·
 * boq.listExcItemName=item-name · subcon.fieldUnit=unit · gr.list.filterWarehouse=warehouse ·
 * gr.list.allWarehouses=all-warehouses · common.status · common.all · vendor.btnExport=Export ·
 * fa.register.btnImport=import · model.priceUnit=M-baht) — the gr-list/land-bank borrow
 * policy; NOTHING is minted. cat/name/warehouse-name are SERVER DATA rendered raw
 * (§0 rule 3). Tokens back every colour (rule 6); numeric cells carry class num (rule 7).
 */
import { useMemo, useState } from "react";
import type { NavKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { DASH, MiniKpi, FilterChip, StatusBadge, TableSkeleton, th, td } from "./inv-ui";
import { toItemRow, catCounts, filterItems, type ItemRow } from "./items-rows";
import { formatDec, formatMoney, stockStatusKind, stockStatusTone, warehouseNameById } from "./inv-shared";
import { useInventoryItems, useWarehouses } from "./use-inventory";

export function InventoryItems() {
  const { t, tn } = useI18n();

  const itemsQ = useInventoryItems();
  const warehousesQ = useWarehouses();

  const [q, setQ] = useState("");

  const rows = useMemo<ItemRow[]>(() => (itemsQ.data ?? []).map(toItemRow), [itemsQ.data]);
  const whNames = useMemo(() => warehouseNameById(warehousesQ.data), [warehousesQ.data]);
  const view = useMemo(() => filterItems(rows, q, whNames), [rows, q, whNames]);
  const counts = catCounts(rows);

  /** i18n label for a derived stock-status badge kind. */
  const statusLabel = (kind: "ok" | "low" | "out"): string =>
    kind === "ok" ? t("inv.status.ok") : kind === "low" ? t("inv.status.low") : t("inv.status.out");

  return (
    <Page
      breadcrumbs={[t("inv.navRoot"), tn("Item Master" as NavKey)]}
      title={t("inv.items.title")}
      subtitle={t("inv.items.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Honest-disabled: no export endpoint (the export modal is a dropped mock). */}
          <Btn kind="ghost" size="md" icon="download" disabled>
            {t("vendor.btnExport")}
          </Btn>
          {/* Honest-disabled: no import endpoint (the import modal is a dropped mock). */}
          <Btn kind="outline" size="md" icon="upload" disabled>
            {t("fa.register.btnImport")}
          </Btn>
          {/* POST /inventory/items exists, but the create form is out of this read scope. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("inv.items.btnAdd")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip — total is real (page count + Material/Tool split); value/low/out
          have no aggregate endpoint on the unseeded ledger -> em-dash. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("inv.items.kpiTotal")}
          value={formatMoney(counts.total)}
          sub={t("inv.items.kpiTotalSub")
            .replace("{mat}", formatMoney(counts.material))
            .replace("{tool}", formatMoney(counts.tool))}
          tone="var(--brand)"
          icon="box"
        />
        <MiniKpi
          label={t("inv.items.kpiValue")}
          value={DASH}
          unit={t("model.priceUnit")}
          sub={t("inv.items.kpiValueSub")}
          tone="var(--accent)"
          icon="ledger"
        />
        <MiniKpi label={t("inv.items.kpiLow")} value={DASH} sub={t("inv.items.kpiLowSub")} tone="var(--warn)" icon="warn" />
        <MiniKpi label={t("inv.items.kpiOut")} value={DASH} sub={t("inv.items.kpiOutSub")} tone="var(--danger)" icon="x" />
      </div>

      <Card pad={0}>
        {/* Toolbar — wired search + 3 presentational filter chips. */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 30,
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
              placeholder={t("inv.items.searchPlaceholder")}
              style={{ border: "none", outline: "none", width: 280, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          <FilterChip label={t("sales.service.thCategory")} value={t("common.all")} muted />
          <FilterChip label={t("gr.list.filterWarehouse")} value={t("gr.list.allWarehouses")} muted />
          <FilterChip label={t("inv.items.filterStockStatus")} value={t("inv.items.filterStockStatusVal")} />
        </div>

        {itemsQ.isLoading ? (
          <TableSkeleton />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th(28)}>
                  {/* Bulk-select chrome — no bulk endpoint, non-functional. */}
                  <input type="checkbox" aria-label={t("common.all")} />
                </th>
                <th scope="col" style={th(110)}>{t("org.fieldCode")}</th>
                <th scope="col" style={th(80)}>{t("sales.service.thCategory")}</th>
                <th scope="col" style={th()}>{t("boq.listExcItemName")}</th>
                <th scope="col" style={th(70)}>{t("subcon.fieldUnit")}</th>
                <th scope="col" style={th(110, true)}>{t("inv.items.colStdPrice")}</th>
                <th scope="col" style={th(110)}>{t("gr.list.filterWarehouse")}</th>
                <th scope="col" style={th(110, true)}>{t("inv.items.colOnHand")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
                <th style={th(36)} />
              </tr>
            </thead>
            <tbody>
              {view.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="box" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("common.all")}</div>
                  </td>
                </tr>
              ) : (
                view.map((r) => {
                  const kind = stockStatusKind(r.onHand, r.lowPoint);
                  const tone = stockStatusTone(kind);
                  const whName = r.warehouseId ? whNames.get(r.warehouseId) ?? "" : "";
                  const isTool = r.cat === "Tool";
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <input type="checkbox" aria-label={r.code} />
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                        {r.code || DASH}
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: isTool ? "var(--info-soft)" : "var(--accent-soft)",
                            color: isTool ? "var(--info)" : "var(--accent)",
                          }}
                        >
                          {r.cat}
                        </span>
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                      <td style={{ ...td, color: "var(--text-3)" }}>{r.unit}</td>
                      {/* price 0 -> "—" (prototype L93). */}
                      <td style={{ ...td, textAlign: "right" }} className="num">
                        {r.price > 0 ? formatDec(r.price) : DASH}
                      </td>
                      {/* warehouse — warehouse_id resolved to name (em-dash unresolved). */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }}>{whName || DASH}</td>
                      {/* on-hand (SERVER Σ ledger) — 0 until a movement posts. */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.onHand)}
                      </td>
                      {/* status — DERIVED from on_hand vs low_point, not the lifecycle status. */}
                      <td style={td}>
                        <StatusBadge bg={tone.bg} fg={tone.fg} label={statusLabel(kind)} />
                      </td>
                      {/* row chrome — no menu/endpoint. */}
                      <td style={td}>
                        <Icon name="more" size={14} color="var(--text-3)" />
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
