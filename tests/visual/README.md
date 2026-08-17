# tests/visual/ — Visual gate harness (Gate G5)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## กติกา visual gate (นิยามการ "ตรง Design" — PLAN.md §0)

- ทุกจอที่สร้างต้อง screenshot เทียบภาพอ้างอิงใน `tests/visual/reference/`
- สิ่งที่ต้องตรง: **โครงเลย์เอาต์ · ลำดับ/ป้ายเมนูและคอลัมน์ · token สี · ตำแหน่ง KPI/ปุ่ม/แท็บ**
- ต่างได้เฉพาะ: **ตัวเลขข้อมูล (มาจาก seed)** และสิ่งที่ Wei อนุมัติผ่าน `BLOCKERS.md`
- **จอที่ไม่มีภาพอ้างอิง → เปิด `pototype/Juneflow Fiori.html` จอเดียวกัน แคปเป็น reference ก่อนเริ่มสร้าง**

## reference/ (ความจริงของ visual gate)

- ก๊อปจาก `pototype/gallery/g1–g5` (**106 .jpg — ใช้ทั้งหมด** ดู B-001) + `pototype/shots/` (22 .png) ผ่าน `scripts/copy-references` (P0-BE-03)
- **ห้ามแก้/ลบ/เขียนทับไฟล์ใดๆ ใน `reference/`** — ไฟล์ต้นทางใน `pototype/` ก็ห้ามแตะเช่นกัน
- index ภาพ→จอ/route (จาก `docs/extract/NAV-ROUTES.md`) อยู่ที่ `tests/visual/reference-index.md` — P0-QA-01

## สถานะ (P0-QA-04 — harness implemented)

- **harness:** `visual-gate.spec.ts` + `lib/compare.ts` (jpg-aware compare) + `lib/report.ts` (readable diff report) · config: `playwright.visual.config.ts`
- **รองรับ jpg โดยไม่แตะ reference:** `toHaveScreenshot()` เทียบ .png เท่านั้น แต่ 106/128 reference เป็น .jpg → `lib/compare.ts` decode ทั้ง jpg + png ด้วย chromium ที่ Playwright ใช้อยู่แล้ว (ไม่เพิ่ม native dep) แล้ว pixel-diff ในเบราว์เซอร์ · **อ่านไฟล์ `reference/` อย่างเดียว ห้ามเขียนทับ**
- **สองโหมด:**
  - `self-check` — รันได้ทันที ไม่ต้องมีแอป: พิสูจน์ pipeline (decode → diff → report) กับ reference จริง (identical=PASS 0 diff · perturbed=FAIL · size mismatch=auto-FAIL) — นี่คือหลักฐาน "G5 harness รันได้ + รายงาน diff อ่านได้" ก่อน apps/web จะมี
  - `capture` — screenshot จริงเทียบ reference ตาม `screens.manifest.json` (ยังว่างจนกว่าจอ apps/web จะมา · map route→ref อยู่ที่ `reference-index.md`) · **skip** (ไม่ fail) เมื่อ manifest ว่าง หรือ `VISUAL_BASE_URL` ไม่ถึง → gate เขียวระหว่าง scaffold
