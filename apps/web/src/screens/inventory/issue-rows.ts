/*
 * Material-issue row helpers for InventoryIssue (route inv.issue), pure/i18n-free/
 * ASCII-only logic. IN-ROUND RECON (no per-screen spec was supplied): read from
 * pototype/inventory.jsx InventoryIssue (L269-319) + its GET /inventory/issues, and
 * mirror the sibling inv-screens' read-port pattern.
 *
 * Prototype (L269-319): breadcrumbs [inv.navRoot, the issue nav label], title
 * inv.issue.navLabel, inv.issue.subtitle, a primary inv.issue.btnNew action, and one
 * table with 8 columns: colNo | colUsedFor | colIssuedFrom | items | value | colIssuedBy
 * | date | status (i18n keys listed under i18n below).
 *
 * §0 rule 3: the ISSUES mock (L262-267) is dropped — the list is the real server
 * catalogue (GET /inventory/issues, issueWire, inventory.ts L405-421): { id, no,
 * project_id, project_name, from_warehouse_id, value, currency_code, issue_date,
 * by_user_id, status, created_at }. Server resolves project_name and sorts
 * newest-first (created_at desc).
 *
 * WIRE GAPS (reported, never fabricated): the issue wire resolves project_name but
 * NOT from_warehouse_name (from_warehouse_id resolves via GET /inventory/warehouses,
 * inv-shared warehouseNameById), carries NO line items (the items column is
 * detail-only -> em-dash), and NO by_user_name (by_user_id uuid only -> em-dash; the
 * prototype's Avatar is not rendered from a raw uuid). issue_date is a DATE rendered raw.
 */
import { num, str } from "./inv-shared";

/** A material-issue row as the table consumes it (narrowed from the opaque wire). */
export interface IssueRow {
  id: string;
  no: string;
  projectId: string;
  /** Server-resolved project name (the inv.issue.colUsedFor column; null -> em-dash). */
  projectName: string;
  /** FK to the source warehouse (resolved to a name via GET /inventory/warehouses). */
  fromWarehouseId: string;
  /** Issue value (money, SERVER-owned) — rendered with fmt (prototype L303). */
  value: number;
  currencyCode: string;
  /** DATE only — rendered as the raw wire value (SERVER DATA). */
  issueDate: string;
  /** FK to the issuing user (uuid, NOT name-resolved -> em-dash). */
  byUserId: string;
  /** Lifecycle status (pending | approved). */
  status: string;
}

/** Narrow an opaque /inventory/issues Entity row to an IssueRow. */
export function toIssueRow(e: Record<string, unknown>): IssueRow {
  return {
    id: str(e.id),
    no: str(e.no),
    projectId: str(e.project_id ?? e.projectId),
    projectName: str(e.project_name ?? e.projectName),
    fromWarehouseId: str(e.from_warehouse_id ?? e.fromWarehouseId),
    value: num(e.value),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    issueDate: str(e.issue_date ?? e.issueDate),
    byUserId: str(e.by_user_id ?? e.byUserId),
    status: str(e.status),
  };
}
