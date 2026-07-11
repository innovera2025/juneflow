/**
 * G3 · Quota — expected-first
 *
 * Spec: docs/extract/PACKAGE-RULES.md §1 (limits ต่อแพ็กเกจ), §5 (aiQuota)
 *       PLAN.md §5 (quota → 402 QUOTA_EXCEEDED + upgrade_url ที่ middleware)
 *       docs/handoff/FUNCTIONS.md (Global rule #5: โควต้า/เมนูตรวจที่ middleware → 402 + upgrade_url)
 *
 * กติกา (จาก spec):
 *   - limit = limits ของแพ็กเกจ tenant · limit < 0 = ไม่จำกัด (∞)
 *   - อนุญาต request เมื่อ used < limit (หรือ limit < 0) · used ≥ limit → 402 QUOTA_EXCEEDED + upgrade_url
 *   - aiQuota: ถ้าไม่มีแพ็กเกจ default limit = 50
 *   - chip color: unlimited=ok · left=0=danger · left ≤ 5=warn · อื่น=brand
 *
 * ห้ามอ่าน implementation ก่อนเขียน expected (tests/CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

// limits ต่อแพ็กเกจ (PACKAGE-RULES §1 — ค่า -1 = ไม่จำกัด)
export const PKG_LIMITS = {
  starter: { projects: 2, users: 5, storage_gb: 20, ai_per_month: 10 },
  pro: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
  business: { projects: 30, users: 60, storage_gb: 300, ai_per_month: 200 },
  enterprise: { projects: -1, users: -1, storage_gb: 1000, ai_per_month: -1 },
} as const;

export const AI_DEFAULT_LIMIT = 50; // §5: ไม่มีแพ็กเกจ = 50

export interface QuotaCase {
  title: string;
  limit: number; // -1 = ไม่จำกัด
  used: number;
  expectedAllowed: boolean; // request ถัดไปผ่านไหม
  expectedStatus: 200 | 402;
}

export const QUOTA_CASES: QuotaCase[] = [
  { title: 'starter ai 10 · used 9 → ผ่าน', limit: 10, used: 9, expectedAllowed: true, expectedStatus: 200 },
  { title: 'starter ai 10 · used 10 → 402', limit: 10, used: 10, expectedAllowed: false, expectedStatus: 402 },
  { title: 'pro ai 50 · used 18 → ผ่าน', limit: 50, used: 18, expectedAllowed: true, expectedStatus: 200 },
  { title: 'business ai 200 · used 200 → 402', limit: 200, used: 200, expectedAllowed: false, expectedStatus: 402 },
  { title: 'enterprise ai ∞ (-1) · used 9999 → ผ่านเสมอ', limit: -1, used: 9999, expectedAllowed: true, expectedStatus: 200 },
];

/** oracle จาก spec */
function specAllowed(limit: number, used: number): boolean {
  if (limit < 0) return true; // ไม่จำกัด
  return used < limit;
}

// chip color (§5)
export type ChipColor = 'ok' | 'danger' | 'warn' | 'brand';
export function specChipColor(limit: number, used: number): ChipColor {
  if (limit < 0) return 'ok'; // ไม่จำกัด
  const left = limit - used;
  if (left <= 0) return 'danger';
  if (left <= 5) return 'warn';
  return 'brand';
}

export const CHIP_CASES: Array<{ limit: number; used: number; color: ChipColor }> = [
  { limit: -1, used: 100, color: 'ok' },
  { limit: 10, used: 10, color: 'danger' },
  { limit: 10, used: 6, color: 'warn' }, // left 4
  { limit: 10, used: 5, color: 'warn' }, // left 5
  { limit: 50, used: 18, color: 'brand' }, // left 32
];

// ---------------------------------------------------------------------------
describe('Quota gate — spec fixtures', () => {
  it.each(QUOTA_CASES)('$title', (c) => {
    expect(specAllowed(c.limit, c.used)).toBe(c.expectedAllowed);
    expect(c.expectedStatus).toBe(c.expectedAllowed ? 200 : 402);
  });

  it('limits table ตรง PACKAGE-RULES §1 (ai_per_month)', () => {
    expect(PKG_LIMITS.starter.ai_per_month).toBe(10);
    expect(PKG_LIMITS.pro.ai_per_month).toBe(50);
    expect(PKG_LIMITS.business.ai_per_month).toBe(200);
    expect(PKG_LIMITS.enterprise.ai_per_month).toBe(-1);
  });

  it('ไม่มีแพ็กเกจ → ai default limit = 50', () => {
    expect(AI_DEFAULT_LIMIT).toBe(50);
  });
});

describe('Quota chip color — §5', () => {
  it.each(CHIP_CASES)('limit=$limit used=$used → $color', (c) => {
    expect(specChipColor(c.limit, c.used)).toBe(c.color);
  });
});

// --- hookups เข้า business logic จริง (P0-BE-13 middleware) ------------------
describe.todo('Quota — against real middleware', () => {
  // used ≥ limit → response 402 body { code:'QUOTA_EXCEEDED', upgrade_url }
  // limit < 0 (enterprise) → ผ่านเสมอ ไม่มี 402
});
