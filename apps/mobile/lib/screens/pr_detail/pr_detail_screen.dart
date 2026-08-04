// PrDetailScreen — the mobile PR detail, ported from pototype/mobile.jsx
// MobileApprovalDetail (L179-385). Route `detail` — a PUSHED route (not a tab): the
// approvals inbox constructs [PrDetailScreenHost] with a real prId when a PR row is
// tapped. money = NONE to read; the sticky bar launches the approve/reject action
// sheets (authority = SERVER, path-id only).
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (back chevron ·
// eyebrow + the PR no), a thin status banner, a parties card, a net-total card, a
// material-lines card, and the sticky [reject · approve] bar. Every colour / space
// is a generated design token (JuneflowTokens); every string is an i18n key from
// the sidecar or the mob.approval.detail.* dict (no Thai byte in this file —
// i18n-guard, §0 rule 2).
//
// Data (§0 rule 3): the prototype's hardcoded title/description, "your approval
// limit" card, BOQ budget bar, approver timeline and attachments are mock mechanics
// and are DROPPED. The screen reads the REAL GET /pr/:id (pr_detail_agg.dart) and
// shows only what the wire honestly supports:
//   - no / status / amount / requester / vendor / items(qty, amount) → REAL.
//   - the project NAME and each material NAME are NOT on the wire (only uuids) →
//     honest em-dashes, never a raw uuid, never a fabricated name.
//   - the status banner is a thin honest line keyed on the real `status` — the
//     mock's precise "tier 2 of 3 · waited 1h 24m" tier-step/elapsed have no
//     wire and are omitted (not fabricated).
//   - the approve caption amount is the SERVER value, shown verbatim.
import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import '../pr_action/approve_screen.dart';
import '../pr_action/reject_screen.dart';
import 'pr_detail_agg.dart';
import 'pr_detail_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// Router entry for a PR detail push: resolves the shared services from [AppScope],
/// loads the screen's i18n sidecar, then renders [PrDetailScreen]. Constructed at
/// the inbox's push site with a REAL [prId] (the seam) — never mounted with a null.
class PrDetailScreenHost extends StatefulWidget {
  const PrDetailScreenHost({super.key, required this.prId, this.docNo});

  /// The PR to show + act on (path id for the approve/reject sheets).
  final String prId;

  /// The PR number the inbox row already knew — shown in the header while the
  /// detail loads (it is the same REAL `no` the wire returns).
  final String? docNo;

  @override
  State<PrDetailScreenHost> createState() => _PrDetailScreenHostState();
}

class _PrDetailScreenHostState extends State<PrDetailScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('pr_detail');
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
          return PrDetailScreen(
            repo: DioPrDetailRepository(services.dio),
            strings: strings,
            i18n: services.i18n,
            prId: widget.prId,
            docNo: widget.docNo,
          );
        },
      ),
    );
  }
}

/// The PR detail view. Dependencies are injected so the screen is driven directly
/// in tests (a fake repo + inline strings/i18n), never via the network.
class PrDetailScreen extends StatefulWidget {
  const PrDetailScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    required this.prId,
    this.docNo,
  });

  final PrDetailRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String prId;
  final String? docNo;

  @override
  State<PrDetailScreen> createState() => _PrDetailScreenState();
}

class _PrDetailScreenState extends State<PrDetailScreen> {
  late final Future<PrDetailView?> _future = _load();
  PrDetailView? _detail;

  Future<PrDetailView?> _load() async {
    // Fetch the PR + the project catalogue concurrently (the project_id → name
    // join, mirroring the merged web pr.form). listProjects is best-effort (→ []
    // on failure), so a projects hiccup only em-dashes the name — it never fails
    // the PR read.
    final Future<PrDetailEnt?> prFuture = widget.repo.getPr(widget.prId);
    final Future<List<PrDetailEnt>> projFuture = widget.repo.listProjects();
    final PrDetailEnt? prEnt = await prFuture;
    final List<PrDetailEnt> projects = await projFuture;
    final PrDetailView? detail = parsePrDetailView(
      prEnt,
      projectNames: buildProjectNames(projects),
    );
    // setState (not a bare assign): the sticky bar + the header title are siblings
    // of the FutureBuilder, so they must rebuild once the PR resolves.
    if (mounted) setState(() => _detail = detail);
    return detail;
  }

