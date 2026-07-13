/*
 * Chrome string resolver for @juneflow/web (P0-WEB-05 · 5b B-039).
 *
 * The verbatim prototype UI strings (chrome-strings.json) route through the i18n
 * phrase layer: ct(slot) returns tp(<thai phrase key>). After PLAT-03 filled the
 * shell phrases into the SACRED i18n-full.json, each Thai value here IS a real
 * PhraseKey (the 3 un-omitted CompanySwitcher strings are pending Wei fill —
 * BLOCKERS B-047 — and fall back to Thai meanwhile, same B-035/B-039 precedent).
 * One boundary cast types the JSON values as PhraseKey, so ct() calls tp() with
 * no per-call cast. For th (the visual-gate language) tp() echoes the key
 * verbatim, so the rendered th text is byte-identical regardless. Thai never
 * appears in .tsx source — only ASCII slot keys do.
 */
import chromeStrings from "./chrome-strings.json" with { type: "json" };
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../i18n";

type Slot = keyof typeof chromeStrings.strings;

/** JSON values are the verbatim Thai phrase keys — the single boundary cast. */
const STRINGS = chromeStrings.strings as Record<Slot, PhraseKey>;

/** Hook returning ct(slot) — a bound chrome-string translator for the active lang. */
export function useChromeText() {
  const { tp } = useI18n();
  return (slot: Slot): string => tp(STRINGS[slot]);
}
