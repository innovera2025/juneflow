/**
 * G3 · Approval matrix — expected-first · RULE + example thresholds
 *
 * Spec: docs/handoff/data-dictionary.html
 *         (User/Role: "Role กำหนดสิทธิ์ + ขั้นอนุมัติ (matrix)" · Role.approval_limits json "เพดานอนุมัติต่อชนิดเอกสาร"
 *          · PR.approval_step)
 *       docs/handoff/FUNCTIONS.md (PR: ส่งอนุมัติ "matrix ตามมูลค่า" · Global rule #4:
 *          draft→pending(ขั้นตาม matrix)→approved|rejected)
 *       docs/extract/MOCK-DATA.md (ROLE_PRESETS: 8 role · authLimit + level)
 *
 * กติกา (routing rule ที่ spec กำหนด):
 *   - เอกสารมูลค่า V ชนิด T → route ตาม approval ladder เรียงตาม level
 *   - ต้องมีผู้อนุมัติที่ authLimit ≥ V จึงอนุมัติจบได้ · ถ้าผู้อนุมัติชั้นปัจจุบัน authLimit < V → escalate ชั้นถัดไป
 *   - status: draft → pending (approval_step ไล่ตาม ladder) → approved | rejected
 *
 * ⚠ เพดานจริงต่อ role มาจาก seed ROLE_PRESETS (P0-BE-10) — ค่าใน LADDER ด้านล่างเป็น
 *   **ตัวอย่างเชิงโครงสร้าง** เพื่อทดสอบ rule เท่านั้น ไม่ผูกเป็น expected ตายตัว.
 * ⚠ "approval matrix fix หรือ configurable ต่อบริษัท" = PLAN.md §11 Open Q #2 — ยังไม่ตัดสิน.
 *   spec นี้ทดสอบเฉพาะ routing rule ที่ derive ได้ ไม่ล็อกโครงสร้าง configurable/fixed.
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected · ห้ามตัดสิน Open Q เอง (tests/CLAUDE.md · PLAN.md §0).
 */
import { describe, it, expect } from 'vitest';

// EXAMPLE ladder (โครงสร้างสำหรับทดสอบ rule — ค่าจริงจาก ROLE_PRESETS seed)
export interface Approver { role: string; level: number; authLimit: number }
export const EXAMPLE_LADDER: Approver[] = [
  { role: 'PM', level: 1, authLimit: 100_000 },
  { role: 'Director', level: 2, authLimit: 1_000_000 },
  { role: 'CEO', level: 3, authLimit: -1 }, // -1 = ไม่จำกัด
];

/** routing rule จาก spec: คืนลำดับผู้อนุมัติที่ต้องผ่านจนกว่าจะมี authLimit ≥ amount */
export function specApprovalChain(amount: number, ladder: Approver[]): Approver[] {
  const sorted = [...ladder].sort((a, b) => a.level - b.level);
  const chain: Approver[] = [];
  for (const a of sorted) {
    chain.push(a);
    if (a.authLimit < 0 || a.authLimit >= amount) return chain; // ผู้อนุมัติชั้นนี้อนุมัติจบ
  }
  return chain; // ไม่มีใครพอเพดาน → ต้องผ่านทุกชั้น (เคสนี้ = เกินเพดานสูงสุด → ควร block ที่ business layer)
}

export interface ChainCase {
  title: string;
  amount: number;
  expectedRoles: string[]; // ลำดับ role ที่ต้องอนุมัติ
}
export const CHAIN_CASES: ChainCase[] = [
  { title: '50,000 ≤ PM limit → จบที่ PM', amount: 50_000, expectedRoles: ['PM'] },
  { title: '100,000 = PM limit → จบที่ PM', amount: 100_000, expectedRoles: ['PM'] },
  { title: '500,000 > PM → escalate ถึง Director', amount: 500_000, expectedRoles: ['PM', 'Director'] },
  { title: '5,000,000 > Director → ถึง CEO (∞)', amount: 5_000_000, expectedRoles: ['PM', 'Director', 'CEO'] },
];

// state machine (Global rule #4)
export const DOC_STATES = ['draft', 'pending', 'approved', 'rejected'] as const;
export const DOC_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending'], // ส่งอนุมัติ
  pending: ['approved', 'rejected'], // ผ่าน ladder ครบ = approved · ปฏิเสธ = rejected
  approved: [],
  rejected: ['draft'], // แก้แล้วส่งใหม่
};

// ---------------------------------------------------------------------------
describe('Approval matrix — routing rule (example ladder)', () => {
  it.each(CHAIN_CASES)('$title', (c) => {
    const chain = specApprovalChain(c.amount, EXAMPLE_LADDER).map((a) => a.role);
    expect(chain).toEqual(c.expectedRoles);
  });

  it('ผู้อนุมัติสุดท้ายใน chain มี authLimit เพียงพอ (≥ amount หรือ ∞)', () => {
    for (const c of CHAIN_CASES) {
      const chain = specApprovalChain(c.amount, EXAMPLE_LADDER);
      const last = chain[chain.length - 1];
      expect(last.authLimit < 0 || last.authLimit >= c.amount).toBe(true);
    }
  });

  it('chain เรียงตาม level จากน้อยไปมาก', () => {
    for (const c of CHAIN_CASES) {
      const chain = specApprovalChain(c.amount, EXAMPLE_LADDER);
      const levels = chain.map((a) => a.level);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
  });
});

describe('Approval doc state machine — Global rule #4', () => {
  it('draft→pending→approved|rejected', () => {
    expect(DOC_TRANSITIONS.draft).toEqual(['pending']);
    expect(DOC_TRANSITIONS.pending).toEqual(['approved', 'rejected']);
    expect(DOC_TRANSITIONS.approved).toEqual([]);
    expect(DOC_TRANSITIONS.rejected).toEqual(['draft']);
  });
});

// --- pending Open Q #2 + seed ROLE_PRESETS ----------------------------------
describe.todo('Approval matrix — concrete thresholds from ROLE_PRESETS seed (P0-BE-10)', () => {
  // ผูกค่า authLimit จริงต่อ 8 role · ทดสอบต่อชนิดเอกสาร (Role.approval_limits ต่อ type)
  // Open Q #2 (fix vs configurable ต่อบริษัท) — รอ Wei ก่อน lock โครงสร้าง
});

// --- hookups เข้า business logic จริง ---------------------------------------
describe.todo('Approval — against real routing', () => {
  // submitForApproval(doc{amount,type}) → approval_step ตรง specApprovalChain
  // approve ครบ ladder → status approved · reject → rejected
});
