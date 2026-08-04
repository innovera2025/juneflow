# MOB-INBOX + PR-DETAIL wave — orch-B design spec (for the execute-agent)

Owner: orch-B (verify lane, driving). Design-fidelity law: the execute-agent MUST
re-read `pototype/mobile.jsx` L24-177 (inbox) + L179-385 (detail) THIS round before writing.

## 0. Scope (2 new screens + 1 seam · money=SERVER authority, reads=NONE)
- **inbox** (tab route id `inbox`) — the caller's pending-approvals list. GET /dashboard/approvals-inbox.
- **detail** (PUSHED route, NOT a tab) — a single PR's detail. GET /pr/:id. Reached by tapping a PR row in inbox.
- **seam** — Navigator.push carrying a real `prId`. inbox PR-row tap → PrDetailScreenHost(prId) →
  its approve/reject buttons → the EXISTING ApproveScreenHost(prId:)/RejectScreenHost(prId:)
  (both already accept `this.prId` nullable — NO change to those two screens).

PO/WO rows: the approvals-inbox returns pending PR **and** PO **and** WO. Show them all (design-fidelity —
the prototype `items[]` mixes all three kinds). But this wave wires the ACTION flow for **PR only**
(the prototype defines a single detail screen and it is a PR — "ใบขอซื้อ"; mobile approve/reject POST
/pr/:id/*). A PO or WO row is rendered honestly (kind/no/amount/project) but its tap does NOT open a
fabricated PR-shaped detail. Leave PO/WO tap as a no-op (or a later honest "PO/WO detail — soon" state).
Do NOT build a PO/WO detail from the PR template. (Follow-up wave: generalized detail on /po/:id, /wo/:id.)

## 1. Contracts (verified on dev — do not re-derive, do not fabricate)
### GET /api/v1/dashboard/approvals-inbox  → EntityList (opaque `Entity`, raw-Map read)
UNION of PENDING pr+po+wo the caller may approve (B-070 tiered). Per-row REAL: `kind` (PR|PO|WO),
`no` (po.no/wo.no MAY be null → em-dash), `amount` (null when a PR has no priced BOQ lines → em-dash),
`currency`, `project` scope. HONEST-NULL (no column — do NOT invent): `title`, `requester`, `urgent`.
Optional `?project_id=` filter (omit → tenant-wide). Row identity carries the doc `id` (needed for the push).

### GET /api/v1/pr/:id  → prWire(pr, amount, currency, {vendor, requester}) + items[]
REAL: `no`, `status` (pending/approved/...), `amount` (server-computed net), `currency`,
`vendor` (resolved name or null), `requester` (resolved name or null), project scope,
`items[]` (prItemWire: name, qty, price — real BOQ-priced lines). 404 if not in tenant.
NOT returned (→ honest-omit, do NOT fabricate): a full approver-chain array with names/times,
the BOQ budget bar (ใช้/เหลือ), attachments, a distinct free-text `title`, `needed_by` date,
the caller's personal approval limit ("วงเงินอนุมัติคุณ").

### actions (unchanged — the existing approve/reject screens own these)
POST /pr/:id/approve (path-id ONLY, server enforces the tier) · POST /pr/:id/reject {reason} required.
The approve button caption shows the amount VERBATIM off the wire — never client-computed.

## 2. Per-screen field map (prototype element → server-backed | HONEST-OMIT)
### inbox (mobile.jsx L24-177)
| prototype element | decision |
|---|---|
| header "กล่องอนุมัติ" / sub "รออนุมัติ" | i18n static |
| user/bell buttons (L38-42) | chrome — render icon buttons, the bell red-dot is decorative-static (no unread wire here) |
| summary chips 17/2/6.84M (รออนุมัติ/ด่วน/มูลค่ารวม) | count = list length (REAL) · มูลค่ารวม = Σ amount (REAL) · **ด่วน = HONEST 0** (urgent null; render the chip, value 0 or em-dash — never fabricate "2") |
| filter pills ทั้งหมด/ด่วน/PR/PO/WO + counts | render the pills (design-fidelity); counts = REAL derivable (kind counts from the list; ด่วน=0). Pills are display/inert unless you wire a real client filter — a client-side filter over the already-fetched list is acceptable and honest. |
| row: kind badge (PR/PO/WO + color) | REAL kind |
| row: no | REAL (em-dash if null) |
| row: title | **HONEST-OMIT** (no column) — fall back to `no` as the primary line, do NOT invent a title |
| row: urgent "ด่วน" badge | **HONEST-OMIT** (urgent null) |
| row: project | **HONEST-OMIT** (project NAME not on the inbox row — only on GET /pr/:id detail). Do NOT fabricate. |
| row: requester avatar+name + "· age ที่แล้ว" | **HONEST-OMIT requester** (no column, do NOT fabricate a name). **age = REAL** — the row carries `created_at` (B-259) → render `{age} ที่แล้ว` (mob.approval.inbox.cardAgeAgo) from a relative-time of created_at. |
| row: amount ฿ | REAL (em-dash if null) |
| row: overBudget banner "เกินงบ 4.2%…" | **HONEST-OMIT** (not in the inbox contract) |
| bottom tab bar | the shell already owns the 5-tab MTabBar — do NOT re-draw the prototype's inline 4-tab bar |

### detail — PR (mobile.jsx L179-385)
| prototype element | decision |
|---|---|
| header sub "ใบขอซื้อ" + title = PR no + back/more buttons | i18n "ใบขอซื้อ"; title = REAL `no`; back button pops the route; "more" = inert/omit |
| status banner "รอคุณอนุมัติ · ชั้นที่ 2 จาก 3" + "รอมา 1 ชม 24 นาที" | thin-honest: derive the state from `status` (pending → "รออนุมัติ"). The "ชั้นที่ X จาก Y" step and precise "รอมา …" elapsed are NOT in the contract → render a thin honest banner keyed on status, omit the exact tier-step and elapsed unless the wire carries them |
| title card: material title + description | title = **HONEST-OMIT** (no column) → show `no`/status; description omit if no column |
| ผู้ขอ (requester) | REAL (prWire resolves the name; em-dash if null) |
| โครงการ (project) | REAL |
| วันที่ต้องการ (need date) | **HONEST-OMIT** unless a needed_by column exists (it does not in prWire) |
| ผู้ขาย (vendor) | REAL (prWire resolves; em-dash if null) |
| amount card: ยอดรวมสุทธิ + "N รายการ · รวม VAT 7%" | amount REAL; "N รายการ" = items.length REAL; "รวม VAT 7%" = static label (keep only if faithful — the amount is net server value, so a VAT note is a label; safe to keep as static copy) |
| วงเงินอนุมัติคุณ ≤X + อยู่ในวงเงิน badge | **HONEST-OMIT** (caller's personal limit not returned) |
| BOQ budget bar (ใช้ 3.64M/4.8M เหลือ 257K) | **HONEST-OMIT** (not returned) |
| รายการวัสดุ · N + item rows (name/qty/amount) | REAL — items[] from the wire (name, qty, price). "ดูทั้งหมด" = inert/omit or keep static |
| เส้นทางอนุมัติ (approver timeline) | **HONEST-OMIT the full chain** (no approver array). Optionally a single thin "current: รออนุมัติ" line from status. Do NOT fabricate the 3-person timeline. |
| เอกสารแนบ · 3 (attachments) | **HONEST-OMIT** (no column — same call the approve/reject port already made, B-252) |
| sticky bar: reject(x) · edit · approve "อนุมัติ · {amount} ฿" | reject → push RejectScreenHost(prId) · approve → push ApproveScreenHost(prId) · edit = inert/omit · amount caption = REAL verbatim. money/authority=SERVER (path-id only). |

## 3. Files (mirror the merged mobile screen-port pattern — notif/pm_jobs/pr_action)
- `lib/screens/approvals_inbox/approvals_inbox_repository.dart` — raw-Dio, GET /dashboard/approvals-inbox, opaque Entity → raw Map list.
- `lib/screens/approvals_inbox/approvals_inbox_agg.dart` — PURE derivation: rows (kind/no/amount/project/id), summary (count, Σamount, urgent=0), kind-counts. Unit-testable, no Flutter import.
- `lib/screens/approvals_inbox/approvals_inbox_screen.dart` — shell primitives, honest-empty + skeleton, PR-row tap → Navigator.push(PrDetailScreenHost(prId, no)).
- `lib/screens/pr_detail/pr_detail_repository.dart` — raw-Dio GET /pr/:id, opaque Entity raw Map.
- `lib/screens/pr_detail/pr_detail_agg.dart` — PURE: header(no/status→thin banner), parties(requester/vendor/project), amount, items[]. Honest-omit map above baked in.
- `lib/screens/pr_detail/pr_detail_screen.dart` — shell primitives; sticky bar pushes ApproveScreenHost(prId)/RejectScreenHost(prId).
- register `inbox` in `mobile_screen_router.dart` (mobileScreenBuilders + kBuiltRouteIds). detail is a PUSHED route (its Host is constructed at the push site, NOT a tab builder). Keep approve/reject map entries (honest-empty) as-is.
- Thai ONLY in `assets/i18n/screens/{approvals_inbox,pr_detail}_strings.json` sidecars. ZERO Thai in lib/**.dart (comments too — transliterate ก/ข/ค).
- tests: `test/screens/approvals_inbox/*_agg_test.dart` + screen test; `test/screens/pr_detail/*`; update `mobile_routes_test.dart` (builders.keys == kBuiltRouteIds MUST stay in sync — the pm-jobs graft bug: adding a builder without the kBuiltRouteIds id fails this test).

## 4. Invariants (gate-4.5 will check)
- money/authority = SERVER: amounts VERBATIM off wire, approve/reject path-id only, no client tier/JV/decision.
- no-fabrication: every HONEST-OMIT above is an em-dash / omission, NEVER an invented value.
- honest-empty + loading skeleton on both screens.
- zero-Thai-in-lib; sidecar-only strings; opaque-Entity raw-Map (no hand-written model).
- pixel-G5 N/A (mock Fiori refs inbox.png/detail.png) → fidelity via gate-4.5 structural match.

## 5. i18n — **ZERO-MINT** (recon confirmed · af5d76df). No sacred round, no Wei ratification needed.
The `mob.approval.*` dict namespace already covers both screens verbatim (minted by the notif/approve/reject
ports, B-240/254/255). Follow the merged approve/reject screen pattern EXACTLY:
- Sidecar `assets/i18n/screens/{approvals_inbox,pr_detail}_strings.json` = KEYS-ONLY (no Thai byte in .dart).
- Two layers, pick per the string's existing key (from the recon borrow map below):
  - **phrases-layer** (Thai-text-IS-the-key) → sidecar value = the exact Thai phrase, read via `i18n.tp(strings['field'])`.
  - **dict-layer** (`mob.approval.*` short key) → read via `i18n.t('mob.approval.detail.netTotal')` directly.
  - ฿ symbol = `i18n.t('subcon.unitBaht')` (NOT a phrase).
- The templated dict keys already carry the placeholder slots — substitute REAL wire values via split-on-token
  Text.rich (same as approve's `confirmBody {no}/{amount}`). money/authority=SERVER: the amount token = the
  server value verbatim.
- Glyph-exact: copy the Thai phrase byte-for-byte from `docs/extract/i18n-full.json` (curly “”, middot ·, em-dash —, ฿).

### Borrow map (recon af5d76df — every string is BORROW, mint=[]). Keys marked (OMIT) are for elements this
### wave honest-omits (§2) → the key exists but the screen does NOT render it, so it is simply unused.
INBOX:
- `กล่องอนุมัติ` = dict `mob.approval.inbox.title` (header) · `รออนุมัติ` = phrases (sub + chip label)
- `ด่วน` = phrases (chip + filter pill + row badge; **row badge & the "ด่วน" count are HONEST 0/omit** — urgent null)
- `มูลค่ารวม` = phrases (chip) · `ทั้งหมด` = phrases (filter) · `PR`/`PO`/`WO` = literal kind codes (no i18n)
- `{age} ที่แล้ว` = dict `mob.approval.inbox.cardAgeAgo` — **age is REAL** (the inbox row now carries `created_at` → derive a relative age; do NOT omit)
- (OMIT) `mob.approval.inbox.overBudgetWarn` — overBudget not in contract
DETAIL:
- `ใบขอซื้อ` = phrases (header sub; PR-only this wave) · title line = REAL `no`
- `ยอดรวมสุทธิ` = dict `mob.approval.detail.netTotal` · amount = REAL server value + `subcon.unitBaht`
- `N รายการ` from dict `mob.approval.detail.lineCountVat` BUT **render the count only (items.length REAL); HONEST-OMIT the "· รวม VAT 7%" clause** (no VAT breakdown in the wire — do not hardcode 7%)
- `ผู้ขอ`/`โครงการ`/`ผู้ขาย` = phrases (REAL: requester/project/vendor from prWire; em-dash if null) · **`วันที่ต้องการ` OMIT** (no needed_by column)
- `รายการวัสดุ` = phrases (items section) · `ดูทั้งหมด` = phrases (or inert)
- status banner: use `mob.approval.detail.awaitingYou` ("รอคุณอนุมัติ · ชั้นที่ {step} จาก {total}") ONLY if the wire gives the step/total — it does NOT → render a **thin status line** from a plain status phrase (e.g. `รออนุมัติ` phrases) instead; do NOT fabricate the tier-step
- `อนุมัติ · {amount} ฿` = dict `mob.approval.detail.approveWithAmount` (approve button; amount REAL verbatim)
- (OMIT) `mob.approval.detail.{yourLimit,withinLimit,approvalPath,youMarker,waitedFor,budgetAfterApproval,budgetUsed,budgetLeft}` + `เอกสารแนบ` phrases — all honest-omitted per §2 (limit/approver-chain/budget-bar/attachments not in contract)

### Backend prep DONE (orch-B · B-259): the inbox row now carries `id` (pr.id/po.id/wo.id) — use it for the
### detail push. Also carries `created_at` (real age). Still NO `id` alternative needed. `project` name is NOT
### on the inbox row → honest-omit the project line in the inbox card (it IS present on GET /pr/:id for detail).
