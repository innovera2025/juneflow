// The four navigable sections of the mobile app (MOB-SHELL-00).
//
// These mirror the four TAB destinations of the canonical 5-tab MTabBar
// (pototype/mobile-screens.jsx:3-26) that actually have screens behind them:
// approve / field / service / exec (the Dashboard tab). The fifth tab, `me`
// (profile), has NO destination screen anywhere in the prototype, so it is NOT a
// section here — it renders honest-DISABLED (BLOCKERS.md B-241, ruled option-a
// 2026-08-03). Deriving the active tab from the current route (mobile_routes.dart)
// uses this enum.
enum MobileSection {
  /// approve tab — the approval group (inbox/detail/approve/reject/notif).
  approve,

  /// field tab — on-site work: PM, store/foreman, field, and safety screens.
  field,

  /// service tab — after-sales / service (srv-*, tech-*).
  service,

  /// exec tab (Dashboard) — executive & sales (exec, sales-crm).
  exec,
}
