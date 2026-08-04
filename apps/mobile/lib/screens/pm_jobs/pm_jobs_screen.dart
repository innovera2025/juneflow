// PmJobsScreen — the mobile "my PM jobs" screen, ported from
// pototype/mobile-pm.jsx MPMJobs (L7-49). Route `pm-jobs` (mobile_routes.dart;
// MobileSection.field). money = NONE (read-only list).
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow +
// title), the three equal-width filter pills (first active), and the tone-tinted
// job cards (a brand WO-number line + a type slot + a status badge, the asset name,
// a pin + site line, and a footer with a clock meta + a "start" affordance).
// Every colour / space is a generated design token (JuneflowTokens); every string
// is an i18n key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype's hardcoded `jobs` array is a mock mechanic and
// is DROPPED. The list is the REAL GET /pm/workorders read, joined to GET
// /pm/assets for each WO's display name + site + next-due (pm_jobs_agg.dart) — the
// same honest join + status derivation as the merged web port (wo-rows.ts). Per-row
// display uses real wire columns only:
//   - WO number   : NO wire column (no wo_no) → an honest em-dash, never a raw uuid.
//   - PM/CM type  : NO wire column → the type pill is OMITTED (never guessed).
//   - status      : DERIVED from real columns (open/inprogress/overdue; done rows
//                   are excluded from this active worklist — see pm_jobs_agg.dart).
//   - name / site : the joined asset name/site, or an em-dash when absent.
//   - time        : NO scheduled-time wire → an honest em-dash by the clock icon.
//   - distance    : device-GPS mock with NO server wire → OMITTED (§0 rule 3).
// The three filter pills are FUNCTIONLESS chrome: their today/urgent axes have no
// honest wire (the WO carries no schedule date and no priority), so — as the notif
// port did for its wire-gap filters — none is invented; the first shows active.
// Tapping a card would open pm-checkin in the prototype, but pm-checkin is not
// built and the shell has no route-param navigation yet, so the "start" affordance
// is visual chrome only (documented gap) — no fabricated navigation.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'pm_jobs_agg.dart';
import 'pm_jobs_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for `pm-jobs`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [PmJobsScreen]. The sidecar load is
/// the only async step; a plain surface shows for the frame it takes.
class PmJobsScreenHost extends StatefulWidget {
  const PmJobsScreenHost({super.key});

  @override
  State<PmJobsScreenHost> createState() => _PmJobsScreenHostState();
}

class _PmJobsScreenHostState extends State<PmJobsScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pm_jobs');
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
        return PmJobsScreen(
          repo: DioPmJobsRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
        );
      },
    );
  }
}

/// The "my PM jobs" view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class PmJobsScreen extends StatefulWidget {
  const PmJobsScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final PmJobsRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<PmJobsScreen> createState() => _PmJobsScreenState();
}

class _PmJobsScreenState extends State<PmJobsScreen> {
  late final Future<List<PmJobRow>> _future = _load();

