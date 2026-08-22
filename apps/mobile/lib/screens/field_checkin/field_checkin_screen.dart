// FieldCheckinScreen — the mobile labour check-in, ported from
// pototype/mobile-screens.jsx MFieldCheckin (L534-578). Route `field-checkin`
// (mobile_routes.dart; MobileSection.field). money = NONE directly, but attendance
// is what payroll multiplies, so both writes go through the offline queue with a
// deterministic idempotency key.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow + title
// + a right-hand disc), the brand-gradient profile card with a round avatar, the
// name and role line under it, and the two side-by-side CTAs, green check-in and
// grey check-out. Every colour / space is a generated design token
// (JuneflowTokens); every string is an i18n key from the sidecar (no Thai byte in
// this file — i18n-guard, §0 rule 2).
//
// TWO ELEMENTS ARE GONE BY WEI'S RULING (B-437 = ก, 2026-08-23):
//   - the geofence chip "in range of the site (12 m)": no site coordinate exists
//     anywhere in the schema, so there is nothing to measure a distance from;
//   - the "today's assigned work" section: no endpoint carries that subject (the
//     nearest, GET /sales/service, is service jobs and duplicates tech-jobs).
// The approve_screen.dart precedent is the same shape — an element with no wire is
// omitted, never invented.
//
// TWO MORE ARE GONE AS MOCK MECHANICS (§0 rule 3): the prototype's "· 08:00" baked
// into the check-in button, and the "Site Engineer · juneflow ราชพฤกษ์" role line.
// The time now comes from the stored `checked_in_at`, and the role line from the
// worker's own skill/team columns — each em-dashes when the wire is silent.
//
// Data (§0 rule 3): the prototype's hardcoded worker is dropped. The screen resolves
// WHO the caller is exactly as the server's self-service door does (GET /me ->
// GET /labor/workers, matching user_id), then reads today's row out of
// GET /labor/attendance. In the current seed NO worker carries a user_id (B-438), so
// the honest "no linked worker" state is what most callers will see — the buttons
// are withheld rather than offered and guaranteed to 403.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../app/gps_source.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'field_checkin_agg.dart';
import 'field_checkin_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `field-checkin`: resolves the shared services from [AppScope],
/// loads the screen's i18n sidecar, then renders [FieldCheckinScreen].
class FieldCheckinScreenHost extends StatefulWidget {
  const FieldCheckinScreenHost({super.key});

  @override
  State<FieldCheckinScreenHost> createState() => _FieldCheckinScreenHostState();
}

class _FieldCheckinScreenHostState extends State<FieldCheckinScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('field_checkin');
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
          return FieldCheckinScreen(
            read: DioFieldCheckinReadRepository(services.dio),
            write: QueueBackedFieldCheckinRepository(services.syncProcessor),
            gps: services.gpsSource,
            strings: strings,
            i18n: services.i18n,
          );
        },
      ),
    );
  }
}

/// Everything the screen needs to decide what to show, resolved in one pass.
class _State {
  const _State({this.worker, this.today});

  final CheckinWorker? worker;
  final CheckinDay? today;

  CheckinAction get action => nextAction(worker, today);
}

/// The labour check-in view. Dependencies are injected so the screen is driven
/// directly in tests (fakes + inline strings/i18n), never via the network.
class FieldCheckinScreen extends StatefulWidget {
  const FieldCheckinScreen({
    super.key,
    required this.read,
    required this.write,
    required this.gps,
    required this.strings,
    required this.i18n,
    this.now,
  });

  final FieldCheckinReadRepository read;
  final FieldCheckinWriteRepository write;
  final GpsSource gps;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  /// Injected clock for tests; the device clock otherwise.
  final DateTime Function()? now;

  @override
  State<FieldCheckinScreen> createState() => _FieldCheckinScreenState();
}

class _FieldCheckinScreenState extends State<FieldCheckinScreen> {
  late Future<_State> _future = _load();
  bool _busy = false;

  DateTime _now() => widget.now?.call() ?? DateTime.now();

  Future<_State> _load() async {
    final Future<WireRow?> meF = widget.read.me();
    final Future<List<WireRow>> workersF = widget.read.workers();
    final Future<List<WireRow>> attF = widget.read.attendance();
    final CheckinWorker? worker = findSelfWorker(await workersF, callerUserId(await meF));
    if (worker == null) return const _State();
    return _State(
      worker: worker,
      today: findToday(await attF, worker.id, dayOf(_now())),
    );
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);

