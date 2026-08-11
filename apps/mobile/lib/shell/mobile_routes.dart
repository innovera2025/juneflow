// The mobile app's route table (MOB-SHELL-00).
//
// The 26 distinct screen ids come verbatim from MOBILE_GROUPS
// (pototype/mobile-preview.jsx:3-44) and are reconciled 1:1 with the
// MobileScreenRouter branches (mobile-preview.jsx:109-145) and
// apps/mobile/docs/screen-map.md §3. Each route also records which MTabBar
// SECTION it belongs to, matching the prototype's `<MTabBar active=.../>` usage
// (verified: pm-*/st-*/fm-*/field-* => field · srv-*/tech-* => service ·
// exec/sales-crm => exec · approval group => approve).
//
// A route id present here is a KNOWN route; whether a screen is BUILT yet is
// [kBuiltRouteIds]. The router renders a built screen, or an honest placeholder
// for the rest — no route is fabricated and none is dropped.
import 'mobile_sections.dart';

/// One entry of the route table: a screen id and the tab section it lives under.
class MobileRoute {
  const MobileRoute(this.id, this.section);

  /// Screen id (route key), e.g. `'inbox'`, `'pm-jobs'`.
  final String id;

  /// The MTabBar section this screen belongs to (drives the active tab).
  final MobileSection section;
}

/// All 26 known routes, in MOBILE_GROUPS order.
const List<MobileRoute> kMobileRoutes = <MobileRoute>[
  // approval group — mobile.jsx
  MobileRoute('inbox', MobileSection.approve),
  MobileRoute('detail', MobileSection.approve),
  MobileRoute('approve', MobileSection.approve),
  MobileRoute('reject', MobileSection.approve),
  MobileRoute('notif', MobileSection.approve),
  // A - after-sales / service group — mobile-screens.jsx
  MobileRoute('srv-new', MobileSection.service),
  MobileRoute('srv-track', MobileSection.service),
  MobileRoute('tech-jobs', MobileSection.service),
  MobileRoute('tech-close', MobileSection.service),
  // E - pm-eng group — mobile-pm.jsx
  MobileRoute('pm-jobs', MobileSection.field),
  MobileRoute('pm-checkin', MobileSection.field),
  MobileRoute('pm-checklist', MobileSection.field),
  MobileRoute('pm-notes', MobileSection.field),
  MobileRoute('pm-close', MobileSection.field),
  // F - store & foreman (storefm) — mobile-field.jsx
  MobileRoute('st-grlist', MobileSection.field),
  MobileRoute('st-receive', MobileSection.field),
  MobileRoute('fm-progress', MobileSection.field),
  MobileRoute('fm-accept', MobileSection.field),
  // B - on-site (field) group — mobile-screens.jsx
  MobileRoute('field-progress', MobileSection.field),
  MobileRoute('field-gr', MobileSection.field),
  MobileRoute('field-pr', MobileSection.field),
  MobileRoute('field-stock', MobileSection.field),
  // C - technician & safety group — mobile-screens.jsx
  MobileRoute('field-checkin', MobileSection.field),
  MobileRoute('field-hse', MobileSection.field),
  // D - executive & sales (exec) — mobile-screens.jsx
  MobileRoute('exec', MobileSection.exec),
  MobileRoute('sales-crm', MobileSection.exec),
];

