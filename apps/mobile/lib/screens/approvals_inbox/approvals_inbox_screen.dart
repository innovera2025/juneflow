// ApprovalsInboxScreen — the mobile approvals inbox, ported from
// pototype/mobile.jsx MobileApprovalInbox (L24-177). Route `inbox`
// (mobile_routes.dart; MobileSection.approve). money = NONE (read-only list); the
// amounts are SERVER values, shown verbatim.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (user button ·
// eyebrow + title · a bell), the three summary chips, the filter pills, and the
// tone-tinted doc cards. Every colour / space is a generated design token
// (JuneflowTokens); every string is an i18n key from the sidecar or the
// mob.approval.inbox.* dict (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype's hardcoded `items` array is a mock mechanic and
// is DROPPED. The list is the REAL GET /dashboard/approvals-inbox read
// (approvals_inbox_agg.dart). Per-row display uses the real wire columns only:
//   - kind / doc_no / amount / created_at → REAL (a null doc_no/amount em-dashes).
//   - title / requester / urgent          → HONEST-OMIT (no wire; never fabricated).
//   - project name                        → HONEST-OMIT (not on the inbox row).
//   - the urgent chip                      → HONEST 0 (no urgency wire).
// The filter pills run a real client-side filter over the already-fetched list (an
// honest, non-network filter); the urgent filter yields the honest-empty state.
// A PR row tap opens the (PR-only) detail with the real doc id — the approval seam;
// a PO/WO row renders honestly but is inert this wave (no PR-shaped detail faked).
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import '../pr_detail/pr_detail_screen.dart';
import 'approvals_inbox_agg.dart';
import 'approvals_inbox_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `inbox`: resolves the shared services from [AppScope], loads
/// the screen's i18n sidecar, then renders [ApprovalsInboxScreen]. The sidecar load
/// is the only async step; a plain surface shows for the frame it takes.
class ApprovalsInboxScreenHost extends StatefulWidget {
  const ApprovalsInboxScreenHost({super.key});

  @override
  State<ApprovalsInboxScreenHost> createState() =>
      _ApprovalsInboxScreenHostState();
}

