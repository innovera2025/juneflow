// TechCloseScreen — the technician's close-out screen, ported from
// pototype/mobile-screens.jsx MTechClose (L263-311). Route `tech-close`
// (mobile_routes.dart; MobileSection.service). money = NONE.
//
// THIS IS A THIN-HONEST PORT, and the reason is the whole point of the file (the
// B-229 / B-246 thin-honest precedent, option b — ship what is real, file the rest).
// `service_ticket` (packages/db/src/schema/extensions.ts L344-373) has NO signature
// column, NO before/after photo column, NO work-detail column and NO materials
// column. And the close op explicitly IGNORES a `{rating}` in its body: its comment
// says the table has no rating column and that round did not invent one
// (apps/api/src/routes/sales-service.ts L358-359 + L354-356). So every one of the
// prototype's five content slots is a label over an em-dash:
//   - the before / after photo strips (L270-281) — no column, no upload seam on
//     this route. The "+" tiles are NOT drawn: a tile that opens a picker and then
//     discards the photo is a promise, not a missing value, and the required
//     asterisk on the second strip is dropped for the same reason.
//   - the work-detail field (L282) — no column. (pm_workorder has cause/fix/advice;
//     service_ticket has nothing of the kind.)
//   - the materials field (L285) — no column, and its quantities are invented data.
//   - the customer SIGNATURE pad (L292-299) — no column. It is rendered as the
//     prototype's box with an honest em-dash inside and NO drawable surface: a pad
//     that captures a signature nobody stores is the worst kind of fake. Adding a
//     signature-pad or camera package is a stack decision that belongs to Wei (the
//     geolocator / B-260 precedent), not to this slice. The mock's signer line
//     (a name + timestamp, L299) is mock data on top of a column that does not
//     exist, so it is dropped outright.
// BLOCKERS.md B-294 files that whole set, plus the ignored rating.
//
// What IS real here: the ticket's server-allocated `no` in the header eyebrow, and
// the machine move. The action is derived from service_agg.nextServiceTransition —
// the ONE place the linear machine lives — so this screen offers `fix` from `fixing`
// and `close` from `fixed`, and nothing at all from `received` / `scheduled` (whose
// move belongs to tech-jobs) or from `closed` (terminal, shown honest-DISABLED).
//
// The CTA LABEL is where fidelity gives way, and it is the same call the merged
// pm-notes port made (B-285). The prototype's button (L305) reads "close AND send
// the satisfaction survey". The close happens; the survey does not exist anywhere:
// no rating column, no survey endpoint, and the close handler
// throws the client's rating away. Half a label that promises a survey is a promise,
// not an em-dashable value, so the button says exactly what it does — the destination
// status. (The merged WEB port still renders the fuller sales.service.btnCloseEval
// label for the same op; B-294 asks Wei to reconcile the two.) The bar's second
// control, the 44px edit button (L303), is dropped: with every field an em-dash
// there is nothing on this screen to edit.
//
// The write is an ONLINE one-shot POST — not the offline queue the PM write screens
// use, because a replayed transition 409s and the queue would report that as a
// permanently failed write even though the move succeeded (service_repository.dart
// header). So the honest outcomes are exactly done and failed.
import 'dart:async';

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

/// Router entry for `tech-close`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [TechCloseScreen].
///
/// tech-jobs pushes it with a REAL ticket id; as a bare tab route there is no
/// selection, so [ticketId] is null → an honest "no ticket selected" state (the
/// approve / reject / pm-checkin nullable-id precedent).
class TechCloseScreenHost extends StatefulWidget {
  const TechCloseScreenHost({super.key, this.ticketId});

  /// The ticket being closed out (path id for the POST), or null.
  final String? ticketId;

  @override
  State<TechCloseScreenHost> createState() => _TechCloseScreenHostState();
}

class _TechCloseScreenHostState extends State<TechCloseScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('tech_close');
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
          return TechCloseScreen(
            repo: DioServiceRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
            ticketId: widget.ticketId,
          );
        },
      ),
    );
  }
}

