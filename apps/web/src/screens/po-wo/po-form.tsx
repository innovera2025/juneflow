/*
 * POForm — the "create PO from an approved PR" PAGE, ported 1:1 from pototype/po-wo.jsx
 * POForm (L216-262). Route po.form (docs/extract/NAV-ROUTES.md L127, component POForm,
 * mod proc), a navigate-in page (registry.ts:209). This is the full-page create form; the
 * separate po-create-form.tsx (POCreateForm) is the list's quick-create MODAL (a different
 * prototype source, forms.jsx) — the two coexist.
 *
 * Design fidelity (PLAN.md §0 rule 1): the Page (breadcrumbs proc-section / po.list nav /
 * po.form.breadcrumbNew + back/save-draft/submit action bar), the doc-header (PO no + draft
 * badge), the repeat(4,1fr) 8-field meta grid, the accent-soft "deduct-from-PR" info line,
 * and the "items pulled from PR" card are the prototype's, reproduced via <Page> (the po-list
 * precedent).
 *
 * Data (rule 3/4 — money=SERVER, po-form-rows.ts): the prototype's mocked single doc
 * (PO-2026-0292 / a Thai doc-date / Net 30 / 902,475 THB / 4-line items) is DROPPED. Only real
 * wire fields render; every field with no create-body source is honest em-dash / disabled,
 * NEVER fabricated:
 *   - REAL: the ref-PR field (po.list.colRefPr) = the approved-PR picker (usePrList ->
 *     approvedPrs -> pr_id); the vendor field = the vendor picker (useVendorList -> vendor_id).
 *     These are the ONLY two values POST /po receives (buildCreatePoBody).
 *   - DISPLAY-only: the info line's PR no + PR amount come straight off the selected PR row
 *     (server-owned) — never client-computed into the POST; em-dash before a PR is chosen.
 *   - WIRE GAPS (no create-body counterpart -> disabled + em-dash): the new PO no (server-
 *     assigned on create), doc date, delivery date, payment terms, down-payment%, delivery
 *     location, VAT/WHT, and the items line-count. The add-line button is honest-disabled —
 *     the server pulls the lines from the source PR (po.ts), the web sends no line math.
 * Actions: save-draft (common.saveDraft) -> POST /po (draft stays draft); submit
 * (common.submit) -> POST /po then POST /po/{id}/submit (draft -> pending) — the prototype's
 * "create + send-for-approval". Both navigate back to po.list on success. The server owns the
 * total (seeded from the PR).
 *
 * i18n (rule 2): every string is a po.form.* / po.list.* / common.* / nav.sec.proc dict key
 * (t), the navPoList nav label (tn), or a po-wo-strings.json phrase (tp) — all already in
 * i18n-full.json (CONSUME-ONLY, zero mint). No Thai literal sits in this source; tokens back
 * every colour (rule 6); numeric cells carry class `num` (rule 7).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useVendorList } from "../master/use-vendors";
import { usePrList, useCreatePo, useSubmitPo } from "./use-po-wo";
import { approvedPrs, toPrRef, toVendorRef, vendorNameById, statusTone, formatMoney } from "./po-wo-rows";
import { buildCreatePoBody, canCreatePo } from "./po-form-rows";
import poWoStrings from "./po-wo-strings.json" with { type: "json" };

/** po-wo-strings.json phrase-key accessor (Thai lives in the .json; the guard skips .json). */
const P = (k: keyof typeof poWoStrings) => poWoStrings[k] as PhraseKey;
/** Honest placeholder for any field with no create-body / wire source (rule 3 / C10). */
const DASH = "—";

/** Native <select> / display-box style, mirrored from po-create-form fieldStyle(). */
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

/** StatusBadge (ds.jsx L91-108), used in the doc-header — here always the draft tone. */
function StatusBadge({ status, label }: { status: string; label: string }) {
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
      {label}
    </span>
  );
}

/**
 * Read-only display box (pr-form.jsx Input in its readOnly form). Every mock-only field with
 * no create-body counterpart renders here em-dashed + `muted`; disabled so it reads as
 * honest-inert, never a fabricated editable value.
 */
function DisplayInput({ value, mono, suffix }: { value: string; mono?: boolean; suffix?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 36,
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--surface-2)",
      }}
    >
      <span
        className={mono ? "num" : undefined}
        style={{
          flex: 1,
          fontSize: 13,
          color: "var(--text-3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      {suffix && <span style={{ marginLeft: 6, color: "var(--text-3)" }}>{suffix}</span>}
    </div>
  );
}