- **รายงาน diff:** `.results/visual-report.md` + `.results/visual-report.json` + `.results/diff/*.png` (gitignored — ไม่อยู่ใน `reference/`)
- **threshold เริ่ม strict** (`VISUAL_MAX_DIFF_PIXEL_RATIO=0`, `VISUAL_CHANNEL_THRESHOLD=0`) — การผ่อน threshold สำหรับ jpg lossy ของจอจริง = คำตัดสินของ Wei/BLOCKERS ไม่ใช่ default เงียบ ๆ (skill `visual-gate` กฎเหล็ก)
- **Mask regions (P0-QA-07 · B-044):** ยกเว้นเฉพาะสี่เหลี่ยมที่ Wei อนุมัติจากการนับ diff — **opt-in ต่อจอ** ผ่าน field `masks` ใน `screens.manifest.json` (คีย์จาก `lib/masks.ts` `MASK_REGISTRY`) · ทุก region ต้องมี `reason` อ้าง id ใน `BLOCKERS.md` (บังคับ runtime — ไม่มี citation = throw) · ไม่ใช่การผ่อน threshold ทั่วไป · **dimension mismatch ยัง auto-FAIL เสมอ** (mask ช่วยไม่ได้ — P0-FIX-04 คงเดิม) · จำนวน masked px + จำนวนที่ต่างจริงในนั้นถูกรายงานใน `visual-report.md` (คอลัมน์ `masked px`) และย้อมน้ำเงินใน diff PNG
  - mask ปัจจุบัน: `sidebar-logo-b044` = กล่องโลโก้ sidebar (wordmark + tagline) rect x8 y6 w224 h56 — วัดจาก `reference/gallery/g1/01-s.jpg` (1600x1000: lockup x16..124 y16..55 · เส้นแบ่ง y64 · ปุ่ม toggle y≈69) — reference ทุกใบเป็น logo lockup รุ่นเก่า (`juneflow / Construction ERP`) ส่วน port ใช้ `t("app.name")` th=`ระบบงานก่อสร้าง` (B-044(ก) Wei ตัดสิน 13 ก.ค.) · จอที่ไม่มี sidebar lockup (เช่น login — P1-WEB-01) **ห้ามใส่** mask นี้
- **รัน:** `pnpm --filter @juneflow/tests test:visual`
- **⚠️ ต้องมี session เสมอเมื่อแอปขึ้นจริง (B-411 — เปลี่ยนพฤติกรรมเมื่อ 17 ส.ค. 69):** ถ้า `VISUAL_BASE_URL` ชี้ไปที่แอป Juneflow จริงแต่ไม่ได้ตั้ง `VISUAL_STORAGE_STATE` (หรือ token ใช้ไม่ได้) **gate จะปฏิเสธทั้งรอบตั้งแต่ก่อนถ่ายจอแรก** ไม่ใช่ถ่ายไปเรื่อย ๆ แล้วแดง
  - เหตุผล: baseline ถ่ายในฐานะผู้ใช้ที่ล็อกอิน จอที่ล็อกเอาต์จึงไม่มีทางตรง **และแดงในรูปทรงเดียวกับ drift** จนอ่านไม่ออก — วัดแล้วบนสแต็กเดียวกัน pack เดียวกัน ต่างกันแค่ session: **มี session ตก 11 จอ (เช้า) / 14 จอ (บ่ายวันเดียวกัน — เซตโตตามเวลา) · ไม่มี session ตก 98 จอ และจอเดียวที่ผ่านคือ `login`** ซึ่งเป็นจอเดียวที่ไม่เรียก API
  - CI ทำให้เองแล้วใน `.github/workflows/ci.yml` step `Mint the visual-gate session (B-411)` · รันในเครื่องให้ทำแบบเดียวกัน (login → เขียน storageState → ส่ง `VISUAL_STORAGE_STATE`) ตามตัวอย่างในหัวข้อ promote ด้านล่าง
  - `appReachable` เข้มขึ้นพร้อมกัน: ต้องได้ 200 **และ** เจอ `<title>Juneflow</title>` + `id="root"` — เดิมรับทุก status < 500 ทำให้ dev server ของคนอื่นบนพอร์ตเดียวกันถูกนับว่า "แอปขึ้นแล้ว" (วัดจริง: โปรเซสอื่นบน `:5173` ตอบ 404 แล้วเช็คเดิมบอกว่าถึง)

## Promote mode — re-baseline `reference/app-baseline/` (B-409)

> **นี่คือการเขียนทับ "ผู้ตัดสิน" ของ design fidelity (PLAN.md §0 ข้อ 4)** — ไม่ใช่คำสั่งอำนวยความสะดวก
> ต้องมี blocker id ที่ Wei อนุมัติ (ตอนนี้คือ **B-409**) ทุกครั้ง ห้ามรันเพื่อ "ทำให้ gate เขียว"

การ re-baseline ครั้งก่อน (`91dee5c`) ทำด้วยสคริปต์เฉพาะกิจนอก repo — พิกเซลอยู่รอด แต่**กลไกหายไปทั้งหมด**
โหมดนี้คือกลไกถาวรที่ตรวจสอบย้อนหลังได้ อยู่ใน `lib/promote.ts` + capture path เดียวกับโหมดเทียบภาพ

