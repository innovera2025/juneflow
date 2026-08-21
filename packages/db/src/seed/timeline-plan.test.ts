// G3 unit tests — the seeded timeline plan (B-424).
//
// WHAT THESE PROTECT. The 13 timeline tasks carry a status and a percent that come
// from the prototype (timeline.jsx TL_TASKS) and, as of B-424, a plan window that
// does NOT: the prototype draws its bars from a hardcoded layout, so the windows
// were chosen here. The one thing that makes them defensible rather than invented
// is that they AGREE with the percent the prototype states — an "ongoing 92%" task
// must be 92% elapsed on the day the chart is drawn.
//
// Nothing else checks that. The columns are plain dates, the seed has no assertions,
// and a future edit that moves one window leaves a bar whose length silently
// contradicts the number printed next to it. So the arithmetic is pinned here.
//
// Source-read rather than import, the stamp.test.ts precedent: seed/index.ts is a
// script, and importing it to reach a private const would run it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** The today-line sits at day 145 of the plan (timeline.jsx TODAY_DAY). */
const TODAY = 145;
/** The plan closes on day 240 (timeline.jsx MILESTONES, the project close). */
const LAST = 240;

interface Task {
  label: string;
  status: string;
  pct: number;
  from: number;
  to: number;
}

/** Every TL_TASKS row, parsed out of the seed source. */
function tasks(): Task[] {
  const block = SOURCE.slice(SOURCE.indexOf("const TL_TASKS"), SOURCE.indexOf("// timeline.jsx:264 MILESTONES"));
  const rows = [
    ...block.matchAll(
      /label: "([^"]+)", status: "(\w+)", pct: (\d+), from: (\d+), to: (\d+)/g,
    ),
  ];
  return rows.map((m) => ({
    label: m[1]!,
    status: m[2]!,
    pct: Number(m[3]),
    from: Number(m[4]),
    to: Number(m[5]),
  }));
}

/** Every MILESTONES row's day offset, parsed out of the seed source. */
function milestoneDays(): number[] {
  const block = SOURCE.slice(SOURCE.indexOf("const MILESTONES"), SOURCE.indexOf("// sales-crm.jsx:191"));
  return [...block.matchAll(/day: (\d+)/g)].map((m) => Number(m[1]));
}

describe("the seeded timeline plan", () => {
  it("parses all 13 tasks, each with a window", () => {
    // A parse that silently found nothing would make every assertion below vacuous.
    expect(tasks()).toHaveLength(13);
  });

  it("keeps every window inside the plan (day 0 .. 240) and forward in time", () => {
    for (const t of tasks()) {
      expect(t.from, t.label).toBeGreaterThanOrEqual(0);
      expect(t.to, t.label).toBeLessThanOrEqual(LAST);
      expect(t.to, t.label).toBeGreaterThan(t.from);
    }
  });

  it("makes every ONGOING task's elapsed fraction match the percent the prototype states", () => {
    // This is the assertion the whole file exists for. The prototype says 92 / 38 /
    // 78 / 45; a bar whose length disagrees with the number beside it is the chart
    // lying about the same task twice.
    const ongoing = tasks().filter((t) => t.status === "ongoing");
    expect(ongoing).toHaveLength(4);
    for (const t of ongoing) {
      const elapsed = ((TODAY - t.from) / (t.to - t.from)) * 100;
      expect(Math.abs(elapsed - t.pct), `${t.label}: window implies ${elapsed.toFixed(1)}% but pct says ${t.pct}`)
        .toBeLessThan(1);
    }
  });

  it("straddles today with the ongoing work, and only the ongoing work", () => {
    for (const t of tasks()) {
      const straddles = t.from < TODAY && t.to > TODAY;
      expect(straddles, `${t.label} (${t.status})`).toBe(t.status === "ongoing");
    }
  });

  it("finishes every DONE task before today", () => {
    for (const t of tasks().filter((t) => t.status === "done")) {
      expect(t.to, t.label).toBeLessThanOrEqual(TODAY);
      expect(t.pct, t.label).toBe(100);
    }
  });

  it("starts SOON work just after today and FUTURE work later still", () => {
    for (const t of tasks().filter((t) => t.status === "soon")) {
      expect(t.from, t.label).toBeGreaterThan(TODAY);
      expect(t.from - TODAY, t.label).toBeLessThanOrEqual(30);
    }
    for (const t of tasks().filter((t) => t.status === "future")) {
      expect(t.from - TODAY, t.label).toBeGreaterThan(30);
    }
    for (const t of tasks().filter((t) => t.status === "soon" || t.status === "future")) {
      expect(t.pct, t.label).toBe(0);
    }
  });

  it("lands the structural tasks on the milestones they belong to", () => {
    // The milestone days are the prototype's own (0/40/95/195/240) and are seeded
    // untouched; a task window that ignores them puts the flag and the bar that is
    // supposed to satisfy it in different places.
    const days = milestoneDays();
    expect(days).toEqual([0, 40, 95, 195, 240]);

    const byLabel = new Map(tasks().map((t) => [t.label, t]));
    // "ครบฐานราก" (day 40) is the end of the foundation task.
    expect(byLabel.get("งานฐานราก B-1 ถึง B-24")!.to).toBe(40);
    // "ส่งมอบลอตแรก" (day 195) is when the first handover inspection opens.
    expect(byLabel.get("ตรวจรับ + เก็บงาน (B-1..B-12)")!.from).toBe(195);
    // "ปิดโครงการ" (day 240) is the last day of the last task.
    expect(byLabel.get("ส่งมอบลูกค้า + เริ่ม Warranty")!.to).toBe(240);
  });

  it("anchors day zero 145 days before the seed's today", () => {
    // Offsets, never literal dates (B-224/B-323): a literal would drift against the
    // seed clock and take the G5 baseline with it.
    expect(SOURCE).toContain("const TL_DAY_ZERO = -145;");
    expect(SOURCE).toContain("const TL_DAY_LAST = 240;");
    expect(SOURCE).toContain("isoDaysFromToday(TL_DAY_ZERO + t.from)");
    expect(SOURCE).toContain("isoDaysFromToday(TL_DAY_ZERO + ms.day)");
  });
});
