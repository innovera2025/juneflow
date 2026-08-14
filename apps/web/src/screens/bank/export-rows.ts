/*
 * Bank-file export row helpers for BankExport (P2-WEB-15) — pure, i18n-free,
 * ASCII-only logic ported from pototype/bank.jsx BankExport (L158-253).
 *
 * The prototype held the "PVs ready to send to bank" in a local array (bank.jsx
 * L192-198) with denormalised bank/account strings + a decorative checkbox selection.
 * Juneflow §0 rule: that mock seed is dropped — the list is the tenant's real payment
 * vouchers (GET /ap/pv) narrowed + filtered to the export-eligible set (approved +
 * transfer method — exactly the server's POST /bank/export-batch eligibility,
 * apps/api/src/routes/bank.ts exportBatch). The chosen PVs are POSTed to
 * /bank/export-batch, which returns the real batch file { file_name, content, ... }.
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `no` (PV number) is an honest null on EVERY pv row (pv has no doc-number column)
 *     -> the "PV no" cell em-dashes; a PV is identified by payee + amount here.
 *   - the pv wire carries NO beneficiary bank/account column; the destination account
 *     is resolved from the payee VENDOR's stored free-text `bank` string (GET /vendors,
 *     the same source the export-batch handler uses) and split into a bank code + an
 *     account — em-dash when the vendor has no bank string.
 * The value shown/summed is the pv `net` (the cash that leaves the bank on export —
 * what the batch file pays), a real server-of-record figure. Every colour is an
 * @juneflow/tokens var(); no Thai/baht leaks here.
 */

/** A payment voucher as the export table consumes it (GET /ap/pv row, narrowed). */
export interface ExportPv {
  id: string;
  /** Honest null on the wire (pv has no doc-number column) -> "" here. */
  no: string;
  /** Resolved payee name (server join); "" when absent. */
  payee: string;
  /** Net paid = gross - wht - retention (server result), FULL baht — what the file pays. */
  net: number;
  /** Gross payable, FULL baht. */
  amount: number;
  /** Settlement method enum; only "transfer" PVs are bank-file eligible. */
  method: string;
  /** Lifecycle status; only "approved" PVs are eligible. */
  status: string;
  /**
   * The bank batch this PV was already sent in; "" while it is still waiting.
   * B-397 made the server stamp this on export and refuse a stamped PV, so the
   * screen must stop listing sent vouchers — otherwise selecting one 409s the
   * WHOLE batch and nothing is sent. This is the sent half of the two-state
   * filter the prototype declares at bank.jsx:166.
   */
  batchId: string;
  vendorId: string;
  /** Beneficiary bank code parsed from the vendor's `bank` string ("" -> em-dash). */
  bank: string;
  /** Beneficiary account parsed from the vendor's `bank` string ("" -> em-dash). */
  account: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Split a vendor's free-text bank string ("KBANK 012-3-45678-9") into a bank code +
 * an account number on the first run of whitespace. No whitespace -> the whole string
 * is the bank code, account "". Empty -> both "".
 */
export function splitBank(bankStr: string): { bank: string; account: string } {
  const trimmed = bankStr.trim();
  if (trimmed === "") return { bank: "", account: "" };
  const idx = trimmed.search(/\s/);
  if (idx === -1) return { bank: trimmed, account: "" };
  return { bank: trimmed.slice(0, idx), account: trimmed.slice(idx + 1).trim() };
}

/**
 * Narrow an opaque /ap/pv Entity row to an ExportPv, resolving the beneficiary bank/
 * account from the payee vendor's stored `bank` string via the lookup.
 */
export function toExportPv(
  e: Record<string, unknown>,
  vendorBank: (vendorId: string) => string,
): ExportPv {
  const vendorId = str(e.vendor_id ?? e.vendorId);
  const { bank, account } = splitBank(vendorBank(vendorId));
  return {
    id: str(e.id),
    no: str(e.no),
    payee: str(e.payee),
    net: num(e.net),
    amount: num(e.amount),
    method: str(e.method),
    status: str(e.status),
    batchId: str(e.batch_id ?? e.batchId),
    vendorId,
    bank,
    account,
  };
}

/** Export eligibility (bank.ts exportBatch): approved status + transfer method. */
export function isExportEligible(pv: ExportPv): boolean {
  // batchId === "" is the third term, and it is not cosmetic: buildExportBody
  // always sends pv_ids, so every export from this screen is an EXPLICIT-ids
  // call, and B-397 answers 409 for the WHOLE batch if any named voucher was
  // already sent. Without this term one stale row makes the button send nothing.
  return pv.status === "approved" && pv.method === "transfer" && pv.batchId === "";
}

/** Narrow + filter the opaque /ap/pv rows to the export-eligible set. */
export function eligibleExportPvs(
  rows: readonly Record<string, unknown>[],
  vendorBank: (vendorId: string) => string,
): ExportPv[] {
  return rows.map((r) => toExportPv(r, vendorBank)).filter(isExportEligible);
}

/**
 * Group a FULL-baht amount with thousands separators, ASCII digits + comma only,
 * no baht / decimals; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Millions with 2dp ("2840000" -> "2.84"), prototype selection caption. */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** The selection summary (bank.jsx L178: selected N of M docs + their total). */
export interface ExportSelection {
  /** Count of selected PVs. */
  count: number;
  /** Total eligible PVs. */
  total: number;
  /** Σ net of the selected PVs, FULL baht. */
  amount: number;
}

/** Compute the selection summary from the eligible rows + the selected id set. */
export function exportSelection(
  rows: readonly ExportPv[],
  selectedIds: ReadonlySet<string>,
): ExportSelection {
  const selected = rows.filter((r) => selectedIds.has(r.id));
  return {
    count: selected.length,
    total: rows.length,
    amount: selected.reduce((s, r) => s + r.net, 0),
  };
}

/** Options collected for the export body (all optional — the server defaults them). */
export interface ExportOptions {
  valueDate?: string;
  debitAccountNo?: string;
}

/**
 * Compose the opaque POST /bank/export-batch body: the selected pv_ids plus any
 * collected options. The server restricts to approved+transfer PVs owned by the tenant
 * (a foreign/ineligible id is silently excluded), so the body is a hint, not a trust
 * boundary. Empty options are omitted (the server defaults value_date to today, etc.).
 */
export function buildExportBody(
  selectedIds: readonly string[],
  opts: ExportOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { pv_ids: [...selectedIds] };
  if (opts.valueDate && opts.valueDate.trim() !== "") body.value_date = opts.valueDate.trim();
  if (opts.debitAccountNo && opts.debitAccountNo.trim() !== "") {
    body.debit_account_no = opts.debitAccountNo.trim();
  }
  return body;
}

/** Narrow the opaque export-batch response to the fields the confirm modal shows. */
export interface ExportResult {
  batchId: string;
  fileName: string;
  content: string;
  format: string;
  pvCount: number;
  totalAmount: number;
}

/** Read the export-batch result off the opaque ActionOk response. */
export function toExportResult(e: Record<string, unknown>): ExportResult {
  return {
    batchId: str(e.batch_id ?? e.batchId),
    fileName: str(e.file_name ?? e.fileName),
    content: str(e.content),
    format: str(e.format),
    pvCount: num(e.pv_count ?? e.pvCount),
    totalAmount: num(e.total_amount ?? e.totalAmount),
  };
}
