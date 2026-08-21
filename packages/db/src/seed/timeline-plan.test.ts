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
// window in the prototype, read out of both files at run time. That is the
// property PLAN.md §0 rule 1 actually asks for, and it dies the moment either
// side drifts from the other.
//
// Source-read rather than import, the stamp.test.ts precedent: seed/index.ts is
// a script, and importing it to reach a private const would run it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SEED = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const PROTO = readFileSync(
  new URL("../../../../pototype/timeline.jsx", import.meta.url),
  "utf8",
);

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

describe("the seeded timeline plan matches the prototype", () => {
  it("parses 13 tasks out of BOTH files", () => {
    // A regex that silently matched nothing would make every comparison below
    // vacuously true, which is exactly how the first version of this file passed
    // while measuring the wrong thing.
    expect(protoTasks(), "prototype").toHaveLength(13);
    expect(seedTasks(), "seed").toHaveLength(13);
  });

  it("carries the SAME task labels in the SAME order", () => {
    expect(seedTasks().map((t) => t.label)).toEqual(protoTasks().map((t) => t.label));
  });

  it("copies every plan window verbatim", () => {
    const proto = protoTasks();
    seedTasks().forEach((t, i) => {
      expect(t.plan, `${t.label} plan`).toEqual(proto[i]!.plan);
    });
  });

  it("copies every actual window verbatim, null and open-ended included", () => {
    // null = not started; [start, null] = started and unfinished, which the Gantt
    // draws up to the today-line. Collapsing either into a date would draw a bar
    // for work nobody has begun.
    const proto = protoTasks();
    seedTasks().forEach((t, i) => {
      expect(t.actual, `${t.label} actual`).toEqual(proto[i]!.actual);
    });
  });

  it("copies status, percent and the stated lateness verbatim", () => {
    const proto = protoTasks();
    seedTasks().forEach((t, i) => {
      expect({ status: t.status, pct: t.pct, late: t.late }, t.label).toEqual({
        status: proto[i]!.status,
        pct: proto[i]!.pct,
        late: proto[i]!.late,
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
    expect(PROTO).toContain("const TODAY_DAY = 145;");
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
    const protoDays = days(PROTO.slice(PROTO.indexOf("const MILESTONES"), PROTO.indexOf("const TODAY_DAY")));
    expect(protoDays).toEqual([0, 40, 95, 195, 240]);
    expect(seedDays).toEqual(protoDays);
    // The last milestone closes the plan, and today sits inside it.
    expect(Math.max(...protoDays)).toBe(240);
    expect(TODAY).toBeLessThan(240);
  });
});
