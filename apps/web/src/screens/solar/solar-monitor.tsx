/*
 * SolarMonitoring — the inverter monitoring + O&M screen (route solar.monitor), ported
 * from pototype/solar.jsx SolarMonitoring (L25-107) + the shared SolarKpi (L6-22). Section
 * module `om` (registry.ts L124). READ-ONLY (solar.ts is GET-only, no write bundle filed).
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb, the title + TypeBadge subtitle,
 * the two header actions, the 4-card KPI strip, the 1.4fr/1fr split of the real-time
 * inverter table + the O&M ticket card are the prototype's.
 *
 * DATA (rule 3): GET /solar/inverters + GET /solar/om-tickets (use-solar.ts) via the
 * generated client — the prototype's local arrays become the server register. Pure
 * narrowing / KPI derivation / status + perf mapping lives in solar-monitor-rows.ts
 * (unit-tested, G3). assignee_user_id resolves to a name via GET /users (sales-crm
 * precedent), em-dashed when unresolved (never a leaked uuid).
 *
 * KPIs: "current output" (MW) + its installed-capacity sub are DERIVED live from the
 * inverter rows. The other three (Performance Ratio 83.6 / today-energy 38.2 / faults 2)
 * are fixed illustrative EPC-model figures the wire cannot supply — rendered verbatim as
 * display constants (numbers, so no B-073 issue), per the brief's "IRR/NPV/ROI figures
 * verbatim" rule.
 *
 * HONEST DIVERGENCES (rule 4 — flagged, never fabricated):
 *   - The per-ticket card is now interactive (Wave-1a): clicking it opens OmTicketView — the
 *     ticket detail + close action (POST /solar/om-tickets/{id}/close, money=NONE, idempotent).
 *   - The header "new ticket" primary now opens RF2OMForm (om-ticket-form.tsx) and POSTs
 *     /solar/om-tickets ({ title, inverter_id, priority, team }, money=NONE, no assignee): B-223
 *     landed the free-text solar_om_ticket.team column and all option keys, so the create
 *     affordance is wired (the modal unmounts on submit, so the toast fires off the settled
 *     promise, fireWithToast). The asset dropdown sources the real inverter register (the
 *     prototype's 5 mock options are dropped); priority + team persist as their display labels.
 *   - the O&M ticket `priority` is a raw backend value (seed = a Thai word) with NO code
 *     to switch on, so the Tag renders it with a NEUTRAL tone for every row (a code-based
 *     tone is a future round).
 *   - the ticket `status` is a raw backend value rendered with a pending tone (the
 *     prototype hardcodes pending for every ticket).
 *   - Export has no endpoint -> the prototype's client-intent toast (solar.monitor.toastExport).
 *
 * i18n (rule 2): every visible string is a solar.monitor.* / borrowed (pm.fieldAsset /
 * labor.team / common.*) dict key (t) — consume-only, no key minted here; the view-modal title
 * composes the same-screen omCardTitle prefix (the "O&M ticket" label) with the ticket's own
 * number (data, no omViewModalTitle key exists). No Thai literal lives in source (B-073); tokens
 * back every colour except the KPI accent + modal icon tone hex #B45309 (prototype-verbatim,
 * solar.jsx L50 / real-forms2.jsx L254, B-037(a)); numeric cells carry class `num` (rule 7).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { TypeBadge } from "../../shell/type-badge";
import { useShellCtx } from "../../shell/shell-context";
import { useUserList } from "../master/use-users";
import { fireWithToast } from "../admin/admin-rows";
import { SolarKpi, StatusBadge, Tag } from "./solar-kpi";
import { formatMoney, str } from "./solar-shared";
import {
  toInverterRow,
  toTicketRow,
  kpiOutputMw,
  kpiInstalledMw,
  inverterStatus,
  perfColor,
  toUserRef,
  userNameById,
  omAssetLabel,
  type InverterRow,
  type TicketRow,
} from "./solar-monitor-rows";
import { useSolarInverters, useSolarOmTickets, useCreateOmTicket } from "./use-solar";
import { OmTicketView } from "./om-ticket-view";
import { RF2OMForm, type OmTicketDraft } from "./om-ticket-form";

type Entity = components["schemas"]["Entity"];

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Card section header (solar.jsx card title div, L58/L88). */
const cardTitle: CSSProperties = {
  padding: "14px 18px",
  borderBottom: "1px solid var(--border)",
  fontSize: 13.5,
  fontWeight: 700,
};

/** Loading skeleton — token blocks, no invented copy (mirror land-bank). */
function Skeleton() {
  return (
    <div style={{ padding: 20 }}>
      {[0, 1, 2, 3, 4].map((n) => (
        <div
          key={n}
          style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
        />
      ))}
    </div>
  );
}

