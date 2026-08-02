/*
 * InventoryTransfer — the Stock-Transfer list, ported from pototype/inventory.jsx
 * InventoryTransfer (L213-260). Route inv.transfer (registry.ts L110, mod "inv").
 * GOTCHA: the component ends at L260 — `const ISSUES` (L262) + InventoryIssue (L269)
 * are the adjacent swallowed material and are EXCLUDED.
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb (inv.navRoot · inv.transfer.navLabel),
 * the title/subtitle, the primary inv.transfer.btnNew action, and the 7-column transfer
 * table (colNo | colFromTo | items | qty | value | date | status) are the prototype's.
 *
 * Data (rule 8): GET /inventory/transfers (use-inventory.ts) via the generated client
 * — the prototype's TRANSFERS mock becomes the server catalogue (newest-first, server
 * order). Pure narrowing lives in transfer-rows.ts + inv-shared.ts (unit-tested, G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated):
 *   - items — the list wire carries no line items (transfer_line is detail-only) -> em-dash;
 *   - qty — a single numeric qty (the prototype's "240+120 <unit>" composite +
 *     unit are not reconstructable from the list wire);
 *   - value — SERVER-owned; value 0 -> em-dash (prototype L250, a tool transfer);
 *   - date — a DATE only (no time-of-day) rendered as the raw wire value; the by
 *     sub-line is a uuid (by_user_id), NOT name-resolved -> em-dash;
 *   - inv.transfer.btnNew (POST /inventory/transfers) is out of this read scope -> honest-disabled.
 *
 * i18n (rule 2): inv.* dict keys + BORROWS (subcon.colNo=no · accept.unitItems=items ·
 * subcon.colValueBaht=value · subcon.colDate=date · inv.colQty=qty · common.status ·
 * fin.statusPending · fin.statusApproved). Warehouse names + doc# are SERVER DATA rendered
 * raw. Tokens back every colour (rule 6); numeric cells carry class num (rule 7); the
 * status dot hexes are prototype-verbatim (B-037(a)).
 */
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { DASH, StatusBadge, TableSkeleton, th, td } from "./inv-ui";
import { docStatusKind, docStatusTone, formatMoney } from "./inv-shared";
import { toTransferRow, type TransferRow } from "./transfer-rows";
import { useTransfers } from "./use-inventory";

export function InventoryTransfer() {
  const { t } = useI18n();

  const transfersQ = useTransfers();
  const rows = useMemo<TransferRow[]>(() => (transfersQ.data ?? []).map(toTransferRow), [transfersQ.data]);

  /** i18n label for a document status (pending | approved). */
  const statusLabel = (status: string): string =>
    docStatusKind(status) === "pending" ? t("fin.statusPending") : t("fin.statusApproved");

  return (
    <Page
      breadcrumbs={[t("inv.navRoot"), t("inv.transfer.navLabel")]}
      title={t("inv.transfer.title")}
      subtitle={t("inv.transfer.subtitle")}
      actions={
        // POST /inventory/transfers exists, but the create form is out of this read scope.
        <Btn kind="primary" size="md" icon="plus" disabled>
          {t("inv.transfer.btnNew")}
        </Btn>
      }
    >
      <Card pad={0}>
        {transfersQ.isLoading ? (
          <TableSkeleton />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th()}>{t("subcon.colNo")}</th>
                <th scope="col" style={th(180)}>{t("inv.transfer.colFromTo")}</th>
                <th scope="col" style={th()}>{t("accept.unitItems")}</th>
                <th scope="col" style={th(140)}>{t("inv.colQty")}</th>
                <th scope="col" style={th(110, true)}>{t("subcon.colValueBaht")}</th>
                <th scope="col" style={th()}>{t("subcon.colDate")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="arrowR" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("accept.unitItems")}</div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const tone = docStatusTone(r.status);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 600 }} className="num">
                        <span style={{ color: "var(--brand)" }}>{r.no || DASH}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 11.5, color: "var(--text)" }}>{r.fromWarehouseName || DASH}</span>
                        <Icon name="arrowR" size={11} style={{ margin: "0 6px", verticalAlign: "middle" }} color="var(--text-3)" />
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}>
                          {r.toWarehouseName || DASH}
                        </span>
                      </td>
                      {/* items — line detail only, not on the list wire -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-2)" }} className="num">
                        {formatMoney(r.qty)}
                      </td>
                      {/* value 0 -> "—" (prototype L250). */}
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {r.value > 0 ? formatMoney(r.value) : DASH}
                      </td>
                      {/* date (DATE only, raw) + by sub-line (uuid, not name-resolved -> em-dash). */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>
                        {r.transferDate || DASH}
                        <div style={{ fontSize: 10 }}>{DASH}</div>
                      </td>
                      <td style={td}>
                        <StatusBadge bg={tone.bg} fg={tone.fg} dot={tone.dot} label={statusLabel(r.status)} />
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
