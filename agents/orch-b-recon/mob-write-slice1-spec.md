# MOBILE WRITE WAVE — slice 1: SyncProcessor (ก) + E2 PM checkin — orch-B spec

Owner: orch-B. B-242 ruled **(ก) queue-and-replay** (Wei 2026-08-04). This slice implements the
level-(ก) `SyncProcessor` policy (the deliberately-deferred seam) + the FIRST offline-write screen
(E2 PM checkin), which is **money=NONE** (safe first write — a replay-duplicate just re-sets
checkin_gps, no JV/double-post). Design-fidelity law: the execute-agent MUST re-read
`pototype/mobile-pm.jsx` L51-89 (MPMCheckin) THIS round before writing.

## 0. Why this screen first
- money=NONE (GPS arrival event) → an at-least-once replay-duplicate is HARMLESS. (Field-labor
  attendance / GR / progress are money-adjacent — a duplicate inflates pay / double-posts a JV —
  so they come in LATER slices once idempotency is hardened. Do NOT build them here.)
- The backend endpoint already exists: `POST /pm/workorders/:id/checkin {gps}` → ActionOk
  (pm.ts, openapi 1945). NO backend change, NO sacred change this slice.
- Establishes the offline-write pattern end-to-end (enqueue → optimistic UI → drain → confirm).

## 1. SyncProcessor (ก) policy — the level-dependent seam (`lib/offline/sync_processor.dart`)
The spine is built + level-agnostic: `SyncOperation` (id = client-gen idempotency uuid · entityType ·
endpoint · method · payload · createdAt · status · attempts), `SyncQueue`/`DriftSyncQueue` (durable
FIFO), `InMemorySyncQueue` (unit test). Implement the (ก) drain policy:

