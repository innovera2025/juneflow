/**
 * G3 unit tests (PLAN.md §9) — language store (P0-WEB-03).
 *
 * Covers initial-language resolution from persistence, the "th" default, the
 * localStorage["juneflow-lang"] + <html lang/dir> side-effects (via injected deps,
 * so no jsdom is required), RTL for "ar", the same-language / unknown-code no-op
 * guards, and subscriber notification. Side-effects are asserted through a fake
 * LangStoreDeps that records every call.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getLang as packageGetLang, setLang as resetPackageLang } from "@juneflow/i18n";
import { createLangStore, STORAGE_KEY, type LangStoreDeps } from "./lang-store";

// createLangStore mutates the shared module-level language of @juneflow/i18n; reset it
// after each case so ordering never leaks between tests.
afterEach(() => resetPackageLang("th"));

interface Recorder extends LangStoreDeps {
  persisted: string | null;
  applied: Array<{ lang: string; dir: string }>;
}

function recorder(initial: string | null): Recorder {
  return {
    persisted: initial,
    applied: [],
    readPersisted() {
      return this.persisted;
    },
    writePersisted(lang) {
      this.persisted = lang;
    },
    applyDocument(lang, dir) {
      this.applied.push({ lang, dir });
    },
  };
}

describe("initial language", () => {
  it("defaults to Thai when nothing is persisted", () => {
    const deps = recorder(null);
    const store = createLangStore(deps);
    expect(store.getLang()).toBe("th");
    expect(deps.applied.at(-1)).toEqual({ lang: "th", dir: "ltr" });
    expect(packageGetLang()).toBe("th");
  });

  it("restores a valid persisted language and applies it to package + document", () => {
    const deps = recorder("en");
    const store = createLangStore(deps);
    expect(store.getLang()).toBe("en");
    expect(deps.applied.at(-1)).toEqual({ lang: "en", dir: "ltr" });
    expect(packageGetLang()).toBe("en");
  });

  it("falls back to Thai for an unknown persisted code", () => {
    const store = createLangStore(recorder("xx"));
    expect(store.getLang()).toBe("th");
  });
});

describe("setLang", () => {
  it("switches to Arabic with RTL and persists under juneflow-lang", () => {
    const deps = recorder(null);
    const store = createLangStore(deps);
    store.setLang("ar");
    expect(store.getLang()).toBe("ar");
    expect(deps.persisted).toBe("ar");
    expect(deps.applied.at(-1)).toEqual({ lang: "ar", dir: "rtl" });
    expect(packageGetLang()).toBe("ar");
    // Documents the storage key contract used by the persistence adapter.
    expect(STORAGE_KEY).toBe("juneflow-lang");
  });

  it("keeps every other language LTR", () => {
    const deps = recorder(null);
    const store = createLangStore(deps);
    store.setLang("zh");
    expect(deps.applied.at(-1)).toEqual({ lang: "zh", dir: "ltr" });
  });

  it("is a no-op for the same language and for unknown codes", () => {
    const deps = recorder(null); // starts at "th"
    const store = createLangStore(deps);
    const before = deps.applied.length;
    store.setLang("th"); // same language
    store.setLang("fr" as never); // unknown code
    expect(deps.applied.length).toBe(before);
    expect(store.getLang()).toBe("th");
  });
});

describe("subscribe", () => {
  it("notifies subscribers on change and stops after unsubscribe", () => {
    const store = createLangStore(recorder(null));
    let hits = 0;
    const unsubscribe = store.subscribe(() => {
      hits += 1;
    });
    store.setLang("en");
    expect(hits).toBe(1);
    store.setLang("en"); // no-op -> no notification
    expect(hits).toBe(1);
    store.setLang("zh");
    expect(hits).toBe(2);
    unsubscribe();
    store.setLang("ar");
    expect(hits).toBe(2);
  });
});
