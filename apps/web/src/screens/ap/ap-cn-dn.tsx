/*
 * APCreditDebit — the AP Credit/Debit Note register (ap.cn-dn), ported from pototype/ap.jsx
 * APCreditDebit (L321-382) + CNDNForm (L486-518, in cndn-form.tsx). Route ap.cn-dn
 * (docs/extract/NAV-ROUTES.md L70, component APCreditDebit, section "acct"). Mirrors the AP finance
 * siblings ap-billing.tsx (MiniKpi + StatusBadge tokens, create-modal wiring) and the AR credit-note
 * lane ar-cn.tsx (list + KPI strip + generated-client/unwrap).
 *
 * Design fidelity (§0 rule 1): the three-part breadcrumb (finance · AP · CN/DN), the title/subtitle,
 * the two create header actions (btnDn DN outline + btnCn CN primary), the 3-card MiniKpi strip,
 * and the 7-column register (type badge · no · ref-AP · vendor/reason · signed value · date · status)
 * are the prototype's. The two create buttons open the CNDNForm modal (a real POST /ap/cn | /ap/dn).
 *
 * Data (rule 3): GET /ap/cn + GET /ap/dn (use-ap-cndn.ts) via the generated client, combined + sorted
 * newest-first (ap-cn-dn-rows.ts, unit-tested G3) — the prototype's local mixed CN/DN array becomes
 * the two real server catalogues. Vendor names resolve from GET /vendors; the referenced AP billing
 * resolves from GET /ap/billing (both real).
 *
 * MONEY AUTHORITY (B-231 · money=SERVER · Model-A no-VAT):
 *   - the signed value column is a DISPLAY derivation (signedValue: CN reduces AP -> negative/green,
 *     DN increases AP -> positive/red) of the server-authoritative `amount`; the KPI amounts + net-AP
 *     are real sums off the loaded rows — never a client JV or balance.
 *   - a note posts its balanced 2-line JV ONLY on approve (server-side, idempotent). The register
 *     itself posts nothing.
 *
 * APPROVE-AFFORDANCE (design fidelity — reported): the prototype register has NO approve button (it
 * ends in a status badge, no action column). Per the ap.pv precedent, useApproveApCn/Dn are wired +
 * typed (use-ap-cndn.ts) but deliberately NOT surfaced here — adding one would violate §0 and fail
 * the visual gate. The status badge reflects the REAL stored status (an honest un-flipped gap: the
 * handlers never set/flip `status`, so a fresh note reads "draft").
 *
 * REAL vs em-dash (honest, never fabricated) — see ap-cndn.ts noteWire:
 *   - type / no / amount / status -> REAL wire fields (amount is the positive magnitude; the sign +
 *     tone are derived). A null `no` / status em-dashes / renders "draft".
 *   - vendor -> the wire carries a UUID; the name is RESOLVED via the vendors map -> em-dash unresolved.
 *   - ref-AP -> the wire carries ref_ap_id; the referenced billing is RESOLVED via the ap_billing map
 *     (ap_billing has no doc-number, so the label is invoice_no / vendor_name) -> em-dash unresolved.
 *   - reason -> REAL where present, em-dash on null. date -> REAL note_date/created_at (UTC).
 *
 * i18n (rule 2): every string resolves via tp() from ap-cn-dn-strings.json (PHRASES layer) plus the
 * shared DICT keys common.status + fin.statusApproved/Pending/Draft (value-identical reuse, ar-cn
 * precedent). Tokens back every colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { toVendorRow } from "../master/vendor-rows";
import { useApBillingList } from "./use-ap";
import { useApCnList, useApDnList } from "./use-ap-cndn";
import { CNDNForm } from "./cndn-form";
import {
  apBillingLabel,
  combineNotes,
  formatSignedMoney,
  formatDate,
  noteKpis,
  signedValue,
  statusKind,
  statusTone,
  toApBillingPick,
  valueTone,
  type NoteKind,
  type NoteRow,
  type NoteStatusKind,
} from "./ap-cn-dn-rows";
import strings from "./ap-cn-dn-strings.json" with { type: "json" };

const DASH = "—";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (same as ap-billing). */
function MiniKpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
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
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** Type badge (ap.jsx L363-367): CN -> ok-tinted (badgeCn); DN -> danger-tinted (badgeDn). */
function TypeBadge({ kind, label }: { kind: NoteKind; label: string }) {
  const cn = kind === "CN";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 4,
        background: cn ? "var(--ok-soft)" : "var(--danger-soft)",
        color: cn ? "var(--ok)" : "var(--danger)",
      }}
    >
      {label}
    </span>
  );
}

/** StatusBadge (ds.jsx L93-108, size sm): tokened bg/fg + verbatim dot. */
function StatusBadge({ kind, label }: { kind: NoteStatusKind; label: string }) {
  const s = statusTone(kind);
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
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}

