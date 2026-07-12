/**
 * Language store for @juneflow/web (P0-WEB-03).
 *
 * Framework-agnostic singleton that mirrors the prototype i18n.jsx `I18N` IIFE
 * (get/dir/set/sub) MINUS its DOM MutationObserver translation — that is a mock
 * mechanism and must NOT be ported (PLAN.md §0 rule 3). Production translates via
 * the key-based t()/tn()/tp() API from @juneflow/i18n only.
 *
 * Behaviour ported 1:1 from the prototype (i18n.jsx lines 94-116, I18N-KEYS.md §4):
 *   - active language persists in localStorage["juneflow-lang"] (default "th"),
 *   - on change, <html lang> and <html dir> are set ("ar" => rtl),
 *   - the module-level current language of @juneflow/i18n is kept in sync so
 *     t()/tn()/tp() called without an explicit lang reflect the active language.
 *
 * All DOM/storage access is guarded (like the prototype's try/catch) and injectable,
 * so the store is unit-testable in a plain Node environment (G3, no jsdom needed).
 */
import {
  LANGS,
  dir as resolveDir,
  setLang as setPackageLang,
  type LangCode,
} from "@juneflow/i18n";

/** localStorage key holding the active language (prototype: "juneflow-lang"). */
export const STORAGE_KEY = "juneflow-lang";

/** Prototype default language (Thai); tenant/user setting overrides at runtime. */
const DEFAULT_LANG: LangCode = "th";

/** Injectable side-effects so the store can be tested without a DOM. */
export interface LangStoreDeps {
  /** Read the persisted language code (null when absent/unavailable). */
  readPersisted(): string | null;
  /** Persist the active language code. */
  writePersisted(lang: LangCode): void;
  /** Apply <html lang> / <html dir> for the active language. */
  applyDocument(lang: LangCode, dir: "ltr" | "rtl"): void;
}

/** Type guard: only the four first-class codes from i18n-full.json are accepted. */
function isLangCode(value: string | null | undefined): value is LangCode {
  return value != null && LANGS.some((l) => l.code === value);
}

/** Default deps: guarded access to the ambient localStorage / document. */
const domDeps: LangStoreDeps = {
  readPersisted() {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  writePersisted(lang) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable (e.g. SSR/tests) — no-op, matches prototype */
    }
  },
  applyDocument(lang, dir) {
    try {
      const el = globalThis.document?.documentElement;
      if (el) {
        el.setAttribute("lang", lang);
        el.setAttribute("dir", dir);
      }
    } catch {
      /* no document — no-op */
    }
  },
};

export interface LangStore {
  getLang(): LangCode;
  setLang(lang: LangCode): void;
  /** Subscribe to language changes; returns an unsubscribe fn (for useSyncExternalStore). */
  subscribe(callback: () => void): () => void;
}

/**
 * Create a language store. The initial language is read from persistence (falling
 * back to "th"), then immediately applied to @juneflow/i18n and the document so the
 * first render is already in the right language and direction.
 */
export function createLangStore(deps: LangStoreDeps = domDeps): LangStore {
  const subscribers = new Set<() => void>();
  const persisted = deps.readPersisted();
  let current: LangCode = isLangCode(persisted) ? persisted : DEFAULT_LANG;

  // Initial apply (prototype: apply() runs once on IIFE construction).
  setPackageLang(current);
  deps.applyDocument(current, resolveDir(current));

  return {
    getLang: () => current,
    setLang(lang) {
      // Prototype no-op guard: ignore unknown codes and same-language sets.
      if (!isLangCode(lang) || lang === current) return;
      current = lang;
      setPackageLang(lang);
      deps.writePersisted(lang);
      deps.applyDocument(lang, resolveDir(lang));
      subscribers.forEach((fn) => fn());
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
}

/** App-wide singleton bound to the real localStorage / document. */
export const langStore = createLangStore();
