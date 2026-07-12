/**
 * gen-flutter-theme.ts — CLI wrapper around the pure generator in src/flutter-theme.ts.
 *
 * Pipeline (PLAN.md §5 packages/tokens; TASKS.md P0-BE-04, consumed by P0-MOB-02):
 *   src/tokens.json (themes.fiori)  ->  generateFlutterTheme()  ->  <out>/juneflow_theme.dart
 *
 * Default output is packages/tokens/gen/juneflow_theme.dart (in this zone). The mobile zone
 * (P0-MOB-02) runs this with `--out apps/mobile/lib/theme` to place the generated ThemeData
 * where the Flutter app imports it. The generated file must never be hand-edited and no token
 * value is ever hardcoded here (PLAN.md §0 rule 2).
 *
 * Usage: tsx scripts/gen-flutter-theme.ts [--out <dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFlutterTheme } from '../src/flutter-theme.js';

const here = dirname(fileURLToPath(import.meta.url));

function parseOutDir(argv: string[]): string {
  const i = argv.indexOf('--out');
  if (i !== -1) {
    const val = argv[i + 1];
    if (!val) throw new Error('--out requires a directory path');
    return resolve(process.cwd(), val);
  }
  // default: packages/tokens/gen
  return resolve(here, '../gen');
}

function main(): void {
  const outDir = parseOutDir(process.argv.slice(2));
  const outFile = resolve(outDir, 'juneflow_theme.dart');
  const dart = generateFlutterTheme();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, dart, 'utf8');
  console.log(`gen-flutter-theme: wrote ${outFile}`);
}

main();
