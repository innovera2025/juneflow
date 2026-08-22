// G3 unit tests — the seeded timeline plan against its source (B-424).
//
// WHAT THIS PROTECTS, and why the first version of it was the wrong test.
//
// The 13 timeline tasks now carry plan and actual day windows. An earlier pass
// INVENTED those windows and tested them for self-consistency — that each
// "ongoing 92%" task was 92% elapsed on the day the chart is drawn. The test
// passed, the arithmetic was right, and the whole exercise was wrong: the
// prototype states its own plan/actual pairs at timeline.jsx:238-262, so there
// was nothing to derive. A test can be internally perfect and still measure the
// wrong thing.
//
// So this file asserts FIDELITY instead: every window in the seed equals the
// window the prototype states.
//
// WHY THE PROTOTYPE IS TRANSCRIBED HERE INSTEAD OF READ FROM DISK (B-430).
//
// The previous revision read pototype/timeline.jsx at run time. That directory
// is gitignored (.gitignore:25) — it is not in the repository — so the test
// passed on every machine that has the prototype and died in CI with ENOENT,
// failing Stage 4 and skipping Stages 5, 5b and 6 behind it. Measured, it was
// also the ONLY test in the repo that read the prototype from disk: every other
// test cites a pototype line in a comment and states the expected values inline.
//
// This file now follows that convention AND closes the hole the convention
// leaves. The table below is a transcription, so it can drift from its source;
// the last describe block compares it with the real prototype, row for row, and
// runs wherever the prototype exists. Where it does not exist the block SKIPS,
// visibly, and the seed-vs-table assertions above it still run in full — so CI
// keeps a test that dies the moment the seed changes.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SEED = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const PROTO_PATH = fileURLToPath(new URL("../../../../pototype/timeline.jsx", import.meta.url));
const HAS_PROTO = existsSync(PROTO_PATH);

/** The today-line sits at day 145 of the plan (timeline.jsx:272 TODAY_DAY). */
const TODAY = 145;

interface Task {
  label: string;
  status: string;
  pct: number;
  plan: [number, number];
  actual: [number, number | null] | null;
  late: number | null;
}

/**
 * pototype/timeline.jsx:238-262 — TIMELINE_TASKS, flattened in group order.
 * Transcribed verbatim; proven against the file itself in the last describe.
 */
const PROTO_TASKS: Task[] = [
  { label: "เคลียร์พื้นที่ + ปักหมุด", status: "done", pct: 100, plan: [0, 5], actual: [0, 5], late: null },
  { label: "ระบบไฟฟ้า/น้ำชั่วคราว", status: "done", pct: 100, plan: [3, 12], actual: [3, 14], late: 2 },
  { label: "งานฐานราก B-1 ถึง B-24", status: "done", pct: 100, plan: [8, 38], actual: [8, 40], late: 2 },
  { label: "งานเสา-คาน ชั้น 1 B-1..B-12", status: "done", pct: 100, plan: [32, 68], actual: [32, 70], late: 2 },
  { label: "งานเสา-คาน ชั้น 2 B-1..B-12", status: "ongoing", pct: 92, plan: [60, 92], actual: [62, 95], late: null },
  { label: "งานเสา-คาน B-13..B-24", status: "ongoing", pct: 38, plan: [85, 130], actual: [88, null], late: 3 },
  { label: "งานก่ออิฐ-ฉาบ Block B (รวม)", status: "soon", pct: 0, plan: [105, 165], actual: null, late: null },
  { label: "งานกระเบื้องพื้น Block B", status: "future", pct: 0, plan: [140, 175], actual: null, late: null },
  { label: "งานสีภายใน + ภายนอก", status: "future", pct: 0, plan: [165, 195], actual: null, late: null },
  { label: "ระบบไฟฟ้าหลัก Block B", status: "ongoing", pct: 78, plan: [110, 165], actual: [115, null], late: null },
  { label: "ระบบประปา-สุขาภิบาล Block B", status: "ongoing", pct: 45, plan: [115, 168], actual: [118, null], late: null },
  { label: "ตรวจรับ + เก็บงาน (B-1..B-12)", status: "future", pct: 0, plan: [180, 200], actual: null, late: null },
  { label: "ส่งมอบลูกค้า + เริ่ม Warranty", status: "future", pct: 0, plan: [195, 210], actual: null, late: null },
];

