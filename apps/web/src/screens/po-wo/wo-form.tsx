/*
 * WOForm — the full-page "create WO" screen (route id `wo.form`, EXTRA_ROUTES),
 * ported from pototype/po-wo.jsx WOForm (L433-465). This is the full-page sibling of
 * POForm (`po.form`); it is DISTINCT from the WOCreateForm modal (wo-create-form.tsx,
 * a forms.jsx port opened from the WO list). Both create a WO through the same real
 * contract — this one is the routed page the prototype's `wo.form` navigation targets.
 *
 * Design fidelity (§0 rule 1): the prototype's Page (breadcrumbs procurement · WO ·
 * "create new" + back/submit-for-approval actions), the WO-number + draft-badge header,
 * and the 4-column meta field grid (doc date · start · deliver · subcontractor · scope
 * span-4 · contract value · deposit · retention · warranty) are reproduced 1:1.
 *
 * i18n (§0 rule 2): every visible string resolves to an EXISTING i18n-full.json key —
 * dict via t() (nav.sec.proc, wo.form.*, po.list.colRefPr, pr.form.back = the back label,
 * common.submit = the submit-for-approval label), phrases via tp() (po-wo-strings.json), the
 * WO nav crumb via tn(). No Thai literal lives in this source; the baht unit is a U+0E3F
 * escape and "Retention" is the prototype's verbatim ASCII label. No new key was needed.
 *
 * Data / money=SERVER (§0 rule 3): the mock is a static form — here the server is the
 * system of record. The subcontractor picker is GET /vendors; the source-PR picker is
 * GET /pr (approved only). "Send for approval" runs the real two-step the prototype
 * implied: POST /wo (draft) then POST /wo/{id}/submit (draft -> pending), reusing the
 * shared use-po-wo hooks. The web sends only ids + user-entered fields (pr_id, vendor_id,
 * value, retention_pct); the server owns status, approval_step, the doc number, and every
 * DERIVED figure (retention_amount = value × retention_pct / 100 — wo.ts). No computed
 * money is shown on this create page.
 *
 * WIRE GAPS (reported honestly — em-dash, disabled):
 *   - PR picker is ADDED (a divergence forced by the wire: POST /wo REQUIRES an approved
 *     pr_id — wo.ts — yet the prototype WOForm has no PR field). Placed as a full-width
 *     row atop the grid so the prototype's 3 field rows stay pixel-faithful.
 *   - Doc date / start work / deliver work / scope / deposit% / warranty have NO wo column
 *     (wo.ts GAP 1: deposit stays presentational; scope is derived server-side from the
 *     source PR's title). They render disabled with an em-dash — shown for fidelity, never
 *     captured. The WO number is server-assigned on save (em-dash until then).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Card } from "../../ui/card";
import { Field } from "../../ui/field";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { usePrList, useCreateWo, useSubmitWo } from "./use-po-wo";
import { toPrRef, toVendorRef, approvedPrs, vendorNameById, statusTone } from "./po-wo-rows";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
/** The prototype's verbatim ASCII "Retention" field label (no Thai key). */
const RETENTION_LABEL = "Retention";
/** THAI BAHT SIGN (U+0E3F) via unicode escape (i18n-guard-safe, po-list.tsx). */
const BAHT = "\u0E3F";
/** Em-dash (U+2014) — the house wire-gap marker (po-wo-rows / ap-billing DASH). */
const DASH = "—";

/** Input style, mirrored from po-create-form / gr-create-form fieldStyle. */
function fieldStyle(): CSSProperties {
  return {
    width: "100%",
    height: 36,
    padding: "0 10px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--surface)",
    outline: "none",
    fontFamily: "inherit",
    color: "var(--text)",
  };
}

/** A non-persisted field: disabled input showing an em-dash (honest wire gap). */
function gapInputStyle(): CSSProperties {
  return {
    ...fieldStyle(),
    background: "var(--surface-2)",
    color: "var(--text-3)",
    cursor: "not-allowed",
  };
}

/** Parse a grouped/decimal money input ("2,150,000") to a finite number (0 fallback). */
function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** A real numeric input with a trailing unit suffix (baht / percent), prototype-faithful. */
function SuffixInput({
  value,
  onChange,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        className="num"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        style={{ ...fieldStyle(), paddingRight: 30 }}
      />
      <span
        style={{
          position: "absolute",
          right: 12,
          top: 0,
          height: 36,
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          color: "var(--text-3)",
          pointerEvents: "none",
        }}
      >
        {suffix}
      </span>
    </div>
  );
}

