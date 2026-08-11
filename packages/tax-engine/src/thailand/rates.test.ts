/*
 * THAILAND_RATES unit tests (B-319, gate G3).
 *
 * These pin two STATUTORY rates that previously existed nowhere but a React screen file.
 * The point of pinning them is not that the arithmetic is hard — it is that a rate is a
 * fact about the world, and a silent edit to a fact should break a build. If a rate
 * genuinely changes, this file is the checklist: change the value HERE, then the sacred
 * i18n labels (land.dd.buyTransferFee / land.dd.buySbt spell the rate out in their text),
 * then re-baseline land-dd.png.
 */
import { describe, it, expect } from 'vitest';
import { THAILAND_RATES } from './rates.js';
import { THAILAND_RATES as viaIndex } from './index.js';

describe('THAILAND_RATES', () => {
  it('pins the rates ported from pototype/land2.jsx:243-244', () => {
    expect(THAILAND_RATES.landTransferFeePercent).toBe(2);
    expect(THAILAND_RATES.specificBusinessTaxPercent).toBe(3.3);
  });

  /*
   * UNIT GUARD. The whole package speaks percent (WhtCalcInput.ratePercent "e.g. 3 for
   * 3%"). Someone "simplifying" these to fractions (0.02 / 0.033) would leave every
   * consumer's `x * rate / 100` silently computing 1/100th of the fee — a wrong number,
   * not a crash. Percent-vs-fraction is the failure mode this table is most exposed to.
   */
  it('states the rates as PERCENT, not as fractions', () => {
    expect(THAILAND_RATES.landTransferFeePercent).toBeGreaterThan(1);
    expect(THAILAND_RATES.specificBusinessTaxPercent).toBeGreaterThan(1);
    expect(THAILAND_RATES.landTransferFeePercent).not.toBe(0.02);
    expect(THAILAND_RATES.specificBusinessTaxPercent).not.toBe(0.033);
  });

  /*
   * The percent form must be EXACTLY the fraction the prototype used, or moving the
   * rates to the server would silently move a rendered figure. IEEE-754 makes this an
   * identity, not an approximation: 3.3/100 === 0.033 and 2/100 === 0.02 exactly.
   */
  it('is bit-identical to the prototype fractions once divided by 100', () => {
    expect(THAILAND_RATES.landTransferFeePercent / 100).toBe(0.02);
    expect(THAILAND_RATES.specificBusinessTaxPercent / 100).toBe(0.033);
  });

  it('is reachable from the @juneflow/tax-engine/thailand entry point', () => {
    expect(viaIndex).toBe(THAILAND_RATES);
  });

  /*
   * No conditionality is modelled, on purpose (see the rates.ts docstring: the spec is
   * silent, the prototype's own contract clause says "as agreed in the contract", and
   * land_plot has no acquisition date to evaluate a holding period against). This test
   * fails the moment someone adds a rule — at which point it should be REPLACED by tests
   * for that rule, not deleted quietly.
   */
  it('exposes flat rates only — no holding-period / stamp-duty rules are encoded', () => {
    expect(Object.keys(THAILAND_RATES).sort()).toEqual([
      'landTransferFeePercent',
      'specificBusinessTaxPercent',
    ]);
    for (const v of Object.values(THAILAND_RATES)) {
      expect(typeof v).toBe('number');
    }
  });
});
