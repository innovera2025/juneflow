// FieldStockScreen — the mobile on-site material-issue screen, ported from
// pototype/mobile-screens.jsx MFieldStock (L484-528). Route `field-stock`
// (mobile_routes.dart; MobileSection.field).
//
// money = NONE on screen and money = SERVER on the write. The prototype's CTA
// carries a total (`ยืนยันเบิก · 18,000 ฿`, L523) and this screen's CTA does not.
// That is the single biggest deviation in the port and the reasoning is set out in
// full in field_stock_agg.dart "THE 18,000 ฿": the number is a mock literal, no
// endpoint will price a basket before it is posted, and computing it here would be
// the B-316 A3 defect on the very button that posts a JV and cuts the stock ledger.
//
// §0 fidelity (rule 1): the CHROME is the prototype's — the header (eyebrow =
// warehouse, large title), a titled basket card with one row per material
// (name / code · stock line / [-] qty [+] stepper), a titled "used with" card, and
// the sticky bottom action bar. Every colour/space is a generated design token;
// every string is a key from the sidecar (no Thai byte in this file —
// .claude/hooks/i18n-guard.sh, §0 rule 2).
//
// Data (§0 rule 3): the three hardcoded rows are a mock and are DROPPED. Rows are
// the REAL GET /inventory/stock balances for the chosen warehouse.
//
// ---------------------------------------------------------------------------
// WITHHELD — no wire, so an em-dash (never a guess, never a 0)
// ---------------------------------------------------------------------------
//   * a material NAME, CODE or UNIT the wire did not carry — each em-dashes
//     INDEPENDENTLY, so a row with a name but no unit still shows its name.
//   * ON-HAND — em-dashed when absent, never rendered as 0. On a screen whose
//     purpose is deciding how much may be taken, "unknown" and "none left" are
//     different facts and must not be collapsed.
//   * the WAREHOUSE name (header eyebrow) and the PROJECT name, when either does
//     not resolve.
//
// ---------------------------------------------------------------------------
// DROPPED — the wire does not perform it, so the claim is not made at all
// ---------------------------------------------------------------------------
// Each verified by grep against the route file and the contract this round, not
// assumed. Reported for a ruling in BLOCKERS.md B-328.
//   1. THE CTA's TOTAL (L523 `· 18,000 ฿`) — see the agg header. The button states
//      the act with no figure.
//   2. THE QR / BARCODE SCAN trigger (L493), the whole dashed bar. `grep -i
//      'qr|barcode|scan'` over apps/api/src/routes/inventory.ts + openapi.yaml = 0
//      hits: there is no endpoint to resolve a scanned code to an item. AND
//      pubspec.yaml declares no camera/scanner package, so the device could not
//      read one either (adding one is a Wei-level stack decision — the
//      geolocator/B-260 precedent). Two independent blockers, so it is dropped
//      rather than disabled.
//   3. THE HEADER's ROUND ICON BUTTON (L488-490) — it is the scan affordance's
//      twin and has no other action, so it goes with (2) rather than sitting there
//      inert.
//   4. THE RETURN-MATERIAL button (L521) — there is no return/reverse op among the
//      NINE /inventory paths in the contract (contrast POST /gr/{id}/return, which
//      is real). Its label has no honest key either (see the sidecar's
//      _deviations), so shipping it disabled would spend a mint on a control that
//      cannot work. The footer becomes the single confirm CTA.
//   5. THE `ใช้กับ` VALUE's WO · PERIOD · SCOPE (L516-517) — `material_issue` is
//      {id, company_id, no, project_id, from_warehouse_id, value, currency_code,
//      issue_date, by_user_id, status, idempotency_key, created_at, updated_at}
//      (packages/db/src/schema/extensions.ts L176-206). There is NO wo_id, NO
//      period and NO purpose column, so none of the three could be stored even if
//      entered. The slot degrades to the PROJECT, which is the one attribution the
//      document really has — and which the merged web register prints in that very
//      column (apps/web/src/screens/inventory/inventory-issue.tsx L77).
//   6. THE SECTION-TITLE COUNT (L497 `(3 รายการ)`) — the count itself would be
//      honest (it is the real basket size), but its unit word has no key in any
//      layer, and a bare parenthesised number next to a section title is ambiguous
//      rather than informative. The title ships without it.
//
// ---------------------------------------------------------------------------
// OUTCOME — the honest lifecycle, and why the two retry branches differ
// ---------------------------------------------------------------------------
// The prototype's buttons have NO onClick at all, so there is no success state to
// port; these are what the real at-least-once write can be in. The write is
// offline-enrolled (field_stock_repository.dart), and the two failure branches are
// NOT the same failure:
//   * QUEUED (transport failure / 5xx) — the outcome is UNKNOWN: the issue may have
//     committed with the response lost. A retry MUST replay the SAME op, so the
//     server resolves it by the SAME idempotency key and returns the ORIGINAL issue
//     instead of posting a second JV and a second stock decrement. Never a new key.
//   * FAILED (4xx) — the outcome is KNOWN: the whole handler is one transaction, a
//     4xx is raised before or instead of a commit, so NOTHING was written. It is
//     also a permanent dead-letter that `drain()` explicitly skips and never
//     replays (sync_processor.dart L180-183), so re-draining the same op would be a
//     button that visibly does nothing. A retry therefore starts a FRESH op with a
//     FRESH key — which is safe precisely because nothing was posted under the old
//     one. This matters more here than on st-receive: the negative-stock 409 is a
//     4xx, and today it is the response EVERY issue gets (see the empty-ledger note
//     in the agg / B-328), so this is the common path, not the rare one.
// A confirmed issue pops back, as st-receive does: the state change IS the
// confirmation, and no unbacked success copy is asserted.
import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../offline/sync_operation.dart';
import '../../offline/sync_processor.dart';
import '../../theme/juneflow_theme.dart';
import '../../widgets/m_primitives.dart';
import '../../widgets/mobile_header.dart';
import 'field_stock_agg.dart';
import 'field_stock_repository.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String _dash = '—'; // em dash

