// SrvTrackScreen — the resident's "track my repair request" screen, ported from
// pototype/mobile-screens.jsx MSrvTrack (L125-192). Route `srv-track`
// (mobile_routes.dart; MobileSection.service). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow + title,
// L128, no back control), ONE card holding the ticket line (SR number · problem ·
// category/unit · status pill, L130-138) above the 5-step timeline (L139-158), then
// the repair-history card (L161-178) and the brand-tinted warranty card (L180-188).
// Every colour/space is a generated design token (JuneflowTokens); every string is a
// key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2). The
// prototype's own `<MTabBar active="service"/>` (L189) is NOT drawn here: the shell
// owns the tab bar (mobile_shell.dart L47), exactly as every merged screen leaves it.
//
// Data (§0 rule 3) — the prototype is a MOCK and none of its data is reproduced:
//   - the ticket is the REAL GET /sales/service register row (service_agg.dart),
//     newest-first from the server; `no`, `title`, `category` and `status` are real
//     columns.
//   - the UNIT ("B-08", L135) is em-dashed. service_ticket.unit_id is a project_node
//     uuid and NO endpoint turns it into a unit code (there is no /sales/units, and
//     the hierarchy read needs a project id) — the merged web port em-dashes exactly
//     this field for exactly this reason (sales-service-rows.ts header). A raw uuid
//     is never dressed up as a unit code.
//   - the 5 TIMELINE steps map 1:1 onto the server's state machine
//     (received → scheduled → fixing → fixed → closed, sales-service.ts L21-27), so
//     the progress is the ticket's real status, not a mock array. Their TIMES are a
//     different matter: only `received` (opened_date) and `scheduled`
//     (scheduled_date) have a column. There is no fixing/fixed/closed timestamp
//     anywhere on service_ticket, so those three always em-dash — the prototype's
//     "today HH:MM" fixing time (L143) and its technician name on the schedule step
//     (L142) have no wire at all. The two dates that DO exist are rendered through
//     [serviceDateText], the merged house formatter (pr_detail_agg.formatWireDate):
//     locale-neutral numeric `d/m/yyyy`, never the raw `2026-05-23` wire string and
//     never a fabricated Thai month/era.
//   - the HISTORY rows (L163-165) keep `no` / problem / date from real columns and
//     DROP the star rating: there is no rating column, and the close handler's own
//     comment says that round did not invent one (sales-service.ts L354-356).
//     A fabricated ★5.0 would be the exact thing this repo forbids.
//   - the WARRANTY card prints the SERVER-derived `warranty_months_remaining`
//     (sales-service.ts L98-110) — never recomputed here from a date. Its handover
//     row (L182, a mock handover date) em-dashes: the derivation reads the sold
//     unit's transfer_at server-side but the wire does NOT carry that date back.
//     The prototype's mock value (L185) also carries DAYS; the wire is whole months,
//     so only months are printed (never a fabricated day count). The card's own
//     title (L180, which embeds the mock unit code) is OMITTED, not truncated: it
//     embeds the unit code this app cannot resolve, and shipping half a title would
//     be inventing copy (BLOCKERS.md B-292).
//
// SCOPE, STATED PLAINLY: the prototype frames this as one resident's own request, but
// the API has no resident identity — auth users are staff, and nothing links a signed-
// in person to a unit. So this screen follows the tenant register's NEWEST ticket (or
// the one the flow selected) and scopes the history to that ticket's UNIT. It cannot
// and does not claim the ticket is "yours" (BLOCKERS.md B-293).
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

/// Router entry for `srv-track`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [SrvTrackScreen].
class SrvTrackScreenHost extends StatefulWidget {
  const SrvTrackScreenHost({super.key, this.ticketId});

  /// The ticket to follow when the flow selected one. Null as a bare tab route → the
  /// register's newest ticket (the honest "my latest request" the prototype shows).
  final String? ticketId;

  @override
  State<SrvTrackScreenHost> createState() => _SrvTrackScreenHostState();
}

