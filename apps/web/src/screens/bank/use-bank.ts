/*
 * Data hooks for the bank screens (P2-WEB-15, Wave-2 finance) — the tenant's bank
 * statements + their normalized lines (with per-line auto-match suggestions), the
 * manual line-match write, the cheque register, and the Export-to-Bank batch file.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held all of this in local arrays (bank.jsx
 * STMT / CHEQUE table / PV export table); here the server is the system of record:
 *   GET  /bank/statements            -> bank statements + per-statement recon KPIs
 *                                       (listBankStatements; B-014 envelope `.data`).
 *   GET  /bank/statements/{id}/lines -> a statement's normalized lines; each UNMATCHED
 *                                       line carries a `suggestions` array (F-BANK1
 *                                       exact-amount + date-window auto-match). Fetched
 *                                       per statement (the seed models one statement per
 *                                       line) and flattened by useBankStatementLinesMulti.
 *   POST /bank/lines/{id}/match      -> manual confirm of a line <-> doc match
 *                                       ({ pv_id | cheque_id | rv_id }); invalidates the
 *                                       statements + lines so the matched state appears.
 *   GET  /bank/cheque                -> the cheque register (listBankCheque; `.data`).
 *   POST /bank/export-batch          -> build the KBANK payment batch file from the
 *                                       selected PVs; returns { file_name, content, ... }.
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
 * NOTE: POST /bank/statements/import + POST /bank/reconcile exist in the CONTRACT but
 * are NOT implemented by the API (apps/api/src/routes/bank.ts registers only the five
 * ops above), so the "import statement" + "close reconciliation" prototype actions stay
 * client-intent stubs in the screens (flagged), never wired to a 404 route.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types the bank rows as Entity). */
type Row = Record<string, unknown>;

const STATEMENTS_KEY = ["bank", "statements"] as const;
const LINES_KEY = ["bank", "lines"] as const;
const CHEQUE_KEY = ["bank", "cheque"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /bank/statements — the tenant bank statements (B-014 envelope `{ data, ... }`). */
export function useBankStatements() {
  return useQuery<Row[]>({
    queryKey: STATEMENTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/bank/statements"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The flattened result of fetching several statements' lines in parallel. */
export interface MultiLinesResult {
  /** All the statements' lines concatenated (each row is an opaque line Entity). */
  rows: Row[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * GET /bank/statements/{id}/lines for EACH id, in parallel (useQueries), flattened.
 * The prototype showed one statement with many lines; the seed models one statement
 * per line, so the reconciliation view aggregates a period's statements — this hook
 * fetches every statement's lines and concatenates them (per-line `suggestions` intact).
 */
export function useBankStatementLinesMulti(statementIds: readonly string[]): MultiLinesResult {
  const enabled = authed();
  const results = useQueries({
    queries: statementIds.map((id) => ({
      queryKey: [...LINES_KEY, id] as const,
      queryFn: async () =>
        (await unwrap(
          apiClient.GET("/bank/statements/{id}/lines", { params: { path: { id } } }),
        )).data ?? [],
      enabled: enabled && id !== "",
      staleTime: 60_000,
    })),
  });

  return {
    rows: results.flatMap((r) => r.data ?? []),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}

/** The POST /bank/lines/{id}/match body (matchBankLine requestBody, from the contract). */
export interface MatchLineBody {
  pv_id?: string;
  cheque_id?: string;
  rv_id?: string;
}

/** A line-match mutation's input: the target line id + the chosen doc body. */
export interface MatchLineArgs {
  lineId: string;
  body: MatchLineBody;
}

/**
 * POST /bank/lines/{id}/match — manual confirm of a line <-> doc match. The server
 * re-proves tenant ownership + rejects a re-match; on success it flips matched=true
 * with the chosen FK. Invalidates both the statements (recon KPIs) and the lines
 * (the matched row) so the confirmed state appears.
 */
export function useMatchBankLine(): UseMutationResult<Entity, unknown, MatchLineArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, body }: MatchLineArgs) =>
      unwrap(apiClient.POST("/bank/lines/{id}/match", { params: { path: { id: lineId } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATEMENTS_KEY });
      void qc.invalidateQueries({ queryKey: LINES_KEY });
    },
  });
}

/** GET /bank/cheque — the tenant cheque register (B-014 envelope `{ data, ... }`). */
export function useBankCheque() {
  return useQuery<Row[]>({
    queryKey: CHEQUE_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/bank/cheque"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /bank/export-batch — build a KBANK payment batch file. The caller composes the
 * opaque body ({ pv_ids?, value_date?, debit_account_no? }); the server takes the
 * tenant's approved + transfer-method PVs (restricted to pv_ids), formats the file
 * (mock-first FakeBankFileFormatter by default), and returns { batch_id, file_name,
 * content, pv_count, total_amount, ... }. This is a pure build+return (no PV mutation),
 * so no list is invalidated.
 */
export function useExportBankBatch(): UseMutationResult<Entity, unknown, Entity> {
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/bank/export-batch", { body })),
  });
}
