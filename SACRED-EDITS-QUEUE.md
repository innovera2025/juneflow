# SACRED-EDITS-QUEUE.md — Wei-approved sacred edits pending application

> คิวการแก้ **sacred files** ที่ Wei อนุมัติแล้ว แต่ยังไม่ apply (hook `protect-files.sh` ล็อกไว้ · ปลดผ่าน `SACRED_OVERRIDE=wei-approved:B-xxx` ในรอบ loop เท่านั้น)
> ที่มา: batch B blocker closeout — Wei เคลียร 14 blocker (2026-07-13). Draft โดย workflow `blocker-batch-closeout` (read-only · ไม่มีไฟล์ถูกแก้ตอน draft)
> **กฎ:** ทุก Thai string ด้านล่าง = verbatim จาก prototype ที่อ้าง · ห้ามแปลใหม่ · zh/en/ar = th fallback เฉพาะ key ใหม่ (ตาม B-035/B-039 precedent)
> งานที่ apply แต่ละก้อนถูกผูกเป็น task ใน `TASKS.md`: **P1-PLAT-01** (§1 i18n) · **P1-BE-05** (§2 openapi envelope) · B-007 (§3 · Phase 3 pending) · **P1-BE-09** (§4 openapi `/models`+`/users`+`/roles`) · **P1-PLAT-02** (§5 i18n จอ master.model+users · pending-compile)

---

## Discovery notes (อ่านก่อน apply)

- `i18n-full.json` มี **3 ที่ ไม่ใช่ 2**:
  - `docs/extract/i18n-full.json` — 162292 bytes (SACRED source of truth)
  - `packages/i18n/src/i18n-full.json` — byte-identical กับ docs/extract (`cmp` clean) = "สองสำเนา byte-identical"
  - `juneflow-extract/i18n-full.json` — 146864 bytes = **stale/divergent dump** (missing `login.email` อยู่แล้ว) → **out of scope · ห้ามแตะ · ห้ามรวมใน cmp gate** (Wei ยืนยัน dead artifact ได้)
- แก้ §1 (B-017, B-047) ต้อง apply เหมือนกันทั้ง **2 สำเนา active** แล้ว verify `cmp docs/extract/i18n-full.json packages/i18n/src/i18n-full.json` (exit 0) + `python3 -m json.tool` parse ทั้งคู่

---

## 1) `i18n-full.json` additions — `SACRED_OVERRIDE=wei-approved:B-017,B-047` (task P1-PLAT-01)

Apply กับ **ทั้ง 2 สำเนา active** แล้ว `cmp`-verify.

### 1a) B-036 — `login.email` → **ALREADY PRESENT · no-op**

`login.email` มีอยู่แล้วทั้ง 2 สำเนา (line ~44 ใน `dict`) ด้วยคำแปลจริงจากงาน P1-WEB-01 (label ยืนยัน `pototype/extra-screens.jsx:36` → `<Field label="อีเมล" required>`). **ไม่ต้องแก้** — คงบล็อกเดิม (real translations th/en/zh/ar) ไว้ (rule "zh/en/ar = th fallback" ใช้กับ key ใหม่เท่านั้น). B-036 = resolved by pre-existing content.

### 1b) B-047 — 3 CompanySwitcher dict keys (NEW)

**Where:** top-level `dict` · append หลัง entry สุดท้าย `user.role` · ก่อน `}` ปิด `dict`. Source: `pototype/company-accept.jsx` L78 (pickTitle) · L87 (taxLabel) · L94 (info). th verbatim · zh/en/ar = th fallback.

เปลี่ยน `}` ปิดของ `user.role` เป็น `},` แล้วแทรก:

```json
    "company.pickTitle": {
      "th": "เลือกบริษัท (Multi-Company)",
      "en": "เลือกบริษัท (Multi-Company)",
      "zh": "เลือกบริษัท (Multi-Company)",
      "ar": "เลือกบริษัท (Multi-Company)"
    },
    "company.taxLabel": {
      "th": "เลขภาษี",
      "en": "เลขภาษี",
      "zh": "เลขภาษี",
      "ar": "เลขภาษี"
    },
    "company.info": {
      "th": "สลับบริษัทแล้ว รายการโครงการ/เอกสาร/งบการเงินจะกรองตามบริษัทที่เลือก · เลขที่เอกสารออกตาม prefix ของแต่ละบริษัท",
      "en": "สลับบริษัทแล้ว รายการโครงการ/เอกสาร/งบการเงินจะกรองตามบริษัทที่เลือก · เลขที่เอกสารออกตาม prefix ของแต่ละบริษัท",
      "zh": "สลับบริษัทแล้ว รายการโครงการ/เอกสาร/งบการเงินจะกรองตามบริษัทที่เลือก · เลขที่เอกสารออกตาม prefix ของแต่ละบริษัท",
      "ar": "สลับบริษัทแล้ว รายการโครงการ/เอกสาร/งบการเงินจะกรองตามบริษัทที่เลือก · เลขที่เอกสารออกตาม prefix ของแต่ละบริษัท"
    }
```

