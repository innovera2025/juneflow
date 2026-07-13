import type { MaskRegion } from "./compare";

// tests/visual/lib/masks.ts — named registry of Wei-approved mask regions
// (P0-QA-07). Masks are opt-in PER SCREEN via the "masks" field of a
// screens.manifest.json entry (list of registry keys) — there is no global or
// ambient mask. Every region cites the approving BLOCKERS.md id in `reason`
// (enforced by validateMaskRegions in compare.ts).
//
// Screens WITHOUT the region simply do not list the key — e.g. the login
// screen (P1-WEB-01) has no sidebar logo lockup, so it must NOT opt into
// "sidebar-logo-b044".

export const MASK_REGISTRY: Record<string, MaskRegion> = {
  // B-044(ก) — Wei ruling 2026-07-13: the port's t("app.name") th =
  // "ระบบงานก่อสร้าง" is CORRECT; all ~128 reference images carry an older
  // logo lockup (lowercase "juneflow" wordmark + English "Construction ERP"
  // tagline). Differences inside the sidebar logo region are Wei-approved.
  //
  // Rect measured from tests/visual/reference/gallery/g1/01-s.jpg (1600x1000):
  //   - lockup content bbox: x 16..124, y 16..55
  //     (icon tile x16..49 y15..50 · wordmark x60..119 y21..33 ·
  //      tagline "Construction"/"ERP" x60..124 y35..54)
  //   - header/nav divider at y=64-65 · ลูกค้า/เจ้าของระบบ toggle from y≈69
  // Mask x8..231, y6..61: wraps the lockup with margin + horizontal headroom
  // for the port's one-line Thai tagline (t("app.name")), and stays ABOVE the
  // y=64 divider so the toggle/search/menu rows below are never masked.
  "sidebar-logo-b044": {
    x: 8,
    y: 6,
    width: 224,
    height: 56,
    reason:
      "B-044(ก) Wei-approved 2026-07-13 — sidebar logo lockup: references show older 'juneflow / Construction ERP'; port renders brand mark + t(\"app.name\") (th: ระบบงานก่อสร้าง)",
  },
};

/** Resolve manifest mask keys → regions. Unknown key = config error, throw. */
export function resolveMasks(names: string[] | undefined): MaskRegion[] {
  if (!names || names.length === 0) return [];
  return names.map((name) => {
    const region = MASK_REGISTRY[name];
    if (!region) {
      throw new Error(
        `Unknown mask "${name}" — known masks: ${Object.keys(MASK_REGISTRY).join(", ")} (tests/visual/lib/masks.ts)`
      );
    }
    return region;
  });
}
