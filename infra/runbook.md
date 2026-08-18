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
3. ขึ้นระบบทั้งชุด (pg16 + redis + migrate-seed + api + worker + web) — **คำสั่งนี้ seed = TRUNCATE ทุกตารางใน public schema** จึงมีประตูกันเครื่องผิดคั่นอยู่ในบรรทัดเดียวกัน:

   ```bash
   test -e /etc/juneflow/docker-compose.staging.yml && echo 'STOP: เครื่องนี้เป็น staging — คำสั่ง §1 ล้างข้อมูล → ไป §1.5 ข้อ 4' || docker compose -f infra/docker-compose.yml up -d --build --wait
   ```

   - **ทำไมประตูต้องอยู่ตรงนี้ ไม่ใช่แค่ใน §1.5:** §1 ชื่อ "Deploy dev" คือหัวข้อที่คนเลื่อนมาเจอก่อน และคำสั่งข้างในเป็น base ไฟล์เดียว = seed = ล้างข้อมูลที่ tester กรอก · คำเตือนทั้งหมดอยู่ใน §1.5 ซึ่งคนที่หยุดอ่านแค่ §1 ไม่ได้เปิด
   - ประตูตัดสินจาก **เครื่อง** ไม่ใช่จากความจำของคน: staging ทุกเครื่องมี `/etc/juneflow/docker-compose.staging.yml` ตั้งแต่ §1.5 ข้อ 1 · เครื่อง dev ไม่มีไฟล์นั้น คำสั่งจึงทำงานเหมือนเดิมทุกประการ
   - วัดจริง — เครื่องที่ไม่มีไฟล์ (dev): เข้า `up`, exit 0 · เครื่องที่มีไฟล์ (staging): พิมพ์ `STOP: …` และ **ไม่**เข้า `up`, exit 0
   - **เป็นบรรทัดเดียวโดยตั้งใจ** — select ทั้งบรรทัดแล้ววางได้ แต่เลือกเฉพาะ `up` ออกมาวางด้วยการ select ทีละบรรทัดไม่ได้
   - service `migrate-seed` เป็น one-shot: migrate + seed แล้วจบ (exit 0) — `api`/`worker` รอ service นี้ · ได้ระบบ seed พร้อมคลิกเทียบ gallery ใน `up` เดียว (milestone Phase 0)
4. ตรวจ: health endpoint ของ `api` ตอบปกติ · เปิด `web` คลิกจอหลักเทียบ gallery
5. มีปัญหา → **rollback**: `git checkout <SHA เขียวก่อนหน้า>` แล้วขึ้นใหม่ด้วยประตูเดียวกับข้อ 3 (rollback คือช่วงที่คนรีบที่สุดและอ่านน้อยที่สุด ประตูจึงต้องอยู่ที่นี่ด้วย):

   ```bash
   test -e /etc/juneflow/docker-compose.staging.yml && echo 'STOP: เครื่องนี้เป็น staging — rollback แบบ §1 จะ re-seed = ล้างข้อมูล → ไป §1.5 ข้อ 6' || docker compose -f infra/docker-compose.yml up -d --build --wait
   ```

   - บันทึกเหตุการณ์ลง `agents/journal/devops.md`

---

## 1.5) Deploy staging (VPS ที่มีคนกรอกข้อมูลจริง — หลัง VPN)

> **delta จาก §1 เท่านั้น** — ทุกอย่างที่ไม่ได้เขียนไว้ที่นี่เหมือน §1 ทุกประการ
> ต่างกันข้อเดียวที่สำคัญ: **§1 ใช้ไฟล์ base ไฟล์เดียว → `up` รอบที่สองจะ TRUNCATE ทุกตารางใน public schema แล้ว seed ใหม่** (ดู comment เหนือ service `migrate-seed` ใน `infra/docker-compose.yml`) — ข้อมูลที่ tester กรอก · `audit_log` (ล้างแล้วเติม fixture 13 แถวคืน — **นับจำนวนแถวไม่เห็น** ดูข้อ 5) · `auth_session` (คนที่ login ค้างไว้ ถูกล้างและไม่เติมคืน) หายหมด
> staging จึงต้องขึ้นด้วย **overlay** `infra/docker-compose.staging.yml` ซึ่ง (1) รันแค่ครึ่ง migrate ไม่ seed (2) bind port ของ postgres/redis ไว้ที่ `127.0.0.1` (3) บังคับ `POSTGRES_PASSWORD` + `BETTER_AUTH_SECRET` ต้องมีจริง
> **overlay ต้องอยู่นอก git checkout และต่อเข้ามาทาง `COMPOSE_FILE`** (ข้อ 1) — คำสั่ง deploy บนเครื่อง staging จึง **ไม่มี `-f` สักตัว** ทั้ง deploy ปกติและ rollback เป็นคำสั่งเดียวกันเป๊ะ เหตุผลอยู่ในข้อ 6
> **ทั้งหัวข้อนี้ไม่มีคำสั่ง `up` แบบ base ไฟล์เดียวพิมพ์ไว้เลยแม้แต่ที่เดียว** — คำสั่งที่ seed (ข้อ 3) ไม่ใช่ `up` และมีประตูของตัวเองที่จริงได้ครั้งเดียวต่อเครื่อง · ทุก `up` ในหัวข้อนี้เป็น **คำสั่งเดียว (บรรทัดเดียว)** ที่มี guard นำหน้าเสมอ guard แดง = `up` ไม่วิ่ง
> **guard แดงแล้วห้าม improvise** — ไม่ใช้ §1 · ไม่พิมพ์ `-f` เอง · ไม่ `cd infra` แล้วรัน compose · ทางออกที่ถูกต้องอยู่ในข้อ 8 ทางเดียว
> ต้องการ Docker Compose **>= 2.24** (ใช้ YAML tag `!override` — compose ต่อ list `ports:` เข้าด้วยกัน ไม่ได้แทนที่)

1. **ติดตั้งครั้งเดียวต่อเครื่อง** — วาง overlay ไว้ **นอก** repo แล้วผูกด้วย `COMPOSE_FILE` (รันจากราก checkout):

   ```bash
   sudo install -D -m 0644 infra/docker-compose.staging.yml /etc/juneflow/docker-compose.staging.yml
   echo "COMPOSE_FILE=$(git rev-parse --show-toplevel)/infra/docker-compose.yml:/etc/juneflow/docker-compose.staging.yml" | sudo tee -a /etc/environment
   # logout/login หนึ่งรอบ แล้วตรวจว่าติดจริง (guard ตัวเดียวกับข้อ 4 · ต้องได้ `overlay-ok` และ exit 0):
   docker compose config --format json migrate-seed | grep -qxE ' *"pnpm --filter @juneflow/db migrate",?' && docker compose config --format json postgres | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose config --format json redis | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && echo overlay-ok || { echo 'overlay-หลุด → ข้อ 8'; false; }
   ```

   - **guard ถาม 3 คำถาม ผูกกับ service ทีละตัว ไม่ใช่นับบรรทัด:** (1) `command` ของ service `migrate-seed` ต้องเป็นครึ่ง migrate เท่านั้น (2) `postgres` ต้องมี published entry เดียวและเป็น loopback (3) `redis` เช่นเดียวกัน · ข้อ (1) เป็น property ที่ **มีได้ก็ต่อเมื่อ overlay ถูก merge เข้ามาจริง** · ข้อ (2)(3) ยืนยันทั้ง "สิ่งที่ต้องมี" (loopback) และ "สิ่งที่ต้องไม่มี" (publish ตัวที่สองที่ไม่ใช่ loopback) — เพราะ compose **ต่อ** list `ports:` ข้ามไฟล์ การถามหา loopback อย่างเดียวจึงไม่พอ (เหตุผลเต็ม + ประวัติของเวอร์ชันที่ปลอมได้ อยู่ในข้อ 4)
   - วัดจริง 6 สภาพเครื่อง — overlay ติด: `overlay-ok` exit 0 · `COMPOSE_FILE` ไม่ได้ตั้ง: exit 1 (พร้อม `no configuration file provided`) · base ไฟล์เดียว: exit 1 · `cd infra` แล้วรัน: exit 1 · base ไฟล์เดียว + ตั้ง `POSTGRES_PORT=127.0.0.1:5432 REDIS_PORT=127.0.0.1:6379 API_PORT=127.0.0.1:3000`: exit 1 · `cd infra` + สามตัวแปรเดียวกัน: exit 1 · เพิ่มอีก 5 สภาพ **overlay ที่ถูกแก้** (ข้อ 4): ลบ tag `!override` ที่ postgres / ที่ redis / ทั้งคู่ · ลบ `ports:` ทั้งบล็อก · คง `!override` แต่ bind `0.0.0.0` — exit 1 ทุกช่อง
   - ทั้งสอง path ใน `COMPOSE_FILE` ต้องเป็น **absolute** — คำสั่ง compose จึงใช้ได้จาก cwd ไหนก็ได้ (วัดจริงแล้ว: config ที่ได้เหมือนกันทุก byte กับการพิมพ์ `-f` สองตัวจากราก repo)
   - ใส่ที่ `/etc/environment` ไม่ใช่ `~/.profile` — `ssh <host> 'docker compose ...'` เป็น shell แบบ non-login ไม่อ่าน `~/.profile` แต่ pam อ่าน `/etc/environment` ให้
   - overlay ใน repo เปลี่ยนเมื่อไร ให้ `install` ทับใหม่ **ก่อน** deploy รอบนั้น (ข้อ 4) — และ **ห้าม**ทำตอน rollback (ข้อ 6)

