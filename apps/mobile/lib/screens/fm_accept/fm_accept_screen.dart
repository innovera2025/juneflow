// FmAcceptScreen — the mobile foreman acceptance queue, ported from
// pototype/mobile-field.jsx MFmAccept (L145-187). Route `fm-accept`
// (mobile_routes.dart; MobileSection.field). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow +
// title, no back button, L153), the 3-button filter strip on a surface strip with a
// bottom hairline (L154-158), and the card list whose card border turns danger when
// the row is rejected (L161): a brand-coloured document number, the type pill, the
// rejected pill, a right-aligned wait slot, a bold line, the danger defect line, a
// muted meta line, and the two action buttons (ok-filled / danger-outline, L171-180).
// The bottom tab bar belongs to the shell (MobileShell), not this screen — the
// notif / st-grlist precedent for the prototype's own `<MTabBar active="field"/>`
// (L184). Every colour/space is a generated design token (JuneflowTokens); every
// string is a key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3) — what the prototype fakes and this screen does NOT:
//   - the rows are `window.ACCEPT_ITEMS` (L148), a cross-file mock global. Here they
//     are the REAL GET /acceptance-center feeds — the work-period queue and the
//     goods-receipt queue, the same two the prototype filters to (fm_accept_agg.dart);
//   - the eyebrow names the acceptance centre AND a single site (L153). There is
//     no site here: each row carries its OWN project_name, and the queue spans the
//     tenant. The centre name is kept (it is what this screen is); the site is dropped
//     rather than pinned to one of the rows' projects;
//   - `r.wait` (the "waiting {n} days" line, L166) has no wire. work_period does
//     carry created_at /
//     updated_at, but periodWire does not expose either (subcon.ts L313-325) and
//     `updated_at` would not mean "waiting since" anyway. The slot keeps its place
//     and renders an em-dash;
//   - `r.title` (L168, the bold description line) has no wire. enrichPeriodRow's
//     `title` is the contract DOC NUMBER, which this card already prints as `r.doc`;
//     work_period has no name/description column at all. Em-dash — never the doc
//     number twice pretending to be a description;
//   - `r.value` (L170) prints money. Withheld — see FmAcceptRow.value for the full
//     reason: for 3 of the 4 bases the wire's `amount` is NOT the payable, the
//     payable is server-computed inside approve-payment (a different action this
//     screen must not imply it performs), and computing it here is forbidden;
//   - `📎 {r.docs.length}` (L170) counts the acceptance's attached documents. The
//     acceptance-center wire carries no acceptance, so the count is unknown →
//     em-dash beside the kept paperclip;
//   - `setDone` (L150/L176) is a LOCAL boolean that renders "inspected · result sent
//     to the system" while nothing was sent. Dropped: a successful inspection is
//     proven by RE-READING the queue (a passed period leaves it; a rejected one moves
//     to the rejected tab), never by a client-side flag;
//   - the pass/reject buttons on a GOODS-RECEIPT row are withheld. POST
//     /periods/{id}/inspect takes a work-period id; a receipt's decisions are
//     different doors with different meanings (POST /gr/{id}/return | /cancel,
//     gr.ts L646/L692). Those rows still show — they are genuinely in the acceptance
//     centre, and the prototype lists them — but read-only. The same withholding
//     applies to an already-`rejected` period, which the endpoint's own guard would
//     409 (subcon.ts L819-826). BLOCKERS.md B-297 records both.
//
// The write is the REAL POST /periods/{id}/inspect, ONLINE (fm_accept_repository.dart
// explains why this screen is not enrolled in the offline queue). money = NONE.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'fm_accept_agg.dart';
import 'fm_accept_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// The prototype's separator between meta values (L170) — U+00B7, not an ASCII dot.
const String _mid = '·';

/// The prototype's warning glyph on the rejected tab + defect line (L155/L169).
const String _warn = '⚠'; // ⚠

/// The prototype's attachment glyph (L170).
const String _clip = '\u{1F4CE}'; // 📎

/// Pill colours are prototype-verbatim hexes (L164) — the two feed tints are not in
/// the token set, exactly as the merged web ports keep their prototype dot hexes
/// (B-037(a)).
const Color _pillGrColor = Color(0xFF1D4ED8);
const Color _pillPeriodColor = Color(0xFF0F766E);