/// The stepper's increment (the prototype's ± buttons, L509/L511).
const double kFieldStockStep = 1;

/// Router entry for `field-stock`: resolves the shared services from [AppScope],
/// loads the screen's i18n key sidecar, then renders [FieldStockScreen].
///
/// [warehouseId] is nullable like the rest of the pushed-subject screens: nothing
/// on mobile lists warehouses today, so a bare tab route follows the register's
/// newest warehouse (the srv-track / field-gr precedent) and the push seam is ready
/// for a future list.
class FieldStockScreenHost extends StatefulWidget {
  const FieldStockScreenHost({super.key, this.warehouseId});

  /// The warehouse to draw down. Null → follow the newest.
  final String? warehouseId;

  @override
  State<FieldStockScreenHost> createState() => _FieldStockScreenHostState();
}

class _FieldStockScreenHostState extends State<FieldStockScreenHost> {
  Future<ScreenStrings>? _stringsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _stringsFuture ??= ScreenStrings.load('field_stock');
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
          return FieldStockScreen(
            repo: DioFieldStockRepository(services.dio, services.syncProcessor),
            strings: strings,
            i18n: services.i18n,
            warehouseId: widget.warehouseId,
          );
        },
      ),
    );
  }
}

/// The material-issue view. Dependencies are injected so the screen is driven
/// directly in tests (a fake repo + inline strings/i18n), never via the network.
class FieldStockScreen extends StatefulWidget {
  const FieldStockScreen({
    super.key,
    required this.repo,
    required this.strings,
    required this.i18n,
    this.warehouseId,
  });

  final FieldStockRepository repo;
  final ScreenStrings strings;
  final JuneflowI18n i18n;
  final String? warehouseId;

  @override
  State<FieldStockScreen> createState() => _FieldStockScreenState();
}

/// Everything one load resolved — kept in one object so the view never renders a
/// half-loaded screen (a warehouse with someone else's stock rows).
class _Loaded {
  const _Loaded({
    required this.lines,
    this.warehouseId,
    this.warehouseName,
    this.projects = const <FieldStockEnt>[],
  });

  final List<FieldStockLine> lines;
  final String? warehouseId;
  final String? warehouseName;
  final List<FieldStockEnt> projects;
}

