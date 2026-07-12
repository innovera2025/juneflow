// @juneflow/db — seed entrypoint (P0-BE-10).
//
// Persists the prototype mock records (docs/extract/MOCK-DATA.md §"สรุปสำหรับทำ
// seed data") into Postgres. The app READS from the DB — mock data is never
// regenerated at runtime (PLAN.md §0 rule 3 / §6). Re-running is safe: the whole
// run is ONE transaction that TRUNCATEs every table first, then re-INSERTs, so
// counts stay 1:1 (QA asserts them — P0-QA-06).
//
// Decision mappings applied at seed time (PLAN.md Appendix C / P0-BE-10 rules):
//   - rule 1  name-text FKs normalized to real uuid FKs via fixed ids (see ids.ts);
//             parents inserted before children, wired by uuid.
//   - C3      WorkPeriod mock states → dictionary state machine:
//             requested → delivered, accepted → passed (work_period.status).
//   - C6      Vendor uses master-party.jsx VENDOR_SEED (6), not the boq.jsx dup.
//   - C9      JV mock has no DR/CR lines — only a line count. We emit balanced
//             jv_line rows (≥1 DR + ≥1 CR per book, ΣDR = ΣCR). ≥14 total.
//   - C10     NAV badge numbers are runtime query counts — NEVER seeded.
//   - B-009   84 sales_unit rows persisted (sales-process.jsx generator).
//
// Report-derived §สรุป datasets that have NO table are intentionally SKIPPED
// (documented in REPORT_DERIVED below): trial balance, posting inbox, aging
// AP/AR, project P&L, cost allocation (ปันส่วน), MRR/OPEX/cashflow charts,
// SUB_INVOICES tenant view, linked-docs/BOQ balance/archive UI datasets, and the
// NO_RECORD entities (ai_usage, acceptance, defect, attendance, payroll, cheque).

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../schema/index.js";
import { det } from "./ids.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** money → fixed 2-decimal string (drizzle numeric maps to string). */
const m = (n: number): string => n.toFixed(2);

/** parse a leading integer out of a mock running-number string, fallback 1. */
const runInt = (s: string): number => {
  const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

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
  "cost allocation ปันส่วน (petty-alloc ALLOC_CAT 6) — report over petty_cash_txn",
  "SUB_INVOICES (subscription.jsx 3) — tenant view of platform_invoice/subscription",
  "BOQ balance/archive/รออนุมัติ/AI-QTO/linked-docs — UI/report datasets over boq_*",
  "MRR/OPEX-monthly/cashflow chart series — chart data, not entity records",
  "NO_RECORD: ai_usage, acceptance, defect, attendance, payroll, cheque (expected 0)",
];

// ---------------------------------------------------------------------------
// static mock data (transcribed from pototype/*.jsx, cited by file:line)
// ---------------------------------------------------------------------------

// company-accept.jsx:6 COMPANIES (Appendix B item 14 — multi-company group)
const COMPANIES = [
  { key: "JF", name: "บจก. จูนโฟลว์ ดีเวลลอปเมนท์", short: "JF", taxId: "0-1055-61012-34-5", color: "#0B2A4A", docPrefix: "JF", biz: "พัฒนาอสังหาริมทรัพย์" },
  { key: "JE", name: "บจก. จูนโฟลว์ เอ็นเนอร์ยี", short: "JE", taxId: "0-1055-64067-89-0", color: "#B45309", docPrefix: "JE", biz: "โรงไฟฟ้าพลังงานแสงอาทิตย์" },
  { key: "JC", name: "บจก. จูนโฟลว์ คอนสตรัคชั่น", short: "JC", taxId: "0-1055-58033-22-1", color: "#0F766E", docPrefix: "JC", biz: "รับเหมาก่อสร้าง & บริการ" },
] as const;

// pkg-builder / subscription.jsx — decision C1: 4 tiers S/M/L/Full
// (S=2900 M=7900 L=14900 Full=contact). limits keys per C5 (storage_gb/ai_per_month).
const PACKAGES = [
  { key: "S", size: "S" as const, name: "Starter", priceM: "2900.00", priceY: "29000.00", limits: { projects: 2, users: 5, storage_gb: 20, ai_per_month: 10 }, menus: ["boq", "proc", "petty", "timeline"], subRules: {} },
  { key: "M", size: "M" as const, name: "Professional", priceM: "7900.00", priceY: "79000.00", limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 }, menus: ["boq", "proc", "petty", "timeline", "inv", "subcon", "pm", "land", "finance"], subRules: { "boq.aiqto": "M" } },
  { key: "L", size: "L" as const, name: "Business", priceM: "14900.00", priceY: "149000.00", limits: { projects: 30, users: 60, storage_gb: 500, ai_per_month: 200 }, menus: ["boq", "proc", "petty", "timeline", "inv", "subcon", "pm", "land", "finance", "sales_re", "aftersales"], subRules: { "boq.aiqto": "L" } },
  { key: "Full", size: "Full" as const, name: "Enterprise", priceM: null, priceY: null, limits: { projects: -1, users: -1, storage_gb: 1000, ai_per_month: -1 }, menus: ["*"], subRules: { "master.ptype": "Full", "boq.aiqto": "M" } },
] as const;

