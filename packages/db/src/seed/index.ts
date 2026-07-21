// @juneflow/db — seed entrypoint (P0-BE-10).
//
// Persists the prototype mock records (docs/extract/MOCK-DATA.md §"สรุปสำหรับทำ
// seed data") into Postgres. The app READS from the DB — mock data is never
// regenerated at runtime (PLAN.md §0 rule 3 / §6). Re-running is safe: the whole
// run is ONE transaction that TRUNCATEs every table first, then re-INSERTs, so
// counts stay 1:1 (QA asserts them — P0-QA-06).
//
// Fidelity: transaction rows are transcribed VERBATIM from the source .jsx
// (cited file:line per constant) — names, quantities, amounts, statuses are the
// real mock values, not fabricated fill. Only the mock's presentational/mechanism
// bits (name-text FKs, Thai-BE date strings, hardcoded NAV badges) are dropped.
//
// Decision mappings applied at seed time (PLAN.md Appendix C / P0-BE-10 rules):
//   - rule 1  name-text FKs normalized to real uuid FKs via fixed ids (see ids.ts);
//             parents inserted before children, wired by uuid.
//   - C3      WorkPeriod mock states → dictionary state machine:
//             accepted → passed, requested → delivered, rejected/pending kept.
//             Period counts per contract = 4/4/3/5 (subcon-accept.jsx SUBC_CONTRACTS).
//   - C6      Vendor uses master-party.jsx VENDOR_SEED (6), not the boq.jsx dup.
//   - C9      JV mock JV_LIST has no DR/CR lines — only a per-book line count.
//             We emit balanced jv_line rows using the REAL JV amounts (ΣDR=ΣCR per
//             book); total lines = 2+2+2+3+2+2+4 = 17 (matches JV_LIST.lines).
//   - C10     NAV badge numbers are runtime query counts — NEVER seeded.
//   - B-009   84 sales_unit rows persisted, each pointing to its own project_node
//             kind='unit' (codes B-01..B-84, sales-process.jsx generator).
//
// ANSWERED BLOCKERS applied this round (Wei ตอบ 12 ก.ค. — TASKS.md P0-BE-10 rework-3):
//   - B-021(ก) subscription mock status `trial` → real enum value `trial` added in
//             migration 0006; T-1005 seeded status=`trial` (no longer mapped to expiring).
//   - B-022(ก) the 9 SUBSCRIBERS become 9 real company rows (name = org); each
//             subscription points to its OWN company. This REPLACES the previous 3
//             affiliated-group companies (company-accept.jsx COMPANIES) — company row
//             count 3→9. Cross-zone delta flagged to QA (P0-QA-06) via REVIEW-QUEUE.
//   - B-023(ก) subcon.jsx SUBCONS (6) + the unique subcon-accept counterparty
//             (หจก.ช่างก่อฉาบมั่นคง, WO-2026-0055) are seeded as real subcon vendors
//             (kind=subcon), ADDED to the 2 master-party subcons → 9 subcon vendors.
//             Each subcon_contract.vendor_id points to its real firm (name match).
//             subcon-vendor delta 2→9 flagged to QA (P0-QA-06) via REVIEW-QUEUE.
//
// ANSWERED BLOCKERS applied this round (P0-FIX-05 — Wei ตอบ 12 ก.ค.):
//   - B-025(ก) platform_invoice: PINV-2569-0610 (T-1001, subscription-admin.jsx inv) is a
//             stale-version duplicate → DROPPED. T-1001's authoritative invoices are the 3
//             INV-SUB-* rows (subscription.jsx:31 SUB_INVOICES). Table now holds 4 admin rows
//             (other tenants) + 3 T-1001 rows = 7. Count delta flagged to QA (P0-FIX-06).
//   - B-026(ก) subcon register = the 6 subcon.jsx SUBCONS only (SC-01..SC-06, kind=subcon).
//             The 2 master-party "รับเหมา" (V-0031/V-0045) are reclassified → supplier; SC-07
//             (subcon-accept WO-2026-0055 counterparty, not in the register) → supplier too.
//             The 5 procurement `wos` are rewired to SC-01..SC-05 (po-wo.jsx WO_ROWS.subcon
//             name match). register(=6)/vendor(=13) count delta flagged to QA (P0-FIX-06).
//   - B-029(ข) pr-list.jsx PR-2026-0411 type `clear` ∉ pr_type enum (material/subcon/expense/
//             advance) → kept mapped to `advance` (clearing an advance is the advance flow);
//             no enum change (§สรุป counts 4 pr_type values). pr count=10 is type-independent.
//
// Report-derived §สรุป datasets that have NO backing table are intentionally
// SKIPPED (documented in REPORT_DERIVED below). Acceptance/Defect stay 0 records
// per §สรุป line 318/341 + P0-QA-06 (the rejected work period's defect is captured
// by the 3 DMS `defect`-category documents — the real "defect reports").

import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq } from "drizzle-orm";
import { Pool } from "pg";
// better-auth's own scrypt hasher — seed-time only (devDependency), so seeded
// credential rows always match what better-auth verifies at sign-in.
import { hashPassword } from "better-auth/crypto";
import * as schema from "../schema/index.js";
import { det } from "./ids.js";
import { PACKAGES } from "./packages.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** money → fixed 2-decimal string (drizzle numeric maps to string). */
const m = (n: number): string => Math.abs(n).toFixed(2);

/**
 * Cyclic array pick that is guaranteed non-undefined (satisfies the repo's
 * `noUncheckedIndexedAccess` strictness for FK/enum wiring). Wraps the index so
 * a child count larger than its parent set still lands on a valid parent.
 */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[((i % arr.length) + arr.length) % arr.length];
  if (v === undefined) throw new Error(`seed: empty pick from array at index ${i}`);
  return v;
}

// Report-derived §สรุป entities with NO backing table (documented, not seeded).
const REPORT_DERIVED = [
  "trial balance (gl.jsx TRIAL 14) — derived from jv_line",
  "posting inbox (gl.jsx POST_INBOX 7) — queue view over source money docs",
  "aging AP/AR (accounting-extra AGING_AP/AR 5+5) — report over ap_billing/ar_invoice",
  "project P&L (accounting-extra2 PROJPL_SEED 5) — report over jv_line/project",
  "ลูกหนี้รายลูกค้า (finance.jsx AR_CUSTOMERS 5) — report view over ar_invoice",
  "cost allocation ปันส่วน (petty-alloc ALLOC_CAT 6) — report over petty_cash_txn",
  "SUB_INVOICES (subscription.jsx 3) — tenant view of platform_invoice/subscription",
  "งวดเบิกจ่าย (subcon.jsx PROGRESS_PAYMENTS 5) — payment view over work_period",
  "BOQ balance/archive/รออนุมัติ/AI-QTO/linked-docs — UI/report datasets over boq_*",
  "MRR/OPEX-monthly/cashflow chart series — chart data, not entity records",
  "e-Tax queue (etax.jsx ETAX_SEED 6) — status view over ar_invoice.etax_status",
  "แผน PM (pm2.jsx PM_PLAN_ITEMS 6) — calendar view over pm_asset.next_due",
  "NO_RECORD: ai_usage, acceptance, defect, attendance, payroll (expected 0)",
];

// ---------------------------------------------------------------------------
// static mock data (transcribed from pototype/*.jsx, cited by file:line)
// ---------------------------------------------------------------------------

// subscription-admin.jsx:5 SUBSCRIBERS (9). B-022(ก): every tenant org is a real
// company row (name = org), each subscription pointing to its OWN company. The main
// tenant (T-1001 — its 12 COMPANY_USERS + every company-scoped record below hang
// here) anchors CO1. pkg→package key: pro=M, enterprise=Full, starter=S. The mock
// carries no tax_id / short / color / doc_prefix / biz for subscribers → null.
const SUBSCRIBERS = [
  { key: "T-1001", org: "บจก. รุ่งเรืองก่อสร้าง", pkg: "M" as const },
  { key: "T-1002", org: "บมจ. สยามพร็อพเพอร์ตี้", pkg: "Full" as const },
  { key: "T-1003", org: "หจก. ช่างไทยวิศวกรรม", pkg: "S" as const },
  { key: "T-1004", org: "บจก. กรีนโซลาร์ เอนเนอร์ยี", pkg: "M" as const },
  { key: "T-1005", org: "บจก. เมโทรดีเวลอปเมนท์", pkg: "M" as const },
  { key: "T-1006", org: "หจก. บ้านสวยการช่าง", pkg: "S" as const },
  { key: "T-1007", org: "บจก. นนทบุรีโยธาการ", pkg: "M" as const },
  { key: "T-1008", org: "บจก. ภูเก็ตวิลล่า กรุ๊ป", pkg: "Full" as const },
  { key: "T-1009", org: "หจก. อีสานคอนสตรัคชั่น", pkg: "S" as const },
] as const;

// pkg-builder / subscription.jsx — decision C1: 4 tiers S/M/L/Full
// (S=2900 M=7900 L=14900 Full=contact). limits keys per C5 (storage_gb/
// ai_per_month). Extracted to ./packages.js by P1-BE-04 (B-043(ค)): menus are
// now the NAV top-level id allow-lists per PACKAGE-RULES.md §2 (S=6 · M=20 ·
// L=29 · Full="*") — module keys were the wrong vocabulary — and unit tests
// assert the lists verbatim.

// subscription-admin.jsx:5 SUBSCRIBERS (9) — cycle/status transcribed verbatim,
// index-aligned to SUBSCRIBERS above.
const SUB_CYCLES = ["yearly", "yearly", "monthly", "monthly", "yearly", "monthly", "yearly", "yearly", "monthly"] as const;
// B-021(ก): T-1005 (index 4) status `trial` is now a real enum value (migration 0006).
const SUB_STATUS = ["active", "active", "active", "active", "trial", "overdue", "active", "active", "cancelled"] as const;

// subscription-admin.jsx:194 inv (5 admin platform invoices). B-025(ก): PINV-2569-0610
// (บจก. รุ่งเรืองก่อสร้าง = T-1001, 79,000) is a stale-version duplicate of T-1001's real
// invoice → DROPPED. The remaining 4 belong to other tenants (org → SUBSCRIBERS key), each
// pointing to that tenant's own subscription. Invoice no/date are presentational (not in the
// platform_invoice schema) → only amount+status seeded.
const PLATFORM_INV = [
  { subKey: "T-1002", amount: 456000, status: "paid" as const },    // PINV-2569-0612
  { subKey: "T-1008", amount: 384000, status: "paid" as const },    // PINV-2569-0611
  { subKey: "T-1004", amount: 7900, status: "pending" as const },   // PINV-2569-0609
  { subKey: "T-1006", amount: 2900, status: "overdue" as const },   // PINV-2569-0608
] as const;

// subscription.jsx:31 SUB_INVOICES (3) — B-025(ก): T-1001's REAL platform invoices (the
// logged-in tenant บจก. รุ่งเรืองก่อสร้าง). Tenant view is authoritative; the admin duplicate
// (PINV-2569-0610) is dropped above. All point to T-1001's subscription (sub:0).
const T1001_SUB_INV = [
  { amount: 79000, status: "paid" as const },   // INV-SUB-2569-012
  { amount: 72000, status: "paid" as const },   // INV-SUB-2568-011
  { amount: 18400, status: "paid" as const },   // INV-SUB-2567-008
] as const;

// master.jsx:895 ROLE_PRESETS (8 roles) — perms matrix 11 modules × 5 perms.
const MODULE_IDS = ["dashboard", "boq", "pr", "po", "wo", "gr", "subcon", "inventory", "petty", "finance", "master"];
type Matrix = number[][];
const permsFrom = (matrix: Matrix): schema.RolePerms => {
  const out: schema.RolePerms = {};
  matrix.forEach((row, i) => {
    out[MODULE_IDS[i] as string] = { view: !!row[0], create: !!row[1], edit: !!row[2], approve: !!row[3], cancel: !!row[4] };
  });
  return out;
};
// B-051 (P1-BE-09): `level` is the master.jsx ROLE_PRESETS approval tier (0..4);
// `limit` is the single blanket approval ceiling in REAL baht (the mock's
// "1,000,000 ฿" / "ไม่จำกัด" / "—" display strings → numeric | null).
const ROLE_DEFS: { key: string; name: string; limit: number | null; level: number; perms: Matrix }[] = [
  { key: "pm", name: "Project Manager", limit: 1000000, level: 3, perms: [[1,0,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,0,0,0,0],[1,1,1,0,0],[1,0,0,0,0],[1,1,1,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0]] },
  { key: "dir", name: "Director · CONS", limit: null, level: 4, perms: [[1,0,0,0,0],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1]] },
  { key: "proc", name: "Procurement Mgr", limit: 500000, level: 2, perms: [[1,0,0,0,0],[1,1,1,0,0],[1,1,1,1,0],[1,1,1,1,0],[1,1,1,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,1,1,0,0],[0,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]] },
  { key: "site", name: "Site Engineer", limit: 200000, level: 1, perms: [[1,0,0,0,0],[1,1,0,0,0],[1,1,0,0,0],[1,0,0,0,0],[1,1,0,0,0],[1,1,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,1,0,0,0],[0,0,0,0,0],[0,0,0,0,0]] },
  { key: "acc", name: "Accounting", limit: null, level: 0, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,1,1,1,0],[1,0,0,0,0]] },
  { key: "sale", name: "Sales / REM", limit: null, level: 0, perms: [[1,0,0,0,0],[1,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,0,0,0,0]] },
  { key: "wh", name: "Warehouse", limit: null, level: 0, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[0,0,0,0,0],[1,1,1,1,0],[0,0,0,0,0],[1,1,1,1,0],[1,1,0,0,0],[0,0,0,0,0],[0,0,0,0,0]] },
  { key: "exec", name: "ผู้บริหาร / ดูได้อย่างเดียว", limit: null, level: 0, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]] },
];

// B-089 (F-PV1, migration 0026 · Wei ruled ข = seed a NEW role): the prototype's
// 8 ROLE_PRESETS have no Finance Manager, yet flows.html's PV approval ladder is
// บัญชี → ผจก.การเงิน (>500K) → MD (>2M). Seed a "Finance Manager" that gates the PV
// tier-2. LEVEL 3 = PM's tier: the PR/PO handlers already require approvalLevel 3
// for their >500K/>1M second tier, and MD (>2M) is the existing `dir` role at level
// 4 — so a level-3 finance role is the faithful ">500K, below MD" gate. LIMIT =
// 2,000,000 ฿, the ceiling of that tier (above it the PV escalates to MD). PERMS
// clone the accounting base role (`acc`) — which already carries finance.approve —
// since a Finance Manager supervises accounting; the only material lift over `acc`
// is the approval tier/limit (finance.cancel stays dir-only per the mock). Kept
// OUT of ROLE_DEFS so the 12-user cyclic role pick (at(ROLE_DEFS, i)) is unchanged.
const FINANCE_MGR: { key: string; name: string; limit: number; level: number; perms: Matrix } = {
  key: "finmgr", name: "Finance Manager", limit: 2000000, level: 3,
  perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,1,1,1,0],[1,0,0,0,0]],
};
// The seeded user (COMPANY_USERS index) that holds the Finance Manager role.
// user:9 (สุดา แสงทอง, active) currently duplicates the Director cyclic pick
// (9 % 8 = 1 = dir), so re-tasking it as Finance Manager strips no base role of
// its only holder (user:1 วิภา still holds dir).
const FINANCE_MGR_USER_IDX = 9;

// subscription-admin.jsx:19 COMPANY_USERS["T-1001"] (12 users)
const COMPANY_USERS = [
  { name: "สมชาย วัฒนกุล", email: "somchai@rungrueang.co.th", status: "active" },
  { name: "วิภา จันทร์เจริญ", email: "wipha@rungrueang.co.th", status: "active" },
  { name: "ธีรพงษ์ ศรีสุข", email: "teerapong@rungrueang.co.th", status: "active" },
  { name: "ปรานี สุขใจ", email: "pranee@rungrueang.co.th", status: "active" },
  { name: "สมศักดิ์ รุ่งเรือง", email: "somsak@rungrueang.co.th", status: "active" },
  { name: "มาลี เกษมสุข", email: "malee@rungrueang.co.th", status: "active" },
  { name: "อนุชา มั่นคง", email: "anucha@rungrueang.co.th", status: "active" },
  { name: "กนกพร ทองดี", email: "kanokporn@rungrueang.co.th", status: "active" },
  { name: "วีรชัย พัฒนา", email: "weerachai@rungrueang.co.th", status: "inactive" },
  { name: "สุดา แสงทอง", email: "suda@rungrueang.co.th", status: "active" },
  { name: "ชาญชัย ไกรสร", email: "chanchai@rungrueang.co.th", status: "active" },
  { name: "นภา วงศ์ใหญ่", email: "napha@rungrueang.co.th", status: "active" },
];

// project-types.jsx:6 PROJECT_TYPES (4)
const PROJECT_TYPES = [
  { key: "realestate" as const, name: "อสังหาริมทรัพย์", hierarchy: ["โครงการ", "เฟส", "บล็อก / อาคาร", "ยูนิต", "Model / แบบ"], modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "sales_re", "aftersales", "lineoa"] },
  { key: "solar" as const, name: "โซลาเซลล์ / พลังงาน (EPC)", hierarchy: ["ไซต์", "โซน / Array", "String", "Inverter"], modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "om", "ppa", "roi", "permit", "warranty"] },
  { key: "civil" as const, name: "ก่อสร้างทั่วไป / โยธา", hierarchy: ["โครงการ", "ส่วนงาน / โซน", "WBS"], modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm"] },
  { key: "service" as const, name: "โครงการบริการ / ทั่วไป", hierarchy: ["โครงการ", "เฟส", "งาน (WBS)"], modules: ["land", "proc", "timeline", "petty", "pm"] },
];

