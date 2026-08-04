// RejectScreen — the mobile PR "reject + reason" action sheet, ported from
// pototype/mobile.jsx MobileRejectSheet (L460-541). Route `reject`
// (mobile_routes.dart; MobileSection.approve). authority = SERVER.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// eyebrow + title), a danger-tinted warning banner, the "common reasons" preset
// radios, a required additional-details field, and the bottom [cancel | send-back]
// bar. Every colour / space is a generated design token (JuneflowTokens); every
// string is an i18n key from the sidecar (no Thai byte in this file — i18n-guard,
// §0 rule 2). The preset reasons are STATIC UI copy (like the notif filter pills),
// ported with keys — not server data.
//
// Data (§0 rule 3): the prototype hardcodes the PR ("PR-2026-0418") and prefills
// the textarea with a mock sample — both mock. The PR
// no is read from the REAL GET /pr/{id}; the sample prefill is DROPPED. Rejecting
// drives the REAL POST /pr/{id}/reject { reason } — reason REQUIRED (pr.ts 400 on
// blank), so the send-back button is disabled until the reason is non-empty. The
// app sends ONLY the reason; the tiered authority (B-070) + any money is the
// SERVER's.
//
// Reason mechanic (honest de-mock): the backend takes ONE reason string, so the
// required additional-details field IS the reason. A preset radio is a one-tap
// FILL for that field (tapping a common reason writes it into the field; tapping
// the "other" preset clears it for free typing). Nothing is pre-selected — the
// approver must
// choose or write a reason, which is exactly the backend's required-reason rule.
//
// prId: as with approve, the shell has no route-param mechanism yet, so the router
// mounts this with prId=null → an honest "no PR selected" em-dash state.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'pr_action_agg.dart';
import 'pr_action_repository.dart';
import 'pr_action_shared.dart';

/// The five common-reason preset keys, in prototype order (mobile.jsx L461-467).
/// The last, `reason5` (the "other — type reason" preset), clears the field.
const List<String> _kReasonKeys = <String>[
  'reason1',
  'reason2',
  'reason3',
  'reason4',
  'reason5',
];
const int _kOtherIndex = 4;

/// Router entry for `reject`: resolves services from [AppScope], loads the sidecar,
/// renders [RejectScreen]. [prId] is null until the shell can pass a selected PR.
class RejectScreenHost extends StatefulWidget {
  const RejectScreenHost({super.key, this.prId});

  final String? prId;

  @override
  State<RejectScreenHost> createState() => _RejectScreenHostState();
}

class _RejectScreenHostState extends State<RejectScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('reject');
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
        return RejectScreen(
          repo: DioPrActionRepository(services.dio),
          strings: strings,
          i18n: services.i18n,
          prId: widget.prId,
        );
      },
    );
  }
}

/// The reject-reason view. Dependencies injected so tests drive it directly.
class RejectScreen extends StatefulWidget {
  const RejectScreen({
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
  State<RejectScreen> createState() => _RejectScreenState();
}

class _RejectScreenState extends State<RejectScreen> {
  late Future<PrDetail?> _future;
  PrDetail? _detail;
  final TextEditingController _reasonCtrl = TextEditingController();

  /// Highlighted preset, or -1 for none (nothing is pre-selected — the reason
  /// starts empty, matching the backend's required-reason rule).
  int _selected = -1;

  /// True while the reject POST is in flight.
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
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

  bool get _canSubmit =>
      _detail != null && !_busy && _reasonCtrl.text.trim().isNotEmpty;

  void _selectPreset(int i) {
    setState(() {
      _selected = i;
      if (i == _kOtherIndex) {
        _reasonCtrl.clear();
      } else {
        final String text = _tp(_kReasonKeys[i]);
        _reasonCtrl.text = text;
        _reasonCtrl.selection = TextSelection.collapsed(offset: text.length);
      }
    });
  }

  Future<void> _onSubmit() async {
    final PrDetail? detail = _detail;
    final String reason = _reasonCtrl.text.trim();
    if (detail == null || _busy || reason.isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.repo.reject(detail.id, reason);
      if (mounted) Navigator.maybePop(context);
    } catch (_) {
      // Server rejected it (400 blank / 403 under-tier / 409 not-pending / 404).
      // Re-enable so the approver can retry; no fabricated error copy is shown.
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
          if (_detail != null)
            PrActionBar(
              cancelLabel: _tp('cancel'),
              primaryLabel: _tp('submit'),
              primaryIcon: Icons.close,
              primaryColor: JuneflowTokens.statusDangerFg,
              onCancel: () => Navigator.maybePop(context),
              onPrimary: _canSubmit ? _onSubmit : null,
            ),
        ],
      ),
    );
  }

