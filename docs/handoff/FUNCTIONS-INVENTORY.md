# ภาคผนวก — Function Inventory (สแกนอัตโนมัติจากโค้ด prototype ทั้งหมด)

> component/function ที่ประกาศจริงในไฟล์ .jsx · ใช้ตรวจความครบถ้วนคู่กับ FUNCTIONS.md

## accounting-extra.jsx
- 12 functions: COA_CLASSES, COA_SEED, GLChartOfAccounts, COAForm, AGING_AP, AGING_AR, agRowTotal, FinAging, REVREC_SEED, WIP_SEED, GLRevenueWIP, WIPTransferForm

## accounting-extra2.jsx
- 16 functions: RETENTION_SEED, RET_ST, APRetention, ARCN_SEED, ARCN_REASONS, ARCreditNote, ARCNForm, CASHFLOW_DATA, GLCashFlow, PROJPL_SEED, plRev, plCogs, plGP, plEBIT, plNP, GLProjectPL

## ai-qto-fullscreen.jsx
- 1 functions: BIMFullscreen

## ai-qto-viewer.jsx
- 4 functions: iso, qtoGroupOf, QTO_LAYERS, BIMViewer

## ai-qto.jsx
- 8 functions: QTO_FILETYPES, QTO_PROC_STEPS, QTO_ELEMENTS_FOUND, QTO_ROWS_SEED, QTO_CAT_TONE, AIQuantityTakeoff, QTOReview, QTOSummary

## ap.jsx
- 10 functions: AP_BILL, APBilling, BillingForm, PV_LIST, APPaymentVoucher, PVCreateForm, APCreditDebit, APDeposit, APDepositForm, CNDNForm

## ar.jsx
- 6 functions: AR_INV, ARInvoice, ARInvoiceForm, ARTaxInvoice, ARReceiveVoucher, RVCreateForm

## bank.jsx
- 3 functions: BankCheque, BankReconciliation, BankExport

## bom.jsx
- 9 functions: BOM_CAT, BomCatChip, BOM_MODELS, BOM_LINES, bomTotal, bomCatTotal, BOMTemplates, bomTh, bomTd

## boq-extra.jsx
- 17 functions: CBS_BUDGET, BOQ_AUDIT, PR_REQUESTERS, PR_DELIVERY, bahtK, openBOQtoPR, BOQtoPRForm, openBOQRevise, BOQReviseForm, BOQLockedBanner, BudgetControlBar, BOQAuditDrawer, ReportCard, BOQReportMSL, BOQReportVariance, BOQReportEVM, BOQReportsExtra

## boq-list.jsx
- 9 functions: BOQStore, useBOQDocs, BOQ_PROJECTS, BOQ_USERS, BOQ_STATUS_FILTER, BOQList, openNewBOQ, NewBOQForm, ExcelImportInline

## boq.jsx
- 29 functions: CAT, CatChip, BOQTabBar, BOQOverview, ScopePill, FlowRow, BOQ_BALANCE, BOQBalanceTable, INITIAL_GROUPS, INITIAL_ROWS_BY_GROUP, BOQEditor, menuItem, BOQEditorRow, BOQItemForm, GroupForm, APPROVAL_LIST, DIFF_ROWS, BOQApproval, FileListBody, DiffStat, NotifyRow, ARCHIVE, BOQArchive, BOQReports, BOQArchiveFilter, BOQArchiveExport, BOQReportFilter, BOQReportPrint, BOQReportExport

## charts.jsx
- 3 functions: chartTheme, ChartCanvas, baseChartOpts

## chrome.jsx
- 13 functions: PROJECTS, ProjectStore, useProjects, Logo, NAV, ROUTE_LABELS, PARENT_ID_OF_ROUTE, Sidebar, ProjectSwitcher, NotificationsPopover, SearchPalette, UserMenuPopover, TopBar

## company-accept.jsx
- 8 functions: COMPANIES, PROJECT_COMPANY, companyOf, activeCompanyId, CompanySwitcher, ACCEPT_TYPES, ACCEPT_ITEMS, AcceptanceCenter

## dashboard.jsx
- 7 functions: RANGE_DATA, BudgetActualChart, Donut, Kpi, ApprovalRow, PhaseProgressRow, Dashboard

## datepicker.jsx
- 8 functions: TH_MONTHS, TH_MONTHS_SHORT, TH_DAYS, fmtThaiDate, DatePicker, ctlBtn, quickBtn, RangeSwitch