// subscription-admin.jsx:5 SUBSCRIBERS (9) — company/package cycled per spec.
const SUB_CYCLES = ["yearly", "yearly", "monthly", "monthly", "yearly", "monthly", "yearly", "yearly", "monthly"] as const;
// mock statuses active/trial/overdue/cancelled → enum (trial→expiring).
const SUB_STATUS = ["active", "active", "active", "active", "expiring", "overdue", "active", "active", "cancelled"] as const;

// subscription-admin.jsx:194 inv (5 platform invoices)
const PLATFORM_INV = [
  { amount: 456000, status: "paid" as const },
  { amount: 384000, status: "paid" as const },
  { amount: 79000, status: "paid" as const },
  { amount: 7900, status: "pending" as const },
  { amount: 2900, status: "overdue" as const },
];

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
const ROLE_DEFS: { key: string; name: string; limit: number | null; perms: Matrix }[] = [
  { key: "pm", name: "Project Manager", limit: 1000000, perms: [[1,0,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,0,0,0,0],[1,1,1,0,0],[1,0,0,0,0],[1,1,1,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0]] },
  { key: "dir", name: "Director · CONS", limit: null, perms: [[1,0,0,0,0],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1]] },
  { key: "proc", name: "Procurement Mgr", limit: 500000, perms: [[1,0,0,0,0],[1,1,1,0,0],[1,1,1,1,0],[1,1,1,1,0],[1,1,1,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,1,1,0,0],[0,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]] },
  { key: "site", name: "Site Engineer", limit: 200000, perms: [[1,0,0,0,0],[1,1,0,0,0],[1,1,0,0,0],[1,0,0,0,0],[1,1,0,0,0],[1,1,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,1,0,0,0],[0,0,0,0,0],[0,0,0,0,0]] },
  { key: "acc", name: "Accounting", limit: null, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,1,1,1,0],[1,0,0,0,0]] },
  { key: "sale", name: "Sales / REM", limit: null, perms: [[1,0,0,0,0],[1,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,0,0],[1,1,1,0,0],[1,0,0,0,0]] },
  { key: "wh", name: "Warehouse", limit: null, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[0,0,0,0,0],[1,1,1,1,0],[0,0,0,0,0],[1,1,1,1,0],[1,1,0,0,0],[0,0,0,0,0],[0,0,0,0,0]] },
  { key: "exec", name: "ผู้บริหาร / ดูได้อย่างเดียว", limit: null, perms: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]] },
];

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

