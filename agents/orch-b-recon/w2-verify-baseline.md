# W2 pre-merge baseline (orch-B · 2026-07-19 · dev 90452fb)
Captured BEFORE orch-A applies SR-1/SR-2 + W2, so the post-W2 sacred-integrity verify is exact.

## openapi.yaml (SR-1 must add ONLY the 5 approved op declarations)
- baseline md5: `afcbebcf348e9a12e0d9bb8e3f9ee82d`
- SR-1 batch = **5 ops** (one amendment; handlers land per-wave): GET /boq/reports/cost-type, /boq/reports/boq-vs-nonboq, /boq/reports/variance, /boq/reports/evm, /analytics/portfolio · boq/analytics tag · **opaque Entity/EntityOk** (no named fields in contract).
- DROPPED (D1): /analytics/cost-variance — the 6th potential op, NOT one of the 5. Must NOT appear.
- post-W2 check: `git diff <baseline> <w2> -- openapi.yaml` = exactly these 5 path additions, nothing else.

## i18n (SR-2 adds activity keys ONLY · both copies byte-identical)
- baseline: 2100 keys each copy · `cmp docs/extract/i18n-full.json packages/i18n/src/i18n-full.json` = IDENTICAL
- SR-2 adds: dashboard.activityTitle + action verb map + time-ago suffix (glyph-exact). post-W2: both copies still `cmp`-identical, delta = only the activity keys.

## migration (W2 = aggregation-only)
- highest merged = 0030_bored_unus.sql. W2 must add **NO migration** (0031 reserved for W3 evm_snapshot).

## W2 verify plan (on merge)
1. sacred: openapi diff = only 5 op decls (opaque) · no cost-variance · i18n cmp-identical (+activity keys only) · NO migration
2. contract: generated client regens clean (no drift) · 5 ops declared
3. C10 honesty: cost-type/boq-vs-nonboq/portfolio real aggregates · Non-BOQ = pr_item.boq_item_id IS NULL (D1=ค) · honest-empty where source absent
4. live: boot stack + curl the 3 W2 handlers (cost-type/boq-vs-nonboq/portfolio) + tenant-scope + 401 fail-closed
5. gate-4.5 before push