/** Draft StatusBadge (ds.jsx L91-108, size sm) — mirrors the wo-list local badge. */
function DraftBadge({ label }: { label: string }) {
  const s = statusTone("draft");
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
      {label}
    </span>
  );
}

export function WOForm() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const prQ = usePrList();
  const vendorQ = useVendorList();
  const createWo = useCreateWo();
  const submitWo = useSubmitWo();

  const prOpts = useMemo(() => approvedPrs((prQ.data ?? []).map(toPrRef)), [prQ.data]);
  const vendors = useMemo(() => (vendorQ.data ?? []).map(toVendorRef), [vendorQ.data]);
  const vendorNames = useMemo(() => vendorNameById(vendors), [vendors]);

  const [prId, setPrId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [value, setValue] = useState("");
  const [retentionPct, setRetentionPct] = useState("");

  const effectivePrId = prId || prOpts[0]?.id || "";
  const effectiveVendorId = vendorId || vendors[0]?.id || "";

  const busy = createWo.isPending || submitWo.isPending;
  const canSubmit = !!effectivePrId && !!effectiveVendorId && !busy;

  const submit = () => {
    if (!effectivePrId || !effectiveVendorId) return;
    const retention = Number.parseFloat(retentionPct);
    createWo.mutate(
      {
        pr_id: effectivePrId,
        vendor_id: effectiveVendorId,
        value: parseAmount(value),
        retention_pct: Number.isFinite(retention) && retention >= 0 ? retention : 0,
      },
      {
        onSuccess: (created) => {
          const c = created as Record<string, unknown>;
          const id = typeof c.id === "string" ? c.id : "";
          const done = () => {
            ctx.notify(t("wo.form.createdToast"));
            ctx.navigate("wo.list");
          };
          if (id) submitWo.mutate(id, { onSuccess: done, onError: done });
          else done();
        },
      },
    );
  };

  return (
    <Page
      breadcrumbs={[
        t("nav.sec.proc"),
        tn(poWoStrings.navWoList as NavKey),
        t("wo.form.breadcrumbNew"),
      ]}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="md" icon="chevL" onClick={() => ctx.navigate("wo.list")}>
            {t("pr.form.back")}
          </Btn>
          <Btn kind="primary" size="md" icon="check" onClick={submit} disabled={!canSubmit}>
            {t("common.submit")}
          </Btn>
        </div>
      }
    >
      <Card pad={20}>
        {/* WO number is server-assigned on save (em-dash) + the server-owned draft badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <h2 className="num" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {DASH}
          </h2>
          <DraftBadge label={tp(P("statusDraft"))} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {/* Source PR — ADDED (wire-forced: POST /wo requires an approved pr_id) */}
          <Field label={t("po.list.colRefPr")} required style={{ gridColumn: "span 4" }}>
            {prOpts.length === 0 ? (
              <select style={fieldStyle()} disabled>
                <option value="">{t("common.all")}</option>
              </select>
            ) : (
              <select
                value={effectivePrId}
                onChange={(e) => setPrId(e.target.value)}
                style={fieldStyle()}
              >
                {prOpts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.no}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Doc date / start / deliver — no wo column (wo.ts GAP 1): presentational */}
          <Field label={tp(P("docDate"))}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>
          <Field label={tp(P("startWork"))}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>
          <Field label={t("wo.form.deliverWork")}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>

          {/* Subcontractor — REAL (vendor_id) */}
          <Field label={tp(P("thSubcon"))} required>
            <select
              value={effectiveVendorId}
              onChange={(e) => setVendorId(e.target.value)}
              style={fieldStyle()}
            >
              {vendors.length === 0 && <option value="">{t("common.all")}</option>}
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorNames.get(v.id)}
                </option>
              ))}
            </select>
          </Field>

          {/* Scope — derived server-side from the source PR's title (wo.ts): presentational */}
          <Field label={tp(P("thScope"))} style={{ gridColumn: "span 4" }}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>

          {/* Contract value — REAL (value; user-entered per wo.ts) */}
          <Field label={tp(P("contractValue"))} required>
            <SuffixInput value={value} onChange={setValue} suffix={BAHT} />
          </Field>
          {/* Deposit % — not persisted (wo.ts GAP 1): presentational */}
          <Field label={tp(P("thDeposit"))}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>
          {/* Retention % — REAL (retention_pct) */}
          <Field label={RETENTION_LABEL}>
            <SuffixInput value={retentionPct} onChange={setRetentionPct} suffix="%" />
          </Field>
          {/* Warranty period — no wo column: presentational */}
          <Field label={t("wo.form.warrantyPeriod")}>
            <input value={DASH} disabled readOnly style={gapInputStyle()} />
          </Field>
        </div>
      </Card>
    </Page>
  );
}
