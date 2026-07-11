/**
 * G3 · Retention (เงินประกันผลงาน) — expected-first
 *
 * Spec: docs/handoff/data-dictionary.html (Contract.no,value,retention_pct)
 *       docs/handoff/FUNCTIONS.md (งวดงาน: ผ่าน→อนุมัติจ่าย (หัก retention)→AP)
 *       PLAN.md ภาคผนวก B (Retention ledger) · docs/extract/MOCK-DATA.md (RETENTION_SEED: rate,withheld,returned,due,status)
 *
 * กติกา (จาก spec):
 *   - เมื่องวดงาน "ผ่าน→อนุมัติจ่าย" หัก retention จากยอดงวดก่อนตั้งหนี้ AP
 *   - net (จ่ายจริงเข้า AP) = amount * (1 - retention_pct)
 *   - withheld (เข้า retention ledger) = amount * retention_pct
 *   - invariant: net + withheld = amount (ไม่มีเงินหาย)
 *   - retention ledger ต่อสัญญา/WO: withheld สะสม, returned เมื่อคืน, outstanding = withheld - returned
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected (tests/CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

export interface RetentionCase {
  title: string;
  amount: number; // ยอดงวดที่อนุมัติจ่าย
  retentionPct: number; // Contract.retention_pct (0..1)
  expectedNet: number; // เข้า AP จริง
  expectedWithheld: number; // เข้า retention ledger
}

// ค่า pct ทั่วไปในอุตสาหกรรมก่อสร้าง 5% / 10% (mock RETENTION_SEED ใช้ rate ต่อ WO)
export const RETENTION_CASES: RetentionCase[] = [
  { title: 'งวด 100,000 · retention 5%', amount: 100_000, retentionPct: 0.05,
    expectedNet: 95_000, expectedWithheld: 5_000 },
  { title: 'งวด 250,000 · retention 10%', amount: 250_000, retentionPct: 0.10,
    expectedNet: 225_000, expectedWithheld: 25_000 },
  { title: 'งวด 0 · retention 10% (ไม่มีเงิน = ไม่มีหัก)', amount: 0, retentionPct: 0.10,
    expectedNet: 0, expectedWithheld: 0 },
  { title: 'retention 0% (ไม่หัก) → net = amount', amount: 80_000, retentionPct: 0,
    expectedNet: 80_000, expectedWithheld: 0 },
];

// retention ledger สะสมต่อสัญญา (ภาคผนวก B · RETENTION_SEED: withheld, returned)
export interface LedgerCase {
  title: string;
  withheld: number;
  returned: number;
  expectedOutstanding: number; // ยังค้างคืน
}
export const LEDGER_CASES: LedgerCase[] = [
  { title: 'หัก 25,000 · ยังไม่คืน', withheld: 25_000, returned: 0, expectedOutstanding: 25_000 },
  { title: 'หัก 25,000 · คืนแล้ว 10,000', withheld: 25_000, returned: 10_000, expectedOutstanding: 15_000 },
  { title: 'คืนครบ', withheld: 25_000, returned: 25_000, expectedOutstanding: 0 },
];

// ---------------------------------------------------------------------------
describe('Retention withholding — spec fixtures', () => {
  it.each(RETENTION_CASES)('$title', (c) => {
    // fixture-consistency: net + withheld = amount
    expect(c.expectedNet + c.expectedWithheld).toBe(c.amount);
    // withheld = amount * pct (ปัดตามเงิน — fixtures เลือกค่าให้ลงตัว)
    expect(c.expectedWithheld).toBe(c.amount * c.retentionPct);
    expect(c.expectedNet).toBe(c.amount * (1 - c.retentionPct));
  });

  it('retention_pct อยู่ในช่วง 0..1 ทุก case', () => {
    for (const c of RETENTION_CASES) {
      expect(c.retentionPct).toBeGreaterThanOrEqual(0);
      expect(c.retentionPct).toBeLessThanOrEqual(1);
    }
  });
});

describe('Retention ledger — outstanding', () => {
  it.each(LEDGER_CASES)('$title', (c) => {
    expect(c.withheld - c.returned).toBe(c.expectedOutstanding);
    expect(c.expectedOutstanding).toBeGreaterThanOrEqual(0);
  });
});

// --- hookups เข้า business logic จริง ---------------------------------------
describe.todo('Retention — against real logic', () => {
  // it.each(RETENTION_CASES): const r = approvePeriodPayment({amount, retentionPct});
  //   expect(r.netToAP).toBe(expectedNet); expect(r.withheldToLedger).toBe(expectedWithheld)
  // ledger.outstanding(contractId) = Σ withheld − Σ returned
});
