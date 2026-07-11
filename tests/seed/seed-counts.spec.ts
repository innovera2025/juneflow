/**
 * Seed fixture assertions (expected-first) — P0-QA-06
 *
 * Spec (แหล่งเดียว): docs/extract/MOCK-DATA.md §"สรุปสำหรับทำ seed data"
 *   จำนวน record ต่อ entity = ค่าคาดหวังที่ seed จริง (P0-BE-10) ต้องผลิตออกมา
 *
 * วิธี (tests/CLAUDE.md):
 *   - ถอด "จำนวน record" ทุกบรรทัดใน §สรุป มาเป็นค่าคาดหวังตรง ๆ 100% — ห้ามตีความใหม่
 *   - ห้ามอ่าน implementation ก่อนเขียน expected (ยังไม่มี packages/db seed อยู่แล้ว)
 *   - รอบนี้รันได้เฉพาะ fixture-consistency (ค่าคงเส้นคงวา + ครบทุกบรรทัด §สรุป);
 *     การเทียบกับ record ที่ seed ผลิตจริงอยู่ใน describe.todo (รันเมื่อ P0-BE-10 done)
 *
 * §0 กฎข้อ 5: wat/ ("บุญบัญชี") เป็นคนละผลิตภัณฑ์ — ไม่ seed เข้า Juneflow db;
 *   บันทึกไว้ใน WAT_COUNTS เพื่อความครบถ้วนของ §สรุป แต่ไม่นับเป็น expected ของ seed Juneflow
 *
 * REWORK (ด่าน 4.5 FAIL 12 ก.ค. — ภาคผนวก C ชี้ขาด, §สรุป เป็น mock ค้างเวอร์ชัน):
 *   • C1: Package = 4 (PKG_STORE S/M/L/Full) ไม่ใช่ 3 (SUB_PACKAGES stale)
 *   • C9: JV lines ต้องสมดุล DR=CR (JV 7 ใบ → ≥14 บรรทัด) — ย้ายออกจากกลุ่ม expected-0
 *   • B-009: Unit/SalesUnit (generate 84 vs persist ตาม §0 กฎ 3) ยังไม่ตัดสิน → it.todo ผูก B-009
 */
import { describe, it, expect } from 'vitest';

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
  { entity: 'Company (บริษัทในเครือ)', expected: 3, group: 'Platform', source: 'company-accept.jsx COMPANIES' },
  { entity: 'Tenant/Subscriber', expected: 9, group: 'Platform', source: 'subscription-admin.jsx SUBSCRIBERS' },
  { entity: 'Package', expected: 4, group: 'Platform', source: 'pkg-builder.jsx PKG_STORE.seed (S/M/L/Full)', note: 'C1 (ภาคผนวก C): ใช้ 4 ระดับตาม PKG_STORE + PACKAGE-RULES §1 — SUB_PACKAGES=3 เป็น mock ค้างเวอร์ชัน · จอ sub.plans render 4 การ์ด' },
  { entity: 'Platform Invoice', expected: 5, group: 'Platform', source: 'subscription-admin.jsx inv' },
  { entity: 'Subscription Invoice (tenant)', expected: 3, group: 'Platform', source: 'subscription.jsx SUB_INVOICES' },
  { entity: 'User', expected: 12, group: 'Platform', source: 'subscription-admin.jsx COMPANY_USERS["T-1001"]' },
  { entity: 'Role', expected: 8, group: 'Platform', source: 'master.jsx ROLE_PRESETS', sub: { permsMatrixRows: 11, permsMatrixCols: 5 } },
];

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
  { entity: 'Vendor', expected: 6, group: 'Master', source: 'master-party.jsx' },
  { entity: 'Customer', expected: 6, group: 'Master', source: 'master-party.jsx' },
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
  { entity: 'PR', expected: 10, group: 'BOQ/จัดซื้อ', source: 'pr-list.jsx' },
  { entity: 'PO', expected: 6, group: 'BOQ/จัดซื้อ', source: 'po-wo.jsx' },
  { entity: 'WO', expected: 5, group: 'BOQ/จัดซื้อ', source: 'po-wo.jsx' },
  { entity: 'GR', expected: 5, group: 'BOQ/จัดซื้อ', source: 'gr.jsx', sub: { ใบตีกลับ: 3 } },
];

// ---------------------------------------------------------------------------
// ผู้รับเหมา
// ---------------------------------------------------------------------------
const SUBCON: SeedCount[] = [
  { entity: 'ทะเบียนผู้รับเหมา', expected: 6, group: 'ผู้รับเหมา', source: 'subcon.jsx' },
  { entity: 'สัญญา subcon', expected: 4, group: 'ผู้รับเหมา', source: 'subcon-accept.jsx', sub: { งวดงานรวม: 16 } },
  { entity: 'งวดเบิกจ่าย', expected: 5, group: 'ผู้รับเหมา', source: 'subcon.jsx' },
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
  { entity: 'แผน PM', expected: 6, group: 'PM', source: 'pm2.jsx' },
];