// chrome.jsx:3 PROJECTS (7 projects / 16 phases)
const PROJECTS = [
  { key: "rjp", name: "juneflow พาร์ค ราชพฤกษ์", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · Block A (บ้านเดี่ยว)" }, { k: "p2", l: "เฟส 2 · Block B+C (ทาวน์โฮม)" }, { k: "p3", l: "เฟส 3 · Block D (บ้านแฝด)" }] },
  { key: "bbt", name: "juneflow บางบัวทอง", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · ทาวน์โฮม" }, { k: "p2", l: "เฟส 2 · บ้านเดี่ยว" }] },
  { key: "rama", name: "juneflow คอนโด พระราม 9", type: "realestate", phases: [{ k: "a", l: "อาคาร A (1-15 ชั้น)" }, { k: "b", l: "อาคาร B (1-15 ชั้น)" }] },
  { key: "phk", name: "juneflow พหลโยธิน 5", type: "realestate", phases: [{ k: "p1", l: "เฟส 1 · ทาวน์โฮม Luxury" }] },
  { key: "slr", name: "โซลาร์ฟาร์ม สระบุรี 8MW", type: "solar", phases: [{ k: "z1", l: "โซน A · Array 1-8 (4MW)" }, { k: "z2", l: "โซน B · Array 9-16 (4MW)" }] },
  { key: "rdb", name: "ถนน-สะพาน เทศบาลนนทบุรี", type: "civil", phases: [{ k: "s1", l: "ส่วนงาน A · ถนนสาย 1 (กม.0-3.5)" }, { k: "s2", l: "ส่วนงาน B · สะพานข้ามคลอง" }, { k: "s3", l: "ส่วนงาน C · ระบบระบายน้ำ" }] },
  { key: "erp", name: "ติดตั้งระบบ ERP ลูกค้า ABC", type: "service", phases: [{ k: "ph1", l: "เฟส 1 · Analysis & Design" }, { k: "ph2", l: "เฟส 2 · Implementation" }, { k: "ph3", l: "เฟส 3 · UAT & Go-Live" }] },
] as const;

// master.jsx:426 MODELS (5)
const MODELS = [
  { key: "A-1", name: "A-1 · บ้านเดี่ยว 2 ชั้น", area: "168.00" },
  { key: "B-1", name: "B-1 · ทาวน์โฮม 2 ชั้น", area: "92.00" },
  { key: "C-1", name: "C-1 · ทาวน์โฮม 3 ชั้น", area: "138.00" },
  { key: "D-1", name: "D-1 · บ้านแฝด 2 ชั้น", area: "142.00" },
  { key: "E-1", name: "E-1 · ทาวน์โฮม 4 ห้องนอน (ใหม่)", area: "145.00" },
];

// master.jsx:240 BLOCK_SEED (3 blocks — project_node kind='block')
const BLOCK_SEED = [
  { code: "B", name: "Block B", modelKey: "B-1" },
  { code: "C", name: "Block C", modelKey: "C-1" },
  { code: "D", name: "Block D", modelKey: "D-1" },
];

// master.jsx:584 CC_SEED (7 cost centers)
const CC_SEED = [
  { code: "CC-CONS-RJP-01", name: "โครงการ ราชพฤกษ์ เฟส 1" },
  { code: "CC-CONS-RJP-02", name: "โครงการ ราชพฤกษ์ เฟส 2" },
  { code: "CC-CONS-RJP-03", name: "โครงการ ราชพฤกษ์ เฟส 3" },
  { code: "CC-CONS-OH", name: "Overhead งานก่อสร้าง" },
  { code: "CC-PROC", name: "ฝ่ายจัดซื้อ" },
  { code: "CC-SLS-RJP", name: "Sales · ราชพฤกษ์" },
  { code: "CC-FIN", name: "ฝ่ายบัญชี-การเงิน" },
];

// master-party.jsx:6 VENDOR_SEED (6) — C6. type→kind: รับเหมา=subcon else supplier.
const VENDOR_SEED = [
  { code: "V-0012", name: "บจก. รุ่งเรืองวัสดุก่อสร้าง", type: "วัสดุ", taxId: "0105545012345", term: 30 },
  { code: "V-0024", name: "หจก. ช่างเหล็กไทย", type: "วัสดุ", taxId: "0103539008765", term: 45 },
  { code: "V-0031", name: "บจก. ไฟฟ้าอุตสาหกรรม", type: "รับเหมา", taxId: "0105549112233", term: 60 },
  { code: "V-0045", name: "นายสมศักดิ์ รับเหมาก่อสร้าง", type: "รับเหมา", taxId: "1102003456789", term: 30 },
  { code: "V-0052", name: "บมจ. แม็กซ์เทค เซอร์วิส", type: "บริการ", taxId: "0107536000999", term: 30 },
  { code: "V-0061", name: "บจก. หัวเว่ย เทคโนโลยี", type: "วัสดุ", taxId: "0105556778899", term: 0 },
];

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

// master.jsx:737 DOCNUM_SEED (10 running-number counters)
const DOCNUM_SEED = [
  { type: "Purchase Requisition", prefix: "PR", running: "0418", reset: "ทุกปีบัญชี", lock: false },
  { type: "Purchase Order", prefix: "PO", running: "0291", reset: "ทุกปีบัญชี", lock: true },
  { type: "Work Order", prefix: "WO", running: "0117", reset: "ทุกปีบัญชี", lock: true },
  { type: "Goods Receipt", prefix: "GR", running: "0148", reset: "ทุกปีบัญชี", lock: true },
  { type: "Return", prefix: "RT", running: "0014", reset: "ทุกปีบัญชี", lock: false },
  { type: "Bill of Quantities", prefix: "BOQ", running: "02", reset: "—", lock: true },
  { type: "Petty Cash", prefix: "PT", running: "0148", reset: "ทุกเดือน", lock: false },
  { type: "Stock Transfer", prefix: "TR", running: "0084", reset: "ทุกปีบัญชี", lock: false },
  { type: "Issue (เบิก)", prefix: "IS", running: "0218", reset: "ทุกปีบัญชี", lock: false },
  { type: "Journal Voucher", prefix: "JV", running: "0418", reset: "ทุกปีบัญชี", lock: true },
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

      await tx.insert(schema.companies).values(
        COMPANIES.map((c) => ({
          id: det(`company:${c.key}`), name: c.name, taxId: c.taxId,
          // JE/JC are affiliated under JF (the group head) — Appendix B item 14.
          groupParentId: c.key === "JF" ? null : det("company:JF"),
          short: c.short, color: c.color, docPrefix: c.docPrefix, biz: c.biz,
        })),
      );
      const CO1 = det("company:JF"); // company#1 — every company-scoped record hangs here.

      await tx.insert(schema.subscriptions).values(
        SUB_CYCLES.map((cycle, i) => ({
          id: det(`sub:${i}`), companyId: det(`company:${at(COMPANIES, i).key}`),
          packageId: det(`package:${at(PACKAGES, i).key}`), cycle, status: at(SUB_STATUS, i),
        })),
      );

      await tx.insert(schema.platformInvoices).values(
        PLATFORM_INV.map((inv, i) => ({
          id: det(`pinv:${i}`), subscriptionId: det(`sub:${i % 9}`),
          amount: m(inv.amount), status: inv.status,
        })),
      );

      await tx.insert(schema.roles).values(
        ROLE_DEFS.map((r) => ({
          id: det(`role:${r.key}`), companyId: CO1, name: r.name,
          approvalLimits: r.limit == null ? {} : { default: r.limit },
          perms: permsFrom(r.perms),
        })),
      );

      await tx.insert(schema.users).values(
        COMPANY_USERS.map((u, i) => ({
          id: det(`user:${i}`), companyId: CO1, email: u.email, name: u.name,
          roleId: det(`role:${at(ROLE_DEFS, i).key}`),
          status: (u.status === "active" ? "active" : "blocked") as "active" | "blocked",
        })),
      );

      // === Master / โครงการ ================================================
      await tx.insert(schema.projectTypes).values(
        PROJECT_TYPES.map((t) => ({
          id: det(`ptype:${t.key}`), key: t.key, name: t.name,
          hierarchy: t.hierarchy, modules: t.modules,
        })),
      );

      await tx.insert(schema.projects).values(
        PROJECTS.map((p, i) => ({
          id: det(`project:${p.key}`), companyId: CO1, typeId: det(`ptype:${p.type}`),
          name: p.name, budget: m((i + 5) * 10_000_000), status: "active",
        })),
      );

      await tx.insert(schema.models).values(
        MODELS.map((mo) => ({ id: det(`model:${mo.key}`), companyId: CO1, name: mo.name, area: mo.area })),
      );

      // project_node: 16 phase nodes (kind='phase') + 3 block nodes (kind='block').
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
          kind: "block", name: b.name, saleStatus: null,
        });
      }
      await tx.insert(schema.projectNodes).values(nodeRows);

      await tx.insert(schema.costCenters).values(
        CC_SEED.map((c) => ({ id: det(`cc:${c.code}`), projectId: det("project:rjp"), code: c.code, name: c.name })),
      );

      await tx.insert(schema.vendors).values(
        VENDOR_SEED.map((v) => ({
          id: det(`vendor:${v.code}`), companyId: CO1, name: v.name, taxId: v.taxId,
          kind: (v.type === "รับเหมา" ? "subcon" : "supplier") as "subcon" | "supplier",
          creditTerm: v.term,
        })),
      );
      const SUBCON_VENDORS = VENDOR_SEED.filter((v) => v.type === "รับเหมา").map((v) => det(`vendor:${v.code}`));
      const SUPPLIER_VENDORS = VENDOR_SEED.filter((v) => v.type !== "รับเหมา").map((v) => det(`vendor:${v.code}`));

      await tx.insert(schema.customers).values(
        CUSTOMER_SEED.map((c) => ({ id: det(`customer:${c.code}`), companyId: CO1, name: c.name, taxId: c.taxId })),
      );

      // org tree — parent = last-seen node one level up.
      const orgRows: (typeof schema.orgUnits.$inferInsert)[] = [];
      const lastAtLevel: Record<number, string> = {};
      ORG_SEED.forEach((o) => {
        const id = det(`org:${o.code}`);
        orgRows.push({
          id, companyId: CO1, parentId: o.lvl === 0 ? null : (lastAtLevel[o.lvl - 1] ?? null),
          level: o.lvl, icon: o.ic, name: o.name, code: o.code, note: o.note,
        });
        lastAtLevel[o.lvl] = id;
      });
      await tx.insert(schema.orgUnits).values(orgRows);

      await tx.insert(schema.docNumberings).values(
        DOCNUM_SEED.map((d) => ({
          id: det(`docnum:${d.prefix}`), companyId: CO1, type: d.type, prefix: d.prefix,
          running: runInt(d.running), resetRule: d.reset, locked: d.lock,
        })),
      );

      // === BOQ / procurement ==============================================
      await tx.insert(schema.boms).values(
        MODELS.slice(0, 4).map((mo) => ({ id: det(`bom:${mo.key}`), companyId: CO1, unitType: mo.key, items: [] })),
      );

      await tx.insert(schema.boqDocs).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`boqdoc:${i}`), projectId: det("project:rjp"),
          no: `BOQ-2569-${String(i + 1).padStart(3, "0")}`, name: `BOQ งานหลัก ชุดที่ ${i + 1}`,
          scope: "งานโครงสร้าง + สถาปัตย์", version: 1,
          status: (i === 0 ? "approved" : i === 1 ? "pending" : "draft") as "approved" | "pending" | "draft",
        })),
      );

      const BOQ_GROUP_NAMES = ["งานโครงสร้าง", "งานสถาปัตยกรรม", "งานระบบไฟฟ้า", "งานระบบสุขาภิบาล", "งานตกแต่งภายใน", "งานภายนอก/ภูมิทัศน์"];
      await tx.insert(schema.boqGroups).values(
        BOQ_GROUP_NAMES.map((name, i) => ({ id: det(`boqgrp:${i}`), boqId: det("boqdoc:0"), name, seq: i + 1 })),
      );

      // 21 BOQ items distributed [4,4,4,3,3,3] across the 6 groups.
      const perGroup = [4, 4, 4, 3, 3, 3];
      const CATS = ["M", "L", "S"] as const;
      const boqItemRows: (typeof schema.boqItems.$inferInsert)[] = [];
      let bi = 0;
      perGroup.forEach((count, g) => {
        for (let k = 0; k < count; k++) {
          boqItemRows.push({
            id: det(`boqitem:${bi}`), groupId: det(`boqgrp:${g}`),
            code: `IT-${String(bi + 1).padStart(3, "0")}`, name: `${at(BOQ_GROUP_NAMES, g)} รายการ ${k + 1}`,
            cat: at(CATS, bi), qty: m(10 + bi), unit: "หน่วย", price: m(1000 + bi * 250),
            ccId: det(`cc:${at(CC_SEED, bi).code}`), remainQty: m(10 + bi),
          });
          bi++;
        }
      });
      await tx.insert(schema.boqItems).values(boqItemRows);

      await tx.insert(schema.cbsBudgets).values(
        BOQ_GROUP_NAMES.map((_, i) => ({
          id: det(`cbs:${i}`), groupId: det(`boqgrp:${i}`),
          budget: m(1_000_000 * (i + 1)), used: m(200_000 * (i + 1)), committed: m(100_000 * (i + 1)),
        })),
      );

      const PR_TYPES = ["material", "subcon", "expense", "advance"] as const;
      await tx.insert(schema.prs).values(
        Array.from({ length: 10 }, (_, i) => ({
          id: det(`pr:${i}`), projectId: det("project:rjp"),
          no: `PR-2569-${String(i + 1).padStart(4, "0")}`, type: at(PR_TYPES, i),
          needDate: "2026-08-15", status: i < 3 ? "approved" : "pending", approvalStep: (i % 3) + 1,
        })),
      );

      await tx.insert(schema.prItems).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`pritem:${i}`), prId: det("pr:0"), boqItemId: det(`boqitem:${i}`), qty: m(5 + i),
        })),
      );

      await tx.insert(schema.pos).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`po:${i}`), prId: det(`pr:${i}`), vendorId: at(SUPPLIER_VENDORS, i),
          total: m(500_000 + i * 100_000), vat: m((500_000 + i * 100_000) * 0.07), creditTerm: 30,
        })),
      );

      await tx.insert(schema.wos).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`wo:${i}`), prId: det(`pr:${i + 1}`), vendorId: at(SUBCON_VENDORS, i),
          value: m(800_000 + i * 120_000),
        })),
      );

      await tx.insert(schema.grs).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`gr:${i}`), poId: det(`po:${i}`), received: m(100 - i * 5), rejected: m(i), photos: [],
        })),
      );

      await tx.insert(schema.variationOrders).values(
        Array.from({ length: 2 }, (_, i) => ({
          id: det(`vo:${i}`), poId: det(`po:${i}`), dir: (i === 0 ? "add" : "cut") as "add" | "cut",
          amount: m(50_000 * (i + 1)), reason: i === 0 ? "เพิ่มงานนอกสัญญา" : "ลดขอบเขตงาน",
        })),
      );

      // === Subcon =========================================================
      await tx.insert(schema.subconContracts).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`subc:${i}`), vendorId: at(SUBCON_VENDORS, i), projectId: det("project:rjp"),
          no: `SC-2569-${String(i + 1).padStart(3, "0")}`, value: m(2_000_000 + i * 500_000),
          retentionPct: "5.000", start: "2026-01-15", end: "2026-12-31",
        })),
      );

      // 16 work periods (4 per contract). C3: mock states mapped to state machine
      // (accepted→passed, requested→delivered); the rest use valid machine states.
      const WP_BASIS = ["percent", "distance", "milestone", "unit"] as const;
      const WP_STATUS = ["passed", "passed", "delivered", "pending"] as const; // accepted,accepted,requested,pending
      const wpRows: (typeof schema.workPeriods.$inferInsert)[] = [];
      for (let c = 0; c < 4; c++) {
        for (let s = 0; s < 4; s++) {
          wpRows.push({
            id: det(`wp:${c}:${s}`), contractId: det(`subc:${c}`), seq: s + 1,
            basis: at(WP_BASIS, c), target: m(100), pct: m(25 * (s + 1)),
            amount: m(500_000), status: at(WP_STATUS, s),
          });
        }
      }
      await tx.insert(schema.workPeriods).values(wpRows);

      // === PM =============================================================
      await tx.insert(schema.pmContracts).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`pmc:${i}`), projectId: det(`project:${at(PROJECTS, i).key}`),
          customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          mode: (i % 2 === 0 ? "MA" : "per_visit") as "MA" | "per_visit",
          visitsPerYear: 4, sla: "24 ชม.", value: m(300_000 + i * 50_000), end: "2027-01-31",
        })),
      );

      const CK_KINDS = ["lift", "inverter", "crane", "hvac", "generator"];
      await tx.insert(schema.checklistTemplates).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`cktpl:${i}`), companyId: CO1, kind: at(CK_KINDS, i), items: [],
        })),
      );

      const ASSET_KINDS = ["lift", "inverter", "crane", "hvac"];
      await tx.insert(schema.pmAssets).values(
        Array.from({ length: 16 }, (_, i) => ({
          id: det(`pmasset:${i}`), contractId: det(`pmc:${i % 5}`),
          kind: at(ASSET_KINDS, i), site: `ไซต์ ${i + 1}`, cycle: "รายเดือน", nextDue: "2026-08-01",
        })),
      );

      await tx.insert(schema.pmWorkOrders).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`pmwo:${i}`), assetId: det(`pmasset:${i}`), templateId: det(`cktpl:${i % 5}`),
          tech: `ช่าง ${i + 1}`, items: [],
        })),
      );

      // === Finance ========================================================
      await tx.insert(schema.apBillings).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`ap:${i}`), companyId: CO1, vendorId: at(SUPPLIER_VENDORS, i),
          poId: det(`po:${i}`), grId: det(`gr:${i}`), invoiceNo: `INV-V-${1000 + i}`,
          dueDate: "2026-08-30", amount: m(400_000 + i * 50_000), vat: m((400_000 + i * 50_000) * 0.07),
          status: "pending",
        })),
      );

      await tx.insert(schema.pvs).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`pv:${i}`), companyId: CO1, billingIds: [det(`ap:${i}`)],
          whtPct: "3.00", net: m(388_000 + i * 48_500), status: "draft",
        })),
      );

      const ETAX = ["queued", "sent", "rejected", "void"] as const;
      await tx.insert(schema.arInvoices).values(
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`ar:${i}`), companyId: CO1, customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          projectId: det(`project:${at(PROJECTS, i).key}`), no: `AR-2569-${String(i + 1).padStart(4, "0")}`,
          amount: m(1_000_000 + i * 200_000), vat: m((1_000_000 + i * 200_000) * 0.07), creditTerm: 30,
          etaxStatus: at(ETAX, i),
        })),
      );

      await tx.insert(schema.arCreditNotes).values(
        Array.from({ length: 3 }, (_, i) => ({
          id: det(`arcn:${i}`), companyId: CO1, no: `CN-2569-${String(i + 1).padStart(3, "0")}`,
          customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`), refInvoiceId: det(`ar:${i}`),
          reason: "ปรับลดยอด", amount: m(50_000 * (i + 1)), status: "issued", noteDate: "2026-07-01",
        })),
      );

      await tx.insert(schema.glAccounts).values(
        COA_SEED.map((a) => ({ id: det(`gl:${a.code}`), companyId: CO1, code: a.code, name: a.name })),
      );

      await tx.insert(schema.jvs).values(
        Array.from({ length: 7 }, (_, i) => ({
          id: det(`jv:${i}`), companyId: CO1, no: `JV-2569-${String(i + 1).padStart(4, "0")}`,
          sourceDoc: `ap_billing:${det(`ap:${i % 5}`)}`, memo: `บันทึกบัญชีอัตโนมัติ ชุดที่ ${i + 1}`,
        })),
      );

      // C9: balanced jv_line — every book gets 1 DR + 1 CR with equal amount.
      // DR = expense (5020 ต้นทุนวัสดุ), CR = payable (2010 เจ้าหนี้การค้า).
      const CC0 = at(CC_SEED, 0).code;
      const jvLineRows: (typeof schema.jvLines.$inferInsert)[] = [];
      for (let i = 0; i < 7; i++) {
        const amt = m(100_000 + i * 25_000);
        jvLineRows.push({
          id: det(`jvl:${i}:dr`), jvId: det(`jv:${i}`), accountId: det("gl:5020"),
          dr: amt, cr: m(0), ccId: det(`cc:${CC0}`), projectId: det("project:rjp"),
        });
        jvLineRows.push({
          id: det(`jvl:${i}:cr`), jvId: det(`jv:${i}`), accountId: det("gl:2010"),
          dr: m(0), cr: amt, ccId: det(`cc:${CC0}`), projectId: det("project:rjp"),
        });
      }
      await tx.insert(schema.jvLines).values(jvLineRows);

      await tx.insert(schema.bankStatements).values(
        Array.from({ length: 8 }, (_, i) => ({
          id: det(`bank:${i}`), companyId: CO1, period: `2569-${String((i % 12) + 1).padStart(2, "0")}`,
          lines: [], locked: i < 2,
        })),
      );

      await tx.insert(schema.fixedAssets).values(
        Array.from({ length: 8 }, (_, i) => ({
          id: det(`fa:${i}`), companyId: CO1, name: `สินทรัพย์ถาวร ${i + 1}`, cost: m(200_000 + i * 80_000),
          lifeYears: 5 + (i % 3) * 5, ccId: det(`cc:${at(CC_SEED, i).code}`), deprMethod: "straight-line",
        })),
      );

      await tx.insert(schema.workers).values(
        Array.from({ length: 8 }, (_, i) => ({
          id: det(`worker:${i}`), companyId: CO1, name: `คนงาน ${i + 1}`, dayRate: m(450 + i * 30),
        })),
      );

      const OPEX_DEPTS = ["ก่อสร้าง", "จัดซื้อ", "ขาย-การตลาด", "บัญชี-การเงิน", "บริหาร", "IT"];
      await tx.insert(schema.opexBudgets).values(
        OPEX_DEPTS.map((dept, i) => ({
          id: det(`opex:${i}`), companyId: CO1, dept, year: 2569,
          months: Array.from({ length: 12 }, (_, mo) => 100_000 + mo * 5_000 + i * 10_000),
        })),
      );

      await tx.insert(schema.retentionLedgers).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`ret:${i}`), companyId: CO1, woId: det(`wo:${i}`),
          vendorId: at(SUBCON_VENDORS, i), contractId: det(`subc:${i}`),
          scope: `งานงวดที่ ${i + 1}`, rate: "5.00", withheld: m(40_000 * (i + 1)), returned: m(0),
          dueDate: "2027-01-31", status: "held",
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
        Array.from({ length: 6 }, (_, i) => ({
          id: det(`petty:${i}`), companyId: CO1, no: `PT-2569-${String(i + 1).padStart(4, "0")}`,
          type: at(["claim", "clear", "topup"] as const, i), label: `รายการเงินสดย่อย ${i + 1}`,
          value: m(2_000 + i * 500), byUserId: det(`user:${i % 12}`), txnDate: "2026-07-05",
          status: "approved", cat: "ค่าเดินทาง", ref: `REF-${i + 1}`, ccId: det(`cc:${at(CC_SEED, i).code}`),
        })),
      );

      // === Land / Sales / Solar / Inventory / DMS / etc. ==================
      const LAND_STAGES = ["สำรวจ", "เจรจา", "ตรวจสอบ", "ทำสัญญา", "โอน", "จดจำนอง", "พัฒนา"];
      await tx.insert(schema.landPlots).values(
        Array.from({ length: 8 }, (_, i) => ({
          id: det(`land:${i}`), companyId: CO1, projectId: i < 4 ? det("project:rjp") : null,
          deedNo: `นส.3ก-${1000 + i}`, areaSqm: m(1600 + i * 400), gps: `13.${700 + i},100.${500 + i}`,
          pricePerRai: m(2_000_000 + i * 100_000), stage: at(LAND_STAGES, i), tenure: "โฉนด", ddChecklist: {},
        })),
      );

      const LEAD_STAGES = ["lead", "visit", "quote", "booking", "contract"] as const;
      await tx.insert(schema.leads).values(
        Array.from({ length: 10 }, (_, i) => ({
          id: det(`lead:${i}`), companyId: CO1, name: `ผู้สนใจ ${i + 1}`, phone: `08${i}-000-0000`,
          source: "Facebook", interest: "ทาวน์โฮม", stage: at(LEAD_STAGES, i), hot: i % 3 === 0,
          lastContactAt: "2026-07-01", note: "สนใจโครงการ", ownerUserId: det(`user:${i % 12}`), days: i + 1,
        })),
      );

      await tx.insert(schema.serviceTickets).values(
        Array.from({ length: 7 }, (_, i) => ({
          id: det(`svc:${i}`), companyId: CO1, no: `ST-2569-${String(i + 1).padStart(4, "0")}`,
          unitId: det("block:B"), customerId: det(`customer:${at(CUSTOMER_SEED, i).code}`),
          channel: "LINE", category: "ซ่อมทั่วไป", title: `แจ้งซ่อม ${i + 1}`, priority: i % 2 === 0 ? "สูง" : "ปกติ",
          status: "open", assigneeUserId: det(`user:${i % 12}`), openedDate: "2026-07-03", scheduledDate: "2026-07-10",
          warranty: i % 2 === 0,
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
          org: "กกพ.", status: i < 3 ? "done" : "pending", stepDate: "2026-06-01",
        })),
      );

      const WARR_ITEMS = ["แผงโซลาร์", "Inverter", "Mounting", "สายไฟ DC"];
      const WARR_BRANDS = ["JA Solar", "Huawei", "K2", "LAPP"];
      await tx.insert(schema.solarWarranties).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`warr:${i}`), companyId: CO1, projectId: det("project:slr"),
          item: at(WARR_ITEMS, i), brand: at(WARR_BRANDS, i),
          qty: 100 + i * 10, perf: m(90 + i), prodDate: "2025-01-01", expiryDate: "2050-01-01", status: "active",
        })),
      );

      await tx.insert(schema.warehouses).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`wh:${i}`), companyId: CO1, name: `คลัง ${i + 1}`, location: `สาขา ${i + 1}`,
        })),
      );

      await tx.insert(schema.inventoryItems).values(
        Array.from({ length: 8 }, (_, i) => ({
          id: det(`item:${i}`), companyId: CO1, warehouseId: det(`wh:${i % 5}`),
          code: `MAT-${String(i + 1).padStart(3, "0")}`, cat: "วัสดุก่อสร้าง", name: `วัสดุ ${i + 1}`, unit: "หน่วย",
          price: m(100 + i * 20), stock: m(500 - i * 10), lowPoint: m(50), status: "ok",
        })),
      );

      await tx.insert(schema.stockTransfers).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`tr:${i}`), companyId: CO1, no: `TR-2569-${String(i + 1).padStart(4, "0")}`,
          fromWarehouseId: det(`wh:${i % 5}`), toWarehouseId: det(`wh:${(i + 1) % 5}`), qty: m(20 + i * 5),
          value: m(5_000 + i * 1_000), transferDate: "2026-07-02", byUserId: det(`user:${i % 12}`), status: "done",
        })),
      );

      await tx.insert(schema.materialIssues).values(
        Array.from({ length: 4 }, (_, i) => ({
          id: det(`iss:${i}`), companyId: CO1, no: `IS-2569-${String(i + 1).padStart(4, "0")}`,
          projectId: det(`project:${at(PROJECTS, i).key}`), fromWarehouseId: det(`wh:${i % 5}`),
          value: m(8_000 + i * 2_000), issueDate: "2026-07-04", byUserId: det(`user:${i % 12}`), status: "done",
        })),
      );

      await tx.insert(schema.documents).values(
        Array.from({ length: 13 }, (_, i) => ({
          id: det(`doc:${i}`), companyId: CO1, projectId: det(`project:${at(PROJECTS, i).key}`),
          cat: "สัญญา", version: 1, expiry: "2027-01-01", linkModule: `boq:${det(`boqdoc:${i % 6}`)}`,
          url: `r2://documents/doc-${i + 1}.pdf`,
        })),
      );

      const AUDIT_ACTIONS = ["create", "update", "approve", "void"] as const;
      await tx.insert(schema.auditLogs).values(
        Array.from({ length: 13 }, (_, i) => ({
          id: det(`audit:${i}`), companyId: CO1, userId: det(`user:${i % 12}`),
          action: at(AUDIT_ACTIONS, i), entity: `pr:${det(`pr:${i % 10}`)}`,
          before: null, after: { note: `การกระทำ ${i + 1}` }, ip: `10.0.0.${i + 1}`,
        })),
      );

      // timeline: 13 tasks across 5 group labels.
      const TL_GROUPS = ["งานเตรียมพื้นที่", "งานโครงสร้าง", "งานสถาปัตย์", "งานระบบ", "งานส่งมอบ"];
      await tx.insert(schema.timelineTasks).values(
        Array.from({ length: 13 }, (_, i) => ({
          id: det(`tl:${i}`), companyId: CO1, projectId: det("project:rjp"), groupLabel: at(TL_GROUPS, i),
          label: `งาน ${i + 1}`, planStart: "2026-01-01", planEnd: "2026-03-01",
          actualStart: "2026-01-05", actualEnd: i < 8 ? "2026-03-10" : null,
          status: i < 8 ? "done" : "in-progress", pct: m(i < 8 ? 100 : 40), late: i % 4 === 0,
        })),
      );

      const MS_LABELS = ["เริ่มโครงการ", "โครงสร้างเสร็จ", "สถาปัตย์เสร็จ", "ระบบเสร็จ", "ส่งมอบ"];
      await tx.insert(schema.milestones).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: det(`ms:${i}`), companyId: CO1, projectId: det("project:rjp"),
          label: at(MS_LABELS, i), day: (i + 1) * 60, milestoneDate: "2026-06-01", status: i < 2 ? "done" : "pending",
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

      // sales_unit: 84 (B-009 answered ก). sales-process.jsx generator status map:
      // 0-47 soldBuilt · 48-56 sold · 57-61 booked · 62-67 built · 68-83 empty.
      const unitStage = (i: number): string =>
        i < 48 ? "soldBuilt" : i < 57 ? "sold" : i < 62 ? "booked" : i < 68 ? "built" : "empty";
      await tx.insert(schema.salesUnits).values(
        Array.from({ length: 84 }, (_, i) => {
          const stage = unitStage(i);
          const sold = stage !== "empty" && stage !== "built";
          return {
            id: det(`sunit:${i}`), companyId: CO1, unitId: det("block:B"),
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
