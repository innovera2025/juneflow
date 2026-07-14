// B-014 list envelope — every list endpoint returns `{data, page, page_size,
// total}` (openapi.yaml `Paginated` + per-endpoint `allOf` data.items). The
// implemented list handlers (GET /companies, GET /projects) return the complete
// tenant-scoped set unpaginated by design — the shell switchers consume every
// row (see projects.ts / companies.ts) — so the response is always a single
// full page.
//
// Metadata is therefore reported honestly for a one-page result:
//   page      = 1
//   total     = rows.length            (the full count)
//   page_size = max(rows.length, DEFAULT_PAGE_SIZE)
// page_size is the effective page capacity: it never falls below the rows on
// this page (so `data.length <= page_size` always holds) and never below 1 for
// an empty set (the contract requires `page_size >= 1`).

/** Default rows-per-page applied when the client omits `page_size` (B-014). */
export const DEFAULT_PAGE_SIZE = 50;

/** The B-014 list envelope shape, generic over the row type. */
export interface ListEnvelope<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

/**
 * Wrap a fully-materialized, tenant-scoped result set in the B-014 list
 * envelope as a single full page (these handlers do not slice — see module
 * header).
 */
export function listEnvelope<T>(rows: T[]): ListEnvelope<T> {
  return {
    data: rows,
    page: 1,
    page_size: Math.max(rows.length, DEFAULT_PAGE_SIZE),
    total: rows.length,
  };
}
