# group-C Dashboard Wave-1 — execution-ready spec (orch-B prep · 2026-07-19)

Prepped by a 4-scout + adversarial-synth recon against dev `d7c2d1d` (post batch-12). Recon-first pattern (proven: front-load sacred deps → port compiles clean first try). Full detail: `agents/orch-b-recon/flow-a-group-c.md`.

## Headline
- **Backend + seed = fully autonomous NOW.** All 3 heavy deps verified already-present: GET /audit-log contract (openapi.yaml:2974, EntityList envelope, opaque Entity — NO sacred edit), `ap_billing.due_date` column (finance.ts:177, NO migration), dashboard i18n (P1-PLAT-06, complete).
- **Web already wires all 7 /dashboard/* endpoints** (dashboard.tsx via use-dashboard.ts hooks, generated client) — so lighting the seed makes existing widgets render real data with ZERO web change.
- **ONE sacred round** (net-new activity-feed i18n keys) gates the FE activity WIDGET only — not the endpoint. Ship backend+seed now; defer the widget to Wave-1b after the i18n round.

## Autonomous tasks (no Wei/sacred — start immediately)

### C-SEED-DUEDATE — data zone (RECOMMENDED FIRST · smallest/safest)
Populate `ap_billing.due_date` so the two already-real endpoints light up:
- **alerts (overdue rule, dashboard.ts:656-673):** needs ≥1 ap_billing row with a PAST due_date, status NOT paid/settled.
- **cashflow-forecast (payables leg, dashboard.ts:713-723):** needs ≥1 row with due_date in [today, today+7d].
- **NO migration** (column merged already; `drizzle/**` is sacred — MUST NOT add). Seed file editable.
- **CLAIM `packages/db/src/seed/index.ts` via channel** — shared with group-A.
- **Determinism:** capture ONE UTC-floored `seedToday`; derive due_dates relative to it (not fixed literals). `grep tests for 'due_date'/'dueDate'` first (currently null everywhere → likely none).
- **Gates:** G3 unit + G4 E2E — asserts must be **CLOCK-RELATIVE to seedToday, never hardcode 2026-07 dates** (else flake as calendar advances). Verify tenant-wide view (no ?project_id — ap_billing has no project_id, both legs omitted under project scope).

### C-BE-AUDITLOG — backend (parallel · blocks nothing)
New `apps/api/src/routes/audit-log.ts`: `GET /audit-log?entity=&user=&action=&page=`
- Contract ALREADY declared (openapi.yaml:2974, operationId listAuditLog, tag dms) → response = EntityList (B-014 Paginated envelope, opaque Entity). No contract edit.
- Mirror `dashboard.ts` approvalsInbox exactly: `withTenant` wrapper (dashboard.ts:817-837) reads request.db, 401 fail-closed via `unauthenticated()`; query audit_log through the company-scoped TenantDb door (audit_log.company_id, misc.ts:168); optional entity/user/action WHERE + Page; `listEnvelope(rows)` ordered `at DESC`. Register `registerAuditLogRoute` in app.ts (~:175).
- Row fields (all honest from columns + users join): `{ id, user_id, user_name (join users.name; null→'ระบบ'), action, entity, at }`.
- **Gates:** G2 contract + G3 unit (tenant isolation · null-user→system · each filter). No G5/G1.

### C-BE-DASHVERIFY — QA/backend (verify-not-rebuild)
Confirm all 7 /dashboard/* handlers are real + C10-honest (they ARE — zero stubs): summary/budget-actual/approvals-inbox/phase-progress/contractors already return live data; alerts/cashflow go non-empty AFTER C-SEED-DUEDATE. Pure verify + E2E, no code change. **Gates:** G2 contract-live + G4 E2E (default dashboard view).

## Sacred round (Wei-gated · defers FE widget only)
**i18n round** — net-new activity-feed keys CONFIRMED ABSENT (grep): (1) `dashboard.activityTitle` = "กิจกรรมล่าสุด"; (2) action verb→label map for approve/create/edit/delete/post/sync (existing dashboard.activitySyncSAP/RejectRevise/AutoBudget are specific mock strings, NOT a general map); (3) time-ago suffix "ที่แล้ว" + units "นาที"/"ชม.". Glyph byte-exact (U+2014 em-dash · U+00B7 middot · ฿ U+0E3F · curly quotes). → file BLOCKERS.md i18n round; wire the FE activity widget in Wave-1b.

## Wei rulings — RESOLVED 2026-07-19 (all 3 answered, none block)
1. **Entity fidelity → RAW ACCEPTED.** No display-mapping layer. The real mutation-driven feed shows raw `table:uuid` entity refs; the demo seed's friendly labels are a bonus, not a requirement. C-BE-AUDITLOG returns `entity` as-stored, no lookup layer to build.
2. **G5 activity widget → DYNAMIC OK.** The visual gate treats the activity feed as legitimate API-driven real/empty data (port-screen C-rule), NOT a pixel-match against the prototype's fixed 5-row mock (g1/01). No G5 fail for the widget rendering different/real rows.
3. **Cashflow net → NEGATIVE (payables-only) ACCEPTED for demo.** No ar_invoice credit-term tweak needed; the 7-day window showing payables-only negative net is fine. (ar receivables at ~today+30d stay out of window — expected.)

Net effect: the FE activity widget (Wave-1b) is simplified (raw entity, no mapping) and its ONLY remaining gate is the net-new i18n round. All three flags cleared — group-C Wave-1 has zero open Wei questions.

## Sequencing
C-SEED-DUEDATE (first, proves the reuse claim) ‖ C-BE-AUDITLOG (parallel) → C-BE-DASHVERIFY (after seed) → [Wei i18n round] → Wave-1b FE activity widget. orch-A executes; orch-B verifies (live E2E clock-relative + dashboard render).
