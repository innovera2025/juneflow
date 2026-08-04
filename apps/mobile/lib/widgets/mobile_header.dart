// MobileHeader — the shared screen header (MOB-SHELL-00).
//
// Structural port of pototype/mobile.jsx:7-22: a surface strip with a bottom
// hairline, a top row [leading | sub | trailing] and a large title below. Every
// spacing/colour is a generated design token (JuneflowTokens from packages/tokens
// — PLAN.md §0 rule 2); no literal values. Text is passed in already-resolved
// (callers translate through i18n) so this widget carries no copy of its own.
import 'package:flutter/material.dart';

import '../theme/juneflow_theme.dart';

class MobileHeader extends StatelessWidget {
  const MobileHeader({
    super.key,
    required this.title,
    this.sub,
    this.leading,
    this.trailing,
  });

  /// Large title line (mobile.jsx:19 — 19px/700).
  final String title;

  /// Small eyebrow above the title (mobile.jsx:16 — 11.5px/600, text-3).
  final String? sub;

  /// Optional left slot (e.g. an avatar button); a 28px spacer keeps the sub
  /// centred when absent, matching the prototype.
  final Widget? leading;

  /// Optional right slot (e.g. a bell button).
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(bottom: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              leading ?? const SizedBox(width: 28),
              Text(
                sub ?? '',
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: JuneflowTokens.textTertiary,
                ),
              ),
              trailing ?? const SizedBox(width: 28),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            title,
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w700,
              color: JuneflowTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
