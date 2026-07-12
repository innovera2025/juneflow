// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/tokens/src/tokens.json (theme: fiori).
// Regenerate: pnpm --filter @juneflow/tokens gen:flutter
// Change values in the source token file only — never here (PLAN.md §0 rule 2).
// Only the fiori theme is generated; the navy theme is excluded (PLAN.md §0 rule 5).

import 'package:flutter/material.dart';

/// Fiori design tokens generated verbatim from packages/tokens/src/tokens.json.
abstract final class JuneflowTokens {
  JuneflowTokens._();

  // colors
  static const Color brandPrimary = Color(0xFF0A6ED1);
  static const Color brandHover = Color(0xFF085CAF);
  static const Color brandSoft = Color(0xFFE3F0FB);
  static const Color shellBg = Color(0xFF354A5F);
  static const Color shellBg2 = Color(0xFF2F4254);
  static const Color shellBorder = Color(0xFF46586B);
  static const Color shellText = Color(0xFFC9D6E2);
  static const Color shellTextStrong = Color(0xFFFFFFFF);
  static const Color shellActive = Color(0xFF7CC4FF);
  static const Color surfaceBg = Color(0xFFF5F6F7);
  static const Color surfaceCard = Color(0xFFFFFFFF);
  static const Color surfaceAlt = Color(0xFFFAFBFC);
  static const Color surfaceMuted = Color(0xFFE8ECF0);
  static const Color surfaceBorder = Color(0xFFD9DCDF);
  static const Color surfaceBorderStrong = Color(0xFFC2C8CE);
  static const Color textPrimary = Color(0xFF223548);
  static const Color textSecondary = Color(0xFF556B82);
  static const Color textTertiary = Color(0xFF8FA0B2);
  static const Color statusOkFg = Color(0xFF107E3E);
  static const Color statusOkSoft = Color(0xFFEBF5EF);
  static const Color statusWarnFg = Color(0xFFE9730C);
  static const Color statusWarnSoft = Color(0xFFFDF1E7);
  static const Color statusDangerFg = Color(0xFFBB0000);
  static const Color statusDangerSoft = Color(0xFFFBEAEA);
  static const Color statusInfoFg = Color(0xFF0A6ED1);
  static const Color statusInfoSoft = Color(0xFFE3F0FB);
  static const Color statusDraftFg = Color(0xFF6A7D90);
  static const Color statusDraftSoft = Color(0xFFEEF1F4);

  // radius
  static const double radiusSm = 4;
  static const double radiusMd = 4;
  static const double radiusLg = 6;
  static const double radiusPill = 999;

  // table
  static const double tableRowHeight = 32;
  static const double tableFontSize = 12;
  static const double tableHeaderFontSize = 10.5;

  // font
  static const String fontUi = 'Inter, Noto Sans Thai, Noto Sans Arabic, Noto Sans SC, system-ui';
  static const String fontNumeric = 'Inter (tabular-nums)';
}

/// Fiori [ThemeData] built entirely from [JuneflowTokens] (no literal values).
ThemeData juneflowFioriTheme() {
  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Inter',
    fontFamilyFallback: const ['Noto Sans Thai', 'Noto Sans Arabic', 'Noto Sans SC'],
    scaffoldBackgroundColor: JuneflowTokens.surfaceBg,
    dividerColor: JuneflowTokens.surfaceBorder,
    colorScheme: const ColorScheme.light(
      primary: JuneflowTokens.brandPrimary,
      onPrimary: JuneflowTokens.shellTextStrong,
      primaryContainer: JuneflowTokens.brandSoft,
      secondary: JuneflowTokens.brandHover,
      surface: JuneflowTokens.surfaceCard,
      onSurface: JuneflowTokens.textPrimary,
      error: JuneflowTokens.statusDangerFg,
      outline: JuneflowTokens.surfaceBorder,
    ),
    textTheme: const TextTheme(
      bodyMedium: TextStyle(color: JuneflowTokens.textPrimary),
      bodySmall: TextStyle(color: JuneflowTokens.textSecondary),
    ),
    cardTheme: CardThemeData(
      color: JuneflowTokens.surfaceCard,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(JuneflowTokens.radiusLg),
        side: const BorderSide(color: JuneflowTokens.surfaceBorder),
      ),
    ),
    dataTableTheme: const DataTableThemeData(
      dataRowMinHeight: JuneflowTokens.tableRowHeight,
      dataRowMaxHeight: JuneflowTokens.tableRowHeight,
      headingTextStyle: TextStyle(
        fontSize: JuneflowTokens.tableHeaderFontSize,
        color: JuneflowTokens.textTertiary,
      ),
      dataTextStyle: TextStyle(
        fontSize: JuneflowTokens.tableFontSize,
        color: JuneflowTokens.textPrimary,
      ),
    ),
  );
}
