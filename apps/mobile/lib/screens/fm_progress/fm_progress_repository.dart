// Data access for the mobile foreman progress screen (route `fm-progress`).
// money = NONE, but the number this writes feeds work-period acceptance and
// percent-of-completion revenue downstream, so the write goes through the same
// offline queue the other write screens use.
//
// READ uses raw Dio, like every other mobile repository: the contract types the
// timeline payload as the opaque `Entity`, whose generated Dart model declares no
// fields and discards every real column, and inventing contract fields is forbidden
// (PLAN.md §0). See approvals_inbox_repository.dart for the same note.
//   GET /projects                  -> the tenant's projects (the schedule's owner)
//   GET /projects/{id}/timeline    -> { project_id, start_date, end_date,
//                                       as_of_date, tasks[], milestones[] }
//
// WRITE is one call per CHANGED activity, enqueued and replayed by the shared
// level-(a) QueueDrainProcessor:
//   POST /timeline/tasks/{id}/progress { pct }
//
// NO IDEMPOTENCY KEY, and the endpoint takes none: the write SETS an absolute
// percentage rather than adding to one, so a replay leaves the row where it already
// is. The key that pm_checkin and field_stock carry exists to stop a retry moving a
// number twice, which cannot happen to an assignment.
//
// The op id is per task and per reported value, so two different reports on one
// activity are two ops rather than one silently overwriting the other in the queue.
import 'package:dio/dio.dart';

import '../../offline/pending_op_adoption.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import 'fm_progress_agg.dart';

/// The timeline read, narrowed to what this screen needs.
class TimelineRead {
  const TimelineRead({required this.projectId, required this.projectName, required this.tasks});

  final String? projectId;

  /// The project's own name, for the header's second line. Null -> em-dash.
  final String? projectName;
  final List<WireRow> tasks;

  static const TimelineRead empty = TimelineRead(
    projectId: null,
    projectName: null,
    tasks: <WireRow>[],
  );
}

abstract class FmProgressReadRepository {
  /// The first project's schedule. The shell has no project-picker seam yet, so the
  /// screen follows the first project the tenant lists — the same thing the merged
  /// web alloc screen does, and an honest empty state when there is none.
  Future<TimelineRead> timeline();
}

abstract class FmProgressWriteRepository {
  /// Enqueue one activity's reported percentage and drive the drain.
  Future<DrainReport> reportProgress({required String taskId, required int pct});

  /// Re-drain without enqueuing — the manual retry and the on-mount trigger.
  Future<DrainReport> drain();

  /// The ops still queued, so the screen can resolve its own ops' outcome.
  Future<List<SyncOperation>> due();
}

/// The queue identity of a progress report. One definition for the enqueue and the
/// screen's own matcher, so the two cannot drift apart (B-330).
SyncOpIdentity fmProgressOpIdentity(String taskId) =>
    SyncOpIdentity(entityType: 'timeline_progress', endpoint: '/timeline/tasks/$taskId/progress');

class DioFmProgressReadRepository implements FmProgressReadRepository {
  const DioFmProgressReadRepository(this._dio);

  final Dio _dio;

  @override
  Future<TimelineRead> timeline() async {
    final Response<Object?> projectsRes = await _dio.get<Object?>('/projects');
    final Object? projectsBody = projectsRes.data;
    if (projectsBody is! Map) return TimelineRead.empty;
    final Object? data = projectsBody['data'];
    if (data is! List || data.isEmpty) return TimelineRead.empty;
    final Object? first = data.first;
    if (first is! Map) return TimelineRead.empty;
    final Object? id = first['id'];
    if (id == null) return TimelineRead.empty;
    final String projectId = '$id';
    final Object? name = first['name'];

    final Response<Object?> res = await _dio.get<Object?>('/projects/$projectId/timeline');
    final Object? body = res.data;
    if (body is! Map) {
      return TimelineRead(
        projectId: projectId,
        projectName: name == null ? null : '$name',
        tasks: const <WireRow>[],
      );
    }
    final Object? tasks = body['tasks'];
    return TimelineRead(
      projectId: projectId,
      projectName: name == null ? null : '$name',
      tasks: <WireRow>[
        if (tasks is List)
          for (final Object? t in tasks)
            if (t is Map)
              t.map<String, Object?>(
                (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
              ),
      ],
    );
  }
}

class QueueBackedFmProgressRepository implements FmProgressWriteRepository {
  const QueueBackedFmProgressRepository(this.processor);

  /// The app's shared drain processor (`AppServices.syncProcessor`, B-262). Public
  /// so the host wiring stays assertable.
  final QueueDrainProcessor processor;

  @override
  Future<DrainReport> reportProgress({required String taskId, required int pct}) async {
    final SyncOpIdentity identity = fmProgressOpIdentity(taskId);
    await processor.queue.enqueue(
      SyncOperation(
        // Per task AND per value: a foreman who reports 40 and then 45 has made two
        // reports, and collapsing them onto one queue id would drop the second.
        id: 'timeline-progress:$taskId:$pct',
        entityType: identity.entityType,
        kind: SyncOpKind.update,
        endpoint: identity.endpoint,
        method: 'POST',
        payload: <String, Object?>{'pct': pct},
        createdAt: DateTime.now(),
      ),
    );
    return processor.drain();
  }

  @override
  Future<DrainReport> drain() => processor.drain();

  @override
  Future<List<SyncOperation>> due() => processor.queue.pending();
}
