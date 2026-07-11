// @juneflow/db - Drizzle schema root (Phase 0 scaffold - checklist only).
//
// Schema gate G1 (PLAN.md section 6/9) = data-dictionary + Appendix B, BOTH complete:
//   - Base schema: ~34 entities from docs/handoff/data-dictionary.html + erd.html
//     (until P0-BE-02 is done, read design_handoff_juneflow/ originals).
//   - Mandatory extensions: PLAN.md Appendix B (14 items, present in pototype
//     but missing from the dictionary).
//
// Global-readiness hard requirements (PLAN.md section 4) - apply to EVERY table:
//   - all timestamps stored as UTC (timezone / Buddhist-Gregorian calendar is a
//     user/tenant display setting)
//   - every money column carries currency_code + functional currency per tenant
//   - land area stored in square meters only (rai-ngan-wa / acre / ha at display)
//   - id is PK on every table, *_id are real FKs - never name-text FKs
//     (mock name-text FKs are a prototype mechanism, PLAN.md section 0 rule 3)
//
// Conflict decisions already ruled by Wei (PLAN.md Appendix C) are marked C2..C9
// below. Any NEW conflict -> BLOCKERS.md, never decide locally.
//
// =============================================================================
// DONE(P0-BE-06) - group: Platform / Tenant (data-dictionary "Platform / Tenant")
//                  -> implemented in ./platform.ts, re-exported below.
// =============================================================================
// [x] company            - (Tenant) name / tax_id / address (juristic info for
//                          e-Tax), subscription_id, status: active | suspended
// [x] package            - size S/M/L/Full, name, price_m, price_y
//                          (S=2900 M=7900 L=14900 Full=contact),
//                          limits json {projects, users, storage_gb, ai_per_month}
//                          (-1 = unlimited; key names per decision C5:
//                          storage_gb / ai_per_month, NOT storage / ai),
//                          menus string[] (46 nav ids) + sub_rules
//                          (ptype -> Full, aiqto -> M+)
// [x] subscription       - company_id, package_id, cycle, renew_at,
//                          status: active | expiring | overdue | cancelled
// [x] platform_invoice   - subscription_id, amount, status: paid | pending | overdue
// [x] ai_usage           - company_id, month, used (monthly AI QTO quota cut)
// [x] user               - email, name, role_id, status: active | blocked
// [x] role               - approval_limits json (approval cap per doc type);
//                          perms matrix -> Appendix B item 13 below
// [ ] better-auth tables - session/account/etc., self-hosted in our Postgres
//                          (P0-BE-11, PLAN.md Appendix A - no hosted auth)
//
// =============================================================================
// TODO(P0-BE-07) - groups: Project/Master + BOQ/Procurement + Subcon/Acceptance
//                  + PM (CMMS) (decisions C2, C3 land here per TASKS.md)
// =============================================================================
// -- data-dictionary "โครงการ / Master" --
// [ ] project            - name, type: realestate | solar | civil | service,
//                          budget, status
// [ ] project_type       - hierarchy string[] (e.g. [site, zone/Array, string,
//                          inverter]), modules json (menus per type, stacked
//                          with package)
// [ ] phase / block / unit - tree via parent_id + model_id (house model) +
//                          sales status (labels per project type)
// [ ] cost_center        - code, name, project_id (attached to every cost doc,
//                          incl. land survey work)
// [ ] vendor             - master, kind supplier | subcon flag (AP pulls from here)
// [ ] customer           - master, buyer / PM customer (AR pulls from here)
// -- data-dictionary "BOQ / จัดซื้อ" --
// [ ] boq_doc            - no, name, scope, version, status:
//                          draft | pending | approved(locked) | revise
//                          (revise = new version of the whole doc)
// [ ] boq_item           - code, name, cat: M material | L labor | S lump-sum,
//                          qty, unit, price, cc_id, remain_qty (cut when PR
//                          opens), element_id fk? (traceability to CAD/BIM
//                          element - AI QTO)
// [ ] bom                - template; BOQItem can come from a BOM template
// [ ] cbs_budget         - group_id, budget, used, committed (budget control
//                          per group + over-budget warning)
// [ ] pr                 - no, type: material | subcon | expense | advance,
//                          project_id, need_date, status, approval_step
// [ ] po                 - vendor_id, total, vat, credit_term
// [ ] variation_order    - dir add | cut, amount, reason (attached to PO)
// [ ] wo                 - subcon PO counterpart; WO -> N WorkPeriod
// [ ] gr                 - po_id, received, rejected, photos[] (reject ->
//                          defect_report + notify vendor)
// [ ] defect_report      - generated from GR rejection
// -- data-dictionary "ผู้รับเหมา / ตรวจรับ" --
// [ ] subcon_contract    - no, value, retention_pct, start, end (contract + PO
//                          docs attached into DMS)
// [ ] work_period        - seq, basis, target, pct, amount, status
//                          - C2: basis has a 4th value -> percent | distance(m)
//                            | milestone | unit (per-house lump sum)
//                          - C3: status per flows/dictionary state machine ->
//                            pending | delivered | inspecting | passed |
//                            rejected | paid (mock values mapped at seed)
// [ ] acceptance         - inspector, photos[], docs[], signed_at (foreman
//                          inspects via mobile)
// [ ] defect             - item, severity, before/after photo, due,
//                          status: open -> fixing -> recheck -> closed
// -- data-dictionary "PM (CMMS)" --
// [ ] pm_contract        - mode: MA | per-visit (per-visit spreads onto
//                          calendar), visits_per_year, sla, value, end
// [ ] pm_asset           - kind, site, cycle, next_due (type-aware: lift /
//                          inverter / crane / ...)
// [ ] pm_workorder       - tech, checkin_gps, items[{label,result,before,after}]
//                          (result: normal | adjust | repair), cause, fix,
//                          advice, customer_sign (close -> certificate -> LINE)
// [ ] checklist_template - kind, items[] (central config, picked at WO creation)
//
// =============================================================================
// TODO(P0-BE-08) - groups: Finance-Accounting / Subscription + "อื่นๆ"
//                  (decisions C4, C5, C9 land here per TASKS.md)
// =============================================================================
// -- data-dictionary "การเงิน-บัญชี" --
// [ ] ap_billing         - 3-way match (po, gr, inv)
// [ ] pv                 - wht_pct, net (WHT withheld -> issue 50 tawi),
//                          batch_id (Export to Bank)
// [ ] ar_invoice         - credit_term, vat, etax_status - C4: superset
//                          queued -> sent | rejected + void (UI per pototype)
// [ ] rv                 - receipt voucher against AR invoice
// [ ] jv                 - lines[{account_id, dr, cr, cc_id, project_id}] -
//                          C9 shape per dictionary; every money doc ->
//                          GLPosting -> JV (double entry); trial balance /
//                          statements / project P&L / cashflow derive from JV
// [ ] gl_account         - COA tree: standard chart + mapping per doc type
// [ ] cheque             - bank side documents
// [ ] bank_statement     - import statement -> auto/manual match
// [ ] reconcile          - close period locks back-posting
// [ ] fixed_asset        - cost, life_years, cc_id, depr_method (monthly
//                          depreciation -> auto JV)
// [ ] worker             - labor master (labor cost -> project cost)
// [ ] attendance         - labor time records
// [ ] payroll            - labor payout
// [ ] opex_budget        - dept, year, months[] (OPEX multi-year compare)
// -- data-dictionary "อื่นๆ" --
// [ ] land_plot          - deed_no, area (STORE m2 per PLAN.md section 4;
//                          rai-ngan-wa at display), gps, price_per_rai, stage
//                          (7-step pipeline), tenure, DD checklist json
// [ ] sales_unit         - unit_id, customer_id, stage, booking, contract,
//                          down[], loan, transfer (ties AR + house acceptance
//                          Defect)
// [ ] document           - (DMS) cat, project_id, version, expiry, link_module
//                          (every module auto-attaches; 60-day expiry warning)
// [ ] notification       - user_id, type, ref, read (center + Mobile + LINE)
// [ ] audit_log          - user, action, entity, before/after, ip, at
//                          (every create/update/approve/void - written by
//                          middleware, see apps/api/src/plugins/audit-log.ts)
//
// =============================================================================
// TODO(P0-BE-09) - PLAN.md Appendix B mandatory extensions (all 14 items;
//                  in pototype but not in data-dictionary - designed from
//                  screens + mock per docs/extract/MOCK-DATA.md).
//                  G1 FULL gate = dictionary above + all 14 below.
// =============================================================================
// [ ]  1. Inventory        - Item / Warehouse / StockTransfer / MaterialIssue
// [ ]  2. Lead/CRM         - 5-stage funnel
// [ ]  3. ServiceTicket    - after-sales repair requests
// [ ]  4. Solar            - Inverter O&M / PPA invoice / ROI / Permit steps /
//                            Warranty registry
// [ ]  5. Timeline         - Task / Milestone Gantt
// [ ]  6. PettyCash        - petty cash transactions
// [ ]  7. OrgStructure     - ORG_SEED
// [ ]  8. DocNumbering     - DOCNUM_SEED
// [ ]  9. Retention ledger
// [ ] 10. RevRec/WIP
// [ ] 11. AR CreditNote
// [ ] 12. BidComparison
// [ ] 13. Role.perms matrix - 11 modules x 5 permissions
// [ ] 14. Multi-company group - COMPANIES + docPrefix
//
// Table definitions land in per-group files; re-export from this file so
// drizzle.config.ts and @juneflow/api see one schema root.

export * from "./platform.js";
