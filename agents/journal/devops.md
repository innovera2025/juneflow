# Journal — DevOps (เขต: `infra/` — ตำแหน่งหมุนเวียน)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 3 · task: P0-DEV-04 (→ review)
- ทำอะไร: หยิบ P0-DEV-04 (branch policy + runbook → `infra/runbook.md`) — eligible แล้วเพราะ dep P0-DEV-02 = `done` (Wei ปิด B-009/B-010 รอบ sync ล่าสุด "Wei answers B-010..013 applied") · DEV-01/DEV-05 ยังติด dep (BE-10/BE-13 ยัง `ready`, DEV-05 รอ DEV-01) จึงเหลือ DEV-04 ตัวเดียวที่หยิบได้. สร้าง `infra/runbook.md` ใหม่ (ก่อนหน้าไม่มีไฟล์นี้): §0 branch policy + runbook 3 เรื่อง (deploy dev / promote main = Wei คนเดียว / restore DB). เนื้อหาถอดจาก skill `run-gates` section "Runbook infra" (แหล่งความจริงที่ `infra/CLAUDE.md` ชี้) แล้ว cross-check กับไฟล์จริง: service names (postgres·redis·migrate-seed·api·worker·web ตรง compose ทั้ง dev/prod) · `ci.yml` job `auto-merge-to-dev` (trigger `feature/**`, main ล็อกด้วย branch protection) · prod compose ไม่มี default password. **ผล gates:** 5 gates โค้ด (schema/contract/unit/E2E/visual) ไม่ applicable กับ runbook markdown ล้วน · verify ในเครื่อง: diff = เฉพาะ `infra/runbook.md` (เขต devops) + bookkeeping (TASKS/REVIEW-QUEUE/journal) · ไม่แตะ sacred (ci.yml/CLAUDE.md ไม่แก้) · secret scan ผ่าน (2 hit = prose อธิบายกฎห้าม secret ไม่ใช่ค่าจริง). GREEN → commit `feature/devops` + set `review` + เพิ่มแถว REVIEW-QUEUE (รอ loop-runner push→ด่าน 4.5).
- ตัดสินใจอะไร: ไม่มีการตัดสิน design/spec — runbook เป็นสำเนาปฏิบัติงานของ skill `run-gates` (ระบุชัดในหัวไฟล์ว่า "ถ้าขัดกันยึด skill + PLAN.md §10") จึงไม่สร้างแหล่งความจริงคู่ขนาน · **ไม่แตะ sacred:** ไม่แก้ `.github/workflows/ci.yml` หรือ CLAUDE.md ใดๆ — runbook อ้างถึงเฉยๆ · gate จริง "ทดสอบ flow feature→dev 1 รอบ" ต้องมี remote (B-010 ตอบ ก: pipeline รันเมื่อมี remote) เหมือน P0-DEV-02 → ถือ artifact-complete รอ Wei review + remote CI.
- เจออะไร: หลัง DEV-04 เข้า review เขต devops เหลือ DEV-01/DEV-05 ที่ยังติด dep backend (BE-10 seed, BE-13 Fastify skeleton — ทั้งคู่ยัง `ready`). **เตือน Wei/backend:** ปิด BE-10 + BE-13 จะปลด DEV-01 (compose dev) → ปลด DEV-05 (prod compose skeleton) เดินเขต devops ต่อได้ · หมายเหตุ: `infra/docker-compose.yml` + `docker-compose.prod.yml` มีอยู่บนดิสก์แล้ว (uncommitted จากรอบก่อน?) แต่ task DEV-01/DEV-05 ยัง `ready` — agent รอบหน้าตรวจว่า compose ครบ gate หรือยังก่อน implement.

