// SrvNewScreen — the resident's "raise a repair request" form, ported from
// pototype/mobile-screens.jsx MSrvNewReport (L61-121). Route `srv-new`
// (mobile_routes.dart; MobileSection.service — and the service tab's landing,
// mobile_tabs.dart). money = NONE.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header with its back
// circle (L68-69), ONE card holding the labelled fields in source order, the 3-column
// category grid with its emoji tiles and brand-tinted selection (L75-87), the
// multi-line problem box with the prototype's own metrics (surface-2 fill, radius 8,
// 10px padding, 12.5px, 60 min height — L90), and the sticky bottom bar (L111-116).
// Every colour / space is a generated design token (JuneflowTokens); every string is
// a key from the sidecar (no Thai byte in this file — i18n-guard, §0 rule 2). The
// category EMOJI (L63-64) are kept as literal glyphs: they are the prototype's own
// language-neutral icons, not copy, and are never translated.
//
// THE SCHEMA GAP, STATED UP FRONT (BLOCKERS.md B-293). `service_ticket`
// (packages/db/src/schema/extensions.ts L344-373) has these columns and no others:
// id, company_id, no, unit_id, customer_id, channel, category, title, priority,
// status, assignee_user_id, opened_date, scheduled_date, warranty, created_at,
// updated_at. There is NO description column and NO photo column, and
// `POST /sales/service` reads exactly the keys that exist (sales-service.ts
// L221-254). So:
//   - the problem TEXTAREA (L89-93) writes `title` — the table's only free-text
//     column, and the very one srv-track and tech-jobs render as the problem line.
//     The prototype form has no separate title field and the API requires one, so
//     this is a mapping, not an invention; B-293 asks whether a real `description`
//     column should be added instead of long text living in `title`.
//   - the PHOTO strip (L94-104) is DROPPED, not em-dashed. There is no column and no
//     upload seam on this route, so a "+" tile would be an affordance that silently
//     discards what the resident attached — and the prototype marks it REQUIRED, a
//     requirement nothing here could honour. A dead promise is dropped (the pm-notes
//     B-285 precedent); B-293 files it.
//   - the PREFERRED-SLOT field (L106-108) is DROPPED for a different reason: it is
//     not a missing column but a WRONG one. `scheduled_date` means "the appointment
//     that was set", and writing a resident's wish into it would make a `received`
//     ticket look scheduled on tech-jobs and light the timeline's second step on
//     srv-track. Filed in B-293 rather than guessed at.
//   - the DRAFT button (L112) is DROPPED: the machine's start state is `received`
//     and there is no draft status anywhere in it (sales-service.ts L21-27), so the
//     button would promise a state the server cannot store.
//   - the CATEGORY grid (L75-87) keeps its chrome but is honest-DISABLED, and the
//     create does NOT send `category`, PENDING THE B-292 RULING. This is NOT a schema
//     gap: the column exists and takes any string (sales-service.ts L246 stores the
//     client's value verbatim/trimmed, or null). The gap is that NOTHING in this
//     system declares WHICH strings it may hold, and the three candidate vocabularies
//     disagree. A programmatic 3-way set-diff, re-run this round, is quoted in full in
//     BLOCKERS.md B-292 (all Thai strings live there — this file carries none):
//       * dict `sales.service.cat*` (6) vs the seed's SERVICE_TICKETS (6 distinct):
//         2 of 6 differ — the seed stores a SHORTER string for the window/door and
//         the floor/tile buckets than the dict key of the same name;
//       * the mobile prototype's own tiles (L63-64) are a THIRD set: 4 of 6 differ
//         from the dict (and 5 of 6 from the seed), one with the words reversed;
//       * exactly ONE value is common to all three.
//     None of the three is authoritative. The dict values are the labels of the
//     prototype's category-MIX CHART (sales-service.jsx L131-136) — a panel the
//     merged web port deliberately OMITS as "pure mock analytics with NO wire"
//     (sales-service.tsx L49-51) — and no merged code reads those six keys at all.
//     The seed values are 7 mock rows copied from the same prototype, two of them
//     reading as truncations of that chart's own labels. And the merged web CREATE
//     form types the category into a free-text <input> (sales-service.tsx L830), so
//     the register declares no vocabulary either. Picking one of the three would be
//     deciding a §0 conflict this port does not own, and writing the wrong one forks
//     a column that other screens display (sales-service.tsx L451 / L708 render it
//     raw). So the tiles are DRAWN (chrome, §0 rule 1) in the house disabled
//     foreground, take no tap, and nothing is written — the honest-disabled precedent
//     (servicePrimaryButton with a null onTap; the merged web port's honest-disabled
//     WO link, sales-service.tsx L740), never a live-looking control whose value is
//     silently discarded. Wei's answer turns it back on in ONE place: hand the ruled
//     value to newTicketBody(category:), which already carries the parameter.
//   - the UNIT field keeps its label (chrome) over an honest em-dash. unit_id is a
//     project_node uuid and NO endpoint turns it into a unit code — the merged web
//     port em-dashes exactly this field for exactly this reason. The real unit_id
//     the flow supplies still rides on the create (so the server can derive the
//     warranty), but nothing pretends to display it, and the prototype's required
//     asterisk is not drawn on a field with no control behind it.
//   - `channel`, `priority`, `status`, `no` and `opened_date` are not sent: the form
//     asks for none of them, and the last three are the server's own (see
//     service_agg.newTicketBody).
//
// The write is the REAL POST /sales/service, an ONLINE one-shot call — not the
// offline queue the PM write screens use, because a replayed create would raise a
// SECOND ticket and this route declares no client idempotency key (the B-261
// contract covers money writes). service_repository.dart states that in full. So the
// honest outcomes are exactly done and failed; nothing is ever shown as captured.
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

