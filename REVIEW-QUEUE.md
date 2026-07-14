# REVIEW-QUEUE.md — คิวงานเขียวบน dev รอ Wei promote

> ตาม PLAN.md §10 Review flow: `feature → dev (auto เมื่อ CI เขียว) → main (Wei promote คนเดียว)`
> Wei ตรวจเป็น batch: อ่านคิวนี้ + `BLOCKERS.md` → คลิกเล่นบน dev เทียบ gallery → ผ่าน = promote / ไม่ผ่าน = rework task

## วิธีใช้

**ฝั่ง agent:**

1. task ผ่าน gates ครบ (ตามคอลัมน์ gates ใน `TASKS.md`) และ auto-merge เข้า `dev` แล้ว → เพิ่มหนึ่งแถวในตารางด้านล่าง
2. เปลี่ยนสถานะ task ใน `TASKS.md` เป็น `review` + เขียน journal ประจำรอบ
3. คอลัมน์ **diff** = ลิงก์/ref ของ commit หรือ PR ที่ merge เข้า dev · คอลัมน์ **ภาพเทียบ gallery** = path screenshot จอที่สร้าง คู่กับ path ภาพอ้างอิงใน `tests/visual/reference/` (งานที่ไม่มีจอ เช่น schema/script → ระบุ "—" พร้อมหลักฐาน gate ที่ใช้แทน)

**ฝั่ง Wei:**

1. ไล่ตรวจจากแถวเก่าสุด → คลิกเล่นบน dev เทียบ gallery
2. **ผ่าน** = promote เข้า `main` → เปลี่ยนสถานะ task ใน `TASKS.md` เป็น `done` → ลบแถวออกจากคิวนี้
3. **ไม่ผ่าน** = สร้าง rework task ใน `TASKS.md` (สถานะ `ready` ระบุสิ่งที่ต้องแก้) → ลบแถวออกจากคิวนี้

## คิวรอ promote


| task id | โมดูล | diff | ภาพเทียบ gallery | วันที่ |
|---|---|---|---|---|
| P1-WEB-08 | web · port `master.company` (MasterCompany + OrgAddForm จาก `pototype/master.jsx` L20-234) | merged dev `33b0860` (gate-4.5 inline PASS · B-056 edit-chrome fix) + glyph fix `08b55f7` (toast {name} ASCII→curly · C-022) — จอใหม่ `apps/web/src/screens/master/` (master-company.tsx · org-add-form.tsx · use-org-units.ts · org-tree.ts + test · org-strings.json) + register `router.tsx` `PORTED_SCREENS["master.company"]` + `topbar.tsx` breadcrumbs `NavKey[]→ReactNode[]` (จอแรกที่ mix dict+nav crumb · ตรง ds.jsx Page display-string) · **data generated client เท่านั้น**: `GET /org-units` (envelope `.data` → pre-order tree → nested+collapse) · POST/PUT/DELETE `/org-units` (add company lvl0/dept/sub · edit partial-merge · delete cascade · parent ผูก `id` · mutation→invalidate) · **i18n key ล้วน** org.*+common.* dict + phrase `บริษัท` ผ่าน `org-strings.json` (กัน i18n-guard) + §8 residual org.unitDept/unitSub/syncStatus + note* 4 + toast* 4 (`{name}`/`{code}` interpolate) · 0 hardcode ไทย (code+comment English) · tokens ล้วน (literal เฉพาะ radius7/shadow ที่ prototype hardcode · B-037) · `ds.jsx` ไม่มี `trash` glyph → blank (§0 ห้าม invent) · native `<select>` แทน Dropdown popover (modal ไม่มี ref · shared primitive แยก task) · **ไม่ใช้ GET /companies** (prototype ใช้ list เดียว lvl0-2 · count จาก org-units lvl0 · fidelity-first) | **G5 live compose** (`POSTGRES_PORT=5433 docker up --wait` · login `somchai@rungrueang.co.th` · vite dev + temp `/api` proxy — revert แล้ว): shot 1600x1000 `/master.company` ↔ **ref=tests/visual/reference/gallery/g2/28-s.jpg** → **screen body = PASS** (เกณฑ์ human skill visual-gate): title "Company / Organization" · subtitle · card header **"โครงสร้างองค์กร · 3 บริษัท · 7 แผนก" ตรงเป๊ะ** · sync SAP line · **10 rows nested** (lvl0 brand-soft+border · lvl1 surface-2 · lvl2 transparent · icon+name+code-badge+note+kebab) · breadcrumb **"ข้อมูลกลาง › Company / Org"** · action **"+ เพิ่มบริษัท / หน่วยงาน"** · **modal OrgAddForm render ตรง prototype** (kind toggle บริษัท/แผนก · fields+placeholder+buttons) · **region pixel diff (TOL48):** whole=5.01% · content(x≥244,y≥56)=4.11% · org-card=4.00% — **ทั้งหมด = shell chrome + seed data** (ไม่ใช่ body จอ): (1) topbar back-nav strip อยู่ใน ref capture แต่ ported shell ไม่ render → content offset ~44px uniform (ghost ใน heatmap) (2) sidebar C10 badge + pkg-menu (exec ซ่อน) = live query ≠ mock hardcode (3) switchers vs back-button — **§0 อนุญาต "ต่างได้: ตัวเลขข้อมูล seed"** · body เอง identical · API verify: `GET /org-units` = 3 บริษัท/7 แผนก ตรง seed · **CI:** typecheck ✓ · vite build (217 modules) ✓ · **63 web unit** (+10 org-tree) ✓ | 2026-07-14 |

> ✅ **batch #3 (21 งาน) promoted → `main` `43e0b70` เมื่อ 2026-07-14** — sacred rounds 4 (i18n §1/§5/§7/§8 + envelope B-014 + contract §4/§6) · routes 6 · shell 5b · Dart regen · audit อิสระ 14-agent = 0 blocker (main tree == fde14e6 เป๊ะ · diff ว่าง) · queue เคลียร์ · **batch #4 เริ่มสะสมจาก WEB-08 (master.company กำลัง port)**
> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)
