/*
 * AfterSalesService — the After-Sales Service / warranty screen (route sales.service),
 * ported from pototype/sales-service.jsx AfterSalesService + TicketDetail +
 * NewTicketForm. Section module sales_re (registry.ts sales.service). The WRITE port
 * (SV-1 · money = NONE): a real service-ticket register with the SV-3 status machine
 * (received -> scheduled -> fixing -> fixed -> closed) driven by 5 wired write ops.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb
 * (sales.common.breadcrumbRoot / sales.service.breadcrumb), the title + subtitle, the
 * two header actions (Warranty report / New ticket), the 5-card MiniKpi strip, the
 * 4-tab TabBar (active / all / high / closed), the 8-column register table, the ticket
 * detail modal (status timeline + info grid + warranty + the machine-respecting action
 * button), and the new-ticket form are the prototype's. MiniKpi / TabBar / StatusBadge /
 * PrioBadge are inlined from ds.jsx (as gl-inbox.tsx / sales-crm.tsx do).
 *
 * Data (rule 3): GET /sales/service (use-sales-service.ts) via the generated client —
 * the prototype's local SERVICE_TICKETS mock becomes the server register. The wire row
 * is (apps/api/src/routes/sales-service.ts ticketWire) { id, no, unit_id, customer_id,
 * channel, category, title, priority, status, assignee_user_id, opened_date,
 * scheduled_date, warranty, warranty_months_remaining, created_at }. Pure narrowing /
 * status-machine / tab-filter / count logic lives in sales-service-rows.ts (G3).
 *
 * 5 WRITE ACTIONS WIRED (rule 8 — were mock notifies in the prototype):
 *   1. New ticket   -> POST /sales/service (title required; server allocates `no`).
 *   2. schedule     -> POST /sales/service/{id}/schedule (received  -> scheduled).
 *   3. start        -> POST /sales/service/{id}/start    (scheduled -> fixing).
 *   4. fix          -> POST /sales/service/{id}/fix       (fixing    -> fixed).
 *   5. close        -> POST /sales/service/{id}/close     (fixed     -> closed).
 * The detail modal offers ONLY the one valid next transition per the ticket's current
 * status (nextTransition, SV-3) — no illegal jump. Every op surfaces a 409 (wrong/stale
 * state) or 404 (not in tenant) HONESTLY via an error toast (never a fabricated flip);
 * on success the register + detail invalidate so the badges re-derive from the server.
 *
 * ID -> NAME resolution (never leak a uuid):
 *   - customer_id       -> GET /customers name map (em-dash when unresolved).
 *   - assignee_user_id  -> GET /users     name map (em-dash when unresolved).
 *   - unit_id           -> ALWAYS em-dash: it is a project_node uuid with NO clean label
 *     source (bookings carry no unit label; the hierarchy needs a per-project fetch).
 * The create form's customer + assignee pickers source their options from those same GET
 * endpoints and send the real ids; the unit picker is OMITTED (no clean label source).
 *
 * HONEST DIVERGENCES (rule 4 — never fabricated):
 *   - warranty months = the SERVER-DERIVED warranty_months_remaining (SV-2); null -> "—".
 *   - rating has NO column (close ignores the client rating) -> the prototype's ★ score
 *     is OMITTED (em-dash treatment), never a fabricated star.
 *   - KPIs: received (kpiNew) + fixing are REAL C10 counts; scheduled-today /
 *     closed-this-month / units-in-warranty carry a date-window or units aggregate the
 *     ticket wire cannot supply -> value em-dashed (sales-crm precedent: 2 real, 3 dash).
 *   - the right-column category-mix / technician-workload / LINE-OA panels are pure mock
 *     analytics with NO wire (category counts, per-tech ratings, follower count) -> those
 *     3 cards are OMITTED honestly (drop-not-collect), never fabricated numbers.
 *   - the mock progress-note textarea + attach-photo (no persist column/endpoint) and the
 *     mock LINE/SMS notify + Warranty-report export (no endpoint) are OMITTED / disabled.
 *   - SV-5 "create technician work order (PM)": POST /pm/workorders requires an asset_id
 *     (a pm_asset, a different domain) that a service ticket cannot supply -> the cross-
 *     link button is honest-DISABLED (no clean endpoint), never a fabricated WO.
 *
 * i18n (rule 2): every visible string is a sales.service.* / sales.common.* / common.* /
 * ar.fldCustomer dict key (t) — consume-only (no key minted here). No Thai literal lives
 * in source (rule 2, B-073); tokens back every colour except the prototype-verbatim LINE
 * green #06C755 (B-037(a) — a brand hex with no @juneflow/tokens equivalent).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import { Avatar } from "../../ui/avatar";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useCustomerList } from "../master/use-master-customer";
import { useUserList } from "../master/use-users";
import {
  useServiceTickets,
  useServiceTicket,
  useCreateServiceTicket,
  useScheduleServiceTicket,
  useStartServiceTicket,
  useFixServiceTicket,
  useCloseServiceTicket,
} from "./use-sales-service";
import {
  SERVICE_STATUSES,
  STATUS_STEP,
  PRIORITIES,
  SERVICE_TABS,
  toTicketRow,
  filterByTab,
  tabCount,
  countByStatus,
  nextTransition,
  toRef,
  nameById,
  isServiceStatus,
  type TicketRow,
  type ServiceStatus,
  type ServiceTab,
  type TransitionOp,
} from "./sales-service-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** Prototype-verbatim LINE brand green (ds channel tag; no @juneflow/tokens equivalent). */
const LINE_GREEN = "#06C755";

