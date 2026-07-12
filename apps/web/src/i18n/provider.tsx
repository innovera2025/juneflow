/**
 * React i18n wiring for @juneflow/web (P0-WEB-03).
 *
 * <I18nProvider> exposes the active language + bound translators to the tree and
 * re-renders on language change via useSyncExternalStore over the framework-agnostic
 * langStore (lang-store.ts). useI18n()/useLang() is the component-facing hook — the
 * prototype's useLang() equivalent (i18n.jsx), minus the DOM MutationObserver (rule 3).
 *
 * The language switcher UI itself (portal dropdown in the app shell) is NOT built here:
 * it is part of the chrome.jsx/shell.jsx port (P0-WEB-05) and calls setLang() from here.
 */
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { LangCode } from "@juneflow/i18n";
import { langStore } from "./lang-store";
import { buildTranslators, type I18nApi } from "./translators";

export interface I18nContextValue extends I18nApi {
  /** Switch the active language (persists + updates <html lang/dir>). */
  setLang(lang: LangCode): void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Subscribe to the external langStore; getLang is the snapshot on client and server
  // (SPA — no SSR mismatch to reconcile).
  const lang = useSyncExternalStore(
    langStore.subscribe,
    langStore.getLang,
    langStore.getLang,
  );

  const value = useMemo<I18nContextValue>(
    () => ({ ...buildTranslators(lang), setLang: langStore.setLang }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the active language + translators. Throws outside <I18nProvider>. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}

/** Prototype-parity alias for useI18n (pototype i18n.jsx useLang()). */
export const useLang = useI18n;
