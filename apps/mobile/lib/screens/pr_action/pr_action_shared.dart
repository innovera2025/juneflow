// Shared chrome for the PR approve / reject action sheets (routes `approve`,
// `reject`; pototype/mobile.jsx MobileApproveSheet + MobileRejectSheet). Both
// sheets share the same frame — a MobileHeader with a back-circle, a scrolling
// body, and a bottom [cancel | primary] action bar — so it lives once here.
//
// Every colour / space / radius is a generated design token (JuneflowTokens,
// packages/tokens — PLAN.md §0 rule 2); callers pass already-translated text (no
// copy of its own). The bottom bar is a docked row at the end of the screen
// Column (the prototype draws it position:absolute; a docked row is the honest
// Flutter analogue and pins it to the same spot).
import 'package:flutter/material.dart';

import '../../theme/juneflow_theme.dart';
import 'pr_action_agg.dart';

/// Honest placeholder for any value the wire does not carry (never invented).
const String kPrActionDash = '—'; // em dash

/// A 34px round back button (mobile.jsx L399/L474 — surface-3 circle + chevL).
Widget prActionBackButton(VoidCallback onTap) {
  return GestureDetector(
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceMuted,
        shape: BoxShape.circle,
      ),
      child: const Icon(
        Icons.chevron_left,
        size: 18,
        color: JuneflowTokens.textSecondary,
      ),
    ),
  );
}

/// Honest body for when no PR is loaded — no selection, not found, or a load
/// error: a centered em-dash, never a fabricated PR (web/notif honest-empty
/// precedent). §0 rule 3 + the task's "no PR selected" rule.
Widget prActionEmptyBody() {
  return const Center(
    child: Text(
      kPrActionDash,
      style: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: JuneflowTokens.textTertiary,
      ),
    ),
  );
}

/// A calm loading surface for the frame the GET /pr/{id} read takes.
Widget prActionLoadingBody() {
  return const Center(
    child: SizedBox(
      width: 22,
      height: 22,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: JuneflowTokens.textTertiary,
      ),
    ),
  );
}

/// The bottom action bar (mobile.jsx L440-455 / L523-538): a muted [cancel] and a
/// coloured [primary] with a leading icon. [onPrimary] null ⇒ the primary is
/// disabled (busy, or an empty required reason).
class PrActionBar extends StatelessWidget {
  const PrActionBar({
    super.key,
    required this.cancelLabel,
    required this.primaryLabel,
    required this.primaryIcon,
    required this.primaryColor,
    required this.onCancel,
    required this.onPrimary,
  });

  final String cancelLabel;
  final String primaryLabel;
  final IconData primaryIcon;

  /// The primary tint (ok green for approve, danger red for reject).
  final Color primaryColor;
  final VoidCallback onCancel;

  /// null ⇒ disabled (dimmed, non-tappable).
  final VoidCallback? onPrimary;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPrimary != null;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
      decoration: const BoxDecoration(
        color: JuneflowTokens.surfaceCard,
        border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            flex: 1,
            child: _BarButton(
              onTap: onCancel,
              height: 44,
              decoration: BoxDecoration(
                color: JuneflowTokens.surfaceMuted,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: JuneflowTokens.surfaceBorder),
              ),
              child: Text(
                cancelLabel,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: JuneflowTokens.textSecondary,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 2,
            child: _BarButton(
              onTap: enabled ? onPrimary : null,
              height: 44,
              decoration: BoxDecoration(
                // Dim the fill when disabled — an honest "not actionable" signal.
                color: enabled
                    ? primaryColor
                    : Color.alphaBlend(
                        primaryColor.withValues(alpha: 0.4),
                        JuneflowTokens.surfaceCard,
                      ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(
                    primaryIcon,
                    size: 18,
                    color: JuneflowTokens.shellTextStrong,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    primaryLabel,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: JuneflowTokens.shellTextStrong,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BarButton extends StatelessWidget {
  const _BarButton({
    required this.onTap,
    required this.height,
    required this.decoration,
    required this.child,
  });

  final VoidCallback? onTap;
  final double height;
  final BoxDecoration decoration;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: height,
        alignment: Alignment.center,
        decoration: decoration,
        child: child,
      ),
    );
  }
}

/// Build the inline spans for a resolved i18n phrase [template] that carries
/// `{name}` slots, styling the substituted DATA ([tokenSpans]) apart from the
/// surrounding copy ([baseStyle]). No Thai literal ever appears in Dart — the
/// template is the resolved key, the tokens carry the real wire values.
List<InlineSpan> prActionTemplateSpans(
  String template,
  TextStyle baseStyle,
  Map<String, InlineSpan> tokenSpans,
) {
  return <InlineSpan>[
    for (final TemplateSeg seg in splitTemplate(
      template,
      tokenSpans.keys.toSet(),
    ))
      if (seg.isToken)
        tokenSpans[seg.token]!
      else
        TextSpan(text: seg.text, style: baseStyle),
  ];
}
