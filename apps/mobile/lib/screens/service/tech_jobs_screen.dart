// TechJobsScreen — the service technician's job list, ported from
// pototype/mobile-screens.jsx MTechJobs (L198-257). Route `tech-jobs`
// (mobile_routes.dart; MobileSection.service). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header with its eyebrow,
// title and round bell button (L206-211), the stat strip on a surface band with a
// bottom hairline (L212-222), and the job cards with their priority-tinted left edge,
// SR line, problem, meta line, status pill and action row (L225-255). Every colour /
// space is a generated design token (JuneflowTokens); every string is a key from the
// sidecar (no Thai byte in this file — i18n-guard, §0 rule 2). The prototype's own
// `<MTabBar active="service"/>` (L254) is not drawn: the shell owns the tab bar.
//
// Data (§0 rule 3) — the prototype's hardcoded `jobs` array (L199-204) is a mock and
// is DROPPED. The list is the REAL GET /sales/service register:
//   - SCOPE. The endpoint returns the whole tenant register (there is no per-user
//     route), so "my jobs" is a client filter on the REAL assignee_user_id column
//     against the id GET /me reports (service_agg.assignedTo). When the profile
//     cannot be read the list is honest-EMPTY: with no identity nothing can be
//     claimed as mine, and showing everyone's tickets under this title would be the
//     fabrication. This is a deliberate difference from the merged pm-jobs port,
//     which had no assignee column to filter on and therefore kept the whole list.
//   - the eyebrow is the REAL `user.name`; the prototype pairs it with a trade
//     (L207) and `user` has no trade column, so that half is dropped, not guessed.
//   - the BELL (L208-210) stays as chrome and is inert, and its red unread dot is
//     dropped: nothing here reads the notification register, so a dot would be an
//     invented unread state. Notifications are their own shell route (the pm-jobs
//     functionless-filter-pill precedent).
//   - the STAT STRIP keeps the two tiles that have columns behind them — today's
//     scheduled count (scheduled_date == today) and the urgent count
//     (priority == 'high'), both REAL counts, replacing the mock literals "4"/"1"
//     (L214-215). The third tile, a star rating (L216), is OMITTED: there is no
//     rating column and the close handler's own comment says that round did not
//     invent one (sales-service.ts L354-356).
//   - per-card meta: the SR number and the problem are real columns; the UNIT
//     ("B-08", L203) is em-dashed (unit_id is a project_node uuid with no label
//     endpoint — the merged web port em-dashes it too) and the time is the REAL
//     scheduled_date, or an em-dash when the ticket is not scheduled yet.
//
// ACTIONS — derived from the machine, never a hardcoded list (BLOCKERS.md B-294).
// service_agg.nextServiceTransition is the ONE place the linear machine lives, so a
// card can only ever offer the move the server would accept:
//   received  -> POST …/schedule   (label: the destination status)
//   scheduled -> POST …/start      (label: the shared btnStart key, which the
//                                   prototype L243 and the merged web port agree on)
//   fixing / fixed -> NO inline write; the card opens `tech-close`, where the fix and
//                     close moves live with their sign-off slots.
//   closed    -> terminal, no action.
// Three prototype buttons are therefore NOT reproduced: the reschedule button
// (L244) — there is no reschedule op at all; the fix-and-close button (L247) — no
// single op moves `fixing` to `closed`, so its label promises two steps the server
// will not take; and the "appoint the customer" button (L249) — the schedule op
// notifies nobody, because no customer notification exists anywhere in this route.
// Each is a PROMISE rather than a missing value, so each is dropped instead of
// em-dashed (the pm-notes B-285 precedent).
// The schedule op is also sent with NO body: it accepts an optional assignee and date
// (sales-service.ts L334-344) but this card has no picker, so nothing is originated.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'service_agg.dart';
import 'service_repository.dart';
import 'service_shared.dart';
import 'tech_close_screen.dart';

/// Router entry for `tech-jobs`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [TechJobsScreen].
class TechJobsScreenHost extends StatefulWidget {
  const TechJobsScreenHost({super.key});

  @override
  State<TechJobsScreenHost> createState() => _TechJobsScreenHostState();
}

