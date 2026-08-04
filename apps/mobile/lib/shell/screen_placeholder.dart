// Honest placeholder for a known-but-unbuilt route (MOB-SHELL-00).
//
// The router knows all 26 routes but this task ships none of the screens, so
// every route resolves here. It deliberately invents NO product copy (PLAN.md §0
// rule 2): it shows only the ASCII route id and a build glyph, so the shell is
// demoable and each route is honestly labelled "no screen yet" rather than faking
// one. A screen port replaces this by registering its id + widget in
// mobile_screen_router.dart.
import 'package:flutter/material.dart';

import '../theme/juneflow_theme.dart';

class ScreenPlaceholder extends StatelessWidget {
  const ScreenPlaceholder({super.key, required this.routeId});

  /// The route this placeholder stands in for (a spec screen id, ASCII).
  final String routeId;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: JuneflowTokens.surfaceBg,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(
            Icons.construction_outlined,
            size: 40,
            color: JuneflowTokens.textTertiary,
          ),
          const SizedBox(height: 12),
          // Route id only — no invented UI copy. Monospace to read as an id.
          Text(
            routeId,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: JuneflowTokens.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
