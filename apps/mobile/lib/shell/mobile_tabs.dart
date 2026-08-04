// The 5-tab MTabBar model + honest-disable (MOB-SHELL-00).
//
// The canonical bottom nav has exactly 5 tabs (pototype/mobile-screens.jsx:3-26):
// approve / field / service / exec (Dashboard) / me (profile). BLOCKERS.md B-241
// (ruled option-a, 2026-08-03) makes this the canonical bar AND rules that a tab
// with NO destination screen renders honest-DISABLED — never a fabricated one.
//
// Four tabs map to a [MobileSection] that has screens (their [destination] is the
// section's entry route). The fifth, `me` (profile), has no screen anywhere in
// the prototype, so [destination] is null => [MobileTab.enabled] is false and the
// tab is drawn disabled and non-tappable.
//
// Labels come ONLY from i18n keys (PLAN.md §0 rule 2). To keep Thai out of
// lib/**.dart (the i18n-guard hook), the keys live in the shell's sidecar
// assets/i18n/screens/shell_strings.json and are referenced here by ASCII field
// name; each field's i18n LAYER is fixed by [labelLayer].
import 'package:flutter/widgets.dart';
import 'package:flutter/material.dart' show Icons;

import 'mobile_sections.dart';

/// Which i18n layer a tab label key resolves through.
enum TabLabelLayer {
  /// dict — a stable key such as `common.approve`, read with JuneflowI18n.t().
  dict,

  /// phrases — the Thai/label text IS the key, read with JuneflowI18n.tp().
  phrase,
}

/// One MTabBar tab.
class MobileTab {
  const MobileTab({
    required this.id,
    required this.icon,
    required this.labelField,
    required this.labelLayer,
    required this.section,
    required this.destination,
  });

  /// Prototype tab id: `approve` / `field` / `service` / `exec` / `me`.
  final String id;

  /// Bottom-nav glyph (Material equivalent of the prototype's abstract icon;
  /// exact glyph fidelity is checked at the first screen's G5, per the brief).
  final IconData icon;

  /// Field name in assets/i18n/screens/shell_strings.json holding this tab's key.
  final String labelField;

  /// i18n layer for [labelField].
  final TabLabelLayer labelLayer;

  /// The section this tab activates, or null when the tab has no destination.
  final MobileSection? section;

  /// Route the tab navigates to, or null => honest-DISABLED (B-241).
  final String? destination;

  /// A tab is tappable iff it has a destination screen.
  bool get enabled => destination != null;
}

/// The 5 tabs, in prototype order. Destinations are each section's entry route
/// (the first screen of the section in MOBILE_GROUPS order). The prototype's
/// MTabBar is presentational (no onTap — the web host navigates via a sidebar),
/// so these entry routes are the app's canonical section landings; each renders
/// its screen once built, or an honest placeholder until then.
const List<MobileTab> kMobileTabs = <MobileTab>[
  MobileTab(
    id: 'approve',
    icon: Icons.check,
    labelField: 'tabApprove',
    labelLayer: TabLabelLayer.dict,
    section: MobileSection.approve,
    destination: 'inbox',
  ),
  MobileTab(
    id: 'field',
    icon: Icons.engineering_outlined,
    labelField: 'tabField',
    labelLayer: TabLabelLayer.dict,
    section: MobileSection.field,
    destination: 'pm-jobs',
  ),
  MobileTab(
    id: 'service',
    icon: Icons.warning_amber_rounded,
    labelField: 'tabService',
    labelLayer: TabLabelLayer.phrase,
    section: MobileSection.service,
    destination: 'srv-new',
  ),
  MobileTab(
    id: 'exec',
    icon: Icons.dashboard_outlined,
    labelField: 'tabDashboard',
    labelLayer: TabLabelLayer.phrase,
    section: MobileSection.exec,
    destination: 'exec',
  ),
  // me (profile) — no destination screen in the prototype => honest-DISABLED.
  MobileTab(
    id: 'me',
    icon: Icons.person_outline,
    labelField: 'tabProfile',
    labelLayer: TabLabelLayer.dict,
    section: null,
    destination: null,
  ),
];
