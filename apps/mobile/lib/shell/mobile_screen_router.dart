// MobileScreenRouter — maps a route id to its screen widget (MOB-SHELL-00).
//
// Structural equivalent of pototype/mobile-preview.jsx:109-145: a route id in,
// the matching screen out. A BUILT screen (registered in [mobileScreenBuilders])
// renders itself; every other KNOWN route (kMobileRoutes) renders an honest
// [ScreenPlaceholder]; an UNKNOWN id also renders a placeholder rather than
// crashing. Each screen port adds one builder here and its id to kBuiltRouteIds.
import 'package:flutter/widgets.dart';

import '../screens/approvals_inbox/approvals_inbox_screen.dart';
import '../screens/field_pr/field_pr_screen.dart';
import '../screens/field_progress/field_progress_screen.dart';
import '../screens/fm_accept/fm_accept_screen.dart';
import '../screens/notif/notif_screen.dart';
import '../screens/pm_checkin/pm_checkin_screen.dart';
import '../screens/pm_checklist/pm_checklist_screen.dart';
import '../screens/pm_jobs/pm_jobs_screen.dart';
import '../screens/pm_notes/pm_notes_screen.dart';
import '../screens/pr_action/approve_screen.dart';
import '../screens/pr_action/reject_screen.dart';
import '../screens/sales_crm/sales_crm_screen.dart';
import '../screens/st_grlist/st_grlist_screen.dart';
import 'mobile_routes.dart';
import 'screen_placeholder.dart';

/// Builds the `inbox` screen (the caller's pending-approvals list). Its host
/// resolves services + the i18n sidecar from [AppScope]. A read-only list whose PR
/// rows push the PR detail (the approval seam). A top-level tearoff so
/// [mobileScreenBuilders] stays const.
Widget _buildInbox(BuildContext context) => const ApprovalsInboxScreenHost();

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

/// Builders for the routes that have a real ported screen. A screen port adds
/// `'<id>': _buildX` here (a const-tearoff) and its id to [kBuiltRouteIds].
const Map<String, WidgetBuilder> mobileScreenBuilders = <String, WidgetBuilder>{
  'inbox': _buildInbox,
  'notif': _buildNotif,
  'pm-jobs': _buildPmJobs,
  'pm-checkin': _buildPmCheckin,
  'pm-checklist': _buildPmChecklist,
  'pm-notes': _buildPmNotes,
  'approve': _buildApprove,
  'reject': _buildReject,
  'sales-crm': _buildSalesCrm,
  'st-grlist': _buildStGrList,
  'fm-accept': _buildFmAccept,
  'field-progress': _buildFieldProgress,
  'field-pr': _buildFieldPr,
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
