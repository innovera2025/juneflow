/*
 * MasterCustomer — the Customer register, narrowed from pototype/master-party.jsx
 * MasterCustomer (L188-264) + PartyKpi (L36-50). Route master.customer, prototype file
 * master-party.jsx (NAV-ROUTES.md L99).
 *
 * LEAN READ-ONLY (Wei ruling B-135). The read-side wire (GET /customers,
 * apps/api/src/routes/customers.ts customerWire) returns ONLY { id, name, tax_id, created_at }
 * and there is NO write handler — POST /customers + PUT /customers/{id} are declared in
 * openapi.yaml but NOT registered (a live 404). So this screen ships the honest minimum:
 *   - the breadcrumb / title / subtitle / Export action are the prototype's;
 *   - "Add customer" is honest-DISABLED (no POST handler) — never a form that would 404;
 *   - kpiTotal is the REAL row count; the person/corp + total-value KPIs render the literal
 *     em-dash (no `type` / `value` wire field) — labels kept, values never fabricated (C10);
 *   - the table renders name + tax_id from the wire; every other prototype column
 *     (code · type · project/unit · value) is the literal em-dash (no wire field);
 *   - loading = token skeleton; an empty catalogue = the table's empty state (no invented copy).
 * A future backend round implements the write handlers + the richer columns; this screen grows
 * then. Mock mechanics dropped (§0 rule 3): CUSTOMER_SEED/setRows/window.CUSTOMER_SEED, the
 * search box, the type-filter dropdown, the row ⋮ edit/history menu and the hardcoded status
 * badge are all mock and are not reproduced under the read-only wire.
 *
 * i18n (§0 rule 2): every visible string is a customer.* / common.* dict key (t), a phrases
 * key (tp) sourced from customer-strings.json, or the task-specified reuse (breadcrumb crumb-2
 * = ar.fldCustomer). Two labels the customer.* dict does not yet cover reuse the exact-value
 * keys from the SAME prototype file: the Export button (vendor.btnExport) and the tax-id
 * header (vendor.thTaxId); both are flagged for a future customer.btnExport / customer.thTaxId
 * mint.
 * No Thai/baht literal sits in this source (B-073); tokens back every colour (§0 rule 6);
 * numeric cells carry class `num` (§0 rule 7). Tag/StatusBadge are dropped (no wire type/status).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { toCustomerRow, customerCount, type CustomerRow } from "./master-customer-rows";
import { useCustomerList } from "./use-master-customer";
import customerStrings from "./customer-strings.json" with { type: "json" };

/** The literal em-dash the screen renders for every column/KPI with no wire field (B-135). */
const DASH = "—";

/** Table header cell style, ported from ds.jsx th() (L214-219). */
function th(w?: number): CSSProperties {
  return {
    textAlign: "start",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style, ported from ds.jsx td() (L220). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** PartyKpi, ported 1:1 from master-party.jsx PartyKpi (L36-50). color-mix + white verbatim. */
function PartyKpi({
  label,
  value,
  unit,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
  icon: IconName;
}) {
  return (
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>
        )}
      </div>
    </Card>
  );
}

export function MasterCustomer() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const customersQ = useCustomerList();
  const rows = useMemo<CustomerRow[]>(
    () => (customersQ.data ?? []).map(toCustomerRow),
    [customersQ.data],
  );

  const recordsUnit = tp(customerStrings.unitRecords as PhraseKey);

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), t("ar.fldCustomer")]}
      title={t("customer.title")}
      subtitle={t("customer.subtitle")}
      actions={
        <>
          <Btn
            kind="outline"
            size="md"
            icon="download"
            onClick={() => ctx.notify(t("customer.notifyExport"))}
          >
            {/* exact prototype label "Export" — reuse of the same-file vendor key until a
                customer.btnExport is minted (common.export is a different word, not "Export"). */}
            {t("vendor.btnExport")}
          </Btn>
          {/* Honest-DISABLED: POST /customers is not registered (a 404) — no functional add. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("customer.btnAdd")}
          </Btn>
        </>
      }
    >
      {/* KPI cards (master-party.jsx:214-219). kpiTotal is REAL; person/corp + total-value have
          no wire field (type / value) -> literal em-dash (labels kept, never fabricated). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <PartyKpi
          label={t("customer.kpiTotal")}
          value={String(customerCount(rows))}
          unit={recordsUnit}
          accent="var(--brand)"
          icon="users"
        />
        <PartyKpi
          label={t("customer.kpiPersonCorp")}
          value={DASH}
          unit={recordsUnit}
          accent="var(--info)"
          icon="user"
        />
        <PartyKpi
          label={t("customer.kpiTotalValue")}
          value={DASH}
          unit={tp(customerStrings.unitMillionBaht as PhraseKey)}
          accent="#B45309"
          icon="cash"
        />
      </div>

      <Card pad={0}>
        <div style={{ overflowX: "auto" }}>
          {customersQ.isLoading ? (
            // Loading skeleton — token blocks, no invented copy (mirror master-cc / master-vendor).
            <div style={{ padding: 20 }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 44,
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th(90)}>{tp(customerStrings.thCode as PhraseKey)}</th>
                  <th scope="col" style={th()}>{t("customer.thName")}</th>
                  <th scope="col" style={th(110)}>{tp(customerStrings.thType as PhraseKey)}</th>
                  {/* tax-id header: exact-value reuse until a customer.thTaxId is minted. */}
                  <th scope="col" style={th(130)}>{t("vendor.thTaxId")}</th>
                  <th scope="col" style={th(180)}>{t("customer.thProjectUnit")}</th>
                  <th scope="col" style={{ ...th(120), textAlign: "right" }}>
                    {tp(customerStrings.thValue as PhraseKey)}
                  </th>
                </tr>
              </thead>
              {/* Empty tbody when the catalogue is empty = the table's empty state (no invented
                  copy), mirroring master-cc / master-vendor. */}
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                    {/* code — no wire field -> em-dash (B-135). */}
                    <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                      {DASH}
                    </td>
                    {/* name — wire-backed. */}
                    <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                    {/* type — no wire field -> em-dash. */}
                    <td style={td}>{DASH}</td>
                    {/* tax id — wire-backed. */}
                    <td style={td} className="num">
                      {c.taxId || DASH}
                    </td>
                    {/* project / unit (+ addr sub-line) — no wire field -> em-dash. */}
                    <td style={td}>{DASH}</td>
                    {/* value — no wire field -> em-dash (right-aligned, class num). */}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">
                      {DASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </Page>
  );
}
