---
name: loop-task
description: Run exactly ONE round of the Juneflow autonomous loop (PLAN.md §10) - pick one ready task in your own zone from TASKS.md, implement in your worktree, run the 5 gates, then update TASKS.md / REVIEW-QUEUE.md / BLOCKERS.md / journal. Trigger keywords - loop, loop round, autonomous loop, pick task, หยิบ task, รอบลูป, ทำ task ถัดไป, next ready task, TASKS.md, zone agent, loop-runner.
---

# loop-task — รอบลูปอัตโนมัติ 1 รอบ (PLAN.md §10)

> skill นี้คือขั้นตอนมาตรฐานของ "หนึ่งรอบ" ที่ `scripts/loop-runner.sh` เรียกใช้แบบ headless ต่อ agent
> (เพดานรอบ/งบต่อคืนมาจาก `scripts/loop-config.json`) — รันมือก็ใช้ขั้นตอนเดียวกันนี้
> อ่านก่อนเสมอ: `PLAN.md` §0 (Design Fidelity Protocol) + §10 · ราก `CLAUDE.md` · CLAUDE.md ประจำเขตตัวเอง

## ขั้นตอนต่อรอบ (ทำตามลำดับ ห้ามข้าม)

### 1) หยิบ task เดียว

1. เปิด `TASKS.md` → หา task ในตาราง**เขตตัวเองเท่านั้น** (`backend` | `web` | `mobile` | `qa` | `integrations` | `devops` — เขตตาม PLAN.md §8 และ `scripts/loop-config.json`)
2. เงื่อนไขหยิบได้: สถานะ `ready` **และ** dependencies ทุกตัวเป็น `done` แล้ว (หรือ `—`) — dependencies ไม่ครบ = ข้ามไปแถว `ready` ถัดไป
3. หยิบ**หนึ่ง task เท่านั้นต่อรอบ** → เปลี่ยนสถานะในตารางเป็น `doing`
4. ไม่มี task ที่หยิบได้ในเขต → ไม่แก้อะไรเลย จบรอบ (loop-runner จะจบลูปเอง) · ถ้าคิว `ready` ของเขตต่ำกว่า 5 task ให้บันทึกใน journal เพื่อเตือน Wei เติมคิว (PLAN.md §10) — **ห้ามสร้าง task ที่ผูกกับขอบเขต MVP เอง** ([TBD-MVP] — PLAN.md §2)

### 2) อ่าน spec

- อ่านทุกไฟล์ที่คอลัมน์ **spec pointer** ของ task ชี้ ก่อนแตะโค้ด
- หมายเหตุ path (กติกา TASKS.md ข้อ 6): ก่อน `P0-BE-02` เป็น `done` ให้อ่าน `juneflow-extract/*` แทน `docs/extract/*` และ `design_handoff_juneflow/*` แทน `docs/handoff/*`
- งานที่มีจอ UI → ใช้ skill `port-screen` เป็นขั้นตอน implement ต่อจอ

### 3) implement ใน worktree ตัวเอง

- หนึ่ง agent = หนึ่ง worktree = หนึ่งเขต (PLAN.md §8) · ทำงานบน feature branch ของเขต (`feature/<เขต>` ตาม `scripts/loop-config.json`) — **ห้าม commit `main` เด็ดขาด**
- เขียน/แก้ไฟล์ได้เฉพาะ zone paths ของเขตตัวเอง · งานที่ต้องแก้นอกเขต → เขียน `BLOCKERS.md` แล้วข้าม (ห้ามแก้เอง)
- เจอความขัดแย้ง design/spec → เช็คตารางคำตัดสิน `PLAN.md` ภาคผนวก C ก่อน · นอกตาราง → `BLOCKERS.md` **ห้ามเดา ห้ามเลือกเอง** (PLAN.md §0 กฎข้อ 4)

### 4) รัน gates

- รันตามคอลัมน์ **gates ที่ต้องผ่าน** ของ task → ขั้นตอนและคำสั่งอยู่ใน skill `run-gates` (G1–G5 ตาม PLAN.md §9 · task โครงสร้างพื้นฐานใช้เกณฑ์ CI ขั้นต่ำ lint+typecheck+build ตามที่ระบุในแถว)
- งานที่มีจอ → ปิดท้ายด้วย skill `visual-gate` เสมอ (G5)

### 5) ตัดสินผล (PLAN.md §10)

