/*
 * PRForm — the Purchase Requisition DETAIL view, ported 1:1 from pototype/pr-form.jsx
 * PRForm (L223-546). Route pr.form (docs/extract/NAV-ROUTES.md L126), reached by
 * navigate-in from pr.list (pr-list.tsx:292 -> ctx.navigate("pr.form", {id, no})). This
 * round's scope is VIEWING an existing PR (GET /pr/{id}, read from ctx.params.id) plus the
 * submit/approve/reject state-machine actions; the no-id create-from-blank BOQ-picker flow
 * is OUT of scope -> a missing id renders an honest "no PR selected" empty state.
 *
 * Design fidelity (PLAN.md §0 rule 1): the TopBar (breadcrumbs + back/history/print), the
 * full-bleed doc-header (PR no + StatusBadge + last-edited + description + tier stepper), the
 * 5 type tabs, the 4-col form grid + description textarea, the items table + totals footer,
 * the attachments/comments pair, the right column (budget bar + approval chain + related
 * docs), and the sticky bottom action bar are the prototype's — reproduced via <TopBar>
 * directly (the boq-editor precedent) so the doc-header + sticky bar stay full-bleed.
 *
 * Data (rule 3/4): the prototype's fully-mocked single doc (ITEMS / APPROVERS / BudgetBar /
 * attachments / comments arrays) is DROPPED — only real wire fields render (use-pr-form.ts
 * usePr(id) + pr-form-rows.ts). WIRE GAPS / mock-only sections are honest-empty / em-dashed,
 * NEVER fabricated (surfaced to Wei):
 *   - project name: the detail wire returns project_id (uuid) only -> client-joined against
 *     GET /projects (resolveProjectName); unresolved -> em-dash (never the raw uuid).
 *   - items name/code/unit/BOQ-badge: pr_item is {pr_id, boq_item_id, qty} + prItemWire
 *     returns {boq_item_id, qty, price, amount} -> no name/code/unit source -> em-dash; the
 *     qty/price/amount are real.
 *   - VAT (7%) + net total: the wire carries only ex-VAT `amount`; client money-math is
 *     forbidden -> both em-dash; only the server `amount` renders (the ex-VAT subtotal).
 *   - approval chain per-person timeline / budget bar used-total / attachments / comments /
 *     related docs: no backing table/wire -> honest-empty (static tier RULE only for the
 *     chain; the one real budget value — this-PR amount — renders, the rest em-dash).
 *   - the Sync panel is OMITTED (no integration-status wire).
 *   - mock-only form fields (urgency / company / requester-dept / cost-center / block / unit
 *     / doc-date / the long reason textarea): no schema column -> disabled + em-dash.
 * Actions (money=SERVER state machine, no JV at PR stage): submit (draft only) / approve /
 * reject (reason REQUIRED) run the real endpoints with honest tiered-403 + 409 toasts; the
 * no-endpoint controls (cancel / save-draft / revise) are disabled. Server `amount` is
 * always rendered — no client money math anywhere.
 *
 * i18n (rule 2): navPr is the PR nav key (tn); every other string is a pr.form.* / common.* /
 * vendor.* / boq.* / subcon.* / nav.sec.proc dict key (t) or a pr-form-strings.json phrase
 * (tp) — no Thai literal sits in this source. Tokens back every colour (rule 6); the type/
 * status dot hexes are prototype-verbatim (B-037(a)). Numeric cells carry class `num` (rule 7).
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { TopBar } from "../../shell/topbar";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { approvalBars, approvalStepLabel } from "./pr-rows";
import {
  toPrDetail,
  requiredTierCount,
  remainingTiers,
  canApprove,
  canReject,
  canSubmit,
  statusTone,
  statusPhraseName,
  resolveProjectName,
  lastEditedDate,
  formatMoney,
  formatDec,
  type PrDetail,
  type PrItem,
} from "./pr-form-rows";
import { usePr, useSubmitPr, useApprovePr, useRejectPr, errMessage } from "./use-pr-form";
import prFormStrings from "./pr-form-strings.json" with { type: "json" };

/** pr-form-strings.json phrase-key accessor. */
const P = (k: keyof typeof prFormStrings) => prFormStrings[k] as PhraseKey;
/** Honest placeholder for any field with no wire source (rule 3 / C10). */
const DASH = "—";

