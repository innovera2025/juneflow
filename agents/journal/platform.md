# Journal — Platform (เขต: root build/CI files + `packages/tokens` + `packages/i18n`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> zone paths: `package.json` `turbo.json` `tsconfig.base.json` `pnpm-workspace.yaml` `pnpm-lock.yaml` `.dockerignore` `packages/tokens` `packages/i18n`
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 3 · task: P0-PLAT-02 → review (GREEN · tokens/i18n gates เขียว · ownership รับต่อ)

- ทำอะไร: หยิบ P0-PLAT-02 (`ready`→`doing`→`review`) — task ready ตัวสุดท้ายในเขต platform (dep `—`). งาน = "tokens/i18n ownership (แทน B-011)": ตรวจ `packages/tokens` + `packages/i18n` build/typecheck/test เขียว + รับเป็นเจ้าของการเปลี่ยนแปลงต่อไป (BE-04/BE-05 ทำ implementation ไปแล้ว — platform ดูแลต่อ ตาม PLAN §8 B-032). **ไม่แตะ implementation** (verification-only) · **ไม่แตะ `i18n-full.json` (sacred)** — `git status` ยืนยัน `packages/i18n/src/i18n-full.json` ไม่อยู่ใน diff (untouched). รัน gates:
  - **tokens:** `pnpm --filter @juneflow/tokens build` (gen Flutter ThemeData) ✓ · `typecheck` (tsc --noEmit) ✓ · `test` (vitest) = **6/6 pass**
  - **i18n:** `typecheck` ✓ · `lint` (tsc --noEmit) ✓ · `test` (vitest) = **15/15 pass**
  - **turbo pipeline (turbo.json ในเขต):** `turbo run build lint test --filter=@juneflow/tokens --filter=@juneflow/i18n` = **5/5 successful (FULL TURBO)** — พิสูจน์ทั้งสองแพ็กเกจเขียวผ่าน monorepo tooling ที่ platform เป็นเจ้าของ
- ตัดสินใจอะไร (เขตตัวเอง): task นี้เป็น verification/ownership ล้วน — implementation เสร็จแล้ว (BE-04/05) และ ownership ถูกบันทึกใน PLAN §8 (B-032) อยู่แล้ว จึง**ไม่มี code diff** ที่ต้องเพิ่ม (เทียบ precedent P0-BE-15/P0-DEV-04 = done-on-arrival). ไม่มี spec/design conflict → ไม่เปิด BLOCKER. CODEOWNERS (`.github/`) เป็นเขต devops + sacred → ไม่แตะ (ownership ทาง process บันทึกใน PLAN แล้ว).
- เจออะไร (handoff): (1) **คิว ready platform = 0 หลังรอบนี้** (PLAT-01/PLAT-02 → review · FIX-01 → review) — ต่ำกว่าเกณฑ์ ≥5 มาก (PLAN §10) · **เตือน Wei: เติมคิว platform** (P0-FIX-02..06 เป็นเขตอื่น backend/web/qa). (2) push→auto-merge dev + ด่าน 4.5 รันโดย loop-runner เมื่อมี remote (ตอนนี้ `git remote` ว่าง = local-only). (3) tokens/i18n เขียวสมบูรณ์ — platform รับ ownership แล้ว การเปลี่ยนแปลงต่อไปของสองแพ็กเกจนี้ผ่านเขต platform.

## 2026-07-12 · รอบที่ 2 · task: P0-PLAT-01 → review (GREEN · root-side ผ่าน · web bug 3 out-of-zone)