export function APCreditDebit() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const cnQ = useApCnList();
  const dnQ = useApDnList();
  const vendorsQ = useVendorList();
  const billingQ = useApBillingList();

  const rows = useMemo<NoteRow[]>(
    () => combineNotes(cnQ.data ?? [], dnQ.data ?? []),
    [cnQ.data, dnQ.data],
  );
  const kpis = useMemo(() => noteKpis(rows), [rows]);

  // Resolve vendor_id -> name and ref_ap_id -> ap_billing label (real, from the sibling reads).
  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of (vendorsQ.data ?? []).map(toVendorRow)) {
      if (v.id) m.set(v.id, v.name);
    }
    return m;
  }, [vendorsQ.data]);
  const billingRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of billingQ.data ?? []) {
      const b = toApBillingPick(e as Record<string, unknown>);
      if (b.id) m.set(b.id, apBillingLabel(b));
    }
    return m;
  }, [billingQ.data]);

  const statusLabel = (kind: NoteStatusKind): string => {
    switch (kind) {
      case "approved":
        return t("fin.statusApproved");
      case "pending":
        return t("fin.statusPending");
      default:
        return t("fin.statusDraft");
    }
  };

  const openForm = (kind: NoteKind) => {
    const cn = kind === "CN";
    ctx.openModal({
      title: tp(P(cn ? "modalCnTitle" : "modalDnTitle")),
      subtitle: tp(P(cn ? "modalCnSubtitle" : "modalDnSubtitle")),
      icon: "arrowR",
      iconTone: cn ? "var(--ok)" : "var(--danger)",
      size: "md",
      body: ({ close }: { close: () => void }) => <CNDNForm kind={kind} onClose={close} />,
    });
  };

  const isLoading = cnQ.isLoading || dnQ.isLoading;

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), "AP", tp(P("crumbScreen"))]}
      title={tp(P("title"))}
      subtitle={tp(P("subtitle"))}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="plus" onClick={() => openForm("DN")}>
            {tp(P("btnDn"))}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={() => openForm("CN")}>
            {tp(P("btnCn"))}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (3): CN count + reduction · DN count + increase · net AP after adjustment. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi
          label={tp(P("kpiCnLabel"))}
          value={String(kpis.cnCount)}
          sub={`${formatSignedMoney(-kpis.cnAmount)} ${tp(P("kpiCnSubSuffix"))}`}
          tone="var(--ok)"
          icon="arrowR"
        />
        <MiniKpi
          label={tp(P("kpiDnLabel"))}
          value={String(kpis.dnCount)}
          sub={`${formatSignedMoney(kpis.dnAmount)} ${tp(P("kpiDnSubSuffix"))}`}
          tone="var(--danger)"
          icon="arrowR"
        />
        <MiniKpi
          label={tp(P("kpiNetLabel"))}
          value={formatSignedMoney(kpis.netAp)}
          unit={tp(P("unitBaht"))}
          sub={tp(P("kpiNetSub"))}
          tone="var(--info)"
          icon="ledger"
        />
      </div>

      <Card pad={0}>
        {isLoading ? (
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
                <th scope="col" style={th(80)}>{tp(P("thType"))}</th>
                <th scope="col" style={th(140)}>{tp(P("thNo"))}</th>
                <th scope="col" style={th(140)}>{tp(P("thRefAp"))}</th>
                <th scope="col" style={th()}>{tp(P("thVendorReason"))}</th>
                <th scope="col" style={th(120, true)}>{tp(P("thValue"))}</th>
                <th scope="col" style={th(110)}>{tp(P("thDate"))}</th>
                <th scope="col" style={th(110)}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {DASH}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const sKind = statusKind(r.status);
                  const vendor = vendorName.get(r.vendorId) ?? "";
                  const ref = billingRef.get(r.refApId) ?? "";
                  const value = signedValue(r.kind, r.amount);
                  const date = formatDate(r.noteDate, r.createdAt);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      {/* type: REAL kind (which server list the row came from). */}
                      <td style={td}>
                        <TypeBadge kind={r.kind} label={tp(P(r.kind === "CN" ? "badgeCn" : "badgeDn"))} />
                      </td>
                      {/* no: REAL server-allocated wire field, em-dash on a null. */}
                      <td style={{ ...td, fontWeight: 600, color: "var(--brand)" }} className="num">
                        {r.no || DASH}
                      </td>
                      {/* ref-AP: RESOLVED ap_billing label (invoice_no / vendor_name), em-dash unresolved. */}
                      <td style={td} className="num">
                        {ref ? (
                          <span style={{ color: "var(--brand)" }}>{ref}</span>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>{DASH}</span>
                        )}
                      </td>
                      {/* vendor / reason: RESOLVED name + REAL reason (two-line), em-dash on absence. */}
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>
                          {vendor || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.reason || DASH}</div>
                      </td>
                      {/* value: DISPLAY-signed magnitude (CN negative/green, DN positive/red). */}
                      <td
                        style={{ ...td, textAlign: "right", fontWeight: 700, color: valueTone(r.kind) }}
                        className="num"
                      >
                        {formatSignedMoney(value)}
                      </td>
                      {/* date: REAL note_date/created_at (UTC), em-dash on missing/invalid. */}
                      <td style={{ ...td, fontSize: 11.5, color: "var(--text-3)" }} className="num">
                        {date || DASH}
                      </td>
                      {/* status: REAL stored status (honest gap: never flipped on approve). */}
                      <td style={td}>
                        <StatusBadge kind={sKind} label={statusLabel(sKind)} />
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