/** Inverter status label (kind resolved in pure logic; no Thai-literal compare here). */
function statusLabel(t: (k: "solar.monitor.statusOk" | "solar.monitor.statusDerating" | "solar.monitor.statusOffline") => string, status: string): string {
  const label = inverterStatus(status).label;
  return label === "derating"
    ? t("solar.monitor.statusDerating")
    : label === "offline"
      ? t("solar.monitor.statusOffline")
      : t("solar.monitor.statusOk");
}

export function SolarMonitoring() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const invertersQ = useSolarInverters();
  const ticketsQ = useSolarOmTickets();
  const usersQ = useUserList();
  const createOmTicket = useCreateOmTicket();

  const inverters = useMemo<InverterRow[]>(() => (invertersQ.data ?? []).map(toInverterRow), [invertersQ.data]);
  const tickets = useMemo<TicketRow[]>(() => (ticketsQ.data ?? []).map(toTicketRow), [ticketsQ.data]);
  const assignees = useMemo(() => userNameById((usersQ.data ?? []).map(toUserRef)), [usersQ.data]);

  const cellUnit = t("solar.monitor.cellOutputUnit");

  // open the O&M ticket detail + close modal (real-forms2.jsx openOMTicketForm view branch,
  // L250-256). The asset + team labels are resolved here against the loaded inverters + users
  // (real FK joins, never a raw uuid) and captured for the modal. The view title has no
  // dedicated key, so it composes the same-screen omCardTitle (the "O&M ticket" label) + the
  // ticket number (data), matching the prototype's `<O&M ticket label> ${no}`.
  const openView = (tk: TicketRow) => {
    const assetLabel = omAssetLabel(tk.inverterId, inverters);
    const teamLabel = tk.assigneeUserId ? assignees.get(tk.assigneeUserId) ?? "" : "";
    ctx.openModal({
      title: `${t("solar.monitor.omCardTitle")} ${tk.no}`,
      subtitle: t("solar.monitor.omViewModalSubtitle"),
      icon: "wrench",
      // prototype-verbatim icon tone (real-forms2.jsx L254); no matching token (B-037(a)).
      iconTone: "#B45309",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <OmTicketView ticket={tk} assetLabel={assetLabel} teamLabel={teamLabel} onClose={close} />
      ),
    });
  };

  // open the create-O&M-ticket form (real-forms2.jsx openOMTicketForm create branch, L251-256):
  // the header primary opens RF2OMForm; on submit close it, then POST { title, inverter_id,
  // priority, team } (money=NONE, no assignee — the door generates the running no + status=open,
  // B-223) and fire the toast off the settled promise (the modal has unmounted). The toast's {no}
  // is the SERVER-assigned number from the POST response; {asset} is the inverter id (the code,
  // the part before " ·", mirroring the prototype's asset.split(" ·")[0]); {pri}/{team} are the
  // resolved display labels the form emitted.
  const openCreate = () => {
    ctx.openModal({
      title: t("solar.monitor.omModalTitle"),
      subtitle: t("solar.monitor.omModalSubtitle"),
      icon: "wrench",
      // prototype-verbatim icon tone (real-forms2.jsx L254); no matching token (B-037(a)).
      iconTone: "#B45309",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <RF2OMForm
          onClose={close}
          onSubmit={(draft: OmTicketDraft) => {
            close();
            const body = {
              title: draft.desc,
              inverter_id: draft.inverterId,
              priority: draft.priority,
              team: draft.team,
            } as Entity;
            let created: Entity | undefined;
            fireWithToast(
              async () => {
                created = await createOmTicket.mutateAsync(body);
              },
              () =>
                ctx.notify(
                  t("solar.monitor.omCreateToast")
                    .replace("{no}", str(created?.no) || DASH)
                    .replace("{asset}", draft.inverterId)
                    .replace("{pri}", draft.priority)
                    .replace("{team}", draft.team),
                ),
              () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
            );
          }}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("solar.monitor.crumbModule"), t("solar.monitor.crumbScreen")]}
      title={t("solar.monitor.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type="solar" size="sm" />
          <span>{t("solar.monitor.subtitle")}</span>
        </span>
      }
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("solar.monitor.toastExport"))}>
            {t("solar.monitor.actionExport")}
          </Btn>
          {/* Opens the create form (RF2OMForm); POST /solar/om-tickets, money=NONE (B-223 landed
              the free-text team column + option keys) — see the file-header divergence note. */}
          <Btn kind="primary" size="md" icon="plus" onClick={openCreate}>
            {t("solar.monitor.actionNewTicket")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): #1 DERIVED live; #2-4 fixed illustrative EPC-model figures (verbatim). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <SolarKpi
          label={t("solar.monitor.kpiOutputLabel")}
          value={kpiOutputMw(inverters)}
          unit={t("solar.monitor.kpiOutputUnit")}
          sub={t("solar.monitor.kpiOutputSub").replace("{mw}", kpiInstalledMw(inverters))}
          accent="#B45309"
          icon="sun"
        />
        <SolarKpi
          label={t("solar.monitor.kpiPrLabel")}
          value="83.6"
          unit={t("solar.monitor.kpiPrUnit")}
          sub={t("solar.monitor.kpiPrSub")}
          accent="var(--ok)"
          icon="trend"
        />
        <SolarKpi
          label={t("solar.monitor.kpiEnergyLabel")}
          value="38.2"
          unit={t("solar.monitor.kpiEnergyUnit")}
          sub={t("solar.monitor.kpiEnergySub")}
          accent="var(--info)"
          icon="pie"
        />
        <SolarKpi
          label={t("solar.monitor.kpiFaultLabel")}
          value="2"
          unit={t("solar.monitor.kpiFaultUnit")}
          sub={t("solar.monitor.kpiFaultSub")}
          accent="var(--danger)"
          icon="warn"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        {/* Real-time inverter register. */}
        <Card pad={0}>
          <div style={cardTitle}>{t("solar.monitor.invTableTitle")}</div>
          {invertersQ.isLoading ? (
            <Skeleton />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(90)}>{t("solar.monitor.colInverter")}</th>
                  <th scope="col" style={th(90)}>{t("solar.monitor.colZone")}</th>
                  <th scope="col" style={th(110, true)}>{t("solar.monitor.colOutput")}</th>
                  <th scope="col" style={th(120, true)}>{t("solar.monitor.colPerformance")}</th>
                  <th scope="col" style={th(90)}>{t("solar.monitor.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {inverters.length === 0 ? (
                  <tr>
                    {/* No dedicated empty-state key exists (no minting) -> honest em-dash. */}
                    <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>{DASH}</td>
                  </tr>
                ) : (
                  inverters.map((iv) => {
                    const st = inverterStatus(iv.status);
                    return (
                      <tr key={iv.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...td, fontWeight: 600 }} className="num">{iv.id || DASH}</td>
                        <td style={{ ...td, color: "var(--text-2)" }}>{iv.zone || DASH}</td>
                        <td style={{ ...td, textAlign: "right" }} className="num">
                          {formatMoney(iv.outputKw)}{" "}
                          <span style={{ color: "var(--text-3)" }}>/ {formatMoney(iv.kw)} {cellUnit}</span>
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
                            <div style={{ width: 54, height: 6, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
                              <div style={{ width: `${iv.perf}%`, height: "100%", background: perfColor(iv.perf) }} />
                            </div>
                            <span className="num" style={{ width: 30 }}>{formatMoney(iv.perf)}%</span>
                          </div>
                        </td>
                        <td style={td}>
                          <StatusBadge kind={st.kind} size="sm">{statusLabel(t, iv.status)}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </Card>

        {/* O&M ticket list card — each row opens the ticket detail/close view; the header
            primary opens the create form (openCreate). */}
        <Card pad={0}>
          <div style={cardTitle}>{t("solar.monitor.omCardTitle")}</div>
          {ticketsQ.isLoading ? (
            <Skeleton />
          ) : (
            <div style={{ padding: 8 }}>
              {tickets.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>{DASH}</div>
              ) : (
                tickets.map((tk) => {
                  const who = tk.assigneeUserId ? assignees.get(tk.assigneeUserId) ?? "" : "";
                  return (
                    // Interactive (Wave-1a): clicking the card opens the ticket detail + close
                    // modal (openView). role=button + Enter/Space keyboard activation (a11y) keep
                    // the visual a div; the destructive close lives behind the view's outline btn.
                    <div
                      key={tk.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openView(tk)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openView(tk);
                        }
                      }}
                      style={{ padding: 12, borderRadius: 9, marginBottom: 4, border: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand)" }}>{tk.no || DASH}</span>
                        {/* Priority is a raw backend value with no code -> neutral tone (divergence). */}
                        <Tag tone="var(--text-2)">{tk.priority || DASH}</Tag>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>{tk.title || DASH}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-3)" }}>
                        <span>{who || DASH}</span>
                        {/* Status is a raw backend value; the prototype pins a pending tone. */}
                        <StatusBadge kind="pending" size="sm">{tk.status || DASH}</StatusBadge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