class _FieldStockScreenState extends State<FieldStockScreen> {
  late Future<_Loaded> _future;

  List<FieldStockLine> _lines = const <FieldStockLine>[];
  List<FieldStockEnt> _projects = const <FieldStockEnt>[];

  /// Staged quantities by real `item_id`. Keyed rather than index-aligned so a
  /// reload that reorders the shelf cannot silently move a quantity onto a
  /// different material.
  Map<String, double> _quantities = const <String, double>{};

  String? _warehouseId;
  String? _warehouseName;
  String? _projectId;
  String? _projectName;

  FieldStockState _state = FieldStockState.idle;

  /// The stable client idempotency key of the CURRENT attempt. Generated on the
  /// first submit and REUSED on every retry of an UNKNOWN outcome, so a re-tap can
  /// never post a second issue. Reset to null only after a permanent 4xx, where
  /// nothing was written — see the file header.
  String? _opId;

  @override
  void initState() {
    super.initState();
    _future = _load();
    // Flush anything a prior session left queued. It does not change this screen's
    // idle state; it just keeps the queue moving.
    unawaited(widget.repo.drain());
  }

  /// The real read chain: warehouses → the chosen warehouse → its stock balances,
  /// plus the tenant's projects for the attribution slot.
  ///
  /// A warehouse that does not resolve yields NO lines and NO stock read at all —
  /// the honest-empty state, never another warehouse's shelf.
  Future<_Loaded> _load() async {
    final List<FieldStockEnt> warehouses = await widget.repo.listWarehouses();
    final FieldStockEnt? warehouse = selectWarehouse(
      warehouses,
      warehouseId: widget.warehouseId,
    );
    final String? whId = warehouse == null
        ? null
        : fieldStockStr(warehouse, const <String>['id']);
    if (whId == null) {
      const _Loaded nothing = _Loaded(lines: <FieldStockLine>[]);
      _apply(nothing);
      return nothing;
    }
    final List<List<FieldStockEnt>> both = await Future.wait(
      <Future<List<FieldStockEnt>>>[
        widget.repo.listStock(whId),
        widget.repo.listProjects(),
      ],
    );
    final _Loaded loaded = _Loaded(
      lines: parseStockLines(both[0]),
      warehouseId: whId,
      warehouseName: fieldStockStr(warehouse!, const <String>['name']),
      projects: both[1],
    );
    _apply(loaded);
    return loaded;
  }

  /// Commit one resolved load to the view.
  ///
  /// The project defaults to [selectProject]'s primary (GET /projects entry order
  /// [0] — the app's own resolvePrimaryProject convention), so the required
  /// `project_id` is pre-filled with the tenant's primary project rather than
  /// leaving the CTA inert until the storekeeper discovers the picker. It stays
  /// re-pickable; nothing else is pre-selected.
  void _apply(_Loaded loaded) {
    if (!mounted) return;
    final FieldStockEnt? primary = selectProject(loaded.projects);
    setState(() {
      _lines = loaded.lines;
      _projects = loaded.projects;
      _warehouseId = loaded.warehouseId;
      _warehouseName = loaded.warehouseName;
      _projectId = primary == null
          ? null
          : fieldStockStr(primary, const <String>['id']);
      _projectName = primary == null
          ? null
          : fieldStockStr(primary, const <String>['name']);
    });
  }

  String _t(String field) => widget.i18n.t(widget.strings[field]);

  /// A fresh client idempotency key (uuid-free — no package). Time + a random
  /// component makes a collision between two of the device's own issues
  /// vanishingly unlikely.
  String _newOpId() =>
      'field-stock-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7FFFFFFF)}';

  void _adjust(String itemId, double delta) {
    setState(() {
      final Map<String, double> next = Map<String, double>.of(_quantities);
      next[itemId] = adjustPick(next[itemId] ?? 0, delta);
      _quantities = next;
    });
  }

  List<FieldStockPick> get _picks => picksFrom(_lines, _quantities);

  bool get _canSubmit => canSubmitIssue(
    projectId: _projectId,
    warehouseId: _warehouseId,
    picks: _picks,
  );

