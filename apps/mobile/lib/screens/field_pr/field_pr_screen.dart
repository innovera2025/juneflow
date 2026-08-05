// FieldPrScreen — the mobile quick-PR-from-site screen, ported from
// pototype/mobile-screens.jsx MFieldQuickPR (L429-478). Route `field-pr`
// (mobile_routes.dart; MobileSection.field). money = SERVER.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (34px round
// surface-3 back chevron · eyebrow · title, L432-433), ONE card holding the labelled
// fields in source order (BOQ L436 / requested line L441 / urgency L450 / photos +
// reason L456) with the prototype's own box metrics (surface-2 fill, radius 8, 10px
// padding, 12px text; the BOQ box on brand-soft with brand text), and the sticky
// bottom bar (L471-475). Every colour/space is a generated design token
// (JuneflowTokens); every string is a key from the sidecar (no Thai byte in this
// file — i18n-guard, §0 rule 2).
//
// Data (§0 rule 3) — what the prototype fakes and this screen does NOT:
//   - the chosen BOQ (L438) and the requested line (L444-447) are hardcoded strings.
//     Here they are REAL selections: GET /boq lists the tenant's BOQ documents, and
//     picking one loads its REAL lines from GET /boq/{id}/items. The PR's project
//     comes from the chosen BOQ's own `project_id` — nothing is guessed;
//   - the "approx. price 82,000 THB" line (L447) and the money on the CTA (L473)
//     are hardcoded.
//     Both are dropped: an estimate is qty × price, i.e. client money math, which
//     money = SERVER forbids. The requested quantity is the requester's input and the
//     BOQ's remaining quantity + unit are real columns, so those render; the PR's
//     VALUE renders only after `POST /pr` returns it (FieldPrItem.estimate says why
//     the unit price is not shown either);
//   - the urgency chips (L452-453) have no column. `pr.need_date` exists, but turning
//     the "urgent, 2 days" tile into `today + 2 days` would invent the mapping as
//     well as the
//     date, so the field keeps its label (chrome) and its value is an em-dash;
//   - the photo tiles + reason box (L456-462) have no column: `pr` has no photo or
//     reason field, and the app has no upload seam. Same treatment — label kept,
//     value em-dashed;
//   - the approval-chain info card (L464-469) is DROPPED. It states a specific chain
//     with a "limit >= 100K" threshold; the implemented tiers are different numbers
//     entirely (pr.ts B-070: the purchasing head on every PR · the project manager
//     above 500,000 · the MD above
//     2,000,000). Rendering it would tell the requester something about their own
//     document that is false — a claim, not a missing value, so it cannot be
//     em-dashed. BLOCKERS.md B-297;
//   - the DOCUMENT NUMBER field has no prototype counterpart and is added
//     deliberately. `POST /pr` requires `no` and there is no issuer endpoint
//     (field_pr_agg.dart header), so the alternative to asking the requester is
//     inventing a business identifier the tenant's numbering series owns. The
//     addition is disclosed in B-297, not slipped in.
//
// ⚠ ONLINE ONLY. This screen is NOT enrolled in the offline queue, unlike the merged
// pm-checkin / pm-checklist / pm-notes writes: `pr.no` has no unique index, so a
// replayed create would make a SECOND purchase requisition rather than being rejected
// (field_pr_repository.dart states it in full; BLOCKERS.md B-295 asks for the B-261
// client-key template on POST /pr). A submit therefore either lands or fails visibly.
//
// The two-step submission is surfaced as three distinct outcomes, because collapsing
// them would be dangerous: `submitted` (both calls landed), `draftOnly` (the PR
// EXISTS as a draft and only the submit failed — a retry re-submits that id and never
// re-creates), and `failed` (nothing was created). Reporting a draft-only result as a
// plain failure would invite a second attempt that, with no unique index, would
// really produce a duplicate PR.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'field_pr_agg.dart';
import 'field_pr_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// The prototype's separator between meta values — U+00B7, not an ASCII dot.
const String _mid = '·';

/// Router entry for `field-pr`: resolves the shared services from [AppScope], loads
/// the screen's i18n key sidecar, then renders [FieldPrScreen].
class FieldPrScreenHost extends StatefulWidget {
  const FieldPrScreenHost({super.key});

  @override
  State<FieldPrScreenHost> createState() => _FieldPrScreenHostState();
}

class _FieldPrScreenHostState extends State<FieldPrScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('field_pr');
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
          return FieldPrScreen(
            repo: DioFieldPrRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
          );
        },
      ),
    );
  }
}

