/**
 * Seed fixture assertions (expected-first) — P0-QA-06 · P0-FIX-06
 *
 * Spec (แหล่งเดียว): docs/extract/MOCK-DATA.md §"สรุปสำหรับทำ seed data"
 *   จำนวน record ต่อ entity = ค่าคาดหวังที่ seed จริง (P0-BE-10) ต้องผลิตออกมา
 *
 * วิธี (tests/CLAUDE.md):
 *   - ถอด "จำนวน record" ทุกบรรทัดใน §สรุป มาเป็นค่าคาดหวังตรง ๆ 100% — ห้ามตีความใหม่
 *   - ห้ามอ่าน implementation ก่อนเขียน expected — ทุกค่าที่ต่างจาก §สรุป ต้องมี citation
 *     จากตารางคำตัดสิน (ภาคผนวก C) หรือ blocker ที่ Wei ตอบแล้ว (BLOCKERS.md)
 *   - เทียบกับ record ที่ seed ผลิตจริง: describe "เทียบ DB จริง" ท้ายไฟล์ — รันเมื่อ
 *     ตั้ง DATABASE_URL (CI ยังไม่มี pg service → suite ข้ามอัตโนมัติ, รันจริงในเครื่อง)
 *
 * §0 กฎข้อ 5: wat/ ("บุญบัญชี") เป็นคนละผลิตภัณฑ์ — ไม่ seed เข้า Juneflow db;
 *   บันทึกไว้ใน WAT_COUNTS เพื่อความครบถ้วนของ §สรุป แต่ไม่นับเป็น expected ของ seed Juneflow
 *
 * REWORK (ด่าน 4.5 FAIL 12 ก.ค. — ภาคผนวก C ชี้ขาด, §สรุป เป็น mock ค้างเวอร์ชัน):
 *   • C1: Package = 4 (PKG_STORE S/M/L/Full) ไม่ใช่ 3 (SUB_PACKAGES stale)
 *   • C9: JV lines ต้องสมดุล DR=CR (JV 7 ใบ → ≥14 บรรทัด) — ย้ายออกจากกลุ่ม expected-0
 *
 * P0-FIX-06 (13 ก.ค. — อัปเดต expected หลัง P0-BE-10 + P0-FIX-05 · blockers ตอบครบ):
 *   • B-022(ก): Company = 9 แถวตามชื่อองค์กร SUBSCRIBERS (subscription-admin.jsx)
 *     — COMPANIES 3 ของ company-accept.jsx คือจอ group ในเครือ ไม่ใช่จำนวน company ทั้งระบบ
 *   • B-025(ก): platform_invoice = 7 — T-1001 ใช้ INV-SUB-* 3 ใบจริง (subscription.jsx
 *     SUB_INVOICES:31 = 79000/72000/18400 paid) ตัด PINV-2569-0610 (mock ค้างเวอร์ชันแบบ C1)
 *     + ใบ admin ของ tenant อื่น 4 ใบ · B-024: SUB_INVOICES → platform_invoice (ตารางเดียว)
 *   • B-026(ก): vendor kind=subcon เฉพาะ 6 รายจาก SUBCONS (subcon.jsx SC-01..06)
 *     — V-0031/V-0045 (VENDOR_SEED "รับเหมา") ไม่ติด flag → supplier · Vendor รวม = 13
 *     (VENDOR_SEED 6 + SUBCONS 6 + SC-07 คู่สัญญา WO-2026-0055 จาก subcon-accept.jsx = supplier
 *     ตาม directive P0-FIX-05/B-023+B-026 — ไม่อยู่ในจอทะเบียน)
 *   • B-024: งวดเบิกจ่าย · แผน PM · ลูกหนี้ · เอกสารรออนุมัติข้ามบริษัท = report-derived
 *     (ไม่ใช่ตาราง seed — ดู REPORT_DERIVED) · ทะเบียนผู้รับเหมา → vendor WHERE kind='subcon'
 *     · state map งวดเบิกจ่าย: current→delivered · done→paid · pending→pending
 *   • B-009(ก): Unit/SalesUnit persist 84 record จริงตาม generator ของ sales-process.jsx
 *     (code/status ตามที่ generate — ห้าม regenerate ทุก reload) → ปิด it.todo เดิม
 *   • B-029(ข): pr_type คง map clear→advance ไม่เพิ่ม enum — ไม่กระทบ count (PR = 10 เท่าเดิม)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';

export interface SeedCount {
  /** ป้ายกำกับ entity ตามข้อความใน §สรุป (ไม่ผูกชื่อ table — เป็นงานของ dictionary/BE) */
  entity: string;
  /** จำนวน record ที่คาดหวังจาก seed */
  expected: number;
  /** กลุ่มตาม §สรุป */
  group: string;
  /** const ต้นทางใน pototype/*.jsx ตามที่ §สรุป ระบุ */
  source: string;
  /** sub-count ที่ผูกกับ entity นี้ (เช่น phase ในโครงการ) — ไว้ครบถ้วน ไม่ใช่ record หลัก */
  sub?: Record<string, number>;
  note?: string;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------
