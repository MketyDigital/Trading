import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSymbolEquivalentSizing,
  buildBalancePercentSizing,
  largestLotsWithinMargin,
  normalizeReferenceLots,
} from '../src/execution/margin_equivalent_sizing.js';

test('normalizes familiar reference lots down to the broker step', () => {
  assert.equal(normalizeReferenceLots(0.913, { minLots:0.01,maxLots:100,stepLots:0.01 }), 0.91);
});

test('symbol-equivalent keeps the owner chosen lot when target is not heavier', async () => {
  const result = await buildSymbolEquivalentSizing({
    referenceLots:0.9,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    estimateReferenceMargin:async () => 90,
    estimateTargetMargin:async (lots) => lots * 50,
  });
  assert.equal(result.lots,0.9);
  assert.equal(result.reduced,false);
});

test('symbol-equivalent reduces a heavier target but never increases above chosen lot', async () => {
  const result = await buildSymbolEquivalentSizing({
    referenceLots:0.9,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    estimateReferenceMargin:async () => 90,
    estimateTargetMargin:async (lots) => lots * 300,
  });
  assert.equal(result.lots,0.3);
  assert.equal(result.reduced,true);
  assert.ok(result.lots <= 0.9);
});

test('symbol-equivalent rejects target broker minimum above the owner-selected lot', async () => {
  await assert.rejects(() => buildSymbolEquivalentSizing({
    referenceLots:0.09,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.5,maxLots:100,stepLots:0.5},
    estimateReferenceMargin:async () => 9,
    estimateTargetMargin:async () => 100,
  }), (error) => error?.code === 'SYMBOL_EQUIVALENT_BELOW_BROKER_MINIMUM');
});

test('balance-percent caps at owner maximum lot and reduces when budget requires it', async () => {
  const result = await buildBalancePercentSizing({
    maximumLots:1,
    percent:1,
    accountBalance:10000,
    targetInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    estimateTargetMargin:async (lots) => lots * 250,
  });
  assert.equal(result.marginBudget,100);
  assert.equal(result.lots,0.4);
  assert.equal(result.reduced,true);
});

test('balance-percent never increases above owner maximum lot when target is cheap', async () => {
  const result = await buildBalancePercentSizing({
    maximumLots:0.2,
    percent:10,
    accountBalance:10000,
    targetInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    estimateTargetMargin:async (lots) => lots * 10,
  });
  assert.equal(result.lots,0.2);
  assert.equal(result.reduced,false);
});

test('balance-percent fails closed when broker minimum exceeds percentage budget', async () => {
  await assert.rejects(() => buildBalancePercentSizing({
    maximumLots:1,
    percent:1,
    accountBalance:1000,
    targetInstrument:{minLots:0.5,maxLots:10,stepLots:0.5},
    estimateTargetMargin:async (lots) => lots * 100,
  }), (error) => error?.code === 'BALANCE_PERCENT_BELOW_BROKER_MINIMUM');
});

test('largestLotsWithinMargin respects configured maximum lot', async () => {
  const result = await largestLotsWithinMargin({
    instrument:{minLots:0.1,maxLots:10,stepLots:0.1},
    marginBudget:10000,
    maximumLots:0.9,
    estimateMargin:async (lots) => lots * 10,
  });
  assert.equal(result.lots,0.9);
});

test('normalizes scientific-notation broker steps without losing decimal precision', () => {
  assert.equal(
    normalizeReferenceLots(0.00000039, { minLots:0.0000001, maxLots:0.00001, stepLots:1e-7 }),
    0.0000003,
  );
});

test('symbol-equivalent does not floor a target to minimum above the normalized reference lots', async () => {
  await assert.rejects(() => buildSymbolEquivalentSizing({
    referenceLots:0.099,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.2,maxLots:100,stepLots:0.1},
    estimateReferenceMargin:async () => 9,
    estimateTargetMargin:async (lots) => lots * 100,
  }), (error) => error?.code === 'SYMBOL_EQUIVALENT_BELOW_BROKER_MINIMUM');
});