## 2026-07-12 · รอบที่ 2 · task: P0-DEV-03 (→ blocked)
- ทำอะไร: หยิบ P0-DEV-03 (`.github/CODEOWNERS`) — เป็น task เดียวในเขต devops ที่ dependencies ครบ (P0-BE-01 `done`) และยัง `ready` · devops อื่นติด dep: DEV-01 รอ BE-10+BE-13, DEV-05 รอ DEV-01, DEV-04 รอ DEV-02 · DEV-02 `blocked` แล้ว (รอบ 1). ตรวจ artifact: `.github/CODEOWNERS` **มีอยู่แล้ว + committed (foundation commit 0b66192 / B-006) + ครบตาม gate เนื้อหา** — ครอบ sacred §10 ครบชุด: openapi.yaml · packages/db/drizzle (merged migrations) · `**/CLAUDE.md` · `/.github/` (CI config) · secrets (อธิบายว่าห้ามมีใน repo ทุกกรณี) · docs/extract · i18n-full.json (+ PLAN.md) · zone ownership ครบ 6 เขตตาม §8 · sacred block วางท้ายให้ last-match-wins ถูกต้อง. working tree สะอาด (ไม่มี diff).
- ตัดสินใจอะไร: **STUCK/sacred-file → ไม่ตัดสินเอง.** `.github/**` เป็น sacred เต็มโฟลเดอร์ — hook `protect-files.sh` (บรรทัด 107 `/.github|/.github/*`) บล็อกทุกการเขียน exit 2 → loop แตะไฟล์ไม่ได้ และไม่มีอะไรให้เขียน/commit เพราะ artifact ครบแล้ว. เหตุเดียวกับ DEV-02 และ **B-009 (รอ Wei ตอบ) ครอบ DEV-03 ไว้ชัดเจนอยู่แล้ว** (คอลัมน์ task = "P0-DEV-02 ... + P0-DEV-03") พร้อม 3 ตัวเลือก (ก มark done / ข SACRED_OVERRIDE=wei-approved:B-009 ให้ regen+verify / ค รอ remote CI) → **ไม่สร้าง blocker ซ้ำ** · set P0-DEV-03 = `blocked` ผูกกับ B-009.
- เจออะไร: เขต devops ตอนนี้ **ไม่เหลือ task ที่ทั้ง dep ครบ + ไม่ใช่ sacred/`.github`** — DEV-02/DEV-03 sacred (blocked, รอ B-009), DEV-01/04/05 dep ยังไม่ครบ. คิว `ready` เขต devops ต่ำกว่า 5 (เหลือ DEV-01/04/05 ที่ทั้งหมดติด dep) — **เตือน Wei (PLAN.md §10):** เขตนี้จะเดินต่อได้เมื่อ (1) Wei ปิด B-009 (ปลด DEV-02→DEV-04) และ (2) backend ปิด BE-10/BE-13 (ปลด DEV-01→DEV-05). ระหว่างนี้ devops ไม่มีงานหยิบได้เพิ่ม.

## 2026-07-12 · รอบที่ 1 · task: P0-DEV-02 (→ blocked)