### รันอย่างไร

**สร้าง storageState ก่อน** (จำเป็นทั้งโหมดเทียบภาพและโหมด promote ตั้งแต่ B-411 — CI ทำขั้นตอนนี้เองใน step `Mint the visual-gate session`):

```bash
BASE=http://localhost:5173
TOKEN=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).token||"")})')
[ -n "$TOKEN" ] || { echo "login failed — the gate would capture logged-out screens"; exit 1; }
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({cookies:[],origins:[{origin:process.argv[2],localStorage:[{name:"juneflow-token",value:process.argv[3]}]}]}))' \
  /tmp/juneflow-visual-state.json "$BASE" "$TOKEN"
```

`origin` ต้องตรงกับ `VISUAL_BASE_URL` เป๊ะ (Playwright จับคู่ origin แบบตรงตัว) และคีย์คือ `juneflow-token` ตาม `apps/web/src/auth-token.ts`

```bash
# ต้องมี stack สดที่ seed แล้ว (isolated) + storageState จากขั้นตอนข้างบน
VISUAL_BASE_URL=http://localhost:5173 \
VISUAL_STORAGE_STATE=/tmp/juneflow-visual-state.json \
VISUAL_PROMOTE_EXPECT_USER=wipha@rungrueang.co.th \
VISUAL_PROMOTE_BASELINE=1 \
SEED_FROZEN_NOW=2026-08-07T12:22:42+07:00 \
pnpm --filter @juneflow/tests test:visual
```

`SEED_FROZEN_NOW` คือ instant ที่ pack ถูกถ่าย — ตรึงไว้ตอนถ่ายด้วย ไม่งั้นแพ็กใหม่จะเริ่ม drift ตั้งแต่วันรุ่งขึ้น (B-409)

- `VISUAL_STORAGE_STATE` **บังคับทั้งสองโหมด** ตั้งแต่ B-411 (เดิมบังคับเฉพาะ promote) — ไม่ตั้งแล้วแอปขึ้นจริง = ปฏิเสธทั้งรอบก่อนถ่ายจอแรก
- `VISUAL_PROMOTE_EXPECT_USER` ไม่บังคับ · ตั้งไว้แล้ว `/me` ต้องตอบเป็นผู้ใช้คนนั้นพอดี (แพ็กที่ถ่ายด้วยผู้ใช้ผิด = เมนู/สิทธิ์ผิดฝังลงไปทั้งแพ็ก)

- `VISUAL_PROMOTE_BASELINE` **ปิดโดย default** — รับเฉพาะค่า `1` หรือ `true` เท่านั้น (`0`/`false`/`yes`/ค่าว่าง = ปิด)
  ถ้าไม่ตั้ง ตัว gate ทำงานเหมือนเดิมทุกประการ (เทียบภาพ ไม่เขียนอะไรเลย)
- เปิดแล้วจะพิมพ์แบนเนอร์บอกชัดว่ากำลังจะ **เขียนทับ** reference กี่ใบ และไม่มีการเทียบภาพในรอบนั้น
- **ปฏิเสธถ้า `CI` ถูกตั้ง** — re-baseline คือการกระทำที่มีคนอนุมัติ ไม่ใช่ผลข้างเคียงของ pipeline
- `protect-files.sh` กัน *agent tool-write* ที่ `tests/visual/reference/**` แต่**ไม่เห็น**การเขียนของ node process
  ฉะนั้นอำนาจที่แท้จริงคือ id ใน `BLOCKERS.md` (+ `SACRED_OVERRIDE=wei-approved:B-409` สำหรับขั้นตอนที่ agent แตะไฟล์เอง) — เป็นวินัยเชิงกระบวนการ ไม่ใช่ hook

### สิ่งที่โหมดนี้ **ไม่** ทำ

- ไม่แก้ `screens.manifest.json` (แถว/route/masks เหมือนเดิม) · ไม่เพิ่มจอใหม่ · ไม่สร้าง reference ใบใหม่
- จอใหม่ที่ยังไม่มี reference = NEW-REF round ตาม skill `visual-gate` §4-3 ไม่ใช่ promote