/** SV-5 PM work-order cross-link readiness. POST /pm/workorders requires an asset_id (a
 *  pm_asset — a different domain a service ticket cannot supply), so no clean endpoint
 *  exists; the button stays honest-disabled. Flip when a ticket->WO endpoint lands. */
const PM_WORKORDER_CROSSLINK_READY = false;

/** Per-status badge tone (tokens; sales-service.jsx SVC_STATUS colours). */
const STATUS_TONE: Record<ServiceStatus, { fg: string; bg: string }> = {
  received: { fg: "var(--info)", bg: "var(--info-soft)" },
  scheduled: { fg: "var(--warn)", bg: "var(--warn-soft)" },
  fixing: { fg: "var(--accent)", bg: "var(--accent-soft)" },
  fixed: { fg: "var(--ok)", bg: "var(--ok-soft)" },
  closed: { fg: "var(--text-3)", bg: "var(--surface-3)" },
};

/** Per-priority badge tone (tokens; sales-service.jsx PRIO_COLOR). */
const PRIO_TONE: Record<string, { fg: string; bg: string }> = {
  high: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  normal: { fg: "var(--warn)", bg: "var(--warn-soft)" },
  low: { fg: "var(--text-3)", bg: "var(--surface-3)" },
};

/** Table header cell style (ds.jsx th()). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** Native-select style (jv-create-form headInput / gl-inbox selectStyle). */
const selectStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
  color: "var(--text)",
};

/** Text-input style (matches selectStyle geometry). */
const inputStyle: CSSProperties = { ...selectStyle };

