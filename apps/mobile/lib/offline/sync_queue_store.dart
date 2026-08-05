// Offline-first sync — how the app OPENS the durable queue (B-262 / B-289).
//
// `DriftSyncQueue` (local_db.dart) has always been the durable store on paper, but
// nothing in lib/ ever constructed one: `AppServices.bootstrap` wired
// `InMemorySyncQueue`, so every queued write died with the process. This file is
// the missing constructor — and it is deliberately platform-conditional, because
// opening a drift database needs a `QueryExecutor` and the right executor differs
// per target:
//
//   * dart:io targets (iOS/Android/macOS/Windows/Linux — and the Dart VM that runs
//     `flutter test`) → drift's `NativeDatabase` over a real file. Real SQLite, real
//     durability. Implemented in sync_queue_store_io.dart.
//   * web → drift needs `WasmDatabase` plus the `sqlite3.wasm` + `drift_worker.js`
//     assets served from web/. Those binaries are NOT in this repo and adding them
//     is a stack decision, not a loop decision → **BLOCKERS.md B-289**. Until Wei
//     rules, the web build honestly reports "no durable executor" (null) and the
//     caller falls back to the in-memory queue. See sync_queue_store_web.dart.
//
// The conditional export is what keeps `flutter build web` compiling: dart2js never
// sees `package:drift/native.dart` (dart:ffi) because the io branch is not selected.
//
// This file is intentionally NOT re-exported from offline.dart, for the same reason
// local_db.dart is not: it would drag the native-SQLite dependency into every
// consumer of the barrel. Import it directly where the app is wired.

export 'sync_queue_store_web.dart'
    if (dart.library.io) 'sync_queue_store_io.dart';
