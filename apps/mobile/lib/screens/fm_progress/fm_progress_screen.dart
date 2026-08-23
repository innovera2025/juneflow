// FmProgressScreen — the mobile foreman progress report, ported from
// pototype/mobile-field.jsx MFmProgress (L92-143). Route `fm-progress`
// (mobile_routes.dart; MobileSection.field). money = NONE, but the percentage this
// writes feeds work-period acceptance and percent-of-completion revenue downstream.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header, the zone-average
// strip with its "sent" pill, one card per activity holding a [-5] [bar] [+5] [n%]
// row and a "was N% -> M%" caption, and the sticky submit bar. Every colour / space
// is a generated design token (JuneflowTokens); every string is an i18n key from the
// sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// WHAT THE PROTOTYPE FAKES AND THIS DOES NOT:
//   - its four activity names and baselines are literals; here every line is a REAL
//     timeline_task with its stored pct (B-436 — the only per-activity completion
//     percentage in the schema);
//   - its submit only fires a toast. Here each CHANGED line is a real
//     POST /timeline/tasks/{id}/progress, and the screen RE-READS afterwards rather
//     than flipping to "sent" optimistically — the pill appears because the server
//     agreed, not because the button was pressed;
//   - the two photo tiles per activity are DROPPED. The mobile app has no image
//     picker or upload seam and no endpoint takes a photo for a timeline task, so
//     they are omitted rather than drawn as decoration (the same call B-297 made
//     about field-progress's photo grid);
//   - the eyebrow's "· สมคิด ร. · Block B" is a mock person and a mock block. The
//     role word is kept and the project's REAL name follows it; an unresolved name
//     em-dashes.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'fm_progress_agg.dart';
import 'fm_progress_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `fm-progress`: resolves the shared services from [AppScope],
/// loads the screen's i18n sidecar, then renders [FmProgressScreen].
class FmProgressScreenHost extends StatefulWidget {
  const FmProgressScreenHost({super.key});

  @override
  State<FmProgressScreenHost> createState() => _FmProgressScreenHostState();
}

class _FmProgressScreenHostState extends State<FmProgressScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('fm_progress');
  }

  @override
  Widget build(BuildContext context) {
    final AppServices services = AppScope.of(context);
    return Scaffold(
      backgroundColor: JuneflowTokens.surfaceBg,
      body: FutureBuilder<ScreenStrings>(
        future: _stringsFuture,
        builder: (BuildContext context, AsyncSnapshot<ScreenStrings> snap) {
          final ScreenStrings? strings = snap.data;
          if (strings == null) {
            return const ColoredBox(color: JuneflowTokens.surfaceBg);
          }
          return FmProgressScreen(
            read: DioFmProgressReadRepository(services.dio),
            write: QueueBackedFmProgressRepository(services.syncProcessor),
            strings: strings,
            i18n: services.i18n,
          );
        },
      ),
    );
  }
}

/// The foreman progress view. Dependencies are injected so the screen is driven
/// directly in tests (fakes + inline strings/i18n), never via the network.
class FmProgressScreen extends StatefulWidget {
  const FmProgressScreen({
    super.key,
    required this.read,
    required this.write,
    required this.strings,
    required this.i18n,
  });

  final FmProgressReadRepository read;
  final FmProgressWriteRepository write;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<FmProgressScreen> createState() => _FmProgressScreenState();
}

class _FmProgressScreenState extends State<FmProgressScreen> {
  late final Future<void> _future = _load();
  List<ProgressLine> _lines = const <ProgressLine>[];
  String? _projectName;
  bool _busy = false;

  /// True only after a submit whose re-read came back with nothing left dirty.
  bool _sent = false;

  Future<void> _load() async {
    final TimelineRead read = await widget.read.timeline();
    if (!mounted) return;
    setState(() {
      _projectName = read.projectName;
      _lines = toLines(read.tasks);
    });
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);

  void _adjust(int index, int delta) {
    setState(() {
      _lines = adjust(_lines, index, delta);
      // Any new edit retires the "sent" pill: it describes the last SUBMIT, and a
      // dial that has moved since is no longer what the server holds.
      _sent = false;
    });
  }