### ด่านที่ทำให้ปลอดภัย (นี่คือของจริงของโหมดนี้ ไม่ใช่ตัวเขียนไฟล์)

| ด่าน | ปฏิเสธเมื่อ |
|---|---|
| 0 · **auth pre-flight** (ก่อนถ่ายจอแรก · **ตั้งแต่ B-411 ทำงานทั้งโหมดเทียบภาพและโหมด promote ไม่ใช่เฉพาะ promote**) | ไม่มี `VISUAL_STORAGE_STATE` · ไฟล์ไม่มี/ไม่ใช่ JSON · ไม่มีคีย์ `juneflow-token` (หรือค่าว่าง) · `GET {base}/api/v1/me` ตอบ 401/403 (token หมดอายุ) · ตอบไม่ใช่ JSON (proxy เสิร์ฟ index.html) · ไม่มี `user.email` · ไม่ตรง `VISUAL_PROMOTE_EXPECT_USER` · API ไม่ตอบเลย |
| 1 · opt-in | ไม่มี env = ไม่มีทางเขียน · เปิดใน CI = ปฏิเสธ |
| 2 · เฉพาะ path ที่ manifest ประกาศ **และมีอยู่แล้ว** | ref หาย/พิมพ์ผิด · ไม่ใช่ `.png` · หลุดออกนอก `app-baseline/` (รวม `..`, absolute, **symlink** — เช็คด้วย realpath) · 2 จอชี้ ref เดียวกัน → **ปฏิเสธทั้งรอบ ไม่ promote บางส่วน** · ref ที่ **หายไประหว่างรอบ** ถูกเช็คซ้ำตอน commit (ไม่ปั้นใบใหม่คืนมา) |
| 2 (ต่อ) · **ชื่อไฟล์ ref ชนกัน** | ref สองแถวที่อยู่คนละโฟลเดอร์แต่ **ชื่อไฟล์เดียวกัน** (เทียบแบบไม่สนตัวพิมพ์ เพราะ macOS folds case) — staging คีย์ด้วย basename ทุก target ที่ชนกันจึงได้พิกเซลของ capture ตัวสุดท้าย · **ไม่มีด่านไหนข้างหลังจับได้เลย**: ด่าน 3/3b แฮชบัฟเฟอร์ตอน stage ไม่ใช่ไฟล์ที่เขียนจริง วัดแล้วว่าชน 2 ใบ → `COMMITTED 2 · duplicateGroups: []` และชน 3 ใบ → `COMMITTED 3 · duplicateGroups: []` · ตอนนี้ ref ทุกใบแบนและไม่ซ้ำ ด่านนี้จึงกันรูปทรงที่ยังไม่เกิด |
| 2b · **path ของ artifact ที่ผู้รันตั้งเอง** (`stagingDir` · `manifestPath`/`VISUAL_PROMOTE_MANIFEST` · `evidencePath`) | ตกลงไปใน pack (รวม pack root เอง และ **symlink ancestor** — เช็คด้วย realpath ของ ancestor ที่มีอยู่จริง) · path ที่มีอยู่แล้วแต่ไม่ใช่ไฟล์ธรรมดา → **ปฏิเสธ ไม่ย้ายที่เขียนให้เงียบ ๆ** |
| 3 · **B-155 detector** | hash ภาพซ้ำเกิน `MAX_IDENTICAL_GROUP=2` จอต่อภาพ · หรือ distinct/total < `MIN_DISTINCT_RATIO=0.9` เมื่อมี ≥ 10 จอ — รายงานกลุ่มซ้ำ **เป็นชื่อจอ** พร้อมตัวเลขให้คนตัดสิน |
| 3b · **near-duplicate detector** | ภาพที่ "เกือบ" เหมือนกัน (ไม่ใช่แค่ byte-identical) — ระยะ mean-luma บนกริด 16×16 ≤ `MAX_NEAR_DUP_DISTANCE=0.35` ถือเป็นกลุ่มเดียวกัน แล้วใช้ cap/ratio เดิม · คู่ที่ห่าง ≤ `NEAR_DUP_ADVISORY_DISTANCE=1.5` **รายงานเฉย ๆ ไม่ปฏิเสธ** |
| 4 · manifest ของสิ่งที่เขียน | (ไม่ใช่การปฏิเสธ) `.results/promote-manifest.txt` — sha256 · bytes · **WxH** · screen · route · ref เรียงคงที่ ไม่มีเวลา/ไม่มี path เฉพาะรอบ |
| 5 · ห้าม promote capture ที่พัง | nav error · HTTP ≥ 400 · **HTTP status = null** (goto คืน null = same-document nav → เช็คไม่ทำงาน ไม่ใช่ "ผ่าน") · uncaught page error · **console error ที่เป็น 401/403/failed-to-fetch** · ภาพ 0 byte/ไม่ใช่ PNG/ขนาดไม่ตรง viewport · **body ยาว 0 ตัวอักษร** (หน้าเปล่า) หรือ probe ไม่ทำงาน · **ไม่มี `juneflow-token` ใน localStorage ตอนถ่าย** (capture ที่ไม่ได้ล็อกอิน) · **API ของจอนั้นตอบ 401/403** (session หมดอายุกลางรอบ) · **ไม่ได้วัดจำนวน request ของจอนั้น** (ไม่ว่าจะเป็น `apiRequests` หรือ `apiUnauthorized`) — ทำให้ด่าน 6 ได้ pack ที่ "วัดครบทุกจอ" เสมอ · **landing pathname ไม่ตรง route** (B-155 รายจอ) |
| 6 · **ทั้ง pack ไม่เคยเรียก API เลย** (B-410) | ทุกจอที่วัดได้มี `apiRequests = 0` และมีจอที่วัดได้ ≥ `MIN_MEASURED_SCREENS=5` — คือแอปเรนเดอร์ครบแต่ไม่เคยคุยกับ API เลย · **ทำงานก่อนด่าน 3/3b** เพื่อให้ผู้รันได้ "สาเหตุ" ไม่ใช่ "อาการ" · ขอบเขตที่ซื่อสัตย์: จับเฉพาะกรณีทั้ง pack (ครึ่ง ๆ ไม่จับ) · จอที่วัดไม่ได้ถูกข้าม ไม่นับเป็นศูนย์ · นับ **request** ไม่ใช่ข้อมูลที่ตอบกลับ (เคส "ยิงแล้วได้ index.html 200" เป็นหน้าที่ด่าน 0) · ตัวนับดู URL ที่มี `/api/v1` ดังนั้น base url ที่ไม่มี path นี้จะอ่านได้เป็นศูนย์ |

