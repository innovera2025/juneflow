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
  createSignaturePadBinding,
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
  type SignaturePadBinding,
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
 * So the seam is no longer in JSX. The pure functions below carry every rule between a
 * pointer event and the wire, and the group after this one pins the BINDING that hands
 * the same capture to the pad and to the confirm button.
 *
 * WHAT IS STILL NOT PINNED, said plainly because this header used to claim it away. It
 * read: "the discard mutation that started this no longer type-checks, because the pad
 * has no callback prop to hand a discarding function to." True about the callback,
 * false as a conclusion — the seam became object IDENTITY, and TypeScript does not
 * check identity. Both of the gate's probes compiled at `tsc --noEmit` exit 0 with the
 * whole suite green: `capture={createSignatureCapture()}` and
 * `capture={{ ...capture.current }}`. The second is closed by construction now (see
 * the binding group below); the first is NOT, and is disclosed in BLOCKERS.md B-358
 * rather than claimed impossible.
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

/* ===========================================================================
 * THE BINDING — one capture at BOTH ends (B-357/F1, second round)
 * ===========================================================================
 * The group above pins the pure rules. This one pins the thing the gate broke twice:
 * that the object the PAD writes and the object CONFIRM reads are the same one.
 *
 * The two probes, both of which compiled clean and left 1794 green against the old
 * `capture={…}` prop:
 *
 *   (A) `capture={createSignatureCapture()}`  — a different object handed to the pad.
 *   (B) `capture={{ ...capture.current }}`    — a shallow copy. The dangerous one: the
 *       copy SHARES `strokes`, so the ink renders perfectly and the technician sees
 *       the customer's signature, but `width`/`height` land on the copy, the real
 *       object keeps width 0, and encodeSignatureInk takes its degenerate-viewport
 *       branch. The WO closes with `customer_sign` NULL.
 *
 * (B) is what this group closes, and closes STRUCTURALLY rather than by assertion:
 * every member of a binding is a closure over one capture, so a shallow copy of a
 * binding is that binding. The test below spreads one and draws through the copy.
 *
 * (A) is NOT closed and is not pretended to be — building a fresh binding at the call
 * site is still expressible and still invisible on screen. BLOCKERS.md B-358 carries
 * it with both probes as the reproduction.
 */