/** Extract an error message off an unknown mutation error (gl-inbox errMessage). */
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as gl-inbox / sales-crm). */
function MiniKpi({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** TabBar, inlined from ds.jsx TabBar (functional, as in gl-inbox). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: ServiceTab; label: string; count: number }[];
  active: ServiceTab;
  onChange: (id: ServiceTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              background: "none",
              border: "none",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: on ? "var(--brand)" : "var(--surface-3)",
                color: on ? "#fff" : "var(--text-2)",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small coloured pill badge (ds.jsx status/priority tag). */
function Pill({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function AfterSalesService() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const ticketsQ = useServiceTickets();
  // Customer + assignee resolution reuse the shared master catalogues (one query cache).
  const customersQ = useCustomerList();
  const usersQ = useUserList();

  const [tab, setTab] = useState<ServiceTab>("active");

  const rows = useMemo<TicketRow[]>(() => (ticketsQ.data ?? []).map(toTicketRow), [ticketsQ.data]);
  const visible = useMemo(() => filterByTab(rows, tab), [rows, tab]);
  const customers = useMemo(() => nameById((customersQ.data ?? []).map(toRef)), [customersQ.data]);
  const assignees = useMemo(() => nameById((usersQ.data ?? []).map(toRef)), [usersQ.data]);

  const openTicket = (row: TicketRow) => {
    ctx.openModal({
      title: row.no || DASH,
      subtitle: customerDisplay(row, customers),
      icon: "hardhat",
      iconTone: (PRIO_TONE[row.priority] ?? PRIO_TONE.low).fg,
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <TicketDetail
          initial={row}
          customers={customers}
          assignees={assignees}
          onClose={close}
        />
      ),
    });
  };

  const openNew = () => {
    ctx.openModal({
      title: t("sales.service.newTicketTitle"),
      subtitle: t("sales.service.newTicketSubtitle"),
      icon: "plus",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ close }: { close: () => void }) => <NewTicketForm onClose={close} />,
    });
  };

  const receivedCount = countByStatus(rows, "received");
  const fixingCount = countByStatus(rows, "fixing");

  const TABS: readonly { id: ServiceTab; label: string; count: number }[] = SERVICE_TABS.map((id) => ({
    id,
    label:
      id === "active"
        ? t("sales.service.tabActive")
        : id === "all"
          ? t("common.all")
          : id === "high"
            ? t("sales.service.prioHigh")
            : t("sales.service.statusClosed"),
    count: tabCount(rows, id),
  }));

  return (
    <Page
      breadcrumbs={[t("sales.common.breadcrumbRoot"), t("sales.service.breadcrumb")]}
      title={t("sales.service.title")}
      subtitle={t("sales.service.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Warranty report export: no report endpoint (mock notify) -> disabled. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("sales.service.btnWarrantyReport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openNew}>
            {t("sales.service.btnNewTicket")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5): received (kpiNew) + fixing are REAL counts; the three
          window/units metrics are em-dashed (the ticket wire has no today/month/units
          signal), matching the sales-crm honest-KPI treatment. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={t("sales.service.kpiNew")}
          value={String(receivedCount)}
          sub={t("sales.service.kpiSubUnassigned")}
          tone="var(--info)"
          icon="inbox"
        />
        <MiniKpi label={t("sales.service.statusFixing")} value={String(fixingCount)} tone="var(--accent)" icon="hardhat" />
        <MiniKpi label={t("sales.service.kpiScheduledToday")} value={DASH} tone="var(--warn)" icon="calendar" />
        <MiniKpi label={t("sales.service.kpiClosedMonth")} value={DASH} tone="var(--ok)" icon="check" />
        <MiniKpi label={t("sales.service.kpiInWarranty")} value={DASH} tone="var(--brand)" icon="paperclip" />
      </div>

      <Card pad={0}>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {ticketsQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th(70)}>{t("sales.service.thPrio")}</th>
                <th scope="col" style={th(130)}>{t("sales.service.thSrNo")}</th>
                <th scope="col" style={th()}>{t("sales.service.thProblemUnit")}</th>
                <th scope="col" style={th(110)}>{t("sales.service.thCategory")}</th>
                <th scope="col" style={th(100)}>{t("sales.service.thChannel")}</th>
                <th scope="col" style={th(130)}>{t("sales.service.thSchedule")}</th>
                <th scope="col" style={th(130)}>{t("sales.service.thAssignee")}</th>
                <th scope="col" style={th(120)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const prio = PRIO_TONE[row.priority] ?? PRIO_TONE.low;
                  const stTone = isServiceStatus(row.status) ? STATUS_TONE[row.status] : PRIO_TONE.low;
                  const assigneeName = assignees.get(row.assigneeUserId) ?? "";
                  const highlight = row.priority === "high" && row.status !== "closed";
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openTicket(row)}
                      style={{
                        borderTop: "1px solid var(--border)",
                        cursor: "pointer",
                        background: highlight ? "var(--danger-soft)" : "transparent",
                      }}
                    >
                      <td style={td}>
                        <Pill label={prioLabel(t, row.priority)} fg={prio.fg} bg={prio.bg} />
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                        {row.no || DASH}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{row.title || DASH}</div>
                        {/* unit is a project_node uuid with no clean label -> em-dash;
                            customer resolves to a name (em-dash when unresolved). */}
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {DASH} · {customers.get(row.customerId) || DASH}
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: 11.5 }}>{row.category || DASH}</td>
                      <td style={td}>
                        <ChannelBadge channel={row.channel} />
                      </td>
                      <td style={{ ...td, fontSize: 11.5 }}>
                        <div style={{ color: "var(--text-3)" }}>
                          {t("sales.service.receivedPrefix")} {row.openedDate || DASH}
                        </div>
                        <div style={{ color: row.scheduledDate ? "var(--text)" : "var(--text-3)", fontWeight: 600 }}>
                          {row.scheduledDate
                            ? `${t("sales.service.schedulePrefix")} ${row.scheduledDate}`
                            : t("sales.service.pendingAssign")}
                        </div>
                      </td>
                      <td style={td}>
                        {assigneeName ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Avatar name={assigneeName} size={20} />
                            <span style={{ fontSize: 11.5 }}>{assigneeName}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</span>
                        )}
                      </td>
                      <td style={td}>
                        <Pill label={statusLabel(t, row.status)} fg={stTone.fg} bg={stTone.bg} />
                        {/* rating has NO column (close ignores it) -> ★ omitted (em-dash). */}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

