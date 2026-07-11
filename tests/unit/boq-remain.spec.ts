/**
 * G3 · ตัด remain BOQ — expected-first
 *
 * Spec: docs/handoff/data-dictionary.html
 *         (BOQItem.code,name,cat,qty,unit,price,cc_id · "cat: M วัสดุ | L ค่าแรง | S เหมา · remain_qty ตัดเมื่อเปิด PR")
 *       docs/handoff/FUNCTIONS.md (openBOQtoPR: แยก Material→PR, Subcon→PR-Subcon, mark "เปิด PR แล้ว" ตัด remain)
 *
 * กติกา (จาก spec):
 *   - remain_qty เริ่ม = qty
 *   - เปิด PR อ้าง BOQ item ปริมาณ q → remain_qty -= q
 *   - ห้ามตัดเกินคงเหลือ: remain_qty ต้อง ≥ 0 (สั่ง PR เกิน remaining = ปฏิเสธ/กันไว้)
 *   - cat: M (วัสดุ)→PR material · S (เหมา)→PR-Subcon · L (ค่าแรง)
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected (tests/CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

export const BOQ_CAT = { M: 'material', L: 'labor', S: 'subcon' } as const;

// PR route ตาม cat (openBOQtoPR): M→PR(วัสดุ) · S→PR-Subcon
export const CAT_TO_PR: Record<keyof typeof BOQ_CAT, 'PR' | 'PR-Subcon' | null> = {
  M: 'PR',
  S: 'PR-Subcon',
  L: null, // ค่าแรง — ไม่แตกเป็น PR ในกติกา openBOQtoPR (แยกเฉพาะ Material/Subcon)
};

export interface RemainCase {
  title: string;
  qty: number;
  prDraws: number[]; // ปริมาณที่แต่ละ PR ดึงไป (ตามลำดับ)
  expectedRemain: number;
  expectRejectLastDraw?: boolean; // draw สุดท้ายเกินคงเหลือ → ต้องถูกปฏิเสธ
}

export const REMAIN_CASES: RemainCase[] = [
  { title: 'qty 100 · เปิด PR 30 → remain 70', qty: 100, prDraws: [30], expectedRemain: 70 },
  { title: 'qty 100 · PR 30 + 20 → remain 50', qty: 100, prDraws: [30, 20], expectedRemain: 50 },
  { title: 'qty 100 · PR 100 → remain 0', qty: 100, prDraws: [100], expectedRemain: 0 },
  { title: 'qty 100 · PR 60 แล้วขอ 60 อีก → เกิน กันไว้ remain คง 40',
    qty: 100, prDraws: [60, 60], expectedRemain: 40, expectRejectLastDraw: true },
];

/** oracle จาก spec สำหรับยืนยัน fixtures เอง */
function specRemain(c: RemainCase): number {
  let remain = c.qty;
  for (const d of c.prDraws) {
    if (d <= remain) remain -= d; // เกินคงเหลือ = ปฏิเสธ (ไม่ตัด)
  }
  return remain;
}

// ---------------------------------------------------------------------------
describe('BOQ remain cut — spec fixtures', () => {
  it.each(REMAIN_CASES)('$title', (c) => {
    expect(specRemain(c)).toBe(c.expectedRemain);
    expect(c.expectedRemain).toBeGreaterThanOrEqual(0);
    expect(c.expectedRemain).toBeLessThanOrEqual(c.qty);
  });

  it('cat mapping ตรง dictionary: M=material · L=labor · S=subcon', () => {
    expect(BOQ_CAT).toEqual({ M: 'material', L: 'labor', S: 'subcon' });
  });

  it('PR routing: M→PR · S→PR-Subcon · L ไม่แตก PR', () => {
    expect(CAT_TO_PR.M).toBe('PR');
    expect(CAT_TO_PR.S).toBe('PR-Subcon');
    expect(CAT_TO_PR.L).toBeNull();
  });
});

// --- hookups เข้า business logic จริง ---------------------------------------
describe.todo('BOQ remain — against real logic', () => {
  // สร้าง BOQItem qty=100 → openBOQtoPR(30) → expect item.remain_qty === 70
  // openBOQtoPR(qty > remain_qty) → throw / reject (remain_qty คงเดิม)
  // Material line → PR · Subcon line → PR-Subcon
});
