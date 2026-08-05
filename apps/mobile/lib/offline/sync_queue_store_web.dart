// Durable sync-queue store — web fallback (B-289).
//
// Selected by the conditional export in sync_queue_store.dart when dart:io is
// absent, i.e. the web build — which is currently the ONLY target this repo can
// build (apps/mobile has no ios/ android/ macos/ linux/ windows/ directory; `flutter
// build web` is green).
//
// Drift CAN persist on web, but only through `WasmDatabase`, which needs two binary
// assets served from web/ — `sqlite3.wasm` and `drift_worker.js`. Neither is in this
// repo, and vendoring them is a stack decision (the geolocator/B-260 precedent), so
// it is escalated as **BLOCKERS.md B-289** rather than decided in the loop.
//
// Until then this returns null and the caller (`AppServices.bootstrap`) degrades to
// the in-memory queue — honestly non-durable on web, never a fake "saved".

import 'sync_queue.dart';

/// Always null on web: no durable executor is available (B-289).
Future<SyncQueue?> openDurableSyncQueue() async => null;
