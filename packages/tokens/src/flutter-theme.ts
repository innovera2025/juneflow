/**
 * flutter-theme.ts — pure generator: src/tokens.json (theme: fiori) -> Flutter ThemeData source.
 *
 * P0-BE-04 (packages/tokens side). The generated Dart file is consumed by the mobile zone
 * (P0-MOB-02) which places it under apps/mobile/lib/theme. This module is intentionally pure
 * (no fs / no node builtins) so it can be unit-tested directly and so every emitted value is
 * derived from the source tokens — NEVER hardcoded (PLAN.md §0 rule 2).
 *
 * Only the `fiori` theme is in scope. The `navy` theme is excluded (PLAN.md §0 rule 5).
 */
import tokens from './tokens.json' with { type: 'json' };

/** A `#RRGGBB` hex string exactly as it appears in the source token file. */
type Hex = string;

interface FioriTheme {
  brand: Record<string, Hex>;
  shell: Record<string, Hex>;
  surface: Record<string, Hex>;
  text: Record<string, Hex>;
  status: Record<string, { fg: Hex; soft: Hex }>;
  radius: Record<string, number>;
  table: Record<string, number>;
  font: Record<string, string>;
}

const fiori = (tokens as { themes: { fiori: FioriTheme } }).themes.fiori;

/** camelCase a token key (e.g. `header` stays, nested groups compose: `status` + `okFg`). */
function camel(...parts: string[]): string {
  return parts
    .join(' ')
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) =>
      c ? c.toUpperCase() : '',
    )
    .replace(/^([A-Z])/, (m) => m.toLowerCase());
}

/** `#0A6ED1` -> `Color(0xFF0A6ED1)` (opaque). Preserves the exact source hex digits. */
function dartColor(hex: Hex): string {
  const digits = hex.replace('#', '').toUpperCase();
  return `Color(0xFF${digits})`;
}

/** Render a number the way it appears in the source (e.g. `10.5`, `32`, `999`). */
function dartNum(n: number): string {
  return String(n);
}

/** Escape a token string for a single-quoted Dart literal. */
function dartString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

interface ColorField {
  name: string;
  value: Hex;
  dart: string;
}

/** Flatten every fiori colour token into a deterministic, source-derived field list. */
function colorFields(): ColorField[] {
  const out: ColorField[] = [];
  const push = (name: string, value: Hex) =>
    out.push({ name, value, dart: dartColor(value) });

  for (const [k, v] of Object.entries(fiori.brand)) push(camel('brand', k), v);
  for (const [k, v] of Object.entries(fiori.shell)) push(camel('shell', k), v);
  for (const [k, v] of Object.entries(fiori.surface))
    push(camel('surface', k), v);
  for (const [k, v] of Object.entries(fiori.text)) push(camel('text', k), v);
  for (const [k, v] of Object.entries(fiori.status)) {
    push(camel('status', k, 'fg'), v.fg);
    push(camel('status', k, 'soft'), v.soft);
  }
  return out;
}

interface DoubleField {
  name: string;
  value: number;
}

function radiusFields(): DoubleField[] {
  return Object.entries(fiori.radius).map(([k, v]) => ({
    name: camel('radius', k),
    value: v,
  }));
}

function tableFields(): DoubleField[] {
  return Object.entries(fiori.table).map(([k, v]) => ({
    name: camel('table', k),
    value: v,
  }));
}

interface StringField {
  name: string;
  value: string;
}

function fontFields(): StringField[] {
  return Object.entries(fiori.font).map(([k, v]) => ({
    name: camel('font', k),
    value: v,
  }));
}

/**
 * Split a CSS font stack ("Inter, Noto Sans Thai, ...") into family names so the
 * Flutter theme can use the primary family + fallbacks — derived from the token,
 * not a hardcoded family choice.
 */
function fontFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter((f) => f.length > 0 && f !== 'system-ui' && f !== 'sans-serif');
}

/**
 * Generate the Flutter ThemeData Dart source for the fiori theme. Every value is
 * derived from src/tokens.json; there are no hardcoded design values.
 */
export function generateFlutterTheme(): string {
  const colors = colorFields();
  const radii = radiusFields();
  const table = tableFields();
  const fonts = fontFields();
  const uiFamilies = fontFamilies(fiori.font.ui ?? '');

  const colorConsts = colors
    .map((c) => `  static const Color ${c.name} = ${c.dart};`)
    .join('\n');
  const radiusConsts = radii
    .map((r) => `  static const double ${r.name} = ${dartNum(r.value)};`)
    .join('\n');
  const tableConsts = table
    .map((t) => `  static const double ${t.name} = ${dartNum(t.value)};`)
    .join('\n');
  const fontConsts = fonts
    .map((f) => `  static const String ${f.name} = ${dartString(f.value)};`)
    .join('\n');

  const primaryFamily = uiFamilies[0] ?? '';
  const fallbackFamilies = uiFamilies.slice(1);
  const fallbackList = fallbackFamilies
    .map((f) => dartString(f))
    .join(', ');

  return `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: packages/tokens/src/tokens.json (theme: fiori).
// Regenerate: pnpm --filter @juneflow/tokens gen:flutter
// Change values in the source token file only — never here (PLAN.md §0 rule 2).
// Only the fiori theme is generated; the navy theme is excluded (PLAN.md §0 rule 5).

import 'package:flutter/material.dart';

/// Fiori design tokens generated verbatim from packages/tokens/src/tokens.json.
abstract final class JuneflowTokens {
  JuneflowTokens._();

  // colors
${colorConsts}

  // radius
${radiusConsts}

  // table
${tableConsts}

  // font
${fontConsts}
}

/// Fiori [ThemeData] built entirely from [JuneflowTokens] (no literal values).
ThemeData juneflowFioriTheme() {
  return ThemeData(
    useMaterial3: true,
    fontFamily: ${dartString(primaryFamily)},
    fontFamilyFallback: const [${fallbackList}],
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
`;
}
