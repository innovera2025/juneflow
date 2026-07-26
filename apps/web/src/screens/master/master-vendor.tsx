/*
 * MasterVendor — the Vendor / Subcon master screen, ported 1:1 from
 * pototype/master-party.jsx MasterVendor (L56-135) + PartyKpi (L36-50). Route master.vendor,
 * visual-gate reference tests/visual/reference/gallery/g2/30.
 *
 * Design fidelity (PLAN.md §0 rule 1): the two-crumb breadcrumb, the title/subtitle, the
 * Export + add-vendor actions, the four KPI cards, the five filter tabs (all / material /
 * contractor / service / land) + search, and the full-width table (code · name+addr/bank ·
 * type tag · tax-id · credit-term · right-aligned spend · status badge · row menu) are the
 * prototype's, verbatim. Tag / StatusBadge / th() / td() reproduce the ds.jsx primitives
 * inline (color-mix + #fff literals are prototype-verbatim, B-037(a)); tokens back every
 * other colour (rule 6). Numeric cells carry class `num` (rule 7).
 *
 * Mock mechanics dropped (rule 3): the prototype's VENDOR_SEED local state + window.VENDOR_SEED
 * become the real server catalogue (GET /vendors, use-vendors.ts); create is POST /vendors and
 * edit is PUT /vendors/{id} (the form maps its 4-way type to the 2-way `kind` first, B-070).
 *
 * Two schema realities are surfaced honestly (B-070 / B-071), never faked:
 *   - TYPE badge + tab counts are display-derived from `kind` (vendor-rows.displayType): every
 *     wire row is "material" (supplier) or "contractor" (subcon); the "service"/"land" tabs
 *     therefore read 0 under the 2-way schema.
 *   - SPEND has no wire field (no AP source yet) — the spend column (vendor.thSpend) and the
 *     cumulative-spend KPI (vendor.kpiSpend) render the literal em-dash "—" rather than a
 *     fabricated number.
 *
 * i18n (rule 2): navTitle is the vendor nav key (tn); every other string is a
 * vendor.* / common.* dict key (t) or a phrase (tp) sourced from vendor-strings.json — no Thai
 * literal sits in this source.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import type { components } from "@juneflow/contracts";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toVendorRow,
  filterVendors,
  typeCount,
  vendorStats,
  displayType,
  creditTermKey,
  statusTone,
  addrBankLine,
  type VendorRow,
  type VendorTypeKey,
} from "./vendor-rows";
import { useVendorList, useCreateVendor, useUpdateVendor } from "./use-vendors";
import { VendorForm, type VendorDraft } from "./vendor-form";
import vendorStrings from "./vendor-strings.json" with { type: "json" };

type Entity = components["schemas"]["Entity"];

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

/** Tag, ported 1:1 from ds.jsx Tag() (L273-280). color-mix + white are prototype-verbatim. */
function Tag({ children, tone = "var(--text-2)" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** StatusBadge size="sm", ported 1:1 from ds.jsx StatusBadge() (L93-135); dot hex verbatim. */
function StatusBadge({ status, children }: { status: string; children: ReactNode }) {
  const s = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {children}
    </span>
  );
}

/** PartyKpi, ported 1:1 from master-party.jsx PartyKpi (L36-50). color-mix + white verbatim. */
function PartyKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
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
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function MasterVendor() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const vendorsQ = useVendorList();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();

  const rows = useMemo<VendorRow[]>(
    () => (vendorsQ.data ?? []).map(toVendorRow),
    [vendorsQ.data],
  );

  const [q, setQ] = useState("");
  const [type, setType] = useState<VendorTypeKey | "">("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const stats = vendorStats(rows);
  const list = filterVendors(rows, q, type);

  const navTitle = tn(vendorStrings.navTitle as NavKey);
  const materialBadge = tp(vendorStrings.typeMaterialBadge as PhraseKey);
  const contractorBadge = tp(vendorStrings.typeContractorBadge as PhraseKey);
  const recordsUnit = tp(vendorStrings.unitRecords as PhraseKey);
  const activeWord = tp(vendorStrings.statusActive as PhraseKey);

  // Credit-term (days) -> display label. "none" (null / out-of-set) -> literal em-dash (B-071).
  const termLabel = (days: number | null): string => {
    switch (creditTermKey(days)) {
      case "cash":
        return tp(vendorStrings.termCash as PhraseKey);
      case "d15":
        return t("vendor.term15");
      case "d30":
        return t("vendor.term30");
      case "d45":
        return t("vendor.term45");
      case "d60":
        return t("vendor.term60");
      default:
        return "—";
    }
  };

  // Filter tabs (master-party.jsx:91): [derived-type value, label, count].
  const tabs: readonly { value: VendorTypeKey | ""; label: string; count: number }[] = [
    { value: "", label: t("common.all"), count: rows.length },
    { value: "material", label: t("vendor.typeMaterial"), count: typeCount(rows, "material") },
    {
      value: "contractor",
      label: tp(vendorStrings.tabContractor as PhraseKey),
      count: typeCount(rows, "contractor"),
    },
    {
      value: "service",
      label: tp(vendorStrings.tabService as PhraseKey),
      count: typeCount(rows, "service"),
    },
    { value: "land", label: t("vendor.tabLand"), count: typeCount(rows, "land") },
  ];

  // add / edit vendor (master-party.jsx:68-76): open the form modal; on submit fire the
  // create (POST) or update (PUT) mutation + the toast, then close.
  const openForm = (preset: VendorRow | null) => {
    ctx.openModal({
      title: preset
        ? t("vendor.modalEditTitle").replace("{code}", preset.code)
        : t("vendor.modalAddTitle"),
      subtitle: preset ? t("vendor.modalEditSubtitle") : t("vendor.modalAddSubtitle"),
      icon: preset ? "edit" : "plus",
      iconTone: "var(--brand)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <VendorForm
          preset={preset}
          onClose={close}
          onSubmit={(draft: VendorDraft) => {
            // Compose the opaque /vendors body: kind is already mapped from the 4-way type
            // (B-070); blank free-text fields become null; credit_term is days-or-null; spend
            // is never sent (no wire field, B-071).
            const body = {
              code: draft.code || null,
              name: draft.name,
              kind: draft.kind,
              tax_id: draft.taxId || null,
              credit_term: draft.creditTerm,
              addr: draft.addr || null,
              bank: draft.bank || null,
              status: draft.status,
            } as Entity;
            if (preset) {
              updateVendor.mutate(
                { id: preset.id, body },
                {
                  onSuccess: () =>
                    ctx.notify(t("vendor.toastSaved").replace("{code}", draft.code)),
                },
              );
            } else {
              createVendor.mutate(body, {
                onSuccess: () =>
                  ctx.notify(
                    t("vendor.toastAdded")
                      .replace("{name}", draft.name)
                      .replace("{code}", draft.code),
                  ),
              });
            }
            close();
          }}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("master.breadcrumb"), navTitle]}
      title={t("vendor.title")}
      subtitle={t("vendor.subtitle")}
      actions={
        <>
          <Btn
            kind="outline"
            size="md"
            icon="download"
            onClick={() => ctx.notify(t("vendor.notifyExport"))}
          >
            {t("vendor.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => openForm(null)}>
            {t("vendor.btnAddVendor")}
          </Btn>
        </>
      }
    >
      {/* KPI cards (master-party.jsx:82-87). Spend KPI shows "—" (no AP source, B-071). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <PartyKpi
          label={t("vendor.kpiTotal")}
          value={String(stats.total)}
          unit={recordsUnit}
          sub={t("vendor.kpiSubActive").replace("{count}", String(stats.active))}
          accent="var(--brand)"
          icon="users"
        />
        <PartyKpi
          label={t("vendor.kpiMaterialContractor")}
          value={String(stats.materialOrContractor)}
          unit={recordsUnit}
          accent="var(--info)"
          icon="cart"
        />
        <PartyKpi
          label={t("vendor.kpiSpend")}
          value="—"
          unit={tp(vendorStrings.unitMillionBaht as PhraseKey)}
          sub={t("vendor.kpiSubAllPartners")}
          accent="#B45309"
          icon="cash"
        />
        <PartyKpi
          label={t("vendor.kpiInactive")}
          value={String(stats.inactive)}
          unit={recordsUnit}
          accent="var(--text-3)"
          icon="warn"
        />
      </div>

      <Card pad={0}>
        {/* Filter tabs + search (master-party.jsx:89-98). */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            {tabs.map((tab) => {
              const on = type === tab.value;
              return (
                <button
                  key={tab.value || "all"}
                  type="button"
                  onClick={() => setType(tab.value)}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    background: on ? "var(--brand)" : "var(--surface-2)",
                    color: on ? "#fff" : "var(--text-2)",
                  }}
                >
                  {tab.label}
                  <span className="num" style={{ marginInlineStart: 5, opacity: 0.8 }}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--surface)",
              marginInlineStart: "auto",
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("vendor.searchPlaceholder")}
              style={{
                border: "none",
                outline: "none",
                width: 200,
                fontSize: 12,
                background: "transparent",
                color: "var(--text)",
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          {vendorsQ.isLoading ? (
            // Loading skeleton — token blocks, no invented copy (mirror master-cc).
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
                  <th style={th(90)}>{tp(vendorStrings.thCode as PhraseKey)}</th>
                  <th style={th()}>{t("vendor.thName")}</th>
                  <th style={th(100)}>{tp(vendorStrings.thType as PhraseKey)}</th>
                  <th style={th(130)}>{t("vendor.thTaxId")}</th>
                  <th style={th(110)}>{t("vendor.thTerm")}</th>
                  <th style={{ ...th(120), textAlign: "right" }}>{t("vendor.thSpend")}</th>
                  <th style={th(90)}>{t("common.status")}</th>
                  <th style={th(50)} />
                </tr>
              </thead>
              {/* Empty tbody when the catalogue is empty = the table's empty state (no invented
                  copy), mirroring master-cc / master-model. */}
              <tbody>
                {list.map((v) => {
                  const active = v.status === "active";
                  const typeLabel =
                    displayType(v.kind) === "contractor" ? contractorBadge : materialBadge;
                  const sub = addrBankLine(v.addr, v.bank);
                  return (
                    <tr key={v.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 700, color: "var(--brand)" }} className="num">
                        {v.code}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{v.name}</div>
                        {sub && (
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</div>
                        )}
                      </td>
                      <td style={td}>
                        <Tag tone="var(--text-2)">{typeLabel}</Tag>
                      </td>
                      <td style={td} className="num">
                        {v.taxId}
                      </td>
                      <td style={{ ...td, color: "var(--text-2)" }}>{termLabel(v.creditTerm)}</td>
                      {/* Spend has no wire source (B-071) — honest em-dash, never fabricated. */}
                      <td
                        style={{ ...td, textAlign: "right", fontWeight: 700 }}
                        className="num"
                      >
                        —
                      </td>
                      <td style={td}>
                        <StatusBadge status={v.status}>
                          {active ? activeWord : t("vendor.statusInactive")}
                        </StatusBadge>
                      </td>
                      <td style={{ ...td, position: "relative" }}>
                        <button
                          type="button"
                          onClick={() => setMenuFor(menuFor === v.id ? null : v.id)}
                          style={{
                            width: 28,
                            height: 28,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--surface)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon name="more" size={14} color="var(--text-3)" />
                        </button>
                        {menuFor === v.id && (
                          <>
                            <div
                              onClick={() => setMenuFor(null)}
                              style={{ position: "fixed", inset: 0, zIndex: 20 }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: 32,
                                right: 8,
                                zIndex: 30,
                                width: 140,
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: 4,
                                boxShadow: "0 8px 24px rgba(15,23,42,0.16)",
                              }}
                            >
                              <div
                                onClick={() => {
                                  setMenuFor(null);
                                  openForm(v);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 9,
                                  padding: "8px 10px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  fontSize: 12.5,
                                }}
                              >
                                <Icon name="edit" size={13} color="var(--text-2)" /> {t("common.edit")}
                              </div>
                              <div
                                onClick={() => {
                                  setMenuFor(null);
                                  ctx.notify(t("vendor.notifyHistory").replace("{name}", v.name));
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 9,
                                  padding: "8px 10px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  fontSize: 12.5,
                                }}
                              >
                                <Icon name="history" size={13} color="var(--text-2)" />{" "}
                                {t("vendor.menuHistory")}
                              </div>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </Page>
  );
}
