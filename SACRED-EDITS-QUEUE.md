# SACRED-EDITS-QUEUE.md — Wei-approved sacred edits pending application

> คิวการแก้ **sacred files** ที่ Wei อนุมัติแล้ว แต่ยังไม่ apply (hook `protect-files.sh` ล็อกไว้ · ปลดผ่าน `SACRED_OVERRIDE=wei-approved:B-xxx` ในรอบ loop เท่านั้น)
> ที่มา: batch B blocker closeout — Wei เคลียร 14 blocker (2026-07-13). Draft โดย workflow `blocker-batch-closeout` (read-only · ไม่มีไฟล์ถูกแก้ตอน draft)
> **กฎ:** ทุก Thai string ด้านล่าง = verbatim จาก prototype ที่อ้าง · ห้ามแปลใหม่ · zh/en/ar = th fallback เฉพาะ key ใหม่ (ตาม B-035/B-039 precedent)
> งานที่ apply แต่ละก้อนถูกผูกเป็น task ใน `TASKS.md`: **P1-PLAT-01** (§1 i18n) · **P1-BE-05** (§2 openapi envelope) · B-007 (§3 · Phase 3 pending) · **P1-BE-09** (§4 openapi `/models`+`/users`+`/roles`) · **P1-PLAT-02** (§5 i18n จอ master.model+users · pending-compile) · **P1-BE-10** (§6 org-hierarchy) · **P1-PLAT-03** (§7) · **P1-PLAT-04** (§9 i18n 3 จอ master) · **P1-BE-12** (§B-067 docnum) · **P1-BE-15** (§10 dashboard openapi) · **P1-PLAT-06** (§11 dashboard i18n)

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

---

## 6) `openapi.yaml` — B-052 org-hierarchy + B-053 project-tree write side · `SACRED_OVERRIDE=wei-approved:B-052` (ครอบ B-053 · task P1-BE-10)

**Decision (Wei ✅ 14 ก.ค. ผ่าน orch-A):**
- **B-052 org:** node ทุกชั้น lvl0-2 เก็บใน `org_unit` (ตารางมีอยู่แล้ว `packages/db/src/schema/extensions.ts:541` — ไม่ต้องสร้างตาราง) · contract = GET+POST `/org-units` + PUT+DELETE `/org-units/{id}` · `note` เก็บ **text ตาม mock** (client compose · PUT partial-merge: field ที่ไม่ส่ง = คงเดิม) · server rules: **DELETE cascade ทั้ง subtree** (quirk 1 ชั้นของ mock = bug ไม่ใช่ spec · UI ไม่มี confirm ตาม pototype) · **กัน circular parent** · **code unique ต่อ tenant รวมทุกชั้น** · "sync SAP เมื่อ 5 นาทีก่อน" = static i18n text
- **B-053 master.project (port-as-seen):** `POST /projects/{id}/nodes` (create block ใต้ phase แรก/active + autogen N unit สถานะว่าง · cap 200) · typed `HierarchyNode` + rewrite `GET /projects/{id}/hierarchy` 200 · ขยาย `ProjectInput` (short/units/phases[]) · ปุ่ม edit block = render-only · นำเข้ายูนิต/มุมมองยูนิต = notify ตาม pototype · Model dropdown ทุก project type ตาม mock

**Prereq:** ไม่มี (§2/§4 merge แล้ว) · **ห้ามแตะส่วนอื่นของไฟล์**

### 6a) `/org-units` — เพิ่มใน Master section หลัง block `/projects/{id}/hierarchy` (~L567 ก่อน `/project-types:` L569)

