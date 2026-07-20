# JV_BOOKS → posting-map · orch-B INDEPENDENT derivation (2026-07-21 · cross-check for B-122 Q2)
Purpose: when orch-A pastes its /gl/post map for Wei confirm, diff against this. Derived from seed JV_BOOKS (seed/index.ts L585-603) — every code verified to EXIST in COA_SEED (L369-380).

## Derived map (seed-exemplar per source type)
| source (doc type) | Dr | Cr | seed exemplar |
|---|---|---|---|
| RV / receipt (REM) | 1020 เงินฝากธนาคาร | 1030 ลูกหนี้การค้า | JV-0418 |
| WHT remit (manual) | 2010 เจ้าหนี้การค้า | 2050 ภาษีขายรอนำส่ง | JV-0417 |
| GR (รับสินค้า) | 5020 ต้นทุนวัสดุ | 2010 เจ้าหนี้การค้า | JV-0416 |
| Allocate (ปันส่วน) | 5020+5030 | 1140 WIP/CIP | JV-0415 |
| FA depreciation | **5100 ค่าใช้จ่ายบริหาร** | **1210 ที่ดินอาคารอุปกรณ์** | JV-0414 |
| Petty | 5100 | 1010 เงินสด | JV-0413 |
| (accrual = Manual JV, not auto-post) | — | — | JV-0412 |
NO seed exemplar (orch-A must extrapolate → Wei confirm): PV payment (คาด Dr 2010 / Cr 1020) · CN approve (คาด Dr 4010+2050 / Cr 1030) · labor payroll.

## ⚠ CONFLICT FLAGGED (pre-empt · C-177)
- **fa.jsx run-modal + gl.jsx trial mock ใช้รหัส 5301 ค่าเสื่อมราคา / 1502-1504 accum — รหัสพวกนี้ไม่มีใน COA_SEED** (DB จริงมีแค่ 5100/1210 · JV_BOOKS FA auto = Dr 5100/Cr 1210 = seed's own convention).
- Impact: (1) B-123 "seed-COA lookup" → depreciation ต้อง post 5100/1210 (ตาม seed) หรือเพิ่ม COA rows 5301/15xx (= seed change → ruling); (2) ported gl.trial derive จาก jv จริง จะไม่มีแถว 5301 ที่ mock โชว์ → §0/G5 divergence ที่อธิบายได้ (mock แสดง COA superset ที่ DB ไม่มี).
- Recommendation: **post ตาม seed convention (5100/1210) + honest-derive trial** — ไม่เพิ่ม COA rows เว้นแต่ Wei สั่ง (fold เข้า map-confirm ครั้งเดียว).
