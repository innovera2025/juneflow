/*
 * ProjectTimeline SCREEN-SEAM tests (gate G3) — the em-dash discipline as the
 * screen renders it.
 *
 * WHY THIS FILE EXISTS: gate 4.5 found the first version of this screen shipped
 * with no test at all, so its headline claim — that every value the prototype
 * hardcodes without a source renders em-dash — lived only in comments. Swapping a
 * DASH for the mock's own 62 / 6 / 3 / 1 / 4 would have killed nothing.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders
 * DOM-free with renderToStaticMarkup and its context/router/chart dependencies are
 * vi.mock'd — the subcon-accept.test.tsx style. Translators echo the key, so this
 * file stays ASCII-only and the assertions read structure and interpolated VALUES.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import phraseNames from "./timeline-strings.json" with { type: "json" };

/** Em-dash — the screen's honest-unknown marker. */
const DASH = "—";

/** The dict keys this screen renders that carry placeholders (see the t mock). */
const PLACEHOLDERS: Record<string, string> = {
  "timeline.lateBadge": "|{days}",
  "timeline.delayValue": "|{days}",
  "timeline.dateRange": "|{from}~{to}",
};

const h = vi.hoisted(() => ({
  wire: null as Record<string, unknown> | null,
  evm: null as Record<string, unknown> | null,
  modal: null as Record<string, unknown> | null,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    /**
     * The dict mock echoes the key WITH the placeholders that key's real phrase
     * carries. A bare echo makes every `.replace()` in the screen a no-op on the
     * echoed string, so deleting an interpolation — or interpolating the WRONG
     * variable — stays green while users read a literal `{days}` on screen. Same
     * hazard as the descriptor's translator two hundred lines below; this is the
     * dict half of it.
     */
    t: (k: string) => k + (PLACEHOLDERS[k] ?? ""),
    tn: (k: string) => k,
    /**
     * tp() is handed the Thai phrase itself as the key, so echoing it would put
     * Thai in this file's expectations. The first version returned ONE constant
     * for every phrase — which made every `toContain("PHRASE")` assertion
     * unfalsifiable by construction, and hid a revert of the on-schedule cell.
     *
     * This maps each phrase back to its NAME in timeline-strings.json, so the
     * token is ASCII, distinct per phrase, and an assertion names the field it
     * is actually about.
     */
    tp: (value: string) =>
      "PHRASE:" + (Object.entries(phraseNames).find(([, v]) => v === value)?.[0] ?? "UNKNOWN"),
  }),
}));