```yaml
  /org-units:
    get:
      tags: [master]
      summary: List org structure nodes (flat ordered tree, lvl 0-2)
      operationId: listOrgUnits
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
      summary: Create org node (company lvl0 or department/team lvl 1-2)
      operationId: createOrgUnit
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

  /org-units/{id}:
    parameters:
      - $ref: "#/components/parameters/IdPath"
    put:
      tags: [master]
      summary: Update org node (partial merge - omitted fields keep current values)
      operationId: updateOrgUnit
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
    delete:
      tags: [master]
      summary: Delete org node (cascades to the whole subtree)
      operationId: deleteOrgUnit
      responses:
        "200":
          $ref: "#/components/responses/ActionOk"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

### 6b) Project-tree write side — เพิ่ม path ใหม่ต่อจาก `/projects/{id}/hierarchy`

```yaml
  /projects/{id}/nodes:
    parameters:
      - $ref: "#/components/parameters/IdPath"
    post:
      tags: [master]
      summary: Create block node under the first/active phase (auto-generates N unit nodes, status empty, max 200)
      operationId: createProjectNode
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
        "404":
          $ref: "#/components/responses/NotFound"
```

### 6c) Rewrite `GET /projects/{id}/hierarchy` 200 (~L561-563 · `EntityOk` → typed · คง 401/404 เดิม)

```yaml
        "200":
          description: Flat ordered tree of hierarchy nodes (phase/block/unit).
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/HierarchyNode"
```

### 6d) NEW schema `HierarchyNode` — append ท้าย `components.schemas` (หลัง `ProjectInput`)

```yaml
    HierarchyNode:
      type: object
      description: >-
        One node of a project's structure tree (B-053). kind follows the
        project type's hierarchy labels; unit nodes carry sale/build status.
      required: [id, kind, name]
      properties:
        id:
          type: string
          format: uuid
        parent_id:
          type: string
          format: uuid
        kind:
          type: string
          enum: [phase, block, unit]
        code:
          type: string
        name:
          type: string
        model_id:
          type: string
          format: uuid
        units:
          type: integer
          minimum: 0
        sold:
          type: integer
          minimum: 0
        built:
          type: integer
          minimum: 0
        color:
          type: string
        status:
          type: string
      additionalProperties: true
```

### 6e) ขยาย `ProjectInput` (~L3157-3170) — เพิ่ม 3 properties (ไม่แตะ required เดิม)

```yaml
        short:
          type: string
        units:
          type: integer
          minimum: 0
        phases:
          type: array
          items:
            type: object
            properties:
              label:
                type: string
              units:
                type: integer
                minimum: 0