## design-canvas.jsx
- 12 functions: DC, DCCtx, dcFlatten, DC_STATE_FILE, DesignCanvas, DCViewport, DCSection, DCArtboard, DCArtboardFrame, DCEditable, DCFocusOverlay, DCPostIt

## dms.jsx
- 5 functions: DMS_CATS, DMS_SEED, DMS_ST, DMSCenter, DMSUploadForm

## ds.jsx
- 18 functions: fmt, fmtDec, Icon, STATUS, StatusBadge, Btn, Card, Bar, Kbd, Avatar, th, td, Filter, Tag, Page, TabBar, MiniKpi, Dropdown

## etax.jsx
- 3 functions: ETAX_SEED, ETAX_ST, TaxETax

## exec-audit.jsx
- 4 functions: ExecDashboard, AUDIT_ENTRIES, AUDIT_ACT, AuditLog

## extra-screens.jsx
- 7 functions: ScreenLogin, REPORT_CATS, ReportsHub, SettingsCompany, NOTIFS, NotificationsCenter, ForgotForm

## fa.jsx
- 17 functions: ASSETS, FA_CATS, FA_LOCS, FA_CC, FA_ACCT, FA_METHODS, FARegister, AssetForm, AssetImportForm, AssetDetail, FADepreciation, DeprRunForm, ADJ_ROWS, FAAdjust, RevalueForm, WriteOffForm, AdjustDetail

## finance.jsx
- 6 functions: AP_INVOICES, FinanceAP, AR_CUSTOMERS, FinanceAR, GL_ENTRIES, FinanceGL

## forms.jsx
- 20 functions: VendorPick, approveDoc, rejectDoc, reviseDoc, cancelDoc, openCreatePO, openCreateWO, openCreateGR, openReturnGR, PR_FOR_PO, POCreateForm, SUBCON_OPTS, WOCreateForm, PO_FOR_GR, GRCreateForm, ReturnForm, PR_TYPE_TABS, BOQ_ITEMS_FOR_PR, openCreatePR, PRCreateForm

## gl.jsx
- 16 functions: JV_LIST, GLJournalVoucher, COA, JVCreateForm, POST_INBOX, DEFAULT_POSTING_FILTER, GLPostingInbox, FilterChip, PostingInboxFilter, TRIAL, GLTrialBalance, GLStatements, StmtSection, BalanceSheet, ProfitLoss, GLPeriodClose

## gr.jsx
- 3 functions: GR_ROWS, RETURN_ROWS, GRList

## i18n.jsx
- 11 functions: LANGS, langResolve, DICT, I18N, useLang, t, LanguageSwitcher, NAV_I18N, tn, PHRASES, PHRASE_PATTERNS

## inventory.jsx
- 13 functions: ITEMS, InventoryItems, InventoryStock, TRANSFERS, InventoryTransfer, ISSUES, InventoryIssue, ItemAddForm, ItemImportForm, ItemExportForm, WarehouseAddForm, TransferAddForm, IssueAddForm

## ios-frame.jsx
- 7 functions: IOSStatusBar, IOSGlassPill, IOSNavBar, IOSListRow, IOSList, IOSDevice, IOSKeyboard

## labor.jsx
- 8 functions: LABOR_TEAMS, WORKERS_SEED, LaborWorkers, WorkerForm, ATT_OPTS, LaborAttendance, PAYROLL_SEED, LaborPayroll

## land.jsx
- 13 functions: LAND_STAGES, LAND_PLOTS, TENURE_LABEL, plotArea, plotPrice, areaText, landPlotsForActive, LandKpi, LandPipeline, LandBank, LandPlotForm, openPlotDetail, openExportModal

## land2.jsx
- 11 functions: SurveyRow, LandSurvey, FeasStat, DD_ITEMS, DD_ST, LandDueDiligence, DealField, openSurveyForm, SurveyForm, openContractDraft, openContractConfirm

## line-oa.jsx
- 22 functions: LINE_GREEN, LINE_BG, LineFrame, DateSep, Bubble, CardBubble, QuickReplies, InputBar, LineHome, LineReport, LineTrack, LineWarranty, LinePayment, LinePromo, LineCommon, LineSales, LiffReport, LiffTrack, LinePush, LineBind, LINE_SCREENS, LineOAPreview

