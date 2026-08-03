/*
 * SolarPermit — the permit / approval timeline screen (route solar.permit), ported from
 * pototype/solar.jsx SolarPermit (L223-265) + the shared SolarKpi (L6-22). Section module
 * `permit` (registry.ts L127). READ-ONLY (solar.ts is GET-only, no write bundle filed).
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb, the title + TypeBadge subtitle,
 * the add-permit header action, the 3-card KPI strip, and the vertical permit stepper are
 * the prototype's.
 *
 * DATA (rule 3): GET /solar/permit-steps (use-solar.ts) via the generated client — the
 * prototype's local array becomes the server catalogue. Pure narrowing / count derivation /
 * approved-status mapping lives in solar-permit-rows.ts (unit-tested, G3).
 *
 * KPIs: "all permits" (step count) + "in progress" (pending count) are DERIVED live from
 * the returned steps. COD status is a fixed illustrative figure via its i18n value-key
 * (solar.permit.kpiCodValue — consume-only). Add-permit is REAL (Wave-1a): the header primary
 * opens PermitForm and POSTs /solar/permit-steps ({ name, org }, status server-set to pending,
 * money=NONE, B-212); the modal unmounts on submit so the toast fires off the settled promise.
 *
 * HONEST DIVERGENCES (rule 4 — flagged, never fabricated):
 *   - a null step_date falls back to the pending label (solar.permit.statusPending, the
 *     prototype's date="waiting-result" pending row) rather than inventing a date.
 *
 * i18n (rule 2): every visible string is a solar.permit.* / common.* dict key (t) —
 * consume-only, no key minted here (the add-modal submit reuses solar.warranty.actionAdd, the
 * exact "add-item" string the permit modal shows — no solar.permit key holds it). No Thai
 * literal lives in source (B-073); tokens back every colour except the KPI accent + modal icon
 * tone hex #B45309 (prototype-verbatim, solar.jsx L240 / real-forms2.jsx L308, B-037(a)) and the
 * node icon colour #fff (prototype-verbatim, solar.jsx L250, B-037(a)).
 */
import { useMemo } from "react";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { TypeBadge } from "../../shell/type-badge";
import { useShellCtx } from "../../shell/shell-context";
import { SolarKpi, StatusBadge } from "./solar-kpi";
import { fireWithToast } from "../admin/admin-rows";
import { toPermitStep, isPermitApproved, stepCount, pendingCount, type PermitStep } from "./solar-permit-rows";
import { useSolarPermitSteps, useCreatePermitStep } from "./use-solar";
import { PermitForm, type PermitDraft } from "./permit-form";

type Entity = components["schemas"]["Entity"];

/** Em-dash for an absent org / empty register (never a fabricated value). */
const DASH = "—";

export function SolarPermit() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const permitQ = useSolarPermitSteps();
  const createPermit = useCreatePermitStep();
  const steps = useMemo<PermitStep[]>(() => (permitQ.data ?? []).map(toPermitStep), [permitQ.data]);

  const pendingLabel = t("solar.permit.statusPending");
  const stepMeta = t("solar.permit.stepMeta");

  // add permit (real-forms2.jsx openPermitForm L305-310): open the form modal; on submit close
  // it, then POST { name, org } and fire the toast off the settled promise (the modal has
  // unmounted). status is server-set to pending (no advance-step, B-212); money = NONE.
  const openForm = () => {
    ctx.openModal({
      title: t("solar.permit.addModalTitle"),
      subtitle: t("solar.permit.addModalSubtitle"),
      icon: "paperclip",
      // prototype-verbatim icon tone (real-forms2.jsx L308); no matching token (B-037(a)).
      iconTone: "#B45309",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <PermitForm
          onClose={close}
          onSubmit={(draft: PermitDraft) => {
            close();
            const body = { name: draft.name, org: draft.org } as Entity;
            fireWithToast(
              () => createPermit.mutateAsync(body),
              () =>
                ctx.notify(
                  t("solar.permit.addToast")
                    .replace("{name}", draft.name)
                    .replace("{org}", draft.org),
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
      breadcrumbs={[t("solar.permit.breadcrumbRoot"), t("solar.permit.breadcrumbSelf")]}
      title={t("solar.permit.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type="solar" size="sm" />
          <span>{t("solar.permit.subtitle")}</span>
        </span>
      }
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={openForm}>
          {t("solar.permit.addBtn")}
        </Btn>
      }
    >
      {/* KPI strip (3): #1 all-permits + #3 pending DERIVED live; #2 COD is an i18n value-key. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
        <SolarKpi
          label={t("solar.permit.kpiAllLabel")}
          value={String(stepCount(steps))}
          unit={t("solar.permit.kpiUnitItems")}
          sub={t("solar.permit.kpiAllSub")}
          accent="#B45309"
          icon="paperclip"
        />
        <SolarKpi
          label={t("solar.permit.kpiCodLabel")}
          value={t("solar.permit.kpiCodValue")}
          sub={t("solar.permit.kpiCodSub")}
          accent="var(--ok)"
          icon="check"
        />
        <SolarKpi
          label={t("solar.permit.kpiPendingLabel")}
          value={String(pendingCount(steps))}
          unit={t("solar.permit.kpiUnitItems")}
          sub={t("solar.permit.kpiPendingSub")}
          accent="var(--warn)"
          icon="clock"
        />
      </div>

      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
          {t("solar.permit.stepsHeader")}
        </div>
        {permitQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3].map((n) => (
              <div key={n} style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        ) : steps.length === 0 ? (
          // No dedicated empty-state key exists (no minting) -> honest em-dash.
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>{DASH}</div>
        ) : (
          <div style={{ padding: 18 }}>
            {steps.map((s, i) => {
              const approved = isPermitApproved(s.status);
              const dateText = s.stepDate || pendingLabel;
              const meta = stepMeta.replace("{org}", s.org || DASH).replace("{date}", dateText);
              return (
                <div key={s.id} style={{ display: "flex", gap: 14, paddingBottom: i < steps.length - 1 ? 18 : 0, position: "relative" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        flexShrink: 0,
                        background: approved ? "var(--ok)" : "var(--warn)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={approved ? "check" : "clock"} size={15} />
                    </div>
                    {i < steps.length - 1 && <div style={{ width: 2, flex: 1, background: "var(--border)", marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name || DASH}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{meta}</div>
                  </div>
                  <StatusBadge kind={approved ? "approved" : "pending"} size="sm">
                    {approved ? t("solar.permit.statusApproved") : t("solar.permit.statusPending")}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Page>
  );
}
