// Package seed rows (P0-BE-10, menus fixed by P1-BE-04 / B-043(ค)).
//
// Source: pkg-builder / subscription.jsx via docs/extract/PACKAGE-RULES.md —
// decision C1: 4 tiers S/M/L/Full (S=2900 M=7900 L=14900 Full=contact);
// limits keys per C5 (storage_gb / ai_per_month).
//
// menus — B-043(ค): the allow-list vocabulary is NAV TOP-LEVEL IDS
// (PACKAGE-RULES.md §2 `pkgPresetIds`), NOT module keys. Transcribed verbatim,
// cumulative S ⊂ M ⊂ L; Full = "*" (every menu). These drive pkgMenuAllowed
// on the web shell (§4: dashboard + sub are ALWAYS on regardless of the
// list; "*" = all — web wiring in P0-WEB-05 5b).
//
// Exported as a module so unit tests can assert the seeded lists against
// PACKAGE-RULES.md §2 verbatim (apps/api G3).

import type { PackageLimits, PackageSubRules } from "../schema/platform.js";

export interface PackageSeed {
  key: "S" | "M" | "L" | "Full";
  size: "S" | "M" | "L" | "Full";
  name: string;
  priceM: string | null;
  priceY: string | null;
  limits: PackageLimits;
  menus: readonly string[];
  subRules: PackageSubRules;
}

// PACKAGE-RULES.md §2 — S (6 เมนู)
const MENUS_S = [
  "dashboard",
  "boq",
  "proc",
  "petty",
  "timeline",
  "reports",
] as const;

// PACKAGE-RULES.md §2 — M (20 เมนู) = S + 14
const MENUS_M = [
  ...MENUS_S,
  "land",
  "subcon",
  "accept",
  "inv",
  "pm",
  "gl",
  "ap",
  "ar",
  "bank",
  "tax",
  "fa",
  "alloc",
  "dms",
  "master",
] as const;

// PACKAGE-RULES.md §2 — L (29 เมนู) = M + 9
const MENUS_L = [
  ...MENUS_M,
  "sales",
  "labor",
  "opex",
  "exec",
  "mobile",
  "line",
  "users",
  "audit",
  "settings",
] as const;

export const PACKAGES: readonly PackageSeed[] = [
  {
    key: "S",
    size: "S",
    name: "Starter",
    priceM: "2900.00",
    priceY: "29000.00",
    limits: { projects: 2, users: 5, storage_gb: 20, ai_per_month: 10 },
    menus: MENUS_S,
    subRules: {},
  },
  {
    key: "M",
    size: "M",
    name: "Professional",
    priceM: "7900.00",
    priceY: "79000.00",
    limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
    menus: MENUS_M,
    subRules: { "boq.aiqto": "M" },
  },
  {
    key: "L",
    size: "L",
    name: "Business",
    priceM: "14900.00",
    priceY: "149000.00",
    limits: { projects: 30, users: 60, storage_gb: 500, ai_per_month: 200 },
    menus: MENUS_L,
    subRules: { "boq.aiqto": "L" },
  },
  {
    key: "Full",
    size: "Full",
    name: "Enterprise",
    priceM: null,
    priceY: null,
    limits: { projects: -1, users: -1, storage_gb: 1000, ai_per_month: -1 },
    menus: ["*"],
    subRules: { "master.ptype": "Full", "boq.aiqto": "M" },
  },
];