class _ApprovalsInboxScreenHostState extends State<ApprovalsInboxScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('approvals_inbox');
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
        return ApprovalsInboxScreen(
          repo: DioApprovalsInboxRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The approvals-inbox view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class ApprovalsInboxScreen extends StatefulWidget {
  const ApprovalsInboxScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final ApprovalsInboxRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<ApprovalsInboxScreen> createState() => _ApprovalsInboxScreenState();
}

class _ApprovalsInboxScreenState extends State<ApprovalsInboxScreen> {
  late final Future<List<InboxRow>> _future = _load();

  /// The active client-side filter (default: all). Pill taps switch it.
  InboxFilter _filter = InboxFilter.all;

  Future<List<InboxRow>> _load() async {
    return parseInbox(await widget.repo.list());
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);
  String _baht() => widget.i18n.t('subcon.unitBaht');

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _tp('sub'),
            title: widget.i18n.t('mob.approval.inbox.title'),
            leading: _circleButton(Icons.person_outline),
            trailing: _bellButton(),
          ),
          Expanded(
            child: FutureBuilder<List<InboxRow>>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<List<InboxRow>> snap) {
                    final bool loading =
                        snap.connectionState == ConnectionState.waiting;
                    final List<InboxRow> rows = snap.data ?? const <InboxRow>[];
                    final InboxSummary summary = summarize(rows);
                    final InboxKindCounts counts = kindCounts(rows);
                    final List<InboxRow> visible = applyFilter(rows, _filter);
                    return Column(
                      children: <Widget>[
                        _summaryChips(summary),
                        _filterBar(counts),
                        Expanded(
                          child: loading
                              ? _loading()
                              : visible.isEmpty
                              ? _empty()
                              : _list(visible),
                        ),
                      ],
                    );
                  },
            ),
          ),
        ],
      ),
    );
  }

  /// A 34px round chrome button (mobile.jsx L38 user / L39 bell). Decorative — the
  /// header user/bell affordances have no wire in this read-only screen.
  Widget _circleButton(IconData icon) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceMuted,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 16, color: JuneflowTokens.textSecondary),
    );
  }

  /// The bell button with the prototype's decorative red dot (mobile.jsx L39-42).
  /// The dot is static chrome — there is no unread wire in this screen (never a
  /// fabricated unread count).
  Widget _bellButton() {
    return SizedBox(
      width: 34,
      height: 34,
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          _circleButton(Icons.notifications_none),
          Positioned(
            top: 6,
            right: 8,
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: JuneflowTokens.statusDangerFg,
                shape: BoxShape.circle,
                border: Border.all(
                  color: JuneflowTokens.surfaceMuted,
                  width: 1.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The three summary chips (mobile.jsx L45-60): count (REAL) · urgent (HONEST 0) ·
  /// total (Σ REAL, compact). Equal width; the value auto-scales to fit the chip.
  Widget _summaryChips(InboxSummary summary) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: _chip(
              '${summary.count}',
              _tp('chipPending'),
              JuneflowTokens.statusWarnFg,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _chip(
              '${summary.urgentCount}',
              _tp('chipUrgent'),
              JuneflowTokens.statusDangerFg,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _chip(
              compactMoney(summary.totalAmount),
              _tp('chipTotal'),
              JuneflowTokens.brandPrimary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String value, String label, Color tone) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: tone,
              ),
            ),
          ),
          const SizedBox(height: 1),
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

  /// The filter pills (mobile.jsx L62-85): a horizontally-scrolling row with a real
  /// count on each. Tapping switches the active client-side filter.
  Widget _filterBar(InboxKindCounts counts) {
    final List<(InboxFilter, String, int)> pills = <(InboxFilter, String, int)>[
      (InboxFilter.all, _tp('filterAll'), counts.all),
      (InboxFilter.urgent, _tp('filterUrgent'), counts.urgent),
      (InboxFilter.pr, 'PR', counts.pr),
      (InboxFilter.po, 'PO', counts.po),
      (InboxFilter.wo, 'WO', counts.wo),
    ];
    return Container(
      color: JuneflowTokens.surfaceCard,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: <Widget>[
            for (int i = 0; i < pills.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 6),
              _pill(pills[i].$1, pills[i].$2, pills[i].$3),
            ],
          ],
        ),
      ),
    );
  }

  Widget _pill(InboxFilter filter, String label, int count) {
    final bool active = filter == _filter;
    final Color fg = active
        ? JuneflowTokens.shellTextStrong
        : JuneflowTokens.textSecondary;
    return GestureDetector(
      key: ValueKey<String>('inboxFilter_${filter.name}'),
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _filter = filter),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: active
              ? JuneflowTokens.brandPrimary
              : JuneflowTokens.surfaceMuted,
          borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: fg,
              ),
            ),
            const SizedBox(width: 5),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: active
                    ? JuneflowTokens.shellText.withValues(alpha: 0.25)
                    : JuneflowTokens.surfaceMuted,
                borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
              ),
              child: Text('$count', style: TextStyle(fontSize: 9.5, color: fg)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list(List<InboxRow> rows) {
    final DateTime now = DateTime.now();
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i], now),
    );
  }

  /// One doc card (mobile.jsx L89-144), honest-derived: a kind badge, the doc no
  /// (title honest-omitted → no is the primary line), the REAL age, and the SERVER
  /// amount. A PR row is tappable (opens the detail — the approval seam); PO/WO rows
  /// render honestly but are inert this wave.
  Widget _card(InboxRow row, DateTime now) {
    final Widget card = Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _kindBadge(row),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // The doc no is the primary line (title has no wire → honest-omit).
                Text(
                  row.docNo ?? _dash,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: JuneflowTokens.brandPrimary,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(child: _ageMeta(row, now)),
                    Text(
                      row.amount == null
                          ? _dash
                          : '${formatMoney(row.amount!)} ${_baht()}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: JuneflowTokens.textPrimary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
    if (!row.isTappable) return card;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (BuildContext _) =>
              PrDetailScreenHost(prId: row.id, docNo: row.docNo),
        ),
      ),
      child: card,
    );
  }

  /// The kind badge (mobile.jsx L97-102): a tone-tinted square with the REAL kind
  /// code. Tones are the closest design tokens to the prototype's per-kind colours.
  Widget _kindBadge(InboxRow row) {
    final Color tone = switch (row.kind) {
      InboxKind.pr => JuneflowTokens.brandPrimary,
      InboxKind.po => JuneflowTokens.brandHover,
      InboxKind.wo => JuneflowTokens.statusWarnFg,
      InboxKind.other => JuneflowTokens.textTertiary,
    };
    return Container(
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Color.alphaBlend(
          tone.withValues(alpha: 0.12),
          JuneflowTokens.surfaceCard,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        row.kindCode.isEmpty ? _dash : row.kindCode,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: tone,
        ),
      ),
    );
  }

  /// The card's age meta (mobile.jsx L124, the "{age} ago" line): the requester name +
  /// avatar are honest-omitted (no wire), leaving the REAL age. Omitted entirely
  /// when the row carries no created_at.
  Widget _ageMeta(InboxRow row, DateTime now) {
    final DateTime? created = row.createdAt;
    if (created == null) return const SizedBox.shrink();
    final AgeParts age = relativeAge(created, now);
    final String unitField = switch (age.unit) {
      AgeUnit.minute => 'unitMinute',
      AgeUnit.hour => 'unitHour',
      AgeUnit.day => 'unitDay',
    };
    final String ageValue = '${age.value} ${_tp(unitField)}';
    return Text(
      widget.i18n.tf('mob.approval.inbox.cardAgeAgo', <String, Object?>{
        'age': ageValue,
      }),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(fontSize: 11, color: JuneflowTokens.textTertiary),
    );
  }

  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: <Widget>[
        for (int i = 0; i < 5; i++)
          Container(
            height: 78,
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: JuneflowTokens.surfaceMuted,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JuneflowTokens.surfaceBorder),
            ),
          ),
      ],
    );
  }

  /// Honest-empty — a centered em-dash, no invented copy (notif/web precedent).
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
}