/** pototype/timeline.jsx:264-270 — MILESTONES, day values in order. */
const PROTO_MILESTONE_DAYS = [0, 40, 95, 195, 240];

const pair = (raw: string): [number, number | null] => {
  const [a, b] = raw.split(",").map((x) => x.trim());
  return [Number(a), b === "null" ? null : Number(b)];
};

/** Every TL_TASKS row, parsed out of the seed source. */
function seedTasks(): Task[] {
  const block = SEED.slice(SEED.indexOf("const TL_TASKS"), SEED.indexOf("// timeline.jsx:264 MILESTONES"));
  return [
    ...block.matchAll(
      /label: "([^"]+)", status: "(\w+)", pct: (\d+), plan: \[([^\]]+)\], actual: (null|\[[^\]]+\])(?:, late: (\d+))?/g,
    ),
  ].map((m) => ({
    label: m[1]!,
    status: m[2]!,
    pct: Number(m[3]),
    plan: pair(m[4]!) as [number, number],
    actual: m[5] === "null" ? null : pair(m[5]!.slice(1, -1)),
    late: m[6] ? Number(m[6]) : null,
  }));
}

describe("the seeded timeline plan matches the prototype", () => {
  it("parses 13 tasks out of the seed", () => {
    // A regex that silently matched nothing would make every comparison below
    // vacuously true, which is exactly how the first version of this file passed
    // while measuring the wrong thing.
    expect(PROTO_TASKS, "prototype").toHaveLength(13);
    expect(seedTasks(), "seed").toHaveLength(13);
  });

  it("carries the SAME task labels in the SAME order", () => {
    expect(seedTasks().map((t) => t.label)).toEqual(PROTO_TASKS.map((t) => t.label));
  });

  it("copies every plan window verbatim", () => {
    seedTasks().forEach((t, i) => {
      expect(t.plan, `${t.label} plan`).toEqual(PROTO_TASKS[i]!.plan);
    });
  });

  it("copies every actual window verbatim, null and open-ended included", () => {
    // null = not started; [start, null] = started and unfinished, which the Gantt
    // draws up to the today-line. Collapsing either into a date would draw a bar
    // for work nobody has begun.
    seedTasks().forEach((t, i) => {
      expect(t.actual, `${t.label} actual`).toEqual(PROTO_TASKS[i]!.actual);
    });
  });

  it("copies status, percent and the stated lateness verbatim", () => {
    seedTasks().forEach((t, i) => {
      expect({ status: t.status, pct: t.pct, late: t.late }, t.label).toEqual({
        status: PROTO_TASKS[i]!.status,
        pct: PROTO_TASKS[i]!.pct,
        late: PROTO_TASKS[i]!.late,
      });
    });
  });

  it("stores lateness as the STATED count, not the derived overrun", () => {
    // Three of the four late tasks equal actual_end - plan_end. The fourth,
    // "งานเสา-คาน ชั้น 2", runs plan [60,92] against actual [62,95] and carries no
    // `late` at all — so a derived value would print "ช้า 3 วัน" on a row the
    // prototype leaves clean. This test exists to keep someone from "simplifying"
    // late_days into that subtraction.
    const byLabel = new Map(seedTasks().map((t) => [t.label, t]));
    const contradiction = byLabel.get("งานเสา-คาน ชั้น 2 B-1..B-12")!;
    expect(contradiction.actual![1]! - contradiction.plan[1]).toBe(3);
    expect(contradiction.late).toBeNull();

    const stated = byLabel.get("งานเสา-คาน B-13..B-24")!;
    expect(stated.late).toBe(3);
    // ...and that one is open-ended, so the subtraction could not have produced it.
    expect(stated.actual![1]).toBeNull();
  });

  it("writes the dates as offsets from day zero, never as literals", () => {
    // B-224/B-323: a literal date drifts against the seed clock and takes the G5
    // baseline with it. The prototype's own captions ("01 ม.ค. 69") are exactly
    // what must not be copied in.
    expect(SEED).toContain("const TL_DAY_ZERO = -145;");
    expect(SEED).toContain("isoDaysFromToday(TL_DAY_ZERO + t.plan[0])");
    expect(SEED).toContain("isoDaysFromToday(TL_DAY_ZERO + ms.day)");
  });

  it("keeps every window inside the plan and forward in time", () => {
    for (const t of seedTasks()) {
      expect(t.plan[0], t.label).toBeGreaterThanOrEqual(0);
      expect(t.plan[1], t.label).toBeLessThanOrEqual(240);
      expect(t.plan[1], t.label).toBeGreaterThan(t.plan[0]);
      if (t.actual && t.actual[1] != null) {
        expect(t.actual[1], `${t.label} actual`).toBeGreaterThan(t.actual[0]);
      }
    }
  });

  it("leaves `actual` unset on exactly the work that has not started", () => {
    for (const t of seedTasks()) {
      const started = t.actual !== null;
      expect(started, `${t.label} (${t.status})`).toBe(t.status === "done" || t.status === "ongoing");
    }
  });

  it("keeps the milestone days the prototype's own", () => {
    const days = (block: string) => [...block.matchAll(/day: (\d+)/g)].map((m) => Number(m[1]));
    const seedDays = days(SEED.slice(SEED.indexOf("const MILESTONES"), SEED.indexOf("// sales-crm.jsx:191")));
    expect(seedDays).toEqual(PROTO_MILESTONE_DAYS);
    // The last milestone closes the plan, and today sits inside it.
    expect(Math.max(...PROTO_MILESTONE_DAYS)).toBe(240);
    expect(TODAY).toBeLessThan(240);
  });
});

