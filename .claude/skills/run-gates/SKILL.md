---
name: run-gates
description: Run the 5 Done verification gates locally (PLAN.md §9) - schema check, contract tests, unit business logic, E2E Playwright, visual gate - plus the CI stage mapping (.github/workflows/ci.yml), the gate-4.5 diff-reviewer step (after local gates pass, BEFORE pushing the feature branch for auto-merge), REVIEW-QUEUE.md evidence packaging, and the infra runbook (deploy dev / promote main / restore DB). Trigger keywords - run gates, gates, G1 G2 G3 G4 G5, รัน gate, ด่าน, verification, Done definition, CI stages, drizzle check, contract test, vitest, playwright, e2e, diff-reviewer, ด่าน 4.5, runbook, deploy dev, promote main, restore DB.
---

# run-gates — รัน 5 ด่าน Done ในเครื่อง (PLAN.md §9)

> **Done = ผ่านครบทั้ง 5 gates — ขาดข้อใดข้อหนึ่ง = ไม่ done**
> task โครงสร้างพื้นฐานที่ยังไม่แตะ 5 gates → ใช้เกณฑ์ CI ขั้นต่ำตามที่แถว `TASKS.md` ระบุ (lint+typecheck+build)
> ก่อนรัน gate ใดๆ ให้ผ่านขั้นต่ำก่อน: `pnpm run lint && pnpm run typecheck && pnpm run build`

## 5 gates + คำสั่งรันในเครื่อง

### G1 — Schema gate (schema ตรง dictionary + ภาคผนวก B)

- นิยาม: schema ใน `packages/db` ต้องครบทั้ง data-dictionary (~34 entities จาก `docs/handoff/data-dictionary.html` + `erd.html`) **และ** ส่วนขยายบังคับ 14 รายการใน `PLAN.md` ภาคผนวก B — ขาดส่วนใด = ไม่ผ่าน (PLAN.md §6)
- รัน (drizzle-kit check ผ่าน script ของ workspace):

```bash
pnpm --dir packages/db run --if-present migration:check
```

- ห้ามลืม: merged migrations = sacred file — แก้ย้อนหลังต้องผ่าน `BLOCKERS.md` เท่านั้น · คำตัดสิน schema ที่เกี่ยว: C2 (basis ที่ 4 = `unit`) · C4 (e-Tax superset) · C5 (`storage_gb`/`ai_per_month`) · C9 (JV lines DR=CR)

### G2 — Contract test (generate จาก openapi.yaml แล้วผ่านทั้งหมด)

- นิยาม: test generate จาก `packages/contracts/openapi.yaml` (contract เดียวของระบบ — PLAN.md §5) — expected มาจาก contract เท่านั้น ห้ามอ่าน implementation ก่อน (เขต QA)
- รัน:

```bash
pnpm --filter @juneflow/tests test:contract
```

### G3 — Unit business logic (vitest)

- นิยาม: posting rules · ตัด remain BOQ · retention · approval matrix · quota (`402 QUOTA_EXCEEDED` + `upgrade_url`) · งวดงาน 4 basis (รวม `unit` ตาม C2)
- รัน:

```bash
pnpm run --if-present test:unit    # หรือ: pnpm test (turbo run test ทั้ง monorepo)
```

### G4 — E2E Playwright (state machine ตาม flows.html)

- นิยาม: flow ทดสอบต้องเดินตาม state machine + approval matrix ใน `docs/handoff/flows.html` (คำตัดสิน C3: WorkPeriod states ตาม flows/dictionary)
- รัน (ต้องมี dev stack ขึ้นก่อน):

```bash
docker compose -f infra/docker-compose.yml up -d --wait
pnpm --filter @juneflow/tests test:e2e
docker compose -f infra/docker-compose.yml down
```

### G5 — Visual gate

- ใช้ skill **`visual-gate`** ทั้งขั้นตอน (screenshot เทียบ `tests/visual/reference/` ตามเกณฑ์ PLAN.md §0) · คำสั่ง harness:

