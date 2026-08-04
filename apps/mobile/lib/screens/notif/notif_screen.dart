// NotifScreen — the mobile Notifications screen, ported from
// pototype/mobile.jsx MobileNotifications (L543-609). Route `notif`
// (mobile_routes.dart; MobileSection.approve). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's, verbatim — the header
// (back chevron · eyebrow + title · a round mark-read action), the four
// decorative filter pills (first active), and the tone-tinted card list
// (34px icon box · title · time · a warn left-accent on unread). Every colour /
// space is a generated design token (JuneflowTokens); every string is an i18n
// key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype's hardcoded `NOTIFS` array is a mock mechanic
// and is DROPPED. The list is the REAL GET /notifications read; tapping an unread
// card and the header mark-read action both drive the REAL POST
// /notifications/{id}/read.
// Per-row display is derived from the real wire columns only (notif_agg.dart) —
// never a fabricated sentence (same honest derivation as the merged web port;
// the denormalised title/by/body/actions need the typed schema of contract gap
// B-039). The prototype's `by` sender line, `body` detail line and approve/view
// buttons have no honest wire in the read + mark-read scope, so they are omitted.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'notif_agg.dart';
import 'notif_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `notif`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [NotifScreen]. The sidecar
/// load is the only async step; a plain surface shows for the frame it takes.
class NotifScreenHost extends StatefulWidget {
  const NotifScreenHost({super.key});

  @override
  State<NotifScreenHost> createState() => _NotifScreenHostState();
}

