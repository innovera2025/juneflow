/*
 * POForm (po.form) create-body helpers — pure, i18n-free, ASCII-only logic for the
 * "create PO from an approved PR" page ported from pototype/po-wo.jsx POForm (L216-262).
 *
 * money=SERVER (PLAN.md rule-0 + money-post lessons): the web sends ONLY the two tenant ids
 * (approved-PR id + vendor id) through the generated client. The server seeds the PO total
 * from the source PR's priced lines — the page performs ZERO money math and NEVER puts an
 * amount/total/deposit/vat figure into the create body. The prototype's 902,475 THB PR-linked
 * amount is DISPLAY-only (read from the real PR row, never client-computed into a POST).
 *
 * The create body deliberately mirrors po-create-form.tsx (the modal port already merged on
 * dev): POST /po's body is { pr_id, vendor_id } (credit_term / vat are optional on the
 * contract but have no clean create-form source here, so they are NOT sent — flagged as a
 * WIRE GAP in po-form.tsx, never fabricated).
 */
import type { CreatePoBody } from "./use-po-wo";

/**
 * Build the POST /po create body from the two selected ids. Emits ONLY pr_id + vendor_id —
 * no money/total/deposit field ever leaves the client (money=SERVER). The server owns the
 * total, status (draft) and approval_step (0).
 */
export function buildCreatePoBody(prId: string, vendorId: string): CreatePoBody {
  return { pr_id: prId, vendor_id: vendorId };
}

/**
 * True when a PO may be created/submitted: both an approved-PR id and a vendor id are chosen
 * and no create/submit mutation is in flight. Mirrors po-create-form's canSubmit guard.
 */
export function canCreatePo(prId: string, vendorId: string, busy: boolean): boolean {
  return prId !== "" && vendorId !== "" && !busy;
}
