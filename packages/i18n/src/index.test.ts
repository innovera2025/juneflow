/**
 * G3 unit tests (PLAN.md §9) — key-based i18n loader (P0-BE-05, consumed by P0-WEB-03).
 *
 * Covers the three lookup layers (dict/nav/phrases) across all four first-class
 * languages th/zh/en/ar + RTL, the langResolve fallback (requested -> en -> th),
 * and the "never invent" miss path (unknown key returns the key itself, which
 * signals it must be added to BLOCKERS.md — never translated inline).
 *
 * Expected values are the verbatim entries in src/i18n-full.json (sacred, copied
 * from docs/extract/i18n-full.json). These tests read the sacred file, they never
 * assert a translation that is not already in it (PLAN.md §0 rule 2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LangCode } from './index.js';
import {
  LANGS,
  dir,
  getLang,
  isRTL,
  setLang,
  t,
  tn,
  tp,
} from './index.js';
import i18nFull from './i18n-full.json' with { type: 'json' };

// Reset the module-level current language after every test so ordering never
// leaks state between cases.
afterEach(() => setLang('th'));

describe('langs metadata', () => {
  it('exposes the four first-class languages with ar as the only RTL', () => {
    expect(LANGS.map((l) => l.code)).toEqual(['th', 'zh', 'en', 'ar']);
    expect(LANGS.filter((l) => l.dir === 'rtl').map((l) => l.code)).toEqual(['ar']);
  });
});

describe('current-language state', () => {
  it('defaults to Thai', () => {
    expect(getLang()).toBe('th');
  });

  it('setLang switches the language used when no explicit lang is passed', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('app.name')).toBe('Construction ERP');
  });
});

describe('t() — DICT layer (stable key -> {th,en,zh,ar})', () => {
  it('resolves every first-class language for a stable key', () => {
    expect(t('app.name', 'th')).toBe('ระบบงานก่อสร้าง');
    expect(t('app.name', 'zh')).toBe('建筑工程系统');
    expect(t('app.name', 'en')).toBe('Construction ERP');
    // ar entry is asserted against the sacred source verbatim (avoids re-typing RTL text).
    expect(t('app.name', 'ar')).toBe(i18nFull.dict['app.name'].ar);
  });

  it('returns the key unchanged for an unknown key (never invent a translation)', () => {
    // @ts-expect-error unknown keys are a compile-time error; test the runtime guard too.
    expect(t('does.not.exist', 'en')).toBe('does.not.exist');
  });

  it('falls back to en when the requested language is absent from the entry', () => {
    // Cast an unsupported code to force the resolve chain (requested -> en -> th).
    expect(t('app.name', 'fr' as LangCode)).toBe('Construction ERP');
  });
});

describe('tn() — NAV layer (Thai label IS the key)', () => {
  it('returns the Thai key itself for lang "th"', () => {
    expect(tn('งานหลัก', 'th')).toBe('งานหลัก');
  });

  it('translates the menu label for zh/en/ar', () => {
    expect(tn('งานหลัก', 'en')).toBe('Main');
    expect(tn('งานหลัก', 'zh')).toBe('主要');
    expect(tn('งานหลัก', 'ar')).toBe('الرئيسية');
  });

  it('returns the key unchanged for an unknown menu label', () => {
    // @ts-expect-error unknown keys are a compile-time error; test the runtime guard too.
    expect(tn('เมนูที่ไม่มีจริง', 'en')).toBe('เมนูที่ไม่มีจริง');
  });
});

describe('tp() — PHRASES layer (Thai phrase IS the key)', () => {
  const phrase = 'Project Timeline · แผนงานโครงการ';

  it('returns the phrase key itself for lang "th"', () => {
    expect(tp(phrase, 'th')).toBe(phrase);
  });

  it('translates the phrase for zh/en/ar', () => {
    expect(tp(phrase, 'en')).toBe('Project Timeline');
    expect(tp(phrase, 'zh')).toBe('项目计划');
    expect(tp(phrase, 'ar')).toBe('الجدول الزمني للمشروع');
  });

  it('returns the key unchanged for an unknown phrase', () => {
    // @ts-expect-error unknown keys are a compile-time error; test the runtime guard too.
    expect(tp('ประโยคที่ไม่มีจริง', 'en')).toBe('ประโยคที่ไม่มีจริง');
  });
});

describe('RTL direction', () => {
  it('isRTL is true only for ar', () => {
    expect(isRTL('th')).toBe(false);
    expect(isRTL('zh')).toBe(false);
    expect(isRTL('en')).toBe(false);
    expect(isRTL('ar')).toBe(true);
  });

  it('dir maps ar -> rtl and everything else -> ltr', () => {
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
  });

  it('isRTL/dir honour the current language when none is passed', () => {
    setLang('ar');
    expect(isRTL()).toBe(true);
    expect(dir()).toBe('rtl');
  });
});
