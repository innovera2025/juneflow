/**
 * Thailand statutory rate table (B-319, Wei = ก).
 *
 * WHY THIS FILE EXISTS. The 2% land-transfer fee and the 3.3% specific business tax
 * used to live as float literals in a REACT SCREEN FILE
 * (apps/web/src/screens/land/land-dd-rows.ts: `TRANSFER_FEE_RATE = 0.02`,
 * `SBT_RATE = 0.033`) — two statutory rates with no server counterpart and nothing
 * that would notice if the law changed. They now live here, so the SERVER computes
 * the fees and land.dd renders server figures (same shape as the B-316/A2 deposit fix).
 *
 * PROVENANCE — READ THIS BEFORE TRUSTING THE NUMBERS. Both rates were ported verbatim
 * from the PROTOTYPE, `pototype/land2.jsx:243-244`:
 *
 *   <DealField label="ค่าธรรมเนียมโอน (2%)"     value={fmt(Math.round(plotPrice(...) * 0.02))} />
 *   <DealField label="ภาษีธุรกิจเฉพาะ (3.3%)"  value={fmt(Math.round(plotPrice(...) * 0.033))} />
 *
 * That is the ONLY source in this repo. There is no statute reference, no RD circular,
 * no spec entry: `docs/handoff/FUNCTIONS.md:99` names the step and gives no rate, and
 * `docs/extract/i18n-full.json` carries the rates only inside display labels. So these
 * are prototype-traceable figures, NOT a verified rate table. Do not cite this file as
 * a legal source.
 *
 * CONDITIONALITY IS UNSPECIFIED — deliberately NOT modelled. Real Thai practice makes
 * both rates conditional (SBT can turn on a holding period, and where SBT does not
 * apply a stamp duty does instead; who pays what is negotiable). The spec states none
 * of it, and the prototype's own contract draft (`land2.jsx:352`, i18n
 * `land.contract.buyC5`) says the opposite of a fixed rule:
 *
 *   "ค่าธรรมเนียมโอน ภาษีธุรกิจเฉพาะ และอากรแสตมป์ เป็นไปตามที่ตกลงในสัญญา"
 *   (transfer fee, SBT AND STAMP DUTY are as agreed in the contract)
 *
 * — and `land_plot` (packages/db/src/schema/misc.ts) has no acquisition date, so a
 * holding-period rule would be unevaluable even if it were specified. STAMP DUTY
 * (อากรแสตมป์) is named in that clause and has no field, no rate and no key anywhere.
 * Encoding tax law the spec does not state would be inventing law; a flat rate that is
 * traceable to the prototype is the honest option. Consequence, stated plainly: the two
 * figures on land.dd are ESTIMATES at the prototype's rates, not computed liabilities.
 *
 * SECOND COPY, BY DESIGN. `2%` / `3.3%` also appear as literal TEXT inside the sacred
 * i18n labels `land.dd.buyTransferFee` ("ค่าธรรมเนียมโอน (2%)") and `land.dd.buySbt`
 * ("ภาษีธุรกิจเฉพาะ (3.3%)"). Changing a rate here WITHOUT a Wei-approved SACRED_OVERRIDE
 * on i18n-full.json leaves the label lying to the user. This file is the single source
 * of truth for the COMPUTATION only — not for the label text.
 *
 * UNIT = PERCENT, matching this package's own convention (`WhtCalcInput.ratePercent`
 * "e.g. 3 for 3%", `VatCalcInput.ratePercent` "e.g. 7 for 7%"). Not fractions.
 *
 * NOT ON THE TaxEngine INTERFACE, on purpose. Rates are INPUTS to that interface
 * (calcVat/calcWht take a ratePercent); adding calcLandTransferFee() methods would
 * invert the package's own convention and force `ThailandTaxEngine` — whose every
 * method currently throws TODO(P0-INT-01) — to stub two more, which would 500 the
 * land.dd read under the `thailand` driver. Consumers read the rate and apply it.
 *
 * KNOWN INCONSISTENCY (not this slice's to fix): the other two statutory rates in the
 * repo are still route-file consts — `VAT_RATE_PERCENT = 7` (apps/api/src/routes/ar.ts)
 * and `DEFAULT_WHT_PCT = 3` (apps/api/src/routes/ap.ts). Migrating them here is a
 * behaviour-neutral refactor behind the two most heavily tested money paths in the repo
 * and deserves its own gate.
 */

/**
 * Thai statutory rates, as PERCENT (2 = 2%). Flat and unconditional — see the
 * conditionality note above before adding a rule to this table.
 */
export const THAILAND_RATES = {
  /** Land-transfer fee at the Land Department. Source: pototype/land2.jsx:243. */
  landTransferFeePercent: 2,
  /** Specific business tax (ภาษีธุรกิจเฉพาะ). Source: pototype/land2.jsx:244. */
  specificBusinessTaxPercent: 3.3,
} as const;
