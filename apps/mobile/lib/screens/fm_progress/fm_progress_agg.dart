// Pure derivation for the mobile foreman progress screen (route `fm-progress`).
//
// Ported from pototype/mobile-field.jsx MFmProgress (L92-143). The prototype holds
// four hardcoded activity names with hardcoded baselines and a submit button that
// only fires a toast, so nothing here transcribes its numbers.
//
// THE SUBJECT IS timeline_task, and that is a derivation rather than a preference
// (B-436). It is the only table in the schema with a per-activity completion
// percentage: a work period carries a STATUS and its own `pct` is a TARGET share,
// which B-297 (4) already ruled is not progress, and a BOQ item is a material or
// labour line (bags of cement), not an activity. The seeded task labels are also the
// same kind of name as the prototype's, because both come from the same prototype.
//   GET  /projects/{id}/timeline            -> the activities and their current pct
//   POST /timeline/tasks/{id}/progress      -> report one activity's new pct
//
// ASCII-only, no Thai (i18n-guard) — every string the screen shows is a sidecar key.

/// One opaque wire row, as the repository hands it over.
typedef WireRow = Map<String, Object?>;

/// Read a string field off an opaque row; null when absent/blank.
String? _str(Object? v) {
  if (v is String) {
    final String t = v.trim();
    return t.isEmpty ? null : t;
  }
  return v?.toString();
}

/// Read a finite number off an opaque value; null when absent/unparseable.
///
/// numeric(5,2) arrives as a STRING from node-postgres, so a parse that only
/// accepted `num` would zero every percentage on a real response.
double? _num(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v.trim());
  return null;
}

/// The step the +/- buttons move, from the prototype's own two controls.
const int kProgressStep = 5;

/// One activity as the screen edits it.
class ProgressLine {
  const ProgressLine({
    required this.id,
    required this.label,
    required this.groupLabel,
    required this.storedPct,
    required this.draftPct,
  });

  final String id;

  /// timeline_task.label. Null renders as an em-dash, never as a prototype name.
  final String? label;

  /// timeline_task.group_label — the band the activity sits in.
  final String? groupLabel;

  /// The percentage currently STORED on the server. The "was N%" caption reads this,
  /// so an unsubmitted edit can never make the row look already-saved.
  final int storedPct;

  /// What the foreman has dialled to but not yet sent.
  final int draftPct;

  /// True once the draft differs from what the server holds.
  bool get dirty => draftPct != storedPct;

  ProgressLine withDraft(int pct) => ProgressLine(
    id: id,
    label: label,
    groupLabel: groupLabel,
    storedPct: storedPct,
    draftPct: pct,
  );
}

/// Narrow the timeline read into editable lines.
///
/// A row with no id is dropped: the write addresses a task BY id, so a line the
/// screen could not submit would be a control that silently does nothing.
List<ProgressLine> toLines(List<WireRow> tasks) {
  final List<ProgressLine> out = <ProgressLine>[];
  for (final WireRow t in tasks) {
    final String? id = _str(t['id']);
    if (id == null) continue;
    final int pct = clampPct((_num(t['pct']) ?? 0).round());
    out.add(
      ProgressLine(
        id: id,
        label: _str(t['label']),
        groupLabel: _str(t['group_label'] ?? t['groupLabel']),
        storedPct: pct,
        draftPct: pct,
      ),
    );
  }
  return out;
}

/// Hold a percentage inside the range the endpoint accepts (0-100 inclusive).
///
/// Clamped on the CLIENT as well as the server because the +/- buttons would
/// otherwise let a foreman dial to 105 and receive a 400 he cannot act on. The
/// server still validates — this is the explanation of the limit, not its
/// enforcement.
int clampPct(int pct) => pct < 0 ? 0 : (pct > 100 ? 100 : pct);

/// Apply one +/- tap to the line at [index].
List<ProgressLine> adjust(List<ProgressLine> lines, int index, int delta) {
  if (index < 0 || index >= lines.length) return lines;
  return <ProgressLine>[
    for (int i = 0; i < lines.length; i++)
      if (i == index) lines[i].withDraft(clampPct(lines[i].draftPct + delta)) else lines[i],
  ];
}

/// The zone average the header shows, over the DRAFT values the foreman sees.
///
/// Rounded once at the end, like the prototype. An empty list has no average —
/// null, so the header em-dashes rather than printing a 0% that reads as "no work
/// done" when the truth is "no activities".
int? averagePct(List<ProgressLine> lines) {
  if (lines.isEmpty) return null;
  final int sum = lines.fold(0, (int s, ProgressLine l) => s + l.draftPct);
  return (sum / lines.length).round();
}

/// The lines whose draft differs from the server — the ones a submit must send.
///
/// Only the changed ones: re-sending an untouched line would write a value nobody
/// reported, and would make every submit look like a report on every activity.
List<ProgressLine> pendingLines(List<ProgressLine> lines) =>
    lines.where((ProgressLine l) => l.dirty).toList();
