# orch-D kickoff — MOBILE lane — 2026-08-04 (post-41st)

> First read `agents/orch-briefs/START-HERE.md` (state + protocol), then this.

## You are orch-D
Zone: `apps/mobile` (Flutter). **Mobile is the biggest remaining runway — only 34% (9/26 screens).** The foundation is done and proven; your job is to build out the remaining screens, especially the money-writes.

## What's already built (build ON this, don't rebuild)
- **App shell** (5-tab MTabBar · 26-route `MobileScreenRouter` · Dio/auth · shell primitives from `packages/tokens`).
- **9 real screens:** inbox · pr-detail · approve · reject · notif · sales-crm · st-grlist · pm-jobs · pm-checkin. The approval FLOW works end-to-end (inbox→detail→approve/reject with a real prId).
- **Offline SyncProcessor level-(ก)** (`lib/offline/sync_processor.dart`) — queue-and-replay: FIFO · 2xx→done · 4xx→dead-letter · 5xx→defer+STOP · money=SERVER (replay same payload to same endpoint). `pm-checkin` is the first offline-write screen (money=NONE · geolocator injectable GpsSource).

## The mobile screen-port pattern (mirror the merged screens)
- raw-Dio repository reading the **opaque `Entity` as a raw Map** (never a hand-written model) → pure unit-testable `*_agg.dart` derivation → shell-primitive UI · honest-empty + loading skeleton.
- **Thai ONLY in `assets/i18n/screens/*_strings.json` sidecars** (borrow existing dict keys; a brand-new key → STOP + Wei mint round). **ZERO Thai in `lib/**.dart`** (comments too).
- Register in `mobile_screen_router.dart` + `mobile_routes.dart` — `mobileScreenBuilders.keys.toSet()` MUST equal `kBuiltRouteIds` (a test enforces it).
- no-fabrication: em-dash / honest-omit anything the wire doesn't back. money/authority = SERVER.
- Push `feature/mobile-**` → orch-B verifies (gate-4.5 + flutter analyze/test + money-skeptic for writes) → dev.

## Your next work (roadmap P2 — the mobile money-write wave)
1. **field-GR screen** (goods receipt on site) — **READY NOW:** `POST /gr` already has the B-261 idempotency contract, so the offline replay is safe. Enqueue a `SyncOperation` carrying the client `idempotency_key` (= `SyncOperation.id`), send it in the create body, drain. money=SERVER · 3 honest states (online-confirmed / offline-QUEUED / failed).
2. **attendance + fm-progress money-writes** — WAIT for orch-A to apply the B-261 template to `POST /labor/attendance` + the progress endpoint (idempotency_key column + partial index + catch), THEN build the screens the same way. money (payroll / revenue).
3. **durable queue (B-262)** — swap the in-memory default in `app_services.dart` for `DriftSyncQueue` + add an on-app-resume drain trigger, so queued writes survive an app kill.
4. **the 17 remaining read/action screens** — service(4) · PM(checklist/notes/close) · storefm(3) · on-site field · exec — grouped by role, several waves.

## Notes
- pixel-G5 is N/A for mobile (the refs are mock Fiori content) → design fidelity via gate-4.5 structural match; a real Flutter golden baseline needs an emulator (deferred).
- The app is currently **web-only** (no ios/android dirs) → geolocator uses the browser Geolocation API; iOS/Android permission entries are documented in `lib/app/gps_source.dart` for when those platforms are scaffolded — don't guess platform boilerplate.

## Current pointers
main `bb9ded8` (41st) · dev `59da955`. Last channel: C-442. B-260 (geolocator) approved · B-262/263 open follow-ups.