**ทำไมเส้นของด่าน 3 อยู่ตรงนี้:** B-155 คือรอบที่ spec ใช้ hash nav ทั้งที่แอปใช้ browser-path → ทุก route ตกไป `/dashboard`
→ **baseline 28 ใบเป็นภาพ dashboard ทั้งหมด · gate กลายเป็น no-op และไม่มีใครเห็นเป็นสัปดาห์**
สองจอที่ต่าง route แล้วได้ภาพ byte-identical ยัง "พอเป็นไปได้" (empty state เหมือนกัน) → อนุญาตเป็น **คู่** และรายงานไว้
สามจอขึ้นไป = รูปทรงของ B-155 ในสเกลเล็ก → ปฏิเสธ · ต้นทุนของการปฏิเสธผิด = คนดูรายชื่อกลุ่มหนึ่งครั้ง · ต้นทุนของการรับผิด = gate ที่ไม่ได้ทดสอบอะไรเลย
ส่วนกรณี "พังแบบกระจาย" (เช่น 40 คู่ ผ่าน cap ได้หมด) ถูกจับด้วย ratio (แพ็ก `app-baseline` ปัจจุบัน = 99 ใบ **distinct 99/99**)

### ทำไมต้องมีด่าน 0 และเช็ค auth รายจอ (วัดจริง 2026-08-17)

**`apps/web` ไม่ได้ gate router ด้วย auth** — bearer token คุมแค่ชั้น API (`src/api-client.ts` + hooks ใน `src/shell/use-shell-data.ts`)
ไม่ได้คุม navigation · ผลคือรอบ promote ที่ `VISUAL_STORAGE_STATE` **หายหรือหมดอายุ** จะได้ capture ที่
**route ถูกต้อง · HTTP 200 · และภาพต่างกันทุกจอ** (chrome เต็ม body ว่าง/error) — ผ่านด่าน 5 เดิม**ทั้งหมด** และถูก promote
กลายเป็นการเอา "แพ็กที่ไม่ได้ล็อกอิน" มาเป็นนิยามของคำว่าถูกต้อง

