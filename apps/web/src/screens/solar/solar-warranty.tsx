/*
 * SolarWarranty — the equipment-warranty register screen (route solar.warranty), ported
 * from pototype/solar.jsx SolarWarranty (L269-310). Section module `warranty` (registry.ts
 * L128). READ-ONLY (solar.ts is GET-only, no write bundle filed). Table-only (no KPIs).
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb, the title + TypeBadge subtitle, the
 * add-item header action, and the 7-column warranty table are the prototype's.
 *
 * DATA (rule 3): GET /solar/warranties (use-solar.ts) via the generated client — the
 * prototype's local array becomes the server register. Pure narrowing / status mapping lives
 * in solar-warranty-rows.ts (unit-tested, G3). Add-item is REAL (Wave-1a): the header primary
 * opens WarrantyForm and POSTs /solar/warranties ({ item, years }, money=NONE, B-219); the
 * modal unmounts on submit so the toast fires off the settled promise (fireWithToast).
 *
 * HONEST DIVERGENCES (rule 4 — flagged, never fabricated):
 *   - prod_date / expiry_date are nullable on the wire; a null renders an em-dash (never a
 *     fabricated date). perf renders the raw returned value.
 *
 * i18n (rule 2): every visible string is a solar.warranty.* / common.* dict key (t) —
 * consume-only, no key minted here. No Thai literal lives in source (B-073); tokens back every
 * colour except the prototype-verbatim modal icon tone #B45309 (real-forms2.jsx L334, B-037(a));
 * numeric cells carry class `num` (rule 7).
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
import { StatusBadge } from "./solar-kpi";
import { formatMoney } from "./solar-shared";
import { fireWithToast } from "../admin/admin-rows";
import { toWarrantyRow, warrantyStatus, type WarrantyRow } from "./solar-warranty-rows";
import { useSolarWarranties, useCreateWarranty } from "./use-solar";
import { WarrantyForm, type WarrantyDraft } from "./warranty-form";

type Entity = components["schemas"]["Entity"];

/** Em-dash for every honest wire gap (a null date / an absent field). */
const DASH = "—";

/** Table header cell style (ds.jsx th()). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "left",
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

/** Warranty status badge label (kind resolved in pure logic; no Thai-literal compare). */
function statusLabel(t: (k: "solar.warranty.statusActive" | "solar.warranty.statusExpiring") => string, status: string): string {
  return warrantyStatus(status).label === "expiring" ? t("solar.warranty.statusExpiring") : t("solar.warranty.statusActive");
}

export function SolarWarranty() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const warrantiesQ = useSolarWarranties();
  const createWarranty = useCreateWarranty();
  const rows = useMemo<WarrantyRow[]>(() => (warrantiesQ.data ?? []).map(toWarrantyRow), [warrantiesQ.data]);

  // add warranty (real-forms2.jsx openWarrantyForm L331-336): open the form modal; on submit
  // close it, then POST { item, years } and fire the toast off the settled promise (the modal
  // has unmounted). years -> Number for the wire (server truncates, B-219); money = NONE.
  const openForm = () => {
    ctx.openModal({
      title: t("solar.warranty.addModalTitle"),
      subtitle: t("solar.warranty.addModalSubtitle"),
      icon: "shield",
      // prototype-verbatim icon tone (real-forms2.jsx L334); no matching token (B-037(a)).
      iconTone: "#B45309",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <WarrantyForm
          onClose={close}
          onSubmit={(draft: WarrantyDraft) => {
            close();
            const body = { item: draft.item, years: Number(draft.years) } as Entity;
            fireWithToast(
              () => createWarranty.mutateAsync(body),
              () =>
                ctx.notify(
                  t("solar.warranty.addToast")
                    .replace("{item}", draft.item)
                    .replace("{years}", draft.years),
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
      breadcrumbs={[t("solar.warranty.breadcrumbSection"), t("solar.warranty.breadcrumbPage")]}
      title={t("solar.warranty.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type="solar" size="sm" />
          <span>{t("solar.warranty.subtitle")}</span>
        </span>
      }
      actions={
        <Btn kind="primary" size="md" icon="plus" onClick={openForm}>
          {t("solar.warranty.actionAdd")}
        </Btn>
      }
    >
      <Card pad={0}>
        {warrantiesQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3].map((n) => (
              <div key={n} style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th()}>{t("solar.warranty.colItem")}</th>
                <th scope="col" style={th(160)}>{t("solar.warranty.colBrand")}</th>
                <th scope="col" style={th(120)}>{t("solar.warranty.colQty")}</th>
                <th scope="col" style={th(170)}>{t("solar.warranty.colPerf")}</th>
                <th scope="col" style={th(110)}>{t("solar.warranty.colProd")}</th>
                <th scope="col" style={th(110)}>{t("solar.warranty.colExpiry")}</th>
                <th scope="col" style={th(110)}>{t("solar.warranty.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  {/* No dedicated empty-state key exists (no minting) -> honest em-dash. */}
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>{DASH}</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const st = warrantyStatus(r.status);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.item || DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{r.brand || DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }} className="num">{formatMoney(r.qty)}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{r.perf || DASH}</td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{r.prodDate || DASH}</td>
                      <td style={td} className="num">{r.expiryDate || DASH}</td>
                      <td style={td}>
                        <StatusBadge kind={st.kind} size="sm">{statusLabel(t, r.status)}</StatusBadge>
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
