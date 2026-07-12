/**
 * i18n wiring barrel for @juneflow/web (P0-WEB-03).
 *
 * Re-exports the React provider/hook, the bound-translator builder, and the
 * framework-agnostic language store. Components should import { useI18n } from here.
 * Every string still resolves through @juneflow/i18n keys (i18n-full.json) only.
 */
export {
  I18nProvider,
  useI18n,
  useLang,
  type I18nContextValue,
} from "./provider";
export { buildTranslators, type I18nApi } from "./translators";
export {
  langStore,
  createLangStore,
  STORAGE_KEY,
  type LangStore,
  type LangStoreDeps,
} from "./lang-store";
