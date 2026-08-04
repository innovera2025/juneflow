// Shared mobile primitives MSection / MField / MInput / MPill (MOB-SHELL-00).
//
// Structural ports of pototype/mobile-screens.jsx:28/35/44/50 — the card,
// labelled field, read display box, and status pill reused across the form/list
// screens (including the cross-file mobile-pm.jsx / mobile-field.jsx uses). All
// spacing/colour is a generated design token (JuneflowTokens — PLAN.md §0 rule 2);
// callers pass already-translated text (these carry no copy of their own).
import 'package:flutter/material.dart';

import '../theme/juneflow_theme.dart';

/// MSection — a titled surface card (mobile-screens.jsx:28).
class MSection extends StatelessWidget {
  const MSection({super.key, this.title, required this.child});

  final String? title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: JuneflowTokens.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (title != null) ...<Widget>[
            Text(
              title!,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: JuneflowTokens.textPrimary,
              ),
            ),
            const SizedBox(height: 10),
          ],
          child,
        ],
      ),
    );
  }
}

/// MField — a labelled field slot with an optional required asterisk
/// (mobile-screens.jsx:35).
class MField extends StatelessWidget {
  const MField({
    super.key,
    required this.label,
    required this.child,
    this.required = false,
  });

  final String label;
  final Widget child;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text.rich(
              TextSpan(
                text: label,
                children: <InlineSpan>[
                  if (required)
                    const TextSpan(
                      text: ' *',
                      style: TextStyle(color: JuneflowTokens.statusDangerFg),
                    ),
                ],
              ),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: JuneflowTokens.textSecondary,
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

/// MInput — a read display box showing a value or a placeholder
/// (mobile-screens.jsx:44). This is the prototype's non-editable display; a real
/// editable field is a screen-level concern.
class MInput extends StatelessWidget {
  const MInput({super.key, this.value, this.placeholder});

  final String? value;
  final String? placeholder;

  @override
  Widget build(BuildContext context) {
    final bool hasValue = value != null && value!.isNotEmpty;
    return Container(
      constraints: const BoxConstraints(minHeight: 22),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: JuneflowTokens.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        hasValue ? value! : (placeholder ?? ''),
        style: TextStyle(
          fontSize: 13,
          color: hasValue
              ? JuneflowTokens.textPrimary
              : JuneflowTokens.textTertiary,
        ),
      ),
    );
  }
}

/// MPill — a small status pill (mobile-screens.jsx:50). [color] is the text and
/// tint colour; a translucent tint of it is the background.
class MPill extends StatelessWidget {
  const MPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        // color-mix(in srgb, color 14%, surface) — a 14% tint of the pill colour.
        color: Color.alphaBlend(
          color.withValues(alpha: 0.14),
          JuneflowTokens.surfaceCard,
        ),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
