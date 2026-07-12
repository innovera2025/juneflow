# infra/runbook.md — Branch policy + Runbook (deploy dev / promote main / restore DB)

> เขต DevOps · task **P0-DEV-04** (Manifest กลุ่ม 2.6) · อ่านคู่กับ `infra/CLAUDE.md` + `PLAN.md` §10
> **แหล่งความจริงของขั้นตอน = skill `run-gates` section "Runbook infra"** — ไฟล์นี้คือสำเนาปฏิบัติงานให้เปิดอ่านเร็วบนเครื่อง dev/prod · ถ้าขัดกัน ให้ยึด skill `run-gates` + `PLAN.md` §10
> **ห้ามมี secret ใดๆ ใน repo** — ค่าเฉพาะเครื่อง (host VPS, credentials, path backup, POSTGRES_*) มาจาก env / secret store เท่านั้น (sacred · PLAN.md §10)

---

## 0. Branch policy (PLAN.md §10)

```
feature/**  →  dev  (auto-merge เมื่อ CI เขียว + diff-reviewer PASS)  →  main  (Wei promote คนเดียว)
```

- **หนึ่ง agent = หนึ่ง worktree = หนึ่งเขต** — commit บน `feature/<zone>` ของตัวเองเท่านั้น · **ห้าม commit `main`**
- **ด่าน 4.5 (diff-reviewer) บังคับก่อน push:** หลัง 5 gates ในเครื่องเขียวครบ ต้องผ่าน subagent `.claude/agents/diff-reviewer.md` (PASS/FAIL) ก่อน push feature branch · **FAIL = ไม่ push ไม่ merge, task กลับ rework** (นับรวมเพดาน 3 รอบ)
- **auto-merge feature→dev:** job `auto-merge-to-dev` ใน `.github/workflows/ci.yml` รันเฉพาะ push บน `feature/**` หลังทุก stage เขียว → merge เข้า `dev` อัตโนมัติ (bootstrap: สร้าง `dev` จาก commit เขียวถ้ายังไม่มี) · เงื่อนไข merge = **CI เขียว + diff-reviewer PASS** ครบคู่เสมอ เพราะ PASS ถูกบังคับก่อน push
- **`main` ถูกล็อก:** ไม่มี automation ใดแตะ `main` — บังคับด้วย GitHub **branch protection** บน `main` · เฉพาะ Wei promote `dev → main` ด้วยมือ
- CI trigger (`ci.yml`): `push` บน `dev` + `feature/**` · `pull_request` base `dev` · stage mirror 5 gates (ดู skill `run-gates` "Mapping กับ CI")
- แก้ `.github/workflows/*` = แตะ sacred file → hook `protect-files.sh` บล็อก (exit 2) → เขียน `BLOCKERS.md` **ห้าม bypass**

---

## 1) Deploy dev

1. บนเครื่อง dev (VPS Singapore — ภาคผนวก A):

   ```bash
   git fetch origin && git checkout dev && git pull --ff-only
   ```

2. เตรียม env: `infra/.env` (git-ignored) ต้องมีค่า `POSTGRES_*` ครบ — **ห้าม commit**
3. ขึ้นระบบทั้งชุด (pg16 + redis + migrate-seed + api + worker + web):

   ```bash
   docker compose -f infra/docker-compose.yml up -d --build --wait
   ```

   - service `migrate-seed` เป็น one-shot: migrate + seed แล้วจบ (exit 0) — `api`/`worker` รอ service นี้ · ได้ระบบ seed พร้อมคลิกเทียบ gallery ใน `up` เดียว (milestone Phase 0)
4. ตรวจ: health endpoint ของ `api` ตอบปกติ · เปิด `web` คลิกจอหลักเทียบ gallery
5. มีปัญหา → **rollback**: `git checkout <SHA เขียวก่อนหน้า>` แล้ว `up -d --build --wait` ใหม่ · บันทึกเหตุการณ์ลง `agents/journal/devops.md`

---

## 2) Promote main (Wei คนเดียวเท่านั้น)

> **agent ห้ามทำขั้นตอนนี้** — บันทึกไว้เพื่อให้ Wei ใช้ · `main` มี branch protection ล็อกไว้

1. อ่าน `REVIEW-QUEUE.md` + `BLOCKERS.md` เป็น batch
2. คลิกเล่นบน `dev` เทียบ gallery ทีละแถว (ไล่จากแถวเก่าสุด)
3. **ผ่าน** → merge `dev → main` (มือ — ไม่มี automation แตะ main) → เปลี่ยนสถานะ task เป็น `done` ใน `TASKS.md` → ลบแถวออกจากคิว
4. **ไม่ผ่าน** → สร้าง rework task ใน `TASKS.md` (สถานะ `ready` ระบุสิ่งที่ต้องแก้) → ลบแถวออกจากคิว
5. Deploy prod จาก `main`:

   ```bash
   docker compose -f infra/docker-compose.prod.yml up -d --build --wait
   ```

   (env จาก host เท่านั้น — `infra/docker-compose.prod.yml` ไม่มี default password ฝังใน repo)

---

## 3) Restore DB

1. หยุดตัวเขียนก่อนกู้ (dev ใช้ไฟล์ dev · prod ใช้ไฟล์ prod):

   ```bash
   docker compose -f infra/docker-compose.yml stop api worker
   ```

2. เลือกไฟล์ backup ล่าสุดที่ต้องการ (path / รอบ backup ตาม env ของ host)
3. กู้เข้า service `postgres`:

   ```bash
   docker compose -f infra/docker-compose.yml exec -T postgres \
     pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < <backup-file>
   ```

   (backup แบบ plain SQL ใช้ `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -` แทน)
4. start กลับ:

   ```bash
   docker compose -f infra/docker-compose.yml start api worker
   ```

   → ตรวจ health endpoint + spot-check จำนวน record เทียบ `docs/extract/MOCK-DATA.md` §สรุป (กรณี dev ที่กู้จาก seed baseline)
5. บันทึกเหตุการณ์ (เวลา · ไฟล์ backup ที่ใช้ · ผลตรวจ) ลง `agents/journal/devops.md` · สาเหตุที่ทำให้ต้อง restore → พิจารณาเปิด `BLOCKERS.md` แจ้ง Wei
