/*
 * SalesCRM — the CRM / Leads pipeline screen (route sales.crm), ported from
 * pototype/sales-crm.jsx SalesCRM (L216-301). Section module sales_re (registry.ts
 * L165). The kanban port: a 5-KPI strip over a 5-column funnel board (the 5 funnel
 * stages lead|visit|quote|booking|contract), each column a scrollable stack of lead
 * cards, driven by the real lead register.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb
 * (sales.common.breadcrumbRoot / sales.crm.breadcrumb), the title + subtitle, the two
 * header actions (sales.crm.btnAllSales / sales.crm.btnAddLead),
 * the 5 MiniKpi cards, and the 5-column board (per-column header with count + a
 * per-lead card showing name / hot badge / interest / note / owner / last-contact)
 * are the prototype's. MiniKpi is inlined from wo-list.tsx (ds.jsx MiniKpi).
 *
 * Data (rule 3): GET /sales/leads (use-sales-crm.ts) via the generated client — the
 * prototype's local LEADS_BY_STAGE mock becomes the server register. Each row is the
 * opaque Entity { id, name, phone, source, interest, stage, hot, last_contact_at,
 * note, owner_user_id, days, created_at } (land-sales.ts leadWire). Pure narrowing /
 * stage-bucketing / hot-count logic (toLeadRow / groupByStage / countHot / userNameById)
 * lives in sales-crm-rows.ts (unit-tested, G3).
 *
 * READ-ONLY. Every write affordance is honest-disabled or omitted, but CORRECTED
 * 2026-08-10: this header used to say "the create endpoint is not filed" three times and
 * that was FALSE — POST /sales/leads is mounted (land-sales.ts:422, registered :1062,
 * `name` required else 400) and the sales.crm.form* dict keys for all 11 prototype fields
 * exist. The two remaining blockers are different from each other, and neither is the
 * create endpoint:
 *   - add-lead (sales.crm.btnAddLead, header primary) and the per-column ghost "+" ->
 *     DISABLED pending a ruling (B-349). The endpoint exists; the SCHEMA does not. The
 *     prototype's LeadForm (sales-crm.jsx:303-328) collects 11 fields and the `lead` table
 *     (packages/db extensions.ts:326) has columns for 6 of them. email, Line ID, unit type,
 *     budget and the follow-up date have NO column, so wiring the form as drawn means the
 *     user fills five fields that vanish on save. That is not an honest-omit — honest-omit
 *     is about DISPLAY (render an em-dash for what the wire lacks); silently discarding
 *     what a user typed is a different and worse thing.
 *   - advance-stage / send-quote / log-follow-up -> correctly blocked (B-350), for the
 *     reason the old comment should have given: there is NO lead UPDATE endpoint of any
 *     kind. POST /sales/leads is the only lead write in the whole api; a grep for
 *     put/patch on /sales/leads finds nothing. sales.crm.btnAdvanceStage has nothing to
 *     call, so the lead-detail modal stays READ-ONLY (real phone / source / interest /
 *     owner + Close) and the prototype's mock contact-history timeline stays OMITTED.
 *   - all-sales filter (sales.crm.btnAllSales, header) -> DISABLED, and this one was
 *     accurate: the prototype's per-sales filter is a mock notify, so there is nothing
 *     honest for it to do.
 *
 * HONEST DIVERGENCES (rule 4 — never fabricated):
 *   - hot is a BOOLEAN column; SA-1's 3-state warmth (hot/warm/cold) is a not-yet-merged
 *     migration. The hot badge + danger left-border show only when true; a non-hot card
 *     gets a neutral border and no badge (no invented warm/cold). The hotWarm/hotCold
 *     dict keys are intentionally unused (consume-only).
 *   - owner_user_id is a raw uuid, resolved to a name via GET /users (userNameById,
 *     mirroring wo-list's vendorNameById). An unresolved/absent owner renders an em-dash
 *     and no avatar (the uuid is never leaked).
 *   - KPI values: total-leads + hot are REAL counts (hot replaces the mock literal 12,
 *     C10). "visits this week" / "QO pending" / "closed this month" carry a time-window
 *     or document-status the leads wire cannot supply, so their values are em-dashed
 *     (wo-list precedent). The prototype's fabricated KPI sub-captions are dropped.
 *   - the detail subtitle drops the prototype's `${id}` (a mock human code "L-318"); our
 *     id is a uuid, never shown — only the real interest rides the subtitle.
 *   - last_contact_at is the real date; a null date is an em-dash. days (nullable) drives
 *     the overdue (> 3) danger accent on the contact date.
 *
 * i18n (rule 2): every visible string is a sales.crm.* / sales.common.* / common.* dict
 * key (t) — consume-only (no key minted here). No Thai literal lives in source (rule 2);
 * tokens back every colour except the 5 prototype-verbatim funnel-stage hexes, which have
 * no @juneflow/tokens equivalent and are kept as literals (B-037(a), as ds.jsx Avatar /
 * po-wo statusTone dots do).
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useUserList } from "../master/use-users";
import { useSalesLeads } from "./use-sales-crm";
import {
  LEAD_STAGES,
  toLeadRow,
  groupByStage,
  countHot,
  toUserRef,
  userNameById,
  type LeadStage,
  type LeadRow,
} from "./sales-crm-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/**
 * Prototype-verbatim funnel-stage colours (sales-crm.jsx `stages`). No @juneflow/tokens
 * equivalent exists for these hues, so they stay literal (B-037(a), as ds.jsx Avatar's
 * default and po-wo statusTone dots do). Not display text — no i18n involved.
 */