หมายเหตุ: `taxLabel` th = label เปล่า `"เลขภาษี"` เท่านั้น (`{c.taxId}` + `· เลขที่เอกสาร…` ใน company-accept.jsx:87 = runtime data ไม่ใช่ copy) · `·` ใน `company.info` = U+00B7 middle dot verbatim · web ต้อง consume key ให้ตรงชื่อ (ถ้า chrome-strings.json ใช้ชื่อ companyPickTitle/companyTaxLabel/companyInfo → map ให้ตรง)

### 1c) B-017 — `phrase_patterns` block (NEW top-level key)

**Where:** top-level key ใหม่ `phrase_patterns` · append หลัง object `phrases` (key สุดท้าย). Source: `pototype/i18n.jsx` L617-622 (`PHRASE_PATTERNS`). `$1`/`$2` = capture groups (`m[1]`/`m[2]`).

เปลี่ยนท้ายไฟล์ จาก:

```json
  }
}
```

เป็น:

```json
  },
  "phrase_patterns": [
    {
      "re": "^แสดง (.+) จาก (.+) รายการ$",
      "flags": "",
      "th": "แสดง $1 จาก $2 รายการ",
      "en": "Showing $1 of $2",
      "zh": "显示 $1 / 共 $2",
      "ar": "عرض $1 من $2"
    },
    {
      "re": "^กรอง · (\\d+)$",
      "flags": "",
      "th": "กรอง · $1",
      "en": "Filter · $1",
      "zh": "筛选 · $1",
      "ar": "تصفية · $1"
    }
  ]
}
```

### 1d) Verification (ทั้ง 2 สำเนา)
- apply 1b + 1c เหมือนกันทั้ง `docs/extract/i18n-full.json` และ `packages/i18n/src/i18n-full.json`
- `cmp docs/extract/i18n-full.json packages/i18n/src/i18n-full.json` → exit 0
- `python3 -m json.tool < …` → parse clean ทั้งคู่ · i18n test เขียว
- 1a (`login.email`) = ไม่ต้องแก้

---

## 2) `openapi.yaml` — Paginated list envelope · `SACRED_OVERRIDE=wei-approved:B-014` (task P1-BE-05)

Target `packages/contracts/openapi.yaml`. B-014 ✅ ข: list → `{data, page, page_size, total}`. Design: schema `Paginated` ร่วม + per-endpoint `allOf` override `data.items`. **40/42 endpoint ผ่าน `EntityList` ร่วม (แก้จุดเดียวครอบ 40) + 2 inline.**

### 2a) NEW schema `Paginated` (ใน `components.schemas` หลัง `Error` ~L2811)

```yaml
    Paginated:
      type: object
      description: >-
        Standard list envelope (B-014). Every list endpoint returns this
        wrapper: `data` is the page of rows (item type set per endpoint via
        allOf), the rest is pagination metadata. Tenant scope still applies.
      required: [data, page, page_size, total]
      properties:
        data:
          type: array
          items: {}
        page:
          type: integer
          minimum: 1
          example: 1
        page_size:
          type: integer
          minimum: 1
          example: 20
        total:
          type: integer
          minimum: 0
          example: 137
```

### 2b) Rewrite shared response `EntityList` (~L2779-2789) — bare array → `allOf: [Paginated, {data.items: Entity}]` (ครอบ 40 endpoint)
### 2c) Rewrite inline `listProjects` 200 (~L396-399) → `allOf: [Paginated, {data.items: Project}]`
### 2d) Rewrite inline `listCompanies` 200 (~L376-378) → `allOf: [Paginated, {data.items: Company}]`
### 2e) ลบ/แก้ caveat "bare array / envelope unspecified" ที่ header (~L34-36) + inline desc (listProjects ~L392-393 · listCompanies ~L370-372)

**42 endpoint ที่กระทบ:** 40 ผ่าน `EntityList` (listAdminPackages/Subscribers/Users/Invoices · listProjectTypes · listVendors · listCustomers · listCostCenters · listDocNumbering · listBoq · listBoqItems · listPr · listPo · listWo · listSubconContracts(+Periods) · listAcceptanceCenter · listPm{Contracts,Assets,ChecklistTemplates,Workorders} · getGlPostingInbox · listGlJv · getGlCoa · listFaAssets · listLabor{Workers,Attendance,Payroll} · listOpexBudgets · listLandPlots · listSales{Leads,Bookings,Contracts,Downs,Loans} · listDocuments(+Versions) · listNotifications · listAuditLog · getReportsHub) + 2 inline (listProjects · listCompanies).

