// MobileScreenRouter — maps a route id to its screen widget (MOB-SHELL-00).
//
// Structural equivalent of pototype/mobile-preview.jsx:109-145: a route id in,
// the matching screen out. A BUILT screen (registered in [mobileScreenBuilders])
// renders itself; every other KNOWN route (kMobileRoutes) renders an honest
// [ScreenPlaceholder]; an UNKNOWN id also renders a placeholder rather than
// crashing. Each screen port adds one builder here and its id to kBuiltRouteIds.
import 'package:flutter/widgets.dart';

import '../screens/approvals_inbox/approvals_inbox_screen.dart';
import '../screens/exec/exec_screen.dart';
import '../screens/field_checkin/field_checkin_screen.dart';
import '../screens/field_gr/field_gr_screen.dart';
import '../screens/fm_progress/fm_progress_screen.dart';
import '../screens/field_pr/field_pr_screen.dart';
import '../screens/field_progress/field_progress_screen.dart';
import '../screens/field_stock/field_stock_screen.dart';
import '../screens/fm_accept/fm_accept_screen.dart';
import '../screens/notif/notif_screen.dart';
import '../screens/pm_checkin/pm_checkin_screen.dart';
import '../screens/pm_close/pm_close_screen.dart';
import '../screens/pm_checklist/pm_checklist_screen.dart';
import '../screens/pm_jobs/pm_jobs_screen.dart';
import '../screens/pm_notes/pm_notes_screen.dart';
import '../screens/pr_action/approve_screen.dart';
import '../screens/pr_action/reject_screen.dart';
import '../screens/sales_crm/sales_crm_screen.dart';
import '../screens/service/srv_new_screen.dart';
import '../screens/service/srv_track_screen.dart';
import '../screens/service/tech_close_screen.dart';
import '../screens/service/tech_jobs_screen.dart';
import '../screens/st_grlist/st_grlist_screen.dart';
import '../screens/st_receive/st_receive_screen.dart';
import 'mobile_routes.dart';
import 'screen_placeholder.dart';

/// Builds the `inbox` screen (the caller's pending-approvals list). Its host
/// resolves services + the i18n sidecar from [AppScope]. A read-only list whose PR
/// rows push the PR detail (the approval seam). A top-level tearoff so
/// [mobileScreenBuilders] stays const.
Widget _buildInbox(BuildContext context) => const ApprovalsInboxScreenHost();

/// Builds the `field-checkin` screen (labour clock-in/out). Its host resolves
/// services + the i18n sidecar from [AppScope]. Both writes go through the shared
/// offline queue; which button is live is decided by the SERVER's attendance row,
/// re-read after every submit rather than flipped optimistically.
Widget _buildFieldCheckin(BuildContext context) => const FieldCheckinScreenHost();

/// Builds the `fm-progress` screen (a foreman reports each activity's percent
/// complete). Its host resolves services + the i18n sidecar from [AppScope]. Each
/// CHANGED line is one queued POST /timeline/tasks/{id}/progress; the screen re-reads
/// afterwards rather than flipping to "sent" optimistically.
Widget _buildFmProgress(BuildContext context) => const FmProgressScreenHost();

/// Builds the `notif` screen (its host resolves services + the i18n sidecar from
/// [AppScope]). A top-level tearoff so [mobileScreenBuilders] stays const.
Widget _buildNotif(BuildContext context) => const NotifScreenHost();

/// Builds the `pm-jobs` screen (the technician's active PM work-order list). Its
/// host resolves services + the i18n sidecar from [AppScope]. A read-only list.
Widget _buildPmJobs(BuildContext context) => const PmJobsScreenHost();

/// Builds the `pm-checkin` screen (the first offline-WRITE screen). Its host
/// resolves services + the i18n sidecar from [AppScope]; the shell has no
/// route-param mechanism, so a bare tab route mounts it with workOrderId=null → an
/// honest "no work order selected" state (the approve/reject precedent). pm-jobs
/// pushes it with a REAL work-order id via the Navigator.push seam.
Widget _buildPmCheckin(BuildContext context) => const PmCheckinScreenHost();

/// Builds the `pm-checklist` screen (the PM check results + photo slots). Same
/// nullable-id contract as pm-checkin: a bare tab route mounts it with
/// workOrderId=null → an honest "no work order selected" state, while pm-checkin
/// pushes it with the REAL work-order id once the check-in is confirmed.
Widget _buildPmChecklist(BuildContext context) => const PmChecklistScreenHost();