  String _tp(String field) => widget.i18n.tp(widget.strings[field]);
  String _baht() => widget.i18n.t('subcon.unitBaht');

  void _openApprove() {
    final PrDetailView? detail = _detail;
    if (detail == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => ApproveScreenHost(prId: detail.id),
      ),
    );
  }

  void _openReject() {
    final PrDetailView? detail = _detail;
    if (detail == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => RejectScreenHost(prId: detail.id),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // The header shows the REAL no once loaded, falling back to the number the
    // inbox row already knew while the detail loads (same REAL value).
    final String title = _detail?.no ?? widget.docNo ?? _dash;
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(sub: _tp('sub'), title: title, leading: _backButton()),
          Expanded(
            child: FutureBuilder<PrDetailView?>(
              future: _future,
              builder:
                  (BuildContext context, AsyncSnapshot<PrDetailView?> snap) {
                    if (snap.connectionState == ConnectionState.waiting) {
                      return _loading();
                    }
                    final PrDetailView? detail = snap.data;
                    if (detail == null) return _empty();
                    return _body(detail);
                  },
            ),
          ),
          if (_detail != null) _actionBar(_detail!),
        ],
      ),
    );
  }

  /// A 34px round back button (mobile.jsx L185 — surface-3 circle + chevL).
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

  Widget _body(PrDetailView detail) {
    return ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 24),
      children: <Widget>[
        _statusBanner(detail),
        _partiesCard(detail),
        _amountCard(detail),
        _itemsCard(detail),
      ],
    );
  }

  /// A thin honest status banner keyed on the real `status` (mobile.jsx L191-205).
  /// For pending it shows the awaiting-you status clause ONLY — no tier number and no
  /// elapsed: PR approval is single-shot in the backend (a pending PR is always
  /// approval_step 0), so the prototype's "tier N of M" is a mock and is not shown.
  /// An unknown status omits the banner.
  Widget _statusBanner(PrDetailView detail) {
    final (Color fg, Color soft, IconData icon)? tone = switch (detail.status) {
      PrStatus.pending => (
        JuneflowTokens.statusWarnFg,
        JuneflowTokens.statusWarnSoft,
        Icons.schedule,
      ),
      PrStatus.approved => (
        JuneflowTokens.statusOkFg,
        JuneflowTokens.statusOkSoft,
        Icons.check,
      ),
      PrStatus.rejected => (
        JuneflowTokens.statusDangerFg,
        JuneflowTokens.statusDangerSoft,
        Icons.close,
      ),
      PrStatus.draft => (
        JuneflowTokens.statusDraftFg,
        JuneflowTokens.statusDraftSoft,
        Icons.edit_note,
      ),
      PrStatus.unknown => null,
    };
    if (tone == null) return const SizedBox.shrink();
    final (Color fg, Color soft, IconData icon) = tone;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
            child: Icon(icon, size: 16, color: JuneflowTokens.shellTextStrong),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _statusText(detail),
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The banner text: pending → the awaitingYou status clause only (no tier number);
  /// otherwise the plain status phrase.
  String _statusText(PrDetailView detail) {
    switch (detail.status) {
      case PrStatus.pending:
        return awaitingYouLead(
          widget.i18n.t('mob.approval.detail.awaitingYou'),
        );
      case PrStatus.approved:
        return _tp('statusApproved');
      case PrStatus.rejected:
        return _tp('statusRejected');
      case PrStatus.draft:
        return _tp('statusDraft');
      case PrStatus.unknown:
        return _tp('statusPending'); // unreachable — banner omitted for unknown
    }
  }

  /// The parties card (mobile.jsx L208-236): the material title heading (REAL,
  /// falling back to the PR no only when title is null) over the 2×2 grid of the
  /// REAL requester / project(·phase) / need-date / vendor. Project name is the
  /// GET /projects join (em-dash when unresolved); need-date is the real need_date.
  Widget _partiesCard(PrDetailView detail) {
    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            detail.title ?? detail.no ?? _dash,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(
              height: 1,
              thickness: 1,
              color: JuneflowTokens.surfaceBorder,
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(child: _field(_tp('requesterLabel'), detail.requester)),
              const SizedBox(width: 12),
              Expanded(
                child: _field(
                  _tp('projectLabel'),
                  projectLine(detail.project, detail.phase),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(child: _field(_tp('needDateLabel'), detail.needDate)),
              const SizedBox(width: 12),
              Expanded(child: _field(_tp('vendorLabel'), detail.vendor)),
            ],
          ),
        ],
      ),
    );
  }

  /// One label/value field cell (mobile.jsx L216-234). A null value em-dashes.
  Widget _field(String label, String? value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            fontSize: 10.5,
            color: JuneflowTokens.textTertiary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          (value == null || value.isEmpty) ? _dash : value,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: JuneflowTokens.textPrimary,
          ),
        ),
      ],
    );
  }

  /// The net-total card (mobile.jsx L239-245): the netTotal label, the SERVER
  /// amount (verbatim) + baht, and the REAL line count. The mock's your-limit card +
  /// BOQ budget bar are honest-omitted (no wire).
  Widget _amountCard(PrDetailView detail) {
    final String amount = '${formatMoney(detail.amount)} ${_baht()}';
    final String lineCount = lineCountText(
      widget.i18n.t('mob.approval.detail.lineCountVat'),
      detail.itemCount,
    );
    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            widget.i18n.t('mob.approval.detail.netTotal'),
            style: const TextStyle(
              fontSize: 11,
              color: JuneflowTokens.textTertiary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            amount,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.brandPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            lineCount,
            style: const TextStyle(
              fontSize: 10.5,
              color: JuneflowTokens.textTertiary,
            ),
          ),
        ],
      ),
    );
  }

  /// The material-lines card (mobile.jsx L273-296): the section label + REAL count
  /// and an inert "see all", then the real lines. Each line's material NAME has no
  /// wire (only boq_item_id) → an honest em-dash; qty + amount are REAL.
  Widget _itemsCard(PrDetailView detail) {
    return MSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Text.rich(
                TextSpan(
                  text: _tp('materialsLabel'),
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: JuneflowTokens.textPrimary,
                  ),
                  children: <InlineSpan>[
                    TextSpan(
                      text: ' · ${detail.itemCount}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w500,
                        color: JuneflowTokens.textTertiary,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Text(
                _tp('viewAll'),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: JuneflowTokens.brandPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          for (int i = 0; i < detail.items.length; i++)
            _itemRow(detail.items[i], first: i == 0),
        ],
      ),
    );
  }

  Widget _itemRow(PrLineView line, {required bool first}) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: first
            ? null
            : const Border(
                top: BorderSide(color: JuneflowTokens.surfaceBorder),
              ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  (line.name == null || line.name!.isEmpty)
                      ? _dash
                      : line.name!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: JuneflowTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  formatQty(line.qty),
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: JuneflowTokens.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            formatMoney(line.amount),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: JuneflowTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  /// The sticky action bar (mobile.jsx L356-382): a danger reject-icon button and a
  /// flex ok approve button whose caption is the approve-with-amount dict (SERVER amount,
  /// verbatim). The mock's inert edit button is omitted (a no-op affordance would be
  /// a fake mechanic). Both actions push the EXISTING approve/reject sheets with the
  /// real prId — authority = SERVER (path-id only; no client tier/decision here).
  Widget _actionBar(PrDetailView detail) {
    final String approveCaption = widget.i18n.tf(
      'mob.approval.detail.approveWithAmount',
      <String, Object?>{'amount': formatMoney(detail.amount)},
    );
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          GestureDetector(
            onTap: _openReject,
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: 44,
              height: 44,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: JuneflowTokens.statusDangerSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.close,
                size: 18,
                color: JuneflowTokens.statusDangerFg,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: GestureDetector(
              onTap: _openApprove,
              behavior: HitTestBehavior.opaque,
              child: Container(
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: JuneflowTokens.statusOkFg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    const Icon(
                      Icons.check,
                      size: 18,
                      color: JuneflowTokens.shellTextStrong,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        approveCaption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: JuneflowTokens.shellTextStrong,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _loading() {
    return const Center(
      child: SizedBox(
        width: 22,
        height: 22,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: JuneflowTokens.textTertiary,
        ),
      ),
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
