/*
 * AdminSubscribers — the Platform-Admin subscriber-management screen (route admin.subs),
 * ported from pototype/subscription-admin.jsx AdminSubscribers (L113-176) + its row-click
 * detail modal CompanyControl (L241-371) + the resetPw confirm (L254-265). Registry section
 * "platform" (owner-gated; the backend 403s non-owners -> graceful skeleton/empty here).
 *
 * Design fidelity (PLAN.md §0 rule 1): the breadcrumb / title / count-driven subtitle + an
 * export action, the filter bar (org/id search + package + status filters + a "{count}" row
 * tally), the 7-column table (org / package / projects / users / MRR / renew / status)
 * with a per-row StatusBadge and overdue-tinted renewal, and the XL CompanyControl modal
 * (summary header + control/roster tabs) are the prototype's.
 *
 * Data (rules 3/4): three TanStack Query reads via the generated client — useAdminSubscribers
 * (GET /admin/subscribers) = the rows; useAdminPackages (GET /admin/packages) = package
 * name/colour/quota join; useAdminUsers (GET /admin/users) = the per-company user count +
 * the CompanyControl roster (filtered client-side by company_id). All narrowing / MRR + user
 * counts / the filter / status maps live in the pure, unit-tested admin-rows.ts (G3).
 *
 * REAL vs em-dash + mock (reported honestly, never fabricated — Phase-6 B-179):
 *   - org: REAL company_name (joined on the subscriber wire). projects: NO wire count ->
 *     em-dash. users: DERIVED count over /admin/users. MRR: DERIVED from package price +
 *     cycle (em-dash when 0). renew: REAL renew_at (YYYY-MM-DD), overdue-tinted. status: a
 *     tokened badge (expiring/unknown render their raw code).
 *   - CompanyControl roster: name/email/status are REAL from /admin/users; role_id is an
 *     opaque uuid with no name join (role -> em-dash) and there is no last-login field
 *     (-> em-dash); the admin-role avatar/tag heuristic is dropped (a neutral colour).
 *   - suspend/resume (subscriber) + block/unblock (user) are REAL owner-gated mutations behind
 *     a title-only confirm (use-admin.ts): suspend/resume flip companies.status (surfaced as
 *     company_status; the suspend/resume swap branches on THAT field, not subscription.status)
 *     and invalidate the subscribers read; block/unblock take the roster user id and invalidate
 *     the users read (the roster is a pure derivation of it, no local copy). The "Save settings"
 *     write is REAL too (W1c): PUT /admin/subscribers/{id}/package writes the selected package_id
 *     + a seat override onto the subscription row (money = SERVER; the seat stepper edits LOCAL
 *     state the Save button then persists) and invalidates the subscribers read.
 *   - reset-password is REAL too (B-282): POST /admin/users/{id}/reset-password, bodiless,
 *     owner-gated. It writes credential state only, so NO read is invalidated. Until
 *     2026-08-10 this confirm dialog fired the "link sent to {email}" toast and called
 *     nothing — a success claim, made to a platform owner, about somebody else's account.
 *     The endpoint had in fact been mounted since B-282; the comment here said MOCK.
 *   - EXPORT stays MOCK (a faithful ctx.notify), and "the contract declares none" was
 *     WRONG — corrected 2026-08-10. The contract DOES declare an export: openapi.yaml:4235
 *     POST /exports (createExport, {type,params} -> 202 Job) + :4262 GET /exports/{id}
 *     (getExport), both generated. What is missing is the MOUNT — apps/api/src/app.ts
 *     registers no exports route and the only "/exports" in apps/api/src is a design
 *     comment (worker.ts:6) — so a contract-following caller gets a 404. That is
 *     declared-but-never-mounted, the same shape as the B-282 reset-password defect two
 *     bullets up. Filed as B-351. Separately true and unchanged: there is no
 *     subscriber-SPECIFIC export handler either. Disclosed plainly because this control is
 *     not merely inert — it fires admin.subs.exportToast, whose copy asserts the subscriber
 *     list was exported as CSV: a success claim with nothing behind it, i.e. the same lie
 *     shape as the reset-password confirm. It is left as-is only because it is a
 *     prototype-faithful mock and changing it is a visible behaviour change (a ruling,
 *     carried on B-351), not because it is acceptable. invite-user stays honest-DISABLED
 *     (the invite form is a dropped mock write path).
 *
 * i18n (rule 2): every visible string is an admin.subs.* / admin.common.* dict key (t). No
 * Thai literal in source (B-073); tokens back every colour except the prototype-verbatim
 * plan hexes reconstructed from size, the StatusBadge dot hexes, and the roster avatar hex
 * (B-037(a)). The infinity/unlimited glyphs use the admin.common.infinity/unlimited keys.
 * Numeric cells carry class `num`. `admin.subs.statusCancelled` (badge) and
 * `admin.common.cancel` (action) share the same Thai text but are distinct keys (kept separate).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Field } from "../../ui/field";
import { Avatar } from "../../ui/avatar";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toSubscriberRow,
  toPackageRow,
  toUserRow,
  packageById,
  subStatusInfo,
  deriveMrr,
  filterSubscribers,
  userCountByCompany,
  usersForCompany,
  activeUserCount,
  overSeat,
  userStatusKind,
  suspendAction,
  blockAction,
  canManageUser,
  fireWithToast,
  isUnlimited,
  sizeColor,
  formatMoney,
  formatDate,
  SUB_STATUS_CODES,
  type BadgeTone,
  type SubscriberRow,
  type PackageRow,
  type UserRow,
} from "./admin-rows";
import {
  useAdminSubscribers,
  useAdminPackages,
  useAdminUsers,
  useSuspendSubscriber,
  useResumeSubscriber,
  useBlockUser,
  useUnblockUser,
  useSetSubscriberPackage,
  useResetUserPassword,
} from "./use-admin";

/** Em-dash for every honest wire gap (never a fabricated value). */
const DASH = "—";
/** Roster avatar colour — the prototype's non-admin default (B-037(a); the role-text-based
 *  admin highlight is dropped because role_id has no name join). */