## line-pm.jsx
- 4 functions: LinePMPlan, LinePMQuote, LinePMCert, LinePMContracts

## linked-docs.jsx
- 6 functions: LINKED_DOCS, openLinkedDocs, LinkedDocsBody, ChainPill, ChainArrow, RelatedDocsList

## master-party.jsx
- 10 functions: VENDOR_SEED, VEN_TYPES, CUSTOMER_SEED, CUS_TYPES, PartyKpi, partyFld, MasterVendor, VendorForm, MasterCustomer, CustomerForm

## master.jsx
- 25 functions: ORG_SEED, OrgAddForm, MasterCompany, BLOCK_SEED, BLOCK_COLORS, BlockAddForm, MasterProject, MODELS, ModelAddForm, MasterModel, CC_SEED, CCAddForm, MasterCC, DOCNUM_SEED, RESET_OPTS, LOCK_OPTS, DocNumForm, MasterDocNum, ROLE_PRESETS, UsersPermissions, UserAddForm, RoleAddForm, SyncStatus, openCreateProject, CreateProjectForm

## mobile-field.jsx
- 4 functions: MStGRList, MStReceive, MFmProgress, MFmAccept

## mobile-pm.jsx
- 6 functions: MPMJobs, MPMCheckin, MPM_RESULTS, MPMChecklist, MPMNotes, MPMClose

## mobile-preview.jsx
- 3 functions: MOBILE_GROUPS, MobilePreview, MobileScreenRouter

## mobile-screens.jsx
- 17 functions: MTabBar, MSection, MField, MInput, MPill, MSrvNewReport, MSrvTrack, MTechJobs, MTechClose, MFieldProgress, MFieldGR, MFieldQuickPR, MFieldStock, MFieldCheckin, MFieldHSE, MExecDashboard, MSalesCRM

## mobile.jsx
- 7 functions: MobileStatusBar, MobileHeader, MobileApprovalInbox, MobileApprovalDetail, MobileApproveSheet, MobileRejectSheet, MobileNotifications

## modal.jsx
- 2 functions: Modal, ConfirmDialog

## opex-budget.jsx
- 7 functions: OPEX_SEED, OPEX_MONTHLY, OpexBudget, OpexTransferForm, OPEX_HIST_YEARS, OPEX_HISTORY, OpexMultiYear

## petty-alloc.jsx
- 6 functions: PETTY_TX, PettyCash, ALLOC_CAT, AllocateCost, PettyTopupForm, PettyClaimForm

## pkg-builder.jsx
- 18 functions: pkgNavGroups, pkgAllIds, pkgPresetIds, PKG_STORE, usePkgList, openPkgBuilder, PkgBuilderForm, PkgAdminGrid, tenantPkg, pkgMenuAllowed, setTenantPkg, PkgDemoSwitcher, PKG_SUB_RULES, pkgSubMenuAllowed, aiQuota, consumeAiCredit, AiQuotaChip, openAiQuotaModal

## pm-checklist.jsx
- 6 functions: PM_CHECKLIST_TEMPLATES, openChecklistPicker, ChecklistPicker, openChecklistManager, ChecklistManager, ChecklistEditor

## pm.jsx
- 14 functions: PM_ASSETS_BY_TYPE, PM_STATUS, pmAssets, PM_MONTHLY, PM_WOS, PMWO_STATUS, PM_CONTRACTS, PMC_STATUS, PMKpi, PMDashboard, PMAssets, PMAssetForm, openAssetDetail, openPMExport

## pm2.jsx
- 16 functions: PMContracts, openAddProject, AddProjectPicker, openProjectContracts, openContractDetail, pmProjectInfo, PMContractWizard, activeProjectTypeFor, SelectOther, PMContractForm, PMSchedule, PM_PLAN_ITEMS, PM_DAY_MARKS, PM_TONE, PMCalendar, PMUpcoming

## pm3.jsx
- 8 functions: PM_CHECKLIST, RESULT_OPTS, nextResult, PMWorkOrders, PMWorkOrderDetail, PhotoChip, NoteField, PMWOForm

## po-wo.jsx
- 7 functions: PO_ROWS, POList, SmallStat, POForm, WO_ROWS, WOList, WOForm

## pr-form.jsx
- 9 functions: Field, Input, Select, TYPE_TABS, ITEMS, APPROVERS, ApprovalChain, BudgetBar, PRForm