  /// The primary tap. With no live write it enqueues + drains; while an outcome is
  /// UNKNOWN (queued) it re-drains the SAME op — a manual retry, never a second
  /// enqueue. After a permanent 4xx it starts a fresh op, because nothing was
  /// written under the old key and the dead-letter is never replayed.
  Future<void> _onConfirm() async {
    if (_state == FieldStockState.submitting) return;
    final String? projectId = _projectId;
    final String? warehouseId = _warehouseId;
    final List<FieldStockPick> picks = _picks;
    if (projectId == null || warehouseId == null || picks.isEmpty) return;

    if (_state == FieldStockState.failed) _opId = null;
    final bool firstAttempt = _opId == null;
    final String opId = _opId ??= _newOpId();
    setState(() => _state = FieldStockState.submitting);
    final DrainReport report = firstAttempt
        ? await widget.repo.submitIssue(
            projectId: projectId,
            warehouseId: warehouseId,
            picks: picks,
            opId: opId,
            now: DateTime.now(),
          )
        : await widget.repo.drain();
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<SyncOperation> due = await widget.repo.due();
    final FieldStockState next = resolveIssueState(opId, report, due);
    if (!mounted) return;
    setState(() => _state = next);
    // CONFIRMED: the server durably posted the issue — stock IS cut and the JV IS
    // posted. No success takeover is rendered (its copy has no key, and the
    // server's own `value`/`jv_no` are deliberately not disclosed — see the agg
    // header); popping back IS the confirmation.
    if (next == FieldStockState.confirmed) Navigator.maybePop(context);
  }