class _SrvTrackScreenHostState extends State<SrvTrackScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('srv_track');
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
        return SrvTrackScreen(
          repo: DioServiceRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
          ticketId: widget.ticketId,
        );
      },
    );
  }
}

/// The tracking view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class SrvTrackScreen extends StatefulWidget {
  const SrvTrackScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.ticketId,
  });

  final ServiceRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? ticketId;

  @override
  State<SrvTrackScreen> createState() => _SrvTrackScreenState();
}

/// The register narrowed to what this screen renders.
class _Tracked {
  const _Tracked(this.current, this.history);

  final ServiceTicket? current;
  final List<ServiceTicket> history;
}

class _SrvTrackScreenState extends State<SrvTrackScreen> {
  late final Future<_Tracked> _future = _load();

  Future<_Tracked> _load() async {
    final List<ServiceTicket> rows = parseTickets(
      await widget.repo.listTickets(),
    );
    final ServiceTicket? current = trackedTicket(rows, widget.ticketId);
    return _Tracked(
      current,
      current == null ? const <ServiceTicket>[] : unitHistory(rows, current),
    );
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// The translated label of [status], or an em-dash for a value the machine does
  /// not have (never a made-up state name).
  String _statusLabel(String status) {
    final String? field = serviceStatusField(status);
    return field == null ? kServiceDash : _t(field);
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          // mobile-screens.jsx L128 — eyebrow + title, no back control.
          MobileHeader(sub: _tp('eyebrow'), title: _tp('title')),
          Expanded(
            child: FutureBuilder<_Tracked>(
              future: _future,
              builder: (BuildContext context, AsyncSnapshot<_Tracked> snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const SizedBox.shrink();
                }
                final ServiceTicket? current = snap.data?.current;
                // No register, an unreadable one, or a selected ticket this tenant
                // cannot see → honest-empty. Never a skeleton ticket.
                if (current == null) return serviceEmpty();
                return _body(current, snap.data!.history);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(ServiceTicket t, List<ServiceTicket> history) {
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 90),
      children: <Widget>[
        MSection(child: _ticketCard(t)),
        // mobile-screens.jsx L161 — the unit's repair history.
        MSection(title: _tp('historyTitle'), child: _history(history)),
        _warrantyCard(t),
      ],
    );
  }

  /// The tracked ticket: SR number, problem, category · unit, status pill, then the
  /// timeline (mobile-screens.jsx L130-158).
  Widget _ticketCard(ServiceTicket t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  // L132-133: the server-allocated SR number (REAL).
                  Text(
                    t.no.isEmpty ? kServiceDash : t.no,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: JuneflowTokens.brandPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  // L134: the problem — service_ticket.title (REAL).
                  Text(
                    t.title.isEmpty ? kServiceDash : t.title,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: JuneflowTokens.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  // L135 (category + unit): the category is the REAL stored string,
                  // rendered verbatim; the unit is an em-dash (no label source).
                  Row(
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          t.category.isEmpty ? kServiceDash : t.category,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: JuneflowTokens.textTertiary,
                          ),
                        ),
                      ),
                      const Text(
                        ' · $kServiceDash',
                        style: TextStyle(
                          fontSize: 11,
                          color: JuneflowTokens.textTertiary,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // L137: the status pill, tinted by the real status.
            MPill(
              label: _statusLabel(t.status),
              color: serviceStatusTone(t.status).fg,
            ),
          ],
        ),
        // L139: the timeline sits under a hairline, 14 above / 12 below.
        const SizedBox(height: 14),
        const Divider(
          height: 1,
          thickness: 1,
          color: JuneflowTokens.surfaceBorder,
        ),
        const SizedBox(height: 12),
        for (final (int i, ServiceTimelineStep s) in timelineFor(t).indexed)
          _timelineStep(s, last: i == kServiceStatuses.length - 1),
      ],
    );
  }

