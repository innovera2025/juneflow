// Offline-first sync queue — public surface (P0-MOB-05).
//
// Import this to use the level-agnostic offline queue:
//   import 'package:juneflow_mobile/offline/offline.dart';
//
// local_db.dart (drift) is intentionally NOT re-exported here: pulling it into
// the barrel would drag the native-SQLite dependency into every consumer. Import
// it directly where a real device database is wired (Phase 4).

export 'in_memory_sync_queue.dart';
export 'sync_operation.dart';
export 'sync_processor.dart';
export 'sync_queue.dart';
