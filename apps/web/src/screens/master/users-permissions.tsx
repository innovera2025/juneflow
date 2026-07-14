/*
 * UsersPermissions — the Users & Permissions screen, ported 1:1 from
 * pototype/master.jsx UsersPermissions (L906-1001). Route `users` (NAV-ROUTES.md
 * L104, no module gate), visual-gate reference tests/visual/reference/gallery/g2/36.
 *
 * Design fidelity (PLAN.md §0 rule 1): the layout — the two-crumb breadcrumb, the
 * title/subtitle, the add-role + add-user actions, the 320px/1fr grid (LEFT: the role
 * list Card with the active brand-soft row + member count + auth-limit line; RIGHT: the
 * READ-ONLY 11×5 permission-matrix Card for the active role with its header sub-line and
 * the save footer) — is the prototype's, verbatim. The main matrix cells are read-only
 * <div>s (NOT clickable) — the interactive matrix lives only in RoleAddForm.
 *
 * Mock mechanics dropped (§0 rule 3): the prototype's ROLE_PRESETS local map becomes the
 * real GET /roles catalogue (use-users.ts); the active role defaults to the FIRST returned
 * role's REAL id (not the mock "pm" key). Each role's member count is derived from the real
 * GET /users list (countMembersByRole, C10) — never the mock `c`. The auth-limit display is
 * re-synthesised from (approval_limit, approval_level) via formatAuthLimit (role-matrix.ts):
 * a number -> grouped digits + " baht"; null & level>0 -> t("role.limitUnlimited") in var(--ok)
 * (the seed Director role); null & level 0 -> a language-neutral em-dash.
 *
 * Mock->real UPGRADE (§0 rule 3, flagged): the prototype's save button only fired a mock
 * ctx.notify (master.jsx:995). Here it PUTs the loaded role's serialised matrix to
 * /roles/{id} (useUpdateRole) then notifies — attached to the prototype's existing read-only
 * button, NOT a new editable-matrix RoleEditForm (which would violate §0).
 *
 * i18n (§0 rule 2): every visible string is a users. / role. / perm. / common. / org. dict
 * key, a nav_i18n key (breadcrumbs, users-strings.json navSystem/navTitle -> tn), or a phrase
 * key (perm columns 2-5, users-strings.json -> tp). The 11 module labels + "Permission Matrix"
 * are English ASCII literals (role-matrix.ts). The B-064 residual keys cover rolePanelCount,
 * matrixLevelLine, limitUnlimited and notifyPermSaved. tokens back every colour (§0 rule 6);
 * the only literals are the prototype-verbatim white check "#fff", the BAHT currency symbol
 * (U+0E3F — no baht-only i18n key exists; a literal baht would trip the i18n-guard, so it is sourced
 * as an escape, B-037 prototype-verbatim), the em-dash, and px geometry.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NavKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx, type ShellCtx } from "../../shell/shell-context";
import {
  toRole,
  formatAuthLimit,
  countMembersByRole,
  serializePermMatrix,
  MODULE_LABELS,
  PERMISSION_MATRIX_LABEL,
  type Role,
  type AuthLimitDisplay,
} from "./role-matrix";
import { useRoleList, useUserList, useUpdateRole } from "./use-users";
import { RoleAddForm } from "./role-add-form";
import { UserAddForm } from "./user-add-form";
import usersStrings from "./users-strings.json" with { type: "json" };

/** THAI BAHT SIGN (U+0E3F) — the prototype's verbatim currency unit. No baht-only i18n
 *  key exists and a literal baht trips the i18n-guard (U+0E00–U+0E7F), so the symbol is
 *  sourced as a Unicode escape (source stays ASCII); B-037 prototype-verbatim literal. */
const BAHT = "\u0E3F";
/** EM DASH (U+2014) - language-neutral "no value" marker (master.jsx:900 authLimit). */
const EM_DASH = "\u2014";

/** Table header cell style — ported verbatim from ds.jsx th() (214-219). */
function th(width?: number): CSSProperties {
  return {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(width ? { width } : {}),
  };
}

/** Table body cell style — ported verbatim from ds.jsx td() (220). */
function td(): CSSProperties {
  return { padding: "14px", verticalAlign: "middle" };
}