/** The 5 PR type tabs (pr-form.jsx TYPE_TABS L64-70). Presentational in the detail view. */
const TYPE_TABS: readonly { id: string; strKey: keyof typeof prFormStrings; icon: IconName }[] = [
  { id: "material", strKey: "typeMaterial", icon: "box" },
  { id: "subcon", strKey: "typeSubconWo", icon: "hardhat" },
  { id: "expense", strKey: "typeExpense", icon: "cash" },
  { id: "advance", strKey: "typeAdvance", icon: "ledger" },
  { id: "clear", strKey: "typeClear", icon: "check" },
];

/** Items table header cell style (ds.jsx th(), same as pr-list). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "8px 12px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}
/** Items table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px", verticalAlign: "middle" };

/** StatusBadge (ds.jsx L93-135), used in the doc-header. */
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

/** Doc-header tier stepper (pr-list.jsx ApprovalSteps L34-52). */
function DocStepper({ step, total, status }: { step: number; total: number; status: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {approvalBars(step, total, status).map((bg, i) => (
        <div key={i} style={{ width: 18, height: 4, borderRadius: 2, background: bg }} />
      ))}
      <span
        className="num"
        style={{ fontSize: 10.5, color: "var(--text-3)", marginInlineStart: 6, fontWeight: 600 }}
      >
        {approvalStepLabel(step, total, status)}
      </span>
    </div>
  );
}

/** Form field label + control (pr-form.jsx Field L3-13). */
function Field({
  label,
  span = 1,
  children,
}: {
  label: string;
  span?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <label
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--text-2)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Read-only display box (pr-form.jsx Input L15-38 in its readOnly form). Every detail field
 * is either a real value (readonly) or an em-dash (no wire) — both render as a static box;
 * `muted` softens the value colour for the em-dashed / mock-only fields.
 */
function DisplayInput({
  value,
  mono,
  muted,
  suffix,
}: {
  value: string;
  mono?: boolean;
  muted?: boolean;
  suffix?: ReactNode;
}) {
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
          color: muted ? "var(--text-3)" : "var(--text)",
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

/** Info-panel style block header (right column card titles). */
function CardTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{children}</div>;
}

/** The TopBar shell for every PRForm state (loading / no-id / not-found / loaded). */
function PrTopBar({ no, onBack }: { no: string; onBack: () => void }) {
  const { t, tn } = useI18n();
  return (
    <TopBar
      breadcrumbs={[t("nav.sec.proc"), tn(prFormStrings.navPr as NavKey), no]}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="md" icon="chevL" onClick={onBack}>
            {t("pr.form.back")}
          </Btn>
          {/* history + print: no per-doc history endpoint / no print implementation on the
              wire -> honest-DISABLE (B-220), never a fabricated toast. */}
          <Btn kind="ghost" size="md" icon="history" disabled>
            {t("vendor.menuHistory")}
          </Btn>
          <Btn kind="ghost" size="md" icon="print" disabled>
            {t("common.print")}
          </Btn>
        </div>
      }
    />
  );
}

/** Full-height PRForm frame (matches pr-form.jsx L230-231 / the boq-editor precedent). */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {children}
    </div>
  );
}

