// Durable sync-queue store — dart:io implementation (B-262).
//
// Selected by the conditional export in sync_queue_store.dart on every dart:io
// target (iOS/Android/macOS/Windows/Linux, and the Dart VM that runs
// `flutter test`). Uses drift's `NativeDatabase`, i.e. real on-disk SQLite via the
// already-declared `sqlite3_flutter_libs` dependency — no new package.
//
// Nothing here holds sync POLICY: the level-(a) drain policy lives in
// sync_processor.dart and is untouched. This file only answers "where do the rows
// live", which is what makes a queued write survive an app kill.

import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path_provider/path_provider.dart';

import 'local_db.dart';
import 'sync_queue.dart';

/// File name of the queue database inside the app's documents directory.
const String kSyncQueueDbFileName = 'juneflow_sync_queue.sqlite';

/// Opens the durable queue over an explicit [file] — the seam the tests drive.
///
/// Returns the REAL production [DriftSyncQueue] over a REAL SQLite file; the only
/// thing [openDurableSyncQueue] adds on top is resolving the directory. Callers own
/// the handle and should [DriftSyncQueue.close] it when done.
DriftSyncQueue openSyncQueueAt(File file) {
  file.parent.createSync(recursive: true);
  return DriftSyncQueue(LocalDb(_executorFor(file)));
}

/// Opens the app's durable queue in the platform's documents directory, or returns
/// null when this device cannot provide one.
///
/// Null (rather than a throw) is deliberate: the caller — `AppServices.bootstrap` —
/// then falls back to the non-durable in-memory queue, so a device that cannot open
/// SQLite still runs instead of failing to boot. The path resolution goes through a
/// platform channel (`path_provider`), which is absent in a plain unit test and can
/// fail on a misconfigured device; both cases land here as null.
Future<SyncQueue?> openDurableSyncQueue() async {
  try {
    final Directory dir = await getApplicationDocumentsDirectory();
    return openSyncQueueAt(File('${dir.path}/$kSyncQueueDbFileName'));
  } catch (_) {
    // No documents directory (no platform channel / permission denied) → no durable
    // store on this run. The caller degrades to in-memory rather than crashing.
    return null;
  }
}

QueryExecutor _executorFor(File file) => NativeDatabase(file);