```bash
pnpm --filter @juneflow/tests test:visual
```

## Mapping กับ CI (`.github/workflows/ci.yml` — sacred file)

ลำดับ stage ใน CI mirror 5 gates (Manifest กลุ่ม 4.3) — รันในเครื่องให้เขียวก่อน push จะได้ไม่เปลือง CI รอบแดง:

| CI stage | gate | คำสั่ง local เทียบเท่า |
|---|---|---|
| Stage 1 — lint + typecheck | ขั้นต่ำ | `pnpm run lint && pnpm run typecheck` |
| Stage 2 — migration check | G1 | `pnpm --dir packages/db run migration:check` |
| Stage 3 — contract tests | G2 | `pnpm --filter @juneflow/tests test:contract` |
| Stage 4 — unit business logic | G3 | `pnpm run test:unit` |
| Stage 5 — E2E (Playwright) | G4 | compose up → `test:e2e` → down |
| Stage 6 — visual gate | G5 | skill `visual-gate` / `test:visual` |
| **ด่าน 4.5 — diff-reviewer** | review gate | รีวิว diff ในเครื่องหลัง gates เขียวครบ **ก่อน push** (ด้านล่าง) |
| auto-merge feature→dev | — | อัตโนมัติเมื่อ CI เขียว (push branch `feature/**` ที่ผ่านด่าน 4.5 แล้วเท่านั้น) |

- CI เขียวเป็นเงื่อนไข auto-merge `feature → dev` · `main` ล็อกให้ Wei promote คนเดียว (PLAN.md §10)
- แก้ `.github/workflows/*` = แตะ sacred file → hook `protect-files.sh` บล็อกด้วย exit code 2 → เขียน `BLOCKERS.md` ห้าม bypass

## ด่าน 4.5 — diff-reviewer (รันหลัง gates เขียวครบ ก่อน push)

- subagent `diff-reviewer` (`.claude/agents/`) ตรวจ diff ของ task **หลัง gates ในเครื่องเขียวครบ และก่อน push feature branch** — PASS จึง push ได้ · push แล้ว CI เขียว = auto-merge เข้า `dev` อัตโนมัติ (`.github/workflows/ci.yml`) — เงื่อนไข merge **CI เขียว + diff-reviewer PASS** จึงครบทั้งคู่เสมอ เพราะ PASS ถูกบังคับก่อน push
- สิ่งที่ diff-reviewer ตรวจ: diff อยู่ในเขต (zone) ของ agent เท่านั้น · ไม่แตะ sacred files · ไม่มีกลไก mock หลุดเข้า production (PLAN.md §0 กฎข้อ 3) · ไม่มี string นอก i18n key / ค่า style hardcode · ไม่มี model เขียนมือแทน codegen · ไม่มี secret ใน diff
- ผล **FAIL** → ถือเป็น gate แดง: **ห้าม push** กลับไปแก้ (นับรวมในเพดาน 3 รอบของ skill `loop-task`) — ห้าม merge เอง ห้ามข้ามด่าน

## การแพ็คหลักฐานลง REVIEW-QUEUE.md

เมื่อทุกด่านเขียว + auto-merge `dev` แล้ว เพิ่มหนึ่งแถวในตาราง `REVIEW-QUEUE.md`:

```
| task id | โมดูล | diff | ภาพเทียบ gallery | วันที่ |
```

- **task id** — id จาก `TASKS.md` (เปลี่ยนสถานะเป็น `review` พร้อมกัน)
- **โมดูล** — โมดูล/เขตของงาน (เช่น boq · web-shell · db-schema)
- **diff** — commit SHA หรือ PR ref ที่ merge เข้า `dev`
- **ภาพเทียบ gallery** — รายการต่อจอจาก skill `visual-gate`: `<route>: shot=<path> ↔ ref=<path> → ผ่าน` · งานไม่มีจอ → `—` + หลักฐาน gate แทน โดยสรุปเป็นบรรทัดต่อ gate:

```
— · G1: migration:check ผ่าน (<ref log/run>) · G2: contract N ผ่าน/N · G3: unit N ผ่าน/N
```

- **วันที่** — วันที่ merge เข้า dev (YYYY-MM-DD)
- หลักฐานละเอียด (log สรุปผลต่อ gate · จำนวน test ผ่าน/ทั้งหมด) เขียนไว้ใน journal ประจำรอบ (`agents/journal/<เขต>.md`) เพื่อให้ Wei ตามรอยได้

---

## Runbook infra (ขั้นตอนปฏิบัติ — `infra/CLAUDE.md` ชี้มาที่ section นี้)

> เขต DevOps · ค่าเฉพาะเครื่อง (host VPS, credentials, path backup) มาจาก env / secret store เท่านั้น — **ห้ามมี secret ใดๆ ใน repo** (sacred)

### 1) Deploy dev

1. บนเครื่อง dev (VPS Singapore — ภาคผนวก A): `git fetch origin && git checkout dev && git pull --ff-only`
2. เตรียม env: `infra/.env` (git-ignored) ต้องมีค่า POSTGRES_* ครบ — ห้าม commit
3. ขึ้นระบบทั้งชุด:

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
```

   - service `migrate-seed` เป็น one-shot: migrate + seed แล้วจบ (exit 0) — `api`/`worker` รอ service นี้ · ได้ระบบ seed พร้อมคลิกเทียบ gallery ใน up เดียว (milestone Phase 0)
4. ตรวจ: health endpoint ของ `api` ตอบปกติ · เปิด `web` คลิกจอหลักเทียบ gallery
5. มีปัญหา → rollback: `git checkout <SHA เขียวก่อนหน้า>` แล้ว `up -d --build --wait` ใหม่ · บันทึกเหตุการณ์ลง journal เขต devops

### 2) Promote main (Wei คนเดียวเท่านั้น)

> agent ห้ามทำขั้นตอนนี้ — บันทึกไว้เพื่อให้ Wei ใช้ · `main` มี branch protection ล็อกไว้

1. อ่าน `REVIEW-QUEUE.md` + `BLOCKERS.md` เป็น batch
2. คลิกเล่นบน dev เทียบ gallery ทีละแถว (ไล่จากแถวเก่าสุด)
3. **ผ่าน** → merge `dev → main` (มือ — ไม่มี automation แตะ main) → เปลี่ยนสถานะ task เป็น `done` ใน `TASKS.md` → ลบแถวออกจากคิว
4. **ไม่ผ่าน** → สร้าง rework task ใน `TASKS.md` (สถานะ `ready` ระบุสิ่งที่ต้องแก้) → ลบแถวออกจากคิว
5. Deploy prod จาก `main`:

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build --wait
```

   (env จาก host เท่านั้น — `infra/docker-compose.prod.yml` ไม่มี default password ฝังใน repo)

### 3) Restore DB

1. หยุดตัวเขียนก่อนกู้: `docker compose -f infra/docker-compose.yml stop api worker` (prod ใช้ไฟล์ prod)
2. เลือกไฟล์ backup ล่าสุดที่ต้องการ (path/รอบ backup ตาม env ของ host)
3. กู้เข้า service `postgres`:

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < <backup-file>
```

   (backup แบบ plain SQL ใช้ `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -` แทน)
4. start กลับ: `docker compose -f infra/docker-compose.yml start api worker` → ตรวจ health endpoint + spot-check จำนวน record เทียบ `docs/extract/MOCK-DATA.md` §สรุป (กรณี dev ที่กู้จาก seed baseline)
5. บันทึกเหตุการณ์ (เวลา ไฟล์ backup ที่ใช้ ผลตรวจ) ลง journal เขต devops · สาเหตุที่ทำให้ต้อง restore → พิจารณาเปิด `BLOCKERS.md` แจ้ง Wei