/// The quick-PR view. Dependencies are injected so the screen is driven directly in
/// tests (a fake repo + inline strings/i18n), never via the network.
class FieldPrScreen extends StatefulWidget {
  const FieldPrScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
  });

  final FieldPrRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;

  @override
  State<FieldPrScreen> createState() => _FieldPrScreenState();
}

class _FieldPrScreenState extends State<FieldPrScreen> {
  final TextEditingController _no = TextEditingController();
  final TextEditingController _qty = TextEditingController();

  /// Null until the BOQ list read finishes.
  List<FieldPrBoq>? _boqs;

  /// Null until a BOQ is chosen and its lines are read.
  List<FieldPrItem>? _items;

  /// Set when a read threw → the affected list is UNKNOWN (em-dash), which is NOT
  /// the same as "this tenant has no BOQ".
  bool _loadFailed = false;

  FieldPrBoq? _boq;
  FieldPrItem? _item;

  FieldPrState _state = FieldPrState.idle;

  /// The id of a PR that WAS created but not submitted. A retry re-submits exactly
  /// this id — it never re-creates (there is no unique index to catch a duplicate).
  String? _draftPrId;

  /// The server-stated amount + currency of the created PR. The only money rendered.
  ({num amount, String currency})? _amount;

  @override
  void initState() {
    super.initState();
    _no.addListener(_onEdited);
    _qty.addListener(_onEdited);
    _load();
  }

