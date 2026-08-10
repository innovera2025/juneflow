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
  closeToastText,
  encodeSignatureInk,
  postCloseWorkorder,
  SIGNATURE_INK_VERSION,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MIN_POINT_GAP,
  SIGNATURE_MIN_STROKE_SPAN,
  clearSignatureCapture,
  createSignatureCapture,
  readSignatureCapture,
  resizeSignatureCapture,
  signatureCaptureHasInk,
  signaturePadCancel,
  signaturePadDown,
  signaturePadMove,
  signaturePadUp,
  type PadPointer,
  type PadRect,
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

describe("the close toast states only what happened (B-357/F5)", () => {
  // The stored value of pm.toastClosed, byte-for-byte from docs/extract/i18n-full.json
  // (all four languages carry this same Thai string). Thai literals are legitimate in
  // a *.test.ts — the i18n-guard skips test files, and pinning the REAL value is the
  // whole point: a test written against a paraphrase would not notice the key drifting
  // out from under the clause-drop.
  const STORED = "ปิดงาน {no} เรียบร้อย · ส่งรายงานให้ลูกค้าแล้ว";

  it("drops the report-send clause and keeps the close", () => {
    // "the report has been sent to the customer" — lineNotifyStub is a verified no-op
    // (B-108b) and there is no certificate column for it to have sent.
    expect(closeToastText(STORED, "—")).toBe("ปิดงาน — เรียบร้อย");
    expect(closeToastText(STORED, "—")).not.toContain("ส่งรายงาน");
  });

  it("says the same thing about a signed close and an unsigned one", () => {
    // The web close is legitimately available WITHOUT a signature (it records the
    // cause/fix/advice log too), so the toast must not assert the customer signed —
    // which is why pm.closedNote, the sentence mobile prints, is not borrowed here.
    const text = closeToastText(STORED, "—");
    expect(text).not.toContain("ลงนาม");
  });

  it("is zero-mint: the surviving text is a PREFIX of the stored value", () => {
    // Nothing is re-translated and no key is minted. The output must be characters the
    // dict already carries, in the order it carries them — the same class of operation
    // the screen already performs on this value ({no} -> em-dash).
    expect(STORED.startsWith(closeToastText(STORED, "{no}"))).toBe(true);
  });

  it("leaves a single-claim value untouched", () => {
    // A key with no separator has no unbacked tail to drop, and must survive whole.
    expect(closeToastText("ปิดงาน {no} เรียบร้อย", "WO-9")).toBe("ปิดงาน WO-9 เรียบร้อย");
  });
});

/* ===========================================================================
 * THE PAD → REQUEST SEAM (B-357/F1)
 * ===========================================================================
 * The defect this whole round exists to fix is "a pad that drew and discarded", and
 * until this group the seam carrying a stroke out of the pad was the ONE part of the
 * path with no coverage: the node environment has no canvas and no DOM, and the
 * workspace has no jsdom to add one (B-358). The gate demonstrated the cost by
 * mutating the pad's wiring to throw every stroke away — 1776 tests stayed green.
 *
 * So the seam is no longer in JSX. `wo-detail.tsx` holds a plain SignatureCapture and
 * calls the pure functions below on each pointer event; the confirm handler reads the
 * SAME object. What is left un-pinned is React's own event dispatch — and the discard
 * mutation that started this no longer type-checks, because the pad has no callback
 * prop to hand a discarding function to.
 *
 * Every test here is written to die on a "drew and discarded" cut: make
 * signaturePadMove or signaturePadUp a no-op, or have readSignatureCapture ignore the
 * strokes, and this group goes red.
 */

/** A pad occupying [rect] on screen, producing pointer events in PAGE coordinates. */
function fakePad(rect: PadRect) {
  const captured: number[] = [];
  const target = {
    getBoundingClientRect: () => rect,
    setPointerCapture: (id: number) => captured.push(id),
  };
  return {
    captured,
    /** Resize the box under the pointer — a rotation, or a resized window. */
    resize(width: number, height: number) {
      rect = { ...rect, width, height };
    },
    /** A pointer event at PAGE coordinates (rect.left + x, rect.top + y). */
    at(x: number, y: number, pointerId = 7): PadPointer {
      return { pointerId, clientX: rect.left + x, clientY: rect.top + y, currentTarget: target };
    },
  };
}

/** Draw one stroke: pen-down at the first point, moves through the rest, pen-up. */
function draw(capture: ReturnType<typeof createSignatureCapture>, pad: ReturnType<typeof fakePad>, pts: [number, number][]) {
  signaturePadDown(capture, pad.at(pts[0]![0], pts[0]![1]));
  for (const [x, y] of pts.slice(1)) signaturePadMove(capture, pad.at(x, y));
  signaturePadUp(capture);
}