  /// Choose the project this material is issued against. Real tenant projects, by
  /// name — a list of server-owned names needs no copy of its own.
  Future<void> _pickProject() async {
    if (_projects.isEmpty) return;
    final FieldStockEnt? chosen = await showModalBottomSheet<FieldStockEnt>(
      context: context,
      backgroundColor: JuneflowTokens.surfaceCard,
      builder: (BuildContext sheetContext) {
        return SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: <Widget>[
              for (final FieldStockEnt p in _projects)
                ListTile(
                  title: Text(
                    fieldStockStr(p, const <String>['name']) ?? _dash,
                    style: const TextStyle(
                      fontSize: 13,
                      color: JuneflowTokens.textPrimary,
                    ),
                  ),
                  onTap: () => Navigator.pop(sheetContext, p),
                ),
            ],
          ),
        );
      },
    );
    if (chosen == null || !mounted) return;
    setState(() {
      _projectId = fieldStockStr(chosen, const <String>['id']);
      _projectName = fieldStockStr(chosen, const <String>['name']);
    });
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: JuneflowTokens.surfaceBg,
      child: Column(
        children: <Widget>[
          MobileHeader(
            // Eyebrow (L487, the mock's warehouse name): the REAL resolved
            // `warehouse_name`. It is NOT the sacred file's phrases entry for that
            // same Thai string — that entry is a SEEDED WAREHOUSE NAME the
            // extractor scraped out of the mock, and keying it would freeze one
            // tenant's data into the UI (see the sidecar's _deviations).
            sub: _warehouseName ?? _dash,
            title: _t('title'),
          ),
          Expanded(
            child: FutureBuilder<_Loaded>(
              future: _future,
              builder: (BuildContext context, AsyncSnapshot<_Loaded> snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(
                    child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  );
                }
                if (_lines.isEmpty) return _empty();
                return _body();
              },
            ),
          ),
          if (_lines.isNotEmpty) _actionBar(),
        ],
      ),
    );
  }

  Widget _body() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(0, 10, 0, 16),
      children: <Widget>[
        MSection(
          title: _t('itemsTitle'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (int i = 0; i < _lines.length; i++) _row(_lines[i], i),
            ],
          ),
        ),
        // The attribution slot (L515-518). Degraded to the PROJECT — the only one
        // of the prototype's three attributes that has a column (see DROPPED §5).
        MSection(
          title: _t('usedFor'),
          child: GestureDetector(
            onTap: _projects.isEmpty ? null : _pickProject,
            behavior: HitTestBehavior.opaque,
            child: MInput(value: _projectName ?? _dash),
          ),
        ),
      ],
    );
  }

  /// One material row (L503-513): name, `code · stock N unit`, and the stepper.
  Widget _row(FieldStockLine line, int index) {
    final double qty = _quantities[line.itemId] ?? 0;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: index == 0
            ? null
            : const Border(
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
                  line.name ?? _dash,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: JuneflowTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                // `code · stock N unit` (L506). Each half em-dashes on its own:
                // an absent on-hand is UNKNOWN, and is never printed as 0.
                Text(
                  '${line.code ?? _dash} · ${_t('stockLabel')} '
                  '${line.onHand == null ? _dash : formatQty(line.onHand!)} '
                  '${line.unit ?? _dash}',
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: JuneflowTokens.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          _stepButton(
            icon: Icons.remove,
            onTap: () => _adjust(line.itemId, -kFieldStockStep),
          ),
          SizedBox(
            width: 44,
            child: Text(
              formatQty(qty),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.brandPrimary,
              ),
            ),
          ),
          _stepButton(
            icon: Icons.add,
            onTap: () => _adjust(line.itemId, kFieldStockStep),
          ),
        ],
      ),
    );
  }

  Widget _stepButton({required IconData icon, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 30,
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: JuneflowTokens.surfaceCard,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Icon(icon, size: 16, color: JuneflowTokens.textPrimary),
      ),
    );
  }

  /// The sticky footer (L519-526). The prototype's two buttons become ONE: the
  /// return-material button is dropped (no endpoint — DROPPED §4), and the confirm
  /// CTA carries NO total (DROPPED §1).
  Widget _actionBar() {
    final _StatusTone? tone = _statusTone();
    final bool enabled = _canSubmit && _state != FieldStockState.submitting;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (tone != null) ...<Widget>[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: tone.bg,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: <Widget>[
                  Icon(tone.icon, size: 15, color: tone.fg),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      tone.text,
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: tone.fg,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          GestureDetector(
            onTap: enabled ? _onConfirm : null,
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
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(
                    Icons.check,
                    size: 18,
                    color: enabled
                        ? JuneflowTokens.shellTextStrong
                        : JuneflowTokens.textTertiary,
                  ),
                  const SizedBox(width: 6),
                  // The CTA. NO total — see the file header and the agg's
                  // "THE 18,000 ฿". `common.confirm` under-claims the prototype's
                  // "confirm issue"; `inv.issueAdd.btnSubmit` ("save issue + cut
                  // stock") was refused because it asserts an outcome that is FALSE
                  // on the queued branch (sidecar _deviations).
                  Text(
                    _t('confirm'),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: enabled
                          ? JuneflowTokens.shellTextStrong
                          : JuneflowTokens.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The tone of the current honest status, or null when there is nothing to show
  /// (idle / submitting / confirmed — confirmed pops instead).
  _StatusTone? _statusTone() {
    switch (_state) {
      case FieldStockState.queued:
        return _StatusTone(
          fg: JuneflowTokens.statusWarnFg,
          bg: JuneflowTokens.statusWarnSoft,
          icon: Icons.sync,
          text: _t('queued'),
        );
      case FieldStockState.failed:
        return _StatusTone(
          fg: JuneflowTokens.statusDangerFg,
          bg: JuneflowTokens.statusDangerSoft,
          icon: Icons.error_outline,
          text: _t('failed'),
        );
      case FieldStockState.idle:
      case FieldStockState.submitting:
      case FieldStockState.confirmed:
        return null;
    }
  }

  /// Honest-empty — an em-dash, no borrowed copy (the pm_close / st_receive
  /// precedent). This is the state the screen is in on any real database TODAY:
  /// `stock_ledger` has no inbound writer anywhere in the system, so every balance
  /// is empty. That is a backend gap, reported as B-328, not something this screen
  /// may paper over with a fabricated row.
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

/// Colours + icon + text of one honest status variant.
class _StatusTone {
  const _StatusTone({
    required this.fg,
    required this.bg,
    required this.icon,
    required this.text,
  });

  final Color fg;
  final Color bg;
  final IconData icon;
  final String text;
}