class _TechJobsScreenHostState extends State<TechJobsScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('tech_jobs');
  }

  @override
  Widget build(BuildContext context) {
    final AppServices services = AppScope.of(context);
    return FutureBuilder<ScreenStrings>(
      future: _stringsFuture,
      builder: (BuildContext context, AsyncSnapshot<ScreenStrings> snap) {
        final ScreenStrings? strings = snap.data;
        if (strings == null) {
          return const ColoredBox(color: JuneflowTokens.surfaceBg);
        }
        return TechJobsScreen(
          repo: DioServiceRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The technician's job list. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class TechJobsScreen extends StatefulWidget {
  const TechJobsScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.closeBuilder,
  });

  final ServiceRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  /// Test seam for the close-screen push: given the REAL ticket id, build the
  /// destination. Defaults to [TechCloseScreenHost] carrying that id — the same
  /// injection the repo/strings/i18n use, so a test can prove which id travels
  /// without standing up an [AppScope] or touching the network.
  final Widget Function(String ticketId)? closeBuilder;

  @override
  State<TechJobsScreen> createState() => _TechJobsScreenState();
}

/// The profile + the tickets it owns.
class _MyJobs {
  const _MyJobs(this.userName, this.rows);

  final String userName;
  final List<ServiceTicket> rows;
}

class _TechJobsScreenState extends State<TechJobsScreen> {
  late Future<_MyJobs> _future = _load();

  /// The ticket whose transition is in flight (its button shows a spinner).
  String? _busyId;

  /// True when the last transition was rejected — surfaced honestly, never hidden
  /// and never reported as a success.
  bool _failed = false;

  Future<_MyJobs> _load() async {
    // The profile first: without an identity there is no honest "mine".
    final ServiceUser me = await widget.repo.currentUser();
    final List<ServiceTicket> rows = parseTickets(
      await widget.repo.listTickets(),
    );
    return _MyJobs(me.name, assignedTo(rows, me.id));
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  String _statusLabel(String status) {
    final String? field = serviceStatusField(status);
    return field == null ? kServiceDash : _t(field);
  }

  /// Run one machine move for [t], then re-read the register so the row shows the
  /// SERVER's status — never a locally guessed one.
  Future<void> _act(ServiceTicket t, ServiceOp op) async {
    if (_busyId != null) return;
    setState(() {
      _busyId = t.id;
      _failed = false;
    });
    try {
      await widget.repo.runTransition(t.id, op);
      if (!mounted) return;
      setState(() {
        _busyId = null;
        _future = _load();
      });
    } on Object {
      // 409 (someone already advanced it), 404, or no connection: all honest
      // failures. The write is a one-shot online call (service_repository.dart
      // header), so nothing is queued and nothing claims it will retry.
      if (!mounted) return;
      setState(() {
        _busyId = null;
        _failed = true;
      });
    }
  }

  /// Open the close screen for [t] (the fix / close moves + their sign-off slots),
  /// then refresh on return so a move made there shows here.
  Future<void> _openClose(ServiceTicket t) async {
    final Widget Function(String) build =
        widget.closeBuilder ?? (String id) => TechCloseScreenHost(ticketId: id);
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (BuildContext _) => build(t.id)));
    if (!mounted) return;
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: FutureBuilder<_MyJobs>(
        future: _future,
        builder: (BuildContext context, AsyncSnapshot<_MyJobs> snap) {
          final _MyJobs? data = snap.data;
          final List<ServiceTicket> rows =
              data?.rows ?? const <ServiceTicket>[];
          // ONE guard for the whole body. _load() awaits GET /me and then
          // GET /sales/service in sequence, so `rows` is empty until BOTH land —
          // and a count taken over an empty set is a claim ("0 today, 0 urgent"),
          // not a blank. The tiles therefore blank with the list rather than
          // stating a fact nothing has answered yet.
          final bool waiting = snap.connectionState == ConnectionState.waiting;
          return Column(
            children: <Widget>[
              MobileHeader(
                // L207: the REAL signed-in name; the mock's trade half has no column.
                sub: (data?.userName.isEmpty ?? true)
                    ? kServiceDash
                    : data!.userName,
                title: _tp('title'),
                trailing: _bell(),
              ),
              if (!waiting) _stats(rows),
              if (_failed) _failureCard(),
              Expanded(
                child: waiting
                    ? const SizedBox.shrink()
                    : rows.isEmpty
                    ? serviceEmpty()
                    : _list(rows),
              ),
            ],
          );
        },
      ),
    );
  }

  /// The bell (mobile-screens.jsx L208-210) as chrome. No tap and no unread dot:
  /// nothing on this screen reads the notification register, so a dot would be an
  /// invented count and a tap would need a route this screen does not own.
  Widget _bell() {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceMuted,
        shape: BoxShape.circle,
      ),
      child: const Icon(
        Icons.notifications_none,
        size: 16,
        color: JuneflowTokens.textSecondary,
      ),
    );
  }

  /// The stat strip (mobile-screens.jsx L212-222). Two tiles, both REAL counts; the
  /// prototype's rating tile is omitted (no column — see the file header).
  Widget _stats(List<ServiceTicket> rows) {
    final int today = countScheduledOn(rows, serviceTodayIso());
    final int urgent = countHighPriority(rows);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: _statTile(
              '$today',
              _t('statToday'),
              JuneflowTokens.brandPrimary,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _statTile(
              '$urgent',
              _t('statUrgent'),
              JuneflowTokens.statusDangerFg,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statTile(String value, String label, Color tone) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            value,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: tone,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              fontSize: 10.5,
              color: JuneflowTokens.textTertiary,
            ),
          ),
        ],
      ),
    );
  }

  /// The honest failure strip: the last action was REJECTED. Nothing is retried in
  /// the background and nothing is queued (B-268 option (a) — never a fake success).
  Widget _failureCard() {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: serviceStatusCard(
        icon: Icons.error_outline,
        text: _t('failed'),
        tone: const ServiceTone(
          JuneflowTokens.statusDangerFg,
          JuneflowTokens.statusDangerSoft,
        ),
      ),
    );
  }

  Widget _list(List<ServiceTicket> rows) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One job card (mobile-screens.jsx L226-255). Tapping it opens the close screen,
  /// which is where the fix / close moves live.
  Widget _card(ServiceTicket t) {
    final ServiceTransition? next = nextServiceTransition(t.status);
    return GestureDetector(
      onTap: () => _openClose(t),
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        // L227-229: a rounded hairline card with a 3px priority edge down its left
        // side — high is danger, everything else warn (the prototype's own rule,
        // kept verbatim). Flutter cannot paint a NON-UNIFORM border under a border
        // radius, so the edge is a clipped 3px strip inside the rounded box rather
        // than a fourth BorderSide; the rendered result is the prototype's.
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Container(
                  width: 3,
                  color: t.priority == 'high'
                      ? JuneflowTokens.statusDangerFg
                      : JuneflowTokens.statusWarnFg,
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Expanded(child: _cardHead(t)),
                            const SizedBox(width: 8),
                            MPill(
                              label: _statusLabel(t.status),
                              color: serviceStatusTone(t.status).fg,
                            ),
                          ],
                        ),
                        if (_actionFor(t, next)
                            case final Widget action) ...<Widget>[
                          const SizedBox(height: 10),
                          action,
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _cardHead(ServiceTicket t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // L233: the server-allocated SR number (REAL).
        Text(
          t.no.isEmpty ? kServiceDash : t.no,
          style: const TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.brandPrimary,
          ),
        ),
        const SizedBox(height: 2),
        // L234: the problem — service_ticket.title (REAL).
        Text(
          t.title.isEmpty ? kServiceDash : t.title,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        // L235 (unit + visit time): the unit em-dashes (no label source); the date
        // is the REAL scheduled_date in the house numeric form (serviceDateText),
        // or an em-dash before the visit is booked. The prototype's TIME half has
        // no column (scheduled_date is a DATE), so it is not reproduced.
        Text(
          '$kServiceDash · ${serviceDateText(t.scheduledDate)}',
          style: const TextStyle(
            fontSize: 11,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ],
    );
  }

  /// The card's action row, or null when the machine offers nothing here.
  Widget? _actionFor(ServiceTicket t, ServiceTransition? next) {
    if (next == null) return null; // closed (terminal) or an unknown status
    final bool busy = _busyId == t.id;
    return switch (next.op) {
      // The two moves this screen owns: a body-less flip, then a re-read.
      ServiceOp.schedule => _cardButton(
        label: _t('btnSchedule'),
        tone: JuneflowTokens.statusInfoFg,
        busy: busy,
        onTap: () => _act(t, ServiceOp.schedule),
      ),
      ServiceOp.start => _cardButton(
        label: _t('btnStart'),
        tone: JuneflowTokens.statusOkFg,
        busy: busy,
        onTap: () => _act(t, ServiceOp.start),
      ),
      // fix / close belong to the close screen (its sign-off slots go with them).
      ServiceOp.fix || ServiceOp.close => _cardButton(
        label: _tp('btnClose'),
        tone: JuneflowTokens.brandPrimary,
        busy: false,
        onTap: () => _openClose(t),
      ),
    };
  }

  /// One in-card action button (mobile-screens.jsx L242-250 metrics).
  Widget _cardButton({
    required String label,
    required Color tone,
    required bool busy,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: busy ? null : onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: busy ? JuneflowTokens.surfaceMuted : tone,
          borderRadius: BorderRadius.circular(6),
        ),
        child: busy
            ? const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: JuneflowTokens.textSecondary,
                ),
              )
            : Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.shellTextStrong,
                ),
              ),
      ),
    );
  }
}