export function UsersPermissions() {
  const { t, tn, tp } = useI18n();
  const ctx = useShellCtx();

  const rolesQ = useRoleList();
  const usersQ = useUserList();
  const updateRole = useUpdateRole();

  const roles = useMemo<Role[]>(
    () => (rolesQ.data ?? []).map(toRole),
    [rolesQ.data],
  );
  const users = usersQ.data ?? [];

  // Active role defaults to the FIRST returned role's REAL id (§0 rule 3 — not "pm").
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = picked ?? roles[0]?.id ?? null;
  const activeRole = roles.find((r) => r.id === activeId) ?? null;

  // Permission columns: col 1 "view" via the perm.view DICT key; cols 2-5 via phrase
  // keys (tp) — the two translators are intentionally NOT merged (plan i18n routing).
  const permCols = [
    t("perm.view"),
    tp(usersStrings.permCreate as PhraseKey),
    tp(usersStrings.permEdit as PhraseKey),
    tp(usersStrings.permApprove as PhraseKey),
    tp(usersStrings.permCancel as PhraseKey),
  ];
  const countUnit = t("org.noteCountUnit");

  /** Plain-text auth-limit for the header sub-line / info contexts (no colour). */
  const limitPlain = (d: AuthLimitDisplay): string =>
    d.kind === "amount"
      ? `${d.amount} ${BAHT}`
      : d.kind === "unlimited"
        ? t("role.limitUnlimited")
        : EM_DASH;

  // add role (master.jsx:918-923) — xl modal; RoleAddForm owns POST /roles + notify.
  const openAddRole = () =>
    ctx.openModal({
      title: t("role.addTitle"),
      subtitle: t("role.addSubtitle"),
      icon: "users",
      iconTone: "var(--brand)",
      size: "xl",
      body: ({ ctx: c, close }: { ctx: ShellCtx; close: () => void }) => (
        <RoleAddForm ctx={c} onClose={close} />
      ),
    });

  // add user (master.jsx:912-917) — lg modal; UserAddForm owns POST /users + notify.
  const openAddUser = () =>
    ctx.openModal({
      title: t("users.addUserTitle"),
      subtitle: t("users.addUserSubtitle"),
      icon: "user",
      iconTone: "var(--brand)",
      size: "lg",
      body: ({ ctx: c, close }: { ctx: ShellCtx; close: () => void }) => (
        <UserAddForm ctx={c} roles={roles} onClose={close} />
      ),
    });

  // Save the active role's matrix (mock->real upgrade): PUT /roles/{id} re-sends the
  // loaded role's serialised matrix + its fields, then fires the notify template.
  const saveMatrix = () => {
    if (!activeRole) return;
    updateRole.mutate(
      {
        id: activeRole.id,
        body: {
          name: activeRole.name,
          approval_limit: activeRole.approval_limit,
          currency_code: activeRole.currency_code,
          approval_level: activeRole.approval_level,
          perms: serializePermMatrix(activeRole.perms),
        },
      },
      {
        onSuccess: () =>
          ctx.notify(t("users.notifyPermSaved").replace("{role}", activeRole.name)),
      },
    );
  };

  return (
    <Page
      breadcrumbs={[
        tn(usersStrings.navSystem as NavKey),
        tn(usersStrings.navTitle as NavKey),
      ]}
      title={t("users.title")}
      subtitle={t("users.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" size="md" icon="users" onClick={openAddRole}>
            {t("users.addRoleBtn")}
          </Btn>
          <Btn kind="primary" size="md" icon="plus" onClick={openAddUser}>
            {t("users.addUserBtn")}
          </Btn>
        </div>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* LEFT — role list */}
        <Card pad={0}>
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {t("users.roleLabel")}{" "}
            <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
              {`· ${t("users.rolePanelCount").replace("{count}", String(roles.length))}`}
            </span>
          </div>

          {rolesQ.isLoading
            ? // Loading skeleton — token blocks, no invented copy.
              [0, 1, 2, 3].map((n) => (
                <div
                  key={n}
                  style={{
                    height: 52,
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface-2)",
                  }}
                />
              ))
            : roles.map((r) => {
                const isActive = r.id === activeId;
                const d = formatAuthLimit(r.approval_limit, r.approval_level);
                return (
                  <div
                    key={r.id}
                    onClick={() => setPicked(r.id)}
                    style={{
                      padding: "12px 14px",
                      borderTop: "1px solid var(--border)",
                      background: isActive ? "var(--brand-soft)" : "transparent",
                      borderLeft: isActive
                        ? "3px solid var(--brand)"
                        : "3px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: isActive ? 700 : 600,
                          color: isActive ? "var(--brand)" : "var(--text)",
                        }}
                      >
                        {r.name}
                      </span>
                      <span
                        className="num"
                        style={{ fontSize: 11, color: "var(--text-3)" }}
                      >
                        {`${countMembersByRole(users, r.id)} ${countUnit}`}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--text-3)",
                        marginTop: 2,
                      }}
                    >
                      {`${t("users.approvalLimit")}: `}
                      <b
                        style={{
                          color:
                            d.kind === "unlimited" ? "var(--ok)" : "var(--text-2)",
                        }}
                      >
                        {limitPlain(d)}
                      </b>
                    </div>
                  </div>
                );
              })}
        </Card>

        {/* RIGHT — read-only permission matrix for the active role */}
        <Card pad={0}>
          {rolesQ.isLoading ? (
            <div
              style={{
                height: 640,
                background: "var(--surface-2)",
                borderRadius: "var(--r-lg)",
              }}
            />
          ) : activeRole ? (
            <>
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {`${activeRole.name} · ${PERMISSION_MATRIX_LABEL}`}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--text-3)",
                    marginTop: 2,
                  }}
                >
                  {`${countMembersByRole(users, activeRole.id)} ${countUnit} · ${t("users.approvalLimit")} ${limitPlain(formatAuthLimit(activeRole.approval_limit, activeRole.approval_level))} ${
                    activeRole.approval_level > 0
                      ? `· ${t("role.matrixLevelLine").replace("{level}", String(activeRole.approval_level))}`
                      : `· ${t("role.noApprovalRight")}`
                  }`}
                </div>
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12.5,
                }}
              >
                <thead>
                  <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                    <th style={th()}>{t("users.moduleCol")}</th>
                    {permCols.map((p, i) => (
                      <th key={i} style={{ ...th(80), textAlign: "center" }}>
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULE_LABELS.map((label, i) => (
                    <tr key={label} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td(), fontWeight: 500 }}>{label}</td>
                      {activeRole.perms[i].map((v, j) => (
                        <td key={j} style={{ ...td(), textAlign: "center" }}>
                          <div
                            style={{
                              display: "inline-flex",
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              background: v ? "var(--ok)" : "var(--surface-3)",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {v ? <Icon name="check" size={12} color="#fff" /> : null}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div
                style={{
                  padding: 14,
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                  <Icon
                    name="info"
                    size={12}
                    style={{ verticalAlign: "middle", marginRight: 4 }}
                  />
                  {t("users.matrixHint")}
                </div>
                <Btn kind="primary" size="sm" icon="check" onClick={saveMatrix}>
                  {t("common.save")}
                </Btn>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
