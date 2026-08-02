/*
 * InventoryIssue — the Material-Issue list, ported from pototype/inventory.jsx
 * InventoryIssue (L269-319). Route inv.issue (registry.ts L111, mod "inv").
 *
 * IN-ROUND RECON (no per-screen spec supplied): read the prototype range L269-319 +
 * its GET /inventory/issues, and mirror the sibling inv.transfer read-port pattern.
 *   Prototype: breadcrumbs [inv.navRoot, the issue nav label], title inv.issue.navLabel,
 *   inv.issue.subtitle, a primary inv.issue.btnNew action, and one 8-column table
 *   (colNo | colUsedFor | colIssuedFrom | items | value | colIssuedBy | date | status).
 *
 * Data (rule 8): GET /inventory/issues (use-inventory.ts) via the generated client —
 * the prototype's ISSUES mock becomes the server catalogue (newest-first). The wire
 * (issueWire, inventory.ts L405-421) resolves project_name but NOT from_warehouse_name,
 * so GET /inventory/warehouses resolves from_warehouse_id -> name (§0 rule 3). Pure
 * narrowing lives in issue-rows.ts + inv-shared.ts (unit-tested, G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated):
 *   - items column — line detail only, not on the list wire -> em-dash;
 *   - issued-by (colIssuedBy) — the wire carries by_user_id (uuid), NOT a name; the
 *     prototype's Avatar is not rendered from a raw uuid -> em-dash;
 *   - date — a DATE only, rendered as the raw wire value (SERVER DATA);
 *   - value — SERVER-owned issue value (fmt, prototype L303);
 *   - inv.issue.btnNew (POST /inventory/issues) is out of this read scope -> honest-disabled.
 *
 * i18n (rule 2): inv.* dict keys + the issue breadcrumb reuses inv.stock.moveOut (its
 * exact-value key == the nav short label) + BORROWS (subcon.colNo, accept.unitItems,
 * subcon.colValueBaht, subcon.colDate, common.status, fin.statusPending,
 * fin.statusApproved) — the gr-list/land-bank borrow policy, NOTHING minted.
 * project/warehouse names + doc# are SERVER DATA rendered raw. Tokens back every colour
 * (rule 6); numeric cells carry class num (rule 7); the status dot hexes are
 * prototype-verbatim (B-037(a)).
 */
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { DASH, StatusBadge, TableSkeleton, th, td } from "./inv-ui";
import { docStatusKind, docStatusTone, formatMoney, warehouseNameById } from "./inv-shared";
import { toIssueRow, type IssueRow } from "./issue-rows";
import { useIssues, useWarehouses } from "./use-inventory";

export function InventoryIssue() {
  const { t } = useI18n();

  const issuesQ = useIssues();
  const warehousesQ = useWarehouses();

  const rows = useMemo<IssueRow[]>(() => (issuesQ.data ?? []).map(toIssueRow), [issuesQ.data]);
  const whNames = useMemo(() => warehouseNameById(warehousesQ.data), [warehousesQ.data]);

  /** i18n label for a document status (pending | approved). */
  const statusLabel = (status: string): string =>
    docStatusKind(status) === "pending" ? t("fin.statusPending") : t("fin.statusApproved");

  return (
    <Page
      breadcrumbs={[t("inv.navRoot"), t("inv.stock.moveOut")]}
      title={t("inv.issue.navLabel")}
      subtitle={t("inv.issue.subtitle")}
      actions={
        // POST /inventory/issues exists, but the create form is out of this read scope.
        <Btn kind="primary" size="md" icon="plus" disabled>
          {t("inv.issue.btnNew")}
        </Btn>
      }
    >
      <Card pad={0}>
        {issuesQ.isLoading ? (
          <TableSkeleton />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th()}>{t("subcon.colNo")}</th>
                <th scope="col" style={th()}>{t("inv.issue.colUsedFor")}</th>
                <th scope="col" style={th()}>{t("inv.issue.colIssuedFrom")}</th>
                <th scope="col" style={th()}>{t("accept.unitItems")}</th>
                <th scope="col" style={th(120, true)}>{t("subcon.colValueBaht")}</th>
                <th scope="col" style={th(110)}>{t("inv.issue.colIssuedBy")}</th>
                <th scope="col" style={th()}>{t("subcon.colDate")}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
                    <Icon name="box" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    <div style={{ marginTop: 10, fontSize: 13 }}>{t("accept.unitItems")}</div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const tone = docStatusTone(r.status);
                  const whName = r.fromWarehouseId ? whNames.get(r.fromWarehouseId) ?? "" : "";
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                        {r.no || DASH}
                      </td>
                      <td style={td}>{r.projectName || DASH}</td>
                      <td style={{ ...td, fontSize: 11.5 }}>{whName || DASH}</td>
                      {/* items — line detail only, not on the list wire -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                        {formatMoney(r.value)}
                      </td>
                      {/* issued-by — by_user_id uuid, not name-resolved -> em-dash. */}
                      <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }}>{r.issueDate || DASH}</td>
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