/// Builds the `pm-notes` screen (the maintenance log — cause / fix / advice). Same
/// nullable-id contract as pm-checkin / pm-checklist: a bare tab route mounts it with
/// workOrderId=null → an honest "no work order selected" state, while pm-checklist
/// pushes it with the REAL work-order id once the checklist save is confirmed.
Widget _buildPmNotes(BuildContext context) => const PmNotesScreenHost();

/// Builds the `pm-close` screen (the PM flow's last step — the job summary, the
/// signature pad and the close). Same nullable-id contract as the rest of the flow: a
/// bare tab route mounts it with workOrderId=null → an honest "no work order selected"
/// state, while pm-notes pushes it with the REAL work-order id once the maintenance
/// log is durably saved.
///
/// IT PERFORMS A WRITE — `POST /pm/workorders/{id}/close { signature }`, through the
/// offline queue like pm-checkin / pm-checklist / pm-notes. This comment claimed the
/// opposite until B-357/F4, and it was true when written: the close was withheld
/// because `customer_sign`'s ENCODING was undefined and no signature could be captured
/// (B-288). Wei ruled that encoding on 2026-08-07 (B-331: stroke JSON) and the CTA
/// went live. The correction matters beyond tidiness — this file is the write-path
/// inventory `test/app/offline_screen_wiring_test.dart` exists to enforce, and a
/// reader who believed "no write" would skip pm-close in exactly that audit.
Widget _buildPmClose(BuildContext context) => const PmCloseScreenHost();

/// Builds the `approve` / `reject` PR action sheets. Each host resolves services +
/// its i18n sidecar from [AppScope]; the shell has no route-param mechanism yet, so
/// prId is null → an honest "no PR selected" state (never a fabricated PR).
Widget _buildApprove(BuildContext context) => const ApproveScreenHost();
Widget _buildReject(BuildContext context) => const RejectScreenHost();

/// Builds the `sales-crm` pipeline read (its host resolves services + the i18n
/// sidecar from [AppScope]). Read-only: the leads come from GET /sales/leads.
Widget _buildSalesCrm(BuildContext context) => const SalesCrmScreenHost();

/// Builds the `st-grlist` store awaiting-PO-receipt list (its host resolves
/// services + the i18n sidecar from [AppScope]).
Widget _buildStGrList(BuildContext context) => const StGrListScreenHost();

/// Builds the `st-receive` count-and-receive screen (GET /po/{id} -> its PR's
/// lines; POST /gr through the offline queue). The shell has no route-param
/// mechanism, so a bare tab route mounts it with poId=null → an honest "no PO
/// selected" state; the real entry is the st-grlist push seam, which supplies a
/// REAL po id (plus the PO number + vendor name that row already resolved).
Widget _buildStReceive(BuildContext context) => const StReceiveScreenHost();

/// Builds the four after-sales SERVICE screens. Each host resolves services + its
/// i18n sidecar from [AppScope]. `srv-track` follows the register's newest ticket
/// when the shell mounts it without a selection; `tech-jobs` scopes the register to
/// the signed-in technician (GET /me) and pushes `tech-close` with a REAL ticket id;
/// `srv-new` raises a request; `tech-close` mounts honest-empty as a bare tab route
/// (the approve / reject / pm-checkin nullable-id precedent).
Widget _buildSrvTrack(BuildContext context) => const SrvTrackScreenHost();
Widget _buildTechJobs(BuildContext context) => const TechJobsScreenHost();
Widget _buildSrvNew(BuildContext context) => const SrvNewScreenHost();
Widget _buildTechClose(BuildContext context) => const TechCloseScreenHost();

/// Builds the `exec` executive dashboard (its host resolves services + the i18n
/// sidecar from [AppScope]). Read-only: the S-curve comes from
/// GET /boq/reports/evm and the approvals card from GET /dashboard/approvals-inbox
/// — the same payload the `inbox` screen reads, through the same repository.
Widget _buildExec(BuildContext context) => const ExecScreenHost();

/// Builds the `fm-accept` foreman acceptance queue (GET /acceptance-center — the
/// work-period feed plus the goods-receipt feed, the same two the prototype filters
/// to). Self-contained: the screen IS the queue, so it needs no pushed id.
Widget _buildFmAccept(BuildContext context) => const FmAcceptScreenHost();

