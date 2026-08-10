/*
 * use-land-bank request-shape tests (gate G3) — the land.pipeline advance-stage wire.
 *
 * WHY THIS FILE EXISTS: land-pipeline.tsx said "the mock detail/advance actions are dropped"
 * while POST /land/plots/{id}/advance-stage had been mounted and api-tested for weeks. Now
 * that the control is real, the thing worth pinning is the SHAPE of the call: the contract
 * declares this op bodiless, and the whole design point is that the browser does NOT name a
 * target stage — the server walks its own LAND_STAGES. A client that started sending
 * `{ stage: "deal" }` would still typecheck as an opaque Entity and would still 200, while
 * quietly moving the authority for the pipeline order into a screen file.
 *
 * apiClient is mocked at the module boundary; nothing reaches the network.
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

const { advancePlotStageRequest } = await import("./use-land-bank");

beforeEach(() => {
  POST.mockReset();
  GET.mockReset();
});

describe("advancePlotStageRequest", () => {
  it("POSTs the advance-stage path with the plot id in the PATH", async () => {
    POST.mockResolvedValue({ data: { id: "pl1", stage: "deal" } });

    await advancePlotStageRequest("pl1");

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]![0]).toBe("/land/plots/{id}/advance-stage");
    expect(POST.mock.calls[0]![1]).toEqual({ params: { path: { id: "pl1" } } });
  });

  it("sends NO body — the server, not the browser, decides the next stage", async () => {
    POST.mockResolvedValue({ data: { id: "pl1", stage: "deal" } });

    await advancePlotStageRequest("pl1");

    const opts = POST.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(opts)).toEqual(["params"]);
    expect("body" in opts).toBe(false);
  });

  it("returns the server's stage so the toast can label what actually happened", async () => {
    POST.mockResolvedValue({ data: { id: "pl1", stage: "close" } });

    await expect(advancePlotStageRequest("pl1")).resolves.toEqual({ id: "pl1", stage: "close" });
  });

  it("returns {} rather than undefined when the 200 body is empty", async () => {
    POST.mockResolvedValue({ data: undefined });

    // The toast reads `res.stage`; a bare undefined would throw inside the success handler
    // and be reported as a failure of a write that in fact succeeded.
    await expect(advancePlotStageRequest("pl1")).resolves.toEqual({});
  });

  it("REJECTS on the terminal 409 instead of resolving", async () => {
    POST.mockResolvedValue({
      error: { code: "INVALID_STATE", message: "land plot is already at the final stage (closed)" },
    });

    await expect(advancePlotStageRequest("pl1")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