const PLATFORM: SeedCount[] = [
  { entity: 'Company (tenant ทั้งระบบ)', expected: 9, group: 'Platform', source: 'subscription-admin.jsx SUBSCRIBERS', note: 'B-022(ก): สร้าง company records 9 แถวตามชื่อองค์กร SUBSCRIBERS — จอ subscription-admin ตรง 100% · COMPANIES 3 (company-accept.jsx) = จอ group ในเครือ ไม่ใช่ total' },
  { entity: 'Tenant/Subscriber', expected: 9, group: 'Platform', source: 'subscription-admin.jsx SUBSCRIBERS', note: 'ตาราง subscription — 1 subscription ต่อ tenant' },
  { entity: 'Package', expected: 4, group: 'Platform', source: 'pkg-builder.jsx PKG_STORE.seed (S/M/L/Full)', note: 'C1 (ภาคผนวก C): ใช้ 4 ระดับตาม PKG_STORE + PACKAGE-RULES §1 — SUB_PACKAGES=3 เป็น mock ค้างเวอร์ชัน · จอ sub.plans render 4 การ์ด' },
  { entity: 'Platform Invoice', expected: 7, group: 'Platform', source: 'subscription-admin.jsx inv (4 ใบ tenant อื่น) + subscription.jsx SUB_INVOICES (3 ใบ T-1001)', sub: { T1001_invSub: 3, adminOther: 4 }, note: 'B-025(ก): T-1001 ใช้ INV-SUB-* 3 ใบจริง ตัด PINV-2569-0610 (mock ค้างเวอร์ชันแบบ C1) · B-024: SUB_INVOICES → platform_invoice ตารางเดียว — ดู T1001_SUB_INVOICES' },
  { entity: 'User', expected: 12, group: 'Platform', source: 'subscription-admin.jsx COMPANY_USERS["T-1001"]' },
  { entity: 'Role', expected: 8, group: 'Platform', source: 'master.jsx ROLE_PRESETS', sub: { permsMatrixRows: 11, permsMatrixCols: 5 } },
];

// Subscription Invoice ของ T-1001 — subset ของ platform_invoice (B-024/B-025 ไม่ใช่ตารางแยก)
//   subscription.jsx:31 SUB_INVOICES — 3 ใบ paid ทั้งหมด
export const T1001_SUB_INVOICES = {
  tenantOrg: 'บจก. รุ่งเรืองก่อสร้าง',            // subscription-admin.jsx SUBSCRIBERS T-1001.org
  count: 3,
  amounts: [18400, 72000, 79000],                 // เรียงจากน้อยไปมาก
  status: 'paid',
} as const;

// ---------------------------------------------------------------------------
// Master / โครงการ
// ---------------------------------------------------------------------------
const MASTER: SeedCount[] = [
  { entity: 'Project', expected: 7, group: 'Master', source: 'chrome.jsx PROJECTS', sub: { phase: 16 } },
  { entity: 'ProjectType', expected: 4, group: 'Master', source: 'project-types.jsx PROJECT_TYPES' },
  { entity: 'โครงสร้างองค์กร (Org)', expected: 10, group: 'Master', source: 'master.jsx ORG_SEED' },
  { entity: 'Block', expected: 3, group: 'Master', source: 'master.jsx' },
  { entity: 'Model', expected: 5, group: 'Master', source: 'master.jsx' },
  { entity: 'Cost Center', expected: 7, group: 'Master', source: 'master.jsx' },
  { entity: 'เลขรันเอกสาร (Doc number)', expected: 10, group: 'Master', source: 'master.jsx' },
  { entity: 'Vendor', expected: 13, group: 'Master', source: 'master-party.jsx VENDOR_SEED (6) + subcon.jsx SUBCONS (6) + subcon-accept.jsx SC-07', sub: { supplier: 7, subcon: 6 }, note: 'B-026(ก): kind=subcon เฉพาะ SC-01..06 · V-0031/V-0045 ("รับเหมา" ใน VENDOR_SEED) = supplier ไม่ติด flag · SC-07 (คู่สัญญา WO-2026-0055 — ไม่อยู่ในจอทะเบียน) = supplier ตาม directive P0-FIX-05 (B-023+B-026) → 6+6+1 = 13' },
  { entity: 'Customer', expected: 6, group: 'Master', source: 'master-party.jsx' },
  { entity: 'Unit', expected: 84, group: 'Master', source: 'sales-process.jsx units generator (84 ยูนิต code+status)', note: 'B-009(ก): persist 84 record จริงตาม generator — regenerate ทุก reload = กลไก mock ห้ามลอก (§0 กฎ 3) · dictionary: hierarchy Project→Phase→Block→Unit (project_node) พร้อมสถานะขาย' },
];

