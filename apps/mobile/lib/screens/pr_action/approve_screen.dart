// ApproveScreen — the mobile PR "confirm approval" action sheet, ported from
// pototype/mobile.jsx MobileApproveSheet (L393-458). Route `approve`
// (mobile_routes.dart; MobileSection.approve). authority = SERVER.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// eyebrow + title), a big ok-tinted check disc, the "confirm the approval"
// heading, the confirm sentence, and the bottom [cancel | confirm] bar. Every
// colour / space is a generated design token (JuneflowTokens); every string is an
// i18n key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype hardcodes the PR (a fixed no + amount) and a
// next-approver card (name / role / tier position) — all mock. The PR no +
// amount are read from the REAL GET /pr/{id}; the amount is the SERVER Σ, shown
// verbatim (never client-computed). The next-approver card / budget / attachments
// have NO basic wire (the generalized detail endpoint is B-252, deferred) → OMITTED,
// not invented. The prototype's optional note textarea has no wire —
// POST /pr/{id}/approve takes the PATH ID ONLY (no body) — so it is OMITTED too
// (an input that submits nowhere would be a fake mechanic). Confirming drives the
// REAL POST /pr/{id}/approve; the tiered decision (B-070) is the SERVER's.
//
// prId: the shell (MOB-SHELL-00) has no route-param mechanism yet, so the router
// mounts this with prId=null → an honest "no PR selected" em-dash state (never a
// fabricated PR). A future selection (inbox/detail → approve with an id) passes a
// real id; the screen + its tests already drive the full real flow off that id.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/mobile_header.dart';
import 'pr_action_agg.dart';
import 'pr_action_repository.dart';
import 'pr_action_shared.dart';

/// Router entry for `approve`: resolves the shared services from [AppScope],
/// loads the screen's i18n sidecar, then renders [ApproveScreen]. [prId] is null
/// until the shell can pass a selected PR (honest "no PR" state meanwhile).
class ApproveScreenHost extends StatefulWidget {
  const ApproveScreenHost({super.key, this.prId});

  /// The PR to approve, when the shell can supply one (null today — see file top).
  final String? prId;

  @override
  State<ApproveScreenHost> createState() => _ApproveScreenHostState();
}

class _ApproveScreenHostState extends State<ApproveScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('approve');
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
        return ApproveScreen(
          repo: DioPrActionRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
          prId: widget.prId,
        );
      },
    );
  }
}

/// The confirm-approval view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class ApproveScreen extends StatefulWidget {
  const ApproveScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.prId,
  });

  final PrActionRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? prId;

  @override
  State<ApproveScreen> createState() => _ApproveScreenState();
}

class _ApproveScreenState extends State<ApproveScreen> {
  late Future<PrDetail?> _future;
  PrDetail? _detail;

  /// True while the approve POST is in flight — dims + locks the confirm button.
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<PrDetail?> _load() async {
    final String? id = widget.prId;
    if (id == null || id.isEmpty) return null; // honest "no PR selected"
    final PrDetail? detail = parsePrDetail(await widget.repo.getPr(id));
    // setState (not a bare assign): the action bar is a sibling of the
    // FutureBuilder, so it must be rebuilt when the PR resolves.
    if (mounted) setState(() => _detail = detail);
    return detail;
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  Future<void> _onConfirm() async {
    final PrDetail? detail = _detail;
    if (detail == null || _busy) return;
    setState(() => _busy = true);
    try {
      // Path id only — the tiered approval decision + any money is the SERVER's.
      await widget.repo.approve(detail.id);
      if (mounted) Navigator.maybePop(context);
    } catch (_) {
      // The server rejected it (403 under-tier / 409 not-pending / 404). Re-enable
      // so the approver can retry; no fabricated error copy is shown.
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _tp('eyebrow'),
            title: _tp('title'),
            leading: prActionBackButton(() => Navigator.maybePop(context)),
          ),
          Expanded(
            child: FutureBuilder<PrDetail?>(
              future: _future,
              builder: (BuildContext context, AsyncSnapshot<PrDetail?> snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return prActionLoadingBody();
                }
                final PrDetail? detail = snap.data;
                if (detail == null) return prActionEmptyBody();
                return _body(detail);
              },
            ),
          ),
          // The action bar shows only once a real PR is loaded.
          if (_detail != null)
            PrActionBar(
              cancelLabel: _tp('cancel'),
              primaryLabel: _tp('title'),
              primaryIcon: Icons.check,
              primaryColor: JuneflowTokens.statusOkFg,
              onCancel: () => Navigator.maybePop(context),
              onPrimary: _busy ? null : _onConfirm,
            ),
        ],
      ),
    );
  }

  Widget _body(PrDetail detail) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // The big ok-tinted check disc (mobile.jsx L403-408).
          Container(
            width: 64,
            height: 64,
            margin: const EdgeInsets.fromLTRB(0, 16, 0, 14),
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: JuneflowTokens.statusOkSoft,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check,
              size: 30,
              color: JuneflowTokens.statusOkFg,
            ),
          ),
          Text(
            _tp('heading'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          _confirmSentence(detail),
        ],
      ),
    );
  }

  /// The confirm sentence with the real PR no (brand) + server amount (bold),
  /// substituted into the resolved i18n template (mobile.jsx L410-413).
  Widget _confirmSentence(PrDetail detail) {
    const TextStyle base = TextStyle(
      fontSize: 12.5,
      height: 1.55,
      color: JuneflowTokens.textSecondary,
    );
    final String amount =
        '${formatMoney(detail.amount)} ${widget.i18n.t('subcon.unitBaht')}';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Text.rich(
        TextSpan(
          children: prActionTemplateSpans(
            _tp('confirmBody'),
            base,
            <String, InlineSpan>{
              'no': TextSpan(
                text: detail.no ?? kPrActionDash,
                style: base.copyWith(
                  color: JuneflowTokens.brandPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              'amount': TextSpan(
                text: amount,
                style: base.copyWith(
                  color: JuneflowTokens.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            },
          ),
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}