  @override
  void dispose() {
    _no
      ..removeListener(_onEdited)
      ..dispose();
    _qty
      ..removeListener(_onEdited)
      ..dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final List<FieldPrEnt> rows = await widget.repo.listBoqDocs();
      if (!mounted) return;
      setState(() {
        _boqs = selectableBoqs(rows);
        _loadFailed = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _boqs = const <FieldPrBoq>[];
        _loadFailed = true;
      });
    }
  }

  Future<void> _selectBoq(FieldPrBoq boq) async {
    setState(() {
      _boq = boq;
      _item = null;
      _items = null;
      _loadFailed = false;
      _resetOutcome();
    });
    try {
      final List<FieldPrEnt> rows = await widget.repo.listBoqItems(boq.id);
      if (!mounted) return;
      setState(() => _items = parseBoqItems(rows));
    } on Object {
      if (!mounted) return;
      setState(() {
        _items = null;
        _loadFailed = true;
      });
    }
  }

  /// Every keystroke rebuilds, because the CTA is GATED on the form being complete
  /// and valid ([_canSubmit]) — without a rebuild the button would still read as
  /// disabled after the last required field was filled in.
  ///
  /// A typed character also invalidates a resolved outcome: the next submit is a NEW
  /// request, not a retry of the old one. A DRAFT-ONLY outcome is deliberately NOT
  /// cleared — that PR really exists, and forgetting its id is exactly how a second
  /// one gets created.
  void _onEdited() {
    setState(() {
      final bool resolved =
          _state != FieldPrState.idle &&
          _state != FieldPrState.sending &&
          _state != FieldPrState.draftOnly;
      if (resolved) _resetOutcome();
    });
  }

  void _resetOutcome() {
    _state = FieldPrState.idle;
    _amount = null;
    _draftPrId = null;
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);
  String _tp(String field) => widget.i18n.tp(widget.strings[field]);

  /// Everything `POST /pr` needs is present and valid.
  bool get _canSubmit {
    if (_state == FieldPrState.sending) return false;
    if (_state == FieldPrState.draftOnly) return true; // retry the submit step
    return _boq != null &&
        _item != null &&
        _no.text.trim().isNotEmpty &&
        parseRequestedQty(_qty.text) != null;
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;

    // Retry path: the PR exists, only the submit step failed.
    final String? draft = _draftPrId;
    if (_state == FieldPrState.draftOnly && draft != null) {
      setState(() => _state = FieldPrState.sending);
      final bool ok = await widget.repo.submitPr(draft);
      if (!mounted) return;
      setState(() {
        _state = ok ? FieldPrState.submitted : FieldPrState.draftOnly;
        if (ok) _draftPrId = null;
      });
      return;
    }

    final FieldPrBoq? boq = _boq;
    final FieldPrItem? item = _item;
    final num? qty = parseRequestedQty(_qty.text);
    if (boq == null || item == null || qty == null) return;

    setState(() => _state = FieldPrState.sending);
    final FieldPrCreateResult created = await widget.repo.createPr(
      prPayload(
        no: _no.text,
        projectId: boq.projectId,
        boqItemId: item.id,
        qty: qty,
      ),
    );
    if (!mounted) return;
    if (created == null) {
      // Nothing was created — say exactly that, and keep no draft id.
      setState(() {
        _state = FieldPrState.failed;
        _draftPrId = null;
        _amount = null;
      });
      return;
    }

    final String? prId = fieldPrStr(created, 'id');
    final ({num amount, String currency})? amount = createdPrAmount(created);
    if (prId == null) {
      // Created, but the response carried no id to submit with. The PR exists as a
      // draft; without its id no retry is possible, so this is reported as
      // draft-only with no retry rather than as a success.
      setState(() {
        _state = FieldPrState.draftOnly;
        _draftPrId = null;
        _amount = amount;
      });
      return;
    }

    final bool ok = await widget.repo.submitPr(prId);
    if (!mounted) return;
    setState(() {
      _state = ok ? FieldPrState.submitted : FieldPrState.draftOnly;
      _draftPrId = ok ? null : prId;
      _amount = amount;
    });
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            sub: _tp('sub'),
            title: _tp('title'),
            leading: _backButton(),
          ),
          Expanded(child: _body()),
          // The honest outcome sits ABOVE the sticky bar, not at the end of the
          // scrolling form: the requester must see whether a purchase requisition
          // was created, and a result they have to scroll to find is a result they
          // can miss — which, for the draft-only case, is how a duplicate PR gets
          // raised.
          if (_outcomeText() case final String text) _outcomeCard(text),
          _actionBar(),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile-screens.jsx L433 — surface-3 circle + chevL).
  Widget _backButton() {
    return GestureDetector(
      onTap: () => Navigator.maybePop(context),
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: JuneflowTokens.surfaceMuted,
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.chevron_left,
          size: 18,
          color: JuneflowTokens.textSecondary,
        ),
      ),
    );
  }

  Widget _body() {
    if (_boqs == null) return const SizedBox.shrink();
    if (_loadFailed && _boq == null) return _unknown();
    return ListView(
      padding: const EdgeInsets.only(top: 10, bottom: 24),
      children: <Widget>[
        MSection(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // No prototype counterpart — see the file header (B-297).
              MField(
                label: _t('fieldNo'),
                required: true,
                child: _textBox(_no, TextInputType.text),
              ),
              // L436-440 — the BOQ picker.
              MField(
                label: _tp('fieldBoq'),
                required: true,
                child: _boqPicker(),
              ),
              // L441-449 — the requested line.
              MField(
                label: _tp('fieldItems'),
                required: true,
                child: _itemPicker(),
              ),
              // L450-455 — no column backs urgency (see the header).
              MField(label: _tp('fieldUrgency'), child: _dashBox()),
              // L456-462 — no column backs photos or the reason (see the header).
              MField(label: _tp('fieldPhotos'), child: _dashBox()),
            ],
          ),
        ),
      ],
    );
  }

  /// The BOQ list (L436-440). Each row shows the doc's REAL number + name; the chosen
  /// one sits on the prototype's brand-soft box.
  Widget _boqPicker() {
    final List<FieldPrBoq> rows = _boqs ?? const <FieldPrBoq>[];
    final FieldPrBoq? chosen = _boq;
    if (chosen != null) {
      return GestureDetector(
        onTap: () => setState(() {
          _boq = null;
          _item = null;
          _items = null;
          _resetOutcome();
        }),
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: JuneflowTokens.brandSoft,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            chosen.name == null
                ? (chosen.no ?? _dash)
                : '${chosen.no ?? _dash} $_mid ${chosen.name}',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: JuneflowTokens.brandPrimary,
            ),
          ),
        ),
      );
    }
    if (rows.isEmpty) return _emptyBox();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final FieldPrBoq b in rows)
          _optionRow(
            title: b.no ?? _dash,
            sub: b.name,
            onTap: () => _selectBoq(b),
          ),
      ],
    );
  }

  /// The BOQ's lines (L441-449). Real name/code/unit/remaining quantity; the
  /// requested quantity is the requester's own input. No price, no estimate — see
  /// FieldPrItem.estimate.
  Widget _itemPicker() {
    // No BOQ chosen yet, or its lines are still loading / could not be read — all
    // three are "not known to be anything" (see [_dashBox]).
    if (_boq == null || _items == null) return _dashBox();
    final List<FieldPrItem> rows = _items ?? const <FieldPrItem>[];
    final FieldPrItem? chosen = _item;
    if (chosen != null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceAlt,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            GestureDetector(
              onTap: () => setState(() {
                _item = null;
                _resetOutcome();
              }),
              behavior: HitTestBehavior.opaque,
              child: Text(
                chosen.name ?? _dash,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: JuneflowTokens.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              // The BOQ line's REAL remaining quantity + unit (never a guessed unit).
              '${chosen.remainQty ?? _dash} ${chosen.unit ?? ''}'.trim(),
              style: const TextStyle(
                fontSize: 10.5,
                color: JuneflowTokens.textTertiary,
              ),
            ),
            const SizedBox(height: 8),
            MField(
              label: _t('fieldQty'),
              required: true,
              child: _textBox(_qty, TextInputType.number),
            ),
          ],
        ),
      );
    }
    if (rows.isEmpty) return _emptyBox();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final FieldPrItem it in rows)
          _optionRow(
            title: it.name ?? _dash,
            sub: it.code,
            onTap: () => setState(() {
              _item = it;
              _resetOutcome();
            }),
          ),
      ],
    );
  }

  Widget _optionRow({
    required String title,
    required String? sub,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceAlt,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: JuneflowTokens.textPrimary,
              ),
            ),
            if (sub != null) ...<Widget>[
              const SizedBox(height: 2),
              Text(
                sub,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 10.5,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// One text input in the prototype's own box (L442: surface-2 fill, radius 8, 10px
  /// padding, 12px text).
  Widget _textBox(TextEditingController controller, TextInputType type) {
    return Container(
      constraints: const BoxConstraints(minHeight: 36),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: TextField(
        controller: controller,
        enabled: _state != FieldPrState.sending,
        keyboardType: type,
        style: const TextStyle(fontSize: 12, color: JuneflowTokens.textPrimary),
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

  /// An em-dashed slot: the value has no wire column, or it could not be read. Both
  /// mean "not known to be anything", which is what the em-dash says — and both are
  /// distinct from [_emptyBox], which is the server answering "there is nothing".
  Widget _dashBox() => _plainBox(_dash, JuneflowTokens.textTertiary);

  /// A slot the server answered, honestly, with nothing.
  Widget _emptyBox() => _plainBox(_t('empty'), JuneflowTokens.textTertiary);

  Widget _plainBox(String text, Color color) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: TextStyle(fontSize: 12, color: color)),
    );
  }

  /// The honest outcome line, or null while idle/sending.
  String? _outcomeText() {
    switch (_state) {
      case FieldPrState.submitted:
        final ({num amount, String currency})? a = _amount;
        // The ONLY money on this screen, and it is the server's own figure off the
        // 201 body — never recomputed, never reformatted into a different currency.
        return a == null
            ? _t('submitted')
            : '${_t('submitted')} $_mid ${a.amount} ${a.currency}';
      case FieldPrState.draftOnly:
        return _t('draftOnly');
      case FieldPrState.failed:
        return _t('failed');
      case FieldPrState.idle:
      case FieldPrState.sending:
        return null;
    }
  }

  Widget _outcomeCard(String text) {
    final bool ok = _state == FieldPrState.submitted;
    final bool warn = _state == FieldPrState.draftOnly;
    final Color fg = ok
        ? JuneflowTokens.statusOkFg
        : warn
        ? JuneflowTokens.statusWarnFg
        : JuneflowTokens.statusDangerFg;
    final Color bg = ok
        ? JuneflowTokens.statusOkSoft
        : warn
        ? JuneflowTokens.statusWarnSoft
        : JuneflowTokens.statusDangerSoft;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: fg),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            ok
                ? Icons.check_circle
                : warn
                ? Icons.sync_problem
                : Icons.error_outline,
            size: 18,
            color: fg,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The sticky bottom bar (L471-475). The prototype's label carries a hardcoded
  /// amount; here it names only the action, because the PR's value is the server's to
  /// state and it does so after the create.
  Widget _actionBar() {
    final bool busy = _state == FieldPrState.sending;
    final bool enabled = _canSubmit;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: GestureDetector(
        onTap: enabled ? _submit : null,
        behavior: HitTestBehavior.opaque,
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: enabled
                ? JuneflowTokens.brandPrimary
                : JuneflowTokens.surfaceMuted,
            borderRadius: BorderRadius.circular(10),
          ),
          child: busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: JuneflowTokens.textSecondary,
                  ),
                )
              : Text(
                  _t('submit'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: enabled
                        ? JuneflowTokens.shellTextStrong
                        : JuneflowTokens.textTertiary,
                  ),
                ),
        ),
      ),
    );
  }

  /// Unknown — the BOQ catalogue could not be read, which is NOT "this tenant has no
  /// BOQ" (the distinction the honest-states rule turns on).
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