const AVATAR = "#5A7CA8";

function th(w?: number, align: "start" | "center" | "right" = "start"): CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}
function td(align: "start" | "center" | "right" = "start"): CSSProperties {
  return { padding: "14px", verticalAlign: "middle", textAlign: align };
}

function statusTone(tone: BadgeTone): { bg: string; fg: string; dot: string } {
  switch (tone) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  const s = statusTone(tone);
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

/** Native <select> styled like ds.jsx Dropdown mode="filter" (mirrors land FilterSelect). */
function FilterSelect({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={{
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--surface)",
        color: "var(--text-2)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {children}
    </select>
  );
}

/** Seat stepper +/- button (subscription-admin.jsx seatBtn, L372). */
const seatBtn: CSSProperties = {
  width: 32,
  height: 36,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  cursor: "pointer",
  fontSize: 17,
  fontWeight: 700,
  color: "var(--text-2)",
  fontFamily: "inherit",
};

/* --------------------------------------------------------------------------- */
/* CompanyControl — the row-click detail modal (subscription-admin.jsx L241-371) */
/* --------------------------------------------------------------------------- */

function CompanyControl({
  sub,
  packages,
  pkgMap,
  allUsers,
  onClose,
}: {
  sub: SubscriberRow;
  packages: readonly PackageRow[];
  pkgMap: Map<string, PackageRow>;
  allUsers: readonly UserRow[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useShellCtx();

  // Owner-gated state mutations. suspend/resume take the SUBSCRIPTION id (sub.id) and invalidate
  // the subscribers read; block/unblock take the USER id (u.id) and invalidate the users read.
  // setPkg is the "Save settings" write — PUT /admin/subscribers/{id}/package (id = sub.id, the
  // SUBSCRIPTION id) — and invalidates the subscribers read.
  const suspend = useSuspendSubscriber();
  const resume = useResumeSubscriber();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const setPkg = useSetSubscriberPackage(sub.id);
  // reset takes the USER id (u.id) and writes credential state only — no read is invalidated.
  const reset = useResetUserPassword();

  const [tab, setTab] = useState<"control" | "users">("control");
  const [pkgId, setPkgId] = useState(sub.packageId);
  const selected = pkgMap.get(pkgId);
  // Init from the saved seat override so it re-displays on re-open; fall back to the package's
  // users limit (a fresh subscription with no override yet).
  const [seatLimit, setSeatLimit] = useState<number>(sub.seats ?? selected?.users ?? 0);
  // The roster is a pure derivation of the /admin/users read (invalidated by block/unblock) —
  // no local copy, so a real status flip flows back through the query, not an optimistic mock.
  const roster = useMemo<UserRow[]>(() => usersForCompany(allUsers, sub.companyId), [allUsers, sub.companyId]);

  const p = pkgMap.get(pkgId);
  const activeUsers = activeUserCount(roster);
  const over = overSeat(activeUsers, seatLimit);
  const unlimitedText = t("admin.common.unlimited");
  const infinity = t("admin.common.infinity");

  // Summary MRR is the subscriber's OWN package (not the currently-selected one), derived.
  const summaryMrr = deriveMrr(pkgMap.get(sub.packageId), sub.cycle, sub.status);
  const subStatus = subStatusInfo(sub.status);
  const subStatusLabel = statusCodeLabel(t, subStatus.labelKind, sub.status);
  const cycleLabel = sub.cycle === "yearly" ? t("admin.subs.cycleYearly") : t("admin.subs.cycleMonthly");
  const seatText = seatLimit < 0 ? infinity : String(seatLimit);
  const maxProjects = p ? (isUnlimited(p.projects) ? infinity : String(p.projects)) : DASH;

  const changePkg = (id: string) => {
    setPkgId(id);
    const nextPkg = pkgMap.get(id);
    setSeatLimit(nextPkg?.users ?? 0);
  };
  const decSeat = () => setSeatLimit((v) => (v < 0 ? v : Math.max(activeUsers, v - 1)));
  const incSeat = () => setSeatLimit((v) => (v < 0 ? v : v + 1));
  const editSeat = (raw: string) => {
    const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
    setSeatLimit(Number.isNaN(n) ? 0 : n);
  };

  const save = () => {
    // onClose() unmounts CompanyControl before the PUT settles, so the toast fires off the
    // settled promise (fireWithToast). Body = {package_id, seats}; money = SERVER (no client
    // price). seats is sent RAW (server validates integer && (-1 || >=1)); a rejection (e.g. a
    // 0 from editSeat -> 400) surfaces the B-200(a) error toast, never a swallowed catch.
    onClose();
    fireWithToast(
      () => setPkg.mutateAsync({ package_id: pkgId, seats: seatLimit }),
      () =>
        ctx.notify(
          t("admin.subs.saveToast")
            .replace("{org}", sub.companyName || DASH)
            .replace("{pkg}", p?.name ?? DASH)
            .replace("{seats}", seatText),
        ),
      () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
    );
  };

  const resetPw = (u: UserRow) => {
    ctx.openModal({
      title: t("admin.subs.resetPwTitle"),
      subtitle: u.name,
      icon: "key",
      iconTone: "var(--brand)",
      size: "sm",
      body: ({ close }: { close: () => void }) => (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}>
            {t("admin.subs.resetPwBody").replace("{email}", u.email || DASH)}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn kind="outline" size="md" onClick={close}>
              {t("admin.common.cancel")}
            </Btn>
            <Btn
              kind="primary"
              size="md"
              icon="mail"
              disabled={reset.isPending || !canManageUser(u.id)}
              onClick={() => {
                // REAL owner-gated write (B-282): POST /admin/users/{id}/reset-password,
                // no body. close() unmounts this dialog before the POST settles (single
                // modal slot), so the toast fires off the SETTLED promise (fireWithToast,
                // B-200b) — never before the server answered. A rejection (403 non-owner,
                // 404 no-credential) shows the failure toast instead of the success one:
                // this button used to claim a link had been mailed while calling nothing.
                close();
                fireWithToast(
                  () => reset.mutateAsync(u.id),
                  () => ctx.notify(t("admin.subs.resetPwToast").replace("{email}", u.email || DASH)),
                  () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                );
              }}
            >
              {t("admin.subs.resetPwSend")}
            </Btn>
          </div>
        </div>
      ),
    });
  };

  const tabs: readonly { id: "control" | "users"; label: string; ic: "settings" | "users" }[] = [
    { id: "control", label: t("admin.subs.tabControl"), ic: "settings" },
    { id: "users", label: t("admin.subs.tabUsers").replace("{count}", String(roster.length)), ic: "users" },
  ];

  return (
    <div>
      {/* summary header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <StatusBadge tone={subStatus.tone} label={subStatusLabel} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: p ? sizeColor(p.size) : "var(--text-3)" }} />
          {p?.name ?? DASH}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }} className="num">
          {cycleLabel} · {t("admin.subs.summaryMrr").replace("{mrr}", formatMoney(summaryMrr))}
        </span>
        <span
          style={{ marginInlineStart: "auto", fontSize: 11.5, color: over ? "var(--danger)" : "var(--text-3)", fontWeight: over ? 700 : 500 }}
          className="num"
        >
          {t("admin.subs.summaryUsage")
            .replace("{active}", String(activeUsers))
            .replace("{seats}", seatText)
            .replace("{projects}", DASH)
            .replace("{maxProjects}", maxProjects)}
        </span>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {tabs.map((tb) => {
          const on = tab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 14px",
                border: "none",
                borderBottom: `2px solid ${on ? "var(--brand)" : "transparent"}`,
                marginBottom: -1,
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: on ? 700 : 500,
                color: on ? "var(--brand-ink)" : "var(--text-2)",
              }}
            >
              <Icon name={tb.ic} size={14} />
              {tb.label}
            </button>
          );
        })}
      </div>

      {tab === "control" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <Field label={t("admin.subs.fieldPkg")}>
              <select
                value={pkgId}
                onChange={(e) => changePkg(e.target.value)}
                style={{
                  width: "100%",
                  height: 36,
                  padding: "0 10px",
                  fontSize: 13,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface)",
                  outline: "none",
                  fontFamily: "inherit",
                  color: "var(--text)",
                }}
              >
                {packages.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("admin.subs.fieldSeats")}
              hint={
                p && isUnlimited(p.users)
                  ? t("admin.subs.seatsHintUnlimited")
                  : t("admin.subs.seatsHintMax").replace("{n}", p ? String(p.users) : DASH)
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={decSeat} style={seatBtn}>
                  −
                </button>
                <input
                  value={seatText}
                  onChange={(e) => editSeat(e.target.value)}
                  className="num"
                  style={{
                    width: 70,
                    height: 36,
                    textAlign: "center",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button type="button" onClick={incSeat} style={seatBtn}>
                  +
                </button>
                <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("admin.subs.seatUnit")}</span>
              </div>
            </Field>
          </div>

          {/* quota preview */}
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 10 }}>
              {t("admin.subs.quotaTitle").replace("{pkg}", p?.name ?? DASH)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <QuotaCell label={t("admin.subs.projectsLabel")} value={p ? (isUnlimited(p.projects) ? unlimitedText : formatMoney(p.projects)) : DASH} />
              <QuotaCell label={t("admin.subs.usersLabel")} value={seatLimit < 0 ? unlimitedText : String(seatLimit)} />
              <QuotaCell
                label={t("admin.subs.quotaStorageLabel")}
                value={p ? `${isUnlimited(p.storageGb) ? unlimitedText : formatMoney(p.storageGb)} ${t("admin.subs.quotaStorageUnit")}` : DASH}
              />
              <QuotaCell
                label={t("admin.subs.quotaAiLabel")}
                value={p ? (isUnlimited(p.aiPerMonth) ? unlimitedText : `${p.aiPerMonth}${t("admin.subs.quotaAiUnit")}`) : DASH}
              />
            </div>
          </div>

          {over && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                background: "var(--danger-soft)",
                borderRadius: 9,
                marginBottom: 14,
                fontSize: 11.5,
                color: "var(--danger)",
                fontWeight: 600,
              }}
            >
              <Icon name="warn" size={15} />
              {t("admin.subs.overSeatWarn").replace("{count}", String(activeUsers))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            {/* suspend/resume flip companies.status (surfaced as company_status) — the action is
                decided by suspendAction(company_status) (B-200b), NOT subscription.status, so the
                button swaps after a real flip. */}
            {suspendAction(sub.companyStatus) === "suspend" ? (
              <Btn
                kind="danger"
                size="md"
                icon="x"
                disabled={suspend.isPending}
                onClick={() =>
                  ctx.confirm({
                    title: t("admin.subs.suspendBtn"),
                    subtitle: sub.companyName,
                    icon: "x",
                    iconTone: "var(--danger)",
                    danger: true,
                    onConfirm: () => {
                      onClose();
                      // ctx.confirm unmounts CompanyControl (single modal slot) before the POST
                      // settles, so a mutate-scoped onSuccess is hasListeners()-gated off the dead
                      // observer. fireWithToast (B-200b) fires the toast off the settled promise
                      // instead; the hook-level invalidateQueries survives (not listener-gated).
                      // The rejection path shows the B-200(a) error toast, not a swallowed catch.
                      fireWithToast(
                        () => suspend.mutateAsync(sub.id),
                        () => ctx.notify(t("admin.subs.suspendToast").replace("{org}", sub.companyName || DASH), "warn"),
                        () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                      );
                    },
                  })
                }
              >
                {t("admin.subs.suspendBtn")}
              </Btn>
            ) : (
              <Btn
                kind="ok"
                size="md"
                icon="check"
                disabled={resume.isPending}
                onClick={() =>
                  ctx.confirm({
                    title: t("admin.subs.activateBtn"),
                    subtitle: sub.companyName,
                    icon: "check",
                    iconTone: "var(--ok)",
                    onConfirm: () => {
                      onClose();
                      // Toast off the settled promise — CompanyControl unmounts before the POST
                      // settles (see suspend note); the rejection path shows the B-200(a) toast.
                      fireWithToast(
                        () => resume.mutateAsync(sub.id),
                        () => ctx.notify(t("admin.subs.activateToast").replace("{org}", sub.companyName || DASH)),
                        () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                      );
                    },
                  })
                }
              >
                {t("admin.subs.activateBtn")}
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            <Btn kind="outline" size="md" onClick={onClose}>
              {t("admin.common.cancel")}
            </Btn>
            <Btn kind="primary" size="md" icon="check" disabled={setPkg.isPending} onClick={save}>
              {t("admin.subs.saveSettingsBtn")}
            </Btn>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              {t("admin.subs.usersSummary")
                .replace("{total}", String(roster.length))
                .replace("{active}", String(activeUsers))
                .replace("{suspended}", String(roster.length - activeUsers))}
            </span>
            {/* Honest-DISABLED: no invite endpoint (the invite form is a dropped mock write). */}
            <Btn kind="soft" size="sm" icon="plus" style={{ marginInlineStart: "auto" }} disabled>
              {t("admin.subs.inviteBtn")}
            </Btn>
          </div>
          <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", position: "sticky", top: 0 }}>
                  <th scope="col" style={th()}>{t("admin.subs.colName")}</th>
                  <th scope="col" style={th(160)}>{t("admin.subs.colRole")}</th>
                  <th scope="col" style={th(120)}>{t("admin.subs.colLastLogin")}</th>
                  <th scope="col" style={th(90, "center")}>{t("admin.subs.statusLabel")}</th>
                  <th scope="col" style={th(150, "right")}>{t("admin.subs.colManage")}</th>
                </tr>
              </thead>
              <tbody>
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 40, textAlign: "center" }}>
                      <Icon name="users" size={26} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  roster.map((u, i) => {
                    const kind = userStatusKind(u.status);
                    const blocked = kind === "blocked";
                    return (
                      <tr key={u.id || i} style={{ borderTop: "1px solid var(--border)", opacity: blocked ? 0.6 : 1 }}>
                        <td style={td()}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <Avatar name={u.name} size={26} color={blocked ? "var(--danger)" : AVATAR} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{u.name || DASH}</div>
                              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{u.email || DASH}</div>
                            </div>
                          </div>
                        </td>
                        {/* role — role_id is an opaque uuid with no name join -> em-dash. */}
                        <td style={td()}>{DASH}</td>
                        {/* last login — NO wire field -> em-dash. */}
                        <td style={{ ...td(), fontSize: 11.5, color: "var(--text-3)" }}>{DASH}</td>
                        <td style={td("center")}>
                          {blocked ? (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)" }}>
                              {t("admin.subs.userStatusBlocked")}
                            </span>
                          ) : kind === "active" ? (
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--ok)", display: "inline-block" }} />
                          ) : (
                            <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("admin.subs.userStatusInactive")}</span>
                          )}
                        </td>
                        <td style={td("right")}>
                          <div style={{ display: "inline-flex", gap: 5 }}>
                            <Btn kind="ghost" size="sm" icon="key" onClick={() => resetPw(u)}>
                              {t("admin.subs.resetBtn")}
                            </Btn>
                            <Btn
                              kind={blocked ? "ok" : "danger"}
                              size="sm"
                              icon={blocked ? "check" : "lock"}
                              // block/unblock take the USER id (u.id); a blank id would POST
                              // /admin/users//block, so canManageUser(u.id) gates it off (B-200b).
                              disabled={block.isPending || unblock.isPending || !canManageUser(u.id)}
                              onClick={() =>
                                ctx.confirm({
                                  title: t(blocked ? "admin.subs.unblockBtn" : "admin.subs.blockBtn"),
                                  subtitle: u.name,
                                  icon: blocked ? "check" : "lock",
                                  iconTone: blocked ? "var(--ok)" : "var(--danger)",
                                  danger: !blocked,
                                  // Toast off the settled promise — ctx.confirm unmounts this
                                  // modal before the POST settles (see suspend note). The tone
                                  // comes from blockAction(u.status) (B-200b); the rejection path
                                  // shows the B-200(a) error toast, not a swallowed catch.
                                  onConfirm: () =>
                                    fireWithToast(
                                      () => (blocked ? unblock : block).mutateAsync(u.id),
                                      () =>
                                        ctx.notify(
                                          (blocked ? t("admin.subs.unblockToast") : t("admin.subs.blockToast")).replace("{name}", u.name || DASH),
                                          blockAction(u.status).tone,
                                        ),
                                      () => ctx.notify(t("admin.common.actionFailedToast"), "danger"),
                                    ),
                                })
                              }
                            >
                              {blocked ? t("admin.subs.unblockBtn") : t("admin.subs.blockBtn")}
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <Btn kind="outline" size="md" onClick={onClose}>
              {t("admin.common.close")}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/** One cell in the CompanyControl quota-preview grid. */
function QuotaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

/** Resolve a subscription-status label key (or the raw code when there is none). */
function statusCodeLabel(
  t: (key: "admin.subs.statusActive" | "admin.subs.statusTrial" | "admin.subs.statusOverdue" | "admin.subs.statusCancelled") => string,
  labelKind: "active" | "trial" | "overdue" | "cancelled" | "raw",
  raw: string,
): string {
  switch (labelKind) {
    case "active":
      return t("admin.subs.statusActive");
    case "trial":
      return t("admin.subs.statusTrial");
    case "overdue":
      return t("admin.subs.statusOverdue");
    case "cancelled":
      return t("admin.subs.statusCancelled");
    default:
      return raw; // expiring / unknown — no label key (render the raw backend code)
  }
}

/* --------------------------------------------------------------------------- */
/* AdminSubscribers — the table screen (subscription-admin.jsx L113-176)         */
/* --------------------------------------------------------------------------- */

export function AdminSubscribers() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const subscribersQ = useAdminSubscribers();
  const packagesQ = useAdminPackages();
  const usersQ = useAdminUsers();

  const [q, setQ] = useState("");
  const [pkg, setPkg] = useState("");
  const [status, setStatus] = useState("");

  const allRows = useMemo<SubscriberRow[]>(() => (subscribersQ.data ?? []).map(toSubscriberRow), [subscribersQ.data]);
  const rows = useMemo(() => filterSubscribers(allRows, { q, pkg, status }), [allRows, q, pkg, status]);
  const packages = useMemo<PackageRow[]>(() => (packagesQ.data ?? []).map(toPackageRow), [packagesQ.data]);
  const pkgMap = useMemo(() => packageById(packages), [packages]);
  const users = useMemo<UserRow[]>(() => (usersQ.data ?? []).map(toUserRow), [usersQ.data]);
  const userCounts = useMemo(() => userCountByCompany(users), [users]);

  const statusLabel = (sub: SubscriberRow): string => {
    const info = subStatusInfo(sub.status);
    return statusCodeLabel(t, info.labelKind, sub.status);
  };

  const openDetail = (s: SubscriberRow) => {
    ctx.openModal({
      title: s.companyName || DASH,
      subtitle: t("admin.subs.detailSubtitle").replace("{id}", s.id),
      icon: "users",
      iconTone: sizeColor(pkgMap.get(s.packageId)?.size ?? ""),
      size: "xl",
      body: ({ close }: { close: () => void }) => (
        <CompanyControl sub={s} packages={packages} pkgMap={pkgMap} allUsers={users} onClose={close} />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("admin.common.breadcrumbRoot"), t("admin.subs.breadcrumb")]}
      title={t("admin.subs.title")}
      subtitle={t("admin.subs.subtitle").replace("{count}", String(allRows.length))}
      actions={
        // Export -> MOCK toast. NOT "no export endpoint": the contract declares
        // POST /exports + GET /exports/{id} and nothing mounts them (B-351). The toast
        // asserts a CSV export that never happened — see the EXPORT bullet in the header.
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("admin.subs.exportToast"))}>
          {t("admin.common.export")}
        </Btn>
      }
    >
      <Card pad={0}>
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
            }}
          >
            <Icon name="search" size={13} color="var(--text-3)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("admin.subs.searchPlaceholder")}
              style={{ border: "none", outline: "none", width: 200, fontSize: 12, background: "transparent", color: "var(--text)" }}
            />
          </div>
          <FilterSelect value={pkg} onChange={setPkg} ariaLabel={t("admin.subs.pkgLabel")}>
            <option value="">{t("admin.subs.filterPkgAll")}</option>
            {packages.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={status} onChange={setStatus} ariaLabel={t("admin.subs.statusLabel")}>
            <option value="">{t("admin.subs.filterStatusAll")}</option>
            {SUB_STATUS_CODES.map((code) => (
              <option key={code} value={code}>
                {statusCodeLabel(t, code, code)}
              </option>
            ))}
          </FilterSelect>
          <span style={{ marginInlineStart: "auto", fontSize: 11.5, color: "var(--text-3)" }} className="num">
            {t("admin.subs.rowCount").replace("{count}", String(rows.length))}
          </span>
        </div>

        {subscribersQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <th scope="col" style={th()}>{t("admin.subs.colOrg")}</th>
                  <th scope="col" style={th(130)}>{t("admin.subs.pkgLabel")}</th>
                  <th scope="col" style={th(90, "center")}>{t("admin.subs.projectsLabel")}</th>
                  <th scope="col" style={th(90, "center")}>{t("admin.subs.usersLabel")}</th>
                  <th scope="col" style={th(120, "right")}>{t("admin.subs.colMrr")}</th>
                  <th scope="col" style={th(130)}>{t("admin.subs.colRenew")}</th>
                  <th scope="col" style={th(110)}>{t("admin.subs.statusLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 60, textAlign: "center" }}>
                      <Icon name="users" size={28} color="var(--text-3)" style={{ opacity: 0.5 }} />
                    </td>
                  </tr>
                ) : (
                  rows.map((s) => {
                    const info = subStatusInfo(s.status);
                    const pkgRow = pkgMap.get(s.packageId);
                    const mrr = deriveMrr(pkgRow, s.cycle, s.status);
                    const userCount = userCounts.get(s.companyId) ?? 0;
                    return (
                      <tr key={s.id} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => openDetail(s)}>
                        <td style={td()}>
                          <div style={{ fontWeight: 600 }}>{s.companyName || DASH}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)" }} className="num">
                            {s.id}
                          </div>
                        </td>
                        <td style={td()}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: pkgRow ? sizeColor(pkgRow.size) : "var(--text-3)" }} />
                            {pkgRow?.name ?? DASH}
                          </span>
                        </td>
                        {/* projects — NO wire count -> em-dash. */}
                        <td style={td("center")} className="num">
                          {DASH}
                        </td>
                        {/* users — DERIVED count over /admin/users. */}
                        <td style={td("center")} className="num">
                          {userCount}
                        </td>
                        {/* MRR — DERIVED from package price + cycle (em-dash when 0). */}
                        <td style={{ ...td("right"), fontWeight: 700 }} className="num">
                          {mrr > 0 ? formatMoney(mrr) : DASH}
                        </td>
                        {/* renew — REAL renew_at, overdue-tinted. */}
                        <td style={{ ...td(), fontSize: 11.5, color: s.status === "overdue" ? "var(--danger)" : "var(--text-2)" }} className="num">
                          {formatDate(s.renewAt) || DASH}
                        </td>
                        <td style={td()}>
                          <StatusBadge tone={info.tone} label={statusLabel(s)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