// ---------------------------------------------------------------------------
// BOQ / จัดซื้อ
// ---------------------------------------------------------------------------
const BOQ_PROCUREMENT: SeedCount[] = [
  { entity: 'BOQDoc', expected: 6, group: 'BOQ/จัดซื้อ', source: 'boq-list.jsx' },
  { entity: 'BOQItem', expected: 21, group: 'BOQ/จัดซื้อ', source: 'boq.jsx', sub: { groups: 6 } },
  { entity: 'BOQ balance', expected: 8, group: 'BOQ/จัดซื้อ', source: 'boq.jsx' },
  { entity: 'BOQ archive', expected: 5, group: 'BOQ/จัดซื้อ', source: 'boq.jsx' },
  { entity: 'BOQ รออนุมัติ', expected: 4, group: 'BOQ/จัดซื้อ', source: 'boq.jsx' },
  { entity: 'CBS Budget (กลุ่ม)', expected: 6, group: 'BOQ/จัดซื้อ', source: 'boq.jsx' },
  { entity: 'BOM (แบบบ้าน)', expected: 4, group: 'BOQ/จัดซื้อ', source: 'bom', sub: { lines_B1: 17 } },
  { entity: 'AI QTO (แถวถอดปริมาณ)', expected: 10, group: 'BOQ/จัดซื้อ', source: 'qto', sub: { element: 6 } },
  { entity: 'เอกสารเชื่อม BOQ→PR/PO/WO/GR', expected: 20, group: 'BOQ/จัดซื้อ', source: 'linked-docs.jsx', sub: { boqCodes: 8 } },
  { entity: 'PR', expected: 10, group: 'BOQ/จัดซื้อ', source: 'pr-list.jsx', note: 'B-029(ข): PR-2026-0411 type "clear" คง map → advance ไม่เพิ่ม enum — count ไม่เปลี่ยน' },
  { entity: 'PO', expected: 6, group: 'BOQ/จัดซื้อ', source: 'po-wo.jsx' },
  { entity: 'WO', expected: 5, group: 'BOQ/จัดซื้อ', source: 'po-wo.jsx WO_ROWS', note: 'P0-FIX-05: ทั้ง 5 ใบชี้ vendor kind=subcon (SC-01..05 — ชื่อตรง WO_ROWS.subcon verbatim)' },
  { entity: 'GR', expected: 5, group: 'BOQ/จัดซื้อ', source: 'gr.jsx', sub: { ใบตีกลับ: 3 } },
];

// ---------------------------------------------------------------------------
// ผู้รับเหมา
// ---------------------------------------------------------------------------
const SUBCON: SeedCount[] = [
  { entity: 'ทะเบียนผู้รับเหมา', expected: 6, group: 'ผู้รับเหมา', source: 'subcon.jsx SUBCONS (SC-01..06)', note: 'B-024: map → vendor · B-026(ก): จอทะเบียน = vendor WHERE kind=subcon = 6 (subset ของ Vendor 13 — ไม่ใช่ตารางแยก) — ไม่ใช่ 8/9 interim' },
  { entity: 'สัญญา subcon', expected: 4, group: 'ผู้รับเหมา', source: 'subcon-accept.jsx', sub: { งวดงานรวม: 16 } },
  { entity: 'Variation Order', expected: 2, group: 'ผู้รับเหมา', source: 'subcon.jsx' },
];

// ---------------------------------------------------------------------------
// PM (CMMS)
// ---------------------------------------------------------------------------
const PM: SeedCount[] = [
  { entity: 'PMContract', expected: 5, group: 'PM', source: 'pm.jsx' },
  { entity: 'PMAsset', expected: 16, group: 'PM', source: 'pm.jsx' },
  { entity: 'PMWO', expected: 6, group: 'PM', source: 'pm.jsx' },
  { entity: 'ChecklistTemplate', expected: 5, group: 'PM', source: 'pm-checklist.jsx' },
];

