/*
 * InventoryStock — the Stock-by-warehouse screen, ported from pototype/inventory.jsx
 * InventoryStock (L113-204). Route inv.stock (registry.ts L109, mod "inv").
 * GOTCHA: the component ends BEFORE `const TRANSFERS` (L206) — TRANSFERS is excluded.
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb (inv.navRoot · inv.stock.title),
 * the title/subtitle, the primary inv.stock.btnAddWh action, the warehouse KPI-card
 * grid, and the selected-warehouse detail panel (header summary + filter btn + the
 * 7-column balance table) are the prototype's.
 *
 * Data (rule 8): GET /inventory/warehouses (cards) + GET /inventory/stock (per-item,
 * warehouse balances) via the generated client — the prototype's hardcoded WH array +
 * ITEMS.slice(0,6) become the real server aggregates. Pure narrowing/derivation lives
 * in stock-rows.ts + inv-shared.ts (unit-tested, gate G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated):
 *   - card items-count = distinct items per warehouse, value = Σ standard-cost value
 *     (both derived from the stock balances; 0 when the ledger is unseeded — honest);
 *   - the card ALERT badge + UTIL bar have no backing field (no per-warehouse alert
 *     count; capacity semantics + null) -> OMITTED (recon: em-dash / bar hidden);
 *   - the detail-panel columns reorder (inv.stock.colReorder), usage/month
 *     (inv.stock.colUsagePerMonth), status (common.status), last-movement
 *     (inv.stock.colLastMovement) have NO stockWire field -> em-dash;
 *   - the WH cards are made client-side SELECTABLE (filtering the already-loaded stock
 *     rows, gr-list precedent) so the panel header/name is meaningful — no reliance on
 *     the server ?warehouse filter (recon flags it as ignored by the handler);
 *   - inv.stock.btnAddWh (POST /inventory/warehouses) + the filter btn (filter modal)
 *     are out of this read scope -> honest-disabled.
 *
 * i18n (rule 2): inv.* dict keys + BORROWS (accept.unitItems=items · subcon.colValueBaht=value ·
 * model.priceUnit=M-baht · gl.inbox.filterBtn=filter · common.status). item/warehouse
 * names are SERVER DATA rendered raw. Tokens back every colour (rule 6); numeric cells
 * carry class num (rule 7).
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { DASH, TableSkeleton, th, td } from "./inv-ui";
import { formatMoney } from "./inv-shared";
import {
  toStockRow,
  toWarehouseRow,
  warehouseCards,
  stockForWarehouse,
  sumValue,
  type StockRow,
  type WarehouseRow,
} from "./stock-rows";
import { useStock, useWarehouses } from "./use-inventory";

export function InventoryStock() {
  const { t } = useI18n();

  const warehousesQ = useWarehouses();
  const stockQ = useStock();

  const [selWh, setSelWh] = useState("");

  const warehouses = useMemo<WarehouseRow[]>(
    () => (warehousesQ.data ?? []).map(toWarehouseRow),
    [warehousesQ.data],
  );
  const stock = useMemo<StockRow[]>(() => (stockQ.data ?? []).map(toStockRow), [stockQ.data]);
  const cards = useMemo(() => warehouseCards(warehouses, stock), [warehouses, stock]);

  // Selected card = the clicked warehouse, else the first (client-side, no server filter).
  const activeWh = cards.find((c) => c.id === selWh) ?? cards[0];
  const panelRows = useMemo(
    () => (activeWh ? stockForWarehouse(stock, activeWh.id) : []),
    [stock, activeWh],
  );

  const unitItems = t("accept.unitItems");
  const unitMBaht = t("model.priceUnit");
  const isLoading = warehousesQ.isLoading || stockQ.isLoading;

  /** Panel header summary: "{n} items · {valueM} M-baht" (alerts segment has no source). */
  const panelSummary = activeWh
    ? `${formatMoney(panelRows.length)} ${unitItems} · ${formatMoney(sumValue(panelRows) / 1e6)} ${unitMBaht}`
    : "";

  return (
    <Page
      breadcrumbs={[t("inv.navRoot"), t("inv.stock.title")]}
      title={t("inv.stock.title")}
      subtitle={t("inv.stock.subtitle")}
      actions={
        // POST /inventory/warehouses exists, but the create form is out of this read scope.
        <Btn kind="primary" size="md" icon="plus" disabled>
          {t("inv.stock.btnAddWh")}
        </Btn>
      }
    >
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <>
          {/* Warehouse KPI cards — real name + derived item-count + Σ value. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
            {cards.map((c) => {
              const on = c.id === activeWh?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelWh(c.id)}
                  style={{
                    textAlign: "start",
                    padding: 16,
                    background: "var(--surface)",
                    border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                    borderRadius: "var(--r-lg)",
                    boxShadow: "var(--shadow-sm)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--text)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Icon name="box" size={16} color="var(--brand)" />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </span>
                    {/* alert badge OMITTED — no per-warehouse alert count on the wire. */}
                  </div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{formatMoney(c.itemCount)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{unitItems}</div>
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                    <div className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
                      {t("inv.stock.unitKBaht").replace("{value}", formatMoney(c.value / 1000))}
                    </div>
                    {/* util bar + usage-percent line OMITTED — no reliable per-warehouse utilisation source. */}
                  </div>
                </button>
              );
            })}
          </div>

          <Card pad={0}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{activeWh?.name ?? DASH}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{panelSummary}</div>
              </div>
              {/* Honest-disabled: the filter modal is out of this read scope. */}
              <Btn kind="ghost" size="sm" icon="filter" disabled>
                {t("gl.inbox.filterBtn")}
              </Btn>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th()}>{unitItems}</th>
                  <th scope="col" style={th(110, true)}>{t("inv.items.colOnHand")}</th>
                  <th scope="col" style={th(110, true)}>{t("inv.stock.colReorder")}</th>
                  <th scope="col" style={th(110, true)}>{t("inv.stock.colUsagePerMonth")}</th>
                  <th scope="col" style={th(110, true)}>{t("subcon.colValueBaht")}</th>
                  <th scope="col" style={th(110)}>{t("common.status")}</th>
                  <th scope="col" style={th(150)}>{t("inv.stock.colLastMovement")}</th>
                </tr>
              </thead>
              <tbody>
                {panelRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                      <Icon name="box" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                      <div style={{ marginTop: 10, fontSize: 13 }}>{unitItems}</div>
                    </td>
                  </tr>
                ) : (
                  panelRows.map((r) => (
                    <tr key={`${r.itemId}::${r.warehouseId}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{r.itemName || DASH}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="num">{r.itemCode || DASH}</div>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                        {formatMoney(r.onHand)}{" "}
                        <span style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 400 }}>{r.unit}</span>
                      </td>
                      {/* reorder — no wire field (stockWire omits item.low) -> em-dash. */}
                      <td style={{ ...td, textAlign: "right", color: "var(--text-3)" }} className="num">{DASH}</td>
                      {/* usage/month — mock, no source -> em-dash. */}
                      <td style={{ ...td, textAlign: "right" }} className="num">{DASH}</td>
                      <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(r.value)}</td>
                      {/* status — stockWire emits no status/reorder -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      {/* last movement — mock, no last-per-item read -> em-dash. */}
                      <td style={{ ...td, fontSize: 11, color: "var(--text-3)" }}>{DASH}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}