2. เตรียม env: `infra/.env` (git-ignored) บนเครื่องนั้นต้องมี **ชื่อ** ต่อไปนี้ — **ห้ามเขียนค่าลง repo ไม่ว่ากรณีใด**
   - บังคับ (ไม่มีค่า = deploy ล้มทันทีตั้งแต่ config ไม่ขึ้นระบบ): `POSTGRES_PASSWORD` · `BETTER_AUTH_SECRET`
   - ตามต้องการ (มี default ใน base): `POSTGRES_DB` · `POSTGRES_USER` · `POSTGRES_PORT` · `REDIS_PORT` · `API_PORT` · `WEB_PORT`
   - เช็คก่อนขึ้นจริง: `docker compose config >/dev/null` — ถ้าขาดค่า จะได้ `required variable ... is missing a value` และ **exit 1** (base ไฟล์เดียว exit 0 เงียบๆ แล้วใช้ password ที่ commit ไว้ใน repo) · บรรทัดนี้เป็นแค่ **diagnostic ว่าตัวแปรไหนขาด ไม่ใช่ guard** — guard ตัวจริงคือคำสั่งเดียวในข้อ 4 อย่าเอาบรรทัดนี้ผ่านแล้วไปพิมพ์ `up` เอง
   - **VPS ที่เคยมี volume `pgdata` อยู่แล้ว: `POSTGRES_PASSWORD` ต้องตรงกับค่าที่ volume ถูก initdb ไว้** — ไม่ตรงแล้วจะได้อาการหลอกตาในข้อ 7 อ่านข้อ 7 ก่อนตั้งค่า

3. **ครั้งแรกครั้งเดียวต่อเครื่อง** บน DB เปล่า — seed ชุดตั้งต้นไว้คลิกเทียบ gallery · **ไม่ใช่คำสั่ง `up`** และมีประตูสามชั้นอยู่ในบรรทัดเดียวกัน:

   ```bash
   test -n "${COMPOSE_PROJECT_NAME:-}" && echo 'STOP: COMPOSE_PROJECT_NAME ถูกตั้งไว้ — ประตูข้างล่างถามหา volume ชื่อ juneflow_pgdata ซึ่งไม่ใช่ volume ของ project นี้ → ข้อ 8 กรณีที่ 5' || { docker volume inspect juneflow_pgdata >/dev/null 2>&1 && echo 'STOP: มี pgdata อยู่แล้ว = ไม่ใช่ deploy ครั้งแรก ห้าม seed → ข้ามไปข้อ 4' || { docker compose config --format json migrate-seed | grep -qxE ' *"pnpm --filter @juneflow/db migrate",?' && docker compose config --format json postgres | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose config --format json redis | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose run --rm --build migrate-seed sh -c 'pnpm --filter @juneflow/db migrate && pnpm --filter @juneflow/db seed' || { echo '!! GUARD ไม่ผ่าน — overlay ไม่ได้อยู่ในชุดที่ compose จะใช้ → ข้อ 8'; false; }; }; }
   ```

   เสร็จแล้วขึ้นระบบด้วย **ข้อ 4** (คำสั่งเดียวกับ deploy ปกติทุกครั้ง — ไม่มีคำสั่งพิเศษสำหรับครั้งแรก)

   - **ประตูชั้นที่ 0 = `COMPOSE_PROJECT_NAME` ต้องไม่ถูกตั้ง** — ประตูชั้นที่ 1 ถาม **ชื่อ volume ตรงตัว** (`juneflow_pgdata`) แต่ชื่อจริงของ volume มาจากชื่อ project · วัดจริง: ตั้ง `COMPOSE_PROJECT_NAME=other` แล้ว `docker compose config` ได้ `name: other` และ `volumes.pgdata.name: other_pgdata` · บนเครื่องที่ export ตัวแปรนี้ไว้ ข้อมูลของ tester อยู่ใน `other_pgdata` ส่วนประตูไปถาม `juneflow_pgdata` ซึ่ง**ไม่มี** → ประตูเปิด → seed → TRUNCATE ทั้งกล่องทั้งที่ไม่ใช่เครื่องใหม่ · บรรทัด `test -n` จึงตัดจบก่อนถึงประตูนั้น (วัดจริง: `COMPOSE_PROJECT_NAME=other` + volume ยังไม่มี + overlay ติด → พิมพ์ `STOP: COMPOSE_PROJECT_NAME …` และ **seed ไม่วิ่ง**) · ตัวแปรนี้ตั้งไว้ทำไมก็ตาม ให้ไปข้อ 8 กรณีที่ 5 ก่อน
   - **ประตูชั้นที่ 1 = volume `juneflow_pgdata` ต้องยังไม่มี** — "DB ยังเปล่าจริงๆ" ถูกทำให้เป็นเงื่อนไขที่ **เครื่องตอบเอง** ไม่ใช่สิ่งที่คนต้องจำ · เงื่อนไขนี้เป็นจริงได้ครั้งเดียวตลอดอายุเครื่อง และ**บังเอิญเป็นจริงไม่ได้** เพราะ volume เกิดตั้งแต่ compose แตะ postgres ครั้งแรกและอยู่ยาวข้าม `down`/`git checkout`/reboot · ทางเดียวที่ทำให้ประตูนี้เปิดอีกครั้งคือ**ลบ volume ทิ้งเอง** (`down -v` / `docker volume rm`) ซึ่งข้อ 7 ห้ามไว้อยู่แล้ว — และถึงตอนนั้นข้อมูลก็หายไปก่อนหน้าคำสั่งนี้แล้ว · **ข้อจำกัดที่เหลืออยู่จริง:** ประตูนี้ถามชื่อตรงตัว ไม่ได้ถาม compose ว่า project นี้ใช้ volume ชื่ออะไร — ประตูชั้นที่ 0 ปิดทางที่ตัวแปร env ทำให้ชื่อเพี้ยน แต่ถ้าใครพิมพ์ `-p <ชื่อ>` เองในคำสั่งนี้ ประตูชั้นที่ 1 ก็ยังตาบอดเหมือนเดิม · **ห้ามพิมพ์ `-p`** เช่นเดียวกับที่ห้ามพิมพ์ `-f` (ข้อ 8)
   - **ประตูชั้นที่ 2 = guard เดียวกับข้อ 4** — แม้เป็นเครื่องใหม่จริง ก็ยังต้องขึ้นด้วย overlay (loopback + secret บังคับ) ไม่ใช่ base ล้วนที่เปิด 0.0.0.0 พร้อม password ที่ commit ไว้ · วัดจริงกับคำสั่งเวอร์ชันก่อน (guard แบบนับบรรทัด): volume ยังไม่มี + base ไฟล์เดียว + ตั้ง `POSTGRES_PORT`/`REDIS_PORT`/`API_PORT` เป็น `127.0.0.1:<port>` → guard เก่า**เขียว แล้ว seed วิ่งบน config ที่ TRUNCATE** · guard ปัจจุบันในสภาพเดียวกัน: `!! GUARD ไม่ผ่าน` exit 1
   - **ทำไมเลิกใช้ `up` ตรงนี้:** เดิมข้อนี้พิมพ์ `up -d --build --wait` แบบ base ไฟล์เดียวไว้บนหน้ากระดาษ ตอนตีสองที่ `COMPOSE_FILE` ไม่ติดแล้วทุกคำสั่งอื่นในหัวข้อนี้ตายหมด มันคือ `up` ตัวเดียวในหน้าที่ยัง "วิ่งได้" — คนจึงวางมันเป็นทางออก แล้วล้างข้อมูลทั้งกล่อง · ตอนนี้ทางที่ล้างข้อมูลไม่ใช่ `up` อีกต่อไป ต้องตั้งใจพิมพ์คำว่า `seed` เอง และผ่านประตูสามชั้นก่อน
   - `docker compose run` สตาร์ท `postgres` ให้เองตาม `depends_on` (วัดจริงด้วย `--dry-run`: `Container juneflow-postgres-1 Creating/Started`) · `--build` จำเป็นเพราะเครื่องใหม่ยังไม่มี image `juneflow-api-build:dev` · `--rm` ทิ้ง container one-off หลังจบ
   - วัดจริง — คำสั่ง seed วิ่ง **ช่องเดียว**: `COMPOSE_PROJECT_NAME` ไม่ได้ตั้ง **และ** volume ยังไม่มี **และ** overlay ติด · volume มีอยู่แล้ว → `STOP: มี pgdata อยู่แล้ว …` exit 0 · `COMPOSE_PROJECT_NAME` ถูกตั้ง → `STOP: COMPOSE_PROJECT_NAME …` exit 0 (ไม่ว่า volume จะมีหรือไม่) · volume ยังไม่มีแต่ overlay หลุด (base ไฟล์เดียว · `COMPOSE_FILE` ไม่ได้ตั้ง · base + สามตัวแปร loopback) → `!! GUARD ไม่ผ่าน …` exit 1 ทุกช่อง
     (วิธีวัดโดยไม่แตะข้อมูล: แทน `docker compose run … seed` ด้วย `echo` และแทนชื่อ volume ด้วยชื่อที่ไม่มีจริงเพื่อจำลองช่อง "volume ยังไม่มี" — ไม่ต้องลบ volume ของใครเพื่อทดสอบ และ**ห้ามลบ**)

