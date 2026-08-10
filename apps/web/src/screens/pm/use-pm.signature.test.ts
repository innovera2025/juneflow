/*
 * The web half of the B-331 signature contract: the stroke-JSON encoder, and what the
 * close REQUEST actually carries.
 *
 * The request tests drive `postCloseWorkorder` — the very function `useCloseWorkorder`
 * uses as its mutationFn — with `fetch` stubbed, and assert the parsed BODY of the
 * outgoing Request. That is deliberate: asserting that a hook was called with a
 * signature would prove only that this file's own mock was called, and the defect
 * being prevented (the merged FLAG: "signature is NOT sent") lived entirely between
 * the click handler and the wire.
 *
 * Node environment (apps/web/vitest.config.ts), so there is no canvas and no DOM —
 * hence no test of the pad widget itself. What IS covered is every rule the pad
 * delegates to: the encoding, the refusals, the round trip, and the request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Both of these MUST happen before the import graph below is evaluated, which is what
 * vi.hoisted is for:
 *
 *  1. api-client.ts reads VITE_API_BASE_URL at module load and otherwise uses the
 *     relative "/api/v1" the contract declares. Node's Request constructor rejects a
 *     relative URL, so the base gets an absolute origin — exactly the override
 *     api-client.ts documents ("an absolute origin in tests").
 *  2. openapi-fetch captures `globalThis.fetch` when createClient() runs, so a stub
 *     installed later would never be reached — the request would go to the network
 *     and the assertions would be measuring the mock instead of the client. (This bit
 *     is not hypothetical: stubbing inside the test first produced a real connect
 *     attempt.)
 */
