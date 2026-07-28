/*
 * Data hooks for the Solar/Energy-EPC screens (solar.*), all READ-ONLY. Ported from
 * pototype/solar.jsx, whose screens each held their data in a local array; here the
 * server is the system of record. Every read goes through the generated typed client
 * (api-client.ts) + TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md
 * §5, apps/web/CLAUDE.md). Each list is the B-014 paginated envelope `{ data, ... }`; the
 * screens consume the page rows (`data`).
 *
 * The six solar reads (apps/api/src/routes/solar.ts, GET-only) are:
 *   GET /solar/inverters    -> real-time inverter register (monitoring table).
 *   GET /solar/om-tickets   -> O&M work-ticket list (the monitor side card).
 *   GET /solar/ppa-invoices -> monthly PPA sell-electricity billing rows.
 *   GET /solar/roi          -> cumulative-cashflow year rows (ROI table).
 *   GET /solar/permit-steps -> permit/approval timeline steps.
 *   GET /solar/warranties   -> equipment warranty register.
 *
 * There is intentionally NO create/update hook: no POST/PUT solar handler is registered
 * (solar.ts is GET-only), so every write affordance in the prototype (open-OM-ticket,
 * create-invoice, add-permit, add-warranty) ships honest-disabled instead of wiring a
 * mutation that would live-404. A future backend write bundle adds the handlers.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types every solar row as Entity). */
type Row = Record<string, unknown>;

/** True when a bearer token is present — the queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /solar/inverters — the real-time inverter register (solar.monitor table). */
export function useSolarInverters() {
  return useQuery<Row[]>({
    queryKey: ["solar-inverters"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/inverters"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/om-tickets — the O&M work tickets (solar.monitor side card). */
export function useSolarOmTickets() {
  return useQuery<Row[]>({
    queryKey: ["solar-om-tickets"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/om-tickets"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/ppa-invoices — the monthly PPA billing rows (solar.ppa table). */
export function useSolarPpaInvoices() {
  return useQuery<Row[]>({
    queryKey: ["solar-ppa-invoices"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/ppa-invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/roi — the cumulative-cashflow year rows (solar.roi table). */
export function useSolarRoi() {
  return useQuery<Row[]>({
    queryKey: ["solar-roi"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/roi"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/permit-steps — the permit/approval timeline steps (solar.permit). */
export function useSolarPermitSteps() {
  return useQuery<Row[]>({
    queryKey: ["solar-permit-steps"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/permit-steps"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/warranties — the equipment warranty register (solar.warranty table). */
export function useSolarWarranties() {
  return useQuery<Row[]>({
    queryKey: ["solar-warranties"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/warranties"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
