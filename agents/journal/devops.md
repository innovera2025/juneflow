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