export function POForm() {
  const { t, tp, tn } = useI18n();
  const ctx = useShellCtx();

  const prQ = usePrList();
  const vendorQ = useVendorList();
  const createPo = useCreatePo();
  const submitPo = useSubmitPo();

  // Only approved PRs may raise a PO (POST /po 409s otherwise) — the real picker set.
  const prOpts = useMemo(() => approvedPrs((prQ.data ?? []).map(toPrRef)), [prQ.data]);
  const vendors = useMemo(() => (vendorQ.data ?? []).map(toVendorRef), [vendorQ.data]);
  const vendorNames = useMemo(() => vendorNameById(vendors), [vendors]);

  const [prId, setPrId] = useState("");
  const [vendorId, setVendorId] = useState("");

  const effectivePrId = prId || prOpts[0]?.id || "";
  const effectiveVendorId = vendorId || vendors[0]?.id || "";
  const selectedPr = prOpts.find((p) => p.id === effectivePrId);

  const busy = createPo.isPending || submitPo.isPending;
  const canCreate = canCreatePo(effectivePrId, effectiveVendorId, busy);

  const back = () => ctx.navigate("po.list");

  /**
   * save-draft — persist the PO as a draft (POST /po only) and STAY on the page (toast only),
   * faithful to the prototype (po-wo.jsx:223 toasts + stays so the user can then submit). Only
   * the submit action navigates away.
   */
  const saveDraft = () => {
    if (!canCreate) return;
    createPo.mutate(buildCreatePoBody(effectivePrId, effectiveVendorId), {
      onSuccess: () => {
        ctx.notify(tp(P("savedDraftToast")));
      },
    });
  };

  /** submit — create then submit (POST /po -> POST /po/{id}/submit): draft -> pending. */
  const submitForApproval = () => {
    if (!canCreate) return;
    createPo.mutate(buildCreatePoBody(effectivePrId, effectiveVendorId), {
      onSuccess: (created) => {
        const c = created as Record<string, unknown>;
        const id = typeof c.id === "string" ? c.id : "";
        const done = () => {
          ctx.notify(t("po.form.createdToast"));
          ctx.navigate("po.list");
        };
        if (id) submitPo.mutate(id, { onSuccess: done, onError: done });
        else done();
      },
    });
  };

  // Info line — {pr} + {amount} are DISPLAY-only, read off the selected PR row (server-owned).
  // The prototype bolds ONLY the amount (<b className="num">…</b>); split the template on
  // {amount} so just the number carries bold + tabular figures, the surrounding text stays plain.
  const amountStr = selectedPr ? formatMoney(selectedPr.amount) : DASH;
  const [deductPre, deductPost = ""] = t("po.form.deductInfo")
    .replace("{pr}", selectedPr?.no || DASH)
    .split("{amount}");

  return (
    <Page
      breadcrumbs={[t("nav.sec.proc"), tn(poWoStrings.navPoList as NavKey), t("po.form.breadcrumbNew")]}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="md" icon="chevL" onClick={back}>
            {/* pr.form.back is the value-correct "back" label (common.back resolves to a
                different Thai value); no po.form.back key exists and i18n-full.json is sacred. */}
            {t("pr.form.back")}
          </Btn>
          <Btn kind="outline" size="md" onClick={saveDraft} disabled={!canCreate}>
            {t("common.saveDraft")}
          </Btn>
          <Btn kind="primary" size="md" icon="check" onClick={submitForApproval} disabled={!canCreate}>
            {t("common.submit")}
          </Btn>
        </div>
      }
    >
      <Card pad={20}>
        {/* Doc header — the new PO no is server-assigned on create -> em-dash; status = draft. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <h2 className="num" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {DASH}
          </h2>
          <StatusBadge status="draft" label={tp(P("statusDraft"))} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {/* WIRE GAP: no doc-date on the create body -> disabled em-dash. */}
          <Field label={tp(P("docDate"))} required>
            <DisplayInput value={DASH} suffix={<Icon name="calendar" size={13} />} />
          </Field>
          {/* WIRE GAP: no delivery-date on the create body -> disabled em-dash. */}
          <Field label={t("po.form.deliveryDate")} required>
            <DisplayInput value={DASH} suffix={<Icon name="calendar" size={13} />} />
          </Field>
          {/* REAL: approved-PR picker -> pr_id. */}
          <Field label={t("po.list.colRefPr")} required>
            <select value={effectivePrId} onChange={(e) => setPrId(e.target.value)} style={fieldStyle()}>
              {prOpts.length === 0 && <option value="">{DASH}</option>}
              {prOpts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.no}
                </option>
              ))}
            </select>
          </Field>
          {/* REAL: vendor picker -> vendor_id (name resolved, never a raw uuid). */}
          <Field label={tp(P("vendorField"))} required>
            <select value={effectiveVendorId} onChange={(e) => setVendorId(e.target.value)} style={fieldStyle()}>
              {vendors.length === 0 && <option value="">{DASH}</option>}
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorNames.get(v.id)}
                </option>
              ))}
            </select>
          </Field>
          {/* WIRE GAP: payment terms not sent (credit_term has no clean form source) -> em-dash. */}
          <Field label={t("po.form.paymentTerms")} required>
            <DisplayInput value={DASH} />
          </Field>
          {/* WIRE GAP: deposit not persisted (po.ts GAP) -> em-dash. */}
          <Field label={t("po.form.downPmt")}>
            <DisplayInput value={DASH} mono suffix="%" />
          </Field>
          {/* WIRE GAP: delivery location has no schema column -> em-dash. */}
          <Field label={tp(P("deliveryLocation"))}>
            <DisplayInput value={DASH} />
          </Field>
          {/* WIRE GAP: VAT/WHT not sent (vat has no clean form source) -> em-dash. */}
          <Field label={t("po.form.vatWht")}>
            <DisplayInput value={DASH} />
          </Field>
        </div>

        {/* Deduct-from-PR info line (accent-soft). The amount is the real PR total (display-only). */}
        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: "var(--accent-soft)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--text-2)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Icon name="info" size={15} color="var(--accent)" />
          <span>
            {deductPre}
            <b className="num">{amountStr}</b>
            {deductPost}
          </span>
        </div>
      </Card>

      {/* Items — the server pulls the lines from the source PR (no client line math). */}
      <Card pad={0} style={{ marginTop: 16 }}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {t("po.form.itemsTitle")}{" "}
            {/* WIRE GAP: the PR line-count is not on the list wire -> em-dash the {n}. */}
            <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
              {t("po.form.itemsFromPr").replace("{n}", DASH)}
            </span>
          </div>
          {/* add-line: no PO create-line endpoint (server seeds from the PR) -> honest-disabled. */}
          <Btn kind="ghost" size="sm" icon="plus" disabled>
            {tp(P("addBtn"))}
          </Btn>
        </div>
        <div style={{ padding: 18, color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
          {t("po.form.itemsNote")}
        </div>
      </Card>
    </Page>
  );
}