describe("the pad binding is ONE capture at both ends (B-357/F1)", () => {
  const RECT: PadRect = { left: 20, top: 100, width: 300, height: 90 };

  /** Drive a binding's own handlers — exactly the calls wo-detail.tsx's canvas makes. */
  function drawOn(b: SignaturePadBinding, pad: ReturnType<typeof fakePad>, pts: [number, number][]) {
    b.down(pad.at(pts[0]![0], pts[0]![1]));
    for (const [x, y] of pts.slice(1)) b.move(pad.at(x, y));
    b.up();
  }

  const NAME: [number, number][] = [
    [10, 70],
    [30, 40],
    [60, 62],
    [95, 25],
  ];

  it("handlers → read round-trips non-null on ONE object", () => {
    const b = createSignaturePadBinding();
    drawOn(b, fakePad(RECT), NAME);

    expect(b.hasInk()).toBe(true);
    const signature = b.read();
    expect(signature).not.toBeNull();

    const parsed = JSON.parse(signature!) as { w: number; h: number; s: number[][][] };
    // The viewport landed on the SAME object the strokes did — this is the exact pair
    // probe (B) split apart.
    expect(parsed.w).toBe(300);
    expect(parsed.h).toBe(90);
    expect(parsed.s).toHaveLength(1);
    expect(parsed.s[0]).toHaveLength(4);
  });

  it("a shallow COPY of a binding is the binding it was copied from (probe B)", () => {
    const b = createSignaturePadBinding();
    const copy = { ...b };
    expect(copy).not.toBe(b);

    // Draw through the COPY, read through the ORIGINAL.
    drawOn(copy, fakePad(RECT), NAME);

    expect(b.hasInk()).toBe(true);
    const signature = b.read();
    expect(signature).not.toBeNull();
    expect(signature).toBe(copy.read());
    // Under probe (B) this was the assertion that failed while the canvas looked
    // perfect: the strokes were shared and the viewport was not.
    expect((JSON.parse(signature!) as { w: number }).w).toBe(300);
  });

  it("what the pad PAINTS is what confirm SENDS", () => {
    const b = createSignaturePadBinding();
    const pad = fakePad(RECT);
    drawOn(b, pad, NAME);
    // Still drawing a second stroke: the open one is painted AND sent.
    b.down(pad.at(150, 30));
    b.move(pad.at(190, 65));

    const painted = b.strokesToPaint();
    const sent = (JSON.parse(b.read()!) as { s: number[][][] }).s;
    expect(painted).toHaveLength(2);
    expect(sent).toHaveLength(painted.length);
    expect(sent.map((s) => s.length)).toEqual(painted.map((s) => s.length));
  });

  it("clear() empties the very capture read() reads", () => {
    const b = createSignaturePadBinding();
    drawOn(b, fakePad(RECT), NAME);
    expect(b.read()).not.toBeNull();

    b.clear();

    expect(b.hasInk()).toBe(false);
    expect(b.strokesToPaint()).toEqual([]);
    expect(b.read()).toBeNull();
  });

  it("cancel() drops the open stroke, and read() agrees with the canvas", () => {
    const b = createSignaturePadBinding();
    const pad = fakePad(RECT);
    b.down(pad.at(10, 70));
    b.move(pad.at(60, 30));
    b.cancel();

    expect(b.hasInk()).toBe(false);
    expect(b.strokesToPaint()).toEqual([]);
    expect(b.read()).toBeNull();
  });

  it("two bindings do not share a capture", () => {
    // The other half of "one object": binding state must not be module-level, or two
    // open close modals would sign each other's work orders.
    const first = createSignaturePadBinding();
    const second = createSignaturePadBinding();
    drawOn(first, fakePad(RECT), NAME);

    expect(first.read()).not.toBeNull();
    expect(second.hasInk()).toBe(false);
    expect(second.read()).toBeNull();
  });
});

/* ===========================================================================
 * THE CONFIRM GATE — the two clients agree about a drawn-on pad (B-357/F3)
 * ===========================================================================
 * The asymmetry this closes was not in what the guard ACCEPTS (both clients accept a
 * 9 px slip and a hand dragged across the pad — that limit is stated, not hidden). It
 * was in what happens on REJECTION: mobile gates its CTA on the encode, so
 * un-encodable ink leaves the button quiet; web left confirm permanently enabled and
 * sent `?? undefined`, so a pad visibly covered in ink closed the work order unsigned
 * under a success toast.
 *
 * `refusesInk()` is the web side adopting mobile's rule, and it lives on the binding
 * rather than as an expression in JSX precisely so this group can reach it.
 */