4. **ทุกครั้งถัดจากนั้น** — ไม่มี `-f` (`COMPOSE_FILE` จากข้อ 1 ต่อสองไฟล์ให้แล้ว) · guard กับ `up` เป็น **คำสั่งเดียวกันบรรทัดเดียว**:

   ```bash
   docker compose config --format json migrate-seed | grep -qxE ' *"pnpm --filter @juneflow/db migrate",?' && docker compose config --format json postgres | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose config --format json redis | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose up -d --build --wait || { echo '!! GUARD ไม่ผ่าน — overlay ไม่ได้อยู่ในชุดที่ compose จะใช้ ห้ามพิมพ์ up เอง → ข้อ 8'; false; }
   ```

   - **ทำไมต้องเป็นบรรทัดเดียว:** เวอร์ชันก่อนพิมพ์ "ตรวจ 2 บรรทัด แล้วค่อย `up`" เป็นบล็อกเดียวกัน — วัดจริงแล้วคนเลือกทั้งบล็อกวางทีเดียว บรรทัดตรวจแดงแล้ว `up` ก็ยังวิ่งต่ออยู่ดี · ผูกเป็นคำสั่งเดียวด้วย `&&` แล้ว `up` จะ **ไปไม่ถึง** เมื่อ guard แดง ไม่ว่าจะวางแบบไหน (ยาวขึ้นเพราะมี 3 ข้ออ้าง แต่ยังเป็น statement เดียว — เลือกทั้งบรรทัดวางได้ ตัดครึ่งวางไม่ได้)
   - **guard ถามทีละ service ไม่นับบรรทัดรวม** — สามข้ออ้าง: `command` ของ `migrate-seed` ต้องเป็น `pnpm --filter @juneflow/db migrate` เท่านั้น (ครึ่ง migrate) · `postgres` ต้องมี published entry **เพียงรายการเดียว และรายการนั้นต้องเป็น loopback** · `redis` เช่นเดียวกัน · ทุกข้ออ่าน config ชุดเดียวกับที่ `up` จะใช้ จึงจับได้ทุกทางที่ overlay หลุด (env ไม่ติด · ssh ไม่อ่าน profile · เผลอพิมพ์ `-f` เอง · `cd infra`) **ก่อน**แตะ DB ไม่ใช่หลัง
   - **สองข้ออ้างพอร์ตนับ entry ต่อ service ไม่ใช่แค่หา loopback สักบรรทัด** — `awk` นับสองอย่างในไฟล์ JSON ของ service เดียว: `p` = จำนวนบรรทัด `"published":` · `l` = จำนวนบรรทัด `"host_ip": "127.0.0.1"` · ผ่านเมื่อ `p==1 && l==1` เท่านั้น · **ขอบเขตตามที่วัดได้ อย่าอ่านเกินนี้:** มันนับ**คีย์ `published`** ไม่ใช่ port entry ดังนั้น entry ที่ compose render ออกมา**โดยไม่มีคีย์ `published`** จะล่องหนจากตัวนับ วัดจริง 4 รูปแบบที่ผ่าน guard ทั้งที่เปิดนอก loopback: `- "5432"` · `- "5432/tcp"` · `- "192.168.1.50::5432"` · long syntax ที่มีแต่ `target`/`mode` — และ `network_mode: host` ก็ผ่านเช่นกันเพราะ docker ทิ้ง published port ทิ้งเมื่อใช้ host networking · **ทั้งห้ากรณีต้องแก้ไฟล์ overlay เอง** guard ตัวนี้ตอบคำถามว่า "overlay ถูก merge เข้ามาจริงไหม" ซึ่งมันตอบได้ครบ (ดูรายการ fail-closed ข้างล่าง) มันไม่ใช่การ audit เนื้อหาของ overlay และไม่ควรถูกอ้างว่าเป็น · สิ่งที่กันเนื้อหาคือ code review ของไฟล์นี้ — ซึ่ง**สำเนาที่ติดตั้งที่ `/etc/juneflow/` ไม่ได้อยู่ใน git และไม่มีใคร review** จึงเป็นจุดที่ต้องระวังเป็นพิเศษ (ดูข้อ 1)
     - **ทำไมต้องนับ `p` ด้วย ไม่ใช่แค่ถามหา loopback:** compose **ต่อ (concatenate) list `ports:` ข้ามไฟล์** ไม่ได้แทนที่ — tag `!override` คือสิ่งเดียวที่ทำให้แทนที่ · ลบ **เฉพาะ tag** `!override` ทิ้ง (เหลือ `ports:` เปล่า) แล้ว postgres จะ render **สอง** entry: entry แรก**ไม่มี key `host_ip` เลย** (= 0.0.0.0) และ entry ที่สอง `host_ip: 127.0.0.1` · guard เวอร์ชันก่อนถามแค่ "มีบรรทัด `host_ip: 127.0.0.1` ไหม" มันเจอ entry ที่สอง จึง **ACCEPT** — วัดจริง exit **0** บน config ที่เปิด Postgres พร้อมรหัสผ่านออกทุก interface · เป็นการแก้ไฟล์ **จุดเดียว** ที่ operator บน Compose < 2.24 หรือคนที่มาจัดรูป YAML ให้ "สะอาด" จะทำโดยไม่รู้ตัว และ deploy รายงานเขียว
     - วัดจริงต่อ state (ทั้ง 17 state · `up` ถูกแทนด้วย `echo ACCEPT` · ดึงข้อความ guard ออกจากไฟล์นี้เอง ไม่ได้พิมพ์ใหม่): overlay จริง `p=1 l=1` ACCEPT exit 0 · ลบ tag ที่ postgres `p=2 l=1` REFUSE exit 1 · ลบ tag ที่ redis (postgres `p=1 l=1`, redis `p=2 l=1`) REFUSE exit 1 · ลบ tag ทั้งสอง REFUSE exit 1 · ลบ `ports:` ทั้งบล็อก `p=1 l=0` REFUSE exit 1 · คง `!override` ไว้แต่เปลี่ยน bind เป็น `0.0.0.0` `p=1 l=0` REFUSE exit 1
   - **ข้ออ้างหลักคือ `command` ของ `migrate-seed` และต้องอ่านผ่าน `--format json` เท่านั้น** — base เขียน `command` เป็น list ค่าคงที่ ไม่มี `${…}` ให้แทนค่า **ตัว field เองจึงปลอมไม่ได้** แต่ระวังให้ถูกจุด: `docker compose config migrate-seed` ยัง render service ที่มัน `depends_on` ออกมาด้วย (postgres) และ compose render ค่าที่มี newline เป็น YAML block scalar **ค่าจาก env จึงงอกเป็นบรรทัดจริงในผลลัพธ์ได้** · วัดจริงโดยไม่แก้ไฟล์สักตัวอักษร: `POSTGRES_PASSWORD=$'x\n- pnpm --filter @juneflow/db migrate'` ทำให้ guard แบบอ่าน YAML **ACCEPT** ทั้งที่ command จริงคือ `migrate && seed` (= TRUNCATE) เพราะรหัสผ่านไปโผล่ใน `services.postgres.environment` แล้วกลายเป็นบรรทัดที่ตรง pattern · `--format json` ปิดช่องนี้เพราะ JSON escape `\n` เป็น `\n` ในสตริง ค่าที่ interpolate เข้ามาจึงสร้างบรรทัดใหม่หรือปิดบรรทัดไม่ได้ (วัดแล้ว: forge เดียวกัน → REFUSE · overlay จริง → ACCEPT) · **ห้ามถอด `--format json` ออกเพื่อความอ่านง่าย** · ระดับความเสี่ยงตามจริง: การปลอมนี้ต้องใช้ค่าที่จงใจ (รหัสผ่านที่มี newline ตามด้วยสตริงนั้นเป๊ะ) ไม่ใช่สิ่งที่รหัสผ่านที่สุ่มมาจะชนเอง — แต่ที่ต้องแก้คือ guard นี้เคยถูกประกาศว่า "ปลอมไม่ได้" ซึ่งเป็นเท็จ และคนที่มาคลายมันทีหลังจะเชื่อคำนั้น · ส่วนอีกสองข้ออ้าง (พอร์ต) **ยังปลอมได้ถ้าอยู่ลำพัง** — วัดจริง: base ไฟล์เดียว + `POSTGRES_PORT=127.0.0.1:5432` ได้ `p=1 l=1` ผ่านข้ออ้างนี้ทั้งดุ้น — แต่มันถูก `&&` ไว้หลังข้ออ้างที่ปลอมยากที่สุด หน้าที่ของมันคือกันคนละเรื่อง: กัน**การแก้ overlay** จนพอร์ตหลุด loopback ไม่ใช่กันสภาพเครื่อง
   - **`--format json` ของสองข้ออ้างพอร์ต: วัดได้แค่ไหน พูดแค่นั้น** — ที่ระดับ **statement รวม** ยังพิสูจน์ไม่ได้ว่าจำเป็น · วัดจริงด้วยการ mutate guard ให้อ่าน YAML render แทน (regex แบบ YAML ที่เทียบเท่ากัน): ทั้ง 17 state ยังตัดสินถูกหมด **RED=0** · แต่ที่ระดับ **ข้ออ้างเดี่ยวของ postgres** มันจำเป็นจริง — วัดจริง: overlay ที่ bind เป็น `0.0.0.0` + `POSTGRES_PASSWORD=$'x\nhost_ip: 127.0.0.1'` ทำให้ YAML render งอกบรรทัด `host_ip: 127.0.0.1` จริงใน `environment` → ข้ออ้าง postgres แบบอ่าน YAML ได้ `p=1 l=1` = **ผ่าน** บน config ที่เปิด Postgres ทุก interface · ที่ statement รวมยังแดงอยู่ได้ เพราะ**ตอนนี้** redis ไม่มี field ที่ interpolate ค่าที่มี newline เข้าไปได้เลย (field เดียวที่แทนค่าได้คือ `${REDIS_PORT}` ซึ่งใส่ newline แล้ว compose ตายที่ `invalid IP address` ก่อน) — margin นั้นบางและขึ้นกับ base ที่วันหนึ่งอาจเพิ่ม env ให้ redis · **จึงเก็บ `--format json` ไว้ทั้งสามข้ออ้าง** เป็น defence-in-depth ไม่ใช่เพราะพิสูจน์แล้วว่าขาดไม่ได้ (ข้ออ้าง `migrate-seed` พิสูจน์แล้วว่าขาดไม่ได้ — ย่อหน้าบน)
   - **ห้ามกลับไปใช้ guard แบบนับบรรทัดจาก pattern รวม (`grep -cE 'host_ip: 127.0.0.1|db migrate$' | grep -qx 3`) เด็ดขาด** — มันนับ**บรรทัด**จาก pattern ที่ or กันไว้ ไม่ได้ตรวจว่าบรรทัด loopback เป็นของ postgres/redis และไม่ได้ตรวจว่าครึ่ง migrate มีอยู่จริง **ครบ 3 ครั้งเมื่อไรก็เขียว** · วัดจริง **โดยไม่แก้ไฟล์สักตัวอักษร** จากรากรีโป: `POSTGRES_PORT=127.0.0.1:5432 REDIS_PORT=127.0.0.1:6379 API_PORT=127.0.0.1:3000` + base ไฟล์เดียว → guard เก่าพิมพ์ `3` exit **0** ทั้งที่ `command` ที่ render ออกมาคือ `pnpm … migrate && pnpm … seed` (= TRUNCATE) · ทำซ้ำด้วย `cd infra` แบบไม่ตั้ง `COMPOSE_FILE` ได้ผลเดียวกัน และเป็น project `juneflow` ตัวจริง · **สามตัวแปรนั้นคือตัวแปรที่ข้อ 2 บอกให้ operator ตั้งเอง** — ประตูจึงปลอมได้ด้วยของที่หน้านี้แจกให้เอง · เลข 3 ที่ได้มาจาก `host_ip` ของ postgres/redis/**api** ล้วนๆ โดยไม่มี marker migrate สักตัว
   - **ห้ามกลับไปใช้ `grep -c 'db seed'` เด็ดขาด** — วัดจริง 2 ข้อ: (1) สภาพที่ปลอดภัยพิมพ์ `0` แล้ว `grep -c` **exit 1** ส่วนสภาพที่ล้างข้อมูลพิมพ์ `1` แล้ว **exit 0** → เอามาต่อ `&&` เมื่อไร มันเขียวพอดีในสภาพที่ล้างกล่อง · (2) แค่แก้ base เป็น `pnpm --filter @juneflow/db run seed` (ความหมายเท่าเดิม ยัง seed เหมือนเดิม) ค่าที่ได้กลายเป็น `0` = "ปลอดภัย" ทั้งที่ base ล้วนกำลังจะ TRUNCATE → มันตรวจ**การสะกด** ไม่ได้ตรวจ**อันตราย**
   - guard นี้ **fail-closed ทุกสถานะที่ overlay หลุด** (วัดจริง exit code ของทั้ง statement · `up` ไม่วิ่งสักช่อง — และ *เฉพาะ* ตระกูลนี้ ไม่ใช่ "ทุกทาง": overlay ที่ถูกแก้เนื้อหาเองอยู่นอกขอบเขต ดูข้อจำกัดที่วัดไว้ด้านบน): `COMPOSE_FILE` ไม่ได้ตั้ง → exit 1 (`no configuration file provided`) · base ไฟล์เดียว → exit 1 · `cd infra` แล้วรัน → exit 1 · **base ไฟล์เดียว + สามตัวแปร loopback (สภาพที่ guard เก่าเขียว)** → exit 1 · **`cd infra` + สามตัวแปรเดียวกัน** → exit 1 · ขาด `POSTGRES_PASSWORD`/`BETTER_AUTH_SECRET` → config exit 1 พร้อมชื่อตัวแปร → exit 1 · overlay ถูกแก้จนพอร์ต loopback หาย → exit 1 · overlay ถูกแก้จน `command` migrate หายไป (= กลับไป seed) → exit 1 · overlay ที่ยัง loopback ครบแต่ย้าย binding ไปกองที่ postgres แล้วปล่อย redis เปิดหมด → exit 1 (guard แบบนับจะ**เขียว** เพราะนับได้ 2 เท่ากัน — นี่คือเหตุผลที่ไม่เหลือการนับไว้เลยแม้แต่ที่เดียว) · **overlay ถูกลบเฉพาะ tag `!override` (postgres / redis / ทั้งคู่) → exit 1** (guard เวอร์ชันก่อนหน้า ACCEPT exit 0 ทั้งสามช่อง — ดูข้ออ้างพอร์ตด้านบน) · **overlay ที่คง `!override` แต่เปลี่ยน bind เป็น `0.0.0.0` → exit 1**
   - **ไม่แดงหลอกเมื่อ overlay ถูกจัดรูปใหม่โดยความหมายเท่าเดิม** (วัดจริง exit 0): เขียน `command` เป็น string `sh -c "pnpm --filter @juneflow/db migrate"` หรือเป็น block list ก็ยังผ่าน — เพราะ guard อ่าน `docker compose config` ที่ normalize แล้ว ไม่ได้อ่านไฟล์ดิบ
   - **ปิดไปแล้วหนึ่งข้อ — บันทึกไว้เพราะรายการข้างล่างคือสิ่งที่คนรุ่นหลังจะเชื่อ:** เคยมีช่องที่ **ไม่เคยอยู่ในรายการนี้** คือ "ลบเฉพาะ tag `!override`" · guard เวอร์ชันก่อนถามแค่ว่ามีบรรทัด loopback ไหม จึง **ACCEPT exit 0** บน config ที่ postgres เปิดสอง publish (0.0.0.0 + 127.0.0.1) · ปิดด้วยการนับ published entry ต่อ service (`p==1 && l==1`) วัดแล้วทั้ง 17 state ตัดสินถูกหมด และ mutate ข้ออ้างกลับเป็นแบบเดิมแล้วแดง 3/3 ช่อง · **ข้อนี้จึงไม่ได้อยู่ในรายการข้างล่างอีกต่อไป** ที่เหลือคือของที่ยังเปิดอยู่จริง
   - **สิ่งที่ guard นี้ยัง*ไม่*ได้ตรวจ (พูดตรงๆ ดีกว่าปลอบใจ):**
     1. **ไม่ได้ตรวจการบังคับ secret** — overlay หายทั้งใบ ข้ออ้างสามข้อแดงก่อนอยู่แล้ว แต่ถ้ามีคนลบ**เฉพาะ**สองบรรทัด `POSTGRES_PASSWORD`/`BETTER_AUTH_SECRET` ออกจาก overlay guard จะ**ยังเขียว** วัดจริง: exit 0 และ config ที่ได้ใช้ `POSTGRES_PASSWORD: juneflow-dev` ซึ่งเป็นค่าที่ commit ไว้ในรีโป · ตัวที่กันเรื่องนี้คือ review ของไฟล์ overlay เอง ไม่ใช่ guard
     2. **ไม่มี lock ระหว่าง guard กับ `up`** — guard อ่าน config หนึ่งครั้ง แล้ว `up` อ่านอีกครั้ง (guard เวอร์ชันก่อนก็เหมือนกัน) · ถ้าใครแก้ `COMPOSE_FILE`/ไฟล์ overlay คั่นกลางระหว่างสองจังหวะนั้น guard ที่ผ่านไปแล้วไม่ได้พูดถึง config ที่ `up` ใช้จริง
     3. **ไม่ได้ตอบว่า project ชื่ออะไร** — วัดจริง: ตั้ง `COMPOSE_PROJECT_NAME=other` แล้ว guard ยัง exit 0 · เรื่องชื่อ project อยู่ที่ข้อ 3 ประตูชั้นที่ 0 และข้อ 8 กรณีที่ 5
     4. **ตรวจแค่ `postgres` กับ `redis` เท่านั้น** — ข้ออ้างพอร์ตผูกกับสอง service นี้ตรงตัว · `api`/`web` **ตั้งใจ**ปล่อยไว้ที่ทุก interface (เป็น ingress ที่ tester ต้องเข้าถึง — ดู comment ใน overlay) จึงไม่อยู่ในข้ออ้าง · แต่ถ้าวันหนึ่งมี service ใหม่ที่ควร loopback (เช่น service คิว/แดชบอร์ดภายใน) guard **จะไม่พูดถึงมันเลย** และจะไม่แดง · เพิ่ม service แบบนั้นเมื่อไร ต้องเพิ่มข้ออ้างที่นี่พร้อมกัน
     5. **`--format json` ของสองข้ออ้างพอร์ต ยังไม่ได้พิสูจน์ว่าขาดไม่ได้ที่ระดับ statement** — mutate ให้อ่าน YAML แทน แล้วทั้ง 17 state ยังตัดสินถูกหมด (RED=0) · ที่ยังแดงได้เพราะ redis **ตอนนี้** ไม่มี field ที่ interpolate ค่า newline เข้าไปได้ ไม่ใช่เพราะข้ออ้าง postgres แข็งแรง (ข้ออ้าง postgres เดี่ยวๆ แบบอ่าน YAML ถูก forge ให้ผ่านได้จริง วัดแล้ว) · เก็บ `--format json` ไว้เป็น defence-in-depth · **ถ้า base เพิ่ม `environment` ให้ redis เมื่อไร ให้กลับมาวัดข้อนี้ใหม่**
   - ถ้าวันหนึ่ง `packages/db` เปลี่ยนชื่อ script `migrate` หรือ overlay เปลี่ยนโครง guard จะ**แดงและ deploy ไม่ได้** — นั่นคือทิศที่ถูก แก้ที่ runbook + overlay ให้ตรงกันใหม่ **ห้ามปลด guard ทิ้ง**
   - ข้ออ้างพอร์ตอ่าน JSON แบบ **บรรทัดต่อบรรทัด** (`docker compose config --format json` พิมพ์แบบ pretty วัดแล้วบน Compose v5.1.3) · ถ้า compose รุ่นไหนเปลี่ยนไปพิมพ์ JSON บรรทัดเดียว `p` จะได้ `0` → **REFUSE** ไม่ใช่ ACCEPT (fail-closed ถูกทิศ) แต่ deploy จะหยุด — เจออาการนี้ให้แก้ regex ที่ runbook ทั้ง 4 จุดพร้อมกัน **ห้ามปลด guard ทิ้ง**
   - `migrate-seed` ยังเป็น one-shot เหมือนเดิม แต่รันแค่ `pnpm --filter @juneflow/db migrate` — migration ใหม่ขึ้นครบ ข้อมูลเดิมอยู่ครบ
   - `api`/`worker` ยังรอ `migrate-seed` ผ่าน `service_completed_successfully` เหมือน §1 ไม่มีอะไรเปลี่ยน

5. ตรวจหลัง deploy (นอกเหนือจาก §1 ข้อ 4):

   ```bash
   docker compose ps -a                                          # migrate-seed ต้องเป็น Exited (0) ก่อน
   docker compose logs migrate-seed | grep -c 'src/seed'          # ต้องได้ 0
   docker port $(docker compose ps -q postgres)                   # ต้องขึ้น 127.0.0.1: ไม่ใช่ 0.0.0.0:
   ```

   - **ดู `ps -a` ให้ `migrate-seed` ขึ้น `Exited (0)` ก่อนเสมอ แล้วค่อยเชื่อผล grep** — `migrate-seed` ไม่มี healthcheck ของตัวเอง `up --wait` จึงคืนค่าตั้งแต่ตอนมันยัง run อยู่ได้ (วัดจริงแล้ว: `--wait` จบตอน container ยัง `Up`) ถ้า grep ตอน log ยังไม่ทันออกจะได้ 0 ปลอม
   - `migrate-seed` ขึ้น `Exited (1)` และไม่มี container `api`/`worker` เลย → ข้อ 7
   - `grep -c 'src/seed'` ได้ค่าอื่นนอกจาก 0 = ขึ้นผิดไฟล์ (overlay หลุด) → ข้อมูลถูกล้างไปแล้ว ให้ไป §3 restore ทันที
   - **pattern `src/seed` ผูกกับ `"seed": "tsx src/seed/index.ts"` ใน `packages/db/package.json`** (pnpm echo ตัว body ของ script ลง log) — เปลี่ยนชื่อ script หรือย้ายไฟล์เมื่อไร check นี้จะได้ `0` = "ปลอดภัย" ตลอดกาลทั้งที่ seed วิ่งอยู่ ต้องแก้ pattern พร้อมกันเสมอ · check นี้เป็นแค่ตัวยืนยัน**หลัง**เกิดเหตุ ตัวที่กันจริงคือ guard ในข้อ 4 ซึ่ง fail-closed — อย่าเอาผลของบรรทัดนี้ไปแทนการรัน guard
   - spot-check จำนวน record ของตารางที่ tester กรอก ก่อน/หลัง deploy ต้องเท่ากัน — **แต่ห้ามใช้ `audit_log` เป็นตัววัด** seed ล้างแล้วเติมคืน 13 แถว fixture (14 → 13) จำนวนแทบไม่ขยับทั้งที่ trail จริงหายหมด

6. **Rollback** — คำสั่งเดียวกับข้อ 4 ทุกตัวอักษร ไม่มีอะไรให้จำเพิ่ม:

   ```bash
   git checkout <SHA เขียวก่อนหน้า>
   docker compose config --format json migrate-seed | grep -qxE ' *"pnpm --filter @juneflow/db migrate",?' && docker compose config --format json postgres | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose config --format json redis | awk '/^ *"published":/{p++} /^ *"host_ip": "127\.0\.0\.1",?$/{l++} END{exit !(p==1&&l==1)}' && docker compose up -d --build --wait || { echo '!! GUARD ไม่ผ่าน — overlay ไม่ได้อยู่ในชุดที่ compose จะใช้ ห้ามพิมพ์ up เอง → ข้อ 8'; false; }
   ```

   - `git checkout` ไม่ทำให้ overlay หาย — มันอยู่ที่ `/etc/juneflow` ไม่ได้อยู่ใน tree · แต่ถ้า shell ของคนที่มากู้ **ไม่มี `COMPOSE_FILE`** (เช่น ssh เข้ามาใหม่/รอบ logout ยังไม่เกิด) guard จะแดงทันทีตั้งแต่ก่อนแตะ DB → **ไปข้อ 8 ทางเดียว ห้ามถอยไปใช้ §1 และห้ามพิมพ์ `-f`/`up` เอง**
   - **ทำไม overlay ต้องอยู่นอก checkout:** `git checkout <SHA เก่า>` แทนที่ทั้ง working tree — SHA ไหนที่เก่ากว่า commit ที่เพิ่ม `infra/docker-compose.staging.yml` ก็ไม่มีไฟล์นั้น ถ้า overlay ถูกอ้างจากใน repo คำสั่ง rollback จะตายด้วย `no such file or directory` กลางเหตุการณ์ แล้วทางออกที่สั้นที่สุดตอนตีสองคือ**ตัด `-f` ทิ้ง** = ขึ้น base ไฟล์เดียว = TRUNCATE ข้อมูล tester ทั้งกล่อง ซึ่งคือหายนะที่ overlay ทั้งใบมีไว้กัน — เข้าถึงได้ด้วยการ**ทำตาม runbook**
   - แก้ที่โครงสร้าง ไม่ใช่ที่คำเตือน: overlay อยู่นอก tree จึงหายไม่ได้ · `COMPOSE_FILE` ทำให้ไม่มี `-f` ให้ตัดตั้งแต่แรก · guard ผูกติดกับ `up` เป็นคำสั่งเดียวจึงข้ามไม่ได้ · และหน้านี้ **ไม่มี `up` แบบ base ล้วนให้หยิบ** — ทางที่ล้างข้อมูลคือคำสั่ง `run … seed` ในข้อ 3 ซึ่งต้องผ่านประตู volume + guard ไม่ใช่ทางที่ขี้เกียจที่สุดอีกต่อไป
   - **ห้าม `install` overlay ทับตอน rollback** — เก็บ overlay ตัวใหม่ไว้ตามเดิม มันเป็นแค่ override ไม่กี่ key (ข้อยกเว้นเดียว: ไฟล์ที่ `/etc/juneflow` **หายไปจริง** → ข้อ 8)
   - ถ้า base เก่ากับ overlay ใหม่เข้ากันไม่ได้ (เช่น SHA นั้นยังไม่มี service `migrate-seed`) guard จะแดงตั้งแต่ก่อน `up` — วัดจริง: `service "migrate-seed" has neither an image nor a build context specified: invalid compose project` แล้ว statement exit 1 โดยไม่แตะ DB · ให้ถอยไป SHA ที่ใหม่กว่า หรือไป §3
   - ตรงนี้คือจุดที่ต่างจาก §1 ข้อ 5 ชัดที่สุด: rollback ตาม §1 (base ไฟล์เดียว) จะ re-seed = **ล้างข้อมูลทิ้ง** ตอนที่กำลังแก้ปัญหาอยู่พอดี — ห้ามใช้ §1 ข้อ 5 กับเครื่อง staging
   - migration ที่ลงไปแล้ว rollback ด้วยการ checkout โค้ดเก่าไม่ได้ (drizzle ไม่มี down) — ถ้า SHA ที่ถอยไปมี schema ไม่ตรงกับ DB ให้ไป §3 restore
   - บันทึกเหตุการณ์ลง `agents/journal/devops.md` เหมือน §1

7. **อาการที่จะเจอบ่อยที่สุดตอน deploy ครั้งแรกบน VPS เดิม: `POSTGRES_PASSWORD` ไม่ตรงกับ volume `pgdata` ที่มีอยู่**

   - **อาการ:** `docker compose ps` เห็น `postgres` เป็น **Healthy** แต่ไม่มี container `api`/`worker` เลย และ `up --wait` จบด้วย error — เห็น DB ปกติดี แอปตาย จึงมักถูกเดาผิดเป็นปัญหา build/network
   - **ทำไมหลอกตา:** healthcheck ของ postgres คือ `pg_isready` ซึ่ง **ไม่ auth** (server รับ connection ได้ = healthy ถึงรหัสจะผิด) · ตัวที่ตายจริงคือ `migrate-seed` exit 1 → gate `service_completed_successfully` ไม่เปิด → `api`/`worker` ไม่ถูกสร้างเลยตั้งแต่ต้น
   - **แยกจากสาเหตุอื่น** (migration พัง/schema ไม่ตรง ก็ทำให้ `migrate-seed` exit 1 เหมือนกัน) — ดูบรรทัดนี้ใน log:

     ```bash
     docker compose ps -a migrate-seed                                          # ต้องเห็น Exited (1)
     docker compose logs migrate-seed | grep -i 'password authentication failed'
     ```

     เจอ `password authentication failed for user "..."` = เคสนี้ · เจอแค่ `drizzle-kit migrate: Exit status 1` (บรรทัดสรุปของ pnpm) โดยไม่มีบรรทัดบน = คนละเรื่อง ให้อ่าน log เต็มก่อน อย่าเพิ่งไปแก้รหัส
   - **เหตุ:** `POSTGRES_PASSWORD` ตั้งรหัสให้เฉพาะตอน initdb ครั้งแรกเท่านั้น — volume เดิมจะไม่ถูก re-key และ postgres ไม่ฟ้องอะไรเลย
   - **แก้ได้ 2 ทาง เลือกทางเดียว:**
     - **(ก) ใช้รหัสที่ volume มีอยู่เดิม** — แก้ `POSTGRES_PASSWORD` ใน `infra/.env` ให้ตรงของเดิม แล้ว `up` ใหม่ตามข้อ 4 · ไม่แตะ DB เลย ปลอดภัยสุด เอาทางนี้ก่อนถ้ายังหารหัสเดิมได้
     - **(ข) re-key role ให้ตรงรหัสที่ตั้งใจจะใช้** — เข้าทาง unix socket ในตัว container ซึ่ง image `postgres:16` ตั้ง `local ... trust` ไว้ จึงไม่ต้องใช้รหัสเดิม:

       ```bash
       docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
       # ที่ psql prompt พิมพ์:  \password
       #   (ไม่ต้องใส่ชื่อ role — \password เปล่าๆ = เปลี่ยนรหัสของ user ที่ connect เข้ามา
       #    ซึ่งคือ $POSTGRES_USER จาก -U ข้างบน · ในนี้ตัวแปร shell ไม่ถูกแทนค่า
       #    เทียบเท่า ALTER ROLE <user> WITH PASSWORD '<ค่าใหม่>'; แต่ \password ไม่ echo
       #    ไม่ตกลง shell history และ hash ฝั่ง client ก่อนส่ง)
       ```

       - **`sh -c '…'` (single quote) ไม่ใช่ของประดับ** — `$POSTGRES_USER`/`$POSTGRES_DB` มีค่าอยู่ใน **container** (base ตั้งไว้ที่ `services.postgres.environment` วัดจริง: `POSTGRES_USER: juneflow` · `POSTGRES_DB: juneflow`) ไม่ได้มีอยู่ใน shell ของคนที่พิมพ์ — ค่าเหล่านั้นอยู่ใน `infra/.env` ซึ่ง compose อ่านเอง shell ไม่ได้อ่าน · เขียนแบบ double quote ข้างนอก shell จะแทนค่าให้ก่อนส่ง วัดจริงแล้วได้ `psql -U '' -d ''` (argv: `[psql] [-U] [] [-d] []`) = คำสั่งกู้เหตุการณ์ที่ **พังตั้งแต่ยังไม่ได้เริ่มกู้** · single quote เลื่อนการแทนค่าไปเกิดในตัว container วัดจริงได้ argv `[psql] [-U] [juneflow] [-d] [juneflow]`
       - (`docker compose exec` จอง TTY ให้เองเป็น default อยู่แล้ว — ไม่ต้องมี `-it` และ **ห้ามใส่ `-T`** เพราะ `\password` ต้องมี prompt ให้พิมพ์ · `sh -c` ไม่ได้ทำให้ TTY หายไป)

       แล้วใส่ค่าเดียวกันใน `infra/.env` → `up` ใหม่ตามข้อ 4
   - **ห้ามแก้ด้วยการลบ volume** (`down -v` · `docker volume rm`) — นั่นคือลบข้อมูล tester ทิ้งทั้งกล่อง ซึ่งเป็นสิ่งเดียวกับที่หัวข้อ §1.5 ทั้งหัวข้อมีไว้กัน

8. **GUARD แดง — ทำอะไรต่อ (ทางเดียว · ห้าม improvise)**

   guard แดงไม่ได้แปลว่า deploy ล้ม แปลว่า "ชุดไฟล์ที่ compose กำลังจะใช้ ไม่มี overlay อยู่ในนั้น" — **ยังไม่มีอะไรแตะ DB เลย** ยังมีเวลาเต็มที่ ดูก่อนว่าขาดอะไร:

   ```bash
   echo "COMPOSE_FILE=[${COMPOSE_FILE:-ไม่ได้ตั้ง}]"                                     # ต้องเห็น 2 path absolute คั่นด้วย :
   echo "COMPOSE_PROJECT_NAME=[${COMPOSE_PROJECT_NAME:-ไม่ได้ตั้ง}]"                       # ต้องเป็น "ไม่ได้ตั้ง" (กรณีที่ 5)
   test -e /etc/juneflow/docker-compose.staging.yml && echo overlay-ok || echo overlay-หาย
   docker compose config --format json migrate-seed | grep -E '"pnpm --filter'   # ต้องเป็นครึ่ง migrate เท่านั้น · เห็น "&& … seed" = overlay ไม่ติด · ใช้ json ให้ตรงกับ guard ข้อ 4 (yaml render เอาค่า env ที่มี newline มาปลอมเป็นบรรทัดได้)
   docker compose config --format json postgres | grep -E '"published":|"host_ip":'   # ต้องเห็น "published": บรรทัดเดียว และ "host_ip": "127.0.0.1" บรรทัดเดียว
   docker compose config --format json redis    | grep -E '"published":|"host_ip":'   # เช่นเดียวกัน · เห็น "published": สองบรรทัด = tag !override หายไปจาก overlay (compose ต่อ list ports:)
   ```

   - **กรณีที่ 1 — `COMPOSE_FILE` ไม่ได้ตั้ง** (พบบ่อยที่สุด: ssh session ใหม่ · ยังไม่ได้ logout รอบที่ `/etc/environment` มีผล · `ssh <host> 'cmd'` แบบ non-login) → ตั้งให้ shell ปัจจุบันชั่วคราว แล้ว **กลับไปข้อ 4** (อย่าไปแก้ `/etc/environment` ตอนกำลังกู้):

     ```bash
     export COMPOSE_FILE="$(git rev-parse --show-toplevel)/infra/docker-compose.yml:/etc/juneflow/docker-compose.staging.yml"
     ```

   - **กรณีที่ 2 — overlay ที่ `/etc/juneflow` หายจริง** → `sudo install -D -m 0644 infra/docker-compose.staging.yml /etc/juneflow/docker-compose.staging.yml` แล้วกลับไปข้อ 4 · นี่คือ**ข้อยกเว้นเดียว**ของกฎ "ห้าม install ตอน rollback" (ข้อ 6) และต้องบันทึกลง `agents/journal/devops.md`
   - **กรณีที่ 3 — ขาด `POSTGRES_PASSWORD` / `BETTER_AUTH_SECRET`** (config ฟ้องชื่อตัวแปรมาตรงๆ) → เติมใน `infra/.env` ของเครื่องนั้นตามข้อ 2 แล้วกลับไปข้อ 4
   - **กรณีที่ 4 — SHA ที่ถอยไปเก่ากว่า overlay** (`invalid compose project` พร้อมชื่อ service) → ถอยไป SHA ที่ใหม่กว่า หรือไป §3
   - **กรณีที่ 5 — `COMPOSE_PROJECT_NAME` ถูกตั้งไว้บนเครื่องนั้น** (พบได้จริง: เครื่องที่เคยรันหลาย worktree พร้อมกันแล้วตั้งชื่อ project แยก) → **guard ข้อ 4 ไม่แดงเพราะเรื่องนี้** (วัดจริง: ตั้ง `COMPOSE_PROJECT_NAME=other` แล้ว guard ยัง exit 0 — มันตอบเรื่อง "overlay อยู่ในชุดไฟล์ไหม" ไม่ได้ตอบเรื่องชื่อ project) แต่มันทำให้ **ทุกอย่างที่อ้างชื่อ `juneflow_*` ในหน้านี้ผิดเป้าเงียบๆ**:
     - วัดจริง: `name: other` · `volumes.pgdata.name: other_pgdata` · network `other_default` — คือ **stack คนละชุด** กับที่ข้อมูลของ tester อยู่
     - ผลที่ตามมาที่แรงที่สุดคือ **ประตูครั้งแรกในข้อ 3**: `docker volume inspect juneflow_pgdata` ถามชื่อตรงตัว ไม่เจอ volume จริง (`other_pgdata`) → ประตูเปิด → seed → **TRUNCATE ทั้งที่ไม่ใช่เครื่องใหม่** · ข้อ 3 จึงมีประตูชั้นที่ 0 `test -n "${COMPOSE_PROJECT_NAME:-}"` ตัดจบก่อน
     - `up` ตามข้อ 4 ในสภาพนี้จะไม่ล้างข้อมูล (overlay = migrate อย่างเดียว) แต่จะขึ้น **stack ใหม่ที่ DB ว่างเปล่า** ข้าง stack เดิม — อาการที่คนเห็นคือ "ข้อมูล tester หายหมด" ทั้งที่ยังอยู่ครบใน volume เดิม · และพอร์ตชนกับ stack เดิมด้วย
     - `docker compose ps` / `logs` / `port` ในข้อ 5 และข้อ 7 ก็จะไปดู stack ผิดชุดเช่นกัน
     - **ทางแก้:** `unset COMPOSE_PROJECT_NAME` ในเชลล์ที่จะ deploy (และหาว่าใคร export ไว้ที่ไหน — `/etc/environment` · `~/.bashrc` · systemd unit) แล้วกลับไปข้อ 4 · **ห้าม**แก้ด้วยการพิมพ์ `-p juneflow` เองตามนิสัยเดียวกับที่ห้ามพิมพ์ `-f`
   - **ห้ามทำทุกกรณี — สามทางนี้ "ได้ผล" จริง คือขึ้นระบบได้จริงและล้างข้อมูลจริง:**
     - **ห้าม `cd infra` แล้วรัน compose.** วัดจริงจาก `infra/` โดยไม่มี `COMPOSE_FILE`: `docker compose config -q` **exit 0 เงียบสนิท** · project เดียวกัน (`name: juneflow`) · volume เดียวกัน (`juneflow_pgdata`) · container ชุดเดิมทุกตัว — แต่ `migrate-seed` เป็น `pnpm --filter @juneflow/db migrate && pnpm --filter @juneflow/db seed` (= TRUNCATE) · postgres publish โดยไม่มี `host_ip` (ทุก interface) · `POSTGRES_PASSWORD: juneflow-dev` และ `BETTER_AUTH_SECRET: juneflow-dev-secret` ที่ commit ไว้ใน repo ถูกใช้จริง · **การป้องกันทั้งสามข้อของ overlay หายพร้อมกันหมด โดยไม่มี error สักบรรทัด** · guard จับได้ (exit 1) แต่จับได้ก็ต่อเมื่อ**มีคนรัน guard** — นี่คือเหตุผลที่ทุก `up` ในหัวข้อนี้ต้องมาพร้อม guard ในคำสั่งเดียวกัน
     - **ห้ามพิมพ์ `-f` เอง** — `-f` override `COMPOSE_FILE` ทั้งชุด = base ไฟล์เดียว = seed = TRUNCATE
     - **ห้ามถอยไปใช้ §1** — §1 คือเครื่อง dev ที่ DB ทิ้งได้ · ประตูใน §1 ข้อ 3/5 กันเครื่อง staging ไว้แล้วก็จริง แต่มันกันจากการมีไฟล์ `/etc/juneflow/…` เท่านั้น ถ้ากรณีที่ 2 คือไฟล์นั้นหาย ประตูนั้นก็เปิด

---

## 1.6) Deploy staging บนเครื่องที่ **เข้าถึงได้จากอินเทอร์เน็ต**

> **delta จาก §1.5 เท่านั้น** — ทุกอย่างที่ไม่ได้เขียนที่นี่เหมือน §1.5 ทุกประการ (overlay ผ่าน `COMPOSE_FILE` · ไม่มี `-f` · guard กับ `up` เป็นคำสั่งเดียว · ประตู seed ครั้งเดียวต่อเครื่อง)
> **§1.5 เขียนไว้บนสมมติฐานว่าเครื่องอยู่หลัง VPN** และ overlay ของมันจงใจปล่อย `api`/`web` ไว้บน binding ของ base คือ **ทุก interface** — คอมเมนต์ในไฟล์นั้นเขียนเงื่อนไขไว้เองว่า *"if this box ever grows a public interface, put an edge proxy in front of them rather than deleting this comment"*
> **เงื่อนไขนั้นเป็นเท็จแล้วสำหรับ `juneflow.app`** — โดเมนตอบเป็น IP ของเครื่องนี้แบบสาธารณะ · §1.6 คือการทำตามคำสั่งในคอมเมนต์นั้น **ไม่ใช่การผ่อนอะไรใน §1.5**

**วัดจริงว่า §1.5 เปิดอะไรไว้** (`docker compose -f base -f staging config`):

```
postgres=127.0.0.1:5432  redis=127.0.0.1:6379  api=0.0.0.0:3000  web=0.0.0.0:5173  edge=absent
```

`api` กับ `web` ออกทุก interface และไม่มีอะไรปิด TLS — บนเครื่องที่มี NIC สาธารณะ นี่คือ ERP ทั้งตัวบน HTTP เปล่า

1. **ไฟล์ที่เพิ่มเข้ามา** — `infra/docker-compose.public.yml` (overlay ใบที่ **สาม**) ถอน published port ของ `api`/`web` ทิ้งด้วย `ports: !override []` แล้วเพิ่ม service `edge` ถือ 80/443 · และ `infra/Caddyfile` เป็น config ของ edge

   ```bash
   sudo install -D -m 0644 infra/docker-compose.public.yml /etc/juneflow/docker-compose.public.yml
   sudo install -D -m 0644 infra/Caddyfile /etc/juneflow/caddy/Caddyfile
   # /etc/environment — ต่อ "ใบที่สาม" ท้ายสุด (ทุก path absolute):
   COMPOSE_FILE=<repo>/infra/docker-compose.yml:/etc/juneflow/docker-compose.staging.yml:/etc/juneflow/docker-compose.public.yml
   ```

   - `!override` เป็นกลไก **ไม่ใช่สไตล์** — compose **ต่อ** list `ports:` ข้ามไฟล์ ถ้าเขียน `ports: []` เฉยๆ มันจะ merge เข้ากับของ base แล้ว publish เหมือนเดิมทุกประการ · **วัดจริง:** ลบเฉพาะ tag ที่ `api` → `api is PUBLISHED to the host: ["0.0.0.0:3000"]` REFUSE · ลบเฉพาะที่ `web` → REFUSE เช่นกัน (กับดักตัวเดียวกับที่ §1.5 บันทึกไว้สำหรับ postgres/redis)
   - Caddyfile อยู่ **นอก checkout** ด้วยเหตุผลเดียวกับ overlay: rollback คือ `git checkout <SHA เขียวก่อนหน้า>` และทุก SHA ที่เก่ากว่า commit ของไฟล์นี้ไม่มีมัน — bind mount จาก repo จะ**หายกลางเหตุ** แล้ว edge สตาร์ตไม่ขึ้นบนเครื่องเดียวที่กำลังให้บริการอยู่

2. **เปิด 80/443 ที่ไฟร์วอลล์/security group ก่อน `up`** — ACME HTTP-01 ขอ cert โดยให้ Let's Encrypt ยิงกลับเข้ามาที่ **พอร์ต 80** ถ้า 80 ปิด edge จะขึ้นแต่ไม่มี cert แล้วอาการจะออกมาเป็น "เว็บเข้าไม่ได้" ไม่ใช่ "ไฟร์วอลล์ปิด"

   ```bash
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw status numbered
   ```

   - **วัดจริงจากนอกเครื่อง (2026-08-18):** `80 · 443 · 3000 · 5173 · 5432 · 6379` **ปิดหมดทุกพอร์ต** · 22 เปิด — ตอนนี้ยังไม่มีอะไรรั่ว เพราะยังไม่มี process ไหน listen อยู่
   - ⚠️ **ห้ามอ่านผลนั้นว่า "ไฟร์วอลล์กันให้อยู่แล้ว หลัง deploy ก็คงกันเหมือนเดิม"** — คอมเมนต์ใน `docker-compose.staging.yml` เขียนไว้ตรงประเด็นนี้: **docker แทรก DNAT rule ของตัวเองเข้า chain `DOCKER` ซึ่ง ufw ไม่ได้กรอง** พอร์ตที่ compose publish จึงตอบทุก interface **ไม่ว่า ufw จะว่าอย่างไร** · แปลว่าที่ `3000`/`5173` ปิดอยู่วันนี้คือ "ยังไม่มีใคร listen" ไม่ใช่ "ufw กันไว้" — วินาทีที่รัน §1.5 บนเครื่องนี้ ทั้งสองพอร์ตจะเปิดออกอินเทอร์เน็ตทันทีโดยไม่ต้องแก้ ufw เลย · **นี่คือเหตุผลที่ทางแก้คือถอน published port ไม่ใช่ตั้งกฎไฟร์วอลล์**

3. **guard ของ §1.6 ไม่ใช่ guard ของ §1.5** — guard ใน §1.5 ข้อ 4 ถามสามคำถามเรื่อง `migrate-seed`/`postgres`/`redis` เท่านั้น **มันไม่มี clause เรื่อง `api`/`web`/`edge` เลย จึงแยกเครื่องที่มี proxy กับเครื่องที่ยิง API ออกอินเทอร์เน็ตไม่ออก** — **วัดจริง: guard ของ §1.5 exit 0 ทั้งสองสภาพ** (มี public overlay และไม่มี) · บนเครื่องสาธารณะให้ใช้แบบหกข้ออ้างข้างล่าง guard กับ `up` เป็น **คำสั่งเดียว** เหมือนเดิม:

   ```bash
   docker compose config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let c;try{c=JSON.parse(s)}catch(e){console.log("REFUSE: config did not render");process.exit(1)}const S=c.services||{},bad=[],pubs=n=>((S[n]||{}).ports||[]).filter(p=>p.published!==undefined),cmd=(S["migrate-seed"]||{}).command;if((Array.isArray(cmd)?cmd.join(" "):String(cmd))!=="sh -c pnpm --filter @juneflow/db migrate")bad.push("migrate-seed is not the migrate-only half -> it would TRUNCATE");for(const n of ["postgres","redis"]){const p=pubs(n);if(!(p.length===1&&p[0].host_ip==="127.0.0.1"))bad.push(n+" is not exactly one loopback publish")}for(const n of ["api","web"]){if(pubs(n).length!==0)bad.push(n+" is PUBLISHED to the host -> reachable from the internet")}const e=S.edge;if(!e)bad.push("no edge service -> nothing terminates TLS");else if(pubs("edge").map(x=>String(x.published)).sort().join(",")!=="443,80")bad.push("edge does not publish exactly 80+443");if(bad.length){console.log("REFUSE:\n  - "+bad.join("\n  - "));process.exit(1)}console.log("ACCEPT")})' && docker compose up -d --build --wait || { echo '!! GUARD ไม่ผ่าน — ห้ามพิมพ์ up เอง → §1.5 ข้อ 8'; false; }
   ```

   - **อ่าน config เป็น JSON ทั้งก้อนครั้งเดียว แล้วเช็คทีละ service จากโครงสร้าง** ไม่ได้ grep บรรทัด — การปลอมด้วย newline ใน env ที่ §1.5 บันทึกไว้จึงใช้ไม่ได้ตั้งแต่ต้น (ค่าที่ parse แล้วงอกบรรทัดใหม่ไม่ได้) · **วัดจริง:** `POSTGRES_PASSWORD=$'x\n- pnpm --filter @juneflow/db migrate'` → REFUSE
   - **วัดจริง 9 สภาพ · fail-closed ทุกช่อง** — สภาพถูกต้อง ACCEPT exit 0 · ไม่มี public overlay REFUSE (บอกชื่อ service ที่เปิดอยู่) · base ไฟล์เดียว REFUSE (6 ข้อพร้อมกัน) · ลบ tag ที่ api REFUSE · ลบ tag ที่ web REFUSE · edge ไปอยู่ 8443 REFUSE · ลบ service `edge` ทิ้ง REFUSE · forge newline REFUSE · **จำนวนสภาพที่เปิดอยู่แล้ว ACCEPT = 0**

4. **`edge` ยังไม่ตัดสินว่าใช้ TLS จากไหน — ดู `B-418`** · PLAN.md §255 และ `infra/CLAUDE.md` ระบุสถาปัตยกรรมไว้ว่า **Edge = Cloudflare DNS+CDN+WAF+rate limit+Turnstile** และ `docker-compose.prod.yml` รอ Cloudflare Origin cert ที่ `${EDGE_TLS_DIR}` · แต่ **DNS ของ `juneflow.app` วันนี้ชี้ตรงมาที่ origin ไม่ได้ proxy ผ่าน Cloudflare** · `infra/Caddyfile` ที่วางไว้ใช้ ACME HTTP-01 (ขอ cert เองด้วยพอร์ต 80) ซึ่ง **ขึ้นได้โดยไม่ต้องมีบัญชี Cloudflare แต่ไม่ได้ WAF/rate limit/Turnstile ตามที่แผนเขียนไว้** — เลือกทางไหนเป็นคำตัดสินของ Wei ใน `B-418` **ห้ามเลือกเอง**
   - สิ่งที่ **ไม่** ขึ้นกับคำตัดสินนั้น: การถอน published port ของ `api`/`web` จำเป็น**ทั้งสองทาง** — ถ้าปล่อย `0.0.0.0:3000` ไว้ คนที่ยิงตรงเข้า IP **ข้าม Cloudflare ทั้งดุ้น** ต่อให้ DNS proxy แล้วก็ตาม

5. **สิ่งที่ §1.6 ไม่ได้แก้ — อย่าอ่าน TLS ว่า "แข็งแล้ว"**: ไม่มี rate limiting (โมดูล `rate_limit` ของ Caddy ต้อง build เอง `image: caddy:2` ไม่มีให้) · ไม่มี auth หน้า edge · **`B-406` ยังเปิดอยู่ — API log `req.url` + query ที่ level 30 คือ PII ลง container log** ซึ่งตอนยื่นเรื่องยังเชื่อกันว่าเครื่องนี้อยู่หลัง VPN · ทั้งหมดอยู่ใน `BLOCKERS.md`

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

> **บนเครื่อง staging: ห้ามพิมพ์ `-f` ในหัวข้อนี้เหมือนกัน** — §1.5 ข้อ 8 ห้ามไว้ และ §1.5 ข้อ 5/ข้อ 6 ส่งเคส "ข้อมูลโดนล้าง" มาที่หัวข้อนี้โดยตรง คนที่มาถึงนี่คือคนที่เพิ่งโดนของจริง · `stop`/`exec`/`start` ตัวมันเองไม่ seed ก็จริง (จึงไม่ล้างซ้ำ) แต่การพิมพ์ `-f infra/docker-compose.yml` ติดมือใน §3 คือการฝึกมือไว้พิมพ์ `-f … up` ต่อในย่อหน้าถัดไป ซึ่ง**ล้างข้อมูล** · บน staging ให้ตัด `-f infra/docker-compose.yml` ออกทุกคำสั่งในหัวข้อนี้ (`COMPOSE_FILE` ต่อไฟล์ให้แล้ว · วัดจริงว่าเป็น project `juneflow` ตัวเดียวกันทั้งสองทาง จึงเป็น container ชุดเดียวกัน) · บรรทัดที่เขียน `-f` ไว้ข้างล่างนี้คือรูปสำหรับ **dev** (`COMPOSE_FILE` ไม่ได้ตั้ง) · prod ใช้ `-f infra/docker-compose.prod.yml`

1. หยุดตัวเขียนก่อนกู้ (dev ใช้ไฟล์ dev · prod ใช้ไฟล์ prod · staging ไม่ใส่ `-f`):

   ```bash
   docker compose -f infra/docker-compose.yml stop api worker
   ```

2. เลือกไฟล์ backup ล่าสุดที่ต้องการ (path / รอบ backup ตาม env ของ host)
3. กู้เข้า service `postgres` — **`sh -c '…'` single quote บังคับ ด้วยเหตุผลเดียวกับ §1.5 ข้อ 7 (ข)**:

   ```bash
   docker compose -f infra/docker-compose.yml exec -T postgres \
     sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < <backup-file>
   ```

   (backup แบบ plain SQL ใช้ `sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -'` แทน)

   - **ทำไมต้อง `sh -c` (ไม่ใช่ของประดับ เหมือน ข้อ 7 (ข) เป๊ะ):** `$POSTGRES_USER`/`$POSTGRES_DB` มีค่าอยู่ใน **container** (base ตั้งที่ `services.postgres.environment`) และใน `infra/.env` ซึ่ง **compose อ่าน แต่ shell ของคนพิมพ์ไม่ได้อ่าน** — เขียนลอยๆ นอก `sh -c` เชลล์ของ operator จะแทนค่าให้ก่อนส่ง วัดจริงได้ argv `[pg_restore] [-U] [] [-d] [] [--clean] [--if-exists]` = **คำสั่งกู้ที่พังตั้งแต่ยังไม่เริ่มกู้** · ใส่ single quote แล้วการแทนค่าเลื่อนไปเกิดในตัว container วัดจริงได้ `[pg_restore] [-U] [juneflow] [-d] [juneflow] [--clean] [--if-exists]`
   - `< <backup-file>` ยังอยู่ **นอก** `sh -c` โดยตั้งใจ — ไฟล์ backup อยู่บนโฮสต์ ไม่ใช่ในคอนเทนเนอร์ · `-T` ปิด TTY ให้ stdin ไหลผ่านเข้าไปได้ (วัดจริง: ข้อความจาก stdin ฝั่งโฮสต์ไปถึงคำสั่งใน container ครบ)
   - บรรทัดนี้กับ §1.5 ข้อ 7 (ข) เป็นสองที่**เดียว**ในไฟล์นี้ที่ใช้ตัวแปรฝั่ง container (ไล่ทั้งไฟล์แล้ว) · ที่เหลือ (`$(git rev-parse …)`, `${COMPOSE_FILE:-…}`, `$(docker compose ps -q postgres)`) ตั้งใจให้แทนค่าที่เชลล์ของ operator ซึ่งถูกต้องแล้ว · **เพิ่มคำสั่งใหม่ที่ใช้ `$POSTGRES_*` เมื่อไร ต้องอยู่ใน `sh -c '…'` เสมอ**
4. start กลับ:

   ```bash
   docker compose -f infra/docker-compose.yml start api worker
   ```

   → ตรวจ health endpoint + spot-check จำนวน record เทียบ `docs/extract/MOCK-DATA.md` §สรุป (กรณี dev ที่กู้จาก seed baseline)
5. บันทึกเหตุการณ์ (เวลา · ไฟล์ backup ที่ใช้ · ผลตรวจ) ลง `agents/journal/devops.md` · สาเหตุที่ทำให้ต้อง restore → พิจารณาเปิด `BLOCKERS.md` แจ้ง Wei