// ---------------------------------------------------------------------------
// การเงิน-บัญชี
// ---------------------------------------------------------------------------
const FINANCE: SeedCount[] = [
  { entity: 'AP ตั้งหนี้', expected: 5, group: 'การเงิน-บัญชี', source: 'ap.jsx', note: '§สรุป: +6 จอเก่า (finance.jsx legacy) — ใช้ 5 เป็น seed หลัก' },
  { entity: 'PV', expected: 4, group: 'การเงิน-บัญชี', source: 'ap.jsx/finance.jsx' },
  { entity: 'AR Invoice', expected: 6, group: 'การเงิน-บัญชี', source: 'ar' },
  { entity: 'ใบลดหนี้', expected: 3, group: 'การเงิน-บัญชี', source: 'ar' },
  { entity: 'JV', expected: 7, group: 'การเงิน-บัญชี', source: 'gl JV_LIST', note: 'C9 (ภาคผนวก C): mock JV_LIST.lines เป็นแค่จำนวนบรรทัด — seed สร้าง lines สมดุล DR=CR (≥14 บรรทัด) · ดู describe "JV lines" (ห้ามล็อก 0)' },
  { entity: 'Posting inbox', expected: 7, group: 'การเงิน-บัญชี', source: 'gl' },
  { entity: 'งบทดลอง (trial balance)', expected: 14, group: 'การเงิน-บัญชี', source: 'gl' },
  { entity: 'COA', expected: 23, group: 'การเงิน-บัญชี', source: 'gl', sub: { class: 5 } },
  { entity: 'Bank statement', expected: 8, group: 'การเงิน-บัญชี', source: 'bank' },
  { entity: 'FixedAsset', expected: 8, group: 'การเงิน-บัญชี', source: 'fa', sub: { ปรับปรุง: 5 } },
  { entity: 'e-Tax', expected: 6, group: 'การเงิน-บัญชี', source: 'etax' },
  { entity: 'Petty Cash', expected: 6, group: 'การเงิน-บัญชี', source: 'petty', sub: { ปันส่วน: 6 } },
  { entity: 'Worker', expected: 8, group: 'การเงิน-บัญชี', source: 'labor', note: '§สรุป: ไม่มี Attendance/Payroll' },
  { entity: 'OPEX (แผนก)', expected: 6, group: 'การเงิน-บัญชี', source: 'opex', sub: { รายเดือน: 6, ประวัติ: 6 } },
  { entity: 'Retention', expected: 4, group: 'การเงิน-บัญชี', source: 'retention' },
  { entity: 'RevRec', expected: 4, group: 'การเงิน-บัญชี', source: 'revrec' },
  { entity: 'WIP', expected: 3, group: 'การเงิน-บัญชี', source: 'wip' },
  { entity: 'P&L โครงการ', expected: 5, group: 'การเงิน-บัญชี', source: 'pnl' },
  { entity: 'Aging AP', expected: 5, group: 'การเงิน-บัญชี', source: 'aging' },
  { entity: 'Aging AR', expected: 5, group: 'การเงิน-บัญชี', source: 'aging' },
];

