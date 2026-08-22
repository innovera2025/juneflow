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

/** Em-dash — the screen's honest-unknown marker. */
const DASH = "—";

const h = vi.hoisted(() => ({
  wire: null as Record<string, unknown> | null,
  evm: null as Record<string, unknown> | null,
  modal: null as Record<string, unknown> | null,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tn: (k: string) => k,
    // tp() is given the Thai phrase itself as the key; echoing it would put Thai
    // in this file's expectations, so it is reduced to a stable ASCII token.
    tp: () => "PHRASE",
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

import { ProjectTimeline, TaskDetail } from "./timeline";

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
    expect(html).toContain(DASH);
  });

  it("renders the rows once the project IS scheduled", () => {
    // The negative control for the test above — without this, "no rows" would
    // pass for the wrong reason.
    expect(render()).toContain("TASK-A");
  });
});

describe("ProjectTimeline — stated lateness, never a derived one", () => {
  it("shows the late badge only when the server stated a day count", () => {
    expect(render()).toContain("timeline.lateBadge");
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
    expect(html).toContain("timeline.dateRange");
    expect(html).toContain("100%");
    expect(html).toContain("timeline.fieldDelay");
    expect(html).toContain("timeline.delayValue");
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
    expect(html).toContain("timeline.dateRange");
  });

  it("says ON SCHEDULE, not em-dash, when the server recorded no lateness", () => {
    const html = detail({ lateDays: null });
    expect(html).not.toContain("timeline.delayValue");
    expect(html).toContain("PHRASE");
  });
});