/// The six category tiles (mobile-screens.jsx L62-65), in prototype order. Each
/// carries the prototype's own emoji glyph and the SIDECAR FIELD holding its label
/// key.
///
/// The label keys are the existing `sales.service.cat*` dict — a zero-mint DISPLAY
/// choice only. They are NOT asserted to be the stored vocabulary: the dict, the seed
/// and the mobile prototype's own tiles are three different sets (the file header has
/// the diff; BLOCKERS.md B-292 has it in full), so until Wei rules, these tiles are
/// inert chrome and the create writes no `category` at all. Four of the six dict
/// labels read fuller than the mobile prototype's tiles — a filed §0 deviation, also
/// B-292 question (1).
const List<(String, String)> kServiceCategories = <(String, String)>[
  ('💧', 'catPlumbing'),
  ('⚡️', 'catElectrical'),
  ('🎨', 'catPaint'),
  ('🚪', 'catWindowDoor'),
  ('❄️', 'catAircon'),
  ('🧱', 'catFloorTile'),
];

/// Router entry for `srv-new`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [SrvNewScreen].
class SrvNewScreenHost extends StatefulWidget {
  const SrvNewScreenHost({super.key, this.unitId});

  /// The sold unit the request is about, when the flow carried one (a REAL
  /// project_node uuid off an existing ticket). Null → the create omits unit_id and
  /// the server stores NULL, rather than a placeholder.
  final String? unitId;

  @override
  State<SrvNewScreenHost> createState() => _SrvNewScreenHostState();
}

class _SrvNewScreenHostState extends State<SrvNewScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('srv_new');
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
          return SrvNewScreen(
            repo: DioServiceRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
            unitId: widget.unitId,
          );
        },
      ),
    );
  }
}

/// The new-request form. Dependencies are injected so the screen is driven directly
/// in tests (a fake repo + inline strings/i18n), never via the network.
class SrvNewScreen extends StatefulWidget {
  const SrvNewScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.unitId,
  });

  final ServiceRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? unitId;

  @override
  State<SrvNewScreen> createState() => _SrvNewScreenState();
}

class _SrvNewScreenState extends State<SrvNewScreen> {
  final TextEditingController _problem = TextEditingController();

  ServiceWriteState _state = ServiceWriteState.idle;

  /// The SERVER-allocated document number of the ticket this form created — printed
  /// on success so the resident sees the real `SR-…` the server issued, never a
  /// number this app made up.
  String _createdNo = '';

  @override
  void initState() {
    super.initState();
    _problem.addListener(_onEdited);
  }

  @override
  void dispose() {
    _problem
      ..removeListener(_onEdited)
      ..dispose();
    super.dispose();
  }