- ทำอะไร: หยิบ P0-DEV-02 (`.github/workflows/ci.yml`) เป็น task เดียวในเขต devops ที่ dependencies ครบ (P0-BE-01 `done`) — task devops อื่นติด dep ที่ยังไม่ `done`: DEV-01/DEV-05 รอ BE-10+BE-13, DEV-04 รอ DEV-02 · ตรวจ workspace: `.github/workflows/ci.yml` (mirror 5 gates ครบ Stage 1–6, trigger `dev`, main ล็อก) และ `.github/CODEOWNERS` (ครอบ sacred §10 ครบ) **มีอยู่แล้ว + committed + ตรง gate เนื้อหา** จาก foundation commit (B-006) · working tree สะอาด (ไม่มีอะไรให้ commit)
- ตัดสินใจอะไร: **ไม่ตัดสินเอง → escalate B-009.** `.github/**` เป็น sacred เต็มโฟลเดอร์ (hook `protect-files.sh` บล็อกทุกการเขียน) — loop แตะไฟล์ไม่ได้ และไม่มีอะไรให้เขียน/commit เพราะ artifact ครบแล้ว · gate ของ DEV-02 = "pipeline รันผ่านบน branch ทดสอบ" ยังต้องใช้ remote CI ที่ B-006 ระบุว่าคืนนี้ไม่มี · จึงเป็น STUCK/sacred-file → เปิด B-009 (ครอบทั้ง DEV-02 + DEV-03 ที่ติดกำแพงเดียวกัน) เสนอ 3 ทางเลือกให้ Wei · set P0-DEV-02 = `blocked` (task ที่หยิบรอบนี้) · **ไม่แตะสถานะ DEV-03** (หยิบได้ 1 task/รอบ) แต่ flag ไว้ใน B-009 ว่าเหตุเดียวกัน เพื่อ Wei ปิดพร้อมกัน
- เจออะไร: เขต devops ตอนนี้ **ไม่มี task ที่ทั้ง (a) dep ครบ และ (b) ไม่ใช่ sacred/`.github`** — DEV-02/DEV-03 เป็น sacred, DEV-01/04/05 dep ยังไม่ครบ · หลัง Wei ตอบ B-009 (แนะทางเลือก ก: mark DEV-02/DEV-03 `done`) จะปลด DEV-04 และเดินเขตต่อได้ · คิว `ready` เขต devops เหลือน้อย — DEV-02 ถูกกันเป็น `blocked` แล้ว เหลือ DEV-01/03/04/05 ที่ทั้งหมดติด dep หรือ sacred → Wei ควรพิจารณา B-009 เป็นตัวปลดล็อกเขตนี้

## 2026-07-11 · harness delta (คำสั่งตรงจาก Wei) · task: —