- **`drain(ApiClient)`** — process the queue **FIFO**. For each `pending` op, in order:
  - call `op.method op.endpoint` with `op.payload` via the shared Dio/generated client;
  - **2xx** → mark the op `done` and remove it from the queue (success);
  - **4xx** (client error — permanent; the payload is wrong, retrying won't help) → mark `failed`,
    stop treating it as pending, surface it (a failed op must be visible, never silently dropped);
  - **5xx / network / timeout** (transient) → leave it `pending`, increment `attempts`, STOP the
    drain (FIFO integrity: don't skip ahead past a stuck op) — it retries on the next drain.
  - Never reorder; never drop a pending op silently; a `done` op is removed, a `failed` op is kept
    with its error for the UI.
- **Trigger (ก, dependency-free — NO connectivity package this slice):** `drain()` is invoked
  (a) immediately after an enqueue (the online happy-path drains at once), (b) on
  screen-mount / app-resume, and (c) a manual "retry" affordance. A background connectivity
  listener is a deferred enhancement (level-agnostic — can be added without changing this policy).
- **Retry/back-off:** attempts is incremented; a simple bounded back-off (e.g. skip an op whose
  last attempt was <N seconds ago) is acceptable but keep it minimal + deterministic (no wall-clock
  in unit tests — inject a clock or gate on attempts). Do NOT add a timer/isolate.
- **money=SERVER preserved:** the replay POSTs to the SAME server endpoint with the SAME payload —
  the server remains the sole authority. The client NEVER computes money or mutates a local
  source-of-truth. (Level ก = network-first reads; no local read DB.)
- **Idempotency note (honest scope):** the op carries an idempotency `id`. This slice's endpoint is
  money=NONE so at-least-once is safe WITHOUT server-side dedup. Do NOT invent an Idempotency-Key
  header contract here (that's a sacred openapi change for the money-write slices — file it as a
  forward-dep blocker for those slices, do NOT self-adjudicate).

Unit tests (against InMemorySyncQueue + a fake ApiClient): 2xx→removed · 4xx→failed-and-kept ·
5xx→pending-retried-next-drain · FIFO order preserved · a stuck op blocks the ones behind it ·
drain is safe on an empty queue · attempts increments.

## 2. E2 PM checkin screen (`pototype/mobile-pm.jsx` L51-89 MPMCheckin)
- route id `pm-checkin` (already a known route / placeholder). Register it (builders + kBuiltRouteIds
  in lockstep — the route test enforces `builders.keys.toSet() == kBuiltRouteIds`).
- Reached from `pm-jobs` (a work-order row → checkin) carrying the PMWO id via the Navigator.push
  seam (same mechanism the inbox→detail wave established: PrDetailScreenHost-style host with an id
  param). If pm-jobs has no row→checkin push yet, wire it minimally (the id is the work-order id).
- UI (shell primitives, byte-faithful to MPMCheckin): the map placeholder card (NOT a real map —
  render the prototype's static map card honestly; do NOT fabricate live GPS unless a real
  geolocation source is wired — see below), the service-info MSection (เขตบริการ/SLA/สัญญา — these
  are work-order fields: render REAL ones off the wire if the checkin/wo detail provides them, else
  honest em-dash — do NOT fabricate SLA/zone), and the sticky "เช็คอินหน้างาน (GPS)" button.
- **GPS honesty:** the prototype shows a hardcoded lat/long + distance. Real geolocation needs a
  device sensor (geolocator package). For THIS slice, if no geolocation source is wired, the checkin
  payload's `gps` is either (a) omitted/honest-null with the button still functioning (records a
  check-in without coords), or (b) a real geolocator read IF the package is already a dependency.
  Do NOT fabricate a fixed lat/long as if it were the device's real position. If geolocation is out
  of scope this slice, the button enqueues a checkin with gps=null (honest) and a follow-up blocker
  notes the geolocator wiring. Pick the honest path; do NOT ship a fake coordinate.
- **The write (the point of this slice):** tapping เช็คอิน enqueues a `SyncOperation`
  {method: POST, endpoint: `/pm/workorders/<id>/checkin`, payload: {gps}} then calls `drain()`.
  - online → drains immediately → the "เช็คอินสำเร็จ · <time>" success state (time from the server
    ActionOk response if it carries one, else the client submit time — honest, labelled).
  - offline / drain fails transiently → an honest **"pending sync"** state (queued, will retry),
    NOT a fake success. The user must see the difference between confirmed and queued.
  - permanent (4xx) → an honest error state.
- On success → the "เริ่มตรวจเช็ค" button (navigates to pm-checklist — a FUTURE screen; if not
  built, this can be honest-disabled or a placeholder push. Do NOT build the checklist here.)

## 3. Files (mirror the merged mobile pattern)
- `lib/offline/sync_processor.dart` — implement the (ก) drain policy (the file exists as an
  unimplemented seam — fill it; keep it level-(ก), documented as such).
- `lib/screens/pm_checkin/pm_checkin_repository.dart` — enqueues the SyncOperation + exposes drain;
  raw-Dio for any read (wo detail for the service-info fields, if wired).
- `lib/screens/pm_checkin/pm_checkin_agg.dart` — pure derivation of the display state
  (idle/pending/success/failed) + the service-info fields (real vs em-dash).
- `lib/screens/pm_checkin/pm_checkin_screen.dart` — shell primitives, the 3 honest states.
- register `pm-checkin` in `mobile_screen_router.dart` + `mobile_routes.dart` (lockstep).
- Thai ONLY in `assets/i18n/screens/pm_checkin_strings.json` sidecar (borrow existing keys where
  possible; if a brand-new key is needed, STOP and report it for a Wei mint round — do NOT edit
  i18n-full.json). zero-Thai in lib/**.dart.
- tests: `test/offline/sync_processor_test.dart` (the drain policy — the most important tests) +
  `test/screens/pm_checkin/*`.

## 4. Invariants (gate-4.5 will check)
- money=SERVER/authority=SERVER: the replay hits the same endpoint; no client money/decision.
- no-fabrication: honest online-confirmed vs offline-queued vs failed states (NEVER a fake success);
  no fabricated GPS coordinate; service-info fields real-or-em-dash.
- FIFO + at-least-once + no-silent-drop in the SyncProcessor; a failed op stays visible.
- honest-empty + loading; opaque-Entity raw-Map reads; zero-Thai-in-lib; zero unapproved i18n mint.
- pixel-G5 N/A (mock Fiori ref) → fidelity via gate-4.5.

## 5. Out of scope (do NOT build / decide here — file as forward-deps if hit)
- Money-write screens (field GR, progress→revenue, field attendance) — need server-side idempotency
  (an Idempotency-Key contract = sacred openapi) → later slices + a Wei ruling.
- Background connectivity listener (geolocator / connectivity_plus packages) — deferred enhancement.
- pm-checklist / pm-close screens — future.
