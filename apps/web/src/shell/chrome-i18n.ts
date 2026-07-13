/*
 * Chrome string resolver for @juneflow/web (P0-WEB-05).
 *
 * Bridges the verbatim prototype UI strings (chrome-strings.json) into the i18n
 * phrase layer: ct(slot) returns tp(<thai phrase key>). For th (visual-gate lang)
 * this is the exact prototype text; for en/zh/ar it is the phrase translation when
 * one exists in i18n-full.json, else the Thai fallback (BLOCKERS B-039). Thai never
 * appears in .tsx source — only ASCII slot keys do.
 */
import chromeStrings from "./chrome-strings.json" with { type: "json" };
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../i18n";

type Slot = keyof typeof chromeStrings.strings;

const STRINGS = chromeStrings.strings as Record<Slot, string>;

/** Hook returning ct(slot) — a bound chrome-string translator for the active lang. */
export function useChromeText() {
  const { tp } = useI18n();
  return (slot: Slot): string => tp(STRINGS[slot] as PhraseKey);
}