  Widget _body(PrDetail detail) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _banner(detail),
          const SizedBox(height: 14),
          Text(
            _tp('commonReasons'),
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          for (int i = 0; i < _kReasonKeys.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(height: 6),
            _presetRow(i),
          ],
          const SizedBox(height: 14),
          MField(
            label: _tp('detailLabel'),
            required: true,
            child: _reasonField(),
          ),
        ],
      ),
    );
  }

  /// The danger-tinted banner: the real PR no (danger, bold) + the static warning
  /// phrase, substituted into the resolved i18n template (mobile.jsx L478-483).
  Widget _banner(PrDetail detail) {
    const TextStyle base = TextStyle(
      fontSize: 12,
      color: JuneflowTokens.textPrimary,
    );
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: JuneflowTokens.statusDangerSoft,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Icon(
            Icons.warning_amber_rounded,
            size: 16,
            color: JuneflowTokens.statusDangerFg,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: prActionTemplateSpans(
                  _tp('banner'),
                  base,
                  <String, InlineSpan>{
                    'no': TextSpan(
                      text: detail.no ?? kPrActionDash,
                      style: base.copyWith(
                        color: JuneflowTokens.statusDangerFg,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// One common-reason preset radio (mobile.jsx L487-503). Tapping fills the
  /// reason field (or clears it for the "other" preset).
  Widget _presetRow(int i) {
    final bool selected = i == _selected;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => _selectPreset(i),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: selected
              ? JuneflowTokens.statusDangerSoft
              : JuneflowTokens.surfaceCard,
          border: Border.all(
            color: selected
                ? JuneflowTokens.statusDangerFg
                : JuneflowTokens.surfaceBorder,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: <Widget>[
            _radioDot(selected),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _tp(_kReasonKeys[i]),
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  color: JuneflowTokens.textPrimary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _radioDot(bool selected) {
    return Container(
      width: 18,
      height: 18,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? JuneflowTokens.statusDangerFg : Colors.transparent,
        border: Border.all(
          color: selected
              ? JuneflowTokens.statusDangerFg
              : JuneflowTokens.surfaceBorderStrong,
          width: 1.5,
        ),
      ),
      child: selected
          ? const DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: JuneflowTokens.shellTextStrong,
              ),
              child: SizedBox(width: 8, height: 8),
            )
          : null,
    );
  }

  /// The required additional-details field — an editable multiline textarea
  /// (mobile.jsx L510-519). This IS the reason POSTed to /pr/{id}/reject.
  Widget _reasonField() {
    return TextField(
      controller: _reasonCtrl,
      onChanged: (_) => setState(() {}),
      minLines: 3,
      maxLines: 6,
      style: const TextStyle(fontSize: 13, color: JuneflowTokens.textPrimary),
      decoration: InputDecoration(
        isDense: true,
        hintText: _tp('detailPlaceholder'),
        hintStyle: const TextStyle(
          fontSize: 13,
          color: JuneflowTokens.textTertiary,
        ),
        filled: true,
        fillColor: JuneflowTokens.surfaceCard,
        contentPadding: const EdgeInsets.all(10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: JuneflowTokens.surfaceBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: JuneflowTokens.surfaceBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: JuneflowTokens.brandPrimary),
        ),
      ),
    );
  }
}