class _NotifScreenHostState extends State<NotifScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('notif');
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
        return NotifScreen(
          repo: DioNotificationsRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The Notifications view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class NotifScreen extends StatefulWidget {
  const NotifScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final NotificationsRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<NotifScreen> createState() => _NotifScreenState();
}

class _NotifScreenState extends State<NotifScreen> {
  late Future<List<NotifRow>> _future;

  /// Last-resolved rows, cached so the "mark all read" action knows the unread
  /// ids without re-reading the future.
  List<NotifRow> _rows = const <NotifRow>[];

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<NotifRow>> _load() async {
    final List<NotifRow> rows = parseNotifs(await widget.repo.list());
    _rows = rows;
    return rows;
  }

  void _reload() {
    setState(() {
      _future = _load();
    });
  }

  Future<void> _onTapRow(NotifRow row) async {
    if (row.read || row.id.isEmpty) return;
    await widget.repo.markRead(row.id);
    if (mounted) _reload();
  }

  Future<void> _onMarkAll() async {
    final List<String> ids = unreadIds(_rows);
    if (ids.isEmpty) return;
    await Future.wait(ids.map(widget.repo.markRead));
    if (mounted) _reload();
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _tp('eyebrow'),
            title: _tp('title'),
            leading: _circleButton(
              child: const Icon(
                Icons.chevron_left,
                size: 18,
                color: JuneflowTokens.textSecondary,
              ),
              onTap: () => Navigator.maybePop(context),
            ),
            trailing: _circleButton(
              child: Text(
                _tp('markRead'),
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: JuneflowTokens.textSecondary,
                ),
              ),
              onTap: _onMarkAll,
            ),
          ),
          _filterBar(),
          Expanded(
            child: FutureBuilder<List<NotifRow>>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<List<NotifRow>> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    final List<NotifRow> rows = snap.data ?? const <NotifRow>[];
                    if (rows.isEmpty) return _empty();
                    return _list(rows);
                  },
            ),
          ),
        ],
      ),
    );
  }

  /// A 34px round action button (back chevron / mark-read), matching the
  /// prototype's surface-3 circle (mobile.jsx L559-560).
  Widget _circleButton({required Widget child, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: JuneflowTokens.surfaceMuted,
          shape: BoxShape.circle,
        ),
        child: child,
      ),
    );
  }

  /// The four filter pills (mobile.jsx L563-572). They are presentational in the
  /// prototype — no onClick, only the first pill highlighted — so they
  /// are ported as static chrome; the pill→type filter mapping the mock implies
  /// is undefined in the spec, so none is invented (wire gap, see file header).
  Widget _filterBar() {
    final List<String> labels = <String>[
      _tp('filterAll'),
      _tp('filterApproval'),
      _tp('filterUpdate'),
      _tp('filterSystem'),
    ];
    return Container(
      color: JuneflowTokens.surfaceCard,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 6),
            _pill(labels[i], active: i == 0),
          ],
        ],
      ),
    );
  }

  Widget _pill(String label, {required bool active}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: active
            ? JuneflowTokens.brandPrimary
            : JuneflowTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          color: active
              ? JuneflowTokens.shellTextStrong
              : JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  Widget _list(List<NotifRow> rows) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One notification card (mobile.jsx L575-605), honest-derived: a tone-tinted
  /// icon box, the display title, the real timestamp, and a warn left-accent for
  /// unread. Tapping an unread card marks it read.
  Widget _card(NotifRow row) {
    final Color tone = _tone(row.kind);
    final bool unread = !row.read;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => _onTapRow(row),
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // Unread accent — the prototype's 3px warn left border (L581),
              // driven honestly by the real `read` flag.
              if (unread)
                const SizedBox(
                  width: 3,
                  child: ColoredBox(color: JuneflowTokens.statusWarnFg),
                ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      _iconBox(row.kind, tone),
                      const SizedBox(width: 10),
                      Expanded(child: _cardBody(row, unread)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _iconBox(NotifKind kind, Color tone) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        // color-mix(in srgb, tone 12%, white) — a 12% tint of the tone.
        color: Color.alphaBlend(
          tone.withValues(alpha: 0.12),
          JuneflowTokens.surfaceCard,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(_icon(kind), size: 16, color: tone),
    );
  }

  Widget _cardBody(NotifRow row, bool unread) {
    final String titleText = row.displayTitle ?? _dash;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Text(
            titleText,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.35,
              fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
              color: JuneflowTokens.textPrimary,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          _timeLabel(row.createdAt),
          style: const TextStyle(
            fontSize: 10,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ],
    );
  }

  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
      children: <Widget>[
        for (int i = 0; i < 5; i++)
          Container(
            height: 54,
            margin: const EdgeInsets.only(bottom: 6),
            decoration: BoxDecoration(
              color: JuneflowTokens.surfaceMuted,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JuneflowTokens.surfaceBorder),
            ),
          ),
      ],
    );
  }

  /// Honest-empty — a centered em-dash, no invented copy (web precedent B-045).
  Widget _empty() {
    return const Center(
      child: Text(
        _dash,
        style: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: JuneflowTokens.textTertiary,
        ),
      ),
    );
  }

  /// A compact absolute timestamp from the real `created_at`. The prototype's
  /// relative "N minutes/hours/days" wording is a dynamic number-bearing Thai
  /// phrase deferred by B-017, so — as the web port did — the honest analog is the
  /// actual time. Locale-neutral numerics (no i18n copy, no Thai byte).
  String _timeLabel(DateTime? dt) {
    if (dt == null) return _dash;
    final DateTime local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.day}/${local.month} ${two(local.hour)}:${two(local.minute)}';
  }

  Color _tone(NotifKind kind) {
    switch (kind) {
      case NotifKind.approval:
        return JuneflowTokens.brandPrimary;
      case NotifKind.alert:
        return JuneflowTokens.statusDangerFg;
      case NotifKind.info:
        return JuneflowTokens.statusInfoFg;
      case NotifKind.other:
        return JuneflowTokens.textTertiary;
    }
  }

  IconData _icon(NotifKind kind) {
    switch (kind) {
      case NotifKind.approval:
        return Icons.check;
      case NotifKind.alert:
        return Icons.warning_amber_rounded;
      case NotifKind.info:
        return Icons.info_outline;
      case NotifKind.other:
        return Icons.notifications_none;
    }
  }
}