- ทำอะไร: หยิบ P0-PLAT-01 (`ready`→`doing`→`review`) — เหลือ 2 ready platform (PLAT-01/PLAT-02, dep `—`). งาน = "root-side ของ B-030" ทำ `docker compose up` build ได้ โดยแก้เฉพาะ root files ในเขต. รัน `docker build -f apps/api/Dockerfile .` จริง iterate ปิดบั๊กทีละตัว:
  - **บั๊ก 1 (.dockerignore)**: สร้าง `.dockerignore` ที่ repo root (ไม่มีมาก่อน) ตัด `node_modules`/`**/node_modules`/`.git`/`dist`/`build`/`.turbo`/test-artifacts/`.env*`/reference sources (pototype/handoff/extract)/deck assets/`.github`/`agents`/`*.md` — **แต่คง `tests/` + ทุก `package.json`/`src`** เพราะ `--frozen-lockfile` ต้องมี workspace importers ครบ. แก้ `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (host node_modules ถูกลากเข้า context).
  - **บั๊ก 2 (allowBuilds)**: `ERR_PNPM_IGNORED_BUILDS` esbuild×4 + msgpackr-extract. ของเดิมใน `pnpm-workspace.yaml` มี `allowBuilds:` (key ถูก!) แต่ค่าเป็น placeholder `"set this to true or false"` + มี `onlyBuiltDependencies:` (dead key) ปน. **repro พิสูจน์:** `onlyBuiltDependencies` **ไม่ถูก pnpm 11.5 อ่านเลย** (ทั้งใน workspace yaml และ package.json `pnpm` field ซึ่ง pnpm 11.5 warn "no longer read") — `pnpm approve-builds --all` เขียน `allowBuilds: {esbuild: true}` แล้ว frozen install เขียว. แก้เป็น `allowBuilds: {esbuild: true, msgpackr-extract: true}` ลบ dead `onlyBuiltDependencies` → postinstall รันจริง.
  - **บั๊ก 3-ใหม่ (forceLegacyDeploy)**: หลัง install+tsc build ผ่าน `pnpm --filter @juneflow/api deploy --prod /out` (apps/api/Dockerfile:22) fail `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` (pnpm 10+ default). แก้ผ่าน root config `forceLegacyDeploy: true` ใน `pnpm-workspace.yaml` — **ไม่ต้องแตะ Dockerfile (backend zone)**.
  - **ผล gate:** `docker build -f apps/api/Dockerfile .` = **ผ่านครบ end-to-end** (install 280 pkg + esbuild/msgpackr postinstall Done → tsc build ✓ → legacy deploy ✓ → runtime image exported). local `pnpm install --frozen-lockfile` เขียว ไม่ regress. package.json revert สะอาด (0 diff).
- ตัดสินใจอะไร (เขตตัวเอง): (1) แก้ทั้ง 3 บั๊กผ่าน **root files ในเขตล้วน** (`.dockerignore` + `pnpm-workspace.yaml`) — ไม่แตะ Dockerfile ทั้งสอง (backend/web zone) แม้บั๊ก deploy อยู่ในคำสั่ง Dockerfile เพราะ fix ที่ถูกต้องคือ monorepo tooling config (platform). ไม่ใช่ spec/design conflict → ไม่ต้อง BLOCKER. (2) เลือก `forceLegacyDeploy` (targeted, ตรงเจตนา Dockerfile) แทน `injectWorkspacePackages` (side-effect กว้างทั้ง monorepo). (3) `.dockerignore` เก็บ `tests/`+`package.json`+`src` ไว้เพื่อไม่ให้ `--frozen-lockfile` พังจาก importer หาย.
- เจออะไร (handoff): (1) **บั๊ก 3 ของ B-030 = OUT-OF-ZONE (web)**: `apps/web/Dockerfile:7` pin `node:20-alpine` แต่ pnpm@11.5.0 corepack shim crash `ERR_UNKNOWN_BUILTIN_MODULE` บน Node v20.20.2 — ยืนยันว่าเหลือบั๊กเดียวนี้ (web image fail หลัง root fix ผ่านหมด). **ยังเปิดใน B-030 (บั๊ก 3, เขต web)** ไม่เปิด blocker ซ้ำ — B-030 ครอบอยู่แล้ว (B-030(ก) แนะให้ web แก้ node:20→node:22-alpine). **แจ้ง web/Wei: ปิดบั๊ก 3 แล้ว compose build ครบ.** (2) **P0-DEV-01 (compose up + seed)** ยัง block ที่ B-030 จนกว่า web ปิดบั๊ก 3 — แต่ root-side + api image พร้อมแล้ว. (3) **คิว ready platform เหลือ 1** (P0-PLAT-02 tokens/i18n ownership) — ต่ำกว่าเกณฑ์ ≥5 (PLAN §10) · **เตือน Wei: เติมคิว platform**. (4) push→auto-merge dev + ด่าน 4.5 รันโดย loop-runner เมื่อมี remote (ตอนนี้ `git remote` ว่าง = local-only).
- 2026-07-12 loop round ended (agent: platform)

## 2026-07-12 · รอบที่ 1 · task: P0-FIX-01 → review (GREEN · ด่าน 4.5 PASS)

- ทำอะไร: หยิบ P0-FIX-01 (`ready`→`doing`) — 1 ใน 3 platform task ที่ dep ครบ (P0-FIX-01/PLAT-01/PLAT-02 ทุกตัว dep `—`). **BE-04 audit fix:** `.github/workflows/ci.yml` (sacred) เรียก `pnpm run --if-present test:{unit,contract,e2e,visual}` ที่ **repo root** (L141/173/211/246) แต่ root `package.json` ไม่มีสคริปต์เหล่านี้ → CI stage 3–6 (contract/unit/e2e/visual) เป็น **no-op เงียบ** ผ่านทั้งที่ไม่รันอะไร. แก้: เพิ่ม 4 root script `test:{unit,contract,e2e,visual}` = `pnpm --dir tests run test:*` delegate ไปสคริปต์ที่มีอยู่แล้วใน `@juneflow/tests` (`tests/package.json`) ซึ่งรัน vitest/playwright จริง — **ไม่แตะ `ci.yml` (sacred)**. รัน gates (เกณฑ์ CI ขั้นต่ำของ task โครงสร้างพื้นฐาน: สคริปต์รัน test จริง + stage ไม่ no-op): root `pnpm run test:unit` = **48 passed** (6 ไฟล์) · `pnpm run test:contract` = **370 passed | 46 skipped(live)** · `pnpm run test:visual` playwright `--list` = **4 specs จริง** · `pnpm run test:e2e` delegate playwright จริง (0 spec จน P0-QA-03 done · `--pass-with-no-tests` เขียวตามดีไซน์ CI-green-from-day-one) · `package.json` valid JSON ✓. commit `4e6df25` บน `feature/platform`. **ด่าน 4.5 (diff-reviewer) = PASS** (sacred 0 · zone `package.json`+`TASKS.md` เท่านั้น · script mapping ถูกต้องรัน runner จริง · design-fidelity n/a build-tooling · C1–C10 ไม่แตะ).
- ตัดสินใจอะไร (เขตตัวเอง): delegate ไป `@juneflow/tests` (ไม่เขียน vitest/playwright config ที่ root ใหม่) — ตรงกับเจตนา CI stage (Stage 4 unit = "posting rules · BOQ remain · retention · approval matrix · quota · 4-basis" = `tests/unit` พอดี) และไม่ซ้ำ harness ที่ QA เป็นเจ้าของ. คง `--if-present`/`--pass-with-no-tests` semantic เดิม (e2e เขียวจน P0-QA-03 เติม spec) = CI-green-from-day-one ตาม comment ci.yml L7 ไม่ใช่ no-op ระดับ reviewer. ไม่มี spec conflict · ไม่แตะ sacred (`ci.yml` อ่านอย่างเดียวเพื่อหา script name ที่ต้อง provide).
- เจออะไร (handoff): (1) **คิว ready platform เหลือ 2** หลังรอบนี้ (P0-PLAT-01 docker-buildable · P0-PLAT-02 tokens/i18n ownership — ทั้งคู่ dep `—` หยิบได้เลย) — ต่ำกว่าเกณฑ์ ≥5 (PLAN.md §10) · **เตือน Wei: เติมคิว ready platform**. (2) push→auto-merge dev ทำโดย loop-runner เมื่อมี remote (ตอนนี้ `git remote` ว่าง = local-only) — ด่าน 4.5 PASS แล้ว พร้อม push. (3) รอบถัดไปควรทำ P0-PLAT-01 (`.dockerignore` + ตรวจ root build ใน Docker context) หรือ P0-PLAT-02 (verify tokens/i18n gates เขียว).
- 2026-07-12T12:36:27Z loop round ended (agent: platform)

## 2026-07-12 19:36 · loop-runner · รอบที่ 1/4 · task: P0-FIX-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-FIX-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.528054 (สะสม $2.5281/เพดาน $16)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T12:51:09Z loop round ended (agent: platform)

## 2026-07-12 19:51 · loop-runner · รอบที่ 2/4 · task: P0-PLAT-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-PLAT-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $4.390639999999999 (สะสม $6.9187/เพดาน $16)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
