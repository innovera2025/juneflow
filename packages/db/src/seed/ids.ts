// @juneflow/db — deterministic id helper for the seed (P0-BE-10).
//
// PLAN.md §0 rule 1 + P0-BE-10 hard rule 1: mock arrays reference parents by
// name-text; the seed normalizes those into real uuid FKs. To stay deterministic
// AND idempotent (re-running produces the same graph), every seeded row gets a
// FIXED uuid derived from a stable namespace string rather than a random one.
//
// `det(ns)` hashes the namespace with SHA-1 and formats it as a syntactically
// valid v5-style uuid. Same input → same uuid on every run, so FK wiring is
// stable across re-seeds even though we TRUNCATE + re-INSERT each time.

import { createHash } from "node:crypto";

/** Deterministic uuid from a namespace string (stable across runs). */
export function det(ns: string): string {
  const h = createHash("sha1").update(ns).digest("hex");
  // 8-4-4-4-12, force version nibble (5) and RFC-4122 variant nibble (8..b).
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    "8" + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}