  Future<List<PmJobRow>> _load() async {
    // Two READ-ONLY reads: the WO catalogue + the asset catalogue (the join
    // source). Fetched together so the join resolves in one pass.
    final List<PmEnt> workOrders = await widget.repo.listWorkOrders();
    final List<PmEnt> assets = await widget.repo.listAssets();
    return parseJobs(workOrders, assets, todayIso());
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(sub: _tp('eyebrow'), title: _tp('title')),
          _filterBar(),
          Expanded(
            child: FutureBuilder<List<PmJobRow>>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<List<PmJobRow>> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    final List<PmJobRow> rows = snap.data ?? const <PmJobRow>[];
                    if (rows.isEmpty) return _empty();
                    return _list(rows);
                  },
            ),
          ),
        ],
      ),
    );
  }

  /// The three equal-width filter pills (mobile-pm.jsx L20-24). The today/urgent
  /// axes have no honest wire (no schedule date, no priority column), so — like the
  /// notif port's wire-gap filters — they are static chrome with the first active;
  /// the mock's "(4)"/"(2)" counts are dropped (never a fabricated number).
  Widget _filterBar() {
    final List<String> labels = <String>[
      _tp('filterToday'),
      _tp('filterUrgent'),
      _tp('filterAll'),
    ];
    return Container(
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 6),
            Expanded(child: _pill(labels[i], active: i == 0)),
          ],
        ],
      ),
    );
  }

  Widget _pill(String label, {required bool active}) {
    return Container(
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: active
            ? JuneflowTokens.brandPrimary
            : JuneflowTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(JuneflowTokens.radiusLg),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          color: active
              ? JuneflowTokens.shellTextStrong
              : JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  Widget _list(List<PmJobRow> rows) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 90),
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int i) => _card(rows[i]),
    );
  }

  /// One PM job card (mobile-pm.jsx L29-42), honest-derived: the WO-number slot
  /// (em-dash — no wire), a status badge, the joined asset name + site, and a
  /// footer with a clock meta (em-dash — no scheduled time) and the "start"
  /// affordance. The type pill + distance are omitted (no honest wire).
  Widget _card(PmJobRow row) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Row 1: the brand WO-number slot (em-dash) + the derived status badge.
          Row(
            children: <Widget>[
              const Text(
                _dash,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.brandPrimary,
                ),
              ),
              const Spacer(),
              _statusBadge(row.status),
            ],
          ),
          const SizedBox(height: 6),
          // The joined asset name (em-dash when the asset is absent).
          Text(
            row.name.isEmpty ? _dash : row.name,
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 3),
          // The joined asset site with a pin icon (em-dash when absent).
          Row(
            children: <Widget>[
              const Icon(
                Icons.place_outlined,
                size: 12,
                color: JuneflowTokens.textTertiary,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  row.site.isEmpty ? _dash : row.site,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: JuneflowTokens.textTertiary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Divider(
            height: 1,
            thickness: 1,
            color: JuneflowTokens.surfaceBorder,
          ),
          const SizedBox(height: 8),
          _cardFooter(),
        ],
      ),
    );
  }

  /// The card footer (mobile-pm.jsx L37-41): a clock meta on the left (em-dash — no
  /// scheduled-time wire) and the brand "start" affordance on the right. The mock's
  /// GPS distance is omitted (device-runtime mock, no server wire).
  Widget _cardFooter() {
    return Row(
      children: <Widget>[
        const Icon(
          Icons.schedule,
          size: 12,
          color: JuneflowTokens.textSecondary,
        ),
        const SizedBox(width: 4),
        const Text(
          _dash,
          style: TextStyle(fontSize: 11, color: JuneflowTokens.textSecondary),
        ),
        const Spacer(),
        Text(
          _tp('start'),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: JuneflowTokens.brandPrimary,
          ),
        ),
        const SizedBox(width: 3),
        const Icon(
          Icons.chevron_right,
          size: 13,
          color: JuneflowTokens.brandPrimary,
        ),
      ],
    );
  }

  /// The derived status badge (mobile-pm.jsx stMeta L16): a tone-tinted pill whose
  /// label + colours come from the derived lifecycle.
  Widget _statusBadge(PmJobStatus status) {
    final (String field, Color fg, Color bg) = switch (status) {
      PmJobStatus.open => (
        'statusOpen',
        JuneflowTokens.textSecondary,
        JuneflowTokens.surfaceMuted,
      ),
      PmJobStatus.inProgress => (
        'statusInProgress',
        JuneflowTokens.statusWarnFg,
        JuneflowTokens.statusWarnSoft,
      ),
      PmJobStatus.overdue => (
        'statusOverdue',
        JuneflowTokens.statusDangerFg,
        JuneflowTokens.statusDangerSoft,
      ),
      // done is excluded from this list (parseJobs), but keep an honest fallback.
      PmJobStatus.done => (
        'statusOpen',
        JuneflowTokens.textSecondary,
        JuneflowTokens.surfaceMuted,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(JuneflowTokens.radiusPill),
      ),
      child: Text(
        _tp(field),
        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: fg),
      ),
    );
  }

  Widget _loading() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 90),
      children: <Widget>[
        for (int i = 0; i < 5; i++)
          Container(
            height: 96,
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
