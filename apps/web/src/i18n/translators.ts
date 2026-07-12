/**
 * Bound translators for @juneflow/web (P0-WEB-03).
 *
 * buildTranslators(lang) binds the key-based lookups from @juneflow/i18n to a fixed
 * language so React components get a stable, referentially-pure API that re-derives
 * only when the active language changes. Every string still comes ONLY from
 * i18n-full.json via t()/tn()/tp() (PLAN.md §0 rule 2) — nothing is translated here.
 *
 * Layers (I18N-KEYS.md §2): t() = DICT (stable key), tn() = NAV (Thai label is key),
 * tp() = PHRASES (Thai phrase is key). Dynamic number-bearing phrases (prototype
 * PHRASE_PATTERNS) are intentionally NOT wired yet — see BLOCKERS.md B-017.
 */
import {
  LANGS,
  dir as resolveDir,
  t as translateDict,
  tn as translateNav,
  tp as translatePhrase,
  type DictKey,
  type LangCode,
  type NavKey,
  type PhraseKey,
} from "@juneflow/i18n";

export interface I18nApi {
  /** Active language code. */
  lang: LangCode;
  /** Layout direction for the active language ("ar" => "rtl"). */
  dir: "ltr" | "rtl";
  /** Language metadata (code/label/dir) from i18n-full.json — for the switcher UI. */
  langs: typeof LANGS;
  /** DICT layer: stable key -> translated string. */
  t(key: DictKey): string;
  /** NAV layer: Thai menu label is the key -> translated string. */
  tn(key: NavKey): string;
  /** PHRASES layer: Thai phrase is the key -> translated string. */
  tp(key: PhraseKey): string;
}

/** Bind every lookup to a single language for the current render. */
export function buildTranslators(lang: LangCode): I18nApi {
  return {
    lang,
    dir: resolveDir(lang),
    langs: LANGS,
    t: (key) => translateDict(key, lang),
    tn: (key) => translateNav(key, lang),
    tp: (key) => translatePhrase(key, lang),
  };
}