describe("the pad → request seam (B-357/F1)", () => {
  // The pad is 300x90 CSS px (pm3.jsx L137) and sits 20px in / 100px down the page, so
  // a passing test cannot be one that ignores the rect origin.
  const RECT: PadRect = { left: 20, top: 100, width: 300, height: 90 };

  it("a drawn stroke reaches the request as parseable stroke JSON", () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);

    draw(capture, pad, [
      [10, 70],
      [30, 40],
      [60, 62],
      [95, 25],
    ]);

    const signature = readSignatureCapture(capture);
    expect(signature).not.toBeNull();
    const parsed = JSON.parse(signature!) as { v: number; w: number; h: number; s: number[][][] };

    expect(parsed.v).toBe(SIGNATURE_INK_VERSION);
    // The viewport is the box the points were MEASURED in — not a constant, and not
    // whatever the box happens to be later (B-357/F6).
    expect(parsed.w).toBe(300);
    expect(parsed.h).toBe(90);
    // PAD coordinates, so the rect origin was subtracted. Page coordinates would put
    // this stroke at x≈30 / y≈170 and the stored mark would be off the pad.
    expect(parsed.s).toEqual([
      [
        [10, 70],
        [30, 40],
        [60, 62],
        [95, 25],
      ],
    ]);
  });

  it("and that value is what the close REQUEST carries", async () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);
    draw(capture, pad, [
      [10, 70],
      [40, 30],
      [80, 55],
    ]);

    // The whole path, end to end: pointer events → capture → encode → wire.
    const signature = readSignatureCapture(capture) ?? undefined;
    const bodies = await captureRequests(() =>
      postCloseWorkorder({ id: "wo-1", cause: "c", fix: "f", advice: "a", signature }),
    );
    expect(bodies[0]!.signature).toBe(signature);
    const parsed = JSON.parse(String(bodies[0]!.signature)) as { s: number[][][] };
    expect(parsed.s[0]).toHaveLength(3);
  });

  it("captures the pointer on pen-down and CLAMPS a finger that slides off the pad", () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);

    signaturePadDown(capture, pad.at(10, 70));
    // Without the capture the canvas stops receiving moves the moment the finger
    // crosses the edge, and the stroke ends there.
    expect(pad.captured).toEqual([7]);

    signaturePadMove(capture, pad.at(400, -60)); // well outside the box
    signaturePadUp(capture);

    const parsed = JSON.parse(readSignatureCapture(capture)!) as { s: number[][][] };
    // Clamped into the viewport: ink outside w×h could not be re-rendered without
    // either clipping it or shrinking the whole signature to fit an excursion.
    expect(parsed.s[0]![1]).toEqual([300, 0]);
  });

  it("thins sub-pixel samples but keeps everything that moved", () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);

    signaturePadDown(capture, pad.at(10, 70));
    // Ten samples inside one pixel — a nearly-still finger. They add bytes and change
    // no geometry.
    for (let i = 1; i <= 10; i++) signaturePadMove(capture, pad.at(10 + i * 0.05, 70));
    expect(capture.active).toHaveLength(1);
    // A move past the gap is kept.
    signaturePadMove(capture, pad.at(10 + SIGNATURE_MIN_POINT_GAP, 70));
    expect(capture.active).toHaveLength(2);
    signaturePadUp(capture);
  });

  it("a tap reads null, and so does a pad nobody touched", () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);

    expect(readSignatureCapture(capture)).toBeNull();
    expect(signatureCaptureHasInk(capture)).toBe(false);

    signaturePadDown(capture, pad.at(120, 45));
    signaturePadUp(capture);

    // There IS ink (the dot is drawn, so the customer sees what they made) — but it
    // travelled nowhere, so nothing may be sent.
    expect(signatureCaptureHasInk(capture)).toBe(true);
    expect(readSignatureCapture(capture)).toBeNull();
  });

  it("a CANCELLED stroke is discarded, not completed", () => {
    // The OS took the pointer (a system gesture, an incoming call). The customer never
    // finished the mark, so a half-stroke the pad tore off itself is not theirs.
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);

    signaturePadDown(capture, pad.at(10, 70));
    signaturePadMove(capture, pad.at(60, 30));
    signaturePadCancel(capture);

    expect(capture.strokes).toEqual([]);
    expect(signatureCaptureHasInk(capture)).toBe(false);
    expect(readSignatureCapture(capture)).toBeNull();
  });

  it("clear takes back a mis-stroke and leaves nothing to send", () => {
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);
    draw(capture, pad, [
      [10, 70],
      [90, 20],
    ]);
    expect(readSignatureCapture(capture)).not.toBeNull();

    clearSignatureCapture(capture);

    expect(signatureCaptureHasInk(capture)).toBe(false);
    expect(readSignatureCapture(capture)).toBeNull();
  });

  it("an in-progress stroke is already readable — the confirm cannot miss the last stroke", () => {
    // The customer lifts a finger and the technician taps confirm in the same instant;
    // on a touch device the pointerup can arrive after the click. Reading the capture
    // includes the open stroke, so the mark is never dropped for being unfinished.
    const capture = createSignatureCapture();
    const pad = fakePad(RECT);
    signaturePadDown(capture, pad.at(10, 70));
    signaturePadMove(capture, pad.at(50, 30));
    signaturePadMove(capture, pad.at(90, 60));

    const parsed = JSON.parse(readSignatureCapture(capture)!) as { s: number[][][] };
    expect(parsed.s[0]).toHaveLength(3);
  });
});