สองโหมดพังนี้ **ลายเซ็นต่างกัน** จึงต้องใช้สัญญาณคนละตัว (อ่านจากซอร์ส ไม่ใช่เดา):

| โหมดพัง | เกิดอะไร | สัญญาณที่จับได้ |
|---|---|---|
| ไม่มี token | `authed()` เป็น false → hooks **ไม่ยิงเลย** → API request = 0 (ไม่มีอะไร 401 เพราะไม่มีอะไรถาม) | ไม่มี `juneflow-token` ใน localStorage ตอนถ่าย |
| token หมดอายุ | hooks ยิง → `tenant-scope.ts` fail closed **401 UNAUTHENTICATED** ทุก path | นับ response 401/403 ของจอนั้น |

**ทำไมไม่ false-positive กับจอที่ว่างโดยธรรมชาติ:** จอว่างโดย design ได้ 200 + list ว่าง และยังมี token อยู่ —
"ว่าง" เป็นคุณสมบัติของ **data** ส่วนสัญญาณสองตัวข้างบนเป็นคุณสมบัติของ **session** · จอ static/placeholder ที่ไม่เรียก API เลย
รายงาน `apiRequests=0 / apiUnauthorized=0` และถูกตัดสินด้วย token อย่างเดียว ซึ่งมันยังมี
(มีเทสต์ยืนยันตรง ๆ: `a legitimately EMPTY screen still promotes`)

**ด่าน 0 ทำให้ทั้งหมดนี้ถูก:** เช็ค **ครั้งเดียวก่อนถ่ายจอแรก** ว่า storageState มี token จริง และ API ตอบ `/me` เป็น 200 ในนามผู้ใช้ที่คาดไว้
รอบที่ไปเจอปัญหา auth ตอนจอที่ 73 = เสียรอบไปแล้ว (commit เป็น all-or-nothing อยู่แล้ว) · เจอตอนจอ 0 = ไม่เสียอะไรเลย

### near-duplicate detector — ตัวเลขที่ใช้ตั้งเส้น (วัดจากแพ็กจริง ไม่ใช่เดา)

ด่าน 3 เดิมดู **byte identity** อย่างเดียว → verifier promote ภาพ**หน้าเดียวกัน 12 ใบที่ต่างกัน 1 pixel** ได้สำเร็จ (sha ต่างกัน 12 ค่า · duplicate group = 0)
สำคัญกับแอปนี้เป็นพิเศษเพราะ route ที่ยังไม่ port เรนเดอร์ `<Placeholder routeId>` — ชื่อ title มาจาก route id → **ต่าง pixel แต่โครงเดียวกัน**

วิธีวัด: ย่อภาพเป็นกริด 16×16 ของค่า luminance เฉลี่ย แล้วเทียบ mean absolute difference ต่อ cell (สเกล 0..255)
คาลิเบรตกับ **แพ็กจริงทั้ง 99 ใบ (4851 คู่ · รู้ว่า distinct จริงทั้งหมด)**:

| | ระยะ |
|---|---|
| คู่ที่ใกล้ที่สุดในแพ็กจริง | **0.677** (`sales-down.png` ↔ `sales-loan.png`) |
| percentile ที่ 1 | 1.626 |
| median | 4.267 |
| ต่าง 1 pixel (การโจมตีของ verifier) | 0.00009 |
| ต่างเป็นบล็อก 60×60 px | 0.336 |
| ต่างแค่ title 250×28 px | 0.49–0.55 |
| placeholder จริง (title + แถบ sidebar ที่ active) | ~1.33 |

→ ตั้ง `MAX_NEAR_DUP_DISTANCE = 0.35` · **false positive ที่วัดได้ = 0 จาก 4851 คู่** (ห่างจากคู่ที่ใกล้ที่สุด 1.93 เท่า)
ขณะที่การโจมตี 1 pixel อยู่ต่ำกว่าเส้น ~3900 เท่า