  /// Every keystroke rebuilds, because the send button's enabled state is derived
  /// from the problem text (the server's one required field) — without this the
  /// button would stay greyed out after the resident typed. A keystroke after a
  /// rejected send also makes the next tap a NEW attempt; after a successful create
  /// the form is finished and stays finished (a second send would raise a second
  /// ticket, and this route declares no client idempotency key).
  void _onEdited() {
    setState(() {
      if (_state == ServiceWriteState.failed) _state = ServiceWriteState.idle;
    });
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  Future<void> _submit() async {
    if (_state == ServiceWriteState.sending ||
        _state == ServiceWriteState.done) {
      return;
    }
    if (!canSubmitNewTicket(_problem.text)) return;
    setState(() => _state = ServiceWriteState.sending);
    try {
      // `category` is deliberately NOT passed: no vocabulary is ruled yet, so the
      // column is left NULL rather than forked (file header + BLOCKERS.md B-292).
      // newTicketBody still takes the parameter — Wei's answer is a one-line change
      // here, nowhere else.
      final ServiceEnt? created = await widget.repo.createTicket(
        newTicketBody(title: _problem.text, unitId: widget.unitId ?? ''),
      );
      if (!mounted) return;
      setState(() {
        _createdNo = created == null ? '' : svcStr(created, 'no');
        _state = ServiceWriteState.done;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _state = ServiceWriteState.failed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool busy = _state == ServiceWriteState.sending;
    final bool done = _state == ServiceWriteState.done;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _tp('eyebrow'),
            title: _tp('title'),
            leading: serviceBackButton(() => Navigator.maybePop(context)),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(top: 10, bottom: 24),
              children: <Widget>[
                MSection(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      // L72: the label is kept, the value em-dashes (no unit-label
                      // endpoint). No required asterisk — there is no control here.
                      MField(label: _tp('fieldUnit'), child: serviceDashBox()),
                      // L75-87: the six category tiles, drawn but honest-DISABLED
                      // until B-292 rules which vocabulary the column holds (see the
                      // file header). No required asterisk, for the same reason it is
                      // not drawn on the unit field above: there is no live control.
                      MField(
                        label: _tp('fieldCategory'),
                        child: _categoryGrid(),
                      ),
                      // L89-93: the problem text -> service_ticket.title.
                      MField(
                        label: _tp('fieldProblem'),
                        required: true,
                        child: _problemBox(enabled: !busy && !done),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // The outcome strip sits OUTSIDE the scroll view, directly above the
          // action bar: an honest state the resident has to scroll to find is one
          // they will miss.
          if (_statusCard() case final Widget card) card,
          // L111-116: the sticky bar. The draft button is dropped (no draft status),
          // so the send action takes the whole width.
          serviceActionBar(
            child: servicePrimaryButton(
              label: _tp('submit'),
              icon: Icons.check,
              busy: busy,
              onTap: done || !canSubmitNewTicket(_problem.text)
                  ? null
                  : _submit,
            ),
          ),
        ],
      ),
    );
  }

  /// The 3-column category grid (mobile-screens.jsx L76-86) as two rows of three.
  /// The prototype's brand-tinted SELECTION (its tile 0) is not reproduced: nothing
  /// can be selected while the write is withheld, and a highlighted tile would claim
  /// a bucket the create does not send.
  Widget _categoryGrid() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int row = 0; row < 2; row++) ...<Widget>[
          if (row > 0) const SizedBox(height: 6),
          Row(
            children: <Widget>[
              for (int col = 0; col < 3; col++) ...<Widget>[
                if (col > 0) const SizedBox(width: 6),
                Expanded(child: _categoryTile(row * 3 + col)),
              ],
            ],
          ),
        ],
      ],
    );
  }

  /// One tile: the prototype's glyph + label over the house DISABLED foreground
  /// (JuneflowTokens.textTertiary — the same tone servicePrimaryButton takes when its
  /// onTap is null). No GestureDetector at all, so the tile cannot look live: a tap
  /// that silently discarded the resident's pick is exactly what the photo strip was
  /// dropped to avoid. Re-enabling is one ruling away (B-292).
  Widget _categoryTile(int index) {
    final (String glyph, String field) = kServiceCategories[index];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: JuneflowTokens.surfaceBorder, width: 1.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(glyph, style: const TextStyle(fontSize: 22)),
          const SizedBox(height: 2),
          Text(
            _t(field),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
              color: JuneflowTokens.textTertiary,
            ),
          ),
        ],
      ),
    );
  }

  /// The problem box (mobile-screens.jsx L90). The prototype renders a static div
  /// holding a mock sentence because it mocks an already-filled form; the screen's
  /// whole purpose is typing it, so it is an input — same box, same metrics.
  Widget _problemBox({required bool enabled}) {
    return Container(
      constraints: const BoxConstraints(minHeight: 60),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: TextField(
        controller: _problem,
        enabled: enabled,
        maxLines: null,
        keyboardType: TextInputType.multiline,
        textInputAction: TextInputAction.newline,
        style: const TextStyle(
          fontSize: 12.5,
          height: 1.5,
          color: JuneflowTokens.textPrimary,
        ),
        decoration: const InputDecoration(
          isDense: true,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          contentPadding: EdgeInsets.zero,
        ),
      ),
    );
  }

  /// The honest outcome strip. On success it names the SERVER-allocated `SR-…`
  /// number (an em-dash if the create answered without one); on rejection it says so
  /// and nothing is retried in the background.
  Widget? _statusCard() {
    return switch (_state) {
      ServiceWriteState.done => serviceStatusCard(
        icon: Icons.check_circle,
        text:
            '${_t('saved')} · ${_createdNo.isEmpty ? kServiceDash : _createdNo}',
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