export function PRForm() {
  const ctx = useShellCtx();
  const id = typeof ctx.params.id === "string" ? ctx.params.id : "";

  const prQ = usePr(id);
  const projectsQ = useProjects();
  const back = () => ctx.navigate("pr.list");

  // No id in ctx.params -> honest "no PR selected" state (the create flow is out of scope).
  if (id === "") {
    return (
      <Frame>
        <PrTopBar no={DASH} onBack={back} />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <Card pad={40} style={{ textAlign: "center" }}>
            <Icon name="doc" size={30} color="var(--text-3)" style={{ opacity: 0.5 }} />
          </Card>
        </div>
      </Frame>
    );
  }

  if (prQ.isLoading) {
    return (
      <Frame>
        <PrTopBar no={DASH} onBack={back} />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16 }}>
            {[0, 1].map((n) => (
              <div
                key={n}
                style={{ height: 260, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        </div>
      </Frame>
    );
  }

  // Query error / 404 -> honest empty state (no fabricated doc).
  if (prQ.isError || !prQ.data) {
    return (
      <Frame>
        <PrTopBar no={DASH} onBack={back} />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <Card pad={40} style={{ textAlign: "center" }}>
            <Icon name="warn" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
          </Card>
        </div>
      </Frame>
    );
  }

  const detail = toPrDetail(prQ.data);
  const projectName = resolveProjectName(detail.projectId, projectsQ.data);
  // key by id so the type-tab local state re-seeds when switching docs.
  return <PrFormBody key={detail.id} detail={detail} projectName={projectName} onBack={back} />;
}

function PrFormBody({
  detail,
  projectName,
  onBack,
}: {
  detail: PrDetail;
  projectName: string;
  onBack: () => void;
}) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const submit = useSubmitPr(detail.id);
  const approve = useApprovePr(detail.id);
  const reject = useRejectPr(detail.id);

  const [typeTab, setTypeTab] = useState(detail.type || "material");

  const tiers = requiredTierCount(detail.amount);
  const isPending = canApprove(detail.status);
  const isDraft = canSubmit(detail.status);
  const busy = submit.isPending || approve.isPending || reject.isPending;

  /** Honest error toast — surfaces the server's tiered-403 / 409 / 400 message (never success). */
  const onErr = (err: unknown) => ctx.notify(errMessage(err) || DASH, "danger");

  const doApprove = () => approve.mutate(undefined, { onError: onErr });
  const doSubmit = () => submit.mutate(undefined, { onError: onErr });
  const openReject = () => {
    ctx.openModal({
      title: t("common.reject"),
      icon: "x",
      iconTone: "var(--danger)",
      size: "md",
      body: ({ close }: { close: () => void }) => (
        <RejectReasonForm
          onCancel={close}
          onSubmit={(reason) =>
            reject.mutate(reason, {
              onSuccess: () => close(),
              onError: onErr,
            })
          }
          pending={reject.isPending}
        />
      ),
    });
  };

  const lastEdited = lastEditedDate(detail.submittedAt, detail.approvedAt);

  return (
    <Frame>
      <PrTopBar no={detail.no} onBack={onBack} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Doc header bar (full-bleed, pr-form.jsx L245-263). */}
        <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "18px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                <h1 className="num" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                  {detail.no || DASH}
                </h1>
                <StatusBadge status={detail.status} label={tp(P(statusPhraseName(detail.status)))} />
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {t("pr.form.lastEdited").replace("{datetime}", lastEdited || DASH)}
                </span>
              </div>
              {/* description line = short title (real); the long reason has no wire. */}
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>{detail.title || DASH}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <DocStepper step={detail.approvalStep} total={tiers} status={detail.status} />
              {/* the "waiting-for {approver}" text only means something while pending; the
                  approver name is not on the wire (per-approver timeline is mock) -> em-dash it. */}
              {isPending && (
                <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 600, marginLeft: 4 }}>
                  {t("pr.form.tierWaiting")
                    .replace("{step}", String(detail.approvalStep))
                    .replace("{total}", String(tiers))
                    .replace("{approver}", DASH)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, padding: 24, alignItems: "start" }}>
          {/* === Left column === */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Type tabs + form grid (pr-form.jsx L271-342). */}
            <Card pad={0}>
              <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 8px" }}>
                {TYPE_TABS.map((tab) => {
                  const on = typeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTypeTab(tab.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "14px 14px",
                        background: "none",
                        border: "none",
                        borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
                        marginBottom: -1,
                        fontFamily: "inherit",
                        fontSize: 12.5,
                        fontWeight: on ? 600 : 500,
                        color: on ? "var(--brand)" : "var(--text-2)",
                        cursor: "pointer",
                      }}
                    >
                      <Icon name={tab.icon} size={15} />
                      {tp(P(tab.strKey))}
                    </button>
                  );
                })}
              </div>

              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {/* Real: PR no (readonly) + need-date + project name + phase. */}
                  <Field label={tp(P("fieldPrNo"))}>
                    <DisplayInput value={detail.no || DASH} mono />
                  </Field>
                  {/* mock-only: doc-date not in the wire -> em-dash. */}
                  <Field label={tp(P("fieldDocDate"))}>
                    <DisplayInput value={DASH} muted suffix={<Icon name="calendar" size={13} />} />
                  </Field>
                  <Field label={tp(P("fieldNeedDate"))}>
                    <DisplayInput
                      value={detail.needDate || DASH}
                      muted={!detail.needDate}
                      suffix={<Icon name="calendar" size={13} />}
                    />
                  </Field>
                  <Field label={tp(P("fieldUrgency"))}>
                    <DisplayInput value={DASH} muted />
                  </Field>

                  <Field label={tp(P("fieldCompany"))} span={2}>
                    <DisplayInput value={DASH} muted />
                  </Field>
                  <Field label={tp(P("fieldRequesterDept"))}>
                    <DisplayInput value={DASH} muted />
                  </Field>
                  <Field label={tp(P("fieldCostCenter"))}>
                    <DisplayInput value={DASH} muted />
                  </Field>

                  <Field label={tp(P("fieldProject"))}>
                    <DisplayInput value={projectName || DASH} muted={!projectName} />
                  </Field>
                  <Field label={tp(P("fieldPhase"))}>
                    <DisplayInput value={detail.phase || DASH} muted={!detail.phase} />
                  </Field>
                  <Field label={tp(P("fieldBlock"))}>
                    <DisplayInput value={DASH} muted />
                  </Field>
                  <Field label={tp(P("fieldUnit"))}>
                    <DisplayInput value={DASH} muted />
                  </Field>
                </div>

                {/* Long reason textarea: only the short `title` exists on the wire -> disabled + em-dash. */}
                <div style={{ marginTop: 14 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--text-2)",
                      marginBottom: 6,
                    }}
                  >
                    {tp(P("fieldDescription"))}
                  </label>
                  <textarea
                    value={DASH}
                    readOnly
                    disabled
                    style={{
                      width: "100%",
                      minHeight: 60,
                      padding: 10,
                      border: "1px solid var(--border)",
                      borderRadius: 7,
                      fontSize: 12.5,
                      fontFamily: "inherit",
                      resize: "vertical",
                      outline: "none",
                      background: "var(--surface-2)",
                      color: "var(--text-3)",
                    }}
                  />
                </div>
              </div>
            </Card>

            {/* Items table (pr-form.jsx L345-421). */}
            <Card pad={0}>
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>{tp(P("itemsTitle"))}</div>
                {/* BOQ picker / add-line / import are the create-flow (out of scope) -> disabled. */}
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn kind="soft" size="sm" icon="link" disabled>
                    {tp(P("pickFromBoq"))}
                  </Btn>
                  <Btn kind="ghost" size="sm" icon="plus" disabled>
                    {tp(P("addItem"))}
                  </Btn>
                  <Btn kind="ghost" size="sm" icon="upload" disabled>
                    {tp(P("importExcel"))}
                  </Btn>
                </div>
              </div>

              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                      <th scope="col" style={th(36)}>#</th>
                      <th scope="col" style={th()}>{tp(P("colCodeName"))}</th>
                      <th scope="col" style={th(110)}>{t("pr.form.colBoqItem")}</th>
                      <th scope="col" style={th(80, true)}>{tp(P("colQty"))}</th>
                      <th scope="col" style={th(70)}>{tp(P("colUnit"))}</th>
                      <th scope="col" style={th(110, true)}>{tp(P("colUnitPrice"))}</th>
                      <th scope="col" style={th(130, true)}>{tp(P("colAmount"))}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((it: PrItem, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...td, color: "var(--text-3)", fontWeight: 600 }} className="num">
                          {i + 1}
                        </td>
                        {/* WIRE GAP: no item name/code on the wire -> em-dash. */}
                        <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                        {/* WIRE GAP: no resolved BOQ-item code/badge -> em-dash. */}
                        <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                        <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(it.qty)}</td>
                        {/* WIRE GAP: no unit on the wire -> em-dash. */}
                        <td style={{ ...td, color: "var(--text-3)" }}>{DASH}</td>
                        <td style={{ ...td, textAlign: "right" }} className="num">{formatDec(it.price)}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                          {formatMoney(it.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals footer (pr-form.jsx L403-420): server ex-VAT amount is real; VAT + net
                  are client money-math (forbidden) -> em-dash. */}
              <div
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 24,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-2)" }}>
                  <Icon name="info" size={14} color="var(--text-3)" />
                  {tp(P("priceMatchInfo"))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto",
                    gap: "4px 18px",
                    fontSize: 12.5,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "var(--text-2)" }}>{tp(P("totalExVat"))}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>
                    {formatDec(detail.amount)} {t("subcon.unitBaht")}
                  </span>
                  <span style={{ color: "var(--text-2)" }}>{tp(P("vatLabel"))}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600, color: "var(--text-3)" }}>
                    {DASH}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                    {tp(P("netTotal"))}
                  </span>
                  <span
                    className="num"
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      textAlign: "right",
                      paddingTop: 6,
                      borderTop: "1px solid var(--border)",
                      color: "var(--text-3)",
                    }}
                  >
                    {DASH}
                  </span>
                </div>
              </div>
            </Card>

            {/* Attachments + comments (pr-form.jsx L423-480): no pr-attachment / pr-comment
                table -> honest-empty lists, disabled add/send (B-220). */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card pad={18}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{tp(P("attachTitle"))}</div>
                  <Btn kind="ghost" size="sm" icon="paperclip" disabled>
                    {tp(P("addFile"))}
                  </Btn>
                </div>
                {/* honest-empty: no attachment rows on the wire. */}
              </Card>

              <Card pad={18}>
                <CardTitle>{t("pr.form.commentsTitle")}</CardTitle>
                {/* honest-empty: no comment rows on the wire. */}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <input
                    placeholder={tp(P("commentPlaceholder"))}
                    disabled
                    style={{
                      flex: 1,
                      height: 34,
                      padding: "0 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 7,
                      fontSize: 12.5,
                      outline: "none",
                      background: "var(--surface-2)",
                      color: "var(--text-3)",
                    }}
                  />
                  <Btn kind="primary" size="md" disabled>
                    {t("pr.form.sendComment")}
                  </Btn>
                </div>
              </Card>
            </div>
          </div>

          {/* === Right column (sticky) === */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
            {/* Budget bar (pr-form.jsx L164-221 / L485-487): only this-PR amount is real; the
                used/total/remaining/% have no budget-rollup wire -> em-dash. */}
            <Card pad={18}>
              <div style={{ padding: 14, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 }}>
                    {t("pr.form.budgetCommittedLabel")}
                  </div>
                  <div className="num" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)" }}>
                    {DASH}
                    <span style={{ fontWeight: 500 }}> {t("pr.form.budgetAfterApprove")}</span>
                  </div>
                </div>
                {/* No budget-consumed / total on the wire -> an empty (unfilled) bar. */}
                <div style={{ height: 10, background: "var(--surface-3)", borderRadius: 999, marginTop: 8 }} />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10,
                    marginTop: 12,
                    fontSize: 11,
                    color: "var(--text-3)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--brand)" }} />
                      {t("pr.form.budgetUsed")}
                    </div>
                    <div className="num" style={{ color: "var(--text-3)", fontWeight: 600, fontSize: 12.5 }}>{DASH}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--warn)" }} />
                      {t("pr.form.budgetThisPR")}
                    </div>
                    {/* real: this-PR committing amount = the server `amount`. */}
                    <div className="num" style={{ color: "var(--warn)", fontWeight: 600, fontSize: 12.5 }}>
                      +{formatMoney(detail.amount)}
                    </div>
                  </div>
                  <div>
                    <div style={{ marginBottom: 2 }}>{tp(P("budgetRemaining"))}</div>
                    <div className="num" style={{ color: "var(--text-3)", fontWeight: 600, fontSize: 12.5 }}>{DASH}</div>
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 10, lineHeight: 1.5 }}>
                  {t("pr.form.budgetFooter")
                    .replace("{code}", DASH)
                    .replace("{category}", DASH)
                    .replace("{amount}", DASH)}
                </div>
              </div>
            </Card>

            {/* Approval chain (pr-form.jsx L91-162 / L489-491): the per-person timeline is mock
                (no per-approver table) -> honest-empty; render the static tier RULE + the
                current-user action row (approve / revise / reject) — the faithful reject home. */}
            <Card pad={18}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t("pr.form.approvalChainTitle")}</div>
                <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  {/* {rule} band label is not on the wire -> em-dash; {tiers} is derived from the
                      real amount (same B-070 thresholds as the backend gate). */}
                  {t("pr.form.approvalRule").replace("{rule}", DASH).replace("{tiers}", String(tiers))}
                </span>
              </div>
              {/* current-user action row — gated to a pending doc (the only state approve/reject
                  are valid). the revise action has no endpoint -> disabled. */}
              {isPending && (
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn kind="ok" size="sm" icon="check" onClick={doApprove} disabled={busy || !canApprove(detail.status)}>
                    {t("common.approve")}
                  </Btn>
                  <Btn kind="outline" size="sm" icon="edit" disabled>
                    {tp(P("revise"))}
                  </Btn>
                  <Btn
                    kind="ghost"
                    size="sm"
                    icon="x"
                    style={{ color: "var(--danger)" }}
                    onClick={openReject}
                    disabled={busy || !canReject(detail.status)}
                  >
                    {t("common.reject")}
                  </Btn>
                </div>
              )}
            </Card>

            {/* Related docs (pr-form.jsx L493-500): no related-docs resolver -> honest-empty. */}
            <Card pad={18}>
              <CardTitle>{tp(P("relatedDocsTitle"))}</CardTitle>
              {/* honest-empty: no BOQ/PO/GR link resolver on the wire. */}
            </Card>

            {/* Sync panel (pr-form.jsx L502-520) is OMITTED — no integration-status wire. */}
          </div>
        </div>

        {/* Sticky action bar (pr-form.jsx L525-542). */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 -4px 12px -4px rgba(15,23,42,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--text-2)" }}>
            <Icon name="info" size={15} color="var(--accent)" />
            {/* {amount} = real server ex-VAT amount; {n} = remaining tiers (integer, not money);
                {when} (est. completion) is not on the wire -> em-dash. */}
            <span>
              {t("pr.form.stickySummary")
                .replace("{amount}", formatMoney(detail.amount))
                .replace("{n}", String(remainingTiers(detail.amount, detail.approvalStep, detail.status)))
                .replace("{when}", DASH)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* cancel / save-draft / revise: no state-machine endpoint / not applicable to an
                existing doc -> disabled. */}
            <Btn kind="ghost" size="lg" icon="x" style={{ color: "var(--danger)" }} disabled>
              {t("common.cancel")}
            </Btn>
            <Btn kind="outline" size="lg" disabled>
              {t("common.saveDraft")}
            </Btn>
            <Btn kind="outline" size="lg" icon="edit" disabled>
              {tp(P("revise"))}
            </Btn>
            {/* primary action, status-gated: a draft submits (common.submit), a pending doc
                approves (boq.aprApproveForward); a terminal doc disables it. */}
            {isDraft ? (
              <Btn kind="ok" size="lg" icon="check" onClick={doSubmit} disabled={busy}>
                {t("common.submit")}
              </Btn>
            ) : (
              <Btn kind="ok" size="lg" icon="check" onClick={doApprove} disabled={busy || !isPending}>
                {t("boq.aprApproveForward")}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** Reject-reason collector (pr.ts requires a non-blank {reason}) — a controlled modal body. */
function RejectReasonForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t, tp } = useI18n();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={tp(P("commentPlaceholder"))}
        style={{
          width: "100%",
          minHeight: 90,
          padding: 10,
          border: "1px solid var(--border)",
          borderRadius: 9,
          fontSize: 12.5,
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
          background: "var(--surface)",
          color: "var(--text)",
          marginBottom: 14,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn kind="outline" size="md" onClick={onCancel}>
          {t("common.cancel")}
        </Btn>
        <Btn
          kind="danger"
          size="md"
          icon="x"
          onClick={() => onSubmit(trimmed)}
          disabled={pending || trimmed === ""}
        >
          {t("common.reject")}
        </Btn>
      </div>
    </div>
  );
}
