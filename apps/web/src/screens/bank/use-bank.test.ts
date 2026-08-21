/*
 * use-bank request-shape tests (gate G3) — the statement-import wire.
 *
 * WHY THIS FILE EXISTS: for months both this hook file and the screen carried a
 * comment saying POST /bank/statements/import "is NOT implemented by the API", and
 * the header button fired a toast and called nothing. The endpoint had been merged
 * the whole time (apps/api/src/routes/bank.ts:1207). Nothing caught it — a typecheck
 * cannot see a missing call, and no row-derivation test renders that button. So the
 * assertion has to be on the CALL: which path, and which body key.
 *
 * THE BODY KEY IS THE WHOLE POINT. The handler reads `file` / `content` / `csv` for
 * the CSV text, or a structured `lines[]`, and returns 400 "no statement file
 * provided" when it finds none (bank.ts:978-980). Sending the text under any other
 * name is a 400 that looks exactly like an empty file, so the key is pinned here.
 *
 * apiClient is mocked at the module boundary — nothing reaches the network — and the
 * request function is exported plainly so this runs in the node/no-DOM vitest env.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const POST = vi.fn();
const GET = vi.fn();

vi.mock("../../api-client", () => ({
  apiClient: {
    POST: (...args: unknown[]) => POST(...args),
    GET: (...args: unknown[]) => GET(...args),
  },
  API_BASE_URL: "/api/v1",
}));

const { importStatementRequest } = await import("./use-bank");

beforeEach(() => {
  POST.mockReset();
  GET.mockReset();
});

describe("importStatementRequest (the statement-import wire)", () => {
  it("POSTs the import path with the CSV text under `file`", async () => {
    POST.mockResolvedValue({ data: { statement_id: "st-1", line_count: 3, matched_count: 2 } });

    await importStatementRequest("date,desc,amount\n2026-08-01,fee,-100");

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]![0]).toBe("/bank/statements/import");
    expect(POST.mock.calls[0]![1]).toEqual({
      body: { file: "date,desc,amount\n2026-08-01,fee,-100" },
    });
  });

  it("sends the text VERBATIM — no trimming, no re-encoding", async () => {
    POST.mockResolvedValue({ data: {} });
    // A leading blank line and CRLF endings are what a real bank export looks like.
    // Parsing belongs to the handler; a client that "cleans" the file first is a
    // second, divergent parser and the two will disagree on some statement.
    const raw = "\r\nDATE,DESC,AMT\r\n2026-08-01,ATM,-500\r\n";

    await importStatementRequest(raw);

    expect((POST.mock.calls[0]![1] as { body: { file: string } }).body.file).toBe(raw);
  });

  it("sends nothing but the body — no params, no query", async () => {
    POST.mockResolvedValue({ data: {} });

    await importStatementRequest("a,b,c");

    const opts = POST.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(opts)).toEqual(["body"]);
  });

  it("REJECTS on a server error so the success toast cannot fire", async () => {
    // 403 is the live case, not a hypothetical: the route requires the finance
    // `create` permission (bank.ts:1213), and the seeded default web user does not
    // hold every finance perm. Landing that on the happy path would tell a user a
    // statement was imported when nothing was.
    POST.mockResolvedValue({
      error: { code: "FORBIDDEN", message: "bank statement import requires the finance create permission" },
    });

    await expect(importStatementRequest("a,b,c")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