const net = vi.hoisted(() => {
  process.env.VITE_API_BASE_URL = "http://juneflow.test/api/v1";
  const state: { bodies: Record<string, unknown>[]; urls: string[] } = { bodies: [], urls: [] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    // openapi-fetch may pass a Request, or a url + init pair. Read whichever it used,
    // so the assertions cannot pass by inspecting the wrong one.
    if (input instanceof Request) {
      state.urls.push(input.url);
      state.bodies.push(JSON.parse(await input.clone().text()) as Record<string, unknown>);
    } else if (init?.body != null) {
      state.urls.push(String(input));
      state.bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    } else {
      throw new Error("the close request carried no body at all");
    }
    return new Response(JSON.stringify({ id: "wo-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return state;
});

import {
  encodeSignatureInk,
  postCloseWorkorder,
  SIGNATURE_INK_VERSION,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MIN_STROKE_SPAN,
  type SignatureInk,
  type SignaturePoint,
} from "./use-pm";

const pt = (x: number, y: number): SignaturePoint => ({ x, y });

const ink = (strokes: SignaturePoint[][], width = 300, height = 90): SignatureInk => ({
  width,
  height,
  strokes,
});

/** A real signature: at least one stroke that TRAVELLED (SIGNATURE_MIN_STROKE_SPAN). */
const SIGNED = ink([
  [pt(12, 40.5), pt(13, 41.2), pt(30, 20)],
  [pt(80, 44), pt(95.5, 12.1)],
]);

/** Run `fn` and return the bodies of the requests it actually put on the wire. */
async function captureRequests(fn: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  await fn();
  expect(net.bodies.length).toBeGreaterThan(0);
  return net.bodies;
}

beforeEach(() => {
  net.bodies.length = 0;
  net.urls.length = 0;
});

describe("encodeSignatureInk — the shared wire shape (B-331)", () => {
  it("encodes exactly {v,w,h,s}, at one decimal place", () => {
    const raw = encodeSignatureInk(ink([[pt(12.34567, 40.55), pt(13.99, 41.04), pt(25.04, 48.96)]]))!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // The key set is the contract — an extra key would be a silent schema change on a
    // bare text column with no migration path.
    expect(Object.keys(parsed).sort()).toEqual(["h", "s", "v", "w"]);
    expect(parsed.v).toBe(SIGNATURE_INK_VERSION);
    expect(parsed.w).toBe(300);
    expect(parsed.h).toBe(90);
    expect(parsed.s).toEqual([
      [
        [12.3, 40.6],
        [14, 41],
        [25, 49],
      ],
    ]);
  });

  it("stores no pressure, no timing and no signer identity", () => {
    // Each was excluded on purpose. Timing is the one that matters most: it is what
    // BIOMETRIC verification uses, nothing here verifies a signature, and storing it
    // would turn an inert mark into PDPA-sensitive behavioural data.
    const parsed = JSON.parse(encodeSignatureInk(SIGNED)!) as Record<string, unknown>;
    for (const forbidden of ["pressure", "force", "t", "time", "ts", "name", "signer", "device"]) {
      expect(parsed).not.toHaveProperty(forbidden);
    }
  });

  it("produces the same VALUES as the Dart encoder — bytes differ, and that is fine", () => {
    // The two clients write the SAME column and nothing in the stack validates its
    // shape, so this is where drift would have to be caught.
    //
    // They are NOT byte-identical, and claiming they were would be wrong: Dart's
    // jsonEncode writes a whole double as `300.0`, JSON.stringify writes `300`. Run
    // against apps/mobile/lib/screens/pm_close/signature_ink.dart, the same input
    // gives
    //   Dart: {"v":1,"w":300.0,"h":110.0,"s":[[[12.0,40.5],[13.0,41.2],[30.0,52.4]],[[80.0,44.0],[81.0,44.0]]]}
    //   here: {"v":1,"w":300,"h":110,"s":[[[12,40.5],[13,41.2],[30,52.4]],[[80,44],[81,44]]]}
    // Byte-identity is not the property that matters — nothing anywhere compares these
    // strings. What matters is that each side's DECODER accepts the other's output,
    // which is why decodeSignatureInk takes any `num` and why signature_ink_test.dart
    // decodes this exact integer-valued string.
    //
    // The first stroke travels and the second is a 1 px nudge riding along, which is
    // the same fixture the Dart test uses — so the two encoders are compared on ink
    // that exercises the span rule rather than on ink that trivially passes it.
    const web = encodeSignatureInk(
      ink([[pt(12, 40.5), pt(13, 41.2), pt(30, 52.4)], [pt(80, 44), pt(81, 44)]], 300, 110),
    )!;
    expect(web).toBe('{"v":1,"w":300,"h":110,"s":[[[12,40.5],[13,41.2],[30,52.4]],[[80,44],[81,44]]]}');

    // Value-for-value against the Dart output, parsed.
    expect(JSON.parse(web)).toEqual(
      JSON.parse(
        '{"v":1,"w":300.0,"h":110.0,"s":[[[12.0,40.5],[13.0,41.2],[30.0,52.4]],[[80.0,44.0],[81.0,44.0]]]}',
      ),
    );
  });

  it("ROUND TRIP — a re-parsed value re-renders at a DIFFERENT size, undistorted", () => {
    // The reason w/h are stored at all: without them the points are unitless.
    const parsed = JSON.parse(encodeSignatureInk(ink([[pt(0, 0), pt(300, 110)]], 300, 110))!) as {
      w: number;
      h: number;
      s: number[][][];
    };

    // A 300x110 phone capture drawn into a 640x180 box: ONE scale for both axes.
    const scale = Math.min(640 / parsed.w, 180 / parsed.h);
    expect(scale).toBeCloseTo(180 / 110, 9);
    expect(parsed.w * scale).toBeLessThanOrEqual(640 + 1e-9);
    expect(parsed.h * scale).toBeCloseTo(180, 9);

    // …and shrunk into a box smaller than the capture.
    const small = Math.min(150 / parsed.w, 55 / parsed.h);
    expect(small).toBeCloseTo(0.5, 9);
    expect(parsed.s[0]![1]![0]! * small).toBeCloseTo(150, 9);

    // Re-encoding what was parsed is byte-identical: the value does not drift on
    // every save/load cycle.
    const first = encodeSignatureInk(SIGNED)!;
    const back = JSON.parse(first) as { w: number; h: number; s: number[][][] };
    expect(
      encodeSignatureInk({
        width: back.w,
        height: back.h,
        strokes: back.s.map((s) => s.map(([x, y]) => pt(x!, y!))),
      }),
    ).toBe(first);
  });

  it("REFUSES an empty pad, a taps-only pad and a degenerate viewport", () => {
    // Empty: `{"v":1,…,"s":[]}` is a NON-EMPTY string, and every reader marks the WO
    // done on non-emptiness alone (wo-rows.ts L206, mobile pm_jobs_agg, api counts.ts)
    // without looking inside — a fabricated record of the customer's consent.
    expect(encodeSignatureInk(ink([]))).toBeNull();
    expect(encodeSignatureInk(ink([[]]))).toBeNull();
    // Taps only: a single-point stroke is what an accidental click produces.
    expect(encodeSignatureInk(ink([[pt(10, 10)], [pt(20, 20)]]))).toBeNull();
    // Degenerate viewport. The stroke here DOES satisfy the span rule, so each null
    // is caused by the viewport and nothing else — a 1 px fixture would pass this
    // test with the viewport check deleted.
    expect(encodeSignatureInk(ink([[pt(1, 1), pt(20, 20)]], 0))).toBeNull();
    expect(encodeSignatureInk(ink([[pt(1, 1), pt(20, 20)]], 300, -5))).toBeNull();
    expect(encodeSignatureInk(ink([[pt(1, 1), pt(20, 20)]], Number.NaN))).toBeNull();
  });

  it("REFUSES a ONE-PIXEL DRAG — the guard is geometry, not a point count (B-357/F2)", () => {
    // THE REVERT PROBE for the span guard. Under the previous rule — "any stroke with
    // 2+ points" — this exact ink ENCODED, because both pads thin sub-pixel samples at
    // 1 px and therefore admit the second point at exactly 1.0 px. The smallest thing
    // that could close a work order was a one-pixel drag, while the rule was
    // documented as stopping "an accidental brush against the pad".
    //
    // Restore `ink.strokes.some((s) => s.length >= 2)` and this test alone goes red.
    expect(encodeSignatureInk(ink([[pt(40, 55), pt(41, 55)]]))).toBeNull();

    // Jitter in place: 40 points, each 1 px from the last, all inside a 3 px box. A
    // point count reads that as a long confident stroke — and it is also why the
    // measure is the bounding-box diagonal rather than the summed path length, which
    // here is ~40 px of travelling nowhere.
    const jitter = Array.from({ length: 40 }, (_, i) => pt(50 + (i % 4), 60 + (i % 3)));
    expect(encodeSignatureInk(ink([jitter]))).toBeNull();

    // TWO ACCIDENTS DO NOT ADD UP: a 1 px twitch plus a stray dot 200 px away span the
    // whole pad BETWEEN them, which is why the span is per stroke and never over the
    // union of the ink.
    expect(encodeSignatureInk(ink([[pt(10, 10), pt(11, 10)], [pt(210, 80)]]))).toBeNull();
  });

  it("the span threshold is exact, and both axes count", () => {
    // Pinned on the constant rather than a literal, so a future change to the
    // threshold moves this test with it instead of silently invalidating it.
    const span = SIGNATURE_MIN_STROKE_SPAN;
    // Axis-aligned: the bounding-box diagonal IS the length.
    expect(encodeSignatureInk(ink([[pt(10, 20), pt(10 + span, 20)]]))).not.toBeNull();
    expect(encodeSignatureInk(ink([[pt(10, 20), pt(10 + span - 0.1, 20)]]))).toBeNull();
    // Diagonal: 6 across / 8 down spans 10 and encodes; 3 across / 4 down spans 5 and
    // does not, though it moved on both axes.
    expect(encodeSignatureInk(ink([[pt(10, 20), pt(16, 28)]]))).not.toBeNull();
    expect(encodeSignatureInk(ink([[pt(10, 20), pt(13, 24)]]))).toBeNull();
  });

  it("keeps a dot that sits INSIDE a real signature", () => {
    const parsed = JSON.parse(encodeSignatureInk(ink([[pt(10, 10), pt(30, 30)], [pt(40, 5)]]))!) as {
      s: number[][][];
    };
    expect(parsed.s).toHaveLength(2);
  });

  it("drops a non-finite coordinate rather than writing JSON null", () => {
    const raw = encodeSignatureInk(ink([[pt(1, 1), pt(Number.NaN, 5), pt(12, 10)]]))!;
    expect(raw).not.toContain("null");
    expect((JSON.parse(raw) as { s: number[][][] }).s[0]).toHaveLength(2);
  });

  it("caps the point budget at the SAME value as the Dart encoder", () => {
    // The two clients write the same column, so a bound that differed would mean one
    // platform could store a signature the other's cap says is impossible.
    expect(SIGNATURE_MAX_POINTS).toBe(10_000);
    const long = Array.from({ length: SIGNATURE_MAX_POINTS + 500 }, (_, i) => pt(i % 300, i % 90));
    const parsed = JSON.parse(encodeSignatureInk(ink([long]))!) as { s: number[][][] };
    expect(parsed.s[0]).toHaveLength(SIGNATURE_MAX_POINTS);
    // A real prefix — what is stored is genuinely the start of what was drawn.
    expect(parsed.s[0]![0]).toEqual([0, 0]);
  });
});

describe("postCloseWorkorder — what reaches the wire", () => {
  const base = { id: "wo-1", cause: "c", fix: "f", advice: "a" };

  it("SENDS the signature — the merged FLAG said it never would", () => {
    const signature = encodeSignatureInk(SIGNED)!;
    return captureRequests(() => postCloseWorkorder({ ...base, signature })).then((bodies) => {
      expect(bodies).toHaveLength(1);
      const body = bodies[0]!;
      expect(body.signature).toBe(signature);
      // …and it is real, re-renderable stroke JSON on the wire, not a flag or a name.
      const parsed = JSON.parse(String(body.signature)) as { v: number; s: number[][][] };
      expect(parsed.v).toBe(SIGNATURE_INK_VERSION);
      expect(parsed.s.some((s) => s.length >= 2)).toBe(true);
      // The log still rides along — the signature was ADDED, nothing was displaced.
      expect(body.cause).toBe("c");
      expect(body.fix).toBe("f");
      expect(body.advice).toBe("a");
    });
  });

  it("OMITS the key entirely when no signature was captured", async () => {
    // Not `signature: ""`. The handler stores `str(...).trim() || null`, so a blank
    // would write NULL — ERASING a signature already on the row and reverting a
    // completed work order to open. `has(body, "signature")` is what it branches on.
    for (const signature of [undefined, "", "   "]) {
      net.bodies.length = 0;
      const bodies = await captureRequests(() => postCloseWorkorder({ ...base, signature }));
      expect(Object.keys(bodies[0]!).sort()).toEqual(["advice", "cause", "fix"]);
      expect(bodies[0]!).not.toHaveProperty("signature");
    }
  });

  it("sends nothing beyond the four contract fields", async () => {
    // openapi.yaml declares exactly {cause, fix, advice, signature} for this endpoint
    // and the handler ignores anything else — an extra key would be a contract drift
    // no type check would catch, since the body is assembled by hand here.
    const bodies = await captureRequests(() =>
      postCloseWorkorder({ ...base, signature: encodeSignatureInk(SIGNED)! }),
    );
    expect(Object.keys(bodies[0]!).sort()).toEqual(["advice", "cause", "fix", "signature"]);
  });
});