// ---------------------------------------------------------------------------
// การเงิน-บัญชี
// ---------------------------------------------------------------------------
const FINANCE: SeedCount[] = [
  { entity: 'AP ตั้งหนี้', expected: 5, group: 'การเงิน-บัญชี', source: 'ap.jsx', note: '§สรุป: +6 จอเก่า (finance.jsx legacy) — ใช้ 5 เป็น seed หลัก' },
  { entity: 'PV', expected: 4, group: 'การเงิน-บัญชี', source: 'ap.jsx/finance.jsx' },
  { entity: 'AR Invoice', expected: 6, group: 'การเงิน-บัญชี', source: 'ar' },
  { entity: 'ลูกหนี้', expected: 5, group: 'การเงิน-บัญชี', source: 'ar' },
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
  { entity: 'เอกสารรออนุมัติข้ามบริษัท', expected: 10, group: 'ที่ดิน/ขาย/อื่นๆ', source: 'company-accept.jsx' },
];

// Notification: 3 ชุด (5+7+10) — §สรุป
const NOTIFICATION_SETS = [5, 7, 10];

// ---------------------------------------------------------------------------
// entity ใน dictionary ที่ไม่มี mock record เลย (§สรุป ท้าย) → expected 0
//   หมายเหตุ rework (ด่าน 4.5 FAIL 12 ก.ค.): เดิมกลุ่มนี้มี 9 รายการ — ถอด 3 ตัวออก:
//   • 'JV lines (DR/CR)' → ย้ายไป C9 (seed สร้าง lines สมดุล DR=CR ≥14 บรรทัด ห้ามล็อก 0)
//   • 'Unit' / 'SalesUnit' → ย้ายไป B-009 pending (84 generate vs persist ยังไม่ตัดสิน)
//   เหลือ 6 ตัวที่ §สรุป ยืนยัน 0 โดยไม่ขัด C-decision / §0 กฎ 3
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

// Unit / SalesUnit (B-009 — รอ Wei ตอบ) — sales-process.jsx `units` generate 84 (code+status)
//   ทุก reload; §สรุป บอก "ไม่มี record" แต่ §0 กฎ 3 สั่ง seed ต้อง persist
//   (regenerate ทุก reload = กลไก mock ห้ามลอก) → ห้ามล็อกค่า (84 หรือ 0) เอง
//   assertion เป็น it.todo ผูก B-009 จนกว่า Wei จะตอบ (84 | 0+runtime | Wei กำหนด)
const B009_PENDING_ENTITIES = ['Unit', 'SalesUnit']; // ชุด 84 ยูนิตเดียวกัน

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
describe('Seed fixture — expected record counts (§สรุป)', () => {
  it.each(SEED_COUNTS)('$group · $entity = $expected', (c) => {
    // fixture-consistency: จำนวน record เป็นจำนวนเต็มไม่ติดลบ
    expect(Number.isInteger(c.expected)).toBe(true);
    expect(c.expected).toBeGreaterThan(0);
    // ต้องมี citation ต้นทางเสมอ (กันค่าที่ไม่ได้ถอดจาก §สรุป)
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
});

describe('Seed fixture — Notification (3 ชุด)', () => {
  it('มี 3 ชุด · จำนวน [5,7,10]', () => {
    expect(NOTIFICATION_SETS).toEqual([5, 7, 10]);
    expect(NOTIFICATION_SETS.reduce((a, b) => a + b, 0)).toBe(22);
  });
});

describe('Seed fixture — entity ไม่มี record (expected 0)', () => {
  it.each(NO_RECORD_ENTITIES)('%s → 0 record', (name) => {
    expect(typeof name).toBe('string');
  });
  it('มี 6 entity ไม่มี record (9 เดิม − JV lines − Unit − SalesUnit → ย้ายไป C9/B-009)', () => {
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

describe('Seed fixture — Unit/SalesUnit persistence (B-009 pending)', () => {
  it('บันทึกว่า Unit/SalesUnit ค้างคำตัดสิน B-009 — ไม่ล็อกค่า', () => {
    expect(B009_PENDING_ENTITIES).toEqual(['Unit', 'SalesUnit']);
  });
  it.todo('Unit persist count = ? (รอ B-009: 84 ตาม generator | 0 + backend generate runtime | Wei กำหนด)');
  it.todo('SalesUnit persist count = ? (รอ B-009 — ผูกชุด 84 ยูนิตเดียวกัน `units` sales-process.jsx:24)');
});

describe('wat/ — คนละผลิตภัณฑ์ (§0 กฎ 5, ไม่ seed เข้า Juneflow)', () => {
  it('บันทึกครบ 10 entity ของ wat/ (reference-only)', () => {
    expect(Object.keys(WAT_COUNTS).length).toBe(10);
  });
});

// --- hookup เข้า seed จริง (รันเมื่อ P0-BE-10 done) --------------------------
describe.todo('Seed fixture — against real seed (P0-BE-10)', () => {
  // it.each(SEED_COUNTS): const n = await countRows(entityTable(c.entity));
  //   expect(n).toBe(c.expected)   // Package ต้อง = 4 (C1)
  // it.each(NO_RECORD_ENTITIES): expect(await countRows(table)).toBe(0)
  // C9 JV lines: for each JV book → lines.length ≥ 2 · ΣDR = ΣCR · total lines ≥ 14
  // B-009 Unit/SalesUnit: assert เมื่อ Wei ตอบ (ยังห้ามล็อกค่า)
  // wat/ tables ต้องไม่อยู่ใน Juneflow schema เลย (§0 กฎ 5)
});