describe("the stored viewport describes the strokes it labels (B-357/F6)", () => {
  it("a rotation MID-SIGNATURE rescales what is already drawn", () => {
    // The scenario: the first stroke is made in portrait, the phone rotates while it
    // is handed across, the customer finishes in landscape. Before this fix the
    // encoder stamped the LANDSCAPE width onto points measured in the portrait box —
    // arithmetically perfect, and the picture came back at roughly half size, offset.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 360, height: 90 });

    draw(capture, pad, [
      [20, 70],
      [100, 20],
      [180, 70],
    ]);

    pad.resize(780, 90);
    draw(capture, pad, [
      [400, 30],
      [500, 60],
    ]);

    const parsed = JSON.parse(readSignatureCapture(capture)!) as { w: number; h: number; s: number[][][] };
    expect(parsed.w).toBe(780);
    expect(parsed.h).toBe(90);

    // The transform is the one the painters use to re-render stored ink: uniform
    // min-scale plus centring. min(780/360, 90/90) = 1, so the portrait stroke keeps
    // its size and shape and is re-centred by (780 - 360)/2 = 210.
    expect(parsed.s[0]).toEqual([
      [230, 70],
      [310, 20],
      [390, 70],
    ]);
    // …and the landscape stroke is stored as drawn.
    expect(parsed.s[1]).toEqual([
      [400, 30],
      [500, 60],
    ]);
  });

  it("a scale change is applied uniformly, so the mark is never stretched", () => {
    // A pad that genuinely grows (a phone handed to a tablet-sized layout): both axes
    // double, so every point doubles and nothing is centred away.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 300, height: 90 });
    draw(capture, pad, [
      [10, 10],
      [70, 40],
    ]);

    resizeSignatureCapture(capture, 600, 180);

    const parsed = JSON.parse(readSignatureCapture(capture)!) as { w: number; h: number; s: number[][][] };
    expect(parsed.w).toBe(600);
    expect(parsed.h).toBe(180);
    expect(parsed.s[0]).toEqual([
      [20, 20],
      [140, 80],
    ]);
  });

  it("a degenerate resize is refused rather than making the points unitless", () => {
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 300, height: 90 });
    draw(capture, pad, [
      [10, 10],
      [70, 40],
    ]);
    const before = readSignatureCapture(capture);

    for (const [w, h] of [
      [0, 90],
      [300, -1],
      [Number.NaN, 90],
      [300, Number.POSITIVE_INFINITY],
    ] as [number, number][]) {
      resizeSignatureCapture(capture, w, h);
    }

    expect(readSignatureCapture(capture)).toBe(before);
  });

  it("the ACTIVE stroke rescales too — a rotation mid-stroke does not tear it in half", () => {
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 300, height: 90 });

    signaturePadDown(capture, pad.at(10, 10));
    signaturePadMove(capture, pad.at(70, 40));
    // The box doubles while the finger is still down. signaturePadMove syncs first, so
    // the point it is about to push lands in the same space as the ones already there.
    pad.resize(600, 180);
    signaturePadMove(capture, pad.at(300, 120));
    signaturePadUp(capture);

    const parsed = JSON.parse(readSignatureCapture(capture)!) as { s: number[][][] };
    expect(parsed.s[0]).toEqual([
      [20, 20],
      [140, 80],
      [300, 120],
    ]);
  });
});
