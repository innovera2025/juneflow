/**
 * G3 · Posting rules (GL / JV double-entry) — expected-first · INVARIANT-ONLY
 *
 * Spec: docs/handoff/data-dictionary.html
 *         (AP/AR·GL·Bank: "ทุกเอกสารเงิน → GLPosting → JV (double entry)")
 *       docs/handoff/FUNCTIONS.md (Global rule #3: เอกสารเงินทุกใบ → GL Posting → JV)
 *       PLAN.md ภาคผนวก C — C9 (JV lines `[{account_id,dr,cr,cc_id,project_id}]` · seed สมดุล DR=CR)
 *
 * ⚠ ขอบเขตที่ spec กำหนด = **double-entry invariant เท่านั้น**:
 *      - ทุก JV มี lines ≥ 2
 *      - แต่ละ line: เป็นฝั่ง DR หรือ CR อย่างใดอย่างหนึ่ง (อีกฝั่ง = 0) · ค่าไม่ติดลบ
 *      - Σ DR = Σ CR (สมดุล)
 *      - ทุก line มี account_id
 *
 * ⚠ **การ map บัญชี debit/credit ต่อชนิดเอกสาร (PV/RV/AP/AR/GR/…) = PLAN.md §11 Open Q #3**
 *    ("รอนักบัญชี validate + กำหนด posting rules ต่อชนิดเอกสาร") — **ยังไม่เขียนค่าคาดหวังระดับ
 *    account mapping. ห้ามเดา.** จะเพิ่มเมื่อ Wei/นักบัญชีตอบ. ไฟล์นี้ทดสอบเฉพาะ invariant ที่ระบุแล้ว.
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected (tests/CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

export interface JvLine {
  account_id: string; // C9
  dr: number;
  cr: number;
  cc_id?: string;
  project_id?: string;
}
export interface Jv {
  ref: string;
  lines: JvLine[];
}

/** invariant checker จาก spec (C9) */
export function isBalanced(jv: Jv): boolean {
  if (jv.lines.length < 2) return false;
  let dr = 0, cr = 0;
  for (const l of jv.lines) {
    if (l.dr < 0 || l.cr < 0) return false; // ห้ามติดลบ
    if (l.dr > 0 && l.cr > 0) return false; // line เดียวลงได้ฝั่งเดียว
    if (!l.account_id) return false;
    dr += l.dr; cr += l.cr;
  }
  return dr === cr && dr > 0;
}

// fixtures โครง JV สมดุล (ไม่ผูก account จริง — ใช้ placeholder account_id)
export const BALANCED_JV: Jv[] = [
  { ref: 'JV-2way', lines: [
    { account_id: 'ACC-A', dr: 10_000, cr: 0 },
    { account_id: 'ACC-B', dr: 0, cr: 10_000 },
  ] },
  { ref: 'JV-3way', lines: [ // เช่น ตั้งหนี้ + VAT
    { account_id: 'ACC-EXP', dr: 100_000, cr: 0 },
    { account_id: 'ACC-VAT', dr: 7_000, cr: 0 },
    { account_id: 'ACC-AP', dr: 0, cr: 107_000 },
  ] },
];

export const UNBALANCED_JV: Jv[] = [
  { ref: 'X-diff', lines: [
    { account_id: 'ACC-A', dr: 10_000, cr: 0 },
    { account_id: 'ACC-B', dr: 0, cr: 9_000 }, // ไม่สมดุล
  ] },
  { ref: 'X-oneline', lines: [{ account_id: 'ACC-A', dr: 10_000, cr: 0 }] }, // < 2 lines
  { ref: 'X-bothsides', lines: [ // line ลงสองฝั่ง
    { account_id: 'ACC-A', dr: 5_000, cr: 5_000 },
    { account_id: 'ACC-B', dr: 0, cr: 0 },
  ] },
];

// ---------------------------------------------------------------------------
describe('Posting rules — double-entry invariant (C9)', () => {
  it.each(BALANCED_JV)('JV สมดุล ผ่าน invariant: $ref', (jv) => {
    expect(isBalanced(jv)).toBe(true);
    const dr = jv.lines.reduce((s, l) => s + l.dr, 0);
    const cr = jv.lines.reduce((s, l) => s + l.cr, 0);
    expect(dr).toBe(cr);
  });

  it.each(UNBALANCED_JV)('JV ผิด invariant ต้องไม่ผ่าน: $ref', (jv) => {
    expect(isBalanced(jv)).toBe(false);
  });

  it('ทุก line ใน JV สมดุลมี account_id', () => {
    for (const jv of BALANCED_JV)
      for (const l of jv.lines) expect(l.account_id).toBeTruthy();
  });
});

// --- pending PLAN.md §11 Open Q #3 (account mapping ต่อชนิดเอกสาร) -----------
describe.todo('Posting account mapping per document type — BLOCKED on Open Q #3', () => {
  // ห้ามเดา account mapping. เพิ่ม cases เมื่อ Wei/นักบัญชี validate posting rules:
  //   PV (WHT), RV, AP ตั้งหนี้ 3-way, AR invoice (VAT), GR, retention posting, ฯลฯ
});

// --- hookups เข้า business logic จริง ---------------------------------------
describe.todo('Posting — against real GL engine', () => {
  // ทุกเอกสารเงินที่ post แล้ว → JV ที่ isBalanced() === true
  // เอกสารที่ทำให้ JV ไม่สมดุล → engine ปฏิเสธการ post
});
