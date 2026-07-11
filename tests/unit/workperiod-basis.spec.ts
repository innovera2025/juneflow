/**
 * G3 · งวดงาน (WorkPeriod) — 4 basis · expected-first
 *
 * Spec: docs/handoff/data-dictionary.html (WorkPeriod.seq,basis,target,pct,amount,status)
 *       PLAN.md ภาคผนวก C — C2 (เพิ่ม `unit` เป็น basis ที่ 4), C3 (state machine)
 *       docs/extract/MOCK-DATA.md §SubconContract (method percent/distance/milestone/unit)
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected (tests/CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

// --- basis enum (dictionary 3 + C2 unit = 4) --------------------------------
// dictionary: percent | distance(m) | milestone  ·  C2: + unit (เหมาต่อหลัง)
export const BASIS = ['percent', 'distance', 'milestone', 'unit'] as const;
export type Basis = (typeof BASIS)[number];

// --- amount per basis (expected formula ต่อ basis) --------------------------
// contractValue = มูลค่าสัญญา · ratePerUnit/qty มาจากงวด (distance/unit) ตาม MOCK-DATA
export interface PeriodCase {
  title: string;
  basis: Basis;
  input: {
    contractValue: number;
    pct?: number; // percent basis: สัดส่วนงานงวดนี้ (0..1)
    perPeriodQty?: number; // distance/unit: ปริมาณงวดนี้
    ratePerUnit?: number; // distance/unit: ราคา/หน่วย
    milestoneAmount?: number; // milestone: มูลค่าคงที่ของหมุดหมาย
  };
  expectedAmount: number;
}

export const AMOUNT_CASES: PeriodCase[] = [
  // percent: amount = contractValue * pct
  { title: 'percent 30% ของสัญญา 1,000,000', basis: 'percent',
    input: { contractValue: 1_000_000, pct: 0.3 }, expectedAmount: 300_000 },
  // distance: amount = perPeriodQty * ratePerUnit  (เช่น ท่อ 100 ม./งวด)
  { title: 'distance 100 ม. × 1,200/ม.', basis: 'distance',
    input: { contractValue: 600_000, perPeriodQty: 100, ratePerUnit: 1_200 }, expectedAmount: 120_000 },
  // unit (เหมาต่อหลัง): amount = perPeriodQty(หลัง) * ratePerUnit
  { title: 'unit 5 หลัง × 80,000/หลัง', basis: 'unit',
    input: { contractValue: 800_000, perPeriodQty: 5, ratePerUnit: 80_000 }, expectedAmount: 400_000 },
  // milestone: amount = มูลค่าคงที่ของหมุดหมาย
  { title: 'milestone มูลค่าคงที่ 250,000', basis: 'milestone',
    input: { contractValue: 1_000_000, milestoneAmount: 250_000 }, expectedAmount: 250_000 },
];

/** oracle จาก spec — ใช้ยืนยันความสอดคล้องของ fixtures เอง (ไม่ใช่ implementation จริง) */
function specExpectedAmount(c: PeriodCase): number {
  switch (c.basis) {
    case 'percent': return c.input.contractValue * (c.input.pct ?? 0);
    case 'distance':
    case 'unit': return (c.input.perPeriodQty ?? 0) * (c.input.ratePerUnit ?? 0);
    case 'milestone': return c.input.milestoneAmount ?? 0;
  }
}

// --- state machine (C3) -----------------------------------------------------
// dictionary/flows: pending → delivered → inspecting → passed → paid
//                                              └ rejected → (แก้) → delivered
// C3 seed map: requested→delivered, accepted→passed
export const STATES = ['pending', 'delivered', 'inspecting', 'passed', 'rejected', 'paid'] as const;
export type PeriodState = (typeof STATES)[number];

export const VALID_TRANSITIONS: Record<PeriodState, PeriodState[]> = {
  pending: ['delivered'],
  delivered: ['inspecting'],
  inspecting: ['passed', 'rejected'],
  rejected: ['delivered'], // แก้ defect แล้วส่งมอบใหม่
  passed: ['paid'], // อนุมัติจ่าย (หัก retention) → AP
  paid: [], // terminal
};

export const SEED_STATE_MAP: Record<string, PeriodState> = {
  requested: 'delivered',
  accepted: 'passed',
};

// ---------------------------------------------------------------------------
describe('WorkPeriod basis — spec fixtures', () => {
  it('มี basis ครบ 4 ค่า (dictionary 3 + C2 unit)', () => {
    expect(BASIS).toEqual(['percent', 'distance', 'milestone', 'unit']);
    expect(new Set(BASIS).size).toBe(4);
  });

  it.each(AMOUNT_CASES)('fixture สอดคล้อง spec: $title', (c) => {
    expect(specExpectedAmount(c)).toBe(c.expectedAmount);
  });

  it('ทุก case มี basis อยู่ในชุด 4 ค่า', () => {
    for (const c of AMOUNT_CASES) expect(BASIS).toContain(c.basis);
  });
});

describe('WorkPeriod state machine — C3', () => {
  it('state set ตรง dictionary (6 ค่า)', () => {
    expect(STATES).toEqual(['pending', 'delivered', 'inspecting', 'passed', 'rejected', 'paid']);
  });

  it('seed map (C3): requested→delivered · accepted→passed', () => {
    expect(SEED_STATE_MAP.requested).toBe('delivered');
    expect(SEED_STATE_MAP.accepted).toBe('passed');
  });

  it('transitions ปลายทางทุกตัวเป็น state ที่ถูกต้อง · paid = terminal', () => {
    for (const targets of Object.values(VALID_TRANSITIONS))
      for (const t of targets) expect(STATES).toContain(t);
    expect(VALID_TRANSITIONS.paid).toEqual([]);
  });
});

// --- hookups เข้า business logic จริง (เมื่อ logic ลง P0-BE-07/09) ------------
describe.todo('WorkPeriod — against real logic', () => {
  // it.each(AMOUNT_CASES): expect(computePeriodAmount(c.input, c.basis)).toBe(c.expectedAmount)
  // reject transition นอก VALID_TRANSITIONS → error
  // paid = terminal (ห้าม transition ต่อ)
});