  /// One timeline row (mobile-screens.jsx L147-157): a connector line, a 24px dot,
  /// the step label and the step's REAL date (em-dash when no column backs it).
  Widget _timelineStep(ServiceTimelineStep s, {required bool last}) {
    final Color dotFill = s.current
        ? JuneflowTokens.brandPrimary
        : s.done
        ? JuneflowTokens.statusOkFg
        : JuneflowTokens.surfaceCard;
    return IntrinsicHeight(
      child: Stack(
        children: <Widget>[
          if (!last)
            Positioned(
              left: 11,
              top: 22,
              bottom: 0,
              width: 2,
              child: ColoredBox(
                color: s.done
                    ? JuneflowTokens.statusOkFg
                    : JuneflowTokens.surfaceMuted,
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 24,
                  height: 24,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: dotFill,
                    shape: BoxShape.circle,
                    border: s.done
                        ? null
                        : Border.all(
                            color: JuneflowTokens.surfaceBorderStrong,
                            width: 2,
                          ),
                  ),
                  child: s.done
                      ? Icon(
                          // L153: the in-progress step wears the hard-hat glyph.
                          s.current ? Icons.engineering : Icons.check,
                          size: 12,
                          color: JuneflowTokens.shellTextStrong,
                        )
                      : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        _statusLabel(s.status),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: s.current
                              ? FontWeight.w700
                              : FontWeight.w600,
                          color: s.current
                              ? JuneflowTokens.brandPrimary
                              : s.done
                              ? JuneflowTokens.textPrimary
                              : JuneflowTokens.textTertiary,
                        ),
                      ),
                      Text(
                        serviceDateText(s.date),
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: JuneflowTokens.textTertiary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The unit's other tickets (mobile-screens.jsx L162-177). The star rating column
  /// does not exist, so the right-hand side carries the intake date alone.
  Widget _history(List<ServiceTicket> rows) {
    if (rows.isEmpty) {
      return const Align(
        alignment: Alignment.centerLeft,
        child: Text(
          kServiceDash,
          style: TextStyle(fontSize: 12, color: JuneflowTokens.textTertiary),
        ),
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final (int i, ServiceTicket t) in rows.indexed)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: i == 0
                ? null
                : const BoxDecoration(
                    // L168: the prototype's dashed rule; Flutter's Border has no
                    // dash style, so the same hairline is drawn solid.
                    border: Border(
                      top: BorderSide(color: JuneflowTokens.surfaceBorder),
                    ),
                  ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        t.no.isEmpty ? kServiceDash : t.no,
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: JuneflowTokens.brandPrimary,
                        ),
                      ),
                      Text(
                        t.title.isEmpty ? kServiceDash : t.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: JuneflowTokens.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  serviceDateText(t.openedDate),
                  style: const TextStyle(
                    fontSize: 10,
                    color: JuneflowTokens.textTertiary,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  /// The brand-tinted warranty card (mobile-screens.jsx L180-188). MSection cannot
  /// carry the prototype's fill/border override, so the same box is built here.
  /// Its TITLE is omitted (it embeds the unresolvable unit code — see the header).
  Widget _warrantyCard(ServiceTicket t) {
    final int? months = t.warrantyMonthsRemaining;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JuneflowTokens.brandSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.brandPrimary),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // L182: the handover date. The server derives the warranty FROM it but
          // does not return it, so there is nothing honest to print.
          _warrantyRow(
            _t('warrantyDelivered'),
            kServiceDash,
            JuneflowTokens.textPrimary,
          ),
          const SizedBox(height: 4),
          // L185: the SERVER-derived remaining months (whole months only).
          _warrantyRow(
            _t('warrantyLeft'),
            months == null ? kServiceDash : '$months ${_t('monthsSuffix')}',
            JuneflowTokens.statusOkFg,
          ),
        ],
      ),
    );
  }

  Widget _warrantyRow(String label, String value, Color valueColor) {
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: JuneflowTokens.textPrimary,
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: valueColor,
          ),
        ),
      ],
    );
  }
}