**ขอบเขตที่จับได้จริง (ไม่ขยายความ):** จับคู่ที่ต่างกัน**น้อยกว่าประมาณบล็อก 60×60 px (0.22% ของเฟรม)**
**จับไม่ได้**: คู่ placeholder ที่ต่างแค่ title (0.49–0.55) เพราะแพ็กจริงมีคู่ที่ distinct จริงซึ่ง**ใกล้กว่านั้น** (0.677) —
ไม่มี threshold ไหนบนเมตริกนี้แยกสองอย่างนี้ออกจากกันได้ · จึงมีแถบ **advisory ≤ 1.5** ที่**รายงานอย่างเดียว ไม่ปฏิเสธ**
(ถ้าปฏิเสธที่ 1.5 จะ false positive **35 คู่จาก 4851** ในแพ็กจริง = gate ที่คนจะเรียนรู้ที่จะข้าม)
เทสต์ `the REAL 99-file pack produces ZERO near-duplicate groups` วัดตัวเลขนี้ซ้ำทุกครั้งที่รัน (อ่านอย่างเดียว ไม่เขียน `reference/`)

### เงื่อนไข 2 รอบ (พิสูจน์ก่อน promote ไม่ใช่หลัง — B-409 ข้อ ก)

1. รอบที่ 1: ยก stack สดที่ seed แล้ว → รัน promote → เก็บ `.results/promote-manifest.txt` ไว้เป็น `run-1.txt`
2. รอบที่ 2: **ยก stack ใหม่อีกรอบ (seed ใหม่)** → รัน promote อีกครั้ง → ได้ `run-2.txt`
3. `diff run-1.txt run-2.txt` **ต้องว่าง** — manifest ถูกออกแบบให้ diff ได้: เรียงคงที่ จอละบรรทัด ไม่มี timestamp
   บรรทัดที่ต่าง = จอที่ยังไม่ reproduce ระบุชื่อมาให้ตรง ๆ
4. ถ้า diff ว่าง → ปิด promote แล้วรัน gate ปกติกับ stack สดอีกชุด ต้องเขียว จึงค่อย commit แพ็ก

**ทำไมต้องยืนกราน:** แพ็กเดิมเขียวเฉพาะบนสแต็กที่ถ่ายมันมา — B-323 พิสูจน์แล้วว่า `SEED_FROZEN_NOW` ไม่ได้ freeze `defaultNow()` ของ Postgres
drift จึง **โตตามเวลาจริง** (petty 936 px · gl.inbox 428 px · notifications 276 px ต่อ threshold 160 px)
**promote ภาพที่ reproduce ไม่ได้ = ฝัง B-323 กลับลงไปใหม่**: ได้ gate เขียวที่เขียวเฉพาะเครื่องเดียว วันเดียว
แล้วมันจะโผล่กลับมาเป็น "gate แดงโดยไม่มีใครรู้สาเหตุ" อีกรอบ — ซึ่งคือกำแพงสี่ชั้นของ B-401 → B-407 → B-408 → B-409 พอดี
ถ้า diff ไม่ว่าง **อย่าปรับ threshold และอย่า promote** — แปลว่ายังมีตัวแปรที่ยังไม่ถูกคุม ให้ไปหามันก่อน

### artifacts ของรอบ promote (ทั้งหมดอยู่ใน `.results/` — gitignored)

- `promote-manifest.txt` — **ของที่เอาไป diff** (sha256/bytes/**WxH**/screen/route/ref · เรียงคงที่ · ไม่มี noise)
  ย้ายที่เขียนได้ด้วย `VISUAL_PROMOTE_MANIFEST=/abs/path/run-1.txt` (สะดวกกว่าเวลาทำเงื่อนไข 2 รอบ เพราะ `.results/` ถูกล้างทุกครั้งที่ gate เริ่มรัน)
  **ต้องอยู่นอก pack** — ชี้เข้า `reference/` เมื่อไร ปฏิเสธทั้งรอบ (ด่าน 2b) และ**ไม่ย้ายให้เอง** เพราะ manifest ที่ไม่ได้อยู่ที่ที่สั่งไว้ = หลักฐาน 2 รอบที่เชื่อไม่ได้
  คอลัมน์ `WxH` (v2) มีไว้เพื่อกรณีเดียว: รอบ 1 กับรอบ 2 ถ่ายคนละ viewport → sha เปลี่ยน**ทุกบรรทัด** ซึ่งหน้าตาเหมือน "จอเปลี่ยนหมดทุกจอ" เป๊ะ · คอลัมน์นี้บอกสาเหตุบนบรรทัดเดียวกันเลย