/// Router entry for `fm-accept`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [FmAcceptScreen]. The sidecar load is
/// the only async step; a plain surface shows for the frame it takes.
class FmAcceptScreenHost extends StatefulWidget {
  const FmAcceptScreenHost({super.key});

  @override
  State<FmAcceptScreenHost> createState() => _FmAcceptScreenHostState();
}

class _FmAcceptScreenHostState extends State<FmAcceptScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('fm_accept');
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
        return FmAcceptScreen(
          repo: DioFmAcceptRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The acceptance-queue view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class FmAcceptScreen extends StatefulWidget {
  const FmAcceptScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final FmAcceptRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<FmAcceptScreen> createState() => _FmAcceptScreenState();
}

class _FmAcceptScreenState extends State<FmAcceptScreen> {
  FmAcceptTab _tab = FmAcceptTab.all;

  /// Null until the first read finishes.
  List<FmAcceptRow>? _rows;

  /// Set when the queue could not be read at all → the list is UNKNOWN, so an
  /// em-dash shows rather than an "empty queue" that would tell the foreman there is
  /// nothing to inspect when there may be plenty.
  bool _loadFailed = false;

  /// Per-row action state, keyed by row id. Absent = idle.
  final Map<String, FmRowActionState> _rowState = <String, FmRowActionState>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final List<FmAcceptEnt> periods = await widget.repo.listPeriodQueue();
      final List<FmAcceptEnt> grs = await widget.repo.listGrQueue();
      if (!mounted) return;
      setState(() {
        _rows = parseAcceptQueue(periods, grs);
        _loadFailed = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _rows = null;
        _loadFailed = true;
      });
    }
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// Run one inspection, then RE-READ the queue — the only honest confirmation
  /// (see FmRowActionState). A failure keeps the row addressable and marked failed;
  /// the re-read still runs, so a 409 caused by another inspector shows up as that
  /// inspector's real result rather than as a stale row.
  Future<void> _inspect(FmAcceptRow row, FmInspectResult result) async {
    if (_rowState[row.id] == FmRowActionState.sending) return;
    setState(() => _rowState[row.id] = FmRowActionState.sending);
    final FmInspectOutcome outcome = await widget.repo.inspect(
      periodId: row.id,
      result: result,
    );
    if (!mounted) return;
    setState(() {
      if (outcome == FmInspectOutcome.ok) {
        _rowState.remove(row.id);
      } else {
        _rowState[row.id] = FmRowActionState.failed;
      }
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final List<FmAcceptRow> all = _rows ?? const <FmAcceptRow>[];
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // mobile-field.jsx L153. The prototype's trailing site name is dropped:
            // the queue is tenant-wide and each row carries its own project.
            sub: _t('centre'),
            title: _tp('title'),
          ),
          _tabs(all),
          Expanded(child: _body(all)),
        ],
      ),
    );
  }

  /// The filter strip (L154-158). Counts are REAL row counts of the loaded feeds —
  /// the prototype computes them the same way (L155) — and read 0 only while the
  /// queue is genuinely empty; an unreadable queue shows no counts at all.
  Widget _tabs(List<FmAcceptRow> all) {
    final bool known = _rows != null;
    final int total = all.length;
    final int rejected = all.where((FmAcceptRow r) => r.rejected).length;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          _tabButton(
            FmAcceptTab.all,
            known ? '${_t('tabAll')} ($total)' : _t('tabAll'),
          ),
          const SizedBox(width: 6),
          _tabButton(FmAcceptTab.wait, _tp('tabWait')),
          const SizedBox(width: 6),
          _tabButton(
            FmAcceptTab.rejected,
            known
                ? '$_warn ${_tp('tabRejected')} ($rejected)'
                : '$_warn ${_tp('tabRejected')}',
          ),
        ],
      ),
    );
  }

  Widget _tabButton(FmAcceptTab tab, String label) {
    final bool active = _tab == tab;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tab = tab),
        behavior: HitTestBehavior.opaque,
        child: Container(
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active
                ? JuneflowTokens.brandPrimary
                : JuneflowTokens.surfaceAlt,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: active
                  ? JuneflowTokens.shellTextStrong
                  : JuneflowTokens.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _body(List<FmAcceptRow> all) {
    if (_rows == null && !_loadFailed) return const SizedBox.shrink();
    // Unreadable ⇒ UNKNOWN (em-dash), which is NOT the same as an empty queue.
    if (_loadFailed) return _unknown();
    final List<FmAcceptRow> rows = filterAcceptRows(all, _tab);
    if (rows.isEmpty) return _empty();
    return ListView.builder(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One queue card (L161-181).
  Widget _card(FmAcceptRow row) {
    final FmRowActionState state = _rowState[row.id] ?? FmRowActionState.idle;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: row.rejected
              ? JuneflowTokens.statusDangerFg
              : JuneflowTokens.surfaceBorder,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _topRow(row),
          const SizedBox(height: 5),
          // L168 — the bold description line has no wire column (see the header).
          const Text(
            _dash,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          if (row.rejected && row.defects.isNotEmpty) ...<Widget>[
            const SizedBox(height: 3),
            // L169 — the REAL Defect List items the server returned.
            Text(
              '$_warn ${row.defects.join(' $_mid ')}',
              style: const TextStyle(
                fontSize: 10.5,
                color: JuneflowTokens.statusDangerFg,
              ),
            ),
          ],
          const SizedBox(height: 3),
          _metaLine(row),
          if (row.actionable) ...<Widget>[
            const SizedBox(height: 9),
            _actions(row, state),
          ],
          if (state == FmRowActionState.failed) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              _t('failed'),
              style: const TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.statusDangerFg,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// L162-167 — doc number, feed pill, rejected pill, wait slot.
  Widget _topRow(FmAcceptRow row) {
    final String doc = row.doc ?? _dash;
    // The server refuses to compose the period ordinal (subcon.ts L513-518), so the
    // client appends the localized unit word around the REAL `seq`.
    final String label = row.seq == null
        ? doc
        : '$doc $_mid ${_t('unitPeriod')} ${row.seq}';
    return Row(
      children: <Widget>[
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.brandPrimary,
            ),
          ),
        ),
        const SizedBox(width: 6),
        MPill(
          label: row.feed == FmAcceptFeed.gr
              ? _tp('pillGr')
              : _tp('pillPeriod'),
          color: row.feed == FmAcceptFeed.gr ? _pillGrColor : _pillPeriodColor,
        ),
        if (row.rejected) ...<Widget>[
          const SizedBox(width: 6),
          MPill(
            label: _tp('pillRejected'),
            color: JuneflowTokens.statusDangerFg,
          ),
        ],
        const Spacer(),
        // L166 — the "waiting {n} days" value has no wire (see the header). Em-dash,
        // never a
        // number derived from a timestamp that does not mean "waiting since".
        const Text(
          _dash,
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: JuneflowTokens.textTertiary,
          ),
        ),
      ],
    );
  }

  /// L170 — project name (REAL), then the withheld money slot, then the withheld
  /// attachment count.
  Widget _metaLine(FmAcceptRow row) {
    return Text(
      '${row.projectName ?? _dash} $_mid $_dash $_mid $_clip $_dash',
      style: const TextStyle(
        fontSize: 10.5,
        color: JuneflowTokens.textTertiary,
      ),
    );
  }

  /// L171-180 — the two inspect actions. While one is in flight the pair is replaced
  /// by a spinner so a second tap cannot double-post.
  Widget _actions(FmAcceptRow row, FmRowActionState state) {
    if (state == FmRowActionState.sending) {
      return const SizedBox(
        height: 34,
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: JuneflowTokens.textSecondary,
            ),
          ),
        ),
      );
    }
    return Row(
      children: <Widget>[
        Expanded(
          child: _actionButton(
            label: _tp('btnPass'),
            filled: true,
            color: JuneflowTokens.statusOkFg,
            onTap: () => _inspect(row, FmInspectResult.pass),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _actionButton(
            label: _tp('btnReject'),
            filled: false,
            color: JuneflowTokens.statusDangerFg,
            onTap: () => _inspect(row, FmInspectResult.reject),
          ),
        ),
      ],
    );
  }

  Widget _actionButton({
    required String label,
    required bool filled,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: filled ? color : JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(8),
          border: filled ? null : Border.all(color: color),
        ),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            color: filled ? JuneflowTokens.shellTextStrong : color,
          ),
        ),
      ),
    );
  }

  /// Genuinely empty — the server returned no rows for this filter.
  Widget _empty() {
    return Center(
      child: Text(
        _t('empty'),
        style: const TextStyle(
          fontSize: 13,
          color: JuneflowTokens.textTertiary,
        ),
      ),
    );
  }

  /// Unknown — the queue could not be read, which is NOT "there is nothing to
  /// inspect" (the distinction the honest-states rule turns on).
  Widget _unknown() {
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