/// Builds the `field-progress` work-period delivery screen. The shell has no
/// route-param mechanism, so a bare tab route mounts it with contractId=null → it
/// lists the tenant's REAL subcon contracts and loads the tapped one's periods; the
/// push seam still accepts a contract id directly. Nothing is pre-selected.
Widget _buildFieldProgress(BuildContext context) =>
    const FieldProgressScreenHost();

/// Builds the `field-pr` quick-PR-from-site screen (pick a BOQ → pick one of its
/// lines → POST /pr + /submit). ONLINE ONLY — see the screen header / B-295.
Widget _buildFieldPr(BuildContext context) => const FieldPrScreenHost();

/// Builds the `field-gr` goods-receipt REVIEW screen — the site's read of a
/// RECORDED receipt (GET /gr, whose rows carry the resolved vendor and the
/// gr_item lines), not a second count-and-receive form. It is the distinct
/// sibling of `st-receive`, which ENTERS counts against a PO; the evidence for
/// that split is in field_gr_agg.dart and the fork is raised as B-324. Its grId
/// is nullable like the rest of the pushed-subject screens: nothing lists GRs on
/// mobile today, so a bare tab route follows the register's newest RECEIVED
/// receipt (the srv-track precedent) and the push seam is ready for a future
/// list. It performs NO write — see field_gr_repository.dart.
Widget _buildFieldGr(BuildContext context) => const FieldGrScreenHost();

/// Builds the `field-stock` on-site material-issue screen (GET
/// /inventory/warehouses -> GET /inventory/stock for that warehouse, plus GET
/// /projects for the REQUIRED attribution; POST /inventory/issues through the
/// offline queue carrying a B-312 idempotency key). Its warehouseId is nullable
/// like the rest of the pushed-subject screens: nothing lists warehouses on mobile
/// today, so a bare tab route follows the newest (the srv-track precedent).
///
/// The prototype's CTA carries a money total and this one does NOT — no endpoint
/// prices a basket before it is posted, so the figure could only be computed on the
/// client, which is the B-316 defect on the button that posts the JV. See
/// field_stock_agg.dart "THE 18,000 BAHT". money = SERVER: the payload carries item
/// ids and quantities only.
Widget _buildFieldStock(BuildContext context) => const FieldStockScreenHost();

/// Builders for the routes that have a real ported screen. A screen port adds
/// `'<id>': _buildX` here (a const-tearoff) and its id to [kBuiltRouteIds].
const Map<String, WidgetBuilder> mobileScreenBuilders = <String, WidgetBuilder>{
  'inbox': _buildInbox,
  'notif': _buildNotif,
  'pm-jobs': _buildPmJobs,
  'pm-checkin': _buildPmCheckin,
  'pm-checklist': _buildPmChecklist,
  'pm-notes': _buildPmNotes,
  'pm-close': _buildPmClose,
  'approve': _buildApprove,
  'reject': _buildReject,
  'sales-crm': _buildSalesCrm,
  'st-grlist': _buildStGrList,
  'st-receive': _buildStReceive,
  'srv-track': _buildSrvTrack,
  'tech-jobs': _buildTechJobs,
  'srv-new': _buildSrvNew,
  'tech-close': _buildTechClose,
  'exec': _buildExec,
  'fm-accept': _buildFmAccept,
  'field-progress': _buildFieldProgress,
  'field-pr': _buildFieldPr,
  'field-gr': _buildFieldGr,
  'field-checkin': _buildFieldCheckin,
  'fm-progress': _buildFmProgress,
  'field-stock': _buildFieldStock,
};

/// Resolves [routeId] to its widget: the built screen if registered, otherwise an
/// honest placeholder. Pure lookup, usable without pumping a widget.
Widget resolveMobileScreen(BuildContext context, String routeId) {
  final WidgetBuilder? builder = mobileScreenBuilders[routeId];
  if (builder != null) return builder(context);
  return ScreenPlaceholder(routeId: routeId);
}

class MobileScreenRouter extends StatelessWidget {
  const MobileScreenRouter({super.key, required this.route});

  /// The route id to render.
  final String route;

  @override
  Widget build(BuildContext context) => resolveMobileScreen(context, route);
}