const STAGE_COLOR: Record<LeadStage, string> = {
  lead: "#94A3B8",
  visit: "#0F766E",
  quote: "#0B2A4A",
  booking: "#1D4ED8",
  contract: "#15803D",
};

/** MiniKpi, inlined from wo-list.tsx (ds.jsx MiniKpi) — the KPI-strip card. */
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
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}>
          {label}
        </span>
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

export function SalesCRM() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const leadsQ = useSalesLeads();
  // Owner resolution reuses the master users list (shared ["users"] cache), exactly as
  // wo-list.tsx reuses useVendorList for its subcontractor column.
  const usersQ = useUserList();

  const rows = useMemo<LeadRow[]>(() => (leadsQ.data ?? []).map(toLeadRow), [leadsQ.data]);
  const grouped = useMemo(() => groupByStage(rows), [rows]);
  const hotCount = useMemo(() => countHot(rows), [rows]);
  const owners = useMemo(
    () => userNameById((usersQ.data ?? []).map(toUserRef)),
    [usersQ.data],
  );

  /** The board-order label for a stage (consume-only sales.crm.stage* keys). */
  const stageLabel = (stage: LeadStage): string =>
    stage === "lead"
      ? t("sales.crm.stageLead")
      : stage === "visit"
        ? t("sales.crm.stageVisit")
        : stage === "quote"
          ? t("sales.crm.stageQuote")
          : stage === "booking"
            ? t("sales.crm.stageBooking")
            : t("sales.crm.stageContract");

  // Read-only lead detail (sales-crm.jsx LeadDetail, stripped to real fields). Shows the
  // phone / source / interest / owner grid + a Close button; the mock contact-history and
  // all write forms/actions are omitted (see header).
  const openDetail = (l: LeadRow) => {
    const ownerName = owners.get(l.ownerUserId) ?? "";
    const cell = (label: string, value: ReactNode, mono?: boolean) => (
      <div>
        <span style={{ color: "var(--text-3)", fontSize: 10.5 }}>{label}</span>
        <div className={mono ? "num" : ""}>{value}</div>
      </div>
    );
    ctx.openModal({
      title: l.name || DASH,
      subtitle: l.interest || DASH,
      icon: "user",
      iconTone: l.hot ? "var(--danger)" : "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <>
          <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 10, marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
              {cell(t("sales.crm.formPhone"), l.phone || DASH, true)}
              {cell(t("sales.crm.formSource"), l.source || DASH)}
              {cell(t("sales.crm.detailInterest"), l.interest || DASH)}
              {cell(t("sales.common.owner"), ownerName || DASH)}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("common.close")}
            </Btn>
          </div>
        </>
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("sales.common.breadcrumbRoot"), t("sales.crm.breadcrumb")]}
      title={t("sales.crm.title")}
      subtitle={t("sales.crm.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Per-sales filter is a mock notify in the prototype (no real filter) — disabled. */}
          <Btn kind="outline" size="md" icon="filter" disabled>
            {t("sales.crm.btnAllSales")}
          </Btn>
          {/* Add-lead: POST /sales/leads IS merged. Disabled pending B-349 — 5 of the
              form's 11 fields have no column, so the form would discard user input. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("sales.crm.btnAddLead")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (5) — total + hot are REAL counts; the three window/status metrics are
          em-dashed (the leads wire has no week / approval-status / month signal). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={t("sales.crm.kpiTotalLeads")} value={String(rows.length)} tone="var(--brand)" icon="users" />
        <MiniKpi label={t("sales.crm.kpiHotFollow")} value={String(hotCount)} tone="var(--danger)" icon="warn" />
        <MiniKpi label={t("sales.crm.kpiVisitsThisWeek")} value={DASH} tone="var(--accent)" icon="calendar" />
        <MiniKpi label={t("sales.crm.kpiQoPending")} value={DASH} tone="var(--warn)" icon="paperclip" />
        <MiniKpi label={t("sales.crm.kpiClosedThisMonth")} value={DASH} tone="var(--ok)" icon="check" />
      </div>

      {leadsQ.isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {LEAD_STAGES.map((stage) => (
            <div
              key={stage}
              style={{
                height: 220,
                borderRadius: "var(--r-lg)",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            height: "calc(100vh - 380px)",
            overflow: "hidden",
          }}
        >
          {LEAD_STAGES.map((stage) => {
            const color = STAGE_COLOR[stage];
            const items = grouped[stage];
            return (
              <Card
                key={stage}
                pad={0}
                style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderTop: `3px solid ${color}` }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color }}>{stageLabel(stage)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                      {items.length} {t("sales.crm.customersSuffix")}
                    </div>
                  </div>
                  {/* Add-to-stage: same as the header add-lead — endpoint merged, disabled
                      pending B-349 (5 of 11 form fields have no column). */}
                  <Btn kind="ghost" size="sm" icon="plus" label={t("sales.crm.btnAddLead")} disabled />
                </div>
                <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
                  {items.map((l) => {
                    const ownerName = owners.get(l.ownerUserId) ?? "";
                    const overdue = l.days != null && l.days > 3;
                    return (
                      <div
                        key={l.id}
                        onClick={() => openDetail(l)}
                        style={{
                          padding: 10,
                          marginBottom: 6,
                          borderRadius: 8,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderLeft: `3px solid ${l.hot ? "var(--danger)" : "var(--border)"}`,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, flex: 1 }}>{l.name || DASH}</div>
                          {/* Hot badge only when the boolean says so (no invented warm/cold). */}
                          {l.hot && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "var(--danger-soft)",
                                color: "var(--danger)",
                              }}
                            >
                              {t("sales.crm.hotHot")}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3, lineHeight: 1.4 }}>
                          {l.interest || DASH}
                        </div>
                        {l.note && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text-2)",
                              marginTop: 6,
                              lineHeight: 1.4,
                              padding: "5px 7px",
                              background: "var(--surface-2)",
                              borderRadius: 4,
                            }}
                          >
                            {l.note}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 10 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {ownerName && <Avatar name={ownerName} size={14} color={color} />}
                            <span style={{ color: "var(--text-3)" }}>{ownerName || DASH}</span>
                          </span>
                          <span style={{ color: overdue ? "var(--danger)" : "var(--text-3)", fontWeight: overdue ? 700 : 400 }}>
                            {l.lastContactAt || DASH}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 11 }}>
                      {t("sales.crm.emptyNoLead")}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