```

### 6f) Impl directives (ไม่ sacred — สำหรับ P1-BE-10)

- **org_unit:** ตารางมีแล้ว — migration ใหม่แค่ unique index per-tenant บน code (เช่น `unique(company_id, upper(code)) where code is not null`) · handlers = scoped `select` ปกติ (org_unit มี company_id ตรง) · GET ต้องคืน **flat ordered list แบบ tree traversal** (parent แล้วลูกตามทันที — ตรง document order ของ mock)
- **seed:** ORG_SEED 10 แถว (`master.jsx:7-18`) — สร้าง `parent_id` จริงจากลำดับ array (seed เดิมไม่มี parentCode: ลูก = แถวถัดไปที่ lvl ลึกกว่า) · เก็บ icon ตาม seed (building/users/user)
- **rules:** lvl ลูก = min(parent.lvl+1, 2) · dept ต้องมี parent · tax_id regex `\d{10,13}` (company · เฉพาะเมื่อส่ง) · DELETE cascade subtree · กัน circular (parent ใหม่ห้ามเป็น descendant ของตัวเอง) · PUT partial-merge
- **project nodes:** ใช้ตาราง `project_nodes` ที่มีอยู่ (`projects.ts:102` อ้างแล้ว) · create block ผูก phase แรก/active · autogen N units status ว่าง · cap 200/บล็อก · unit code `{blockCode}-{NN}` padStart 2 · sold/built = count จาก query จริง (C10) · **impl `GET /projects/{id}/hierarchy`** (selectThrough ผ่าน project) ให้จอใช้ได้จริง
- regen TS client · **flag mobile: Dart client regen รอบถัดไป** (append งานเข้า P1-MOB-01 ถ้ายังไม่ merge หรือเปิด task ใหม่)

---

## 9) `i18n-full.json` — key 3 จอ master (ptype/cc/docnum) · `SACRED_OVERRIDE=wei-approved:B-062` (task P1-PLAT-04 · **APPLIED 15 ก.ค.**)

**Scope อนุมัติแล้ว (B-059/060/061/062 ✅ Wei 15 ก.ค.):** ~70 key — ptype 23 (`project-type-screen.jsx:5-218` รวม module near-miss 7 ตัว key ใหม่ verbatim + notify template 2) · cc ~20 (`master.jsx:584-731` รวม "ศูนย์ต้นทุน" ทั้งตระกูล + toast template + dropdown enum labels) · docnum ~30 (`master.jsx:737-889` รวมหัวตาราง 6 + RESET_OPTS/LOCK_OPTS enum labels + template 2) · กติกา: th verbatim · template แบบ §8 (curly quotes ตาม prototype) · en/zh/ar = th fallback (B-039) · เช็ค key เดิมก่อน ห้ามเพิ่มซ้ำ · ห้ามแตะ juneflow-extract · **APPLIED**: 91 keys (ptype 34 · cc 24 · docnum 33 · skipped-existing 24 ตรวจแล้ว) · ทุก key verify verbatim/prefix กับ jsx ต้นทางก่อนเขียน · dict 221→312 · เนื้อ patch เต็ม = commit diff (feat i18n P1-PLAT-04)

---

## §B-067 — docnum lock boolean→text-code (WEB-12 unblock · Wei sacred round · override B-067)

**Ruling status:** B-060 already ruled "enum reset/lock = code + i18n key" → **option ข is the mandated continuation** (BE-11 deviated to boolean). ก (raw Thai in DB) / ค (boolean, loses dept+warehouse, fails G5) = reopen closed B-060. Wei only ratifies ข + fires the round (migration 0013 + i18n = sacred, hook-blocked from worktree · needs `SACRED_OVERRIDE=wei-approved:B-067`).

**Backend (packages/db + apps/api):**
1. `packages/db/src/schema/extensions.ts` (~L599): `locked: boolean("locked")` → `locked: text("locked").notNull().default("none")` (keep boolean import — other tables use it).
2. `pnpm --filter @juneflow/db exec drizzle-kit generate` → `0013_*.sql`, then **HAND-CORRECT the USING** (drizzle emits `::text` = 'true'/'false' — wrong) to mirror 0012's 3-statement pattern:
   `ALTER TABLE doc_numbering ALTER COLUMN locked DROP DEFAULT;`
   `ALTER TABLE doc_numbering ALTER COLUMN locked SET DATA TYPE text USING (CASE WHEN locked THEN 'all' ELSE 'none' END);`
   `ALTER TABLE doc_numbering ALTER COLUMN locked SET DEFAULT 'none';`
   regen the drizzle meta snapshot.
3. re-seed `DOCNUM_SEED` (`packages/db/src/seed/index.ts` ~L318-329) lock boolean→code in row order: **PR=dept · PO=all · WO=all · GR=all · RT=none · BOQ=all · PT=none · TR=warehouse · IS=warehouse · JV=all** (insert `locked: d.lock` at ~L966 stays; DO NOT touch ~L1166 `locked:false` = bankStatements, different table).
4. `apps/api/src/routes/doc-numbering.ts` GET — **no logic edit** (map already passes `locked` through) · update comments: `locked` = lock-mode CODE (all|dept|warehouse|none) resolved to i18n on FE. Contract tests assert the 4 code strings.
5. **NO openapi change** (/doc-numbering rows Entity-opaque additionalProperties → locked:string not a sacred-contract change).

**Platform (i18n-full.json both copies · same override batch):** add 3 keys (docnum.lockDept + all 4 optLock* already shipped in §9): `docnum.lockAll`="ทุกใบ" · `docnum.lockWarehouse`="ตามคลัง" · `docnum.fmtYear`="{ปี}" (Format-column token master.jsx:869). th verbatim · en/zh/ar fallback.

**After merge → WEB-12 port (web zone):** map GET `locked` code→i18n on the table cell: all→docnum.lockAll · dept→docnum.lockDept · warehouse→docnum.lockWarehouse · none→literal "—" (no key · §0/B-064 precedent) · Format cell uses docnum.fmtYear. B-060 pure-logic ready. DocNumForm write DEFERRED (B-066 · button stub). Visual gate g2/35 → **master wave 7/7 COMPLETE**.

---

## 10) `openapi.yaml` — B-049 dashboard endpoints · `SACRED_OVERRIDE=wei-approved:B-049` (task P1-BE-15)

**Decision (Wei ✅ 15 ก.ค. — B-049 UN-DEFER→GO):** dashboard build ปลดล็อก · เพิ่ม 7 read/aggregation endpoints (Entity-opaque ตาม convention · ไม่มี named schema) + tag `dashboard` · reuse /audit-log,/counts,/me,/projects · **ห้ามแตะส่วนอื่น**

**เพิ่ม `- name: dashboard` ใน tags block (~L55-79) + 7 paths ก่อน `components:` (~L2916):**

| operationId | path · method | response | tenant door | widgets |
|---|---|---|---|---|
| `getDashboardSummary` | GET /dashboard/summary?range= | EntityOk | selectThrough(project→company)+selectReference(project_type) | header + type-aware KPIs (budget/solar/civil) + health donut |
| `getDashboardBudgetActual` | GET /dashboard/budget-actual?range= | EntityOk | selectThrough(cost→project) | budget/actual/plan time-series + cost-category |
| `listDashboardApprovals` | GET /dashboard/approvals-inbox | EntityList | select per PR/PO/WO (company_id) | union pending ที่ user เป็นผู้อนุมัติ |
| `listDashboardPhaseProgress` | GET /dashboard/phase-progress | EntityList | selectThrough(phases→project) | built%/budget_used%/status type-aware |
| `listDashboardAlerts` | GET /dashboard/alerts | EntityList | selectThrough(project) | rule-based risk |
| `getDashboardCashflowForecast` | GET /dashboard/cashflow-forecast | EntityOk | selectThrough(cashflow→project) | 7-วัน forward net + rows |
| `listDashboardContractors` | GET /dashboard/contractors | EntityList | selectThrough(contracts→project) | active subcon + progress% + retention |

- `range` param = reuse `$ref: "#/components/parameters/Period"` (มีอยู่ ~L2948) บน summary + budget-actual
- **ไม่ reuse** `/gl/reports/cashflow` (historical ≠ 7-วัน forecast) → cashflow-forecast แยก
- YAML expand ตาม convention §4/§6 (tags:[dashboard] · EntityOk/EntityList · 401 Unauthorized)
- **impl (P1-BE-15):** aggregation handlers อ่าน seed จริง (C10 — ห้าม hardcode 17/24/3/71/38 · derive จาก query) · type-aware summary (realestate/civil/service=budget KPIs · solar=capacity/energy/PR) · ไม่มี migration (read-only aggregation)

## 11) `i18n-full.json` — B-049 dashboard keys · `SACRED_OVERRIDE=wei-approved:B-049` (task P1-PLAT-06 · **PENDING-COMPILE**)

**Scope (~64 keys · จาก dashboard recon):** Bucket A **42 static** (role banners 4 · solar/civil/service branch labels · phase-status late/soon · chart range titles + `งบ` legend · activity verbs) + Bucket B **22 template/phrase_pattern** (number/date-bearing: `ช่วง: {r}` · `เฉลี่ยทุกเฟส ({n})` · `{n} ฉบับ` · `ข้อมูล ณ {date} (อัปเดต {time} น.)` · `+{p}% MoM` · KPI-subs...). **verbatim rule (§0):** term อังกฤษใน prototype (Performance Ratio · UAT · online · Overhead · MWp/MWh/kWp) = th value อังกฤษตามต้นฉบับ — **ไม่ต้องถาม Wei** (fidelity = ตามที่ prototype แสดง) · fix 2 glyph near-miss (`● ตรงแผน` prefix · `Sync SAP / REM` spacing) byte-for-byte · **exclude Bucket C ~22** (mock/seed literals: approval titles/phase names/alert bodies → seed layer, ไม่ใช่ i18n) · exclude weekday/month abbrev → date helper