/// Screen ids that have a real ported screen wired into the router. `notif` was
/// the first ported screen (feature/mobile-notif); `approve` + `reject` are the PR
/// action sheets (feature/mobile-approve-reject); `sales-crm` is the read-only Sales
/// CRM pipeline (feature/mobile-sales-crm, GET /sales/leads); `inbox` is the
/// approvals inbox (feature/mobile-inbox-detail, GET /dashboard/approvals-inbox) —
/// its PR rows push the PR detail (a PUSHED route, so `detail` has no builder here).
/// `pm-checkin` is the first offline-WRITE screen (feature/mobile-write-checkin): it
/// is a built tab route (honest-empty with no selection) that pm-jobs also pushes
/// with a real work-order id. `pm-checklist` continues that PM flow
/// (feature/mobile-pm-checklist): pm-checkin pushes it with the same work-order id
/// once the check-in is confirmed, and it too is honest-empty as a bare tab route.
/// `pm-notes` is the PM flow's third write screen (feature/mobile-pm-notes): the
/// maintenance log (cause / fix / advice), which pm-checklist pushes with the same
/// work-order id once the checklist save is confirmed, and which is honest-empty as a
/// bare tab route. `pm-close` completes that flow (feature/mobile-pm-close): the job
/// summary, the signature pad and the close, which pm-notes pushes with the same
/// work-order id once the log is saved, and which is honest-empty as a bare tab route.
/// It is the PM flow's FOURTH offline-write screen — `POST
/// /pm/workorders/{id}/close { signature }`. This paragraph said it performed no write
/// and shipped an honest-disabled CTA, which was true until B-331 (corrected under
/// B-357/F4): the close was withheld only because `customer_sign`'s ENCODING was
/// undefined and no signature could be captured (B-288). Wei ruled that encoding on
/// 2026-08-07 and the CTA went live. Every further screen port adds its id here and
/// its widget in [mobileScreenBuilders] (mobile_screen_router.dart).
///
///
/// The four after-sales SERVICE screens land together
/// (feature/mobile-service-group) over one endpoint family and one state machine:
/// `srv-track` (a resident's request + its 5-step timeline), `tech-jobs` (the
/// technician's own tickets + the schedule/start moves), `srv-new` (raise a request —
/// also the service tab's landing route) and `tech-close` (the close-out, which
/// tech-jobs pushes with a REAL ticket id and which is honest-empty as a bare tab
/// route).
/// `fm-accept`, `field-progress` and `field-pr` are the FOREMAN / FIELD group
/// (feature/mobile-field-group); each resolves its own subject from a real read, so
/// none needs a pushed id: fm-accept IS the queue (GET /acceptance-center),
/// field-progress lists the tenant's subcon contracts when no contract id is pushed
/// and loads the tapped one's periods, and field-pr picks a BOQ then one of its
/// lines.
/// `field-gr` is the site's REVIEW of a recorded goods receipt (GET /gr — the
/// vendor and the gr_item lines the wire already resolves). It is NOT a second
/// `st-receive`: that screen ENTERS counts against a PO, this one displays a
/// receipt that already exists, which is the only reading under which its own
/// partial line can be rendered at all (field_gr_agg.dart; fork raised as B-324).
/// Nothing lists GRs on mobile yet, so a bare tab route follows the register's
/// newest RECEIVED receipt (the srv-track precedent) and the nullable-id push
/// seam is ready for a future list. It performs NO write.
/// `field-stock` is the on-site MATERIAL ISSUE (GET /inventory/stock balances for a
/// warehouse -> POST /inventory/issues through the offline queue). It is the
/// heaviest write on mobile: one transaction cuts the stock ledger AND posts a
/// Dr 1140 / Cr 5020 JV, which is why it carries a B-312 idempotency key. Its
/// prototype CTA shows a money total and this screen's does NOT — no endpoint
/// prices a basket before it is posted, so the figure could only be computed on the
/// client (field_stock_agg.dart "THE 18,000 BAHT"). Like the rest of the
/// pushed-subject screens its warehouse id is nullable: nothing lists warehouses on
/// mobile today, so a bare tab route follows the newest.
const Set<String> kBuiltRouteIds = <String>{
  'inbox',
  'notif',
  'approve',
  'reject',
  'sales-crm',
  'st-grlist',
  'st-receive',
  'pm-jobs',
  'pm-checkin',
  'pm-checklist',
  'pm-notes',
  'pm-close',
  'srv-track',
  'tech-jobs',
  'srv-new',
  'tech-close',
  'exec',
  'fm-accept',
  'field-progress',
  'field-pr',
  'field-gr',
  'field-stock',
};

/// The set of all known route ids.
final Set<String> kMobileRouteIds = kMobileRoutes
    .map((MobileRoute r) => r.id)
    .toSet();

/// The MTabBar section a route lives under, or null for an unknown id.
MobileSection? sectionForRoute(String routeId) {
  for (final MobileRoute r in kMobileRoutes) {
    if (r.id == routeId) return r.section;
  }
  return null;
}