  /// Send every CHANGED line, then re-read. Nothing is flipped optimistically: the
  /// pill appears only because the re-read came back with nothing left dirty.
  Future<void> _submit() async {
    if (_busy) return;
    final List<ProgressLine> pending = pendingLines(_lines);
    if (pending.isEmpty) return;
    setState(() => _busy = true);
    for (final ProgressLine line in pending) {
      try {
        await widget.write.reportProgress(taskId: line.id, pct: line.draftPct);
      } catch (_) {
        // Queued or refused; the re-read below shows the server's actual state
        // rather than a claimed success.
      }
    }
    await _load();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _sent = pendingLines(_lines).isEmpty;
    });
  }

  @override
  Widget build(BuildContext context) {
    final int? avg = averagePct(_lines);
    final bool dirty = pendingLines(_lines).isNotEmpty;
    return Column(
      children: <Widget>[
        MobileHeader(title: _t('title'), sub: '${_t('role')} · ${_projectName ?? _dash}'),
        _averageStrip(avg),
        Expanded(
          child: FutureBuilder<void>(
            future: _future,
            builder: (BuildContext context, AsyncSnapshot<void> snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              return ListView.builder(
                padding: const EdgeInsets.fromLTRB(0, 10, 0, 12),
                itemCount: _lines.length,
                itemBuilder: (BuildContext context, int i) => _lineCard(i, _lines[i]),
              );
            },
          ),
        ),
        _submitBar(dirty),
      ],
    );
  }

  /// The zone-average strip (prototype L108-112).
  Widget _averageStrip(int? avg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          Text(
            _t('avgLabel'),
            style: const TextStyle(fontSize: 11.5, color: JuneflowTokens.textSecondary),
          ),
          const Spacer(),
          Text(
            avg == null ? _dash : '$avg%',
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: JuneflowTokens.brandPrimary,
            ),
          ),
          if (_sent) ...<Widget>[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: JuneflowTokens.statusOkSoft,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                _t('sent'),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.statusOkFg,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// One activity card (prototype L114-133, minus the photo tiles).
  Widget _lineCard(int index, ProgressLine line) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            line.label ?? _dash,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              _StepButton(
                label: '-$kProgressStep',
                enabled: !_busy && line.draftPct > 0,
                onTap: () => _adjust(index, -kProgressStep),
              ),
              const SizedBox(width: 10),
              Expanded(child: _Bar(pct: line.draftPct)),
              const SizedBox(width: 10),
              _StepButton(
                label: '+$kProgressStep',
                enabled: !_busy && line.draftPct < 100,
                onTap: () => _adjust(index, kProgressStep),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 42,
                child: Text(
                  '${line.draftPct}%',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: line.draftPct >= 100
                        ? JuneflowTokens.statusOkFg
                        : JuneflowTokens.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              const Spacer(),
              Text(
                '${_t('wasLabel')} ${line.storedPct}% → ${line.draftPct}%',
                style: TextStyle(
                  fontSize: 10.5,
                  color: line.dirty
                      ? JuneflowTokens.brandPrimary
                      : JuneflowTokens.textTertiary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The sticky submit bar (prototype L138-140). Inert until something changed —
  /// a submit with nothing dirty would write values nobody reported.
  Widget _submitBar(bool dirty) {
    final bool enabled = dirty && !_busy;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: GestureDetector(
        onTap: enabled ? _submit : null,
        child: Container(
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: enabled ? JuneflowTokens.brandPrimary : JuneflowTokens.surfaceAlt,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            _t('submit'),
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              color: enabled ? Colors.white : JuneflowTokens.textTertiary,
            ),
          ),
        ),
      ),
    );
  }
}

/// A 34px square +/- control (prototype L117 / L124).
class _StepButton extends StatelessWidget {
  const _StepButton({required this.label, required this.enabled, required this.onTap});

  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w800,
            color: enabled ? JuneflowTokens.textPrimary : JuneflowTokens.textTertiary,
          ),
        ),
      ),
    );
  }
}

/// The 14px progress bar (prototype L119-122).
class _Bar extends StatelessWidget {
  const _Bar({required this.pct});

  final int pct;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: Container(
        height: 14,
        color: JuneflowTokens.surfaceMuted,
        child: FractionallySizedBox(
          widthFactor: pct / 100,
          alignment: Alignment.centerLeft,
          child: ColoredBox(
            color: pct >= 100 ? JuneflowTokens.statusOkFg : JuneflowTokens.brandPrimary,
          ),
        ),
      ),
    );
  }
}