// chrome.jsx:3 PROJECTS (7 projects / 16 phases). short/color stamped verbatim
// per B-041(ก+) (migration 0009 columns — the ProjectSwitcher chip fields).
// B-102 (Wei = ก, migration 0032): curated per-project health — an EDITORIAL
// label transcribed byte-exact from the exec mock's roll{} (exec-audit.jsx:14-20).
// NOT a formula (the skeptic disproved actual>budget*0.9 on 3/7 mock rows);
// /analytics/portfolio surfaces the stored value verbatim. atRisk = health≠'ดี'.
const PROJECT_HEALTH: Record<string, string> = {
  rjp: "ดี", bbt: "ดี", rama: "เฝ้าระวัง", phk: "ดี", slr: "ดี", rdb: "เฝ้าระวัง", erp: "ดี",
};

const PROJECTS = [
  { key: "rjp", name: "juneflow พาร์ค ราชพฤกษ์", short: "RJP", color: "#0B2A4A", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · Block A (บ้านเดี่ยว)" }, { k: "p2", l: "เฟส 2 · Block B+C (ทาวน์โฮม)" }, { k: "p3", l: "เฟส 3 · Block D (บ้านแฝด)" }] },
  { key: "bbt", name: "juneflow บางบัวทอง", short: "BBT", color: "#0F766E", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · ทาวน์โฮม" }, { k: "p2", l: "เฟส 2 · บ้านเดี่ยว" }] },
  { key: "rama", name: "juneflow คอนโด พระราม 9", short: "R9", color: "#1D4ED8", type: "realestate", phases: [{ k: "a", l: "อาคาร A (1-15 ชั้น)" }, { k: "b", l: "อาคาร B (1-15 ชั้น)" }] },
  { key: "phk", name: "juneflow พหลโยธิน 5", short: "PHK", color: "#B45309", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · ทาวน์โฮม Luxury" }] },
  { key: "slr", name: "โซลาร์ฟาร์ม สระบุรี 8MW", short: "SLR", color: "#B45309", type: "solar", phases: [{ k: "z1", l: "โซน A · Array 1-8 (4MW)" }, { k: "z2", l: "โซน B · Array 9-16 (4MW)" }] },
  { key: "rdb", name: "ถนน-สะพาน เทศบาลนนทบุรี", short: "RDB", color: "#0F766E", type: "civil", phases: [{ k: "s1", l: "ส่วนงาน A · ถนนสาย 1 (กม.0-3.5)" }, { k: "s2", l: "ส่วนงาน B · สะพานข้ามคลอง" }, { k: "s3", l: "ส่วนงาน C · ระบบระบายน้ำ" }] },
  { key: "erp", name: "ติดตั้งระบบ ERP ลูกค้า ABC", short: "ERP", color: "#6D28D9", type: "service", phases: [{ k: "ph1", l: "เฟส 1 · Analysis & Design" }, { k: "ph2", l: "เฟส 2 · Implementation" }, { k: "ph3", l: "เฟส 3 · UAT & Go-Live" }] },
] as const;

// company-accept.jsx:6 COMPANIES (3 บริษัทเครือ) — B-041(ก+) "stamp เครือ":
// short/taxId/color/docPrefix/biz verbatim; wired under the T-1001 tenant's
// group via group_parent_id at insert time.
const GROUP_COMPANIES = [
  { key: "JF", name: "บจก. จูนโฟลว์ ดีเวลลอปเมนท์", short: "JF", taxId: "0-1055-61012-34-5", color: "#0B2A4A", docPrefix: "JF", biz: "พัฒนาอสังหาริมทรัพย์" },
  { key: "JE", name: "บจก. จูนโฟลว์ เอ็นเนอร์ยี", short: "JE", taxId: "0-1055-64067-89-0", color: "#B45309", docPrefix: "JE", biz: "โรงไฟฟ้าพลังงานแสงอาทิตย์" },
  { key: "JC", name: "บจก. จูนโฟลว์ คอนสตรัคชั่น", short: "JC", taxId: "0-1055-58033-22-1", color: "#0F766E", docPrefix: "JC", biz: "รับเหมาก่อสร้าง & บริการ" },
] as const;

// master.jsx:426 MODELS (5) — B-050 (P1-BE-09): full house-model attributes.
// `code`/`type`(=name, pure display, no "A-1 · " prefix now that code is its own
// column)/area/bed/bath/parking/status/color transcribed verbatim; `price` is
// converted from the mock's millions (8.24) to REAL full baht (8_240_000 — the
// schema stores baht + currency_code, FE divides by 1e6 for "M ฿"). The mock's
// hardcoded `count` (unit count) is NOT seeded — unit_count/bom_item_count are
// derived at query time (C10).
const MODELS = [
  { code: "A-1", type: "บ้านเดี่ยว 2 ชั้น", area: "168.00", bed: 4, bath: 4, parking: 2, price: 8_240_000, status: "active" as const, color: "#0B2A4A" },
  { code: "B-1", type: "ทาวน์โฮม 2 ชั้น", area: "92.00", bed: 3, bath: 2, parking: 1, price: 4_850_000, status: "active" as const, color: "#0F766E" },
  { code: "C-1", type: "ทาวน์โฮม 3 ชั้น", area: "138.00", bed: 4, bath: 3, parking: 2, price: 5_650_000, status: "active" as const, color: "#1D4ED8" },
  { code: "D-1", type: "บ้านแฝด 2 ชั้น", area: "142.00", bed: 3, bath: 3, parking: 2, price: 6_420_000, status: "active" as const, color: "#B45309" },
  { code: "E-1", type: "ทาวน์โฮม 4 ห้องนอน (ใหม่)", area: "145.00", bed: 4, bath: 3, parking: 2, price: 5_950_000, status: "draft" as const, color: "#7C3AED" },
];

// master.jsx:240 BLOCK_SEED (3 blocks — project_node kind='block')
const BLOCK_SEED = [
  { code: "B", name: "Block B", modelKey: "B-1" },
  { code: "C", name: "Block C", modelKey: "C-1" },
  { code: "D", name: "Block D", modelKey: "D-1" },
];

// master.jsx:584 CC_SEED (7 cost centers) — B-059 (P1-BE-11): full superset
// columns type/link/owner/budget/status transcribed verbatim from the mock;
// budget is FULL baht (numeric + currency_code THB via the column default).
const CC_SEED = [
  { code: "CC-CONS-RJP-01", name: "โครงการ ราชพฤกษ์ เฟส 1", type: "Project" as const, link: "เฟส 1 / Block A", owner: "สมชาย", budget: 84_400_000, status: "approved" as const },
  { code: "CC-CONS-RJP-02", name: "โครงการ ราชพฤกษ์ เฟส 2", type: "Project" as const, link: "เฟส 2 / Block B+C", owner: "สมชาย", budget: 124_800_000, status: "approved" as const },
  { code: "CC-CONS-RJP-03", name: "โครงการ ราชพฤกษ์ เฟส 3", type: "Project" as const, link: "เฟส 3 / Block D", owner: "สมชาย", budget: 75_300_000, status: "approved" as const },
  { code: "CC-CONS-OH", name: "Overhead งานก่อสร้าง", type: "Overhead" as const, link: "ฝ่ายก่อสร้าง · ทุกโครงการ", owner: "ผอ.สมพร", budget: 8_400_000, status: "approved" as const },
  { code: "CC-PROC", name: "ฝ่ายจัดซื้อ", type: "Dept" as const, link: "—", owner: "ธีรพงษ์", budget: 1_200_000, status: "approved" as const },
  { code: "CC-SLS-RJP", name: "Sales · ราชพฤกษ์", type: "Project" as const, link: "ทุกเฟส", owner: "รุจิรา", budget: 4_800_000, status: "approved" as const },
  { code: "CC-FIN", name: "ฝ่ายบัญชี-การเงิน", type: "Dept" as const, link: "—", owner: "ปรานี", budget: 800_000, status: "approved" as const },
];

// master-party.jsx:6 VENDOR_SEED (6) — C6. B-026(ก): all seeded as kind=supplier (the 2
// "รับเหมา" V-0031/V-0045 are master-party contractors, NOT the subcon.jsx register). `type`
// kept verbatim from the mock for reference.
// B-071 (P2-BE-08): addr / bank / status carried verbatim from master-party.jsx:6-13
// (new superset columns). V-0061 is inactive in the mock; the rest are active.
const VENDOR_SEED = [
  { code: "V-0012", name: "บจก. รุ่งเรืองวัสดุก่อสร้าง", type: "วัสดุ", taxId: "0105545012345", term: 30, addr: "ถ.พหลโยธิน กทม.", bank: "KBANK 012-3-45678-9", status: "active" },
  { code: "V-0024", name: "หจก. ช่างเหล็กไทย", type: "วัสดุ", taxId: "0103539008765", term: 45, addr: "ถ.รังสิต ปทุมธานี", bank: "SCB 111-2-33445-6", status: "active" },
  { code: "V-0031", name: "บจก. ไฟฟ้าอุตสาหกรรม", type: "รับเหมา", taxId: "0105549112233", term: 60, addr: "ถ.บางนา กทม.", bank: "BBL 222-1-55667-8", status: "active" },
  { code: "V-0045", name: "นายสมศักดิ์ รับเหมาก่อสร้าง", type: "รับเหมา", taxId: "1102003456789", term: 30, addr: "ต.บางพระ นนทบุรี", bank: "KTB 333-4-77889-0", status: "active" },
  { code: "V-0052", name: "บมจ. แม็กซ์เทค เซอร์วิส", type: "บริการ", taxId: "0107536000999", term: 30, addr: "ถ.รัชดาภิเษก กทม.", bank: "KBANK 444-5-99001-2", status: "active" },
  { code: "V-0061", name: "บจก. หัวเว่ย เทคโนโลยี", type: "วัสดุ", taxId: "0105556778899", term: 0, addr: "ถ.วิภาวดี กทม.", bank: "SCB 555-6-11223-4", status: "inactive" },
];

// subcon.jsx:3 SUBCONS (6 register, SC-01..SC-06) + subcon-accept.jsx unique counterparty
// (SC-07 หจก.ช่างก่อฉาบมั่นคง, WO-2026-0055 — NOT in the register). B-026(ก): only the 6
// register firms are kind=subcon (จอทะเบียนผู้รับเหมา = 6); SC-07 exists only as a contract
// counterparty → kind=supplier (see vendor insert). `type` = ชนิดงาน kept for reference;
// the mock has no tax_id / credit_term → null.
const SUBCON_FIRMS = [
  { code: "SC-01", name: "บจก. รุ่งเรืองก่อสร้าง", type: "งานโครงสร้าง" },
  { code: "SC-02", name: "หจก. ช่างไทยพัฒนา", type: "งานสถาปัตยกรรม" },
  { code: "SC-03", name: "บจก. ไฟฟ้าอินเตอร์", type: "งานระบบไฟฟ้า" },
  { code: "SC-04", name: "บจก. ประปาไทย เซอร์วิส", type: "งานประปา-สุขาภิบาล" },
  { code: "SC-05", name: "หจก. งานสีบุญลือ", type: "งานสี + เก็บงาน" },
  { code: "SC-06", name: "บจก. ภูมิทัศน์การ์เด้น", type: "Landscape" },
  { code: "SC-07", name: "หจก. ช่างก่อฉาบมั่นคง", type: "งานก่ออิฐ-ฉาบปูน" },
] as const;

// master-party.jsx:18 CUSTOMER_SEED (6)
const CUSTOMER_SEED = [
  { code: "C-1001", name: "คุณวีรชัย ทรัพย์มั่นคง", taxId: "1100400112233" },
  { code: "C-1008", name: "คุณนภา ศรีสุข", taxId: "1101200998877" },
  { code: "C-2001", name: "นิติบุคคล อาคารชุด เดอะ พาร์ค", taxId: "0993000123456" },
  { code: "C-3001", name: "การไฟฟ้าส่วนภูมิภาค (กฟภ.)", taxId: "0994000165151" },
  { code: "C-4001", name: "เทศบาลเมืองนนทบุรี", taxId: "0994000111222" },
  { code: "C-5001", name: "บจก. เอบีซี เอ็นเตอร์ไพรส์", taxId: "0105560778800" },
];

// master.jsx:7 ORG_SEED (10 org units)
const ORG_SEED = [
  { lvl: 0, ic: "building", name: "juneflow Co., Ltd.", code: "ICON", note: "บริษัทแม่ · จดทะเบียน 2545 · 240 พนักงาน" },
  { lvl: 1, ic: "users", name: "ฝ่ายก่อสร้าง (Construction)", code: "CONS", note: "หัวหน้า: ผอ.สมพร · 86 คน" },
  { lvl: 2, ic: "user", name: "ทีมโครงการ ราชพฤกษ์", code: "CONS-RJP", note: "ผจก: สมชาย · 24 คน" },
  { lvl: 2, ic: "user", name: "ทีมโครงการ บางบัวทอง", code: "CONS-BBT", note: "ผจก: ธีรพงษ์ · 18 คน" },
  { lvl: 2, ic: "user", name: "ทีม Site Engineer", code: "CONS-SE", note: "หน.: วิภา · 12 คน" },
  { lvl: 1, ic: "users", name: "ฝ่ายจัดซื้อ (Procurement)", code: "PROC", note: "หัวหน้า: ธีรพงษ์ · 8 คน" },
  { lvl: 1, ic: "users", name: "ฝ่ายขาย-การตลาด (Sales)", code: "SLS", note: "หัวหน้า: รุจิรา · 36 คน" },
  { lvl: 1, ic: "users", name: "ฝ่ายบัญชี-การเงิน (Finance)", code: "FIN", note: "หัวหน้า: ปรานี · 14 คน" },
  { lvl: 0, ic: "building", name: "juneflow Construction Services จำกัด", code: "ICS", note: "บริษัทย่อย · งานรับเหมา" },
  { lvl: 0, ic: "building", name: "juneflow Property จำกัด", code: "IPM", note: "บริษัทย่อย · บริหารชุมชน" },
];

// master.jsx:737 DOCNUM_SEED (10 running-number counters) — B-060 (P1-BE-11):
// `running` is stored as TEXT verbatim from the mock (leading zeros kept,
// BOQ row = the non-numeric "B-02 v3").
// `lock` is the lock-mode CODE (B-067(ข), P1-BE-12 — was boolean): the mock
// LOCK_OPTS `v` value is verbatim-mapped to a short stable code —
// ทุกใบ→all · ตามแผนก→dept · ตามคลัง→warehouse · —→none (master.jsx:737-756).
// A boolean lost dept+warehouse (TR/IS were flattened to false); the code
// preserves all 4 modes so the FE can resolve each to its i18n label.
const DOCNUM_SEED = [
  { type: "Purchase Requisition", prefix: "PR", running: "0418", reset: "ทุกปีบัญชี", lock: "dept" },
  { type: "Purchase Order", prefix: "PO", running: "0291", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Work Order", prefix: "WO", running: "0117", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Goods Receipt", prefix: "GR", running: "0148", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Return", prefix: "RT", running: "0014", reset: "ทุกปีบัญชี", lock: "none" },
  { type: "Bill of Quantities", prefix: "BOQ", running: "B-02 v3", reset: "—", lock: "all" },
  { type: "Petty Cash", prefix: "PT", running: "0148", reset: "ทุกเดือน", lock: "none" },
  { type: "Stock Transfer", prefix: "TR", running: "0084", reset: "ทุกปีบัญชี", lock: "warehouse" },
  { type: "Issue (เบิก)", prefix: "IS", running: "0218", reset: "ทุกปีบัญชี", lock: "warehouse" },
  { type: "Journal Voucher", prefix: "JV", running: "0418", reset: "ทุกปีบัญชี", lock: "all" },
  // B-121 Q7 (Wei-approved per-recon default): AR document counters so the
  // invoice / receipt / tax-invoice / credit-note handlers allocate numbers from
  // doc_numbering (the same source as PR/PO/JV). Fresh counters (running 0001) —
  // no prototype exemplar; not in the master.jsx DOCNUM_SEED (which the docnum
  // master screen mirrors), so the eventual docnum web port must account for the
  // AR rows. reset/lock follow the accounting-doc convention (JV precedent).
  { type: "AR Invoice", prefix: "INV", running: "0001", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Receipt Voucher", prefix: "RV", running: "0001", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Tax Invoice", prefix: "TX", running: "0001", reset: "ทุกปีบัญชี", lock: "all" },
  { type: "Credit Note", prefix: "CN", running: "0001", reset: "ทุกปีบัญชี", lock: "all" },
];

// accounting-extra.jsx:14 COA_SEED (23 GL accounts)
const COA_SEED = [
  { code: "1010", name: "เงินสดในมือ" }, { code: "1020", name: "เงินฝากธนาคาร - กระแสรายวัน (KBANK)" },
  { code: "1030", name: "ลูกหนี้การค้า" }, { code: "1040", name: "ลูกหนี้เงินประกันผลงาน (Retention)" },
  { code: "1140", name: "งานระหว่างก่อสร้าง (WIP/CIP)" }, { code: "1150", name: "ที่ดินรอการพัฒนา" },
  { code: "1210", name: "ที่ดิน อาคาร และอุปกรณ์" }, { code: "2010", name: "เจ้าหนี้การค้า" },
  { code: "2030", name: "เจ้าหนี้เงินประกันผลงานค้างจ่าย" }, { code: "2040", name: "เงินมัดจำ/เงินจองรับล่วงหน้า" },
  { code: "2050", name: "ภาษีขายรอนำส่ง (VAT)" }, { code: "2110", name: "เงินกู้ยืมธนาคาร - โครงการ" },
  { code: "3010", name: "ทุนจดทะเบียนชำระแล้ว" }, { code: "3020", name: "กำไร (ขาดทุน) สะสม" },
  { code: "4010", name: "รายได้จากการขายอสังหาริมทรัพย์" }, { code: "4020", name: "รายได้ค่าก่อสร้าง (ตามสัญญา)" },
  { code: "4030", name: "รายได้ค่าบริการบำรุงรักษา (PM)" }, { code: "4040", name: "รายได้ขายไฟฟ้า (PPA)" },
  { code: "5010", name: "ต้นทุนขาย - โอนกรรมสิทธิ์" }, { code: "5020", name: "ต้นทุนวัสดุก่อสร้าง" },
  { code: "5030", name: "ค่าแรง / ค่าจ้างเหมาช่วง" }, { code: "5100", name: "ค่าใช้จ่ายในการบริหาร" },
  { code: "5200", name: "ดอกเบี้ยจ่าย" },
];

// boq-list.jsx:7 docs (6 BOQDoc) — transcribed verbatim (no/name/scope/version/status)
const BOQ_DOCS = [
  { no: "BOQ-2026-B-02", name: "ทาวน์โฮม Block B (4 ห้องนอน)", scope: "B-Type1 · 84 ยูนิต", ver: 3, status: "approved" as const },
  { no: "BOQ-2026-C-01", name: "ทาวน์โฮม Block C (4 ห้องนอน)", scope: "C-Type1 · 72 ยูนิต", ver: 2, status: "approved" as const },
  { no: "BOQ-2026-B-03", name: "Block B — ฉบับเพิ่มหมวดไฟฟ้า", scope: "B-Type1 · งานเพิ่ม", ver: 4, status: "revise" as const },
  { no: "BOQ-2026-D-01", name: "บ้านแฝด Block D", scope: "D-Type1 · 36 ยูนิต", ver: 1, status: "pending" as const },
  { no: "BOQ-2026-A-01", name: "บ้านเดี่ยว Block A", scope: "A-Type1 · 48 ยูนิต", ver: 5, status: "approved" as const },
  { no: "BOQ-2026-B-04", name: "Block B — สเปกพิเศษ B-12 (upgrade)", scope: "B-12 รายยูนิต", ver: 1, status: "draft" as const },
];

// boq.jsx:1454 ARCHIVE — the approver + approval timestamp per approved BOQ doc
// (B-081 / F4, migration 0021). Keyed by doc `no`; only docs whose `no` matches a
// seeded BOQ_DOCS row AND are approved get archive fields. The mock approver
// "ผอ.สมพร เพชรชัย" is NOT a seeded user, so approved_by maps to the seeded
// Director role-holder user:1 (วิภา จันทร์เจริญ, ROLE_DEFS[1]=dir) — the tenant's
// BOQ approval authority (task: "approver = a seeded user"). Dates are the CE-UTC
// of the mock Thai-BE date+time (69 = 2026; · time is ICT → −7h to UTC).
const APPROVER_IDX = 1; // user:1 = Director (วิภา จันทร์เจริญ), BOQ approval authority
const ARCHIVE_BY_NO: Record<string, string> = {
  "BOQ-2026-B-02": "2026-03-15T07:32:00Z", // 15 มี.ค. 69 · 14:32
  "BOQ-2026-C-01": "2026-03-08T02:48:00Z", // 08 มี.ค. 69 · 09:48
};
// boq.jsx:1456 ARCHIVE[0].history — the Revise log of BOQ-2026-B-02 (the only
// archive row carrying a history[]). `by` = APPROVER_IDX (mock "ผอ.สมพร เพชรชัย"
// → seeded Director). `delta` stored as text (signed value string). Ordered
// newest→oldest exactly as the mock renders it.
const BOQ_HISTORY = [
  { docNo: "BOQ-2026-B-02", version: 3, action: "อนุมัติ", at: "2026-03-15T07:32:00Z", delta: "280000", note: "อนุมัติเพิ่มงานหลังคา" },
  { docNo: "BOQ-2026-B-02", version: 2, action: "อนุมัติ", at: "2026-02-02T04:08:00Z", delta: "-120000", note: "ลดสเปกประตูภายใน" },
  { docNo: "BOQ-2026-B-02", version: 1, action: "อนุมัติฉบับแรก", at: "2026-01-18T09:20:00Z", delta: "11598000", note: "BOQ ฉบับแรกของ Block B" },
] as const;

// boq.jsx:317 INITIAL_GROUPS (6 BOQ work groups)
const BOQ_GROUPS = [
  "01 งานเตรียม + Site Work",
  "02 งานโครงสร้าง",
  "03 งานสถาปัตยกรรม",
  "04 งานระบบไฟฟ้า",
  "05 งานประปา/สุขาภิบาล",
  "06 งานเก็บงาน + ตกแต่ง",
];
// The per-group CBS budget (baht) for the hero project's boq groups, factored out
// so the group-C Wave-3 EVM snapshot BAC (Σ over the rjp groups) references the
// SAME source as the cbs_budget seed rather than re-typing the 1M literal — C10
// forbids fabricated/duplicated numbers. Group i (0-based) budget = 1M × (i+1).
const cbsGroupBudget = (i: number): number => 1_000_000 * (i + 1);

// boq.jsx:326 INITIAL_ROWS_BY_GROUP (21 BOQItem rows across the 6 groups)
// g = group index; cat M/L/S; qty/unit/price verbatim. `detail` (gap-5, migration
// 0023) is the boq.editor line-detail note transcribed verbatim from boq.jsx:328-358.
const BOQ_ITEMS: { g: number; code: string; cat: "M" | "L" | "S"; name: string; qty: number; unit: string; price: number; detail: string }[] = [
  { g: 0, code: "SITE-001", cat: "S", name: "ปรับเกรด + เคลียร์พื้นที่", qty: 1, unit: "เหมา", price: 280000, detail: "Site B-1..B-24" },
  { g: 0, code: "SITE-002", cat: "L", name: "ค่าแรงรังวัด + ปักหมุด", qty: 15, unit: "วัน-คน", price: 850, detail: "ทีม 3 คน × 5 วัน" },
  { g: 0, code: "SITE-003", cat: "M", name: "เสาเข็มชั่วคราว + รั้ว Site", qty: 1, unit: "ชุด", price: 184375, detail: "ป้องกันเขตก่อสร้าง" },
  { g: 1, code: "MAT-CEM-001", cat: "M", name: "ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ", qty: 4800, unit: "ถุง", price: 168.5, detail: "ขนาด 50 kg/ถุง · ตามมอก. 15-2562" },
  { g: 1, code: "MAT-CEM-002", cat: "M", name: "ปูนทรายฉาบ MORTAR", qty: 1240, unit: "ถุง", price: 142, detail: "ฉาบเรียบภายในและภายนอก" },
  { g: 1, code: "MAT-STL-024", cat: "M", name: "เหล็กเส้นกลม SR24 ขนาด 12mm × 10m", qty: 2160, unit: "เส้น", price: 425, detail: "ใช้กับงานเสา-คาน" },
  { g: 1, code: "MAT-STL-036", cat: "M", name: "เหล็กเส้นข้ออ้อย SD40 ขนาด 16mm", qty: 1280, unit: "เส้น", price: 685, detail: "เสริมเสาหลัก" },
  { g: 1, code: "SUB-STR-001", cat: "S", name: "งานเหมาเทคอนกรีตเสา-คาน-พื้น", qty: 1, unit: "เหมา", price: 1840000, detail: "รวมแบบหล่อ + เทคอนกรีต Block B" },
  { g: 1, code: "SUB-STR-002", cat: "S", name: "งานเหมาผูกเหล็กเสริมเสา-คาน", qty: 1, unit: "เหมา", price: 320000, detail: "ตามแบบ Spec วิศวกร" },
  { g: 1, code: "LAB-STR-001", cat: "L", name: "ค่าแรงช่างเทคอนกรีต", qty: 48, unit: "วัน-คน", price: 850, detail: "ทีม 4 คน × 12 วัน" },
  { g: 1, code: "LAB-STR-002", cat: "L", name: "ค่าแรงผูกเหล็ก", qty: 24, unit: "วัน-คน", price: 720, detail: "ทีม 3 คน × 8 วัน" },
  { g: 2, code: "MAT-TILE-60A", cat: "M", name: "กระเบื้องปูพื้น 60×60 (Type-A)", qty: 4200, unit: "ตร.ม.", price: 302, detail: "พื้นทั่วทุกห้อง" },
  { g: 2, code: "MAT-PAINT-PR", cat: "M", name: "สีทาภายใน Premium", qty: 640, unit: "แกลลอน", price: 302.5, detail: "5L · ทาทุกห้อง · 2 ชั้น" },
  { g: 2, code: "SUB-ARC-001", cat: "S", name: "งานเหมาทาสีภายใน + ภายนอก", qty: 1, unit: "เหมา", price: 480000, detail: "Block B 1-24" },
  { g: 3, code: "SUB-ELE-001", cat: "S", name: "งานติดตั้งระบบไฟฟ้า + สื่อสาร", qty: 1, unit: "เหมา", price: 1840000, detail: "Block B (B-1..B-24)" },
  { g: 3, code: "LAB-ELE-001", cat: "L", name: "ค่าแรงเดินสายไฟ + ติดตั้งดวงไฟ", qty: 240, unit: "วัน-คน", price: 700, detail: "ทีม 6 คน × 40 วัน" },
  { g: 3, code: "MAT-WIRE-22", cat: "M", name: "สาย VCT 2.5mm × 100m", qty: 24, unit: "ม้วน", price: 7000, detail: "สายเมน + กระจาย" },
  { g: 4, code: "SUB-PLB-001", cat: "S", name: "ระบบประปา + สุขภัณฑ์", qty: 1, unit: "เหมา", price: 985000, detail: "B-1..B-12" },
  { g: 4, code: "MAT-PLB-018", cat: "M", name: "สุขภัณฑ์ครบชุด · มาตรฐาน", qty: 84, unit: "ชุด", price: 18500, detail: "Cotto / TOTO Premium" },
  { g: 5, code: "MAT-FIN-001", cat: "M", name: "วัสดุเก็บงาน + ขอบประตู", qty: 1, unit: "ชุดต่อหลัง", price: 4800, detail: "PVC + คิ้วไม้" },
  { g: 5, code: "LAB-FIN-001", cat: "L", name: "ค่าแรงเก็บงาน + ทำความสะอาด", qty: 192, unit: "วัน-คน", price: 600, detail: "ทีม 2 คน × 8 วัน × 24 หลัง" },
];

// bom.jsx:22 BOM_MODELS (4) + :30 BOM_LINES["B-1"] (17 lines, only B-1 has lines)
const BOM_MODELS = ["B-1", "A-1", "C-1", "D-1"];
const BOM_LINES_B1 = [
  { cat: "M", code: "01-001", name: "เสาเข็มเจาะ Ø35 ซม.", detail: "ลึก 21 ม. · รวมเหล็กเสริม", unit: "ต้น", qty: 18, price: 4200 },
  { cat: "M", code: "02-002", name: "คอนกรีตผสมเสร็จ 240 ksc", detail: "งานโครงสร้าง · ปั๊ม", unit: "ลบ.ม.", qty: 42, price: 2150 },
  { cat: "M", code: "02-014", name: "เหล็กเส้น SD40 DB12", detail: "เสา-คาน-พื้น", unit: "เส้น", qty: 320, price: 248 },
  { cat: "M", code: "03-101", name: "อิฐมวลเบา Q-CON 7.5 ซม.", detail: "ผนังภายใน-ภายนอก", unit: "ก้อน", qty: 2800, price: 28 },
  { cat: "M", code: "03-120", name: "ปูนก่อ-ฉาบสำเร็จรูป", detail: "ก่อ + ฉาบ", unit: "ถุง", qty: 240, price: 115 },
  { cat: "M", code: "06-040", name: "กระเบื้องปูพื้น 60×60", detail: "เกรด A · ในบ้าน", unit: "ตร.ม.", qty: 165, price: 320 },
  { cat: "M", code: "07-010", name: "กระเบื้องหลังคา CPAC", detail: "พร้อมครอบ-อุปกรณ์", unit: "แผ่น", qty: 480, price: 95 },
  { cat: "M", code: "08-021", name: "ประตู-หน้าต่าง UPVC", detail: "พร้อมมุ้งลวด-กระจก", unit: "ชุด", qty: 14, price: 8500 },
  { cat: "M", code: "09-055", name: "สุขภัณฑ์ COTTO ชุดห้องน้ำ", detail: "ชักโครก+อ่าง+ก๊อก", unit: "ชุด", qty: 3, price: 18500 },
  { cat: "M", code: "10-030", name: "สายไฟ-อุปกรณ์ไฟฟ้า", detail: "เหมารวมทั้งหลัง", unit: "เหมา", qty: 1, price: 145000 },
  { cat: "S", code: "S-01", name: "งานโครงสร้าง (เหมาค่าแรง)", detail: "เสาเข็ม-ฐานราก-โครงสร้าง", unit: "เหมา", qty: 1, price: 420000 },
  { cat: "S", code: "S-02", name: "งานระบบประปา-สุขาภิบาล", detail: "เดินท่อ-ติดตั้ง", unit: "เหมา", qty: 1, price: 165000 },
  { cat: "S", code: "S-03", name: "งานระบบไฟฟ้า (ติดตั้ง)", detail: "เดินสาย-ตู้ควบคุม", unit: "เหมา", qty: 1, price: 135000 },
  { cat: "S", code: "S-04", name: "งานทาสี", detail: "ภายใน-ภายนอก 2 เที่ยว", unit: "ตร.ม.", qty: 720, price: 180 },
  { cat: "L", code: "L-01", name: "ค่าแรงก่อ-ฉาบ", detail: "ผนังทั้งหลัง", unit: "ตร.ม.", qty: 720, price: 220 },
  { cat: "L", code: "L-02", name: "ค่าแรงปูกระเบื้อง", detail: "พื้น-ผนังห้องน้ำ", unit: "ตร.ม.", qty: 285, price: 280 },
  { cat: "L", code: "L-03", name: "ค่าแรงทั่วไป-ทำความสะอาด", detail: "ตลอดงาน + ส่งมอบ", unit: "เหมา", qty: 1, price: 85000 },
];

// pr-list.jsx:11 PR_ROWS (10). type `clear` → `advance` (B-029(ข) — no enum change). status is free text.
// Gap-2 (migration 0022): title/phase/vendor/requester/date transcribed verbatim
// from pr-list.jsx:12-21. `vendorCode` normalizes the mock vendor-name text to a
// seeded vendor code where one matches (else null — the mock vendor is not in the
// seeded register, or the PR is an expense/advance with no vendor). `requesterIdx`
// maps the mock requester name to its COMPANY_USERS index (null when the mock name
// is not a seeded user, e.g. "นภัส ใจดี"). `phase` "—" (PR-0409) is a display
// placeholder → null (seed convention: presentational em-dashes are dropped).
// `date` is the CE ISO of the mock's Thai-BE day (พ.ค. 69 = May 2026) → submitted_at
// for every non-draft PR; approved_at only for status=approved.
const PR_ROWS = [
  { no: "PR-2026-0418", type: "material", status: "pending",  step: 2, title: "ปูนซีเมนต์ + เหล็กเส้น เฟส 2/บล็อก B", phase: "เฟส 2 · B", vendorCode: null,   requesterIdx: 1,    date: "2026-05-25" },
  { no: "PR-2026-0417", type: "expense",  status: "pending",  step: 1, title: "ค่าใช้จ่ายเดินทาง ตรวจไซต์งาน เฟส 3", phase: "เฟส 3",   vendorCode: null,   requesterIdx: 0,    date: "2026-05-25" },
  { no: "PR-2026-0416", type: "material", status: "revise",   step: 2, title: "ลวดเสริม + ตะแกรงไวร์เมช (ขอแก้ราคา)", phase: "เฟส 2 · B", vendorCode: null,   requesterIdx: 2,    date: "2026-05-25" },
  { no: "PR-2026-0415", type: "subcon",   status: "approved", step: 3, title: "งานทาสีภายนอก Block A (อาคารตัวอย่าง)", phase: "เฟส 1 · A", vendorCode: "SC-02", requesterIdx: 4,    date: "2026-05-24" },
  { no: "PR-2026-0414", type: "material", status: "approved", step: 3, title: "กระเบื้องปูพื้น 60×60 (Type-A) — 4,200 ตร.ม.", phase: "เฟส 2 · C", vendorCode: null,   requesterIdx: 2,    date: "2026-05-24" },
  { no: "PR-2026-0413", type: "advance",  status: "approved", step: 2, title: "เงินทดรองจ่าย ค่าจัดส่งวัสดุไซต์งาน 1 สัปดาห์", phase: "เฟส 2",   vendorCode: null,   requesterIdx: null, date: "2026-05-23" },
  { no: "PR-2026-0412", type: "material", status: "pending",  step: 2, title: "อุปกรณ์ไฟฟ้า สายเมน + เบรกเกอร์ (B-12 ถึง B-18)", phase: "เฟส 2 · B", vendorCode: "SC-03", requesterIdx: 1,    date: "2026-05-23" },
  { no: "PR-2026-0411", type: "advance",  status: "approved", step: 2, title: "เคลียร์เงินทดรอง PR-0398 (ค่าตรวจสภาพดิน)", phase: "เฟส 3",   vendorCode: null,   requesterIdx: 0,    date: "2026-05-22" }, // mock `clear` → advance (B-029(ข))
  { no: "PR-2026-0410", type: "subcon",   status: "draft",    step: 0, title: "งานติดตั้งระบบประปา B-1 ถึง B-12", phase: "เฟส 2 · B", vendorCode: "SC-04", requesterIdx: 4,    date: "2026-05-22" },
  { no: "PR-2026-0409", type: "expense",  status: "rejected", step: 1, title: "ค่าอาหาร+เครื่องดื่ม วันเปิดบ้านตัวอย่าง", phase: null,      vendorCode: null,   requesterIdx: null, date: "2026-05-21" },
] as const;

// po-wo.jsx:3 PO_ROWS (6) — real totals + verbatim doc `no` + `status`
// (P2-BE-05, B-070: pos gained no/status/approval_step in migration 0015).
const PO_TOTALS = [1268000, 902475, 612400, 96800, 268000, 1840000];
const PO_NOS = ["PO-2026-0291", "PO-2026-0290", "PO-2026-0289", "PO-2026-0288", "PO-2026-0287", "PO-2026-0286"];
const PO_STATUS = ["approved", "pending", "approved", "approved", "approved", "approved"];
// po-wo.jsx:272 WO_ROWS (5) — real values + verbatim `no`/`status` + retention_pct.
// retention_pct is the mock's retention÷value ratio verbatim (215000/2150000 = 10%,
// … WO-0113 = 0%); scale-3 to mirror subcon_contract.retention_pct.
const WO_VALUES = [2150000, 845000, 2840000, 985000, 425000];
const WO_NOS = ["WO-2026-0117", "WO-2026-0116", "WO-2026-0115", "WO-2026-0114", "WO-2026-0113"];
const WO_STATUS = ["pending", "approved", "approved", "approved", "approved"];
const WO_RETENTION_PCTS = ["10.000", "10.000", "10.000", "10.000", "0.000"];
// gr.jsx:3 GR_ROWS (5) received %/amount + verbatim GR `no` (P2-BE-06, B-070:
// gr gained no/status/wo_id in migration 0016); :11 RETURN_ROWS handled via
// rejected qty. All 5 seed rows are PO receipts (poId); status defaults to
// `received`. (A seeded WO receipt is deferred to keep the ap_billing 3-way
// match gr:i↔po:i 1:1 — GR-from-WO is exercised by the gr.ts handler + tests.)
const GR_RECEIVED = [320, 240, 120, 92, 920];
const GR_NOS = ["GR-2026-0148", "GR-2026-0147", "GR-2026-0146", "GR-2026-0145", "GR-2026-0144"];
// gr.jsx:137-141 per-GR received-line detail (B-078 / F1, migration 0018 gr_item).
// The prototype detail panel ("รายการที่รับ") renders this 3-line array for ANY
// selected GR (it is a static array, not keyed by GR) — so every seeded GR gets
// the same 3 lines, mirroring the prototype's observable behavior. `boqItemIdx`
// ties each line to its source BOQ_ITEMS row by verbatim name match
// (ปูนซีเมนต์=3 · ปูนทรายฉาบ=4 · เหล็กเส้นกลม SR24=5); `price` is that item's unit
// price (the detail array carries no per-line price — derived, never invented).
const GR_ITEM_LINES = [
  { name: "ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ", boqItemIdx: 3, ordered: 480, received: 480, unit: "ถุง" },
  { name: "ปูนทรายฉาบ MORTAR", boqItemIdx: 4, ordered: 240, received: 240, unit: "ถุง" },
  { name: "เหล็กเส้นกลม SR24 12mm", boqItemIdx: 5, ordered: 240, received: 120, unit: "เส้น" },
] as const;

// subcon-accept.jsx:8 SUBC_CONTRACTS (4 contracts / 16 periods = 4/4/3/5).
// C3 state map: accepted→passed, requested→delivered, rejected/pending kept.
type WP = { pct: number; target: number; amount: number; status: "passed" | "delivered" | "pending" | "rejected" };
// B-023(ก): `firm` is the real subcon vendor code each contract is signed with
// (subcon-accept.jsx `subcon` name → SUBCON_FIRMS code). WO-2026-0055's counterparty
// หจก.ช่างก่อฉาบมั่นคง is NOT in the subcon.jsx register, so it is SC-07 (added below).
const SUBC_CONTRACTS: {
  no: string; firm: string; basis: "percent" | "distance" | "milestone" | "unit";
  value: number; retentionPct: string; periods: WP[];
}[] = [
  {
    no: "WO-2026-0042", firm: "SC-01", basis: "percent", value: 2150000, retentionPct: "10.000",
    periods: [
      { pct: 20, target: 20, amount: 430000, status: "passed" },
      { pct: 30, target: 30, amount: 645000, status: "passed" },
      { pct: 25, target: 25, amount: 537500, status: "delivered" },  // requested→delivered
      { pct: 25, target: 25, amount: 537500, status: "pending" },
    ],
  },
  {
    no: "WO-2026-0051", firm: "SC-04", basis: "distance", value: 1750000, retentionPct: "5.000",
    periods: [
      { pct: 0, target: 100, amount: 100000, status: "passed" },
      { pct: 0, target: 100, amount: 100000, status: "passed" },
      { pct: 0, target: 100, amount: 100000, status: "passed" },
      { pct: 0, target: 50, amount: 50000, status: "delivered" },   // requested→delivered
    ],
  },
  {
    no: "WO-2026-0048", firm: "SC-03", basis: "milestone", value: 1240000, retentionPct: "10.000",
    periods: [
      { pct: 0, target: 0, amount: 480000, status: "passed" },
      { pct: 0, target: 0, amount: 420000, status: "pending" },
      { pct: 0, target: 0, amount: 340000, status: "pending" },
    ],
  },
  {
    no: "WO-2026-0055", firm: "SC-07", basis: "unit", value: 1800000, retentionPct: "5.000",
    periods: [
      { pct: 0, target: 2, amount: 360000, status: "passed" },
      { pct: 0, target: 2, amount: 360000, status: "passed" },
      { pct: 0, target: 2, amount: 360000, status: "rejected" },    // งวด 3 ตีกลับ (defect ↓)
      { pct: 0, target: 2, amount: 360000, status: "pending" },
      { pct: 0, target: 2, amount: 360000, status: "pending" },
    ],
  },
];

// gl.jsx:7 JV_LIST (7). no/desc/source real. C9: mock has only a line COUNT, so we
// emit balanced DR/CR lines from the REAL amount. lineCount matches JV_LIST.lines
// (2,2,2,3,2,2,4 → 17 total). dr/cr are [accountCode, amount] pairs, ΣDR=ΣCR.
const JV_BOOKS: {
  no: string; source: string; memo: string; status: string;
  lines: { acct: string; dr: number; cr: number }[];
}[] = [
  { no: "JV-2026-0418", source: "REM", memo: "รับชำระเงินค่าบ้าน B-08 (โอนกรรมสิทธิ์)", status: "approved",
    lines: [{ acct: "1020", dr: 2148000, cr: 0 }, { acct: "1030", dr: 0, cr: 2148000 }] },
  { no: "JV-2026-0417", source: "Manual", memo: "บันทึก WHT 3% สำหรับ INV-CPC-2026-0118", status: "approved",
    lines: [{ acct: "2010", dr: 8040, cr: 0 }, { acct: "2050", dr: 0, cr: 8040 }] },
  { no: "JV-2026-0416", source: "GR auto", memo: "รับสินค้าตาม GR-2026-0148 (สี TOA)", status: "approved",
    lines: [{ acct: "5020", dr: 90466, cr: 0 }, { acct: "2010", dr: 0, cr: 90466 }] },
  { no: "JV-2026-0415", source: "Allocate", memo: "ปันส่วนต้นทุน Block B (เหล็กเสริม)", status: "approved",
    lines: [{ acct: "5020", dr: 100000, cr: 0 }, { acct: "5030", dr: 119200, cr: 0 }, { acct: "1140", dr: 0, cr: 219200 }] },
  { no: "JV-2026-0414", source: "FA auto", memo: "ค่าเสื่อมราคาเครื่องผสมปูน เดือน พ.ค.", status: "approved",
    lines: [{ acct: "5100", dr: 4167, cr: 0 }, { acct: "1210", dr: 0, cr: 4167 }] },
  { no: "JV-2026-0413", source: "Petty", memo: "จ่ายค่าใช้จ่าย Petty (PT-2026-0145)", status: "approved",
    lines: [{ acct: "5100", dr: 8400, cr: 0 }, { acct: "1010", dr: 0, cr: 8400 }] },
  { no: "JV-2026-0412", source: "Manual", memo: "ปรับปรุง Accrued Expense พ.ค.", status: "pending",
    lines: [{ acct: "5100", dr: 92250, cr: 0 }, { acct: "5200", dr: 92250, cr: 0 }, { acct: "2010", dr: 0, cr: 92250 }, { acct: "2040", dr: 0, cr: 92250 }] },
];

// bank.jsx:84 STMT (8 reconcile lines). matched = ref string or null.
const BANK_STMT = [
  { date: "25 พ.ค.", desc: "FT TXN 25052569-08123 → ซีแพคฯ", v: -894205.61, matched: "PV-2026-0183" },
  { date: "25 พ.ค.", desc: "RCV ค่าบ้าน B-08 คุณภัทร์รดา", v: 2148000, matched: "RV-2026-0093" },
  { date: "24 พ.ค.", desc: "FT TXN 24052569-08120 → TOA", v: -93896, matched: "PV-2026-0182" },
  { date: "24 พ.ค.", desc: "DEP โอน คุณวรรณา ค่าบ้าน B-12", v: 728000, matched: "RV-2026-0092" },
  { date: "23 พ.ค.", desc: "RCV Retention คืน จากผู้รับเหมา", v: 84500, matched: "RV-2026-0090" },
  { date: "22 พ.ค.", desc: "FT 22052569 OUT (รายการไม่ทราบ)", v: -15240, matched: null },
  { date: "21 พ.ค.", desc: "เช็ค CH-040126 ขึ้นเงิน", v: -184500, matched: "CH-040126" },
  { date: "20 พ.ค.", desc: "ค่าธรรมเนียมธนาคาร พ.ค.", v: -350, matched: null },
];

// fa.jsx:3 ASSETS (8 FixedAsset) — name/cost/lifeY/method verbatim.
const FA_ASSETS = [
  { name: "ที่ดิน · โครงการราชพฤกษ์ เฟส 1+2", cost: 60000000, lifeY: 0, method: "ไม่คิดค่าเสื่อม" },
  { name: "อาคารสำนักงานขายราชพฤกษ์", cost: 8400000, lifeY: 20, method: "เส้นตรง" },
  { name: "เครื่องผสมปูน 350L · Mixer-001", cost: 180000, lifeY: 5, method: "เส้นตรง" },
  { name: "เครื่องผสมปูน 350L · Mixer-002", cost: 180000, lifeY: 5, method: "เส้นตรง" },
  { name: "รถ Toyota Hilux 4WD (เลขที่ 5)", cost: 1240000, lifeY: 5, method: "เส้นตรง" },
  { name: "เครื่องคอมพิวเตอร์ Workstation", cost: 84000, lifeY: 3, method: "เส้นตรง" },
  { name: "นั่งร้านเหล็ก ชุดใหญ่ × 24 ชุด", cost: 480000, lifeY: 5, method: "เส้นตรง" },
  { name: "รถบรรทุก 6 ล้อ Hino (เก่า)", cost: 1840000, lifeY: 5, method: "เส้นตรง" },
];

// labor.jsx:6 WORKERS_SEED (8) — name/wage (schema carries name + day_rate only).
const WORKERS_SEED = [
  { name: "สมหมาย พลดี", wage: 450 }, { name: "บุญมี แข็งขัน", wage: 420 },
  { name: "สาย คำมูล", wage: 380 }, { name: "ประสงค์ ใจเย็น", wage: 450 },
  { name: "อ่อนสา แสงดี", wage: 430 }, { name: "วิชัย ทองแท้", wage: 520 },
  { name: "คำปุน สีดา", wage: 480 }, { name: "นารี บุญส่ง", wage: 400 },
];

// petty-alloc.jsx:3 PETTY_TX (6). type ∈ {claim,clear,topup}. value = abs mock v.
const PETTY_TX = [
  { no: "PT-2026-0148", type: "claim" as const, l: "ค่าน้ำดื่ม + อาหารทีมงาน Site B", v: 3200, status: "pending", cat: "Welfare", ref: "PR-2026-0417" },
  { no: "PT-2026-0147", type: "claim" as const, l: "ค่าน้ำมัน + ทางด่วน ไปทดสอบดิน", v: 1850, status: "approved", cat: "Transport", ref: null },
  { no: "PT-2026-0146", type: "clear" as const, l: "เคลียร์เงินทดรอง PR-2026-0413", v: 22200, status: "approved", cat: "Advance", ref: "PR-2026-0413" },
  { no: "PT-2026-0145", type: "claim" as const, l: "ค่าซ่อมรถบรรทุก (เปลี่ยนยาง 2 เส้น)", v: 8400, status: "approved", cat: "Vehicle", ref: null },
  { no: "PT-2026-0144", type: "topup" as const, l: "เติมเงินกองทุน Petty (โอนจาก Bank)", v: 50000, status: "approved", cat: "Top-up", ref: null },
  { no: "PT-2026-0143", type: "claim" as const, l: "ค่าถ่ายเอกสาร + อุปกรณ์สำนักงาน", v: 680, status: "approved", cat: "Office", ref: null },
];

// pm.jsx:61 PM_CONTRACTS (5) — no/scope/value/status verbatim.
const PM_CONTRACTS = [
  { no: "MT-2569-018", scope: "ลิฟต์โดยสาร 2 ชุด (MAXTECH)", value: 144000, mode: "MA" as const, status: "active" },
  { no: "FIRE-2569-02", scope: "ระบบดับเพลิง + ปั๊มดับเพลิง", value: 96000, mode: "per_visit" as const, status: "expiring" },
  { no: "GEN-2569-04", scope: "Genset Cummins 500kVA", value: 60000, mode: "MA" as const, status: "active" },
  { no: "AC-2569-09", scope: "Chiller + AHU/FCU", value: 210000, mode: "MA" as const, status: "active" },
  { no: "OM-2569-01", scope: "O&M โรงไฟฟ้า 8MW เต็มระบบ", value: 2400000, mode: "MA" as const, status: "active" },
];

// pm-checklist.jsx:6 PM_CHECKLIST_TEMPLATES (5) — kind + real items[].
const CHECKLIST_TEMPLATES = [
  { kind: "ลิฟต์", name: "ลิฟต์โดยสาร (MAXTECH)", items: ["ตรวจระบบเบรกและมอเตอร์ฉุดลาก", "ตรวจสลิง/ลวดสลิงและความตึง", "ทดสอบปุ่มฉุกเฉิน + อินเตอร์คอม", "ตรวจประตูชั้น-ประตูลิฟต์ + เซนเซอร์", "ทดสอบระบบจอดชั้นเรียบ (Leveling)", "ตรวจระบบไฟส่องสว่างในห้องโดยสาร"] },
  { kind: "ระบบดับเพลิง", name: "ระบบดับเพลิง + ปั๊ม", items: ["ทดสอบปั๊มดับเพลิง (Jockey/Main)", "ตรวจแรงดันระบบท่อ + วาล์ว", "ทดสอบสัญญาณแจ้งเหตุ + Detector", "ตรวจถังดับเพลิงและหัวจ่าย"] },
  { kind: "Genset", name: "เครื่องกำเนิดไฟฟ้า (Genset)", items: ["ตรวจระดับน้ำมันเครื่อง + น้ำหล่อเย็น", "ทดสอบ Start/Transfer (ATS)", "ตรวจแบตเตอรี่ + เครื่องชาร์จ", "ตรวจรอยรั่ว + ระบบไอเสีย"] },
  { kind: "อินเวอร์เตอร์", name: "อินเวอร์เตอร์ / โซลาร์", items: ["ตรวจค่า Performance / Error log", "ทำความสะอาดแผง + ตรวจการบังเงา", "ตรวจขั้วต่อ DC/AC + Torque", "วัดค่าฉนวน (Insulation) + กราวด์"] },
  { kind: "ทั่วไป", name: "ทั่วไป (Generic)", items: ["ตรวจสภาพทั่วไปและทำความสะอาด", "ตรวจระบบไฟฟ้า/การเชื่อมต่อ", "ทดสอบการทำงาน + วัดค่าพารามิเตอร์", "หล่อลื่น/เปลี่ยนอะไหล่สิ้นเปลือง"] },
];

// timeline.jsx:238 TIMELINE_TASKS (5 groups / 13 tasks). g = group index.
const TL_GROUPS = ["01 งานเตรียม + Site Work", "02 งานโครงสร้าง", "03 งานสถาปัตยกรรม", "04 งานระบบไฟฟ้า + ประปา", "05 ส่งมอบ + Handover"];
const TL_TASKS: { g: number; label: string; status: string; pct: number }[] = [
  { g: 0, label: "เคลียร์พื้นที่ + ปักหมุด", status: "done", pct: 100 },
  { g: 0, label: "ระบบไฟฟ้า/น้ำชั่วคราว", status: "done", pct: 100 },
  { g: 1, label: "งานฐานราก B-1 ถึง B-24", status: "done", pct: 100 },
  { g: 1, label: "งานเสา-คาน ชั้น 1 B-1..B-12", status: "done", pct: 100 },
  { g: 1, label: "งานเสา-คาน ชั้น 2 B-1..B-12", status: "ongoing", pct: 92 },
  { g: 1, label: "งานเสา-คาน B-13..B-24", status: "ongoing", pct: 38 },
  { g: 2, label: "งานก่ออิฐ-ฉาบ Block B (รวม)", status: "soon", pct: 0 },
  { g: 2, label: "งานกระเบื้องพื้น Block B", status: "future", pct: 0 },
  { g: 2, label: "งานสีภายใน + ภายนอก", status: "future", pct: 0 },
  { g: 3, label: "ระบบไฟฟ้าหลัก Block B", status: "ongoing", pct: 78 },
  { g: 3, label: "ระบบประปา-สุขาภิบาล Block B", status: "ongoing", pct: 45 },
  { g: 4, label: "ตรวจรับ + เก็บงาน (B-1..B-12)", status: "future", pct: 0 },
  { g: 4, label: "ส่งมอบลูกค้า + เริ่ม Warranty", status: "future", pct: 0 },
];

// timeline.jsx:264 MILESTONES (5)
const MILESTONES = [
  { l: "เริ่มก่อสร้าง", day: 0, status: "done" },
  { l: "ครบฐานราก B-Block", day: 40, status: "done" },
  { l: "โครงสร้างชั้น 2 เสร็จ", day: 95, status: "ongoing" },
  { l: "ส่งมอบลอตแรก B-1..B-12", day: 195, status: "soon" },
  { l: "ปิดโครงการ Block B", day: 240, status: "future" },
];

// sales-crm.jsx:191 LEADS_BY_STAGE (10 = lead 4 / visit 2 / quote 2 / booking 1 / contract 1)
const LEADS: { name: string; phone: string; source: string; interest: string; stage: "lead" | "visit" | "quote" | "booking" | "contract"; hot: boolean; note: string; days: number }[] = [
  { name: "คุณวีระชัย ใจกล้า", phone: "081-234-5678", source: "Facebook Ads", interest: "Block B · 3 ห้องนอน", stage: "lead", hot: false, note: "สอบถามราคาเริ่ม + ดาวน์ขั้นต่ำ", days: 0 },
  { name: "คุณมาลี พรหมศักดิ์", phone: "086-789-0123", source: "Walk-in", interest: "Block A · บ้านเดี่ยว", stage: "lead", hot: true, note: "พร้อมเงินสด · ขอนัดชมห้องตัวอย่าง", days: 1 },
  { name: "คุณสุรชัย ทองศรี", phone: "095-456-7890", source: "Line OA", interest: "Block C · 4 ห้องนอน", stage: "lead", hot: false, note: "ขอข้อมูลโปรโมชั่นเดือนนี้", days: 2 },
  { name: "คุณเปรมจิต สุขใจ", phone: "083-321-8765", source: "Referral", interest: "Block B · ทาวน์โฮม", stage: "lead", hot: false, note: "เพื่อนแนะนำ · ยังไม่ตอบ", days: 5 },
  { name: "คุณวิทยา แสงดาว", phone: "081-555-1234", source: "Facebook", interest: "Block B-08", stage: "visit", hot: true, note: "นัดดูบ้านตัวอย่าง · มากับครอบครัว", days: 0 },
  { name: "คุณอาภา ดารารัตน์", phone: "098-765-4321", source: "Walk-in", interest: "Block A-25", stage: "visit", hot: false, note: "นัดดู Phase 1 + คุยเรื่องสินเชื่อ", days: 0 },
  { name: "คุณภาคิน รุ่งโรจน์", phone: "081-888-2222", source: "Walk-in", interest: "B-15 · QO-0184", stage: "quote", hot: true, note: "QO รออนุมัติของลูกค้า · ขอลดมุ้งกันยุง", days: 0 },
  { name: "คุณจินตนา ผ่องใส", phone: "086-444-5555", source: "Line OA", interest: "A-08 · QO-0183", stage: "quote", hot: false, note: "เปรียบเทียบกับโครงการคู่แข่ง", days: 0 },
  { name: "คุณวรรณา ศรีจันทร์", phone: "081-234-9999", source: "Walk-in", interest: "B-12 · จอง", stage: "booking", hot: true, note: "จองแล้ว · ทำสัญญาเดือนนี้", days: 0 },
  { name: "คุณสมพร เพชรไทย", phone: "086-111-2222", source: "Referral", interest: "B-13 · CT-0084", stage: "contract", hot: true, note: "ทำสัญญาแล้ว · เริ่มผ่อนดาวน์", days: 0 },
];

// sales-service.jsx:3 SERVICE_TICKETS (7)
const SERVICE_TICKETS = [
  { no: "SR-2026-0048", channel: "LINE", category: "ระบบประปา", title: "ก๊อกน้ำห้องครัวรั่วซึม ฐานก๊อก", prio: "high", status: "scheduled" },
  { no: "SR-2026-0047", channel: "App", category: "ระบบไฟฟ้า", title: "เบรกเกอร์ตัดบ่อย ห้องนอน 2", prio: "high", status: "fixing" },
  { no: "SR-2026-0046", channel: "โทร", category: "หน้าต่าง", title: "บานเลื่อนหน้าต่างฝืด เปิดปิดยาก", prio: "normal", status: "received" },
  { no: "SR-2026-0045", channel: "LINE", category: "ทาสี", title: "สีลอกบริเวณกันสาดด้านหน้า", prio: "normal", status: "fixed" },
  { no: "SR-2026-0044", channel: "App", category: "ระบบประปา", title: "ชักโครกชั้นบนน้ำไหลตลอด", prio: "normal", status: "fixed" },
  { no: "SR-2026-0043", channel: "Walk-in", category: "พื้น", title: "กระเบื้องห้องน้ำชั้นล่างแตก", prio: "low", status: "closed" },
  { no: "SR-2026-0042", channel: "LINE", category: "ระบบแอร์", title: "แอร์ห้องนอนใหญ่ไม่เย็น", prio: "high", status: "closed" },
];

// inventory.jsx:3 ITEMS (8)
const INV_ITEMS = [
  { code: "MAT-CEM-001", cat: "Material", name: "ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ", unit: "ถุง", price: 168.5, stock: 1240, low: 200, status: "ok" },
  { code: "MAT-STL-024", cat: "Material", name: "เหล็กเส้นกลม SR24 12mm × 10m", unit: "เส้น", price: 425, stock: 1080, low: 300, status: "ok" },
  { code: "MAT-STL-036", cat: "Material", name: "เหล็กเส้นข้ออ้อย SD40 16mm", unit: "เส้น", price: 685, stock: 220, low: 300, status: "low" },
  { code: "MAT-TILE-60A", cat: "Material", name: "กระเบื้องปูพื้น 60×60 (Type-A)", unit: "ตร.ม.", price: 302, stock: 4200, low: 500, status: "ok" },
  { code: "MAT-PAINT-PR", cat: "Material", name: "สีทาภายใน Premium (5L)", unit: "แกลลอน", price: 302.5, stock: 8, low: 50, status: "crit" },
  { code: "MAT-WIRE-25", cat: "Material", name: "สาย VCT 2.5mm × 100m", unit: "ม้วน", price: 7000, stock: 46, low: 24, status: "ok" },
  { code: "TOOL-MIX-001", cat: "Tool", name: "เครื่องผสมปูน 350L (เครื่องที่ 1)", unit: "เครื่อง", price: 0, stock: 3, low: 1, status: "ok" },
  { code: "MAT-FORM-12", cat: "Material", name: "ไม้แบบหล่อ 1.2×2.4m", unit: "แผ่น", price: 480, stock: 124, low: 100, status: "ok" },
];

// inventory.jsx:114 WH (5)
const WAREHOUSES = [
  { name: "คลังกลาง · ราชพฤกษ์", loc: "ราชพฤกษ์ · นนทบุรี" },
  { name: "คลัง Block A", loc: "ไซต์ Block A" },
  { name: "คลัง Block B", loc: "ไซต์ Block B" },
  { name: "เครื่องมือ-Site", loc: "ไซต์ก่อสร้าง" },
  { name: "คลัง Block C", loc: "ไซต์ Block C" },
];

// inventory.jsx:206 TRANSFERS (4)
const INV_TRANSFERS = [
  { no: "TR-2026-0084", from: 0, to: 2, value: 184500, status: "approved" },
  { no: "TR-2026-0083", from: 0, to: 1, value: 22400, status: "pending" },
  { no: "TR-2026-0082", from: 2, to: 0, value: 25500, status: "approved" },
  { no: "TR-2026-0081", from: 0, to: 3, value: 0, status: "approved" },
];

// inventory.jsx:262 ISSUES (4)
const INV_ISSUES = [
  { no: "IS-2026-0218", wh: 2, value: 24000, status: "approved" },
  { no: "IS-2026-0217", wh: 2, value: 17000, status: "approved" },
  { no: "IS-2026-0216", wh: 1, value: 2400, status: "pending" },
  { no: "IS-2026-0215", wh: 2, value: 16800, status: "approved" },
];

// dms.jsx:14 DMS_SEED (13). The 3 `defect`-cat docs are the real "defect reports"
// for WO-2026-0055 งวด 3 (P0-BE-10 rework item 5 — Defect table stays 0 per §สรุป).
const DMS_SEED = [
  { name: "สัญญาจ้างเหมา WO-2569-012 (ทีมสมชาย).pdf", cat: "contract" },
  { name: "สัญญา PM ลิฟต์ MT-2569-018.pdf", cat: "contract" },
  { name: "สัญญาเช่าที่ดินโซลาร์ 27 ปี (สระบุรี).pdf", cat: "contract" },
  { name: "แบบสถาปัตย์ Block B Rev.C.dwg", cat: "drawing" },
  { name: "โมเดล BIM อาคาร A (IFC).ifc", cat: "drawing" },
  { name: "ใบอนุญาตก่อสร้าง อ.1 เฟส 2.pdf", cat: "permit" },
  { name: "ใบอนุญาตจัดสรร (คค.) บางบัวทอง.pdf", cat: "permit" },
  { name: "งบการเงินสอบทาน Q2-2569.xlsx", cat: "finance" },
  { name: "โฉนด 11902 ราชพฤกษ์ เฟส 4 (สแกน).pdf", cat: "land" },
  { name: "ภาพความคืบหน้า Block B - มิ.ย. 69 (86 รูป).zip", cat: "photo" },
  { name: "Defect List งวด 3 · WO-2026-0055 (ก่ออิฐ-ฉาบ).pdf", cat: "defect" },
  { name: "รูปจุดบกพร่อง B-06 ก่อน-หลังแก้ (12 รูป).zip", cat: "defect" },
  { name: "รายงานของเสียหาย GR-2569-0448 (อิฐมวลเบา).pdf", cat: "defect" },
];

// exec-audit.jsx:162 AUDIT_ENTRIES (13). act is free text; obj/detail verbatim.
const AUDIT_ENTRIES = [
  { act: "approve", obj: "WO-2026-0055 · งวด 3 (ตรวจครั้งที่ 2)", detail: "ตรวจรับผ่านหลังแก้ Defect · ออก GR + ตั้งหนี้ AP 342,000 ฿ (หักประกัน 18,000)" },
  { act: "approve", obj: "GR-2569-0455 · เหล็ก SD40 24 ตัน", detail: "ตรวจนับ-รับของผ่านมือถือ · สต๊อกเข้าคลัง Block B" },
  { act: "edit", obj: "WO-2026-0055 · งวด 3", detail: "ตีกลับงวดงาน · บันทึก Defect: ฉาบผนัง B-06 เป็นคลื่น + ขอบวงกบไม่เรียบ" },
  { act: "approve", obj: "BOQ-2026-B-02 v4", detail: "อนุมัติ BOQ Revise · 12.4 ลบ." },
  { act: "create", obj: "ถอด BOQ จาก A-model.ifc", detail: "สร้าง 18 รายการ · 4.85 ลบ." },
  { act: "create", obj: "PMWO-2569-0312", detail: "สร้างใบงาน PM ลิฟต์ MX-1000" },
  { act: "approve", obj: "PR-2026-0418", detail: "อนุมัติ PR วัสดุ · 1.84 ลบ." },
  { act: "edit", obj: "MT-2569-018", detail: "แก้ไขมูลค่าสัญญา → 199,000" },
  { act: "post", obj: "AP-2026-0291", detail: "ตั้งหนี้จากสัญญา PM · 96,000" },
  { act: "edit", obj: "L-071", detail: "เลื่อนสถานะ → Due Diligence" },
  { act: "delete", obj: "AC-2569-09 (ร่าง)", detail: "ลบร่างสัญญาซ้ำ" },
  { act: "sync", obj: "SAP REM", detail: "ซิงก์ข้อมูลโครงการ 7 รายการ" },
  { act: "create", obj: "สัญญาขาย A-12", detail: "ทำสัญญาขายยูนิต · 3.2 ลบ." },
];

// land.jsx:17 LAND_PLOTS (8). area rai-ngan-wa → m² (1 rai=1600, 1 ngan=400, 1 wa=4).
const LAND_PLOTS = [
  { deed: "โฉนด 24517", rai: 18, ngan: 2, wa: 40, gps: "13.9182, 100.4023", pricePerRai: 4200000, stage: "nego", tenure: "negotiate", proj: "bbt" },
  { deed: "โฉนด 11902", rai: 24, ngan: 0, wa: 0, gps: "13.8076, 100.4519", pricePerRai: 6800000, stage: "dd", tenure: "buy", proj: "rjp" },
  { deed: "นส.3ก 442", rai: 120, ngan: 1, wa: 0, gps: "14.7541, 100.7218", pricePerRai: 850000, stage: "feas", tenure: "lease", proj: "slr" },
  { deed: "โฉนด 33415", rai: 8, ngan: 3, wa: 12, gps: "14.0712, 100.6201", pricePerRai: 9500000, stage: "survey", tenure: "buy", proj: "phk" },
  { deed: "นส.3ก 7781", rai: 240, ngan: 0, wa: 0, gps: "14.8893, 101.1402", pricePerRai: 620000, stage: "source", tenure: "lease", proj: null },
  { deed: "โฉนด 24518", rai: 15, ngan: 0, wa: 0, gps: "13.9201, 100.4055", pricePerRai: 4350000, stage: "deal", tenure: "buy", proj: "bbt" },
  { deed: "โฉนด 11888", rai: 32, ngan: 1, wa: 20, gps: "13.8061, 100.4490", pricePerRai: 6500000, stage: "close", tenure: "buy", proj: "rjp" },
  { deed: "นส.3ก 451", rai: 95, ngan: 2, wa: 0, gps: "14.7588, 100.7301", pricePerRai: 880000, stage: "source", tenure: "lease", proj: "slr" },
];

// group-C Wave-1 (C-SEED-DUEDATE): ONE UTC-floored "seed today" anchor. Every
// relative date below derives from it so the dashboard's overdue-payable alert
// (due < today) and 7-day cashflow window (due in [today, today+7d]) light up on
// ANY seed date — never hardcode calendar literals (they rot as the clock moves).
const SEED_NOW = new Date();
const SEED_TODAY = new Date(SEED_NOW);
SEED_TODAY.setUTCHours(0, 0, 0, 0);
/** ISO calendar date (YYYY-MM-DD) exactly n days from the UTC-floored seed today. */
function isoDaysFromToday(n: number): string {
  const d = new Date(SEED_TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ap.jsx:3 AP_BILL (5) / :160 PV_LIST (4) / ar.jsx:7 AR_INV (6) / accounting-extra2 ARCN_SEED (3)
// B-089 (F-AP1, migration 0026): `wht` (all rows) + `retention` (WO row only)
// transcribed from ap.jsx:4-8. Row AP-2026-0180's ref is "WO-2026-0117 งวด 3" (a
// subcon WO billing, not a PO/GR): `wo` = the seeded WO index (WO_NOS[0] = wo:0),
// and it carries retention 64,500. Rows without a value omit the field -> null.
const AP_BILL: {
  no: string; inv: string; amount: number; vat: number; wht: number;
  retention?: number; wo?: number; status: string;
}[] = [
  { no: "AP-2026-0184", inv: "INV-CPC-118", amount: 920000, vat: 60187, wht: 27600, status: "approved" },
  { no: "AP-2026-0183", inv: "INV-TOA-042", amount: 96800, vat: 6334, wht: 2904, status: "approved" },
  { no: "AP-2026-0182", inv: "INV-FI-271", amount: 415400, vat: 27184, wht: 12462, status: "approved" },
  { no: "AP-2026-0181", inv: "INV-TST-028", amount: 268000, vat: 17542, wht: 8040, status: "approved" },
  { no: "AP-2026-0180", inv: "—", amount: 645000, vat: 42196, wht: 19350, retention: 64500, wo: 0, status: "pending" },
];
// ap_billing.kind per row (B-079 / F2, migration 0019), index-aligned to AP_BILL
// (each row is the sole billing of po:i). Derived from the PO payment state in
// po-wo.jsx:4-9 (index-aligned via PO_NOS → po:i): only the down-payment paid →
// `deposit` (PO-0291 po:0, PO-0289 po:2); fully paid → `final` (PO-0288 po:3,
// PO-0287 po:4 closed); otherwise `progress` (PO-0290 po:1, nothing paid yet).
// So deposit = Σ(kind=deposit) and paid = Σ(all) are both real, non-equal sums.
const AP_KIND = ["deposit", "progress", "deposit", "final", "final"] as const;
// group-C Wave-1 (C-SEED-DUEDATE): ap_billing.due_date offsets in DAYS relative
// to SEED_TODAY, index-aligned to AP_BILL. ap.jsx lists no due column, so the
// spread is chosen (Wei ruling 2026-07-19: payables-only negative net accepted)
// to exercise both dashboard legs on any seed date: i0 PAST + approved (never
// paid/settled) → OVERDUE_PAYABLE alert; i1/i4 inside [today, today+7d] →
// cashflow payables; i2/i3 beyond the window (realistic tail, proves the bound).
const AP_DUE_DAYS = [-10, 3, 14, 30, 5] as const;
// B-089 (F-AP1, migration 0026): gross `amount`, `retention`, `method`, and cheque
// details transcribed from ap.jsx:161-164. method codes are the mock's own English
// keys (PVCreateForm:252-257: "เช็ค"->cheque, "โอน"->transfer). cheque_no/cheque_bank
// are populated only for cheque-method PVs (the mock lists "—" for transfer rows,
// whose "chequeBank" is really the transfer account, not a cheque bank -> null).
// cheque_date is not carried by PV_LIST rows -> null (per C10 no-fabrication).
// `no` = the PV document number (ap.jsx:161-164), carried so the bank statement
// reconcile (F-BANK2) can resolve a matched line's "PV-2026-xxxx" ref to the
// seeded pv row by number. The pv table has no `no` column, so the pv insert
// ignores this field — it is a seed-side lookup key only.
const PV_LIST: {
  no: string;
  net: number; wht: number; amount: number; retention: number;
  method: "cash" | "transfer" | "cheque" | "deposit";
  chequeNo: string | null; chequeBank: string | null;
}[] = [
  { no: "PV-2026-0184", net: 561154, wht: 19350, amount: 645000, retention: 64500, method: "cheque",   chequeNo: "CH-040128", chequeBank: "SCB · บัญชี OD" },
  { no: "PV-2026-0183", net: 892400, wht: 27600, amount: 920000, retention: 0,     method: "transfer", chequeNo: null,        chequeBank: null },
  { no: "PV-2026-0182", net: 93896,  wht: 2904,  amount: 96800,  retention: 0,     method: "transfer", chequeNo: null,        chequeBank: null },
  { no: "PV-2026-0181", net: 402938, wht: 12462, amount: 415400, retention: 0,     method: "cheque",   chequeNo: "CH-040127", chequeBank: "SCB" },
];
// bank.jsx:46-52 Cheque Register (6 issued cheques). no/amount/status verbatim;
// the "วันที่ในเช็ค" Thai-BE date (dd พ.ค. 69, พ.ค.=May, 69=2569 BE=2026 CE) -> the
// cheque's dueDate (calendar date). `pvIdx` = the issuing PV's PV_LIST index when
// that PV is seeded (CH-040128->PV-2026-0184=pv:0, CH-040127->PV-2026-0181=pv:3);
// the other 4 reference PVs outside the 4 seeded rows -> pv_id null. status codes
// wait|cleared|returned (Thai labels รอขึ้น/ขึ้นเงิน/เช็คคืน are an i18n concern).
const CHEQUE_REG: { no: string; amount: number; date: string; status: string; pvIdx: number | null }[] = [
  { no: "CH-040128", amount: 561150, date: "2026-05-25", status: "wait",     pvIdx: 0 },
  { no: "CH-040127", amount: 402938, date: "2026-05-23", status: "wait",     pvIdx: 3 },
  { no: "CH-040126", amount: 184500, date: "2026-05-20", status: "cleared",  pvIdx: null },
  { no: "CH-040125", amount: 380400, date: "2026-05-18", status: "cleared",  pvIdx: null },
  { no: "CH-040124", amount: 84500,  date: "2026-05-15", status: "returned", pvIdx: null },
  { no: "CH-040123", amount: 268000, date: "2026-05-14", status: "cleared",  pvIdx: null },
];
const AR_INV = [
  { no: "INV-2026-0418", amount: 728000, vat: 0 }, { no: "INV-2026-0417", amount: 485000, vat: 0 },
  { no: "INV-2026-0416", amount: 2148000, vat: 0 }, { no: "INV-2026-0415", amount: 824000, vat: 0 },
  { no: "INV-2026-0414", amount: 485000, vat: 0 }, { no: "INV-2026-0413", amount: 184000, vat: 12880 },
];
const ARCN_SEED = [
  { no: "CN-2569-008", reason: "คืนเงินจอง - ยกเลิกสัญญา", amount: 200000, status: "approved" },
  { no: "CN-2569-009", reason: "งานลด (Variation Order)", amount: 340000, status: "pending" },
  { no: "CN-2569-010", reason: "ส่วนลด ณ วันโอน", amount: 150000, status: "draft" },
];

// sales-process.jsx:24 units generator — codes B-01..B-84, status by zero-based i:
//   i<48 soldBuilt · 48-56 sold · 57-61 booked · 62-67 built · else empty.
const unitCode = (i: number): string => `B-${String(i + 1).padStart(2, "0")}`;
const unitStage = (i: number): string =>
  i < 48 ? "soldBuilt" : i < 57 ? "sold" : i < 62 ? "booked" : i < 68 ? "built" : "empty";

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot seed.");
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    await db.transaction(async (tx) => {
      // --- idempotency: wipe every seeded table, one transaction, FK-safe ---
      const res = await tx.execute(
        sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      const tableNames = (res.rows as { tablename: string }[])
        .map((r) => r.tablename)
        .filter((n) => !n.startsWith("__"));
      if (tableNames.length > 0) {
        const list = tableNames.map((n) => `"${n}"`).join(", ");
        await tx.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
      }

      // === Platform =======================================================
      await tx.insert(schema.packages).values(
        PACKAGES.map((p) => ({
          id: det(`package:${p.key}`), size: p.size, name: p.name,
          priceM: p.priceM, priceY: p.priceY, limits: p.limits, menus: [...p.menus], subRules: p.subRules,
        })),
      );

      // B-022(ก): 9 tenant companies (name = org); no group parent / extra juristic
      // fields in the SUBSCRIBERS mock (was: 3 affiliated-group companies).
      await tx.insert(schema.companies).values(
        SUBSCRIBERS.map((s) => ({
          id: det(`company:${s.key}`), name: s.org,
        })),
      );
      const CO1 = det("company:T-1001"); // main tenant — every company-scoped record hangs here.

      // B-041(ก+): stamp the affiliated company group (เครือ) — the 3
      // company-accept.jsx COMPANIES rows become real company rows linked to
      // the T-1001 tenant's group via group_parent_id = CO1 (Appendix B item
      // 14; the group head keeps the subscription). The 9 tenant companies
      // above are untouched (B-022(ก) stands) — company rows 9 → 12; count
      // delta flagged to QA via REVIEW-QUEUE.
      await tx.insert(schema.companies).values(
        GROUP_COMPANIES.map((c) => ({
          id: det(`company:group:${c.key}`), name: c.name, taxId: c.taxId,
          short: c.short, color: c.color, docPrefix: c.docPrefix, biz: c.biz,
          groupParentId: CO1,
        })),
      );

      // Each subscription points to its OWN company (B-022(ก)); package per the real
      // SUBSCRIBERS pkg tier (pro=M / enterprise=Full / starter=S).
      await tx.insert(schema.subscriptions).values(
        SUBSCRIBERS.map((s, i) => ({
          id: det(`sub:${i}`), companyId: det(`company:${s.key}`),
          packageId: det(`package:${s.pkg}`), cycle: at(SUB_CYCLES, i), status: at(SUB_STATUS, i),
        })),
      );

      // B-025(ก): 4 admin invoices (other tenants, by org→SUBSCRIBERS index) + T-1001's
      // 3 real INV-SUB-* invoices = 7 platform_invoice rows.
      await tx.insert(schema.platformInvoices).values([
        ...PLATFORM_INV.map((inv, i) => ({
          id: det(`pinv:${i}`),
          subscriptionId: det(`sub:${SUBSCRIBERS.findIndex((s) => s.key === inv.subKey)}`),
          amount: m(inv.amount), status: inv.status,
        })),
        ...T1001_SUB_INV.map((inv, i) => ({
          id: det(`pinv:t1001:${i}`), subscriptionId: det(`sub:0`),
          amount: m(inv.amount), status: inv.status,
        })),
      ]);

      await tx.insert(schema.roles).values(
        // B-089 (F-PV1): the 8 ROLE_DEFS + the new Finance Manager (FINANCE_MGR).
        [...ROLE_DEFS, FINANCE_MGR].map((r) => ({
          id: det(`role:${r.key}`), companyId: CO1, name: r.name,
          approvalLimits: r.limit == null ? {} : { default: r.limit },
          perms: permsFrom(r.perms),
          // B-051 superset: single blanket limit as real baht (null = unlimited /
          // no ceiling) + the approval tier. currency_code defaults to THB.
          approvalLevel: r.level,
          approvalLimit: r.limit == null ? null : m(r.limit),
        })),
      );

      await tx.insert(schema.users).values(
        COMPANY_USERS.map((u, i) => ({
          id: det(`user:${i}`), companyId: CO1, email: u.email, name: u.name,
          // B-089 (F-PV1): user:9 holds the new Finance Manager role; all other
          // users keep the unchanged 8-role cyclic pick (at(ROLE_DEFS, i)).
          roleId: i === FINANCE_MGR_USER_IDX
            ? det("role:finmgr")
            : det(`role:${at(ROLE_DEFS, i).key}`),
          status: (u.status === "active" ? "active" : "blocked") as "active" | "blocked",
        })),
      );

      // better-auth credentials (P1-BE-01, B-016(ก)): one auth_user + one
      // "credential" auth_account per COMPANY_USERS row so the dev stack is
      // sign-in-able against the REAL bearer flow (B-028(ก)) out of one
      // `docker compose up`. auth_user.email ↔ user.email links the session to
      // the dictionary user row within company_id.
      //
      // Password is a DEV-ONLY default (same convention as the compose
      // POSTGRES_PASSWORD dev default "juneflow-dev" — infra/docker-compose.yml);
      // real deployments must provision credentials outside the seed. The hash
      // comes from better-auth's own scrypt (better-auth/crypto) so the format
      // always matches what better-auth verifies — never hand-rolled.
      const DEV_PASSWORD = "juneflow-dev";
      const devPasswordHash = await hashPassword(DEV_PASSWORD);
      await tx.insert(schema.authUsers).values(
        COMPANY_USERS.map((u, i) => ({
          id: det(`authuser:${i}`), name: u.name, email: u.email,
          emailVerified: true, companyId: CO1,
        })),
      );
      await tx.insert(schema.authAccounts).values(
        COMPANY_USERS.map((_u, i) => ({
          id: det(`authacct:${i}`), accountId: det(`authuser:${i}`),
          providerId: "credential", userId: det(`authuser:${i}`),
          password: devPasswordHash,
        })),
      );

      // === Master / โครงการ ================================================
      // B-065: the 4 product defaults are GLOBAL (company_id null) — shared by
      // every tenant. Custom types (company_id = tenant) are created at runtime
      // via POST /project-types, never seeded.
      await tx.insert(schema.projectTypes).values(
        PROJECT_TYPES.map((t) => ({
          id: det(`ptype:${t.key}`), companyId: null, key: t.key, name: t.name,
          hierarchy: t.hierarchy, modules: t.modules,
        })),
      );

      await tx.insert(schema.projects).values(
        PROJECTS.map((p, i) => ({
          id: det(`project:${p.key}`), companyId: CO1, typeId: det(`ptype:${p.type}`),
          name: p.name, short: p.short, color: p.color,
          budget: m((i + 5) * 10_000_000), status: "active",
          // B-102 (Wei = ก): curated health verbatim (exec-audit.jsx:14-20).
          health: PROJECT_HEALTH[p.key] ?? null,
        })),
      );

      await tx.insert(schema.models).values(
        MODELS.map((mo) => ({
          id: det(`model:${mo.code}`), companyId: CO1,
          // name = pure display name (mock `type`); code is its own column now.
          name: mo.type, code: mo.code, area: mo.area,
          bed: mo.bed, bath: mo.bath, parking: mo.parking,
          price: m(mo.price), status: mo.status, color: mo.color,
        })),
      );

      // project_node tree: 16 phase nodes + 3 block nodes + 84 unit nodes (B-01..B-84).
      const nodeRows: (typeof schema.projectNodes.$inferInsert)[] = [];
      for (const p of PROJECTS) {
        for (const ph of p.phases) {
          nodeRows.push({
            id: det(`node:${p.key}:${ph.k}`), projectId: det(`project:${p.key}`),
            kind: "phase", name: ph.l, saleStatus: null,
          });
        }
      }
      for (const b of BLOCK_SEED) {
        nodeRows.push({
          id: det(`block:${b.code}`), projectId: det("project:rjp"),
          // blocks live under เฟส 2 (Block B+C) of ราชพฤกษ์
          parentId: det("node:rjp:p2"), modelId: det(`model:${b.modelKey}`),
          // B-053: the block code (HierarchyNode.code / unit-code prefix).
          kind: "block", name: b.name, code: b.code, saleStatus: null,
        });
      }
      // 84 unit leaf nodes under Block B (B-009: persist the sales-process generator).
      for (let i = 0; i < 84; i++) {
        nodeRows.push({
          id: det(`unitnode:${i}`), projectId: det("project:rjp"),
          parentId: det("block:B"), modelId: det("model:B-1"),
          // B-053: unit code = "{blockCode}-{NN}" (= its name).
          kind: "unit", name: unitCode(i), code: unitCode(i), saleStatus: unitStage(i),
        });
      }
      await tx.insert(schema.projectNodes).values(nodeRows);

      await tx.insert(schema.costCenters).values(
        // B-059: full mock columns; budget = FULL baht numeric (m() 2-decimal
        // string), currency_code = THB via the column default.
        CC_SEED.map((c) => ({
          id: det(`cc:${c.code}`), projectId: det("project:rjp"), code: c.code, name: c.name,
          type: c.type, link: c.link, owner: c.owner, budget: m(c.budget), status: c.status,
        })),
      );

      // B-023(ก)+B-026(ก): master-party VENDOR_SEED (6, all supplier) + 7 subcon firms.
      // Only the 6 register firms (SC-01..SC-06) are kind=subcon → จอทะเบียนผู้รับเหมา = 6;
      // SC-07 is a contract counterparty outside the register → supplier. Total vendors = 13.
      // B-071 (P2-BE-08): master-party rows carry code/addr/bank/status verbatim from the
      // mock; subcon firms carry their SC-xx code (from SUBCON_FIRMS) and default status
      // 'active' — the mock has no addr/bank for them → null (honest, never invented).
      await tx.insert(schema.vendors).values([
        ...VENDOR_SEED.map((v) => ({
          id: det(`vendor:${v.code}`), companyId: CO1, name: v.name, code: v.code, taxId: v.taxId,
          kind: "supplier" as const, creditTerm: v.term, addr: v.addr, bank: v.bank, status: v.status,
        })),
        ...SUBCON_FIRMS.map((f) => ({
          id: det(`vendor:${f.code}`), companyId: CO1, name: f.name, code: f.code, taxId: null,
          kind: (f.code === "SC-07" ? "supplier" : "subcon") as "subcon" | "supplier",
          creditTerm: null, addr: null, bank: null, status: "active" as const,
        })),
      ]);
      // All master-party vendors are suppliers now (B-026) → PO/AP pull from here.
      const SUPPLIER_VENDORS = VENDOR_SEED.map((v) => det(`vendor:${v.code}`));

      await tx.insert(schema.customers).values(
        CUSTOMER_SEED.map((c) => ({ id: det(`customer:${c.code}`), companyId: CO1, name: c.name, taxId: c.taxId })),
      );

      // org tree — parent = last-seen node one level up. createdAt is staggered
      // by array index (all rows would otherwise share the transaction's now())
      // so GET /org-units can return the ORG_SEED document order via a
      // (created_at, id) sibling sort — the mock renders ORG_SEED in array order.
      const orgRows: (typeof schema.orgUnits.$inferInsert)[] = [];
      const lastAtLevel: Record<number, string> = {};
      const ORG_EPOCH = Date.UTC(2024, 0, 1, 0, 0, 0);
      ORG_SEED.forEach((o, i) => {
        const id = det(`org:${o.code}`);
        orgRows.push({
          id, companyId: CO1, parentId: o.lvl === 0 ? null : (lastAtLevel[o.lvl - 1] ?? null),
          level: o.lvl, icon: o.ic, name: o.name, code: o.code, note: o.note,
          createdAt: new Date(ORG_EPOCH + i * 1000),
        });
        lastAtLevel[o.lvl] = id;
      });
      await tx.insert(schema.orgUnits).values(orgRows);

      await tx.insert(schema.docNumberings).values(
        DOCNUM_SEED.map((d) => ({
          id: det(`docnum:${d.prefix}`), companyId: CO1, type: d.type, prefix: d.prefix,
          // B-060: verbatim mock string (leading zeros / "B-02 v3" preserved).
          running: d.running, resetRule: d.reset, locked: d.lock,
        })),
      );

      // === BOQ / procurement ==============================================
      // BOM: 4 models; B-1 carries its 17 real BOM_LINES, the rest empty (mock only has B-1).
      await tx.insert(schema.boms).values(
        BOM_MODELS.map((code) => ({
          id: det(`bom:${code}`), companyId: CO1, unitType: code,
          items: code === "B-1" ? BOM_LINES_B1 : [],
        })),
      );

      await tx.insert(schema.boqDocs).values(
        BOQ_DOCS.map((d, i) => {
          // B-081: archive approver + timestamp for approved docs with an ARCHIVE
          // match (approver → seeded Director user:APPROVER_IDX).
          const approvedAtIso = d.status === "approved" ? ARCHIVE_BY_NO[d.no] : undefined;
          return {
            id: det(`boqdoc:${i}`), projectId: det("project:rjp"),
            no: d.no, name: d.name, scope: d.scope, version: d.ver, status: d.status,
            approvedBy: approvedAtIso ? det(`user:${APPROVER_IDX}`) : null,
            approvedAt: approvedAtIso ? new Date(approvedAtIso) : null,
          };
        }),
      );

      // B-081 (F4): the Revise history of the archived docs (only BOQ-2026-B-02
      // carries a history[] in the mock). Inserted after boqDocs + users exist.
      await tx.insert(schema.boqVersionHistory).values(
        BOQ_HISTORY.map((h, k) => {
          const di = BOQ_DOCS.findIndex((d) => d.no === h.docNo);
          return {
            id: det(`boqvh:${k}`), docId: det(`boqdoc:${di}`), version: h.version,
            action: h.action, by: det(`user:${APPROVER_IDX}`), at: new Date(h.at),
            delta: h.delta, note: h.note,
          };
        }),
      );

      await tx.insert(schema.boqGroups).values(
        BOQ_GROUPS.map((name, i) => ({ id: det(`boqgrp:${i}`), boqId: det("boqdoc:0"), name, seq: i + 1 })),
      );

      await tx.insert(schema.boqItems).values(
        BOQ_ITEMS.map((it, i) => ({
          id: det(`boqitem:${i}`), groupId: det(`boqgrp:${it.g}`),
          code: it.code, name: it.name, detail: it.detail, cat: it.cat, qty: m(it.qty),
          unit: it.unit, price: m(it.price),
          ccId: det(`cc:${at(CC_SEED, i).code}`), remainQty: m(it.qty),
        })),
      );

      await tx.insert(schema.cbsBudgets).values(
        BOQ_GROUPS.map((_, i) => ({
          id: det(`cbs:${i}`), groupId: det(`boqgrp:${i}`),
          budget: m(cbsGroupBudget(i)), used: m(200_000 * (i + 1)), committed: m(100_000 * (i + 1)),
        })),
      );

      await tx.insert(schema.prs).values(
        PR_ROWS.map((p, i) => {
          // Gap-2: submitted_at for every non-draft PR; approved_at only when
          // approved. The mock carries one date per PR (no separate submit/approve
          // stamps) → both use it. Stored as midnight-UTC of the CE date.
          const dateAt = new Date(`${p.date}T00:00:00Z`);
          return {
            id: det(`pr:${i}`), projectId: det("project:rjp"),
            no: p.no, type: p.type as "material" | "subcon" | "expense" | "advance",
            needDate: null, status: p.status, approvalStep: p.step,
            title: p.title,
            vendorId: p.vendorCode ? det(`vendor:${p.vendorCode}`) : null,
            requesterId: p.requesterIdx != null ? det(`user:${p.requesterIdx}`) : null,
            phase: p.phase,
            submittedAt: p.status === "draft" ? null : dateAt,
            approvedAt: p.status === "approved" ? dateAt : null,
          };
        }),
      );

      await tx.insert(schema.prItems).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`pritem:${i}`), prId: det("pr:0"), boqItemId: det(`boqitem:${i}`), qty: m(5 + i),
        })),
      );

      await tx.insert(schema.pos).values(
        PO_TOTALS.map((total, i) => ({
          id: det(`po:${i}`), prId: det(`pr:${i}`), vendorId: at(SUPPLIER_VENDORS, i),
          no: at(PO_NOS, i), total: m(total), vat: m(total * 0.07), creditTerm: 30,
          status: at(PO_STATUS, i),
        })),
      );

      // B-026(ก) + directive: rewire `wos` off the reclassified master-party contractors.
      // Each WO_ROWS.subcon (po-wo.jsx) matches a register firm by name verbatim:
      // WO-0117→บจก. รุ่งเรืองก่อสร้าง=SC-01 · 0116→หจก. ช่างไทยพัฒนา=SC-02 · 0115→บจก. ไฟฟ้า
      // อินเตอร์=SC-03 · 0114→บจก. ประปาไทย เซอร์วิส=SC-04 · 0113→หจก. งานสีบุญลือ=SC-05.
      await tx.insert(schema.wos).values(
        WO_VALUES.map((value, i) => ({
          id: det(`wo:${i}`), prId: det(`pr:${i + 1}`),
          vendorId: det(`vendor:SC-0${i + 1}`),
          no: at(WO_NOS, i), value: m(value),
          retentionPct: at(WO_RETENTION_PCTS, i), status: at(WO_STATUS, i),
        })),
      );

      await tx.insert(schema.grs).values(
        GR_RECEIVED.map((received, i) => ({
          id: det(`gr:${i}`), poId: det(`po:${i}`), no: at(GR_NOS, i), received: m(received), rejected: m(i), photos: [],
        })),
      );

      // B-078 (F1): per-GR received-line detail. Every seeded GR gets the same 3
      // detail lines (gr.jsx's static "รายการที่รับ" array); price = the linked
      // BOQ item's unit price.
      await tx.insert(schema.grItems).values(
        GR_RECEIVED.flatMap((_r, gi) =>
          GR_ITEM_LINES.map((ln, li) => ({
            id: det(`gritem:${gi}:${li}`), grId: det(`gr:${gi}`),
            boqItemId: det(`boqitem:${ln.boqItemIdx}`), name: ln.name,
            orderedQty: m(ln.ordered), receivedQty: m(ln.received), unit: ln.unit,
            price: m(at(BOQ_ITEMS, ln.boqItemIdx).price),
          })),
        ),
      );

      await tx.insert(schema.variationOrders).values([
        { id: det("vo:0"), poId: det("po:0"), dir: "add" as const, amount: m(148000), reason: "เพิ่มผนังเสริมเหล็ก B-15 ตามคำขอลูกค้า" },
        { id: det("vo:1"), poId: det("po:1"), dir: "cut" as const, amount: m(68000), reason: "ลดงานเทพื้น Roof Deck (ใช้ Pre-cast)" },
      ]);

      // === Subcon =========================================================
      // B-023(ก): each contract's vendor_id points to its REAL subcon firm
      // (SUBC_CONTRACTS.firm → SUBCON_FIRMS code), not a cycled placeholder.
      await tx.insert(schema.subconContracts).values(
        SUBC_CONTRACTS.map((c, i) => ({
          id: det(`subc:${i}`), vendorId: det(`vendor:${c.firm}`), projectId: det("project:rjp"),
          no: c.no, value: m(c.value), retentionPct: c.retentionPct, start: "2026-01-15", end: "2026-12-31",
        })),
      );

      // 16 work periods: 4/4/3/5 per contract (subcon-accept.jsx). C3 state map applied.
      const wpRows: (typeof schema.workPeriods.$inferInsert)[] = [];
      SUBC_CONTRACTS.forEach((c, ci) => {
        // B-107(b) / migration 0033: qty-basis money inputs. distance/unit periods
        // carry perPeriodQty (= target) × ratePerUnit (= amount/target) so the
        // server-computed approve-payment reconciles to the seeded amount; totalQty
        // = the contract's summed quantity. percent (pct×value) + milestone (fixed
        // amount) bases leave these null.
        const qtyBasis = c.basis === "distance" || c.basis === "unit";
        const totalQty = qtyBasis ? c.periods.reduce((s, p) => s + p.target, 0) : null;
        const unitLabel = c.basis === "distance" ? "m" : c.basis === "unit" ? "หลัง" : null;
        c.periods.forEach((p, si) => {
          wpRows.push({
            id: det(`wp:${ci}:${si}`), contractId: det(`subc:${ci}`), seq: si + 1,
            basis: c.basis, target: m(p.target), pct: m(p.pct), amount: m(p.amount), status: p.status,
            ...(qtyBasis
              ? {
                  totalQty: String(totalQty),
                  perPeriodQty: String(p.target),
                  ratePerUnit: m(p.target > 0 ? p.amount / p.target : 0),
                  unit: unitLabel,
                }
              : {}),
          });
        });
      });
      await tx.insert(schema.workPeriods).values(wpRows);
      // NOTE: acceptance/defect stay 0 records (§สรุป line 318/341 + P0-QA-06). The
      // WO-2026-0055 งวด 3 rejection is captured by status='rejected' above and by the
      // 3 DMS `defect`-category documents (the real "defect reports").

      // B-080 (F3): reconcile WO ↔ subcon_contract by shared vendor. Each seeded WO
      // points to firm SC-0{i+1}; link it to the contract signed with that same
      // firm (WO-0117/SC-01 → subc:0 · WO-0115/SC-03 → subc:2 · WO-0114/SC-04 →
      // subc:1). WOs whose vendor (SC-02/SC-05) has no contract stay contract_id
      // NULL. Done as a post-insert UPDATE: the WO rows were inserted before the
      // subcon_contract rows, so the FK target only exists now.
      for (let wi = 0; wi < WO_VALUES.length; wi++) {
        const firm = `SC-0${wi + 1}`;
        const ci = SUBC_CONTRACTS.findIndex((c) => c.firm === firm);
        if (ci >= 0) {
          await tx
            .update(schema.wos)
            .set({ contractId: det(`subc:${ci}`) })
            .where(eq(schema.wos.id, det(`wo:${wi}`)));
        }
      }

      // === PM =============================================================
      await tx.insert(schema.pmContracts).values(
        PM_CONTRACTS.map((c, i) => ({
          id: det(`pmc:${i}`), projectId: det(`project:${at(PROJECTS, i).key}`),
          customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          mode: c.mode, visitsPerYear: 4, sla: "24 ชม.", value: m(c.value), end: "2027-01-31",
        })),
      );

      await tx.insert(schema.checklistTemplates).values(
        CHECKLIST_TEMPLATES.map((c, i) => ({
          // B-110(ก) / migration 0034: the template name (already in the constant;
          // the column was added Wave-2). 5 defaults = B-108(e).
          id: det(`cktpl:${i}`), companyId: CO1, name: c.name, kind: c.kind,
          items: c.items.map((label) => ({ label })),
        })),
      );

      const ASSET_KINDS = ["lift", "inverter", "crane", "hvac"];
      // B-110(ก) / migration 0034: honest display name + code per (synthetic) asset,
      // derived from its REAL kind — the pm.jsx asset card's primary fields. The
      // seed's 16 assets are generated (not the prototype catalog), so the name is a
      // systematic kind-label + index, not a fabricated model number.
      const ASSET_KIND_NAME: Record<string, string> = { lift: "ลิฟต์โดยสาร", inverter: "อินเวอร์เตอร์", crane: "เครน", hvac: "เครื่องปรับอากาศ" };
      const ASSET_KIND_CODE: Record<string, string> = { lift: "LIFT", inverter: "INV", crane: "CRN", hvac: "HVAC" };
      await tx.insert(schema.pmAssets).values(
        Array.from({ length: 16 }, (_, i) => {
          const k = at(ASSET_KINDS, i);
          return {
            id: det(`pmasset:${i}`), contractId: det(`pmc:${i % 5}`),
            name: `${ASSET_KIND_NAME[k]} #${i + 1}`, code: `${ASSET_KIND_CODE[k]}-${String(i + 1).padStart(2, "0")}`,
            kind: k, site: `ไซต์ ${i + 1}`, cycle: "รายเดือน", nextDue: "2026-08-01",
          };
        }),
      );

      await tx.insert(schema.pmWorkOrders).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`pmwo:${i}`), assetId: det(`pmasset:${i}`), templateId: det(`cktpl:${i % 5}`),
          tech: `ช่าง ${i + 1}`, items: [],
        })),
      );

      // === Finance ========================================================
      await tx.insert(schema.apBillings).values(
        AP_BILL.map((a, i) => ({
          id: det(`ap:${i}`), companyId: CO1, vendorId: at(SUPPLIER_VENDORS, i),
          // B-089 (F-AP1): a WO-billed row (a.wo != null) references its Work Order,
          // NOT a PO/GR (ap.jsx AP-2026-0180 ref "WO-2026-0117 งวด 3") — so null
          // poId/grId and set woId. PO/GR-billed rows keep po:i/gr:i, woId null.
          poId: a.wo == null ? det(`po:${i}`) : null,
          grId: a.wo == null ? det(`gr:${i}`) : null,
          woId: a.wo == null ? null : det(`wo:${a.wo}`),
          invoiceNo: a.inv,
          // C-SEED-DUEDATE: clock-relative due date (AP_DUE_DAYS) — was null
          // (the dashboard GAP: alerts/cashflow stayed empty on seed).
          dueDate: isoDaysFromToday(at(AP_DUE_DAYS, i)),
          amount: m(a.amount), vat: m(a.vat),
          // B-089 (F-AP1): withholding-tax amount (all rows) + retention (WO row).
          wht: m(a.wht),
          retention: a.retention == null ? null : m(a.retention),
          status: a.status,
          kind: at(AP_KIND, i), // B-079 (F2): installment type per PO payment state
        })),
      );

      await tx.insert(schema.pvs).values(
        PV_LIST.map((pv, i) => ({
          id: det(`pv:${i}`), companyId: CO1, billingIds: [det(`ap:${i}`)],
          whtPct: "3.00", net: m(pv.net), status: "approved",
          // B-089 (F-AP1): gross AP value settled + method + cheque details +
          // retention (ap.jsx PV_LIST). cheque_no/cheque_bank populated only for
          // cheque-method PVs; cheque_date absent from the list rows -> null.
          amount: m(pv.amount),
          retention: m(pv.retention),
          method: pv.method,
          chequeNo: pv.chequeNo,
          chequeBank: pv.chequeBank,
          chequeDate: null,
          // B-094-3 (SoD, migration 0029): backfill created_by to user:4 — the
          // seeded Accounting-role holder (ROLE_DEFS[4] = `acc`, at(ROLE_DEFS, 4)),
          // a finance-STAFF member (approval level 0). This is DISTINCT from every
          // PV approver tier — finmgr (user:9, level 3) and dir (user:1, level 4) —
          // so the new self-approve gate never blocks an existing seeded approval
          // flow (the accountant records the PV; a manager/director approves it).
          createdBy: det(`user:4`),
        })),
      );

      const ETAX = ["queued", "sent", "rejected", "void"] as const;
      await tx.insert(schema.arInvoices).values(
        AR_INV.map((ar, i) => ({
          id: det(`ar:${i}`), companyId: CO1, customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          projectId: det(`project:${at(PROJECTS, i).key}`), no: ar.no,
          amount: m(ar.amount), vat: m(ar.vat), creditTerm: 30, etaxStatus: at(ETAX, i),
        })),
      );

      await tx.insert(schema.arCreditNotes).values(
        ARCN_SEED.map((cn, i) => ({
          id: det(`arcn:${i}`), companyId: CO1, no: cn.no,
          customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`), refInvoiceId: det(`ar:${i}`),
          reason: cn.reason, amount: m(cn.amount), status: cn.status, noteDate: null,
        })),
      );

      await tx.insert(schema.glAccounts).values(
        // B-122 Q1 (F-GL2): classify each account from its code prefix so freshly
        // seeded COA rows carry account_type (the migration 0035 backfill only
        // touches rows that predate it — seed rows insert after migrate).
        COA_SEED.map((a) => ({
          id: det(`gl:${a.code}`), companyId: CO1, code: a.code, name: a.name,
          accountType: ({ "1": "asset", "2": "liability", "3": "equity", "4": "revenue", "5": "expense" } as Record<string, string>)[a.code[0] ?? ""] ?? null,
        })),
      );

      await tx.insert(schema.jvs).values(
        JV_BOOKS.map((jv, i) => ({
          id: det(`jv:${i}`), companyId: CO1, no: jv.no,
          sourceDoc: jv.source, memo: jv.memo,
        })),
      );

      // C9: balanced jv_line from the REAL JV amounts (ΣDR = ΣCR per book, 17 total).
      const jvLineRows: (typeof schema.jvLines.$inferInsert)[] = [];
      JV_BOOKS.forEach((jv, i) => {
        jv.lines.forEach((ln, k) => {
          jvLineRows.push({
            id: det(`jvl:${i}:${k}`), jvId: det(`jv:${i}`), accountId: det(`gl:${ln.acct}`),
            dr: m(ln.dr), cr: m(ln.cr), ccId: det(`cc:${at(CC_SEED, 1).code}`), projectId: det("project:rjp"),
          });
        });
      });
      await tx.insert(schema.jvLines).values(jvLineRows);

      // bank: 8 statement rows, each carrying its real reconcile line (bank.jsx STMT).
      await tx.insert(schema.bankStatements).values(
        BANK_STMT.map((s, i) => ({
          id: det(`bank:${i}`), companyId: CO1, period: "2569-05",
          lines: [{ date: s.date, desc: s.desc, amount: s.v, matched: s.matched }],
          locked: false,
        })),
      );

      // B-089 (F-AP1, migration 0026): the bank.jsx cheque register (6 issued
      // cheques). pv_id back-links a cheque to the PV that issued it where that PV
      // is one of the 4 seeded PV_LIST rows (CHEQUE_REG.pvIdx); the register's other
      // 4 cheques reference PVs outside the seed -> pv_id null. Cheque `amount` is
      // the register value (bank.jsx), which for CH-040128 (561,150) differs from
      // its PV net (561,154) — each stays faithful to its own mock source.
      await tx.insert(schema.cheques).values(
        CHEQUE_REG.map((c, i) => ({
          id: det(`cheque:${i}`), companyId: CO1, no: c.no,
          amount: m(c.amount), dueDate: c.date, status: c.status,
          pvId: c.pvIdx == null ? null : det(`pv:${c.pvIdx}`),
        })),
      );

      // B-092 (F-BANK2, migration 0027): normalize the 8 bank.jsx STMT lines into
      // real bank_statement_line rows (one per statement, mirroring the existing
      // 1-statement-per-line BANK_STMT layout). `amount` is SIGNED — kept via
      // .toFixed(2) (NOT the m() helper, which strips the sign with Math.abs).
      // line_date derives the calendar date from the statement period 2569-05
      // (พ.ค. = May, 2569 BE = 2026 CE) + the Thai day number. matched=true when
      // the mock line carries a doc no; the FK is resolved by that no against the
      // seeded PV / cheque rows. RV-matched lines stay matched=true (faithful to
      // the mock's matched flag) but rv_id is null — no RV rows are seeded (AR is
      // Phase-5-deferred) and the rv table has no doc-no column to resolve by.
      const pvIdByNo = new Map(PV_LIST.map((pv, i) => [pv.no, det(`pv:${i}`)]));
      const chequeIdByNo = new Map(
        CHEQUE_REG.map((c, i) => [c.no, det(`cheque:${i}`)]),
      );
      await tx.insert(schema.bankStatementLines).values(
        BANK_STMT.map((s, i) => {
          const ref = s.matched;
          const day = Number.parseInt(s.date, 10); // leading day; all rows = พ.ค. (2569-05)
          return {
            id: det(`bankline:${i}`),
            statementId: det(`bank:${i}`),
            lineDate: `2026-05-${String(day).padStart(2, "0")}`,
            description: s.desc,
            amount: s.v.toFixed(2), // SIGNED — deposits +, withdrawals −
            matched: ref != null,
            pvId: ref?.startsWith("PV-") ? (pvIdByNo.get(ref) ?? null) : null,
            chequeId: ref?.startsWith("CH-")
              ? (chequeIdByNo.get(ref) ?? null)
              : null,
            rvId: null, // RV-* refs: no seeded rv (AR Phase-5-deferred)
          };
        }),
      );

      await tx.insert(schema.fixedAssets).values(
        FA_ASSETS.map((a, i) => ({
          id: det(`fa:${i}`), companyId: CO1, name: a.name, cost: m(a.cost),
          lifeYears: a.lifeY, ccId: det(`cc:${at(CC_SEED, i).code}`), deprMethod: a.method,
        })),
      );

      await tx.insert(schema.workers).values(
        WORKERS_SEED.map((w, i) => ({
          id: det(`worker:${i}`), companyId: CO1, name: w.name, dayRate: m(w.wage),
        })),
      );

      const OPEX_DEPTS = ["ฝ่ายขาย & การตลาด", "ฝ่ายบริหาร", "ฝ่ายวิศวกรรม & ไซต์ (ส่วนกลาง)", "ฝ่ายบัญชี & การเงิน", "ฝ่ายบุคคล (HR)", "ฝ่าย IT & ระบบ"];
      const OPEX_BUDGET = [18000000, 12000000, 9600000, 6000000, 5400000, 4800000];
      await tx.insert(schema.opexBudgets).values(
        OPEX_DEPTS.map((dept, i) => ({
          id: det(`opex:${i}`), companyId: CO1, dept, year: 2569,
          months: Array.from({ length: 12 }, () => Math.round(at(OPEX_BUDGET, i) / 12)),
        })),
      );

      await tx.insert(schema.retentionLedgers).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`ret:${i}`), companyId: CO1, woId: det(`wo:${i}`),
          vendorId: det(`vendor:${at(SUBC_CONTRACTS, i).firm}`), contractId: det(`subc:${i}`),
          scope: `งานงวดที่ ${i + 1}`, rate: "5.00", withheld: m(40_000 * (i + 1)), returned: m(0),
          dueDate: null, status: "held",
        })),
      );

      await tx.insert(schema.revRecs).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`revrec:${i}`), companyId: CO1, projectId: det(`project:${at(PROJECTS, i).key}`),
          method: "percent-of-completion", contractAmount: m(10_000_000 + i * 2_000_000), pct: m(20 * (i + 1)),
          recognized: m(2_000_000 * (i + 1)), billed: m(1_800_000 * (i + 1)), posted: i < 2,
        })),
      );

      await tx.insert(schema.wips).values(
        Array.from({ length: 3 }, (_, i) => ({
          id: det(`wip:${i}`), companyId: CO1, projectId: det(`project:${at(PROJECTS, i).key}`),
          material: m(3_000_000 + i * 500_000), subcon: m(2_000_000 + i * 300_000),
          overhead: m(500_000 + i * 100_000), transferred: m(1_000_000 * i),
        })),
      );

      await tx.insert(schema.pettyCashTxns).values(
        PETTY_TX.map((p, i) => ({
          id: det(`petty:${i}`), companyId: CO1, no: p.no, type: p.type, label: p.l,
          value: m(p.v), byUserId: det(`user:${i % 12}`), txnDate: null,
          status: p.status, cat: p.cat, ref: p.ref, ccId: det(`cc:${at(CC_SEED, i).code}`),
        })),
      );

      // === EVM snapshot (group-C Wave-3, B-101) ===========================
      // ~12 monthly Earned-Value snapshots for the hero project (project:rjp)
      // tracing an HONEST S-curve derived from that project's REAL seeded BAC
      // (Σ cbs_budget.budget over the rjp groups via cbsGroupBudget — NOT the
      // mock's literal 26.4/22.2, which C10 forbids). Periods are the 12 calendar
      // months ENDING at SEED_TODAY's month (clock-relative — no hardcoded years).
      const EVM_BAC = BOQ_GROUPS.reduce((s, _g, i) => s + cbsGroupBudget(i), 0);
      const EVM_PERIODS = 12;
      // Cumulative planned fraction: smoothstep S-curve (slow -> fast -> slow).
      const evmSCurve = (t: number): number => t * t * (3 - 2 * t);
      // EV runs a flat ~6% behind PV (SPI ≈ 0.94) — "slightly behind schedule".
      const EVM_SPI = 0.94;
      // Per-period cost multiplier on the period's PLANNED budget increment: <1 =
      // under-spent that month (healthy); the single OVERRUN month k=10 spikes the
      // running cumulative AC ABOVE the cumulative budget line, so the final two
      // snapshots (k=10,11) are the DANGER bars (AC > budget) that trip the
      // dashboard over-budget alert. Deterministic (no Math.random); AC is a
      // running cumulative sum, so the series is monotonically increasing.
      const evmSpend = (k: number): number => (k === 10 ? 3.0 : 0.92);
      const evmRows: (typeof schema.evmSnapshots.$inferInsert)[] = [];
      let evmAcCum = 0;
      for (let k = 0; k < EVM_PERIODS; k++) {
        const t = (k + 1) / EVM_PERIODS;
        const tPrev = k / EVM_PERIODS;
        // budget bars = cumulative time-phased BAC on the SAME S fraction as PV.
        const budgetCum = EVM_BAC * evmSCurve(t);
        const pv = budgetCum; // Planned Value = the planned S-curve baseline.
        const ev = pv * EVM_SPI; // Earned Value tracks PV slightly behind.
        // AC accumulates each month's real spend (planned increment × cost ratio).
        evmAcCum += (budgetCum - EVM_BAC * evmSCurve(tPrev)) * evmSpend(k);
        // period 'YYYY-MM' + month-end; k=11 = SEED_TODAY's month, clock-relative.
        const monthStart = new Date(
          Date.UTC(
            SEED_TODAY.getUTCFullYear(),
            SEED_TODAY.getUTCMonth() - (EVM_PERIODS - 1 - k),
            1,
          ),
        );
        const y = monthStart.getUTCFullYear();
        const mo = monthStart.getUTCMonth(); // 0-based
        const period = `${y}-${String(mo + 1).padStart(2, "0")}`;
        // Last day of the month = day 0 of the next month (UTC).
        const periodEnd = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
        evmRows.push({
          id: det(`evmsnap:${period}`),
          projectId: det("project:rjp"),
          period,
          periodEnd,
          pv: m(pv),
          ev: m(ev),
          ac: m(evmAcCum),
          budget: m(budgetCum),
          bac: m(EVM_BAC),
        });
      }
      await tx.insert(schema.evmSnapshots).values(evmRows);

      // === Land / Sales / Solar / Inventory / DMS / etc. ==================
      await tx.insert(schema.landPlots).values(
        LAND_PLOTS.map((p, i) => ({
          id: det(`land:${i}`), companyId: CO1, projectId: p.proj ? det(`project:${p.proj}`) : null,
          deedNo: p.deed, areaSqm: m(p.rai * 1600 + p.ngan * 400 + p.wa * 4), gps: p.gps,
          pricePerRai: m(p.pricePerRai), stage: p.stage, tenure: p.tenure, ddChecklist: {},
        })),
      );

      await tx.insert(schema.leads).values(
        LEADS.map((l, i) => ({
          id: det(`lead:${i}`), companyId: CO1, name: l.name, phone: l.phone,
          source: l.source, interest: l.interest, stage: l.stage, hot: l.hot,
          lastContactAt: null, note: l.note, ownerUserId: det(`user:${i % 12}`), days: l.days,
        })),
      );

      await tx.insert(schema.serviceTickets).values(
        SERVICE_TICKETS.map((t, i) => ({
          id: det(`svc:${i}`), companyId: CO1, no: t.no,
          unitId: det("block:B"), customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          channel: t.channel, category: t.category, title: t.title, priority: t.prio,
          status: t.status, assigneeUserId: det(`user:${i % 12}`), openedDate: null, scheduledDate: null,
          warranty: true,
        })),
      );

      await tx.insert(schema.solarInverters).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`inv:${i}`), companyId: CO1, projectId: det("project:slr"), zone: `Array ${i + 1}`,
          kw: "500.000", outputKw: m(420 + i * 5), perf: m(92 + i), temp: m(45 + i), status: "normal",
        })),
      );

      await tx.insert(schema.solarOmTickets).values(
        Array.from({ length: 3 }, (_, i) => ({
          id: det(`omt:${i}`), companyId: CO1, inverterId: det(`inv:${i}`), no: `OM-2569-${String(i + 1).padStart(3, "0")}`,
          title: `แจ้งซ่อม inverter ${i + 1}`, priority: "ปกติ", assigneeUserId: det(`user:${i % 12}`), status: "open",
        })),
      );

      await tx.insert(schema.ppaInvoices).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`ppa:${i}`), companyId: CO1, projectId: det("project:slr"),
          month: `2569-${String(i + 1).padStart(2, "0")}`, mwh: m(500 + i * 20), rate: "3.5000",
          amount: m((500 + i * 20) * 3.5 * 1000), status: "issued",
        })),
      );

      await tx.insert(schema.solarRois).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`roi:${i}`), companyId: CO1, projectId: det("project:slr"), year: 2569 + i,
          revenue: m(8_000_000 + i * 200_000), opex: m(1_000_000), cumulative: m(7_000_000 * (i + 1)),
        })),
      );

      const PERMIT_STEPS = ["ยื่นขออนุญาต", "EIA", "ใบอนุญาตก่อสร้าง", "เชื่อมต่อโครงข่าย", "PPA", "COD"];
      await tx.insert(schema.solarPermitSteps).values(
        PERMIT_STEPS.map((name, i) => ({
          id: det(`permit:${i}`), companyId: CO1, projectId: det("project:slr"), name,
          org: "กกพ.", status: i < 3 ? "done" : "pending", stepDate: null,
        })),
      );

      const WARR_ITEMS = ["แผงโซลาร์", "Inverter", "Mounting", "สายไฟ DC"];
      const WARR_BRANDS = ["JA Solar", "Huawei", "K2", "LAPP"];
      await tx.insert(schema.solarWarranties).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`warr:${i}`), companyId: CO1, projectId: det("project:slr"),
          item: at(WARR_ITEMS, i), brand: at(WARR_BRANDS, i),
          qty: 100 + i * 10, perf: m(90 + i), prodDate: null, expiryDate: null, status: "active",
        })),
      );

      await tx.insert(schema.warehouses).values(
        WAREHOUSES.map((w, i) => ({ id: det(`wh:${i}`), companyId: CO1, name: w.name, location: w.loc })),
      );

      await tx.insert(schema.inventoryItems).values(
        INV_ITEMS.map((it, i) => ({
          id: det(`item:${i}`), companyId: CO1, warehouseId: det(`wh:${i % 5}`),
          code: it.code, cat: it.cat, name: it.name, unit: it.unit,
          price: m(it.price), stock: m(it.stock), lowPoint: m(it.low), status: it.status,
        })),
      );

      await tx.insert(schema.stockTransfers).values(
        INV_TRANSFERS.map((t, i) => ({
          id: det(`tr:${i}`), companyId: CO1, no: t.no,
          fromWarehouseId: det(`wh:${t.from}`), toWarehouseId: det(`wh:${t.to}`), qty: m(0),
          value: m(t.value), transferDate: null, byUserId: det(`user:${i % 12}`), status: t.status,
        })),
      );

      await tx.insert(schema.materialIssues).values(
        INV_ISSUES.map((s, i) => ({
          id: det(`iss:${i}`), companyId: CO1, no: s.no,
          projectId: det(`project:${at(PROJECTS, i).key}`), fromWarehouseId: det(`wh:${s.wh}`),
          value: m(s.value), issueDate: null, byUserId: det(`user:${i % 12}`), status: s.status,
        })),
      );

      await tx.insert(schema.documents).values(
        DMS_SEED.map((d, i) => ({
          id: det(`doc:${i}`), companyId: CO1, projectId: det(`project:${at(PROJECTS, i).key}`),
          cat: d.cat, version: 1, expiry: null, linkModule: `dms:${det(`doc:${i}`)}`,
          url: `r2://documents/doc-${i + 1}.pdf`,
        })),
      );

      await tx.insert(schema.auditLogs).values(
        AUDIT_ENTRIES.map((a, i) => ({
          id: det(`audit:${i}`), companyId: CO1, userId: det(`user:${i % 12}`),
          action: a.act, entity: a.obj, before: null, after: { detail: a.detail }, ip: null,
          // group-C Wave-1: spread `at` into a real time series (defaultNow
          // collapsed all 13 rows to one instant → the activity feed's time-ago
          // was useless). i=0 newest, stepping 4h back per row (~2 days of
          // history), relative to the seed instant — clock-relative, no literals.
          at: new Date(SEED_NOW.getTime() - i * 4 * 60 * 60 * 1000),
        })),
      );

      await tx.insert(schema.timelineTasks).values(
        TL_TASKS.map((t, i) => ({
          id: det(`tl:${i}`), companyId: CO1, projectId: det("project:rjp"), groupLabel: at(TL_GROUPS, t.g),
          label: t.label, planStart: null, planEnd: null, actualStart: null, actualEnd: null,
          status: t.status, pct: m(t.pct), late: false,
        })),
      );

      await tx.insert(schema.milestones).values(
        MILESTONES.map((ms, i) => ({
          id: det(`ms:${i}`), companyId: CO1, projectId: det("project:rjp"),
          label: ms.l, day: ms.day, milestoneDate: null, status: ms.status,
        })),
      );

      // notification: 22 (mock 3 sets 5+7+10), user_id required → cycle 12 users.
      const NOTIF_TYPES = ["approval", "alert", "info"] as const;
      await tx.insert(schema.notifications).values(
        Array.from({ length: 22 }, (_, i) => ({
          id: det(`notif:${i}`), companyId: CO1, userId: det(`user:${i % 12}`),
          type: at(NOTIF_TYPES, i), ref: `pr:${det(`pr:${i % 10}`)}`, read: i % 2 === 0,
        })),
      );

      // sales_unit: 84 (B-009 answered ก). Each points to its own project_node unit.
      await tx.insert(schema.salesUnits).values(
        Array.from({ length: 84 }, (_, i) => {
          const stage = unitStage(i);
          const sold = stage !== "empty" && stage !== "built";
          return {
            id: det(`sunit:${i}`), companyId: CO1, unitId: det(`unitnode:${i}`),
            customerId: sold ? det(`customer:${at(CUSTOMER_SEED, i).code}`) : null,
            stage, booking: sold ? m(50_000) : null, contract: sold ? m(4_850_000) : null,
            loan: sold ? m(4_000_000) : null, down: [], transferAt: stage === "soldBuilt" ? "2026-06-15" : null,
          };
        }),
      );
    });

    console.log("[seed] OK — mock data persisted (P0-BE-10).");
    console.log(`[seed] report-derived (no table, skipped): ${REPORT_DERIVED.length} datasets`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