describe("the confirm gate refuses to discard drawn ink (B-357/F3)", () => {
  const RECT: PadRect = { left: 20, top: 100, width: 300, height: 90 };

  function drawOn(b: SignaturePadBinding, pad: ReturnType<typeof fakePad>, pts: [number, number][]) {
    b.down(pad.at(pts[0]![0], pts[0]![1]));
    for (const [x, y] of pts.slice(1)) b.move(pad.at(x, y));
    b.up();
  }

  it("an EMPTY pad does not refuse — an unsigned close is legitimate on web", () => {
    const b = createSignaturePadBinding();
    expect(b.hasInk()).toBe(false);
    expect(b.read()).toBeNull();
    // The one case that must stay ENABLED: the close still records cause/fix/advice,
    // and the toast claims no signature.
    expect(b.refusesInk()).toBe(false);
  });

  it("a real signature does not refuse", () => {
    const b = createSignaturePadBinding();
    drawOn(b, fakePad(RECT), [
      [10, 70],
      [30, 40],
      [60, 62],
      [95, 25],
    ]);
    expect(b.read()).not.toBeNull();
    expect(b.refusesInk()).toBe(false);
  });

  it("a pad covered in SHORT strokes refuses — the mark the old gate discarded", () => {
    // The gate's own reproduction: 12 strokes spanning the full 300 px pad, each about
    // 6.4 px of travel. Every one is under SIGNATURE_MIN_STROKE_SPAN, so the encoder
    // returns null while the canvas is visibly covered in ink.
    const b = createSignaturePadBinding();
    const pad = fakePad(RECT);
    for (let i = 0; i < 12; i++) {
      const x = 8 + i * 24;
      drawOn(b, pad, [
        [x, 45],
        [x + 4, 50],
      ]);
    }

    expect(b.hasInk()).toBe(true);
    expect(b.strokesToPaint()).toHaveLength(12);
    expect(b.read()).toBeNull();
    // Before this gate the button was enabled here, `?? undefined` dropped the mark,
    // and the close reported success.
    expect(b.refusesInk()).toBe(true);
  });

  it("a taps-only pad refuses", () => {
    const b = createSignaturePadBinding();
    const pad = fakePad(RECT);
    for (const [x, y] of [
      [40, 40],
      [120, 55],
    ] as [number, number][]) {
      b.down(pad.at(x, y));
      b.up();
    }

    expect(b.hasInk()).toBe(true);
    expect(b.read()).toBeNull();
    expect(b.refusesInk()).toBe(true);
  });

  it("clearing a refused pad returns the CTA to the empty-pad case", () => {
    const b = createSignaturePadBinding();
    const pad = fakePad(RECT);
    b.down(pad.at(40, 40));
    b.up();
    expect(b.refusesInk()).toBe(true);

    // The escape hatch the gate depends on: the clear affordance is showing whenever
    // refusesInk() is true, because both read the same hasInk().
    expect(b.hasInk()).toBe(true);
    b.clear();
    expect(b.refusesInk()).toBe(false);
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

/* ===========================================================================
 * A RESIZE MUST NOT RETRO-REJECT A REAL SIGNATURE (B-357/F4)
 * ===========================================================================
 * resizeSignatureCapture uses `min(w/cw, h/ch)`, and the pad has a FIXED height, so
 * the transform is ASYMMETRIC: a narrowed pad scales the ink down, a widened one
 * leaves it alone. That put a legitimate small signature under the 8 px the consent
 * guard measures — captured at width 400 it encoded; after a narrowing to 200 the very
 * same mark returned null, and on web (before B-357/F3) it was then closed silently.
 *
 * The fix carries per-stroke provenance (SignatureCapture.strokeScale), so the guard
 * runs in the space the stroke was DRAWN in. The pair of tests that matter are the two
 * DIRECTIONS: a real mark survives a narrowing, and a twitch drawn AFTER one still
 * fails. A single capture-wide factor would pass the first and fail the second.
 */
describe("a resize does not change what counts as a signature (B-357/F4)", () => {
  it("a real mark survives a narrowing that used to unsign it", () => {
    // The gate's reproduction: an ~11.7 px stroke on a 400 px pad, then the window
    // narrows to 200. The stored span halves to ~5.85, under SIGNATURE_MIN_STROKE_SPAN.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 400, height: 90 });
    draw(capture, pad, [
      [100, 40],
      [109, 47.5],
    ]);
    const beforeResize = readSignatureCapture(capture);
    expect(beforeResize).not.toBeNull();

    resizeSignatureCapture(capture, 200, 90);

    // The ink really did shrink — this is not a test that the rescale stopped working.
    const parsed = JSON.parse(readSignatureCapture(capture)!) as { w: number; s: number[][][] };
    expect(parsed.w).toBe(200);
    const [p0, p1] = parsed.s[0]! as [number[], number[]];
    const span = Math.hypot(p1![0]! - p0![0]!, p1![1]! - p0![1]!);
    expect(span).toBeLessThan(SIGNATURE_MIN_STROKE_SPAN);

    // …and it is still a signature, because it was one when it was made.
    expect(readSignatureCapture(capture)).not.toBeNull();
  });

  it("a twitch drawn AFTER the narrowing is still refused", () => {
    // The other direction, and the reason the scale is per STROKE rather than per
    // capture. A capture-wide factor would drop the threshold to 8 x scale for
    // EVERYTHING, including marks made after the resize — so this 5 px twitch, made on
    // the already-narrowed pad, would clear a threshold of 4 and sign the work order.
    // 5 discriminates on purpose: over the capture-wide threshold, under the real one.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 200, height: 90 });
    // The pad was 400 wide and has narrowed to 200 — established without drawing, so
    // the only ink in this test is the twitch itself.
    resizeSignatureCapture(capture, 400, 90);
    resizeSignatureCapture(capture, 200, 90);

    draw(capture, pad, [
      [40, 40],
      [43, 44],
    ]);

    expect(signatureCaptureHasInk(capture)).toBe(true);
    expect(capture.strokeScale).toEqual([1]);
    expect(readSignatureCapture(capture)).toBeNull();
  });

  it("a twitch that predates the narrowing is still refused", () => {
    // Provenance must not launder a bad stroke either: 3 px at width 400 is 3 px as
    // drawn, and no amount of rescaling makes it a mark.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 400, height: 90 });
    draw(capture, pad, [
      [100, 40],
      [102, 42],
    ]);
    expect(readSignatureCapture(capture)).toBeNull();

    resizeSignatureCapture(capture, 200, 90);
    expect(readSignatureCapture(capture)).toBeNull();
  });

  it("the scale accumulates across repeated narrowings", () => {
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 400, height: 90 });
    draw(capture, pad, [
      [100, 40],
      [109, 47.5],
    ]);

    resizeSignatureCapture(capture, 200, 90);
    resizeSignatureCapture(capture, 100, 90);
    // ~11.7 px is now ~2.9 px — a quarter, far under the guard.
    expect(capture.strokeScale[0]).toBeCloseTo(0.25, 10);
    expect(readSignatureCapture(capture)).not.toBeNull();
  });

  it("a stroke open ACROSS a narrowing carries the factor with it", () => {
    // The finger is still down when the box shrinks. The whole stroke — the part drawn
    // before and the part drawn after — is one mark, and it is measured as one.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 400, height: 90 });
    signaturePadDown(capture, pad.at(100, 40));
    signaturePadMove(capture, pad.at(105, 44));
    pad.resize(200, 90);
    signaturePadMove(capture, pad.at(55, 24));
    signaturePadUp(capture);

    expect(capture.strokeScale).toHaveLength(1);
    expect(capture.strokeScale[0]).toBeCloseTo(0.5, 10);
    expect(capture.activeScale).toBe(1);
    expect(readSignatureCapture(capture)).not.toBeNull();
  });

  it("strokeScale stays aligned with strokes through up / clear / cancel", () => {
    // The one invariant the parallel array can break. Every writer is exercised here.
    const capture = createSignatureCapture();
    const pad = fakePad({ left: 0, top: 0, width: 400, height: 90 });

    draw(capture, pad, [
      [10, 70],
      [60, 30],
    ]);
    draw(capture, pad, [
      [80, 70],
      [130, 30],
    ]);
    expect(capture.strokeScale).toHaveLength(capture.strokes.length);

    // A pen-down that produced nothing is not a stroke — and must not push a scale.
    signaturePadDown(capture, pad.at(200, 40));
    signaturePadCancel(capture);
    expect(capture.strokeScale).toHaveLength(capture.strokes.length);
    expect(capture.activeScale).toBe(1);

    clearSignatureCapture(capture);
    expect(capture.strokes).toEqual([]);
    expect(capture.strokeScale).toEqual([]);
    expect(capture.activeScale).toBe(1);
  });

  it("a bad scale is treated as 1 rather than believed", () => {
    // strokeScale is a MEASUREMENT the caller supplies. A NaN, a negative or a zero
    // must not loosen the consent guard — encodeSignatureInk falls back to 1.
    const twitch = ink([
      [pt(100, 40), pt(103, 43)],
    ]);
    for (const bad of [Number.NaN, -2, 0, Number.POSITIVE_INFINITY]) {
      expect(encodeSignatureInk({ ...twitch, strokeScale: [bad] })).toBeNull();
    }
    // …and a real mark is unaffected by the same bad value.
    expect(encodeSignatureInk({ ...SIGNED, strokeScale: [Number.NaN, Number.NaN] })).not.toBeNull();
  });
});