/** Channel tag (ds.jsx: LINE green / App brand / else neutral). */
function ChannelBadge({ channel }: { channel: string }) {
  if (!channel) return <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</span>;
  const isLine = channel === "LINE";
  const isApp = channel === "App";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: isLine
          ? `color-mix(in srgb, ${LINE_GREEN} 14%, var(--surface))`
          : isApp
            ? "var(--brand-soft)"
            : "var(--surface-3)",
        color: isLine ? LINE_GREEN : isApp ? "var(--brand)" : "var(--text-2)",
      }}
    >
      {channel}
    </span>
  );
}

/** The customer display for a ticket subtitle/sub-line (resolved name or em-dash). */
function customerDisplay(row: TicketRow, customers: Map<string, string>): string {
  return customers.get(row.customerId) || DASH;
}

/** The bound dict translator (literal DictKey union — no dynamic key construction). */
type Translate = ReturnType<typeof useI18n>["t"];

/** The i18n label for a status value (consume-only sales.service.status* keys). */
function statusLabel(t: Translate, status: string): string {
  switch (status) {
    case "received":
      return t("sales.service.statusReceived");
    case "scheduled":
      return t("sales.service.statusScheduled");
    case "fixing":
      return t("sales.service.statusFixing");
    case "fixed":
      return t("sales.service.statusFixed");
    case "closed":
      return t("sales.service.statusClosed");
    default:
      return status || DASH;
  }
}

/** The i18n label for a priority value (consume-only sales.service.prio* keys). */
function prioLabel(t: Translate, priority: string): string {
  switch (priority) {
    case "high":
      return t("sales.service.prioHigh");
    case "normal":
      return t("sales.service.prioNormal");
    case "low":
      return t("sales.service.prioLow");
    default:
      return priority || DASH;
  }
}

/* -------------------------------------------------------------------------- *
 * TicketDetail — the detail modal body (sales-service.jsx TicketDetail).
 *
 * Fetches the FRESH single ticket (GET /sales/service/{id}) and falls back to the list
 * row while loading. Renders the SV-3 status timeline + the info grid (with the
 * server-derived warranty months) + the ONE machine-valid next-transition action button
 * (the 5 write ops), the honest-disabled SV-5 PM cross-link, and a Close button.
 * -------------------------------------------------------------------------- */
