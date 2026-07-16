# Overnight Autonomous Work Plan (orch-A)

> เขียน 2026-07-17 · Wei review เช้าพรุ่งนี้ · ultracode ON
> **กติกากลางคืน (autonomous-safe):** ทุกอย่างลง **dev เท่านั้น** (verified · ไม่ promote — main = Wei) · ไม่แตะ sacred โดยไม่มี Wei-approval ที่บันทึกไว้ · ไม่ชน orch-B (qa worktree + live-G5) · แต่ละ execute stream ผ่าน **adversarial-verify Workflow** ก่อน merge · red gate ที่แก้เองไม่ได้ → BLOCKERS + ข้าม (ไม่ฝืน)

## สถานะเข้ากลางคืน
- FLOW-A data-completeness = **merged dev 145dcb8 · audit GO · promote-ready** (รอ Wei รัน promote-batch7.sh)
- orch-B = กำลัง/จะรัน **live-G5 round 4** (real data) — zone แยก ไม่ชน
- Wave-2 (finance) ยังไม่เริ่ม · finance.ts schema มี apBillings/pvs/bankStatements อยู่แล้ว (บางส่วน)

## Survey — 6 stream ที่ทำได้กลางคืน

| # | งาน | ชนิด | deliverable | autonomous? | ชน orch-B? | value | ~เวลา |
|---|---|---|---|---|---|---|---|
| **1** | **migration 0024 FK/composite indexes + N+1 fix** | EXECUTE | migration 0024 (~22 index) + boq.ts:680 N+1 fix → dev | ✅ additive · ไม่มี decision | ❌ (packages/db+apps/api) | 🔴 HIGH (ลบ seq-scan ทั้งระบบ · FLOW-A JOIN เร็วขึ้น) | 1-2h |
| **2** | **FLOW-A hardening (B-085)** | EXECUTE | BOQ revise เขียน version-history · TOCTOU unique-index บน approve · money round server-side · mixed-currency guard → dev | ✅ additive · tests | ❌ | 🟡 MED (polish+correctness) | 1-2h |
| **3** | **Wave-2 RECON + decision packet** (finance AP→PV→bank + gl.projectpl) | RESEARCH | WAVE-2-RECON.md + WAVE-2-COMPLETENESS.md (แบบ FLOW-A · design-forks รอ Wei greenlight เช้า) | ✅ read-only 100% | ❌ | 🔴 HIGH (ปลด Wave-2 ทันทีที่ Wei ตื่น) | 1-2h |
| **4** | **Adversarial bug-hunt (loop-until-dry)** apps/api + apps/web | VERIFY | bug/edge-case findings report + BLOCKERS drafts (verified) | ✅ read-only | ❌ | 🟡 MED-HIGH (จับบั๊กก่อน prod) | 2-4h |
| **5** | **Wave-2 backend groundwork** (เฉพาะส่วน additive ไม่มี fork) | EXECUTE (gated on #3) | AP/PV additive handlers/migration บน feature branch (merge เฉพาะที่ verified เต็ม · ไม่งั้นค้าง review เช้า) | ⚠️ เฉพาะ no-decision parts | ❌ | 🟡 MED (เร่ง Wave-2) | 2-3h |
| **6** | **Morning report** | REPORT | MORNING-REPORT.md — สรุปทุก stream · gate status · สิ่งที่รอ Wei (decisions/promote/greenlight) | ✅ | ❌ | — (สรุป) | 0.5h |

## แผนที่แนะนำ (default program ถ้า Wei บอก "ทำเลย")
เดินตามลำดับ · แต่ละ execute stream verify ก่อน merge:
1. **Stream 1** (0024 index) → verify → merge dev
2. **Stream 2** (B-085 harden) → verify → merge dev
3. **Stream 3** (Wave-2 recon) → เขียน packet (ไม่ merge อะไร · แค่ references)
4. **Stream 4** (bug-hunt loop) → findings report (ขนานได้กับ 1-3)
5. **Stream 5** (Wave-2 groundwork) — **เฉพาะถ้า #3 เจอ additive parts ชัด** · ไม่มี fork · verified เต็ม → merge · ไม่งั้นค้าง feature branch ให้ Wei review
6. **Stream 6** — MORNING-REPORT.md ตอนจบ

## สิ่งที่จะ **ไม่** ทำกลางคืน (ต้องรอ Wei)
- ❌ promote → main (Wei-only)
- ❌ B-084 authz-per-action ruling · Wave-2 design forks · group-C greenlight (~13 Q)
- ❌ i18n sacred round (738 keys · Wei-only) · contract edit ที่เป็น new policy
- ❌ แตะ apps/web ports (zone มี · แต่ live-G5 = orch-B กำลังตรวจ · เลี่ยงชน)

## Morning deliverable (เช้ามาตรวจ)
- MORNING-REPORT.md: อะไร merged dev (verified) · gate status ทุก stream · **WAVE-2 packet พร้อม greenlight** · bug-hunt findings · สิ่งที่รอ Wei (promote · Wave-2 forks · B-084)
- dev เขียว · 0 promote · 0 sacred-unapproved · channel sync กับ orch-B