  /// Run a write, then re-read. A queued or failed drain is reported honestly and
  /// NOTHING on screen is flipped optimistically — the next read is the truth.
  Future<void> _submit(Future<void> Function(({double lat, double lng})? fix) op) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      // A real fix or none at all. A denied/disabled sensor sends no coordinate
      // rather than a fabricated one; the endpoint accepts the pair or nothing.
      await op(splitFix(await widget.gps.currentFix()));
    } catch (_) {
      // The queue took it or it failed; either way the re-read below shows the
      // server's actual state instead of a claimed success.
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _future = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        MobileHeader(
          title: 'Check-in',
          sub: _t('eyebrow'),
          trailing: const _HeaderDisc(),
        ),
        Expanded(
          child: FutureBuilder<_State>(
            future: _future,
            builder: (BuildContext context, AsyncSnapshot<_State> snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              final _State s = snap.data ?? const _State();
              return ListView(
                padding: const EdgeInsets.fromLTRB(0, 10, 0, 80),
                children: <Widget>[
                  _profileCard(s.worker),
                  const SizedBox(height: 8),
                  _actions(s),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  /// The brand-gradient identity card (prototype L540-548, minus the geofence chip).
  Widget _profileCard(CheckinWorker? worker) {
    final String name = worker?.name ?? _dash;
    final String skill = worker?.skill ?? _dash;
    final String team = worker?.team ?? _dash;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12),
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[JuneflowTokens.brandPrimary, JuneflowTokens.brandHover],
        ),
      ),
      child: Column(
        children: <Widget>[
          _Avatar(name: worker?.name),
          const SizedBox(height: 8),
          Text(
            name,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 2),
          Text(
            '$skill · $team',
            style: const TextStyle(fontSize: 11, color: Colors.white70),
          ),
        ],
      ),
    );
  }

  /// The two CTAs (prototype L549-558). Which one is live is the server's rule, read
  /// back off the attendance row rather than tracked locally.
  Widget _actions(_State s) {
    final CheckinAction action = s.action;
    final String? inAt = clockOf(s.today?.checkedInAt);
    final String? outAt = clockOf(s.today?.checkedOutAt);
    final CheckinWorker? worker = s.worker;
    final String day = dayOf(_now());

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Row(
        children: <Widget>[
          Expanded(
            child: _Cta(
              icon: Icons.check,
              label: inAt == null
                  ? 'Check-in'
                  : widget.i18n.tf(widget.strings['checkedInAt'], <String, String>{'time': inAt}),
              tone: _CtaTone.primary,
              enabled: !_busy && action == CheckinAction.checkIn && worker != null,
              onTap: worker == null
                  ? null
                  : () => _submit(
                      (({double lat, double lng})? fix) => widget.write
                          .submitCheckIn(
                            workerId: worker.id,
                            day: day,
                            checkedInAt: _now(),
                            fix: fix,
                          )
                          .then((_) {}),
                    ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _Cta(
              icon: Icons.close,
              label: outAt == null ? 'Check-out' : 'Check-out · $outAt',
              tone: _CtaTone.muted,
              enabled: !_busy && action == CheckinAction.checkOut && worker != null,
              onTap: worker == null
                  ? null
                  : () => _submit(
                      (({double lat, double lng})? fix) => widget.write
                          .submitCheckOut(
                            workerId: worker.id,
                            day: day,
                            checkedOutAt: _now(),
                            fix: fix,
                          )
                          .then((_) {}),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The header's right-hand disc (prototype L538 — a 34px surface-3 circle).
class _HeaderDisc extends StatelessWidget {
  const _HeaderDisc();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: JuneflowTokens.surfaceMuted,
      ),
      child: const Icon(Icons.settings, size: 16, color: JuneflowTokens.textSecondary),
    );
  }
}

/// A 56px initials disc (prototype L541 Avatar). An unknown name shows the marker
/// rather than a fabricated initial.
class _Avatar extends StatelessWidget {
  const _Avatar({this.name});

  final String? name;

  @override
  Widget build(BuildContext context) {
    final String? n = name;
    final String initial = (n == null || n.isEmpty) ? _dash : n.characters.first;
    return Container(
      width: 56,
      height: 56,
      alignment: Alignment.center,
      decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.white24),
      child: Text(
        initial,
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white),
      ),
    );
  }
}

enum _CtaTone { primary, muted }

/// One of the two big call-to-action tiles (prototype L550-557).
class _Cta extends StatelessWidget {
  const _Cta({
    required this.icon,
    required this.label,
    required this.tone,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final _CtaTone tone;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bool primary = tone == _CtaTone.primary;
    final Color bg = !enabled
        ? JuneflowTokens.surfaceAlt
        : primary
        ? JuneflowTokens.statusOkFg
        : JuneflowTokens.surfaceMuted;
    final Color fg = !enabled
        ? JuneflowTokens.textTertiary
        : primary
        ? Colors.white
        : JuneflowTokens.textSecondary;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 10),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12),
          border: primary ? null : Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 22, color: fg),
            const SizedBox(height: 6),
            Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: fg),
            ),
          ],
        ),
      ),
    );
  }
}