/// The close-out view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class TechCloseScreen extends StatefulWidget {
  const TechCloseScreen({
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
  State<TechCloseScreen> createState() => _TechCloseScreenState();
}

class _TechCloseScreenState extends State<TechCloseScreen> {
  /// The ticket as the SERVER last reported it. Null until the read lands, or when
  /// there is no selection / the ticket is not in this tenant.
  ServiceTicket? _ticket;
  bool _loaded = false;
  ServiceWriteState _state = ServiceWriteState.idle;

  @override
  void initState() {
    super.initState();
    if (widget.ticketId == null) {
      _loaded = true;
    } else {
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    try {
      final ServiceEnt? row = await widget.repo.getTicket(widget.ticketId!);
      if (!mounted) return;
      setState(() {
        _ticket = row == null ? null : parseTicket(row);
        _loaded = true;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _ticket = null;
        _loaded = true;
      });
    }
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// Run the ticket's legal move, then RE-READ it so the screen shows the server's
  /// status rather than an optimistic local one.
  Future<void> _advance(ServiceTransition next) async {
    final ServiceTicket? t = _ticket;
    if (t == null || _state == ServiceWriteState.sending) return;
    setState(() => _state = ServiceWriteState.sending);
    try {
      await widget.repo.runTransition(t.id, next.op);
      await _load();
      if (!mounted) return;
      setState(() => _state = ServiceWriteState.done);
    } on Object {
      // 409 (already advanced), 404, or no connection — all honest failures. The
      // call is one-shot: nothing is queued and nothing promises a retry.
      if (!mounted) return;
      setState(() => _state = ServiceWriteState.failed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ServiceTicket? t = _ticket;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // L266: the eyebrow is the ticket's REAL server-allocated SR number.
            sub: t == null || t.no.isEmpty ? kServiceDash : t.no,
            title: _tp('title'),
            leading: serviceBackButton(() => Navigator.maybePop(context)),
          ),
          Expanded(child: _body(t)),
          // The outcome strip sits OUTSIDE the scroll view, directly above the
          // action bar: an honest state the technician has to scroll to find is
          // one they will miss.
          if (_statusCard() case final Widget card) card,
          if (t != null) serviceActionBar(child: _action(t)),
        ],
      ),
    );
  }

  Widget _body(ServiceTicket? t) {
    if (!_loaded) return const SizedBox.shrink();
    // No selection, or a ticket this tenant cannot see → honest-empty.
    if (t == null) return serviceEmpty();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        MSection(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // L270 / L276 / L282 / L285 — every label kept as chrome, every value
              // an honest em-dash (no column backs any of them; see the header).
              MField(label: _tp('fieldBefore'), child: serviceDashBox()),
              MField(label: _tp('fieldAfter'), child: serviceDashBox()),
              MField(
                label: _tp('fieldWorkDetails'),
                child: serviceDashBox(minHeight: 60),
              ),
              MField(label: _tp('fieldMaterials'), child: serviceDashBox()),
            ],
          ),
        ),
        _signatureCard(),
      ],
    );
  }

  /// The customer-signature card (mobile-screens.jsx L292-299). MSection cannot carry
  /// the prototype's brand-soft fill, so the same box is built here. Inside is the
  /// prototype's pad AREA holding an em-dash — deliberately NOT a drawable surface:
  /// there is no signature column, and capturing a mark nobody stores would be the
  /// fabrication this screen exists to avoid.
  Widget _signatureCard() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JuneflowTokens.brandSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            _tp('signatureTitle'),
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 10),
          Container(
            height: 100,
            width: double.infinity,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: JuneflowTokens.surfaceCard,
              borderRadius: BorderRadius.circular(8),
              // The prototype's rule is dashed; Flutter's Border has no dash style,
              // so the same brand hairline is drawn solid.
              border: Border.all(color: JuneflowTokens.brandPrimary),
            ),
            child: const Text(
              kServiceDash,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: JuneflowTokens.textTertiary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The bottom action (mobile-screens.jsx L302-306), derived from the machine.
  ///
  /// `fixing` → fix, `fixed` → close, `closed` → an honest-DISABLED "already closed",
  /// and `received` / `scheduled` → a disabled bar too: their move belongs to
  /// tech-jobs, and offering it here would be an illegal jump the server 409s.
  Widget _action(ServiceTicket t) {
    final bool busy = _state == ServiceWriteState.sending;
    final ServiceTransition? next = nextServiceTransition(t.status);
    return switch (next?.op) {
      ServiceOp.fix => servicePrimaryButton(
        label: _t('btnFix'),
        icon: Icons.check,
        busy: busy,
        tone: JuneflowTokens.statusOkFg,
        onTap: () => _advance(next!),
      ),
      ServiceOp.close => servicePrimaryButton(
        label: _t('btnClose'),
        icon: Icons.check,
        busy: busy,
        tone: JuneflowTokens.statusOkFg,
        onTap: () => _advance(next!),
      ),
      // received / scheduled: this screen holds no legal move for them.
      ServiceOp.schedule ||
      ServiceOp.start => servicePrimaryButton(label: _t('btnFix'), onTap: null),
      // closed (terminal) or an unknown status.
      null => servicePrimaryButton(label: _t('btnClosedDone'), onTap: null),
    };
  }

  /// The honest outcome strip: the server accepted the move, or rejected it.
  Widget? _statusCard() {
    return switch (_state) {
      ServiceWriteState.done => serviceStatusCard(
        icon: Icons.check_circle,
        text: _t('saved'),
        tone: const ServiceTone(
          JuneflowTokens.statusOkFg,
          JuneflowTokens.statusOkSoft,
        ),
      ),
      ServiceWriteState.failed => serviceStatusCard(
        icon: Icons.error_outline,
        text: _t('failed'),
        tone: const ServiceTone(
          JuneflowTokens.statusDangerFg,
          JuneflowTokens.statusDangerSoft,
        ),
      ),
      ServiceWriteState.idle || ServiceWriteState.sending => null,
    };
  }
}