vi.mock("../../shell/page", () => ({
  Page: ({ title, subtitle, actions, children }: {
    title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode;
  }) => (
    <div>
      {title}
      {subtitle}
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({
    params: {},
    tweaks: {},
    notify: () => {},
    navigate: () => {},
    openModal: (m: Record<string, unknown>) => {
      h.modal = m;
    },
  }),
}));

vi.mock("../../shell/use-shell-data", () => ({
  useProjects: () => ({ data: [{ id: "p-1", name: "Ratchaphruek" }] }),
  resolveActiveProject: () => ({ id: "p-1", name: "Ratchaphruek" }),
}));

vi.mock("./use-timeline", () => ({
  useProjectTimeline: () => ({ data: h.wire, isLoading: false, refetch: () => {} }),
}));

vi.mock("../boq/use-boq-reports", () => ({
  useBoqEvm: () => ({ data: h.evm, isLoading: false, refetch: () => {} }),
}));

// ChartCanvas needs a real canvas; the S-curve's own maths is covered in
// timeline-rows.test.ts, so the element is reduced to a marker here.
vi.mock("../../ui/chart", () => ({
  ChartCanvas: () => <div data-chart="1" />,
  baseChartOpts: (t: unknown) => ({ t }),
}));

import { ProjectTimeline, TaskDetail, taskModalDescriptor } from "./timeline";

const task = (over: Record<string, unknown> = {}) => ({
  id: "tl-0",
  group_label: "02 GROUP",
  label: "TASK-A",
  plan_start: "2026-01-09",
  plan_end: "2026-02-08",
  actual_start: "2026-01-09",
  actual_end: "2026-02-10",
  status: "done",
  pct: 100,
  late: true,
  late_days: 2,
  ...over,
});

const SCHEDULED = {
  project_id: "p-1",
  start_date: "2026-01-01",
  end_date: "2026-08-29",
  as_of_date: "2026-05-26",
  tasks: [task()],
  milestones: [{ id: "ms-0", label: "MS-A", day: 40, milestone_date: "2026-02-10", status: "done" }],
};

const render = () => renderToStaticMarkup(<ProjectTimeline />);

beforeEach(() => {
  h.wire = SCHEDULED;
  h.evm = { series: [] };
  h.modal = null;
});

describe("ProjectTimeline — the values with no source stay em-dash", () => {
  it("renders NONE of the prototype's hardcoded KPI numbers", () => {
    // 62 / 6 / 3 / 1 / 4 with captions like "+5 ppt MoM" are literals in the mock
    // with nothing behind them (B-425). Restoring any of them must fail here.
    const html = render();
    // Fragments that cannot occur in CSS — "12 " would match `gap:12px` and pass
    // for the wrong reason, which is the same class of mistake this file exists
    // to catch.
    for (const invented of ["ppt", "MoM", "65%", "\u0e22\u0e39\u0e19\u0e34\u0e15", "\u0e2b\u0e21\u0e27\u0e14 \u00b7"]) {
      expect(html, `invented KPI caption reappeared: ${invented}`).not.toContain(invented);
    }
  });

  it("prints the day counter but NOT a fixed calendar date in the footer", () => {
    // The prototype's footer embeds one specific Buddhist-era date plus a
    // judgement that nothing computes. The counter behind it is real.
    const html = render();
    expect(html).toContain("145 / 240");
    expect(html).not.toContain("2569");
  });

  it("shows the em-dash for the phase chip, which has no column on the wire", () => {
    // `toContain(DASH)` alone cannot fail here — every Kpi card emits one in its
    // sub slot, so five are in the document before the chip is considered. The
    // chip is pinned by its own markup instead: the project chip beside it holds
    // a real name, so a fabricated phase value would break this.
    const html = render();
    const chips = [...html.matchAll(/font-weight:600;color:var\(--text\)">([^<]*)</g)].map((m) => m[1]);
    expect(chips).toEqual(["Ratchaphruek", DASH]);
  });

  it("DERIVES the KPI counts from the rows — a hardcoded value fails here", () => {
    // The first version of this file only checked that the mock's captions were
    // absent, which a hardcoded VALUE passes. Two fixtures with different counts
    // pin the derivation itself.
    const ongoing = (n: number) =>
      Array.from({ length: n }, (_, i) => task({ id: `o${i}`, status: "ongoing", late: false, late_days: null }));

    h.wire = { ...SCHEDULED, tasks: ongoing(2) };
    const two = render();
    h.wire = { ...SCHEDULED, tasks: ongoing(5) };
    const five = render();

    const kpiValue = (html: string) =>
      [...html.matchAll(/letter-spacing:-0\.02em[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(kpiValue(two)).not.toEqual(kpiValue(five));
    expect(kpiValue(two)).toContain("2");
    expect(kpiValue(five)).toContain("5");
  });

  it("DERIVES the footer day counter — it moves with as_of_date", () => {
    const at = (asOf: string) => {
      h.wire = { ...SCHEDULED, as_of_date: asOf };
      return render();
    };
    expect(at("2026-05-26")).toContain("145 / 240");
    expect(at("2026-06-05")).toContain("155 / 240");
    expect(at("2026-06-05")).not.toContain("145 / 240");
  });
});

describe("ProjectTimeline — the axis comes from the wire, never from a clock", () => {
  it("places the today-line from as_of_date", () => {
    // 145 of 240 days => 60.42%. A browser-clock version would move every run.
    // 145 of 240 days => 60.4166…%. Asserted as a prefix so the test pins the
    // POSITION rather than a float's last digit.
    expect(render()).toContain("left:60.4166");
  });

  it("renders an EMPTY chart for a project with no start date", () => {
    // Not a bar on today: an unscheduled project has no day zero at all.
    h.wire = { ...SCHEDULED, start_date: null };
    const html = render();
    expect(html).not.toContain("TASK-A");
    // The footer counter is the part that must go blank: `toContain(DASH)` alone
    // cannot fail, because every Kpi card emits one unconditionally.
    expect(html).not.toContain("145 / 240");
    expect(html).not.toContain("02 GROUP");
  });

  it("renders the rows once the project IS scheduled", () => {
    // The negative control for the test above — without this, "no rows" would
    // pass for the wrong reason.
    expect(render()).toContain("TASK-A");
  });
});

describe("ProjectTimeline — stated lateness, never a derived one", () => {
  it("shows the late badge only when the server stated a day count", () => {
    expect(render()).toContain("timeline.lateBadge|2");
  });

  it("shows NO badge for an overrunning task the server left unmarked", () => {
    // plan_end 2026-02-08 against actual_end 2026-02-20 is twelve days over, and
    // the source deliberately does not mark it (B-424). Deriving would warn here.
    h.wire = {
      ...SCHEDULED,
      tasks: [task({ actual_end: "2026-02-20", late: false, late_days: null })],
    };
    expect(render()).not.toContain("timeline.lateBadge");
  });
});

describe("ProjectTimeline — the S-curve card", () => {
  it("renders the chart when the EVM series has a usable denominator", () => {
    h.evm = { series: [{ periodLabel: "2026-01", pv: 50, ev: 40, ac: 44 }, { periodLabel: "2026-02", pv: 100, ev: 80, ac: 88 }] };
    expect(render()).toContain('data-chart="1"');
  });

  it("renders em-dash instead of a chart when there is no series", () => {
    h.evm = { series: [] };
    expect(render()).not.toContain('data-chart="1"');
  });
});

describe("ProjectTimeline — the band colours are the prototype's own", () => {
  it("uses the group-bound hex, not a token cycled by position", () => {
    // gate 4.5 rejected an index cycle: it re-colours every band the moment one is
    // added or reordered, so the colour stops meaning "this trade".
    h.wire = {
      ...SCHEDULED,
      tasks: [task({ id: "a", group_label: "02 \u0e07\u0e32\u0e19\u0e42\u0e04\u0e23\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07" })],
    };
    expect(render()).toContain("#0B2A4A");
  });
});

describe("ProjectTimeline — the restored task-detail panel", () => {
  /**
   * WHY THIS IS TESTED THROUGH THE COMPONENT AND NOT THE SCREEN: the panel is
   * built inside the bar's onClick, and renderToStaticMarkup dispatches no
   * events, so the modal descriptor is never produced in this harness. The
   * component the screen mounts is exported for exactly this reason.
   *
   * It exists because the previous round restored five dropped fields with no
   * test at all — reverting any of them stayed green, which is the failure this
   * whole branch is about.
   */
  const detail = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <TaskDetail
        task={{
          id: "t",
          group: "02 GROUP",
          label: "TASK-A",
          plan: [8, 38],
          actual: [8, 40],
          status: "done",
          pct: 100,
          lateDays: 2,
          ...over,
        }}
        group="02 GROUP"
        onClose={() => {}}
        onNavigate={() => {}}
      />,
    );

  it("renders all six fields, not the reduced set", () => {
    const html = detail();
    // group + status + plan + actual + progress + delay
    expect(html).toContain("02 GROUP");
    expect(html).toContain("timeline.statusDone");
    // The two window cells are pinned SEPARATELY: both render timeline.dateRange,
    // so one assertion on that key alone stays true when either cell is deleted —
    // inside the test whose title claims all six fields.
    expect(html).toContain("PHRASE:legendPlan");
    expect(html).toContain("PHRASE:legendActual");
    expect(html).toContain("100%");
    expect(html).toContain("timeline.fieldDelay");
    expect(html).toContain("timeline.delayValue|2");
  });

  it("keeps BOTH footer buttons, whose routes exist", () => {
    const html = detail();
    expect(html).toContain("timeline.btnSubconProgress");
    expect(html).toContain("timeline.btnBoq");
  });

  it("says NOT STARTED in the ACTUAL cell for a null actual, rather than em-dash", () => {
    // `actual == null` is measured data. An em-dash would claim ignorance about
    // something the server answered — the same point as the on-schedule cell.
    //
    // The status is deliberately NOT "future" here: that status renders the same
    // key in the status cell, so asserting the key anywhere in the document would
    // pass with the actual cell reverted to an em-dash. Measured — that is exactly
    // what the first version of this test did.
    const html = detail({ actual: null, status: "ongoing", pct: 40, lateDays: null });
    expect(html).toContain("timeline.statusNotStarted");
    // ...and it is the actual cell, not a stray: the plan cell still renders a range.
    expect(html).toContain("timeline.dateRange|8~38");
  });

  it("says ON SCHEDULE, not em-dash, when the server recorded no lateness", () => {
    // `late = false` is measured data; an em-dash would claim ignorance about it.
    // The fixture populates every field, so NO em-dash should render at all —
    // which is what makes reverting this cell to DASH fail here. The previous
    // version asserted toContain("PHRASE") against a mock that returned that same
    // token for all six other phrases in the panel, and could not fail.
    const html = detail({ lateDays: null });
    expect(html).not.toContain("timeline.delayValue");
    expect(html).toContain("PHRASE:onSchedule");
    expect(html).not.toContain(DASH);
  });
});

describe("taskModalDescriptor — the parts of the panel that never reach the markup", () => {
  /**
   * ctx.openModal is mocked away, so the descriptor is invisible to a render
   * assertion: gate 4.5 measured that reverting the icon tone or dropping the
   * subtitle killed nothing. It is a pure value, so it is asserted as one.
   */
  const task = {
    id: "t",
    group: "02 \u0e07\u0e32\u0e19\u0e42\u0e04\u0e23\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07",
    label: "TASK-A",
    plan: [8, 38] as const,
    actual: [8, 40] as const,
    status: "done",
    pct: 100,
    lateDays: 2,
  };
  /**
   * The fake translator returns the key WITH the placeholder the real phrase
   * carries. Echoing the bare key would make the interpolation assertion below
   * vacuous — `.replace("{group}", ...)` on a string with no placeholder is a
   * no-op, so the subtitle would equal the key whether or not the code
   * interpolates at all.
   */
  const echo = (k: string) => k + "|{group}";

  it("titles the panel with the task, and subtitles it with the group", () => {
    const d = taskModalDescriptor(task, task.group, echo);
    expect(d.title).toBe("TASK-A");
    expect(d.subtitle).toBe("timeline.taskModalSubtitle|" + task.group);
  });

  it("tints the icon with the BAND's colour, not a generic token", () => {
    // timeline.jsx:435 sets iconTone from the group's own colour.
    expect(taskModalDescriptor(task, task.group, echo).iconTone).toBe("#0B2A4A");
    expect(taskModalDescriptor(task, "UNKNOWN BAND", echo).iconTone).toBe("#94A3B8");
  });

  it("falls back to an em-dash for a task with no label and no group", () => {
    const d = taskModalDescriptor({ ...task, label: "" }, "", echo);
    expect(d.title).toBe(DASH);
    expect(d.subtitle).toBe("timeline.taskModalSubtitle|" + DASH);
  });
});