- ทำอะไร: ทำ delta harness ตามคำสั่ง Wei — เพิ่ม hooks 4 ตัว (`block-dangerous-bash` · `format-changed-file` · `quick-verify` · `notify`) + skills 2 ตัว (`debug-protocol` · `merge-worktree`) + subagent `log-reader` · ลงทะเบียนทุก hook ใน `.claude/settings.json` (PreToolUse/PostToolUse/Stop) · เพิ่ม `pototype/` `design_handoff_juneflow/` `juneflow-extract/` ลง `.gitignore` (แหล่งภายใน = docs/handoff + docs/extract เท่านั้น) · แก้ CLAUDE.md 3 ใบ (root: บล็อก Design Fidelity เป็นหัวข้อแรก · web/mobile: กฎห้ามเริ่ม task UI โดยไม่เปิดอ่าน .jsx ต้นทางในรอบนั้น) ภายใต้ B-004 · รัน adversarial verification (workflow 5 agents) แล้ว harden ตามผล: `block-dangerous-bash` ตรวจแบบ per-segment ปิด bypass `/bin/rm -rf` · `rm "-rf"` · `push origin "main"` และเลิก block คำสั่งปกติ (`grep process.env/import.meta.env` · คำว่า secrets/main ในข้อความ commit · `tar -rf`+`rm` คนละ segment) · `protect-files` เทียบ path แบบ lowercase (ปิด bypass บน case-insensitive APFS เช่น `POTOTYPE/` `Claude.md` `PLAN.MD`) + ใช้ realpath กัน symlink + ตรวจ `SACRED_OVERRIDE` ทั้งสตริงกันค่าหลายบรรทัด · `notify` CLI mode ไม่ drain stdin (เลิกค้างรอ EOF) — regression battery 55 เคสผ่านครบ
- ตัดสินใจอะไร: **บันทึกเหตุผลการเบี่ยงจาก manifest รอบก่อน (bootstrap 6 ก.ค.):** manifest v3 กลุ่ม 6 กำหนดเฉพาะ*จำนวน*องค์ประกอบ (5 hooks + 4 skills + 3 subagents) โดยไม่ระบุรายชื่อ — orchestrator จึงเลือกชื่อ/ชุดเอง (`protect-files` `zone-guard` `i18n-guard` `block-main-commit` `journal-append` + skills/subagents ตามที่อยู่บนดิสก์) แล้วบันทึกขอยืนยันย้อนหลังใน B-003 แทนที่จะเปิด blocker ก่อนลงมือ · **กฎต่อจากนี้:** การเบี่ยงจาก spec/manifest ทุกกรณีต้องผ่าน `BLOCKERS.md` ก่อนลงมือเสมอ (PLAN.md §0 ข้อ 4) — delta รอบนี้บันทึกเป็น B-004 (อนุมัติโดยตัวคำสั่ง Wei) · event notify "gate แดงครบ 3 รอบ" ต้องมี call-site ใน `scripts/loop-runner.sh` ซึ่งอยู่นอกรายการ delta → ไม่แตะเอง เปิด B-005 รอ Wei
- เจออะไร: `protect-files.sh` มีกฎ block `pototype/**` (รวม `juneflow-extract/**` `design_handoff_juneflow/**`) อยู่แล้วตั้งแต่ bootstrap — ข้อ B.5 ของ delta จึงไม่ต้องแก้ ยืนยันด้วยการทดสอบจริง (Edit `pototype/chrome.jsx` ถูก block) · `loop-runner.sh` ยังไม่ export `LOOP_AGENT` → hooks ที่ key ตาม env นี้ (`zone-guard` `journal-append` `notify` โหมด Stop) เงียบในรัน headless เว้นแต่ตั้ง env ตอนสั่งรัน (รวมใน B-005) · เครื่องยังไม่มี prettier/eslint/dart/turbo binary (ยังไม่ `pnpm install`) — hooks `format-changed-file`/`quick-verify` ออกแบบให้ fail-open เงียบจนกว่า toolchain พร้อม · hooks ใหม่ใน settings.json มีผลกับ session ใหม่ (session ที่รันอยู่ snapshot hooks ตอนเริ่ม)

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต devops มี 5 task ใน `TASKS.md` (P0-DEV-01 ถึง P0-DEV-05) สถานะ `ready` — เป้าหมาย Phase 0 ของเขต: `docker compose up` เดียวได้ระบบ + seed และ CI ครบ stages ตาม 5 gates
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: `ci.yml` และ `CODEOWNERS` จะกลายเป็น sacred files หลัง merge (PLAN.md §10) — แก้ภายหลังต้องผ่าน blocker เท่านั้น · CODEOWNERS ต้องล็อก sacred ครบชุด: OpenAPI · merged migrations · CLAUDE.md ทุกใบ · CI config · secrets · `docs/extract/*` · i18n-full.json · ห้าม secrets ใน repo ทุกกรณี (กลุ่ม 2.6)
- 2026-07-11T18:11:47Z loop round ended (agent: devops)

## 2026-07-12 01:11 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 1/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต devops — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $0.5120/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)
- 2026-07-11T18:51:27Z loop round ended (agent: devops)

## 2026-07-12 01:51 · loop-runner · รอบที่ 1/10 · task: P0-DEV-02
- ทำอะไร: รัน claude headless 1 รอบ · task P0-DEV-02 → สถานะ blocked · ค่าใช้จ่ายรอบนี้ $1.4001315 (สะสม $1.4001/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:54:55Z loop round ended (agent: devops)

## 2026-07-12 01:54 · loop-runner · รอบที่ 2/10 · task: P0-DEV-03
- ทำอะไร: รัน claude headless 1 รอบ · task P0-DEV-03 → สถานะ blocked · ค่าใช้จ่ายรอบนี้ $1.5033025 (สะสม $2.9034/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:55:42Z loop round ended (agent: devops)

## 2026-07-12 01:55 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 3/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต devops — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $3.2079/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)
- 2026-07-12T00:19:13Z loop round ended (agent: devops)

## 2026-07-12 07:19 · loop-runner · รอบที่ 1/10 · task: P0-DEV-04
- ทำอะไร: รัน claude headless 1 รอบ · task P0-DEV-04 → สถานะ review · ค่าใช้จ่ายรอบนี้ $1.7014614999999997 (สะสม $1.7015/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T00:19:59Z loop round ended (agent: devops)

## 2026-07-12 07:20 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 2/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต devops — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $2.4851/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)
