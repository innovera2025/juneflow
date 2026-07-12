/**
 * P0-BE-04 gate — "output gen ตรงค่า token ต้นทาง (ห้าม hardcode)".
 *
 * These tests prove the generated Flutter ThemeData is derived entirely from
 * src/tokens.json (theme: fiori) and contains no hardcoded or foreign (navy)
 * design values. Expected values are read from the source token file itself
 * (PLAN.md §0 rule 2) — never asserted as literals invented here.
 */
import { describe, expect, it } from 'vitest';
import { generateFlutterTheme } from './flutter-theme.js';
import tokens from './tokens.json' with { type: 'json' };

const fiori = tokens.themes.fiori;
const navy = tokens.themes.navy;

/** Collect every colour hex (upper-case, no `#`) reachable in a theme's colour groups. */
function themeHexes(theme: {
  brand: Record<string, string>;
  shell?: Record<string, string>;
  surface: Record<string, string>;
  text: Record<string, string>;
  status: Record<string, { fg: string; soft: string }>;
}): Set<string> {
  const out = new Set<string>();
  const add = (h: string) => out.add(h.replace('#', '').toUpperCase());
  Object.values(theme.brand).forEach(add);
  Object.values(theme.shell ?? {}).forEach(add);
  Object.values(theme.surface).forEach(add);
  Object.values(theme.text).forEach(add);
  Object.values(theme.status).forEach((s) => {
    add(s.fg);
    add(s.soft);
  });
  return out;
}

const output = generateFlutterTheme();

describe('generateFlutterTheme (fiori)', () => {
  it('emits the expected Dart structure', () => {
    expect(output).toContain('abstract final class JuneflowTokens');
    expect(output).toContain('ThemeData juneflowFioriTheme()');
    expect(output).toContain("import 'package:flutter/material.dart';");
    expect(output).toContain('DO NOT EDIT BY HAND');
  });

  it('includes every fiori colour value from the source tokens', () => {
    for (const hex of themeHexes(fiori)) {
      expect(output, `missing colour #${hex}`).toContain(`0xFF${hex}`);
    }
  });

  it('emits no colour that is not a source fiori token (no hardcode)', () => {
    const allowed = themeHexes(fiori);
    const emitted = [...output.matchAll(/0xFF([0-9A-F]{6})/g)].map((m) => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    for (const hex of emitted) {
      expect(allowed.has(hex), `unexpected colour #${hex} in output`).toBe(true);
    }
  });

  it('does not leak navy-theme-only colours', () => {
    const navyOnly = [...themeHexes(navy)].filter((h) => !themeHexes(fiori).has(h));
    expect(navyOnly.length).toBeGreaterThan(0); // sanity: navy has distinct colours
    for (const hex of navyOnly) {
      expect(output, `navy colour #${hex} leaked`).not.toContain(`0xFF${hex}`);
    }
  });

  it('includes radius and table metrics from the source tokens', () => {
    for (const v of Object.values(fiori.radius)) {
      expect(output).toContain(`= ${v};`);
    }
    for (const v of Object.values(fiori.table)) {
      expect(output).toContain(`= ${v};`);
    }
  });

  it('includes the source font families', () => {
    expect(output).toContain(fiori.font.ui);
    expect(output).toContain(fiori.font.numeric);
  });
});
