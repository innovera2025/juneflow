// FieldStockScreen — the mobile on-site material-issue screen, ported from
// pototype/mobile-screens.jsx MFieldStock (L484-528). Route `field-stock`
// (mobile_routes.dart; MobileSection.field).
//
// money = NONE on screen and money = SERVER on the write. The prototype's CTA
// carries a total ("confirm-issue - 18,000 baht", L523) and this screen's CTA does not.
// That is the single biggest deviation in the port and the reasoning is set out in
// full in field_stock_agg.dart "THE 18,000 BAHT": the number is a mock literal, no
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
// assumed. Reported for a ruling in BLOCKERS.md B-339 (which REPLACES the id `B-328`
// this file used to cite — `B-328` was never allocated and no such row exists, so
// every claim below was filed nowhere at all until this round).
//   1. THE CTA's TOTAL (L523 "- 18,000 baht") — see the agg header. The button states
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
//   5. THE USED-WITH VALUE's WO · PERIOD · SCOPE (L516-517) — `material_issue` is
//      {id, company_id, no, project_id, from_warehouse_id, value, currency_code,
//      issue_date, by_user_id, status, idempotency_key, created_at, updated_at}
//      (packages/db/src/schema/extensions.ts L176-206). There is NO wo_id, NO
//      period and NO purpose column, so none of the three could be stored even if
//      entered. The slot degrades to the PROJECT, which is the one attribution the
//      document really has — and which the merged web register prints in that very
//      column (apps/web/src/screens/inventory/inventory-issue.tsx L77).
//   6. THE SECTION-TITLE COUNT (L497, a parenthesised item count) — the count itself would be
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
//     in the agg / B-339 item 1), so this is the common path, not the rare one.
//
// A CONFIRMED issue EMPTIES THE BASKET and re-arms the CTA. It does NOT pop, and
// the difference from st_receive is structural, not stylistic: st-receive is PUSHED
// from st-grlist with a poId, so it has a caller to pop back to. `field-stock` has
// no pusher anywhere — mobile_shell.dart renders MobileScreenRouter as the TAB BODY,
// so this route is always `isFirst` and `Navigator.maybePop` would bubble past it
// and do nothing at all, leaving the storekeeper on an unchanged screen. So the
// principle st-receive states — the state change IS the confirmation, and no
// unbacked success copy is asserted — is honoured HERE by the one state change this
// screen can actually make: the staged quantities go back to 0 and the CTA greys
// out. That costs no key, and it re-arms the screen for the NEXT issue in the same
// mount, which is the normal case for a storekeeper working a tab.
//
// And because it re-arms in the same mount, the SHELF must re-arm with it: the
// `on_hand` figures on screen are the PRE-ISSUE balances the moment the issue
// commits, and they are the numbers that decide how much may be taken next. Leaving
// them is worse than the emptied basket, because an emptied basket reads as "done"
// while a stale balance reads as a FACT that is now false. [_resolve] re-runs
// [_load] on `confirmed`. That costs no key either.
//
// THE INVARIANT that makes all of the above safe: `_opId != null` means a live op
// owns the basket, and the basket is FROZEN while it does — because a queued op is
// replayed VERBATIM from its stored payload, so an edit made after the enqueue would
// be displayed but never sent. Both TERMINAL outcomes clear it: `confirmed` (the op
// is done) and `failed` (nothing was written and the next tap mints a fresh key), so
// after either the basket is editable again and the CTA works.
//
// ---------------------------------------------------------------------------
// WHY THAT INVARIANT NEEDED THE QUEUE, NOT JUST STATE (B-330)
// ---------------------------------------------------------------------------
// `_opId` lives in per-mount State, and State is NOT durable while the QUEUE is. On
// this screen the gap is not the rare app-kill it is elsewhere: mobile_shell.dart
// renders `MobileScreenRouter(route: _route)` as the tab body — SWAPPED, not an
// IndexedStack — so leaving the tab and coming back DESTROYS this State. The
// invariant above was therefore false across a remount in the ordinary way a
// storekeeper uses a tab bar:
//
//   submit -> deferred -> the queued chip shows -> switch tabs and back -> the chip
//   is gone, the basket is editable and `_opId` is null while op #1 is STILL pending
//   -> re-stage -> a SECOND op under a DIFFERENT key -> both post -> a double stock
//   cut and a double JV.
//
// B-312's partial unique index cannot catch that: the two keys differ, so they are
// legitimately two issues. The duplicate has to die on the client, by not minting
// the second key. So a null `_opId` is never trusted on its own — the QUEUE is
// asked, at the two points that matter:
//
//   1. ON MOUNT ([_resumeQueued]) — this is what makes the returning screen SHOW
//      that an issue is outstanding, and re-freeze the basket behind it.
//   2. IMMEDIATELY BEFORE MINTING A KEY ([_onConfirm]) — this is what makes it SAFE.
//      The on-mount drain is one real HTTP round trip (Dio sets no connectTimeout)
//      and the CTA is live throughout it, so (1) alone still leaves a window in
//      which a tap mints a second key on a perfectly healthy network. The pre-mint
//      check closes it, and it is paired with a SYNCHRONOUS busy flip taken BEFORE
//      the queue read — without that flip two taps in one frame both read the queue
//      before either enqueues, both find nothing, and both mint.
//
// Ownership is `from_warehouse_id` — see fieldStockOpIdentity for why the project id
// must NOT join it, and why the endpoint alone must not be it either.
import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../app/app_services.dart';
import '../../i18n/i18n.dart';
import '../../offline/pending_op_adoption.dart';
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

  /// The attribution the LOAD defaulted to, captured before an adopted op's charged
  /// project replaces it, so [_reconcile] can put it back when that op resolves
  /// (B-341). Meaningless while nothing is adopted.
  String? _defaultProjectId;
  String? _defaultProjectName;

  FieldStockState _state = FieldStockState.idle;

  /// The stable client idempotency key of the CURRENT attempt. Generated on the
  /// first submit and REUSED on every retry of an UNKNOWN outcome, so a re-tap can
  /// never post a second issue.
  ///
  /// Non-null == A LIVE OP OWNS THE BASKET. Cleared by [_resolve] on BOTH terminal
  /// outcomes — `confirmed` (the op is done, and the basket is emptied with it) and
  /// `failed` (a permanent 4xx wrote nothing, and the dead-letter is never replayed,
  /// so the retry must be a FRESH op with a FRESH key). Leaving it set after
  /// `confirmed` is what made every later tap in the same mount a no-op drain of an
  /// empty queue — a button that silently did nothing for the rest of the mount.
  ///
  /// A NULL DOES NOT MEAN "nothing of mine is queued" (B-330). It means only "this
  /// State is not tracking one", and this State dies every time the storekeeper
  /// leaves the tab (the shell SWAPS the tab body) while the queue does not. So the
  /// queue is asked directly in [_resumeQueued] and again in [_onConfirm] — see the
  /// file header.
  String? _opId;

  /// True while a live op owns the basket ([submitting] / [queued]).
  ///
  /// The queue replays `op.payload` VERBATIM, so what is on screen must not diverge
  /// from what will be sent: the steppers and the project picker are frozen here
  /// rather than accepting an edit that is displayed and then never posted. Not
  /// re-enqueued on edit either — that would mint a SECOND write of the same
  /// material. Both terminal outcomes clear [_opId], so a failed issue is fully
  /// editable again (the negative-stock 409 is a 4xx, and reducing the quantity is
  /// its only recovery).
  bool get _locked => _opId != null;

  /// True until this mount's QUEUE READ has answered "is an issue of mine still
  /// outstanding for this warehouse?" — the window the confirm CTA is quiet for
  /// (B-341).
  ///
  /// Raised at construction, so the very FIRST frame already renders the quiet CTA: a
  /// frame painted before the read starts would be the same hole one paint earlier.
  /// Lowered in a `finally`, so a queue read that throws opens the button rather than
  /// parking it forever. The contract, and why the window is bounded, is in
  /// offline/pending_op_adoption.dart.
  bool _settling = true;

  @override
  void initState() {
    super.initState();
    _future = _load();
    unawaited(_resumeQueued());
  }

  /// The (a) on-mount drain, plus the rehydration that makes [_opId] survive the tab
  /// swap that destroys this State (B-330).
  ///
  /// THE ORDERING IS THE POINT, and it is not st-receive's:
  ///
  ///   * the DRAIN is started IMMEDIATELY, exactly as before, so a queue left over
  ///     from a prior session begins flushing without waiting on this screen's read
  ///     chain;
  ///   * the LOAD is awaited before adopting, because unlike the four widget-parameter
  ///     screens this one's identity is NOT a parameter: the warehouse is resolved BY
  ///     the load (a bare tab route follows the register's newest), so there is nothing
  ///     to match against until it lands. It costs the CTA nothing to wait on it —
  ///     `_canSubmit` is false over an unloaded shelf, so the button was already inert
  ///     for exactly that stretch, and B-341 only makes the refusal visible;
  ///   * the QUEUE READ then answers, and THAT is what the CTA waits on (B-341);
  ///   * the DRAIN is awaited LAST. It used to be awaited before the adoption, which
  ///     put an unbounded HTTP round trip (Dio sets no `connectTimeout`) inside the
  ///     window; a drain can only shrink what is adoptable, so nothing is missed by
  ///     reading before it (offline/pending_op_adoption.dart), and [_reconcile] takes
  ///     the card down afterwards if the drain resolved the very op it described.
  Future<void> _resumeQueued() async {
    // Handled at construction, so a drain that throws can never surface as an
    // unhandled async error from this unawaited future — and cannot abandon the
    // adoption below either.
    final Future<void> drained = widget.repo.drain().then<void>(
      (DrainReport _) {},
      onError: (Object _) {},
    );
    final String? adopted = await _settleQueue();
    await drained;
    if (adopted != null) await _reconcile(adopted);
  }

  /// The queue read the CTA waits on. Returns the adopted op id, or null.
  Future<String?> _settleQueue() async {
    try {
      try {
        await _future;
      } catch (_) {
        return null; // the read chain failed: there is no warehouse to match against
      }
      if (!mounted) return null;
      // The project the load defaulted to, kept so [_reconcile] can put it back if
      // the drain resolves the op whose charged project replaces it below. Read
      // AFTER the load, which is the only thing that ever sets it: reading it before
      // captures the null this State starts with, and the "restore" then blanks the
      // slot to an em-dash instead of returning it to the default.
      final String? defaultProjectId = _projectId;
      final String? defaultProjectName = _projectName;
      final String? warehouseId = _warehouseId;
      if (warehouseId == null) return null;
      final SyncOperation? mine = findAdoptableOp(
        await widget.repo.due(),
        fieldStockOpIdentity(warehouseId),
      );
      if (mine == null || !mounted) return null;
      _defaultProjectId = defaultProjectId;
      _defaultProjectName = defaultProjectName;
      setState(() {
        _opId = mine.id;
        // Only a still-replayable op is adoptable (findAdoptableOp), and that is
        // precisely what `queued` means: captured, not confirmed.
        _state = FieldStockState.queued;
        // The picker is about to be FROZEN behind this op, so it must show what the op
        // actually charges rather than the primary project the fresh load just
        // defaulted to. The anchor deliberately excludes `project_id` (see
        // fieldStockOpIdentity), so the adopted op may legitimately carry a project the
        // storekeeper picked in the previous mount; displaying the default instead
        // would be an affirmative false statement about an outstanding write.
        //
        // THE MISS BRANCH IS THE SAME RULE, NOT AN EXCEPTION TO IT. When the charged id
        // does not resolve against the loaded projects — it was archived, or it fell off
        // GET /projects' first page (the read sends no pagination params) — the id is
        // still adopted and only the NAME is left null, so the slot renders the em-dash
        // that `MInput(value: _projectName ?? _dash)` already provides. Leaving the
        // default in place instead would put a DIFFERENT real project's name on an
        // outstanding write the user cannot edit, which is the affirmative false
        // statement this block exists to prevent — an em-dash is honest, the default is
        // not, and the two are not alike merely because neither is invented.
        final Object? charged = mine.payload['project_id'];
        if (charged is String) {
          _projectId = charged;
          _projectName = null;
          for (final FieldStockEnt p in _projects) {
            if (fieldStockStr(p, const <String>['id']) == charged) {
              _projectName = fieldStockStr(p, const <String>['name']);
              break;
            }
          }
        }
      });
      return mine.id;
    } catch (_) {
      // A queue read that FAILED has answered nothing, and a CTA left quiet on an
      // unanswerable question is the dead end B-341 forbids. The button opens; the
      // mint site asks the same queue again before it mints, so nothing is duplicated
      // on the strength of this failure.
      return null;
    } finally {
      if (mounted) setState(() => _settling = false);
    }
  }

  /// Unfreeze the basket once the drain has resolved the issue that owned it — the
  /// display cost of adopting before the drain, paid back one round trip later on
  /// exactly the state the old drain-first ordering reached. Skipped once the
  /// storekeeper has acted: their flow owns `_state` from that point.
  ///
  /// The charged project goes back to the load's default with it. While the op was
  /// live the picker HAD to show what that op charges (see [_settleQueue]); once it is
  /// resolved there is no outstanding write to describe, and leaving the previous
  /// issue's attribution in a now-editable slot would silently pre-address the NEXT
  /// basket to it.
  Future<void> _reconcile(String adopted) async {
    if (!_stillShowing(adopted)) return;
    final String? warehouseId = _warehouseId;
    if (warehouseId == null) return;
    final SyncOperation? still = findAdoptableOp(
      await widget.repo.due(),
      fieldStockOpIdentity(warehouseId),
    );
    // At most one op per identity is adoptable at a time (the B-330 invariant), so a
    // non-null answer is the same issue, still outstanding.
    if (still != null || !_stillShowing(adopted)) return;
    setState(() {
      _opId = null;
      _state = FieldStockState.idle;
      _projectId = _defaultProjectId;
      _projectName = _defaultProjectName;
    });
  }

  /// True while the screen is still showing exactly what [_settleQueue] adopted.
  bool _stillShowing(String adopted) =>
      mounted && _opId == adopted && _state == FieldStockState.queued;

  /// The real read chain: warehouses → the chosen warehouse → its stock balances,
  /// plus the tenant's projects for the attribution slot.
  ///
  /// A warehouse that does not resolve yields NO lines and NO stock read at all —
  /// the honest-empty state, never another warehouse's shelf.
  ///
  /// THE SUBJECT IS PINNED ONCE RESOLVED (`_warehouseId ?? widget.warehouseId`),
  /// and that is not a micro-optimisation — it is what makes `from_warehouse_id` a
  /// usable anchor at all. This method has TWO call sites: `initState` and the
  /// post-`confirmed` refresh in [_resolve]. On the bare tab route
  /// `widget.warehouseId` is null (mobile_screen_router.dart pushes
  /// `const FieldStockScreenHost()`, so this is 100% of production mounts), and
  /// re-resolving from null re-runs "follow the register's NEWEST warehouse" against
  /// a register that may have gained a row in the meantime. The screen would then
  /// silently RE-SUBJECT itself between two issues in one mount: the eyebrow, the
  /// shelf and `_warehouseId` all flip, and the storekeeper's next confirm posts
  /// `from_warehouse_id` = a warehouse he never stood in — a `stock_ledger` row at
  /// −qty against the wrong shelf plus a Dr 1140 / Cr 5020 JV, with no return or
  /// reverse op among the nine /inventory paths to undo it (DROPPED §4). Feeding the
  /// already-resolved id back in makes the re-read re-select the SAME warehouse (or
  /// honest-empty, if it has since left the tenant's page) instead of a new one.
  Future<_Loaded> _load() async {
    final List<FieldStockEnt> warehouses = await widget.repo.listWarehouses();
    final FieldStockEnt? warehouse = selectWarehouse(
      warehouses,
      warehouseId: _warehouseId ?? widget.warehouseId,
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
  ///
  /// The default is applied ONLY when nothing is selected yet. [_load] is re-run
  /// after a confirmed issue to refresh `on_hand`, and re-defaulting there would
  /// silently move the NEXT issue's attribution back to the primary project after
  /// the storekeeper had deliberately picked another one — a wrong project on a
  /// money write, made invisibly by a refresh.
  void _apply(_Loaded loaded) {
    if (!mounted) return;
    final FieldStockEnt? primary = selectProject(loaded.projects);
    setState(() {
      _lines = loaded.lines;
      _projects = loaded.projects;
      _warehouseId = loaded.warehouseId;
      _warehouseName = loaded.warehouseName;
      if (_projectId == null) {
        _projectId = primary == null
            ? null
            : fieldStockStr(primary, const <String>['id']);
        _projectName = primary == null
            ? null
            : fieldStockStr(primary, const <String>['name']);
      }
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

  /// The primary tap. With no live op it enqueues + drains; while an outcome is
  /// UNKNOWN (queued) it re-drains the SAME op — a manual retry, never a second
  /// enqueue. After either TERMINAL outcome [_opId] is already null, so the next tap
  /// starts a fresh op: after a 4xx because nothing was written under the old key
  /// and the dead-letter is never replayed, and after a confirmed issue because the
  /// storekeeper is staging the NEXT issue in the same mount.
  ///
  /// THE LIVE-OP BRANCH IS CHECKED FIRST, AND IT DELIBERATELY SKIPS THE BASKET GUARD.
  /// A re-drain sends the op's OWN stored payload and reads nothing off the screen,
  /// so it needs no staged quantity — and requiring one made the retry above a claim
  /// this method did not honour. The case is the ordinary one, not a corner: an op
  /// ADOPTED after a tab swap (B-330) arrives into a State whose basket is empty, so
  /// `_canSubmit` was false, the CTA was dead, and the storekeeper sat looking at
  /// `queued` over a zeroed frozen basket with no way to act. The CTA is enabled by
  /// [_locked] for exactly this branch ([_actionBar]).
  Future<void> _onConfirm() async {
    if (_state == FieldStockState.submitting) return;
    // The CTA is already rendered quiet for this window ([_actionBar]); this is the
    // same refusal at the handler, so a tap delivered against a stale frame cannot
    // slip past it either (B-341).
    if (_settling) return;

    final String? tracked = _opId;
    if (tracked != null) {
      // A live op already owns the basket: re-drain THAT op, never enqueue a second.
      // The flip is still SYNCHRONOUS (before the first await), so a double tap
      // cannot open two drains.
      setState(() => _state = FieldStockState.submitting);
      await _resolve(tracked, await widget.repo.drain());
      return;
    }

    final String? projectId = _projectId;
    final String? warehouseId = _warehouseId;
    final List<FieldStockPick> picks = _picks;
    if (projectId == null || warehouseId == null || picks.isEmpty) return;

    // Flipped SYNCHRONOUSLY, before the first await below, so the CTA is already
    // disabled when a second tap could otherwise arrive DURING the queue read. The
    // guard above and this flip are one mechanism: without the flip, two taps in the
    // same frame both reach the read, both see a queue that neither has written to
    // yet, and both mint — which is the window the pre-mint check was added to close,
    // reopened.
    setState(() => _state = FieldStockState.submitting);

    // About to MINT a key — so ask the QUEUE, which is the only thing that actually
    // knows, instead of trusting this State's null (B-330). Two ways that null lies:
    // the State is fresh because the shell swapped this tab out and back, or the
    // on-mount drain has simply not come back yet — one whole HTTP round trip during
    // which this CTA is live. Minting in either case produces a SECOND key, and
    // `material_issue_idempotency_uq` correctly admits two distinct keys as two
    // distinct issues: a second stock cut and a second JV.
    //
    // The re-drain below is a no-op while an outer drain is still running (the
    // processor's re-entrancy guard returns an empty report), which is exactly right:
    // that outer drain is already replaying this very op.
    final SyncOperation? already = findAdoptableOp(
      await widget.repo.due(),
      fieldStockOpIdentity(warehouseId),
    );
    if (!mounted) return;
    if (already != null) {
      setState(() => _opId = already.id);
      await _resolve(already.id, await widget.repo.drain());
      return;
    }

    final String opId = _opId = _newOpId();
    final DrainReport report = await widget.repo.submitIssue(
      projectId: projectId,
      warehouseId: warehouseId,
      picks: picks,
      opId: opId,
      now: DateTime.now(),
    );
    await _resolve(opId, report);
  }

  Future<void> _resolve(String opId, DrainReport report) async {
    final List<SyncOperation> due = await widget.repo.due();
    final FieldStockState next = resolveIssueState(opId, report, due);
    if (!mounted) return;
    setState(() {
      _state = next;
      // CONFIRMED: the server durably posted the issue — stock IS cut and the JV IS
      // posted. No success takeover is rendered (its copy has no key, and the
      // server's own `value`/`jv_no` are deliberately not disclosed — see the agg
      // header) and there is nothing to pop to (this route is the tab body, always
      // `isFirst`). CLEARING THE BASKET IS THE CONFIRMATION: the staged quantities
      // visibly go back to 0 and the CTA greys out, using no copy at all.
      if (next == FieldStockState.confirmed) {
        _quantities = const <String, double>{};
      }
      // Either TERMINAL outcome ends the live op, so the basket unfreezes and the
      // NEXT tap enqueues a fresh one. Without this the screen stayed permanently
      // armed to the finished op and every later tap drained an empty queue.
      if (next == FieldStockState.confirmed || next == FieldStockState.failed) {
        _opId = null;
      }
    });
    // CONFIRMED means the ledger really was cut, so every `on_hand` on screen is now
    // the PRE-ISSUE balance — a figure that actively contradicts the withdrawal the
    // storekeeper just made, and the one that decides how much may be taken next.
    // Stale stock is the real lever on a re-issue, more than the emptied basket is.
    // Re-read it. Unawaited because the confirmation above must not wait on a refresh,
    // and error-swallowed because a failed refresh is not a failed ISSUE: `_apply`
    // simply never runs and the rows keep their last known values rather than the
    // screen painting the issue itself as broken. Costs no i18n key.
    if (next == FieldStockState.confirmed) {
      unawaited(_load().then<void>((_Loaded _) {}, onError: (Object _) {}));
    }
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
          // Frozen while a live op owns the basket ([_locked]): `project_id` is
          // inside the enqueued payload, so re-picking here would show one project
          // and charge another project's WIP.
          child: GestureDetector(
            onTap: _projects.isEmpty || _locked ? null : _pickProject,
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
          // Both steppers freeze while a live op owns the basket ([_locked]) — the
          // queue replays the STORED payload, so an edit accepted here would be
          // shown and never sent (3 m³ displayed as 1, 3 m³ cut from the ledger).
          _stepButton(
            icon: Icons.remove,
            onTap: _locked
                ? null
                : () => _adjust(line.itemId, -kFieldStockStep),
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
            onTap: _locked ? null : () => _adjust(line.itemId, kFieldStockStep),
          ),
        ],
      ),
    );
  }

  /// One ± stepper. A null [onTap] is the FROZEN stepper, and it is muted with the
  /// same two tokens the disabled CTA already uses (surfaceMuted / textTertiary) so
  /// the freeze is VISIBLE — a live-looking button that does nothing is the very
  /// defect this round closed. It needs no copy of its own.
  Widget _stepButton({required IconData icon, required VoidCallback? onTap}) {
    final bool enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 30,
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: enabled
              ? JuneflowTokens.surfaceCard
              : JuneflowTokens.surfaceMuted,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: JuneflowTokens.surfaceBorder),
        ),
        child: Icon(
          icon,
          size: 16,
          color: enabled
              ? JuneflowTokens.textPrimary
              : JuneflowTokens.textTertiary,
        ),
      ),
    );
  }

  /// The sticky footer (L519-526). The prototype's two buttons become ONE: the
  /// return-material button is dropped (no endpoint — DROPPED §4), and the confirm
  /// CTA carries NO total (DROPPED §1).
  Widget _actionBar() {
    final _StatusTone? tone = _statusTone();
    // [_locked] enables the MANUAL RETRY of a live op, which posts nothing new and
    // reads nothing off the basket — it re-drains the op's own stored payload
    // ([_onConfirm]). Without that term the CTA is dead precisely when an op was
    // ADOPTED on mount (B-330): the fresh State has an empty basket, so `_canSubmit`
    // is false, and the screen shows `queued` over a zeroed frozen basket with no
    // affordance at all. It cannot enqueue a second issue — the live-op branch of
    // [_onConfirm] returns before any mint.
    // Quiet until this mount's queue read has answered (B-341) — greyed exactly as it
    // already greys over an unstaged basket, which needs no new copy. On this screen
    // that stretch was ALREADY dead (`_canSubmit` is false over the unloaded shelf the
    // read waits on); what changes is that a basket staged the instant the shelf lands
    // can no longer be confirmed against an unasked queue.
    final bool enabled =
        (_canSubmit || _locked) &&
        _state != FieldStockState.submitting &&
        !_settling;
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
                  // "THE 18,000 BAHT". `common.confirm` under-claims the prototype's
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

  /// The tone of the current honest status, or null when there is nothing to show:
  /// idle / submitting, and CONFIRMED — whose confirmation is the emptied basket and
  /// the greyed-out CTA, not a chip (no key exists for one, and the emptied basket
  /// is the state change itself).
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
  /// is empty. That is a backend gap, reported as B-339 item 1 (two writers only —
  /// transfer-approve, which is net zero, and this screen's own issue at −qty; `gr.ts`
  /// references the ledger zero times), not something this screen
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
