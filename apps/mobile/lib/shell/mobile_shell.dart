// MobileShell — the app frame that hosts a screen + the bottom tab bar
// (MOB-SHELL-00).
//
// It owns the current route, renders it through [MobileScreenRouter] (a
// placeholder until each screen is built), and draws the [MTabBar] beneath.
// Tapping an enabled tab navigates to that tab's section entry route; the
// disabled profile (me) tab is a no-op (B-241 honest-disable). The badge is null
// here — the shell has no live approval count wired yet (the /me/approvals
// endpoint is filed as a backend blocker), so it stays honestly empty rather than
// showing the prototype's mock 17.
import 'package:flutter/material.dart';

import '../widgets/m_tab_bar.dart';
import 'mobile_routes.dart';
import 'mobile_screen_router.dart';
import 'mobile_sections.dart';
import 'mobile_tabs.dart';

class MobileShell extends StatefulWidget {
  const MobileShell({super.key, this.initialRoute = 'inbox'});

  /// Route shown first. Defaults to `inbox`, matching the prototype host
  /// (mobile-preview.jsx:47 useState("inbox")).
  final String initialRoute;

  @override
  State<MobileShell> createState() => _MobileShellState();
}

class _MobileShellState extends State<MobileShell> {
  late String _route = widget.initialRoute;

  void _onTabSelected(MobileTab tab) {
    // Disabled tabs never fire this, but guard anyway so honest-disable holds
    // even if a caller wires onTap incorrectly.
    final String? destination = tab.destination;
    if (destination == null) return;
    if (destination == _route) return;
    setState(() => _route = destination);
  }

  @override
  Widget build(BuildContext context) {
    final MobileSection? activeSection = sectionForRoute(_route);
    return Scaffold(
      body: SafeArea(bottom: false, child: MobileScreenRouter(route: _route)),
      bottomNavigationBar: MTabBar(
        activeSection: activeSection,
        onTabSelected: _onTabSelected,
        // badgeCount omitted => null => honest-empty (no live count wired yet).
      ),
    );
  }
}