function TicketDetail({
  initial,
  customers,
  assignees,
  onClose,
}: {
  initial: TicketRow;
  customers: Map<string, string>;
  assignees: Map<string, string>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  // The fresh single fetch (GET /:id); the list row is the fallback while it loads.
  const detailQ = useServiceTicket(initial.id);
  const ticket = detailQ.data ? toTicketRow(detailQ.data) : initial;

  const schedule = useScheduleServiceTicket();
  const start = useStartServiceTicket();
  const fix = useFixServiceTicket();
  const close = useCloseServiceTicket();
  const busy = schedule.isPending || start.isPending || fix.isPending || close.isPending;

  const next = nextTransition(ticket.status);

  /** Dispatch the op to its mutation; the schedule op advances with an empty body (the
   *  assignee/date are set at create time — this button only flips received->scheduled). */
  const runTransition = (op: TransitionOp) => {
    const vars = { id: ticket.id };
    const onSuccess = () => {
      onClose();
      ctx.notify(transitionToast(op));
    };
    const onError = (err: unknown) => ctx.notify(errMessage(err) || DASH, "danger");
    const opts = { onSuccess, onError };
    if (op === "schedule") schedule.mutate(vars, opts);
    else if (op === "start") start.mutate(vars, opts);
    else if (op === "fix") fix.mutate(vars, opts);
    else close.mutate(vars, opts);
  };

  /** The success toast per op — reuses the closest existing key (consume-only). */
  const transitionToast = (op: TransitionOp): string => {
    if (op === "start") return t("sales.service.notifyStartFix");
    if (op === "fix") return t("sales.service.notifyFixed");
    if (op === "schedule") return t("sales.service.statusScheduled");
    return t("sales.service.statusClosed");
  };

  /** The action-button label per next-op (the prototype's per-status button text). */
  const actionLabel = (op: TransitionOp): string => {
    if (op === "schedule") return t("sales.service.btnAssignTech");
    if (op === "start") return t("sales.service.btnStartFix");
    if (op === "fix") return t("sales.service.statusFixed");
    return t("sales.service.btnCloseEval");
  };
  const actionIcon = (op: TransitionOp): IconName =>
    op === "schedule" ? "user" : op === "start" ? "hardhat" : op === "fix" ? "check" : "flag";

  const currentStep = isServiceStatus(ticket.status) ? STATUS_STEP[ticket.status] : 0;

  const cell = (label: string, value: ReactNode) => (
    <div>
      <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{label}</span>
      <div style={{ marginTop: 2 }}>{value}</div>
    </div>
  );

  const warrantyText =
    ticket.warrantyMonthsRemaining != null
      ? `${ticket.warrantyMonthsRemaining} ${t("sales.service.monthsSuffix")}`
      : DASH;
  const warrantyTone =
    ticket.warrantyMonthsRemaining != null && ticket.warrantyMonthsRemaining <= 3
      ? "var(--danger)"
      : "var(--ok)";

  return (
    <>
      {/* Status timeline (5 steps; the SVC_STATUS step order). */}
      <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {SERVICE_STATUSES.map((s, i) => {
            const tone = STATUS_TONE[s];
            const isPast = i < currentStep - 1;
            const isCurrent = i === currentStep - 1;
            const isFuture = i > currentStep - 1;
            return (
              <div key={s} style={{ display: "contents" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: isPast ? "var(--ok)" : isCurrent ? tone.fg : "var(--surface)",
                      color: isFuture ? "var(--text-3)" : "#fff",
                      border: isFuture ? "2px solid var(--border-strong)" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isCurrent ? `0 0 0 4px ${tone.bg}` : "none",
                    }}
                  >
                    <Icon name={isPast ? "check" : isCurrent ? "clock" : "user"} size={13} />
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: isCurrent ? 700 : 500,
                      color: isFuture ? "var(--text-3)" : "var(--text-2)",
                    }}
                  >
                    {statusLabel(t, s)}
                  </span>
                </div>
                {i < SERVICE_STATUSES.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: i < currentStep - 1 ? "var(--ok)" : "var(--surface-3)" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info grid (the prototype's 2-col detail grid). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          fontSize: 12,
          marginBottom: 14,
          padding: 12,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        {cell(t("sales.service.detailProblem"), <span style={{ fontWeight: 600 }}>{ticket.title || DASH}</span>)}
        {cell(
          t("sales.service.detailCategoryPrio"),
          <span>
            {ticket.category || DASH} ·{" "}
            <span style={{ color: (PRIO_TONE[ticket.priority] ?? PRIO_TONE.low).fg, fontWeight: 600 }}>
              {prioLabel(t, ticket.priority)}
            </span>
          </span>,
        )}
        {/* unit -> em-dash (uuid, no clean label); customer -> resolved name. */}
        {cell(t("sales.service.detailUnitCustomer"), `${DASH} · ${customers.get(ticket.customerId) || DASH}`)}
        {cell(
          t("sales.service.detailWarrantyLeft"),
          <span style={{ color: warrantyTone, fontWeight: 600 }}>{warrantyText}</span>,
        )}
        {cell(
          t("sales.service.detailChannelDate"),
          `${ticket.channel || DASH} · ${ticket.openedDate || DASH}`,
        )}
        {cell(t("sales.service.detailSchedule"), ticket.scheduledDate || DASH)}
      </div>

      {/* Assignee row (resolved name; em-dash when unresolved). */}
      <div style={{ fontSize: 12, marginBottom: 14 }}>
        <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{t("sales.service.thAssignee")}</span>
        <div style={{ marginTop: 2 }}>{assignees.get(ticket.assigneeUserId) || DASH}</div>
      </div>

      {/* Action area: Close · SV-5 PM cross-link (honest-disabled) · the one valid
          next-transition (SV-3). Every op surfaces 409/404 honestly. */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.close")}
        </Btn>
        {/* SV-5: POST /pm/workorders needs a pm_asset id a service ticket cannot supply
            -> no clean endpoint -> honest-disabled (never a fabricated WO). */}
        <Btn kind="outline" size="md" icon="wrench" disabled={!PM_WORKORDER_CROSSLINK_READY}>
          {t("sales.service.btnCreateWo")}
        </Btn>
        <div style={{ flex: 1 }} />
        {next ? (
          <Btn
            kind={next.op === "fix" ? "ok" : "primary"}
            size="md"
            icon={actionIcon(next.op)}
            disabled={busy}
            onClick={() => runTransition(next.op)}
          >
            {actionLabel(next.op)}
          </Btn>
        ) : (
          // closed (terminal) -> disabled "done" button (prototype btnClosedDone).
          <Btn kind="ghost" size="md" icon="check" disabled>
            {t("sales.service.btnClosedDone")}
          </Btn>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * NewTicketForm — the receive-ticket form body (sales-service.jsx NewTicketForm).
 *
 * POST /sales/service (title required; the server allocates `no`, stamps the intake
 * date, derives the warranty). Collects the wire-backed + clean-label fields only:
 *   title (required) · priority · category · channel · customer (GET /customers) ·
 *   assignee (GET /users) · scheduled date. The unit picker is OMITTED (unit_id is a
 *   project_node uuid with no clean label source); the SR-no (server-allocated), the
 *   derived warranty, the non-persisted detail note, and the mock notify-customer select
 *   are dropped (drop-not-collect). Sends the real customer_id + assignee_user_id.
 * -------------------------------------------------------------------------- */
function NewTicketForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const customersQ = useCustomerList();
  const usersQ = useUserList();
  const create = useCreateServiceTicket();

  const customerOptions = useMemo(() => (customersQ.data ?? []).map(toRef).filter((r) => r.id), [customersQ.data]);
  const userOptions = useMemo(() => (usersQ.data ?? []).map(toRef).filter((r) => r.id), [usersQ.data]);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<string>("normal");
  const [category, setCategory] = useState("");
  const [channel, setChannel] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");

  const submit = () => {
    const clean = title.trim();
    if (!clean) return; // button disabled in this case (defensive guard).
    const body: Record<string, unknown> = { title: clean, priority };
    if (category.trim()) body.category = category.trim();
    if (channel.trim()) body.channel = channel.trim();
    if (customerId) body.customer_id = customerId;
    if (assigneeUserId) body.assignee_user_id = assigneeUserId;
    if (scheduledDate) body.scheduled_date = scheduledDate;
    create.mutate(body, {
      onSuccess: () => {
        onClose();
        ctx.notify(t("sales.service.newTicketTitle"));
      },
      onError: (err) => ctx.notify(errMessage(err) || DASH, "danger"),
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("sales.service.fieldProblemTitle")} required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={t("sales.service.fieldPriority")} required>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {prioLabel(t, p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("sales.service.thCategory")}>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={t("sales.service.fieldChannel")}>
          <input value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle} />
        </Field>
        {/* Customer picker -> GET /customers (sends the real customer_id). */}
        <Field label={t("ar.fldCustomer")}>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={selectStyle}>
            <option value="">{DASH}</option>
            {customerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || DASH}
              </option>
            ))}
          </select>
        </Field>
        {/* Assignee picker -> GET /users (sends the real assignee_user_id). */}
        <Field label={t("sales.service.btnAssignTech")}>
          <select value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)} style={selectStyle}>
            <option value="">{DASH}</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || DASH}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("sales.service.fieldInspectDate")}>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={{ ...inputStyle, fontFamily: "var(--font-num)" }}
          />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          kind="primary"
          size="md"
          icon="check"
          disabled={create.isPending || title.trim() === ""}
          onClick={submit}
        >
          {t("sales.service.btnReceiveAssign")}
        </Btn>
      </div>
    </>
  );
}