- `promote-evidence.json` — วินิจฉัยรายจอ (landing URL, HTTP status, console/page errors, จำนวนตัวอักษรใน body, ธง placeholder,
  **`authTokenPresent` · `apiRequests` · `apiUnauthorized`**) · **ห้ามใช้ diff** เพราะมี noise ของรอบนั้น
- `promote-staging/` — PNG ที่ถ่ายไว้ก่อนเขียนจริง (การเขียนลง `reference/` เกิดครั้งเดียวตอน commit ท้ายรอบ และเป็นแบบ all-or-nothing)

> **แก้คำกล่าวอ้างเรื่อง containment (2026-08-17)** — ก่อนหน้านี้เอกสารนี้พูดถึง "เขียนเฉพาะใน `app-baseline/`" ราวกับเป็นคุณสมบัติของทั้งโหมด
> ซึ่ง**ไม่จริงตามที่เขียน**: ด่าน 2 คุมเฉพาะ *path ของภาพ* ส่วน path ของ artifact ไม่เคยถูกตรวจเลย · วัดจริงเมื่อ 2026-08-17:
> `VISUAL_PROMOTE_MANIFEST=<pack>/app-baseline/run-1.txt` → เกิดไฟล์ `run-1.txt` **ใหม่** ใน pack (สิ่งที่ path ของภาพห้ามไว้ตรง ๆ) ·
> `stagingDir=refDir` ผ่านการเช็ค prefix แบบเดิม แล้ว `rmSync` ใน constructor **ลบ `reference/app-baseline/` ทั้งก้อน** ·
> `stagingDir=<symlink ไป reference>/staging` สร้างโฟลเดอร์จริงใน `reference/`
> ตอนนี้ทั้งสาม path ถูกตรวจด้วย realpath เหมือนกับที่ path ของภาพโดนตรวจ (ด่าน 2b) — ข้อความข้างบนจึงเป็นจริงตามที่เขียนแล้ว

### capture path เดียวกับตอนเทียบ

`captureScreen()` ใน `visual-gate.spec.ts` เป็น **ทางเดียว** ที่ทั้งสองโหมดใช้ — viewport · viewMode init-script (B-187) ·
browser-path nav (B-155) · `waitUntil:"networkidle"` + settle 1500 ms (B-120) · `fullPage:false` · storageState/globalSetup
ถูกเขียนไว้ **ที่เดียว** และการแยกโหมดเกิด *หลัง* ฟังก์ชันคืนค่าแล้ว
(รอบ 2026-08-07 ใช้สคริปต์ไดรเวอร์คนละตัวใน `agents/` ที่หัวไฟล์ต้องเขียนว่า "mirrors visual-gate.spec.ts EXACTLY" — คำกล่าวอ้างที่ไม่มีอะไรบังคับ)
ผลคือ baseline ที่ promote ออกมา **เป็นภาพที่ถ่ายด้วยเงื่อนไขเดียวกับที่ gate จะเอาไปเทียบ โดยโครงสร้าง**

### เทสต์ของด่านเหล่านี้

อยู่ใน `visual-gate.spec.ts` (describe `promote mode · GUARD n`) — รันได้ทันที ไม่ต้องมีแอป/สแต็ก และใช้ sandbox pack ใน `.results/`
(ไม่แตะ `reference/` จริง — ทุกเทสต์ hash pack ของตัวเองก่อน/หลัง)

```bash
pnpm exec playwright test --config visual/playwright.visual.config.ts --grep "promote mode"   # จาก tests/
```

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G5 — Visual gate:** screenshot เทียบ reference ใน `tests/visual/reference/` ตาม §0 · ขาด G5 = ไม่ done