**ไม่กระทบ (verified):** `getCounts` (`type:array` = query param `keys` · response = object `Counts`) · array properties ใน object responses (createGr/generateBoqPr/…) = enveloped อยู่แล้ว.

**⚠️ review caveat:** `getReportsHub` ปัจจุบันใช้ `EntityList` (จะกลายเป็น envelope) — ถ้า "reports hub" เป็น single object ไม่ใช่ paged list ให้ให้ schema เฉพาะแทน envelope.

### 2f) Downstream (บังคับหลังแก้ contract)
1. **regen TS client** (`packages/contracts`) — list type เปลี่ยน `Entity[]` → `{data:Entity[];page;page_size;total}`
2. **regen Dart client** (`apps/mobile`)
3. **FE web** — TanStack Query list hooks อ่าน `res.data` + wire page/page_size/total เข้า pagination · **sweep consumer ที่มีอยู่: shell ProjectSwitcher/CompanySwitcher (P1-WEB-06 build ก่อน envelope)**
4. **API server** — list handlers wrap `{data,page,page_size,total}` (behavior change · ไม่ใช่แค่ contract)
5. **tests** — contract G2 + web unit G3 + mock ที่คืน bare array
6. **open decision:** ปัจจุบันมีแค่ query `page` — เพิ่ม optional `page_size` query param หรือ fix server default (ให้ client คุม page size)

Regenerated clients = **ไม่ sacred** (regen · ห้าม hand-edit) · แก้เฉพาะ `openapi.yaml` ต้องใช้ override

---

## 3) B-007 — Phase 3 · **PENDING-APPLY** (ยังไม่ apply)

**Recommended (Wei ✅ ก):** tax-engine + WHT (ภ.ง.ด.3/53) แทน income-type taxonomy เป็น **string keys** — `"1","2","3","4","5","6"` + sub-types `"4(ก)"`,`"4(ข)"` (ไม่ใช่ integer · ให้ `4(ก)`/`4(ข)` อยู่ field เดียวได้)

**Target (record only · apply Phase 3):**
- `packages/tax-engine` — WHT income-type enum emit 8 string keys
- `packages/contracts/openapi.yaml` — WHT/PND schema type income-type = `string` `enum:["1","2","3","4","5","6","4(ก)","4(ข)"]` (ต้อง SACRED_OVERRIDE ใหม่ตอน Phase 3)
- `i18n-full.json` — label income-type keyed ตาม string id (sacred patch แยก Phase 3)

**ไม่ apply ใน batch B** — carry forward เป็น Phase-3 item

---

## 4) `openapi.yaml` — B-050 `/models` + B-051 `/users`+`/roles` · `SACRED_OVERRIDE=wei-approved:B-050` (task P1-BE-09)

**Decision (Wei ✅ 14 ก.ค.):** B-050 (ก) GET+POST `/models` · B-051 (ก) ชุดเต็ม GET+POST `/users` + GET+POST `/roles` + PUT `/roles/{id}` — ทุก resource = `Entity` opaque ตาม convention เดิม (ไม่เพิ่ม named schema · field semantics ล็อกที่ DB/seed ตามคำตอบ B-050/B-051 ใน `BLOCKERS.md`)

**Prereq:** apply **หลัง §2 (B-014 envelope) merge เข้า dev แล้วเท่านั้น** — `EntityList` ต้องเป็น `Paginated` ก่อน · **ห้ามแตะส่วนอื่นของไฟล์**

### 4a) Master section — เพิ่มท้ายกลุ่ม `# ===== Master =====` (ก่อน banner ถัดไป)

```yaml
  /models:
    get:
      tags: [master]
      summary: List house models (GET /models?filter&page)
      operationId: listModels
      parameters:
        - $ref: "#/components/parameters/Filter"
        - $ref: "#/components/parameters/Page"
      responses:
        "200":
          $ref: "#/components/responses/EntityList"
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      tags: [master]
      summary: Create house model (new model starts as draft)
      operationId: createModel
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Entity"
      responses:
        "201":
          $ref: "#/components/responses/EntityCreated"
        "401":
          $ref: "#/components/responses/Unauthorized"
```

### 4b) Auth section — เพิ่มท้ายกลุ่ม auth (หลัง `/me`)