## pr-list.jsx
- 6 functions: PR_TYPES, PR_ROWS, TypeChip, ApprovalSteps, PRList, thLocal

## project-type-screen.jsx
- 6 functions: MODULE_LABELS, ALL_MODULES, MasterProjectType, TYPE_ICONS, TYPE_COLORS, ProjectTypeForm

## project-types.jsx
- 8 functions: PROJECT_TYPES, PROJECT_TYPE_LIST, activeProject, activeProjectType, moduleOn, TypeBadge, routeModule, routeAllowedForProject

## real-forms.jsx
- 15 functions: RF_fld, openChequeForm, RFCheque, openBankImport, RFBankImport, openReconcileConfirm, openPayForm, RFPay, openReceiveForm, RFReceive, openBOQPick, RFBOQPick, openCustHistory, openInvoiceForm, RFInvoice

## real-forms2.jsx
- 30 functions: RF2_fld, openAttachModal, RF2Attach, openLineItemForm, RF2LineItem, openVarOrderForm, RF2VO, openPkgForm, RF2Pkg, openInviteUserForm, RF2Invite, openNotifySend, openAssetEditForm, RF2AssetEdit, openOMTicketForm, RF2OMForm, RF2OMView, openPermitForm, RF2Permit, openWarrantyForm, RF2Warranty, openMilestoneForm, RF2Milestone, openVendorCompare, openBankMatch, RF2BankMatch, openBatchConfirm, openDocHistory, openFilterModal, RF2Filter

## sales-crm.jsx
- 7 functions: SalesDashboard, LEADS_BY_STAGE, HOT_TONE, SalesCRM, LeadForm, LeadDetail, SalesReportDialog

## sales-process.jsx
- 9 functions: CustomerPicker, SalesProcess, QuoteForm, BookingForm, ContractForm, SalesDown, DownPaymentReceiveForm, SalesLoan, TransferForm

## sales-service.jsx
- 6 functions: SERVICE_TICKETS, PRIO_COLOR, SVC_STATUS, AfterSalesService, TicketDetail, NewTicketForm

## shell.jsx
- 9 functions: TWEAK_DEFAULTS, ACCENT_PALETTES, applyTweaks, AppShell, RouteView, Placeholder, TweaksPopover, TwSection, SegSwitch

## solar.jsx
- 6 functions: SolarKpi, SolarMonitoring, SolarPPA, SolarROI, SolarPermit, SolarWarranty

## subcon-accept.jsx
- 9 functions: SUBC_CONTRACTS, SUBC_METHOD, PERIOD_STATE, SUBC_CONTRACT, ACCEPT_CHECKLIST, SubcKpi, SubconContracts, openSubcContractForm, SubcContractForm

## subcon-accept2.jsx
- 4 functions: SubconAccept, SUBC_DMS_DOCS, AcceptForm, SubconHandover

## subcon.jsx
- 7 functions: SUBCONS, PROGRESS_PAYMENTS, VARIATIONS, SubconProgress, CheckRow, SubconSummaryReport, SubconAddForm

## subscription-admin.jsx
- 11 functions: SUBSCRIBERS, SUB_ST, COMPANY_USERS, companyUsers, AdminKpi, AdminOverview, AdminSubscribers, AdminPlans, AdminInvoices, CompanyControl, seatBtn

## subscription-flow.jsx
- 5 functions: quotaStatus, openQuotaBlock, quotaGuard, openSignup, SignupWizard

## subscription.jsx
- 9 functions: SUB_PACKAGES, SUB_PKG, MY_SUB, SUB_INVOICES, pctTone, limitText, SubMine, SubPlans, SubBilling

## tax-forms.jsx
- 13 functions: FormPage, btnDark, TaxIdBoxes, TH_MONTHS_FULL, PND30Form, AddrCell, PND53Form, WHTCertificate, PartyBox, bahtText, openPND30, openPND53, openWHTCertificate

## tax.jsx
- 2 functions: TaxVAT, TaxWHT

## timeline.jsx
- 8 functions: openImportBOQ, IMPORT_PREVIEWS, ImportBOQBody, TIMELINE_TASKS, MILESTONES, TODAY_DAY, ProjectTimeline, TaskDetail

## tweaks-panel.jsx
- 15 functions: __TWEAKS_STYLE, useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, __twkIsLight, __TwkCheck, TweakColor, TweakButton

