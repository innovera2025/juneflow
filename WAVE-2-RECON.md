# Wave-2 (Finance) Recon — Evidence (orch-A Stream-3 · 2026-07-17)

> Read-only recon feeding WAVE-2-COMPLETENESS.md. All claims file+line cited.

## Naming
MVP-PROPOSAL.md:116 calls finance "Wave-3"; Wei's "Wave-2" = this finance touch (same thing). TASKS.md:157-194 Phase-2 header has NO finance rows yet (only FLOW-A P2-BE/WEB). B-069 ruling 3 = cost-side only, no AR/sales (Phase 5 defer).

## Reusable pattern (B-070 ratified)
Approval matrix = flows.html authoritative, enforced via `role.approvalLevel` threshold constants in code (NOT seeded `role.approvalLimits` jsonb which only has blanket `default` — pr.ts:32-35). Contract-extend via SACRED_OVERRIDE batches. Type-mapping in display layer. Additive migrations 0012+ precedent. **Opaque-Entity finding (FLOW-A-RECON): reads on opaque endpoints need no contract change** — BUT most finance read endpoints don't exist yet (new sacred paths), and existing finance POST bodies are narrow-typed (not opaque) → widening = sacred edit.

## Per-screen evidence

### ap.billing (APBilling · ap.jsx:1-154)
- Prototype: AP_BILL 5 rows {no,vendor,ref(GR/WO),inv,amount,vat,wht,due,status,aging,retention,over}. 4 KPI + tabs + 10-col table + BillingForm modal (vendor/GR-WO ref/invoice/VAT7%/WHT + hard-coded GL preview Dr5101/2103 Cr2101/2102).
- Schema finance.ts:149-174 ap_billing {id,companyId,poId FK,grId FK,vendorId FK,invoiceNo,dueDate,amount,vat,currencyCode,status,kind(enum 0019)}. **Missing: wht, retention, woId** (row AP-2026-0180 ref "WO-2026-0117 งวด3" = subcon billing vs WO). Seed:768-781 drops wht/retention/wo-ref.
- Contract openapi:1964-1988 POST /ap/billing narrow {po_id,gr_id,invoice_no} only. No GET list/detail. No ap.ts route.
- Gap: reads additive-once-path-exists (opaque); wht/retention/woId = additive migration; widen POST = sacred.

### ap.pv (APPaymentVoucher · ap.jsx:160-315)
- Prototype: PV_LIST 4 rows {no,payee,ref(AP),amount,method,chequeNo,chequeBank,net,wht,retention,status,date}. PVCreateForm: AP picker + 4-way method (cash/transfer/cheque/deposit-offset) + net calc (gross −WHT% −Retention% = net) + แนบใบเสร็จ/พิมพ์50ทวิ. Submit=รออนุมัติ (pending on create · has approval step).
- Schema finance.ts:185-202 pv {id,companyId,billingIds(jsonb),whtPct,net,currencyCode,batchId,status}. **Missing: method, cheque fields, retention, gross amount** (only net+whtPct). cheque table finance.ts:331-347 has NO pvId FK. Seed:1258-1263 inserts only net+whtPct hardcoded "3.00".
- Contract openapi:1989-2026 POST /ap/pv narrow {billing_ids[],wht_pct}; POST /pv/{id}/approve exists. No GET. bank/export-batch:2027-2042 opaque Entity body (the Export-to-Bank action). No pv.ts route.

### bank.recon (BankReconciliation · bank.jsx:83-156, NAV-ROUTES:80)
- Prototype: STMT 8 rows {date,desc,v(signed),matched(docno|null)}. 4 KPI + จับคู่ button. Modals (real-forms.jsx:56-104, real-forms2.jsx:430-462) ALL toast/mock — openBankImport fake "42 rows 38 auto-matched", openBankMatch = 4-pair hand-toggle NO real algo, openReconcileConfirm static. Adjacent: bank.cheque (bank.jsx:3-81 register issued/cleared/returned, xref PV by string), bank.export (bank.jsx:158-253 batch approved-PV → KBANK/SCB/BBL file — matches bank-file package 1:1).
- Schema finance.ts:355-396 bank_statement {id,companyId,period,lines(jsonb),locked} + reconcile {id,companyId,statementId FK,periodId FK,matched(jsonb),locked}. Seed:1306-1312 one bank_statement per line (embedded single-elem jsonb array). No reconcile rows seeded. cheque no FK to statement/reconcile/pv.
- Contract openapi:2210-2249 POST /bank/statements/import (multipart), POST /bank/reconcile ({period}). No GET list, no per-line match mutation, no bank/cheque path. No bank.ts route.
- Gap = largest core: no list-read; match has NO algo to port (decorative); jsonb lines awkward for match-write → normalized bank_statement_line (gr_item precedent) better; cheque↔pv FK missing.

