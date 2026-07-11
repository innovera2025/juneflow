/**
 * @juneflow/i18n - key-based t() loader skeleton (TASKS.md P0-BE-05, consumed by P0-WEB-03).
 *
 * RULE (PLAN.md section 0 rule 2): every translation comes ONLY from src/i18n-full.json
 * (sacred file, copied verbatim from docs/extract/i18n-full.json - do not edit, do not re-translate
 * a single word). Any user-visible string NOT present in i18n-full.json => write it to BLOCKERS.md
 * and skip. NEVER invent translations.
 *
 * RULE (PLAN.md section 0 rule 3): the prototype translates via DOM MutationObserver - that is a
 * mock mechanism and must NOT be ported. Production uses this key-based t()/tn()/tp() API only.
 *
 * 3-layer structure (docs/extract/I18N-KEYS.md section 2):
 *   - dict     : stable keys (e.g. "app.name") -> { th, en, zh, ar }          - 59 keys  - t()
 *   - nav_i18n : Thai menu label IS the key    -> { en, zh, ar, ... }         - 112 keys - tn()
 *   - phrases  : Thai phrase IS the key        -> { en, zh, ar }              - 736 keys - tp()
 * Language fallback (I18N-KEYS.md section 1, langResolve): missing lang -> en -> th;
 * zh-TW -> zh -> en -> th.
 *
 * TODO(P0-BE-05): unit tests for the loader across th/zh/en/ar + RTL (gate G3 for this package).
 * TODO(P0-WEB-03): PHRASE_PATTERNS (2 regex+builder patterns for texts with numbers, e.g.
 *   "แสดง X จาก Y รายการ") live in the prototype i18n code, not in i18n-full.json - port them
 *   with the web i18n wiring.
 */
import i18nFull from "./i18n-full.json";

/** Supported language codes (LANGS in prototype i18n.jsx). "ar" is RTL. */
export type LangCode = "th" | "zh" | "en" | "ar";

export interface LangDef {
  code: string;
  label: string;
  en: string;
  dir: string; // "ltr" | "rtl"
}

/** Typed key lookup - keys are derived from the sacred JSON, so unknown keys fail typecheck. */
export type DictKey = keyof typeof i18nFull.dict;
export type NavKey = keyof typeof i18nFull.nav_i18n;
export type PhraseKey = keyof typeof i18nFull.phrases;

export const LANGS: readonly LangDef[] = i18nFull.langs;

/** Default language of the prototype (Thai). Tenant/user setting overrides at runtime. */
const DEFAULT_LANG: LangCode = "th";

let currentLang: LangCode = DEFAULT_LANG;

export function setLang(lang: LangCode): void {
  currentLang = lang;
}

export function getLang(): LangCode {
  return currentLang;
}

/** RTL flag - true for "ar" (dir comes from langs[] in i18n-full.json, never hardcoded per-screen). */
export function isRTL(lang: LangCode = currentLang): boolean {
  return LANGS.find((l) => l.code === lang)?.dir === "rtl";
}

/** For <html dir=...> / layout direction switching (P0-WEB-03). */
export function dir(lang: LangCode = currentLang): "rtl" | "ltr" {
  return isRTL(lang) ? "rtl" : "ltr";
}

/**
 * Fallback resolution per docs/extract/I18N-KEYS.md section 1 (langResolve):
 * requested lang -> en -> th. (zh-TW -> zh -> en -> th is handled by callers that
 * normalize the requested code; only th/zh/en/ar are first-class here.)
 */
function resolveEntry(
  entry: Partial<Record<string, string>>,
  lang: LangCode,
): string | undefined {
  return entry[lang] ?? entry["en"] ?? entry["th"];
}

/**
 * Layer 1 - DICT: stable key -> { th, en, zh, ar }.
 * Missing key at runtime = programming error: the string must be added to BLOCKERS.md,
 * never translated/invented here. Returns the key itself as a visible marker.
 */
export function t(key: DictKey, lang: LangCode = currentLang): string {
  const entry = i18nFull.dict[key] as Partial<Record<string, string>> | undefined;
  if (!entry) return String(key); // not in i18n-full.json -> BLOCKERS.md, never invent
  return resolveEntry(entry, lang) ?? String(key);
}

/**
 * Layer 2 - NAV_I18N: the Thai menu label IS the key; entry holds { en, zh, ar, ... }.
 * For lang "th" the key itself is the translation.
 */
export function tn(key: NavKey, lang: LangCode = currentLang): string {
  if (lang === "th") return String(key);
  const entry = i18nFull.nav_i18n[key] as Partial<Record<string, string>> | undefined;
  if (!entry) return String(key); // not in i18n-full.json -> BLOCKERS.md, never invent
  return resolveEntry(entry, lang) ?? String(key);
}

/**
 * Layer 3 - PHRASES: the Thai phrase IS the key; entry holds { en, zh, ar }.
 * For lang "th" the key itself is the translation.
 */
export function tp(key: PhraseKey, lang: LangCode = currentLang): string {
  if (lang === "th") return String(key);
  const entry = i18nFull.phrases[key] as Partial<Record<string, string>> | undefined;
  if (!entry) return String(key); // not in i18n-full.json -> BLOCKERS.md, never invent
  return resolveEntry(entry, lang) ?? String(key);
}
