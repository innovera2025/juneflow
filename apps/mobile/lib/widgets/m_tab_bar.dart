// MTabBar — the 5-tab bottom navigation (MOB-SHELL-00).
//
// Structural port of pototype/mobile-screens.jsx:3-26 driven by the [kMobileTabs]
// model. Rules honoured:
//  * B-241 honest-disable: the `me` (profile) tab has no destination screen, so it
//    is drawn dimmed and does not respond to taps — no fabricated destination.
//  * PLAN.md §0 rule 3 honest data: the badge is a LIVE count passed in
//    ([badgeCount]); it defaults to null => no badge. The prototype's hardcoded
//    17 is never reproduced.
// Labels resolve through i18n from the shell sidecar (AppScope), so no Thai lives
// in this file (i18n-guard).
import 'package:flutter/material.dart';

import '../app/app_scope.dart';
import '../i18n/i18n.dart';
import '../shell/mobile_sections.dart';
import '../shell/mobile_tabs.dart';
import '../theme/juneflow_theme.dart';

class MTabBar extends StatelessWidget {
  const MTabBar({
    super.key,
    required this.activeSection,
    this.onTabSelected,
    this.badgeCount,
  });

  /// The section whose tab is highlighted, or null when none is active.
  final MobileSection? activeSection;

  /// Tapped-tab callback. Never fired for a disabled tab.
  final void Function(MobileTab tab)? onTabSelected;

  /// Live count for the approval badge. Null => no badge (honest default — the
  /// prototype's hardcoded 17 is never shown). A real count comes from a query.
  final int? badgeCount;

  @override
  Widget build(BuildContext context) {
    final AppServicesReader reader = AppServicesReader(context);
    return Container(
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      padding: const EdgeInsets.only(top: 8, bottom: 22),
      child: Row(
        children: <Widget>[
          for (final MobileTab tab in kMobileTabs)
            Expanded(child: _tab(context, reader, tab)),
        ],
      ),
    );
  }

  Widget _tab(BuildContext context, AppServicesReader reader, MobileTab tab) {
    final bool isActive = tab.section != null && tab.section == activeSection;
    final Color color = !tab.enabled
        ? JuneflowTokens.textTertiary
        : (isActive
              ? JuneflowTokens.brandPrimary
              : JuneflowTokens.textTertiary);

    final Widget icon = _iconWithBadge(tab, color);
    final Widget labelled = Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        icon,
        const SizedBox(height: 3),
        Text(
          reader.label(tab),
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ],
    );

    if (!tab.enabled) {
      // Honest-disable (B-241): dimmed, announced disabled, not tappable.
      return Semantics(
        enabled: false,
        button: true,
        child: Opacity(
          opacity: 0.4,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: labelled,
          ),
        ),
      );
    }

    return InkWell(
      onTap: onTabSelected == null ? null : () => onTabSelected!(tab),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: labelled,
      ),
    );
  }

  Widget _iconWithBadge(MobileTab tab, Color color) {
    final Widget glyph = Icon(tab.icon, size: 20, color: color);
    // The badge belongs to the approval tab (prototype). Only render it when a
    // real, positive count is supplied.
    final bool showBadge =
        tab.section == MobileSection.approve &&
        badgeCount != null &&
        badgeCount! > 0;
    if (!showBadge) return glyph;
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        glyph,
        Positioned(
          top: -4,
          right: -8,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: JuneflowTokens.statusDangerFg,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$badgeCount',
              style: const TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.shellTextStrong,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Small helper that resolves a tab's label from the shell sidecar + i18n. Kept
/// out of the widget so the label logic can be unit-tested directly.
class AppServicesReader {
  AppServicesReader(BuildContext context)
    : _i18n = AppScope.of(context).i18n,
      _strings = AppScope.of(context).shellStrings;

  final JuneflowI18n _i18n;
  final ScreenStrings _strings;

  String label(MobileTab tab) => resolveTabLabel(_i18n, _strings, tab);
}

/// Resolves [tab]'s label: the key comes from the sidecar, the text from i18n
/// through the tab's declared layer. Pure — no BuildContext — so tests can call
/// it against a fixture i18n instance.
String resolveTabLabel(
  JuneflowI18n i18n,
  ScreenStrings strings,
  MobileTab tab,
) {
  final String key = strings[tab.labelField];
  return switch (tab.labelLayer) {
    TabLabelLayer.dict => i18n.t(key),
    TabLabelLayer.phrase => i18n.tp(key),
  };
}