### gl.projectpl (GLProjectPL · accounting-extra2.jsx:343-494)
- Prototype: PROJPL_SEED 5 rows each {revenue[],cogs[],sga,interest}. plRev/plCogs/plGP/plEBIT/plNP compute Rev→GP(Rev−COGS)→EBIT(GP−SGA)→NP((EBIT−interest)×0.8 flat 20% tax). 4 KPI + row/project + detail modal (full income statement + GP/Net margin badges).
- Schema: GL foundation EXISTS — gl_account (finance.ts:93-113 self-ref parentId tree, code+name, **NO type column**), jv/jv_line (274-321, jv_line has accountId/dr/cr/ccId/projectId = per-project bridge), accounting_period (120-137). Seed:1282-1284 23 glAccounts FLAT (no parentId); 1286-1303 7 JV_BOOKS balanced but pointing rjp; **NO revenue-side JV lines** — ar_invoices seeded standalone no JV. JV.source = free-text ("REM"/"Manual"/"GR auto") NOT table:uuid → "is posted" query has no working data.
- Contract openapi:2186-2196 GET /gl/reports/project-pl opaque EntityOk (additive-free response). Also GET /gl/posting-inbox, POST /gl/post, GET/POST /gl/jv, GET /gl/coa, trial-balance, statements, cashflow, close-period — all opaque, NONE implemented. No gl.ts route.
- Gap = biggest: needs account-type classification (schema gap · code-prefix 4xxx=rev 5xxx=exp convention exists) + revenue-recognition (blocked B-069 cost-only) + gl.inbox needs posted-marker (none in seed).

## Adjacent (brief)
ap.retention (accounting-extra2.jsx:20-104 · no retention-ledger table · PLAN Appendix B lists it unbuilt) · ap.cn-dn/ap.deposit (ap.jsx · no AP-side tables) · ap.aging (accounting-extra.jsx:184 · query over ap_billing by bucket) · gl.coa (GET /gl/coa + COA_SEED ready · handler-only) · gl.jv+gl.inbox (B-069 named minimum GL scope). packages/bank-file (BankFileFormatter + FakeBankFileFormatter working · UNWIRED · 0 usage in apps/api) · packages/tax-engine (calcWht/calcVat/renderRdForm/submitETax typed fake · UNWIRED).

## 6 Design Forks (options only — see WAVE-2-COMPLETENESS.md §3 for full)
- **F-GL1** gl.projectpl revenue vs B-069 cost-only (HIGHEST stakes · ก cost-only/ข ar_invoice-read/ค seed-static/ง defer)
- **F-GL2** GL account type (ก enum/ข code-range/ค accountant)
- **F-PV1** PV approval tier — no Finance Manager role seeded (ก reuse pm/dir+perm-gate/ข seed role/ค other)
- **F-BANK1** match algorithm — no prototype logic (ก exact+date/ข manual/ค fuzzy)
- **F-BANK2** bank line shape (ก normalize/ข jsonb)
- **F-AP1** WHT/retention persist (ก migration/ข derived) + tax-engine wire?

## Size
gl.jv/inbox/coa = S (handler-only). ap.billing/pv = M each. bank = M-L. gl.projectpl = L-XL (own packet candidate). Total ≥ FLOW-A Wave-1. 4-7 migrations (0025+). i18n ~100-200 keys. web 6-9 screens.

## Limitations
Did not open docs/extract/MOCK-DATA.md/GAPS.md finance §. Did not check apps/mobile (MVP-B excludes). ar_invoice/aging/deposit/cn-dn only briefly assessed.
