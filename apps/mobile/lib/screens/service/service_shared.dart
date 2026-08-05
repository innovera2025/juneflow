// Shared chrome for the four mobile after-sales SERVICE screens
// (pototype/mobile-screens.jsx MSrvNewReport L61-121, MSrvTrack L125-192,
// MTechJobs L198-257, MTechClose L263-311). The lib/screens/pr_action precedent:
// one file for the frame the sibling screens share, so each screen file holds only
// its own layout.
//
// Every colour / space / radius is a generated design token (JuneflowTokens from
// packages/tokens — PLAN.md §0 rule 2); callers pass already-translated text, so
// nothing here carries copy of its own and no Thai byte lives in this file.
//
// STATUS COLOURS — a documented theme limitation, not a redesign. The prototype
// tints `fixing` with `var(--accent)` (L137 / L237). The app runs the **fiori**
// theme, and packages/tokens/src/tokens.json declares `accent` ONLY under
// `.themes.navy.brand.accent` (#0F766E) — the fiori block has no accent at all. So
// `fixing` takes the theme's own emphasis colour, brand.primary, which under fiori
// resolves to the same blue as status.info: `received` and `fixing` are then told
// apart by their LABEL, not their hue. That is the honest consequence of generating
// colour from tokens instead of typing the prototype's hex (§0 rule 2); nothing here
// invents a colour to paper over it.
import 'package:flutter/material.dart';

import '../../theme/juneflow_theme.dart';
import 'service_agg.dart';

/// Foreground + soft background of one status tone.
class ServiceTone {
  const ServiceTone(this.fg, this.bg);

  final Color fg;
  final Color bg;
}

/// The tone of a service status. An UNKNOWN status takes the neutral draft tone —
/// never a colour that implies progress the wire did not report.
ServiceTone serviceStatusTone(String status) => switch (status) {
  'received' => const ServiceTone(
    JuneflowTokens.statusInfoFg,
    JuneflowTokens.statusInfoSoft,
  ),
  'scheduled' => const ServiceTone(
    JuneflowTokens.statusWarnFg,
    JuneflowTokens.statusWarnSoft,
  ),
  // fixing: the prototype's --accent has no fiori token (see the file header).
  'fixing' => const ServiceTone(
    JuneflowTokens.brandPrimary,
    JuneflowTokens.brandSoft,
  ),
  'fixed' => const ServiceTone(
    JuneflowTokens.statusOkFg,
    JuneflowTokens.statusOkSoft,
  ),
  'closed' => const ServiceTone(
    JuneflowTokens.statusDraftFg,
    JuneflowTokens.statusDraftSoft,
  ),
  _ => const ServiceTone(
    JuneflowTokens.statusDraftFg,
    JuneflowTokens.statusDraftSoft,
  ),
};

/// The sidecar field holding the label of [status]. All five resolve zero-mint
/// through the dict the merged web port already uses (sales.service.status*).
/// Returns null for an unknown status — the view then em-dashes it rather than
/// labelling it with a state the machine does not have.
String? serviceStatusField(String status) => switch (status) {
  'received' => 'statusReceived',
  'scheduled' => 'statusScheduled',
  'fixing' => 'statusFixing',
  'fixed' => 'statusFixed',
  'closed' => 'statusClosed',
  _ => null,
};

/// A 34px round back button (mobile-screens.jsx L69 / L267 — surface-3 circle +
/// chevL), identical to the one the merged approve/reject sheets use.
Widget serviceBackButton(VoidCallback onTap) {
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

/// The prototype's read box (MInput, mobile-screens.jsx L44) holding an honest
/// em-dash: the label above it is the prototype's chrome, the VALUE has no backing
/// column. Used wherever a field has no wire at all (the pm-notes parts-slot
/// precedent) rather than dropping the row and silently reshaping the screen.
Widget serviceDashBox({double minHeight = 22}) {
  return Container(
    width: double.infinity,
    constraints: BoxConstraints(minHeight: minHeight),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      color: JuneflowTokens.surfaceAlt,
      borderRadius: BorderRadius.circular(8),
    ),
    child: const Text(
      kServiceDash,
      style: TextStyle(fontSize: 13, color: JuneflowTokens.textTertiary),
    ),
  );
}

/// Honest-empty — a centered em-dash, no invented copy (the merged notif / pm_jobs /
/// pm_notes precedent).
Widget serviceEmpty() {
  return const Center(
    child: Text(
      kServiceDash,
      style: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: JuneflowTokens.textTertiary,
      ),
    ),
  );
}

/// The sticky bottom action bar (mobile-screens.jsx L111 / L302): a surface strip
/// with a top hairline holding one full-width button.
Widget serviceActionBar({required Widget child}) {
  return Container(
    padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
    decoration: const BoxDecoration(
      color: JuneflowTokens.surfaceCard,
      border: Border(top: BorderSide(color: JuneflowTokens.surfaceBorder)),
    ),
    child: child,
  );
}

/// A 44px primary button (mobile-screens.jsx L113 / L304). Disabled when [onTap] is
/// null — an honest-DISABLED control, never a dead-but-live-looking one. [tone]
/// overrides the fill (the prototype paints the close CTA with --ok).
Widget servicePrimaryButton({
  required String label,
  required VoidCallback? onTap,
  IconData? icon,
  bool busy = false,
  Color? tone,
}) {
  final bool enabled = onTap != null && !busy;
  return GestureDetector(
    onTap: enabled ? onTap : null,
    behavior: HitTestBehavior.opaque,
    child: Container(
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: enabled
            ? (tone ?? JuneflowTokens.brandPrimary)
            : JuneflowTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
      ),
      child: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: JuneflowTokens.textSecondary,
              ),
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (icon != null) ...<Widget>[
                  Icon(
                    icon,
                    size: 18,
                    color: enabled
                        ? JuneflowTokens.shellTextStrong
                        : JuneflowTokens.textTertiary,
                  ),
                  const SizedBox(width: 6),
                ],
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: enabled
                          ? JuneflowTokens.shellTextStrong
                          : JuneflowTokens.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
    ),
  );
}

/// The honest write-status card the three writing screens share: a tinted strip
/// naming what really happened. There is deliberately no "queued" variant — these
/// writes are online one-shot calls (service_repository.dart header), so the only
/// truthful outcomes are done and failed (B-268 option (a): never a fake success).
Widget serviceStatusCard({
  required IconData icon,
  required String text,
  required ServiceTone tone,
}) {
  return Container(
    margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: tone.bg,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: tone.fg),
    ),
    child: Row(
      children: <Widget>[
        Icon(icon, size: 18, color: tone.fg),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: tone.fg,
            ),
          ),
        ),
      ],
    ),
  );
}