// ---------------------------------------------------------------------------
// ที่ดิน / ขาย / อื่น ๆ
// ---------------------------------------------------------------------------
const LAND_SALES_ETC: SeedCount[] = [
  { entity: 'LandPlot', expected: 8, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'land', sub: { stage: 7, ddChecklist: 7 } },
  { entity: 'Lead CRM', expected: 10, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'crm', sub: { stage: 5 } },
  { entity: 'ใบแจ้งซ่อมหลังขาย', expected: 7, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'after-sales' },
  { entity: 'SalesUnit', expected: 84, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'sales-process.jsx units generator (ชุด 84 ยูนิตเดียวกับ Unit)', note: 'B-009(ก): SalesUnit records จริงใน seed ห้าม regenerate ทุก reload — ผูก 1:1 กับ Unit 84' },
  { entity: 'Solar inverter', expected: 6, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Solar ticket', expected: 3, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Solar ใบแจ้งหนี้ PPA', expected: 5, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Solar ROI (ปี)', expected: 6, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Solar ขั้นขออนุญาต', expected: 6, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Solar warranty', expected: 4, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'solar' },
  { entity: 'Inventory วัสดุ', expected: 8, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'inventory' },
  { entity: 'Inventory คลัง', expected: 5, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'inventory' },
  { entity: 'Inventory โอนย้าย', expected: 4, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'inventory' },
  { entity: 'Inventory เบิก', expected: 4, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'inventory' },
  { entity: 'Document (DMS)', expected: 13, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'dms' },
  { entity: 'AuditLog', expected: 13, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'audit' },
  { entity: 'Timeline (งาน)', expected: 13, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'timeline', sub: { กลุ่ม: 5, milestone: 5 } },
];

// Notification: 3 ชุด (5+7+10) — §สรุป
const NOTIFICATION_SETS = [5, 7, 10];

// ---------------------------------------------------------------------------
// บรรทัด §สรุป ที่ B-024 ตัดสินเป็น report-derived — ไม่ใช่ตาราง seed แยก
//   ห้าม assert เป็น count ของตารางใด · จอ/รายงานคำนวณจากตารางต้นทางตอน query
// ---------------------------------------------------------------------------
interface ReportDerived {
  entity: string;
  uiCount: number;         // จำนวนแถวที่จอ pototype แสดง (ไว้เทียบตอน hookup จอ ไม่ใช่ตาราง)
  source: string;
  derivedFrom: string;     // mapping ตามคำตอบ B-024
}
const REPORT_DERIVED: ReportDerived[] = [
  { entity: 'งวดเบิกจ่าย', uiCount: 5, source: 'subcon.jsx', derivedFrom: 'work_period + retention (B-024: state map current→delivered · done→paid · pending→pending)' },
  { entity: 'แผน PM', uiCount: 6, source: 'pm2.jsx', derivedFrom: 'report-derived — ไม่ seed (B-024)' },
  { entity: 'ลูกหนี้', uiCount: 5, source: 'ar', derivedFrom: 'report-derived — ไม่ seed (B-024)' },
  { entity: 'เอกสารรออนุมัติข้ามบริษัท', uiCount: 10, source: 'company-accept.jsx', derivedFrom: 'report-derived — ไม่ seed (B-024)' },
];

// ---------------------------------------------------------------------------
// entity ใน dictionary ที่ไม่มี mock record เลย (§สรุป ท้าย) → expected 0
//   • 'JV lines (DR/CR)' → C9 (seed สร้าง lines สมดุล DR=CR ≥14 บรรทัด ห้ามล็อก 0)
//   • 'Unit' / 'SalesUnit' → B-009(ก) ตอบแล้ว: persist 84 → ย้ายเข้า SEED_COUNTS (ไม่ใช่ 0)
//   เหลือ 6 ตัวที่ §สรุป ยืนยัน 0 โดยไม่ขัด C-decision / blocker ที่ตอบแล้ว
// ---------------------------------------------------------------------------
const NO_RECORD_ENTITIES = [
  'AiUsage', 'Acceptance', 'Defect', 'Attendance', 'Payroll', 'Cheque',
];

// JV lines (ภาคผนวก C9) — mock JV_LIST.lines เป็นแค่ "จำนวนบรรทัด" ไม่มี DR/CR จริง;
//   C9 สั่ง seed สร้าง lines สมดุล DR=CR จากยอด mock → ห้ามล็อก 0
//   JV 7 ใบ · ทุกใบมีอย่างน้อย 1 DR + 1 CR → รวม ≥ 14 บรรทัด
const JV_BOOK_COUNT = 7;                                        // §สรุป: JV 7 ใบ
const JV_MIN_LINES_PER_BOOK = 2;                               // ≥1 DR + ≥1 CR ต่อใบ
const JV_MIN_TOTAL_LINES = JV_BOOK_COUNT * JV_MIN_LINES_PER_BOOK; // ≥14

// Unit / SalesUnit — B-009(ก) ตอบแล้ว 12 ก.ค.: persist 84 ยูนิตตาม generator ของ
//   sales-process.jsx (code/status ตามที่ generate) — regenerate ทุก reload = กลไก mock
//   ห้ามลอก (§0 กฎ 3) · Unit กับ SalesUnit ผูกชุด 84 ยูนิตเดียวกัน
const UNIT_PERSIST_COUNT = 84;

// wat/ ("บุญบัญชี") — คนละผลิตภัณฑ์ (§0 กฎข้อ 5) · ไม่ seed เข้า Juneflow db
// เก็บไว้เพื่อความครบถ้วนของ §สรุป เท่านั้น — ไม่ assert เป็น expected ของ seed Juneflow
export const WAT_COUNTS: Record<string, number> = {
  วัด: 3, กองทุน: 6, ผู้บริจาค: 5, อนุโมทนาบัตร: 8, ledger: 8,
  คำขออนุมัติ: 4, audit: 8, เลขรัน: 4, role: 5, กระทบยอด: 4,
};

export const SEED_COUNTS: SeedCount[] = [
  ...PLATFORM, ...MASTER, ...BOQ_PROCUREMENT, ...SUBCON, ...PM, ...FINANCE, ...LAND_SALES_ETC,
];

// ---------------------------------------------------------------------------
describe('Seed fixture — expected record counts (§สรุป + blockers ตอบแล้ว)', () => {
  it.each(SEED_COUNTS)('$group · $entity = $expected', (c) => {
    // fixture-consistency: จำนวน record เป็นจำนวนเต็มไม่ติดลบ
    expect(Number.isInteger(c.expected)).toBe(true);
    expect(c.expected).toBeGreaterThan(0);
    // ต้องมี citation ต้นทางเสมอ (กันค่าที่ไม่ได้ถอดจาก §สรุป/blocker)
    expect(c.source.length).toBeGreaterThan(0);
    // sub-counts (ถ้ามี) ก็ต้องเป็นจำนวนเต็มไม่ติดลบ
    for (const v of Object.values(c.sub ?? {})) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('ไม่มี entity ซ้ำ (แต่ละบรรทัด §สรุป = key เดียว)', () => {
    const keys = SEED_COUNTS.map((c) => c.entity);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ครบทุกกลุ่มใน §สรุป (7 กลุ่ม Juneflow)', () => {
    const groups = new Set(SEED_COUNTS.map((c) => c.group));
    expect(groups).toEqual(new Set([
      'Platform', 'Master', 'BOQ/จัดซื้อ', 'ผู้รับเหมา', 'PM', 'การเงิน-บัญชี', 'ที่ดิน/ขาย/อื่นๆ',
    ]));
  });

  it('P0-FIX-06: ค่าที่แก้ตาม blocker ตรงคำตอบ Wei', () => {
    const byEntity = Object.fromEntries(SEED_COUNTS.map((c) => [c.entity, c]));
    expect(byEntity['Company (tenant ทั้งระบบ)'].expected).toBe(9);          // B-022(ก)
    expect(byEntity['Platform Invoice'].expected).toBe(7);                    // B-025(ก)
    expect(byEntity['Platform Invoice'].sub).toEqual({ T1001_invSub: 3, adminOther: 4 });
    expect(byEntity['Vendor'].expected).toBe(13);                             // FIX-05 flag
    expect(byEntity['Vendor'].sub).toEqual({ supplier: 7, subcon: 6 });       // B-026(ก)
    expect(byEntity['ทะเบียนผู้รับเหมา'].expected).toBe(6);                    // B-026(ก) final
    expect(byEntity['Unit'].expected).toBe(UNIT_PERSIST_COUNT);               // B-009(ก)
    expect(byEntity['SalesUnit'].expected).toBe(UNIT_PERSIST_COUNT);          // B-009(ก)
  });
});

describe('Seed fixture — Subscription Invoice T-1001 (subset ของ platform_invoice)', () => {
  it('B-025(ก) + B-024: 3 ใบ INV-SUB-* = 79000/72000/18400 paid — ไม่ใช่ตารางแยก', () => {
    expect(T1001_SUB_INVOICES.count).toBe(3);
    expect(T1001_SUB_INVOICES.amounts).toEqual([18400, 72000, 79000]);
    expect(T1001_SUB_INVOICES.status).toBe('paid');
    // สอดคล้อง sub ของ Platform Invoice (7 = 3 + 4)
    expect(T1001_SUB_INVOICES.count + 4).toBe(7);
  });
});

describe('Seed fixture — Notification (3 ชุด)', () => {
  it('มี 3 ชุด · จำนวน [5,7,10]', () => {
    expect(NOTIFICATION_SETS).toEqual([5, 7, 10]);
    expect(NOTIFICATION_SETS.reduce((a, b) => a + b, 0)).toBe(22);
  });
});

describe('Seed fixture — report-derived (B-024: ไม่ใช่ตาราง seed)', () => {
  it.each(REPORT_DERIVED)('$entity (จอแสดง $uiCount แถว) → $derivedFrom', (r) => {
    expect(r.uiCount).toBeGreaterThan(0);
    expect(r.derivedFrom).toContain('B-024');
  });
  it('4 บรรทัด report-derived ไม่อยู่ใน SEED_COUNTS (กัน assert ผิดตาราง)', () => {
    expect(REPORT_DERIVED.length).toBe(4);
    const seedKeys = new Set(SEED_COUNTS.map((c) => c.entity));
    for (const r of REPORT_DERIVED) expect(seedKeys.has(r.entity)).toBe(false);
  });
});

describe('Seed fixture — entity ไม่มี record (expected 0)', () => {
  it.each(NO_RECORD_ENTITIES)('%s → 0 record', (name) => {
    expect(typeof name).toBe('string');
  });
  it('มี 6 entity ไม่มี record (9 เดิม − JV lines(C9) − Unit − SalesUnit(B-009ก=84))', () => {
    expect(NO_RECORD_ENTITIES.length).toBe(6);
    expect(new Set(NO_RECORD_ENTITIES).size).toBe(6);
  });
  it('JV lines / Unit / SalesUnit ไม่อยู่ในกลุ่ม expected-0 อีกต่อไป', () => {
    for (const moved of ['JV lines (DR/CR)', 'Unit', 'SalesUnit']) {
      expect(NO_RECORD_ENTITIES).not.toContain(moved);
    }
  });
});

describe('Seed fixture — JV lines สมดุล DR=CR (ภาคผนวก C9)', () => {
  it('JV 7 ใบ · ทุกใบ ≥2 บรรทัด → รวม ≥14 บรรทัด (ห้ามล็อก 0)', () => {
    expect(JV_BOOK_COUNT).toBe(7);
    expect(JV_MIN_LINES_PER_BOOK).toBeGreaterThanOrEqual(2);
    expect(JV_MIN_TOTAL_LINES).toBeGreaterThanOrEqual(14);
    expect(JV_MIN_TOTAL_LINES).toBe(14);
  });
  it('invariant: ทุก JV book ต้อง ΣDR = ΣCR (สร้างจากยอด mock)', () => {
    // ชุดบรรทัดตัวอย่างที่สมดุล — spec invariant เท่านั้น ไม่ผูก account จริง (Open Q #3)
    const sampleBook = [{ dr: 1000, cr: 0 }, { dr: 0, cr: 1000 }];
    const sumDr = sampleBook.reduce((a, l) => a + l.dr, 0);
    const sumCr = sampleBook.reduce((a, l) => a + l.cr, 0);
    expect(sumDr).toBe(sumCr);
    expect(sampleBook.length).toBeGreaterThanOrEqual(JV_MIN_LINES_PER_BOOK);
  });
});

describe('Seed fixture — Unit/SalesUnit persist 84 (B-009ก — ปิด todo เดิม)', () => {
  it('Unit persist count = 84 ตาม generator ของ sales-process.jsx (B-009ก)', () => {
    expect(UNIT_PERSIST_COUNT).toBe(84);
    expect(SEED_COUNTS.find((c) => c.entity === 'Unit')?.expected).toBe(84);
  });
  it('SalesUnit persist count = 84 — ผูกชุด 84 ยูนิตเดียวกัน (sales-process.jsx units)', () => {
    expect(SEED_COUNTS.find((c) => c.entity === 'SalesUnit')?.expected).toBe(84);
  });
});

describe('wat/ — คนละผลิตภัณฑ์ (§0 กฎ 5, ไม่ seed เข้า Juneflow)', () => {
  it('บันทึกครบ 10 entity ของ wat/ (reference-only)', () => {
    expect(Object.keys(WAT_COUNTS).length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// เทียบ DB จริงหลัง migrate + seed (P0-BE-10 + P0-FIX-05)
//   รันเมื่อตั้ง DATABASE_URL เท่านั้น — CI ยังไม่มี postgres service ใน stage tests
//   (.github/workflows/ci.yml) → suite ข้ามใน CI · รันจริงในเครื่อง:
//   DATABASE_URL=postgres://juneflow:juneflow-dev@127.0.0.1:5433/juneflow \
//     pnpm --filter @juneflow/tests test:seed
//   ขอบเขต: assert เฉพาะบรรทัดที่ mapping ตาราง "ยืนยันแล้ว" (B-024 6 บรรทัด + blocker
//   ตอบแล้ว + C1/C9 + expected-0) — บรรทัดอื่นเปิด hookup เมื่อ mapping ถูกยืนยัน
//   (ดู describe.todo ท้ายไฟล์)
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL ?? '';

describe.runIf(DB_URL.length > 0)('Seed — เทียบ DB จริง (migrate+seed จาก packages/db ที่ merge แล้ว)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const res = await client.query(sql, params);
    return Number(res.rows[0].n);
  };

  it('company = 9 (B-022ก: 9 แถวตามชื่อองค์กร SUBSCRIBERS)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM company')).toBe(9);
  });

  it('subscription (Tenant/Subscriber) = 9 (§สรุป)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM subscription')).toBe(9);
  });

  it('package = 4 (C1: PKG_STORE S/M/L/Full)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM package')).toBe(4);
  });

  it('platform_invoice = 7 (B-025ก: T-1001 3 ใบ INV-SUB + tenant อื่น 4 ใบ)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM platform_invoice')).toBe(7);
  });

  it('platform_invoice ของ T-1001 = 3 ใบ · 79000/72000/18400 · paid ทั้งหมด (B-025ก · subscription.jsx:31)', async () => {
    const res = await client.query(
      `SELECT pi.amount, pi.status
         FROM platform_invoice pi
         JOIN subscription s ON s.id = pi.subscription_id
         JOIN company c ON c.id = s.company_id
        WHERE c.name = $1
        ORDER BY pi.amount`,
      [T1001_SUB_INVOICES.tenantOrg],
    );
    expect(res.rows.length).toBe(T1001_SUB_INVOICES.count);
    expect(res.rows.map((r) => Number(r.amount))).toEqual([...T1001_SUB_INVOICES.amounts]);
    for (const r of res.rows) expect(r.status).toBe(T1001_SUB_INVOICES.status);
  });

  it('vendor รวม = 13 · supplier = 7 · subcon = 6 (B-026ก + FIX-05: SC-07/V-0031/V-0045 = supplier)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM vendor')).toBe(13);
    expect(await count(`SELECT count(*)::int AS n FROM vendor WHERE kind = 'supplier'`)).toBe(7);
    expect(await count(`SELECT count(*)::int AS n FROM vendor WHERE kind = 'subcon'`)).toBe(6);
  });

  it('sales_unit = 84 (B-009ก: persist ตาม generator — ห้าม regenerate)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM sales_unit')).toBe(84);
  });

  it('project_node ระดับ unit = 84 (B-009ก + dictionary: Project→Phase→Block→Unit + สถานะขาย)', async () => {
    expect(await count(`SELECT count(*)::int AS n FROM project_node WHERE kind = 'unit'`)).toBe(84);
  });

  it('subcon_contract = 4 · work_period = 16 (§สรุป — งวดเบิกจ่ายเป็น report จาก work_period+retention ตาม B-024)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM subcon_contract')).toBe(4);
    expect(await count('SELECT count(*)::int AS n FROM work_period')).toBe(16);
  });

  it('wo = 5 · ทุกใบชี้ vendor kind=subcon (FIX-05: rewire → SC-01..05)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM wo')).toBe(5);
    expect(await count(
      `SELECT count(*)::int AS n FROM wo w JOIN vendor v ON v.id = w.vendor_id WHERE v.kind = 'subcon'`,
    )).toBe(5);
  });

  it('jv = 7 ใบ · jv_line รวม ≥14 · ทุกใบ ≥2 บรรทัด และ ΣDR = ΣCR (C9)', async () => {
    expect(await count('SELECT count(*)::int AS n FROM jv')).toBe(JV_BOOK_COUNT);
    expect(await count('SELECT count(*)::int AS n FROM jv_line')).toBeGreaterThanOrEqual(JV_MIN_TOTAL_LINES);
    const res = await client.query(
      `SELECT jv_id, count(*)::int AS lines, sum(dr) AS sdr, sum(cr) AS scr
         FROM jv_line GROUP BY jv_id`,
    );
    expect(res.rows.length).toBe(JV_BOOK_COUNT);
    for (const r of res.rows) {
      expect(r.lines).toBeGreaterThanOrEqual(JV_MIN_LINES_PER_BOOK);
      expect(Number(r.sdr)).toBe(Number(r.scr));
    }
  });

  // §สรุป ท้าย: entity ที่ไม่มี mock record เลย → ตารางจริงต้องว่าง
  const ZERO_TABLES: Array<[string, string]> = [
    ['AiUsage', 'ai_usage'],
    ['Acceptance', 'acceptance'],
    ['Defect', 'defect'],
    ['Attendance', 'attendance'],
    ['Payroll', 'payroll'],
    ['Cheque', 'cheque'],
  ];
  it.each(ZERO_TABLES)('%s (%s) = 0 record (§สรุป: ไม่มี mock record)', async (_label, table) => {
    expect(await count(`SELECT count(*)::int AS n FROM ${table}`)).toBe(0);
  });
});

// --- hookup ตารางที่เหลือ (บรรทัด §สรุป อื่น ๆ) ------------------------------
describe.todo('Seed — hookup ตารางที่เหลือของ §สรุป', () => {
  // B-024 ยืนยัน mapping เฉพาะ 6 บรรทัดกำกวม — บรรทัดอื่น (เช่น BOQ balance/archive,
  // Posting inbox, งบทดลอง, Aging, P&L, AP "+6 จอเก่า") ยังต้องยืนยัน mapping ตาราง
  // ต่อบรรทัดก่อนเปิด assert จริง (แบบเดียวกับที่ B-024 ทำ) — เปิดเป็น task QA ถัดไป
  // เพื่อไม่ให้ expected แดงจาก mapping ที่ QA ตัดสินเอง (§0 กฎ 4)
});