```yaml
  /users:
    get:
      tags: [auth]
      summary: List tenant users (GET /users?filter&page)
      operationId: listUsers
      parameters:
        - $ref: "#/components/parameters/Filter"
        - $ref: "#/components/parameters/Page"
      responses:
        "200":
          $ref: "#/components/responses/EntityList"
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      tags: [auth]
      summary: Invite tenant user (email invite; username generated from email; status starts invited)
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Entity"
      responses:
        "201":
          $ref: "#/components/responses/EntityCreated"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /roles:
    get:
      tags: [auth]
      summary: List tenant roles with permission matrix (GET /roles?filter&page)
      operationId: listRoles
      parameters:
        - $ref: "#/components/parameters/Filter"
        - $ref: "#/components/parameters/Page"
      responses:
        "200":
          $ref: "#/components/responses/EntityList"
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      tags: [auth]
      summary: Create tenant role (name + approval limit + approval level + permission matrix)
      operationId: createRole
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Entity"
      responses:
        "201":
          $ref: "#/components/responses/EntityCreated"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /roles/{id}:
    parameters:
      - $ref: "#/components/parameters/IdPath"
    put:
      tags: [auth]
      summary: Update tenant role (permission matrix save)
      operationId: updateRole
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Entity"
      responses:
        "200":
          $ref: "#/components/responses/EntityOk"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

### 4c) Impl directives (ไม่ sacred — สำหรับ P1-BE-09 · จากคำตอบ B-050/B-051)

- `models`: field ตาม mock `master.jsx:426-432` — `code` unique ต่อ tenant · `type` = ชื่อแบบบ้าน (display) · `area`/`bed`/`bath`/`parking` int · `price` **บาทเต็ม** numeric + `currency_code` (FE format "M ฿" = /1e6 toFixed(2) ตาม mock L559) · `status` enum `active|draft` (create เริ่ม `draft`) · `color` persist — server วน palette 7 สี (mock L449) ตอน create · `unit_count`/`bom_item_count` = derived count จริง (C10) ห้าม hardcode `248+i*30`
- `roles`: **superset** — `approval_limits` json ต่อชนิดเอกสาร (ตาม dictionary) + `approval_level` int 0-4 + `perms` matrix 11 โมดูล × 5 สิทธิ์ + `user_count` derived · วงเงิน numeric + `currency_code` ห้ามเก็บ string format ("1,000,000 ฿")
- `users`: `status` enum `active|blocked|invited` · POST = invite ทาง email + gen username จาก email + toggle "เปิดใช้งานทันที" (`master.jsx:1033-1045`) · `department` enum `CONS|PROC|FIN|SLS|ADM|WH` (`master.jsx:1025`)
- seed: MODELS ทุกแถว (`master.jsx:426-432`) + ROLE_PRESETS 8 (`master.jsx:895-904`) — count fields จาก query จริง

---

## 5) `i18n-full.json` — key จอ master.model + users · `SACRED_OVERRIDE=wei-approved:B-050` (task P1-PLAT-02 · **PENDING-COMPILE**)

**Scope อนุมัติแล้ว (B-050/B-051 ✅ Wei 14 ก.ค.):** key ที่ขาดของ 2 จอ — th = **verbatim** จาก `pototype/master.jsx` · en/zh/ar = th fallback (B-035/B-039 precedent) · key naming ตามกลุ่ม dict เดิม

**Inventory เริ่มต้น (P1-PLAT-02 ตรวจซ้ำและ compile patch text ลง section นี้ก่อน apply):**
- MasterModel (~17 string): "เพิ่ม Model" · subtitle จอ (L527) · modal title/subtitle (L511-512) · form labels "รหัส Model"/"ชื่อแบบบ้าน"/"พื้นที่ใช้สอย (ตร.ม.)"/"ราคาเริ่มต้น (ล้านบาท)"/"ห้องนอน"/"ห้องน้ำ"/"ที่จอดรถ" · info banner (L497) · validation 5 ข้อความ (L453-459) · placeholders (L474, L478) · notify dynamic (L518 — เข้า phrase_patterns ถ้ามีตัวเลข) · card labels "ราคาเริ่มต้น"/"M ฿" (L550-574)
- UsersPermissions: "เพิ่มผู้ใช้" · "เพิ่มบทบาท" · "วงเงินอนุมัติ" · PERMS 5 คำ (ดู/สร้าง/แก้ไข/อนุมัติ/ยกเลิก L907) · MODULES 11 ชื่อ (L908 — เช็ค key เดิมก่อน) · form labels UserAddForm (L1004-1054) + RoleAddForm (L1056-1116) · notify "บันทึกสิทธิ์ {name} แล้ว" (L995 — phrase pattern)
- key ที่มีอยู่แล้ว ห้ามเพิ่มซ้ำ: "Model / แบบบ้าน" · "ข้อมูลกลาง" · "ร่าง" · "ใช้งาน" · "ยกเลิก" · "ยูนิต" · "รายการ" · "ตร.ม." · `nav.users` (ดูรายการเต็มใน recon P1-WEB-13/14)
