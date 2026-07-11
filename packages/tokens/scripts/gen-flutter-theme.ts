/**
 * gen-flutter-theme.ts - generates Flutter ThemeData from src/tokens.json (fiori theme).
 *
 * Pipeline (PLAN.md section 5 packages/tokens; TASKS.md P0-BE-04, consumed by P0-MOB-02):
 *   src/tokens.json (themes.fiori: brand/shell/surface/text/status/radius/table/font)
 *     -> apps/mobile/lib/theme/juneflow_theme.dart  (generated Dart file - never hand-edit)
 *
 * src/tokens.json is copied verbatim from design_handoff_juneflow/tokens.json (docs/handoff after
 * scaffold) by the reference-copy step - this script only READS it. Never hardcode token values
 * here or anywhere else (PLAN.md section 0 rule 2).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(here, "../src/tokens.json");

interface TokensFile {
  themes: {
    fiori: Record<string, unknown>;
    [theme: string]: Record<string, unknown>;
  };
  [key: string]: unknown;
}

function main(): void {
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8")) as TokensFile;
  const fiori = tokens.themes?.fiori;
  if (!fiori) {
    throw new Error(`themes.fiori not found in ${tokensPath}`);
  }

  // TODO(P0-BE-04): map the fiori token groups (brand/shell/surface/text/status/radius/table/font)
  //   to Flutter ThemeData (ColorScheme, TextTheme, radii, table styles) and write the generated
  //   Dart theme file for apps/mobile. Output values must match the source tokens exactly
  //   (gate: "output gen ตรงค่า token ต้นทาง").
  // NOTE: only the fiori theme is in scope - the "Juneflow Ant Pro*" / navy theme is excluded
  //   (PLAN.md section 0 rule 5).
  console.error(
    "TODO(P0-BE-04): gen-flutter-theme is a stub - Flutter ThemeData generation not implemented yet (see TASKS.md P0-BE-04).",
  );
  process.exit(1);
}

main();
