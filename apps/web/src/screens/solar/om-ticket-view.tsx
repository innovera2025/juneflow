/*
 * OmTicketView — the O&M ticket detail + close modal body, ported 1:1 from
 * pototype/real-forms2.jsx RF2OMView (L287-302). Opened by SolarMonitoring when a ticket card
 * is clicked (ctx.openModal), rendered by the shell modal host.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 6 label/value detail rows (asset · symptom ·
 * priority · team · status · due) and the ⚠ INVERTED footer are the prototype's, verbatim.
 * The #1 trap: the OUTLINE button (omCloseBtn, "close-ticket") is the CLOSE MUTATION; the
 * PRIMARY button (common.close, "dismiss") is a SILENT DISMISS (no POST). They are NOT swapped
 * — the destructive action is the outline, the primary is the harmless dismiss.
 *
 * Data (rules 3/4): the prototype's hardcoded mock rows become the real ticket's wire data —
 * symptom = title, priority/status raw, team = the resolved assignee name (assetLabel /
 * teamLabel are pre-resolved by the screen against the loaded inverters + users, never a raw
 * uuid). `due` has NO wire column, so it renders an honest em-dash (never fabricated). Close is
 * POST /solar/om-tickets/{id}/close (money=NONE): the outline button is disabled while the POST
 * is in flight (guard double-close) and the modal stays open until it settles; an already-
 * closed ticket is a 409 → the error toast. The success/error toast fires off the SETTLED
 * promise (fireWithToast) because the modal unmounts on close — omCloseToast's {no} is the
 * ticket's own known number (not a server round-trip).
 *
 * i18n (rule 2): every visible string is an existing dict key (t) — consume-only, no key
 * minted; the row labels reuse the exact-match keys pm.fieldAsset / omRowSymptom /
 * omFieldPriority / labor.team / common.status / omRowDue. Tokens back every colour (rule 6).
 */
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { useShellCtx } from "../../shell/shell-context";
import { fireWithToast } from "../admin/admin-rows";
import { useCloseOmTicket } from "./use-solar";
import type { TicketRow } from "./solar-monitor-rows";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";

/** Detail row style, ported 1:1 from real-forms2.jsx RF2OMView row (L292). */
const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "9px 0",
  borderBottom: "1px solid var(--border)",
  fontSize: 12.5,
};

export interface OmTicketViewProps {
  ticket: TicketRow;
  /** Pre-resolved inverter label ("<id> · <zone>" or "") — the screen owns the FK join. */
  assetLabel: string;
  /** Pre-resolved assignee name ("" when unresolved) — the screen owns the FK join. */
  teamLabel: string;
  onClose: () => void;
}

export function OmTicketView({ ticket, assetLabel, teamLabel, onClose }: OmTicketViewProps) {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const close = useCloseOmTicket();

  // Detail rows (real-forms2.jsx L288): every label is an exact-match existing dict key; every
  // value is the ticket's real wire data (or an honest em-dash for the due column, no wire).
  const rows: readonly [string, string][] = [
    [t("pm.fieldAsset"), assetLabel || DASH],
    [t("solar.monitor.omRowSymptom"), ticket.title || DASH],
    [t("solar.monitor.omFieldPriority"), ticket.priority || DASH],
    [t("labor.team"), teamLabel || DASH],
    [t("common.status"), ticket.status || DASH],
    [t("solar.monitor.omRowDue"), DASH],
  ];

  // The outline close button (omCloseBtn) runs the close mutation; the toast fires off the
  // settled promise (fireWithToast) since the modal unmounts on settle, and every rejection
  // (incl. an already-closed 409) routes to the error toast — never a swallowed catch.
  const runClose = () => {
    fireWithToast(
      () => close.mutateAsync(ticket.id),
      () => {
        ctx.notify(t("solar.monitor.omCloseToast").replace("{no}", ticket.no || DASH));
        onClose();
      },
      () => {
        ctx.notify(t("admin.common.actionFailedToast"), "danger");
        onClose();
      },
    );
  };

  return (
    <div>
      {rows.map(([label, value]) => (
        <div key={label} style={rowStyle}>
          <span style={{ color: "var(--text-3)" }}>{label}</span>
          <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
        </div>
      ))}
      {/* ⚠ INVERTED footer (real-forms2.jsx L296-299): outline = close mutation, primary = dismiss. */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn kind="outline" size="md" icon="check" disabled={close.isPending} onClick={runClose}>
          {t("solar.monitor.omCloseBtn")}
        </Btn>
        <Btn kind="primary" size="md" onClick={onClose}>
          {t("common.close")}
        </Btn>
      </div>
    </div>
  );
}