// The tie-back. Runs wherever pototype/ exists (every developer machine, the
// loop, Wei's box) and skips in CI, where the directory is not checked out.
// Without it the table above would be an unverifiable copy — with it, a table
// that drifts from the prototype fails here before it can be believed upstream.
describe.skipIf(!HAS_PROTO)("the transcribed table IS the prototype's own", () => {
  const PROTO = HAS_PROTO ? readFileSync(PROTO_PATH, "utf8") : "";

  /** Every TIMELINE_TASKS row, parsed out of the prototype (the authority). */
  function protoTasks(): Task[] {
    const block = PROTO.slice(PROTO.indexOf("const TIMELINE_TASKS"), PROTO.indexOf("const MILESTONES"));
    return [
      ...block.matchAll(
        /l: "([^"]+)",\s+plan: \[([^\]]+)\],\s+actual: (null|\[[^\]]+\]),\s+status: "(\w+)",\s+pct: (\d+)(?:,\s+late: (\d+))?/g,
      ),
    ].map((m) => ({
      label: m[1]!,
      plan: pair(m[2]!) as [number, number],
      actual: m[3] === "null" ? null : pair(m[3]!.slice(1, -1)),
      status: m[4]!,
      pct: Number(m[5]),
      late: m[6] ? Number(m[6]) : null,
    }));
  }

  it("parses 13 tasks out of pototype/timeline.jsx", () => {
    // Same reason as above: a regex that matched nothing would make the row-for-row
    // comparison vacuous, and this block is the only thing checking the table.
    expect(protoTasks()).toHaveLength(13);
  });

  it("matches the transcribed table row for row", () => {
    expect(protoTasks()).toEqual(PROTO_TASKS);
  });

  it("matches the transcribed milestone days and the today-line", () => {
    const days = [
      ...PROTO.slice(PROTO.indexOf("const MILESTONES"), PROTO.indexOf("const TODAY_DAY")).matchAll(/day: (\d+)/g),
    ].map((m) => Number(m[1]));
    expect(days).toEqual(PROTO_MILESTONE_DAYS);
    expect(PROTO).toContain(`const TODAY_DAY = ${TODAY};`);
  });
});