**เขียว (gates ผ่านครบตามแถว task):**
1. commit งานบน feature branch ของเขต → เรียก subagent `diff-reviewer` ตรวจ diff (**ด่าน 4.5 — ต้อง PASS ก่อน push**) — **FAIL = ห้าม push** ถือเป็น gate แดง (นับรวมเพดาน 3 รอบ)
2. diff-reviewer PASS แล้ว → push ให้ CI รัน (`.github/workflows/ci.yml`) — CI เขียว → auto-merge เข้า `dev` อัตโนมัติ (เงื่อนไข merge จึงครบคู่เสมอ: diff-reviewer PASS ก่อน push + CI เขียว)
3. เปลี่ยนสถานะ task ใน `TASKS.md` เป็น `review`
4. เพิ่มหนึ่งแถวใน `REVIEW-QUEUE.md`: `| task id | โมดูล | diff (commit/PR ref) | ภาพเทียบ gallery | วันที่ |` — รูปแบบหลักฐานดูใน skill `run-gates` §การแพ็คหลักฐาน · งานไม่มีจอ → ช่องภาพใส่ `—` พร้อมหลักฐาน gate ที่ใช้แทน
5. เขียน journal (ขั้นที่ 6)

**แดง (gate ใดไม่ผ่าน):**
- วนแก้แล้วรัน gates ใหม่ — **เพดานแข็ง 3 รอบแก้ต่อ task** · ครบ 3 รอบยังแดง → **park**: หยุดพยายาม บันทึกใน journal ว่า gate ใดแดง เหลืออะไร แก้ถึงไหน แล้วจบรอบ (ห้ามหยิบ task ใหม่ต่อในรอบเดียวกัน) — ถ้าสาเหตุแดงคือความขัดแย้ง spec ให้ปฏิบัติแบบ "ตัน" แทน

**ตัน / ความขัดแย้ง spec / ต้องแก้นอกเขต / i18n key ไม่มี / ต้องแตะ sacred file:**
1. เขียน entry ใน `BLOCKERS.md` ตามรูปแบบของไฟล์ (id `B-xxx` ต่อเนื่อง · task ที่ชน · คำถามชัดเจน · ตัวเลือกให้ Wei เลือก)
2. เปลี่ยนสถานะ task เป็น `blocked` แล้ว**ข้ามไป task อื่น** (รอบถัดไป) — **ห้ามเดา ห้ามตัดสินเอง**

### 6) เขียน journal ปิดรอบ

- ต่อท้าย `agents/journal/<เขต>.md` หนึ่ง entry ตาม template หัวไฟล์: **ทำอะไร / ตัดสินใจอะไร / เจออะไร**

## Guardrails (บังคับทุกรอบ)

### Sacred files + hook `protect-files.sh`

- รายการ sacred (PLAN.md §10): `packages/contracts/openapi.yaml` · merged migrations · CLAUDE.md ทุกใบ · CI config (`.github/workflows/*`) · secrets · `docs/extract/*` · `i18n-full.json`
- hook `.claude/hooks/protect-files.sh` จะ**บล็อกการเขียนไฟล์เหล่านี้ด้วย exit code 2** — เจอ block แปลว่าไฟล์นั้น sacred จริง
- ทางออกเดียว: เขียน `BLOCKERS.md` ให้ Wei อนุมัติก่อน — **ห้าม bypass ทุกรูปแบบ** (ห้ามแก้ hook/settings · ห้ามอ้อมไปเขียนผ่าน shell/สคริปต์ · ห้ามลบ-สร้างไฟล์ใหม่แทน)

### No-progress rule

- diff ว่าง 2 รอบติด (loop-runner เทียบ fingerprint ของ repo ก่อน/หลังรอบ) → **park**: task `doing` ของเขตถูกเปลี่ยนเป็น `blocked` แล้วจบลูป — ก่อนปลด block ต้อง review สาเหตุใน journal/BLOCKERS ก่อน

### Branch flow (PLAN.md §10)

```
commit ──(ด่าน 4.5: diff-reviewer PASS = push ได้)──> feature/<zone> ──(CI เขียว = auto-merge)──> dev ──(Wei promote คนเดียว)──> main
```

- `main` ล็อกไว้ — ไม่มี automation ใดแตะ `main` · Wei ตรวจเป็น batch จาก `REVIEW-QUEUE.md` + `BLOCKERS.md` แล้วคลิกเล่นบน dev เทียบ gallery ก่อน promote

## สถานะ task ที่ใช้ได้ (TASKS.md)

`ready` → `doing` → (`review` เมื่อเขียว+merge dev แล้ว) → `done` (Wei promote เท่านั้น) · `blocked` (ตัน/park — ปลดเมื่อ Wei ตอบ blocker หรือ review สาเหตุแล้ว)
